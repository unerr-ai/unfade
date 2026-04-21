// FILE: src/services/intelligence/session-materializer.ts
// 12C.13: Session materializer — groups events by session_id into a sessions table
// with per-session metrics (turn count, outcome, cost, execution phases).

import type { DbLike } from "../cache/manager.js";

/**
 * Ensure the sessions table exists. Called once on first use.
 */
export function ensureSessionsTable(db: DbLike): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      start_ts TEXT,
      end_ts TEXT,
      event_count INTEGER DEFAULT 0,
      turn_count INTEGER DEFAULT 0,
      outcome TEXT,
      estimated_cost REAL DEFAULT 0,
      execution_phases TEXT,
      branch TEXT,
      domain TEXT,
      feature_id TEXT,
      updated_at TEXT
    )
  `);
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_ts)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_outcome ON sessions(outcome)`);
  } catch {
    // indexes may already exist
  }
}

/**
 * Materialize session metrics from events into the sessions table.
 * Groups events by session_id (from metadata) and computes per-session aggregates.
 * Non-fatal: wraps all work in try/catch.
 */
export function materializeSessionMetrics(db: DbLike): number {
  try {
    ensureSessionsTable(db);

    // Find events with session_id that aren't yet materialized
    const result = db.exec(`
      SELECT
        json_extract(metadata, '$.session_id') as session_id,
        MIN(ts) as start_ts,
        MAX(ts) as end_ts,
        COUNT(*) as event_count,
        MAX(CAST(json_extract(metadata, '$.turn_count') AS INTEGER)) as max_turns,
        json_extract(metadata, '$.outcome') as outcome,
        SUM(COALESCE(CAST(json_extract(metadata, '$.estimated_cost') AS REAL), 0)) as total_cost,
        GROUP_CONCAT(DISTINCT json_extract(metadata, '$.execution_phase')) as phases,
        MAX(git_branch) as branch,
        MAX(json_extract(metadata, '$.domain')) as domain
      FROM events
      WHERE json_extract(metadata, '$.session_id') IS NOT NULL
        AND json_extract(metadata, '$.session_id') NOT IN (
          SELECT id FROM sessions WHERE updated_at >= datetime('now', '-1 hour')
        )
      GROUP BY json_extract(metadata, '$.session_id')
      LIMIT 200
    `);

    if (!result[0]?.values.length) return 0;

    let upserted = 0;
    for (const row of result[0].values) {
      const sessionId = row[0] as string;
      if (!sessionId) continue;

      const startTs = (row[1] as string) ?? "";
      const endTs = (row[2] as string) ?? "";
      const eventCount = (row[3] as number) ?? 0;
      const turnCount = (row[4] as number) ?? 0;
      const outcome = (row[5] as string) ?? null;
      const estimatedCost = (row[6] as number) ?? 0;
      const phases = (row[7] as string) ?? "";
      const branch = (row[8] as string) ?? null;
      const domain = (row[9] as string) ?? null;

      // Look up feature_id from event_features
      let featureId: string | null = null;
      try {
        const featureResult = db.exec(`
          SELECT ef.feature_id FROM event_features ef
          JOIN events e ON e.id = ef.event_id
          WHERE json_extract(e.metadata, '$.session_id') = '${sessionId.replace(/'/g, "''")}'
          LIMIT 1
        `);
        featureId = (featureResult[0]?.values[0]?.[0] as string) ?? null;
      } catch {
        // non-fatal
      }

      db.run(
        `INSERT OR REPLACE INTO sessions
         (id, start_ts, end_ts, event_count, turn_count, outcome, estimated_cost,
          execution_phases, branch, domain, feature_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [sessionId, startTs, endTs, eventCount, turnCount, outcome, estimatedCost,
         phases, branch, domain, featureId],
      );
      upserted++;
    }

    return upserted;
  } catch {
    return 0;
  }
}

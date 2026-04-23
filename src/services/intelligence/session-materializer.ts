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
export async function materializeSessionMetrics(db: DbLike): Promise<number> {
  try {
    ensureSessionsTable(db);

    const result = await db.exec(`
      SELECT
        session_id,
        MIN(ts) as start_ts,
        MAX(ts) as end_ts,
        COUNT(*) as event_count,
        MAX(turn_count) as max_turns,
        last(outcome ORDER BY ts) as outcome,
        SUM(COALESCE(estimated_cost, 0)) as total_cost,
        string_agg(DISTINCT execution_phase, ',') as phases,
        MAX(git_branch) as branch,
        MAX(content_project) as domain
      FROM events
      WHERE session_id IS NOT NULL
        AND session_id NOT IN (
          SELECT id FROM sessions WHERE updated_at >= now() - INTERVAL '1 hour'
        )
      GROUP BY session_id
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

      let featureId: string | null = null;
      try {
        const featureResult = await db.exec(
          `SELECT ef.feature_id FROM event_features ef
           JOIN events e ON e.id = ef.event_id
           WHERE e.session_id = $1
           LIMIT 1`,
          [sessionId],
        );
        featureId = (featureResult[0]?.values[0]?.[0] as string) ?? null;
      } catch {
        // non-fatal
      }

      db.run(
        `INSERT OR REPLACE INTO sessions
         (id, project_id, start_ts, end_ts, event_count, turn_count, outcome, estimated_cost,
          execution_phases, branch, domain, feature_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
        [
          sessionId,
          "",
          startTs,
          endTs,
          eventCount,
          turnCount,
          outcome,
          estimatedCost,
          phases,
          branch,
          domain,
          featureId,
        ],
      );
      upserted++;
    }

    return upserted;
  } catch {
    return 0;
  }
}

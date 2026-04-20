// FILE: src/services/intelligence/window-aggregator.ts
// UF-216: Rolling window aggregator for direction density and tool mix.
// Computes 1h, 8h, 24h, 7d windows and upserts into direction_windows table.
// Bounded cardinality: max 4 historical rows per window size.

import { logger } from "../../utils/logger.js";

type DbLike = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
};

const WINDOW_SIZES = [
  { label: "1h", hours: 1 },
  { label: "8h", hours: 8 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
] as const;

const MAX_HISTORICAL_PER_WINDOW = 4;

export interface WindowResult {
  windowSize: string;
  windowEnd: string;
  directionDensity: number;
  eventCount: number;
  toolMix: Record<string, number>;
}

/**
 * Compute and upsert rolling window aggregates for all configured windows.
 * Reads from the events table (populated by materializer).
 * Returns the computed windows for use by summary writer.
 */
export function computeAndStoreWindows(db: DbLike): WindowResult[] {
  const now = new Date().toISOString();
  const results: WindowResult[] = [];

  for (const { label, hours } of WINDOW_SIZES) {
    try {
      const result = computeWindow(db, hours, now);
      const windowResult: WindowResult = {
        windowSize: label,
        windowEnd: now,
        directionDensity: result.directionDensity,
        eventCount: result.eventCount,
        toolMix: result.toolMix,
      };

      db.run(
        `INSERT OR REPLACE INTO direction_windows (window_size, window_end, direction_density, event_count, tool_mix)
         VALUES (?, ?, ?, ?, ?)`,
        [label, now, result.directionDensity, result.eventCount, JSON.stringify(result.toolMix)],
      );

      pruneOldWindows(db, label);
      results.push(windowResult);
    } catch (err) {
      logger.debug("Window computation failed", {
        window: label,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

function computeWindow(
  db: DbLike,
  hours: number,
  now: string,
): { directionDensity: number; eventCount: number; toolMix: Record<string, number> } {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const countResult = db.exec(
    `SELECT COUNT(*) FROM events WHERE ts >= '${cutoff}' AND ts <= '${now}'`,
  );
  const eventCount = (countResult[0]?.values[0]?.[0] as number) ?? 0;

  if (eventCount === 0) {
    return { directionDensity: 0, eventCount: 0, toolMix: {} };
  }

  const directionResult = db.exec(
    `SELECT AVG(
       CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL)
     )
     FROM events
     WHERE ts >= '${cutoff}' AND ts <= '${now}'
       AND source IN ('ai-session', 'mcp-active')
       AND json_extract(metadata, '$.direction_signals.human_direction_score') IS NOT NULL`,
  );
  const avgDirection = (directionResult[0]?.values[0]?.[0] as number) ?? 0;
  const directionDensity = Math.round(avgDirection * 100);

  const toolResult = db.exec(
    `SELECT json_extract(metadata, '$.ai_tool') as tool, COUNT(*) as cnt
     FROM events
     WHERE ts >= '${cutoff}' AND ts <= '${now}'
       AND source IN ('ai-session', 'mcp-active')
       AND json_extract(metadata, '$.ai_tool') IS NOT NULL
     GROUP BY tool`,
  );

  const toolMix: Record<string, number> = {};
  if (toolResult[0]) {
    for (const row of toolResult[0].values) {
      const toolName = (row[0] as string) ?? "unknown";
      const count = (row[1] as number) ?? 0;
      toolMix[toolName] = count;
    }
  }

  return { directionDensity, eventCount, toolMix };
}

function pruneOldWindows(db: DbLike, windowSize: string): void {
  try {
    db.run(
      `DELETE FROM direction_windows
       WHERE window_size = '${windowSize}'
         AND window_end NOT IN (
           SELECT window_end FROM direction_windows
           WHERE window_size = '${windowSize}'
           ORDER BY window_end DESC
           LIMIT ${MAX_HISTORICAL_PER_WINDOW}
         )`,
    );
  } catch {
    // non-critical: pruning failure just means slightly more rows
  }
}

/**
 * Get the latest window result for a given size directly from the DB.
 */
export function getLatestWindow(db: DbLike, windowSize: string): WindowResult | null {
  try {
    const result = db.exec(
      `SELECT window_size, window_end, direction_density, event_count, tool_mix
       FROM direction_windows
       WHERE window_size = '${windowSize}'
       ORDER BY window_end DESC LIMIT 1`,
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      windowSize: row[0] as string,
      windowEnd: row[1] as string,
      directionDensity: row[2] as number,
      eventCount: row[3] as number,
      toolMix: JSON.parse((row[4] as string) || "{}"),
    };
  } catch {
    return null;
  }
}

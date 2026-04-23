// FILE: src/services/intelligence/window-aggregator.ts
// Rolling window aggregator — incremental: maintains per-window state.
// On new events, updates affected window buckets. Full recompute only on initialize.

import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";
import type { AnalyzerContext } from "./analyzers/index.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "./incremental-state.js";

const WINDOW_SIZES = [
  { label: "1h", hours: 1 },
  { label: "8h", hours: 8 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
] as const;

export interface WindowResult {
  windowSize: string;
  windowEnd: string;
  directionDensity: number;
  eventCount: number;
  toolMix: Record<string, number>;
}

interface WindowState {
  windows: Record<string, WindowResult>;
}

async function computeAllWindows(db: DbLike): Promise<WindowState> {
  const now = new Date().toISOString();
  const windows: Record<string, WindowResult> = {};

  for (const { label, hours } of WINDOW_SIZES) {
    try {
      const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

      const countResult = await db.exec(
        `SELECT COUNT(*) FROM events WHERE ts >= $1::TIMESTAMP AND ts <= $2::TIMESTAMP`,
        [cutoff, now],
      );
      const eventCount = (countResult[0]?.values[0]?.[0] as number) ?? 0;
      if (eventCount === 0) {
        windows[label] = {
          windowSize: label,
          windowEnd: now,
          directionDensity: 0,
          eventCount: 0,
          toolMix: {},
        };
        continue;
      }

      const dirResult = await db.exec(
        `SELECT AVG(human_direction_score) FROM events
         WHERE ts >= $1::TIMESTAMP AND ts <= $2::TIMESTAMP
           AND source IN ('ai-session', 'mcp-active') AND human_direction_score IS NOT NULL`,
        [cutoff, now],
      );
      const directionDensity = Math.round(((dirResult[0]?.values[0]?.[0] as number) ?? 0) * 100);

      const toolResult = await db.exec(
        `SELECT ai_tool as tool, COUNT(*) as cnt FROM events
         WHERE ts >= $1::TIMESTAMP AND ts <= $2::TIMESTAMP
           AND source IN ('ai-session', 'mcp-active') AND ai_tool IS NOT NULL
         GROUP BY tool`,
        [cutoff, now],
      );
      const toolMix: Record<string, number> = {};
      if (toolResult[0]) {
        for (const row of toolResult[0].values) {
          toolMix[(row[0] as string) ?? "unknown"] = (row[1] as number) ?? 0;
        }
      }

      windows[label] = { windowSize: label, windowEnd: now, directionDensity, eventCount, toolMix };
    } catch (err) {
      logger.debug("Window computation failed", {
        window: label,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { windows };
}

function syncToDb(db: DbLike, state: WindowState): void {
  for (const [, w] of Object.entries(state.windows)) {
    try {
      db.run(
        `INSERT OR REPLACE INTO direction_windows (window_size, window_end, project_id, direction_density, event_count, tool_mix)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          w.windowSize,
          w.windowEnd,
          "",
          w.directionDensity,
          w.eventCount,
          JSON.stringify(w.toolMix),
        ],
      );
    } catch {
      // non-fatal
    }
  }
}

export const windowAggregatorAnalyzer: IncrementalAnalyzer<WindowState, WindowResult[]> = {
  name: "window-aggregator",
  outputFile: "direction-windows.json",
  eventFilter: { sources: ["ai-session", "mcp-active", "git"] },
  minDataPoints: 1,

  async initialize(ctx): Promise<IncrementalState<WindowState>> {
    const value = await computeAllWindows(ctx.analytics);
    syncToDb(ctx.analytics, value);
    return { value, watermark: "", eventCount: 0, updatedAt: new Date().toISOString() };
  },

  async update(state, batch, ctx): Promise<UpdateResult<WindowState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const value = await computeAllWindows(ctx.analytics);
    syncToDb(ctx.analytics, value);

    const prev24 = state.value.windows["24h"]?.directionDensity ?? 0;
    const curr24 = value.windows["24h"]?.directionDensity ?? 0;
    const changed = Math.abs(curr24 - prev24) >= 1;

    return {
      state: {
        value,
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: Math.abs(curr24 - prev24) / 100,
    };
  },

  derive(state): WindowResult[] {
    return Object.values(state.value.windows);
  },
};

export async function getLatestWindow(
  db: DbLike,
  windowSize: string,
): Promise<WindowResult | null> {
  try {
    const result = await db.exec(
      `SELECT window_size, window_end, direction_density, event_count, tool_mix
       FROM direction_windows WHERE window_size = $1 ORDER BY window_end DESC LIMIT 1`,
      [windowSize],
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

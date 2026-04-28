// FILE: src/services/intelligence/analyzers/velocity-tracker.ts
// UF-108: Reasoning Velocity Tracker — measures turns-to-acceptance per domain over time.
// Detects statistically significant trends using the trend utility.

import type { DomainVelocity, Velocity } from "../../../schemas/intelligence/velocity.js";
import { logger } from "../../../utils/logger.js";
import { getWorkerPool } from "../../workers/pool.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import { detectTrend } from "../utils/trend.js";
import type { AnalyzerContext } from "./index.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface VelocityState {
  output: Velocity;
}

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

async function _collectSourceEventIds(db: AnalyzerContext["analytics"]): Promise<string[]> {
  try {
    const result = await db.exec(`
      SELECT id FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND turn_count IS NOT NULL
      ORDER BY ts DESC
      LIMIT 20
    `);
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => row[0] as string);
  } catch {
    return [];
  }
}

async function computeDomainTurns(
  db: AnalyzerContext["analytics"],
): Promise<Map<string, number[]>> {
  try {
    const result = await db.exec(`
      SELECT
        content_summary,
        turn_count as turns,
        ts::DATE as date
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND turn_count IS NOT NULL
      ORDER BY ts
    `);

    if (!result[0]?.values.length) return new Map();

    // Offload CPU-heavy row classification to worker thread
    const rows = result[0].values.map((row) => ({
      contentSummary: (row[0] as string) ?? "",
      turns: Number(row[1] ?? 0),
      date: (row[2] as string) ?? "",
    }));

    const domainWeeklyAverages = await getWorkerPool().classifyVelocityRows(rows);
    const output = new Map<string, number[]>();
    for (const [domain, averages] of Object.entries(domainWeeklyAverages)) {
      output.set(domain, averages);
    }
    return output;
  } catch {
    return new Map();
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Full computation — assembles domain velocity data into a Velocity output
// ---------------------------------------------------------------------------

async function computeVelocity(db: AnalyzerContext["analytics"]): Promise<Velocity> {
  const now = new Date().toISOString();

  const domainTurns = await computeDomainTurns(db);
  const byDomain: Record<string, DomainVelocity> = {};
  const allCurrentTurns: number[] = [];
  const allPreviousTurns: number[] = [];
  let totalDataPoints = 0;

  for (const [domain, weeks] of domainTurns) {
    if (weeks.length < 2) continue;

    const mid = Math.floor(weeks.length / 2);
    const recent = weeks.slice(mid);
    const older = weeks.slice(0, mid);

    const currentAvg = mean(recent);
    const previousAvg = mean(older);
    const change =
      previousAvg > 0 ? Math.round(((currentAvg - previousAvg) / previousAvg) * 100) : 0;

    const trendResult = detectTrend(weeks);

    byDomain[domain] = {
      currentTurnsToAcceptance: Math.round(currentAvg * 10) / 10,
      previousTurnsToAcceptance: Math.round(previousAvg * 10) / 10,
      velocityChange: change,
      dataPoints: weeks.length,
      trend: trendResult?.direction ?? "stable",
    };

    allCurrentTurns.push(currentAvg);
    allPreviousTurns.push(previousAvg);
    totalDataPoints += weeks.length;
  }

  const overallCurrent = mean(allCurrentTurns);
  const overallPrevious = mean(allPreviousTurns);
  const overallChange =
    overallPrevious > 0 ? ((overallCurrent - overallPrevious) / overallPrevious) * 100 : 0;

  let overallTrend: "accelerating" | "stable" | "decelerating" = "stable";
  if (overallChange < -10) overallTrend = "accelerating";
  else if (overallChange > 10) overallTrend = "decelerating";

  return {
    byDomain,
    overallTrend,
    overallMagnitude: Math.round(overallChange),
    dataPoints: totalDataPoints,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const velocityTrackerAnalyzer: IncrementalAnalyzer<VelocityState, Velocity> = {
  name: "velocity-tracker",
  outputFile: "velocity.json",
  eventFilter: { sources: ["ai-session", "mcp-active"], requireFields: ["turnCount"] },
  minDataPoints: 10,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<VelocityState>> {
    logger.debug("velocity-tracker: initializing");
    const output = await computeVelocity(ctx.analytics);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: output.dataPoints,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<VelocityState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<VelocityState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const output = await computeVelocity(ctx.analytics);
    const oldMagnitude = state.value.output.overallMagnitude;
    const newMagnitude = output.overallMagnitude;
    const oldTrend = state.value.output.overallTrend;
    const newTrend = output.overallTrend;
    const changed = oldTrend !== newTrend || Math.abs(newMagnitude - oldMagnitude) > 5;

    const newState: IncrementalState<VelocityState> = {
      value: { output },
      watermark: output.updatedAt,
      eventCount: state.eventCount + newEvents.events.length,
      updatedAt: output.updatedAt,
    };

    return {
      state: newState,
      changed,
      changeMagnitude: Math.abs(newMagnitude - oldMagnitude),
    };
  },

  derive(state: IncrementalState<VelocityState>): Velocity {
    return state.value.output;
  },
};

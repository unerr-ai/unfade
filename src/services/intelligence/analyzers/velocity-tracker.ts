// FILE: src/services/intelligence/analyzers/velocity-tracker.ts
// UF-108: Reasoning Velocity Tracker — measures turns-to-acceptance per domain over time.
// Detects statistically significant trends using the trend utility.

import type { DomainVelocity, Velocity } from "../../../schemas/intelligence/velocity.js";
import { logger } from "../../../utils/logger.js";
import { classifyDomainFast } from "../domain-classifier.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import { detectTrend } from "../utils/trend.js";
import type { AnalyzerContext, AnalyzerResult } from "./index.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface VelocityState {
  output: Velocity;
}

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

async function collectSourceEventIds(db: AnalyzerContext["analytics"]): Promise<string[]> {
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
  const domainWeeks = new Map<string, Map<string, number[]>>();

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

    for (const row of result[0].values) {
      const summary = (row[0] as string) ?? "";
      const turns = (row[1] as number) ?? 0;
      const date = (row[2] as string) ?? "";
      if (turns <= 0 || !date) continue;

      const domain = classifyDomainFast(summary);
      const weekKey = getWeekKey(date);

      if (!domainWeeks.has(domain)) domainWeeks.set(domain, new Map());
      const weeks = domainWeeks.get(domain)!;
      if (!weeks.has(weekKey)) weeks.set(weekKey, []);
      weeks.get(weekKey)!.push(turns);
    }
  } catch {
    return new Map();
  }

  const output = new Map<string, number[]>();
  for (const [domain, weeks] of domainWeeks) {
    const weeklyAverages: number[] = [];
    const sortedWeeks = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, turns] of sortedWeeks) {
      weeklyAverages.push(mean(turns));
    }
    if (weeklyAverages.length >= 2) {
      output.set(domain, weeklyAverages);
    }
  }

  return output;
}

function getWeekKey(date: string): string {
  const d = new Date(date);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
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

// FILE: src/services/intelligence/analyzers/velocity-tracker.ts
// UF-108: Reasoning Velocity Tracker — measures turns-to-acceptance per domain over time.
// Detects statistically significant trends using the trend utility.

import type { DomainVelocity, Velocity } from "../../../schemas/intelligence/velocity.js";
import { detectTrend } from "../utils/trend.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./index.js";

export const velocityTrackerAnalyzer: Analyzer = {
  name: "velocity-tracker",
  outputFile: "velocity.json",
  minDataPoints: 10,

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const db = ctx.db;
    const now = new Date().toISOString();

    const domainTurns = computeDomainTurns(db);
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

    const velocity: Velocity = {
      byDomain,
      overallTrend,
      overallMagnitude: Math.round(overallChange),
      dataPoints: totalDataPoints,
      updatedAt: now,
    };

    return {
      analyzer: "velocity-tracker",
      updatedAt: now,
      data: velocity as unknown as Record<string, unknown>,
      insightCount: Object.values(byDomain).filter((v) => v.trend !== "stable").length,
    };
  },
};

function computeDomainTurns(db: AnalyzerContext["db"]): Map<string, number[]> {
  const domainWeeks = new Map<string, Map<string, number[]>>();

  try {
    const result = db.exec(`
      SELECT
        content_summary,
        CAST(json_extract(metadata, '$.turn_count') AS INTEGER) as turns,
        substr(ts, 1, 10) as date
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.turn_count') IS NOT NULL
      ORDER BY ts
    `);

    if (!result[0]?.values.length) return new Map();

    for (const row of result[0].values) {
      const summary = (row[0] as string) ?? "";
      const turns = (row[1] as number) ?? 0;
      const date = (row[2] as string) ?? "";
      if (turns <= 0 || !date) continue;

      const domain = classifyDomain(summary);
      const weekKey = getWeekKey(date);

      if (!domainWeeks.has(domain)) domainWeeks.set(domain, new Map());
      const weeks = domainWeeks.get(domain)!;
      if (!weeks.has(weekKey)) weeks.set(weekKey, []);
      weeks.get(weekKey)!.push(turns);
    }
  } catch {
    return new Map();
  }

  const result = new Map<string, number[]>();
  for (const [domain, weeks] of domainWeeks) {
    const weeklyAverages: number[] = [];
    const sortedWeeks = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, turns] of sortedWeeks) {
      weeklyAverages.push(mean(turns));
    }
    if (weeklyAverages.length >= 2) {
      result.set(domain, weeklyAverages);
    }
  }

  return result;
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

function classifyDomain(text: string): string {
  const lower = text.toLowerCase();
  if (/api|endpoint|route|handler/.test(lower)) return "api";
  if (/auth|login|session/.test(lower)) return "auth";
  if (/database|sql|query/.test(lower)) return "database";
  if (/test|spec|mock/.test(lower)) return "testing";
  if (/deploy|docker|ci/.test(lower)) return "infra";
  if (/css|style|layout/.test(lower)) return "css";
  return "general";
}

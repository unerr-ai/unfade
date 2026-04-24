// FILE: src/services/intelligence/cost-quality.ts
// UF-239: Cost-per-reasoning-quality — the metric no token counter provides.
// cost_per_directed_decision = daily_spend / directed_decision_count
// Trend: compare current vs 7d trailing average.

import { localToday } from "../../utils/date.js";
import type { DbLike } from "../cache/manager.js";
import { readTodaySpend, readTrailingSpend } from "./token-proxy.js";

export interface CostQualityResult {
  costPerDirectedDecision: number | null;
  trailingAverage: number | null;
  trend: "improving" | "stable" | "declining" | null;
  todaySpend: number;
  todayDirectedDecisions: number;
}

/**
 * Compute cost-per-directed-decision for today and 7d trailing average.
 * Returns null values when insufficient data — never divides by zero.
 */
export async function computeCostPerQuality(db: DbLike): Promise<CostQualityResult> {
  const todaySpendData = await readTodaySpend(db);
  const todaySpend = todaySpendData?.totalCost ?? 0;

  const todayDirected = await countDirectedDecisions(db, localToday());
  const costPerDirected =
    todayDirected > 0 && todaySpend > 0
      ? Math.round((todaySpend / todayDirected) * 100) / 100
      : null;

  const trailing = await readTrailingSpend(db, 7);
  let trailingAvg: number | null = null;
  if (trailing.length >= 2) {
    let totalCost = 0;
    let totalDirected = 0;
    for (const day of trailing) {
      totalCost += day.totalCost;
      const dd = await countDirectedDecisions(db, day.date);
      totalDirected += dd;
    }
    if (totalDirected > 0 && totalCost > 0) {
      trailingAvg = Math.round((totalCost / totalDirected) * 100) / 100;
    }
  }

  let trend: CostQualityResult["trend"] = null;
  if (costPerDirected !== null && trailingAvg !== null) {
    const ratio = costPerDirected / trailingAvg;
    if (ratio < 0.85) trend = "improving";
    else if (ratio > 1.15) trend = "declining";
    else trend = "stable";
  }

  return {
    costPerDirectedDecision: costPerDirected,
    trailingAverage: trailingAvg,
    trend,
    todaySpend,
    todayDirectedDecisions: todayDirected,
  };
}

async function countDirectedDecisions(db: DbLike, date: string): Promise<number> {
  try {
    const result = await db.exec(
      `SELECT COUNT(*) FROM events
       WHERE ts::DATE = $1::DATE
         AND source IN ('ai-session', 'mcp-active')
         AND human_direction_score >= 0.5`,
      [date],
    );
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  } catch {
    return 0;
  }
}

// FILE: src/services/intelligence/cost-quality.ts
// UF-239: Cost-per-reasoning-quality — the metric no token counter provides.
// cost_per_directed_decision = daily_spend / directed_decision_count
// Trend: compare current vs 7d trailing average.

import { readTodaySpend, readTrailingSpend } from "./token-proxy.js";

type DbLike = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
};

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
export function computeCostPerQuality(db: DbLike): CostQualityResult {
  const todaySpendData = readTodaySpend(db);
  const todaySpend = todaySpendData?.totalCost ?? 0;

  const todayDirected = countDirectedDecisions(db, new Date().toISOString().slice(0, 10));
  const costPerDirected =
    todayDirected > 0 && todaySpend > 0
      ? Math.round((todaySpend / todayDirected) * 100) / 100
      : null;

  const trailing = readTrailingSpend(db, 7);
  let trailingAvg: number | null = null;
  if (trailing.length >= 2) {
    let totalCost = 0;
    let totalDirected = 0;
    for (const day of trailing) {
      totalCost += day.totalCost;
      const dd = countDirectedDecisions(db, day.date);
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

function countDirectedDecisions(db: DbLike, date: string): number {
  try {
    const result = db.exec(`
      SELECT COUNT(*) FROM events
      WHERE substr(ts, 1, 10) = '${date}'
        AND source IN ('ai-session', 'mcp-active')
        AND CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL) >= 0.5
    `);
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  } catch {
    return 0;
  }
}

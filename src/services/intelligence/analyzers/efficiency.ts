// FILE: src/services/intelligence/analyzers/efficiency.ts
// UF-101: AI Efficiency Score (AES) — composite 0-100 metric.
// AES = Direction(30%) + TokenEfficiency(20%) + IterationRatio(20%) + ContextLeverage(15%) + ModificationDepth(15%)

import type { Efficiency, EfficiencySubMetric } from "../../../schemas/intelligence/efficiency.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./index.js";

const WEIGHTS = {
  directionDensity: 0.3,
  tokenEfficiency: 0.2,
  iterationRatio: 0.2,
  contextLeverage: 0.15,
  modificationDepth: 0.15,
} as const;

export const efficiencyAnalyzer: Analyzer = {
  name: "efficiency",
  outputFile: "efficiency.json",
  minDataPoints: 5,

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const db = ctx.db;
    const now = new Date().toISOString();

    const direction = computeDirectionDensity(db);
    const tokenEff = computeTokenEfficiency(db);
    const iteration = computeIterationRatio(db);
    const context = computeContextLeverage(db);
    const modification = computeModificationDepth(db);

    // 12C.14: Execution phase normalization — planning sessions weighted 1.5×, debug 0.7×
    const phaseMultiplier = computePhaseMultiplier(db);

    // 12C.14: Outcome-adjusted scoring — penalize sessions with outcome=failure
    const outcomeAdjustment = computeOutcomeAdjustment(db);

    const rawAes =
      direction.value * WEIGHTS.directionDensity +
      tokenEff.value * WEIGHTS.tokenEfficiency +
      iteration.value * WEIGHTS.iterationRatio +
      context.value * WEIGHTS.contextLeverage +
      modification.value * WEIGHTS.modificationDepth;

    const aes = Math.round(Math.min(100, Math.max(0, rawAes * phaseMultiplier * outcomeAdjustment)));

    const minConfidence = [direction, tokenEff, iteration, context, modification].reduce(
      (min, m) => {
        const order = { high: 2, medium: 1, low: 0 };
        return order[m.confidence] < order[min.confidence] ? m : min;
      },
    );

    const history = computeHistory(db);
    const trend = computeTrend(history);
    const topInsight = generateInsight(aes, direction, tokenEff, iteration, context, modification);

    const efficiency: Efficiency = {
      aes,
      confidence: minConfidence.confidence,
      subMetrics: {
        directionDensity: direction,
        tokenEfficiency: tokenEff,
        iterationRatio: iteration,
        contextLeverage: context,
        modificationDepth: modification,
      },
      trend,
      history,
      topInsight,
      updatedAt: now,
      period: "24h",
    };

    const sourceEventIds = collectSourceEventIds(db);

    return {
      analyzer: "efficiency",
      updatedAt: now,
      data: efficiency as unknown as Record<string, unknown>,
      insightCount: topInsight ? 1 : 0,
      sourceEventIds,
    };
  },
};

function collectSourceEventIds(db: AnalyzerContext["db"]): string[] {
  try {
    const result = db.exec(`
      SELECT id FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= datetime('now', '-24 hours')
      ORDER BY ts DESC
      LIMIT 20
    `);
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => row[0] as string);
  } catch {
    return [];
  }
}

function computeDirectionDensity(db: AnalyzerContext["db"]): EfficiencySubMetric {
  try {
    const result = db.exec(`
      SELECT
        AVG(CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL)) as avg_hds,
        COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.direction_signals.human_direction_score') IS NOT NULL
        AND ts >= datetime('now', '-24 hours')
    `);
    const avg = (result[0]?.values[0]?.[0] as number) ?? 0;
    const cnt = (result[0]?.values[0]?.[1] as number) ?? 0;
    return {
      value: Math.round(avg * 100),
      weight: WEIGHTS.directionDensity,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
    };
  } catch {
    return { value: 50, weight: WEIGHTS.directionDensity, confidence: "low", dataPoints: 0 };
  }
}

function computeTokenEfficiency(db: AnalyzerContext["db"]): EfficiencySubMetric {
  try {
    const result = db.exec(`
      SELECT COUNT(*) as total_events,
             SUM(CASE WHEN CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL) >= 0.5 THEN 1 ELSE 0 END) as directed
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= datetime('now', '-24 hours')
    `);
    const total = (result[0]?.values[0]?.[0] as number) ?? 0;
    const directed = (result[0]?.values[0]?.[1] as number) ?? 0;
    if (total === 0)
      return { value: 50, weight: WEIGHTS.tokenEfficiency, confidence: "low", dataPoints: 0 };

    const ratio = directed / total;
    return {
      value: Math.round(ratio * 100),
      weight: WEIGHTS.tokenEfficiency,
      confidence: total >= 10 ? "high" : total >= 5 ? "medium" : "low",
      dataPoints: total,
    };
  } catch {
    return { value: 50, weight: WEIGHTS.tokenEfficiency, confidence: "low", dataPoints: 0 };
  }
}

function computeIterationRatio(db: AnalyzerContext["db"]): EfficiencySubMetric {
  try {
    const result = db.exec(`
      SELECT AVG(CAST(json_extract(metadata, '$.turn_count') AS INTEGER)) as avg_turns,
             COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.turn_count') IS NOT NULL
        AND ts >= datetime('now', '-24 hours')
    `);
    const avgTurns = (result[0]?.values[0]?.[0] as number) ?? 5;
    const cnt = (result[0]?.values[0]?.[1] as number) ?? 0;

    const score = Math.max(0, Math.min(100, Math.round((1 - Math.min(avgTurns, 10) / 10) * 100)));
    return {
      value: score,
      weight: WEIGHTS.iterationRatio,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
    };
  } catch {
    return { value: 50, weight: WEIGHTS.iterationRatio, confidence: "low", dataPoints: 0 };
  }
}

function computeContextLeverage(db: AnalyzerContext["db"]): EfficiencySubMetric {
  try {
    const result = db.exec(`
      SELECT AVG(CAST(json_extract(metadata, '$.direction_signals.prompt_specificity') AS REAL)) as avg_spec,
             COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.direction_signals.prompt_specificity') IS NOT NULL
        AND ts >= datetime('now', '-24 hours')
    `);
    const avg = (result[0]?.values[0]?.[0] as number) ?? 0;
    const cnt = (result[0]?.values[0]?.[1] as number) ?? 0;
    return {
      value: Math.round(avg * 100),
      weight: WEIGHTS.contextLeverage,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
    };
  } catch {
    return { value: 50, weight: WEIGHTS.contextLeverage, confidence: "low", dataPoints: 0 };
  }
}

function computeModificationDepth(db: AnalyzerContext["db"]): EfficiencySubMetric {
  try {
    const result = db.exec(`
      SELECT AVG(score) as avg_score, COUNT(*) as cnt
      FROM comprehension_proxy
    `);
    const avg = (result[0]?.values[0]?.[0] as number) ?? 0;
    const cnt = (result[0]?.values[0]?.[1] as number) ?? 0;
    return {
      value: Math.round(avg * 100),
      weight: WEIGHTS.modificationDepth,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
    };
  } catch {
    return { value: 50, weight: WEIGHTS.modificationDepth, confidence: "low", dataPoints: 0 };
  }
}

function computeHistory(db: AnalyzerContext["db"]): Array<{ date: string; aes: number }> {
  try {
    const result = db.exec(`
      SELECT date, rdi FROM metric_snapshots ORDER BY date DESC LIMIT 30
    `);
    if (!result[0]?.values.length) return [];
    return result[0].values
      .map((row) => ({
        date: row[0] as string,
        aes: row[1] as number,
      }))
      .reverse();
  } catch {
    return [];
  }
}

function computeTrend(
  history: Array<{ aes: number }>,
): "improving" | "stable" | "declining" | null {
  if (history.length < 7) return null;
  const recent = history.slice(-7);
  const older = history.slice(-14, -7);
  if (older.length < 3) return null;

  const recentAvg = recent.reduce((s, h) => s + h.aes, 0) / recent.length;
  const olderAvg = older.reduce((s, h) => s + h.aes, 0) / older.length;

  const diff = recentAvg - olderAvg;
  if (diff > 5) return "improving";
  if (diff < -5) return "declining";
  return "stable";
}

function generateInsight(
  aes: number,
  direction: EfficiencySubMetric,
  tokenEff: EfficiencySubMetric,
  iteration: EfficiencySubMetric,
  context: EfficiencySubMetric,
  modification: EfficiencySubMetric,
): string | null {
  const metrics = [
    { name: "direction density", ...direction },
    { name: "token efficiency", ...tokenEff },
    { name: "iteration ratio", ...iteration },
    { name: "context leverage", ...context },
    { name: "modification depth", ...modification },
  ];

  const weakest = metrics.reduce((min, m) => (m.value < min.value ? m : min));
  const strongest = metrics.reduce((max, m) => (m.value > max.value ? m : max));

  if (weakest.value < 30 && weakest.dataPoints >= 5) {
    return `Your ${weakest.name} is at ${weakest.value}% — this is your biggest efficiency opportunity. Improving it would raise your AES from ${aes} to ~${Math.min(100, aes + Math.round((50 - weakest.value) * weakest.weight))}.`;
  }

  if (strongest.value > 80 && strongest.dataPoints >= 5) {
    return `Your ${strongest.name} is exceptional at ${strongest.value}%. This is a core strength in your AI workflow.`;
  }

  return null;
}

/**
 * 12C.14: Compute phase-weighted multiplier.
 * Planning sessions = 1.5× weight (high-value), debugging = 0.7× (lower signal).
 */
function computePhaseMultiplier(db: AnalyzerContext["db"]): number {
  try {
    const result = db.exec(`
      SELECT
        SUM(CASE WHEN json_extract(metadata, '$.execution_phase') IN ('planning', 'designing') THEN 1 ELSE 0 END) as planning,
        SUM(CASE WHEN json_extract(metadata, '$.execution_phase') IN ('debugging', 'investigating') THEN 1 ELSE 0 END) as debugging,
        COUNT(*) as total
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= datetime('now', '-24 hours')
    `);
    const planning = (result[0]?.values[0]?.[0] as number) ?? 0;
    const debugging = (result[0]?.values[0]?.[1] as number) ?? 0;
    const total = (result[0]?.values[0]?.[2] as number) ?? 0;
    if (total === 0) return 1.0;

    const planningRatio = planning / total;
    const debuggingRatio = debugging / total;
    // Weighted: planning boosts score, debugging dampens it
    return 1.0 + (planningRatio * 0.5) - (debuggingRatio * 0.3);
  } catch {
    return 1.0;
  }
}

/**
 * 12C.14: Outcome-adjusted scoring — sessions with outcome=failure reduce AES.
 */
function computeOutcomeAdjustment(db: AnalyzerContext["db"]): number {
  try {
    const result = db.exec(`
      SELECT
        SUM(CASE WHEN json_extract(metadata, '$.outcome') = 'failure' THEN 1 ELSE 0 END) as failures,
        COUNT(*) as total
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= datetime('now', '-24 hours')
        AND json_extract(metadata, '$.outcome') IS NOT NULL
    `);
    const failures = (result[0]?.values[0]?.[0] as number) ?? 0;
    const total = (result[0]?.values[0]?.[1] as number) ?? 0;
    if (total === 0) return 1.0;

    const failureRatio = failures / total;
    // Up to 20% penalty for high failure rate
    return 1.0 - (failureRatio * 0.2);
  } catch {
    return 1.0;
  }
}

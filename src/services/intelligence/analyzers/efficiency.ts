// FILE: src/services/intelligence/analyzers/efficiency.ts
// UF-101: AI Efficiency Score (AES) — composite 0-100 metric.
// AES = Direction(30%) + TokenEfficiency(20%) + IterationRatio(20%) + ContextLeverage(15%) + ModificationDepth(15%)

import type { Efficiency, EfficiencySubMetric } from "../../../schemas/intelligence/efficiency.js";
import { logger } from "../../../utils/logger.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { AnalyzerContext } from "./index.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface EfficiencyState {
  output: Efficiency;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEIGHTS = {
  directionDensity: 0.3,
  tokenEfficiency: 0.2,
  iterationRatio: 0.2,
  contextLeverage: 0.15,
  modificationDepth: 0.15,
} as const;

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

async function computeDirectionDensity(
  db: AnalyzerContext["analytics"],
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT
        AVG(human_direction_score) as avg_hds,
        COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND human_direction_score IS NOT NULL
        AND ts >= now() - INTERVAL '24 hours'
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

async function computeTokenEfficiency(
  db: AnalyzerContext["analytics"],
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT COUNT(*) as total_events,
             SUM(CASE WHEN human_direction_score >= 0.5 THEN 1 ELSE 0 END) as directed
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '24 hours'
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

async function computeIterationRatio(
  db: AnalyzerContext["analytics"],
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT AVG(turn_count) as avg_turns,
             COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND turn_count IS NOT NULL
        AND ts >= now() - INTERVAL '24 hours'
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

async function computeContextLeverage(
  db: AnalyzerContext["analytics"],
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT AVG(prompt_specificity) as avg_spec,
             COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND prompt_specificity IS NOT NULL
        AND ts >= now() - INTERVAL '24 hours'
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

async function computeModificationDepth(
  db: AnalyzerContext["analytics"],
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
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

async function computePhaseMultiplier(db: AnalyzerContext["analytics"]): Promise<number> {
  try {
    const result = await db.exec(`
      SELECT
        SUM(CASE WHEN execution_phase IN ('planning', 'designing') THEN 1 ELSE 0 END) as planning,
        SUM(CASE WHEN execution_phase IN ('debugging', 'investigating') THEN 1 ELSE 0 END) as debugging,
        COUNT(*) as total
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '24 hours'
    `);
    const planning = (result[0]?.values[0]?.[0] as number) ?? 0;
    const debugging = (result[0]?.values[0]?.[1] as number) ?? 0;
    const total = (result[0]?.values[0]?.[2] as number) ?? 0;
    if (total === 0) return 1.0;

    const planningRatio = planning / total;
    const debuggingRatio = debugging / total;
    return 1.0 + planningRatio * 0.5 - debuggingRatio * 0.3;
  } catch {
    return 1.0;
  }
}

async function computeOutcomeAdjustment(db: AnalyzerContext["analytics"]): Promise<number> {
  try {
    const result = await db.exec(`
      SELECT
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures,
        COUNT(*) as total
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '24 hours'
        AND outcome IS NOT NULL
    `);
    const failures = (result[0]?.values[0]?.[0] as number) ?? 0;
    const total = (result[0]?.values[0]?.[1] as number) ?? 0;
    if (total === 0) return 1.0;

    const failureRatio = failures / total;
    return 1.0 - failureRatio * 0.2;
  } catch {
    return 1.0;
  }
}

async function computeHistory(
  db: AnalyzerContext["analytics"],
): Promise<Array<{ date: string; aes: number }>> {
  try {
    const result = await db.exec(`
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

async function _collectSourceEventIds(db: AnalyzerContext["analytics"]): Promise<string[]> {
  try {
    const result = await db.exec(`
      SELECT id FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '24 hours'
      ORDER BY ts DESC
      LIMIT 20
    `);
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => row[0] as string);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Full computation — assembles all sub-metrics into an Efficiency output
// ---------------------------------------------------------------------------

async function computeEfficiency(db: AnalyzerContext["analytics"]): Promise<Efficiency> {
  const now = new Date().toISOString();

  const direction = await computeDirectionDensity(db);
  const tokenEff = await computeTokenEfficiency(db);
  const iteration = await computeIterationRatio(db);
  const context = await computeContextLeverage(db);
  const modification = await computeModificationDepth(db);

  const phaseMultiplier = await computePhaseMultiplier(db);
  const outcomeAdjustment = await computeOutcomeAdjustment(db);

  const rawAes =
    direction.value * WEIGHTS.directionDensity +
    tokenEff.value * WEIGHTS.tokenEfficiency +
    iteration.value * WEIGHTS.iterationRatio +
    context.value * WEIGHTS.contextLeverage +
    modification.value * WEIGHTS.modificationDepth;

  const aes = Math.round(Math.min(100, Math.max(0, rawAes * phaseMultiplier * outcomeAdjustment)));

  const minConfidence = [direction, tokenEff, iteration, context, modification].reduce((min, m) => {
    const order = { high: 2, medium: 1, low: 0 };
    return order[m.confidence] < order[min.confidence] ? m : min;
  });

  const history = await computeHistory(db);
  const trend = computeTrend(history);
  const topInsight = generateInsight(aes, direction, tokenEff, iteration, context, modification);

  return {
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
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const efficiencyAnalyzer: IncrementalAnalyzer<EfficiencyState, Efficiency> = {
  name: "efficiency",
  outputFile: "efficiency.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 5,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<EfficiencyState>> {
    logger.debug("efficiency: initializing");
    const output = await computeEfficiency(ctx.analytics);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: output.subMetrics.directionDensity.dataPoints,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<EfficiencyState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<EfficiencyState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const output = await computeEfficiency(ctx.analytics);
    const oldAES = state.value.output.aes;
    const newAES = output.aes;
    const changed = Math.abs(newAES - oldAES) > 2;

    const newState: IncrementalState<EfficiencyState> = {
      value: { output },
      watermark: output.updatedAt,
      eventCount: state.eventCount + newEvents.events.length,
      updatedAt: output.updatedAt,
    };

    return {
      state: newState,
      changed,
      changeMagnitude: Math.abs(newAES - oldAES),
    };
  },

  derive(state: IncrementalState<EfficiencyState>): Efficiency {
    return state.value.output;
  },

  contributeEntities(state, batch) {
    const contributions: import("../../substrate/substrate-engine.js").EntityContribution[] = [];
    const aes = state.value.output.aes ?? 0;

    for (const evt of batch.events) {
      if (!evt.sessionId || evt.source !== "ai-session") continue;

      contributions.push({
        entityId: `wu-${evt.sessionId}`,
        entityType: "work-unit",
        projectId: evt.projectId,
        analyzerName: "efficiency",
        stateFragment: { aes, efficiency: aes },
        relationships: [],
      });
    }

    return contributions;
  },
};

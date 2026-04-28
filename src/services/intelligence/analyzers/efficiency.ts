// KGI-6 + IP-3.1: AI Efficiency Score (AES) — composite 0-100 metric with
// knowledge-grounded comprehension efficiency dimension.
//
// AES = Direction(27%) + TokenEfficiency(18%) + IterationRatio(18%) +
//       ContextLeverage(13.5%) + ModificationDepth(13.5%) + ComprehensionEfficiency(10%)
//
// When knowledge data is unavailable, ComprehensionEfficiency has weight=0 and
// the original 5 sub-metrics retain their full proportions (30/20/20/15/15).
//
// IP-3.1 enrichment: _meta freshness block, diagnostics[], per-sub-metric evidenceEventIds.

import type { AnalyzerOutputMeta, DiagnosticMessage } from "../../../schemas/intelligence-presentation.js";
import type { Efficiency, EfficiencySubMetric } from "../../../schemas/intelligence/efficiency.js";
import { logger } from "../../../utils/logger.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { AnalyzerContext } from "./index.js";

// ─── Weights ────────────────────────────────────────────────────────────────

const BASE_WEIGHTS = {
  directionDensity: 0.3,
  tokenEfficiency: 0.2,
  iterationRatio: 0.2,
  contextLeverage: 0.15,
  modificationDepth: 0.15,
} as const;

const KNOWLEDGE_WEIGHTS = {
  directionDensity: 0.27,
  tokenEfficiency: 0.18,
  iterationRatio: 0.18,
  contextLeverage: 0.135,
  modificationDepth: 0.135,
  comprehensionEfficiency: 0.10,
} as const;

// ─── State ──────────────────────────────────────────────────────────────────

interface EfficiencyState {
  output: Efficiency;
}

// ─── Event ID Collection ────────────────────────────────────────────────────

async function collectEventIds(
  db: AnalyzerContext["analytics"],
  whereClause: string,
): Promise<string[]> {
  try {
    const result = await db.exec(
      `SELECT id FROM events WHERE ${whereClause}`,
    );
    const rows = result[0]?.values ?? [];
    return rows.map((r) => String(r[0]));
  } catch {
    return [];
  }
}

// ─── Sub-Metric Computations ────────────────────────────────────────────────

async function computeDirectionDensity(
  db: AnalyzerContext["analytics"],
  w: number,
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT AVG(human_direction_score) as avg_hds, COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND human_direction_score IS NOT NULL
        AND ts >= now() - INTERVAL '24 hours'`);
    const avg = Number(result[0]?.values[0]?.[0] ?? 0);
    const cnt = Number(result[0]?.values[0]?.[1] ?? 0);

    const eventIds = await collectEventIds(
      db,
      "source IN ('ai-session', 'mcp-active') AND human_direction_score IS NOT NULL AND ts >= now() - INTERVAL '24 hours'",
    );

    return {
      value: Math.round(avg * 100),
      weight: w,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
      evidenceEventIds: eventIds,
    };
  } catch {
    return { value: 50, weight: w, confidence: "low", dataPoints: 0, evidenceEventIds: [] };
  }
}

async function computeTokenEfficiency(
  db: AnalyzerContext["analytics"],
  w: number,
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN human_direction_score >= 0.5 THEN 1 ELSE 0 END) as directed
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '24 hours'`);
    const total = Number(result[0]?.values[0]?.[0] ?? 0);
    const directed = Number(result[0]?.values[0]?.[1] ?? 0);

    const eventIds = await collectEventIds(
      db,
      "source IN ('ai-session', 'mcp-active') AND ts >= now() - INTERVAL '24 hours'",
    );

    if (total === 0) return { value: 50, weight: w, confidence: "low", dataPoints: 0, evidenceEventIds: [] };
    const ratio = directed / total;
    return {
      value: Math.round(ratio * 100),
      weight: w,
      confidence: total >= 10 ? "high" : total >= 5 ? "medium" : "low",
      dataPoints: total,
      evidenceEventIds: eventIds,
    };
  } catch {
    return { value: 50, weight: w, confidence: "low", dataPoints: 0, evidenceEventIds: [] };
  }
}

async function computeIterationRatio(
  db: AnalyzerContext["analytics"],
  w: number,
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT AVG(turn_count) as avg_turns, COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND turn_count IS NOT NULL
        AND ts >= now() - INTERVAL '24 hours'`);
    const avgTurns = Number(result[0]?.values[0]?.[0] ?? 5);
    const cnt = Number(result[0]?.values[0]?.[1] ?? 0);
    const score = Math.max(0, Math.min(100, Math.round((1 - Math.min(avgTurns, 10) / 10) * 100)));

    const eventIds = await collectEventIds(
      db,
      "source IN ('ai-session', 'mcp-active') AND turn_count IS NOT NULL AND ts >= now() - INTERVAL '24 hours'",
    );

    return {
      value: score,
      weight: w,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
      evidenceEventIds: eventIds,
    };
  } catch {
    return { value: 50, weight: w, confidence: "low", dataPoints: 0, evidenceEventIds: [] };
  }
}

async function computeContextLeverage(
  db: AnalyzerContext["analytics"],
  w: number,
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT AVG(prompt_specificity) as avg_spec, COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND prompt_specificity IS NOT NULL
        AND ts >= now() - INTERVAL '24 hours'`);
    const avg = Number(result[0]?.values[0]?.[0] ?? 0);
    const cnt = Number(result[0]?.values[0]?.[1] ?? 0);

    const eventIds = await collectEventIds(
      db,
      "source IN ('ai-session', 'mcp-active') AND prompt_specificity IS NOT NULL AND ts >= now() - INTERVAL '24 hours'",
    );

    return {
      value: Math.round(avg * 100),
      weight: w,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
      evidenceEventIds: eventIds,
    };
  } catch {
    return { value: 50, weight: w, confidence: "low", dataPoints: 0, evidenceEventIds: [] };
  }
}

async function computeModificationDepth(
  db: AnalyzerContext["analytics"],
  w: number,
): Promise<EfficiencySubMetric> {
  try {
    const result = await db.exec(`
      SELECT AVG(overall_score) as avg_score, COUNT(*) as cnt
      FROM comprehension_assessment`);
    const avg = Number(result[0]?.values[0]?.[0] ?? 0);
    const cnt = Number(result[0]?.values[0]?.[1] ?? 0);

    let eventIds: string[] = [];
    try {
      const idResult = await db.exec(
        "SELECT DISTINCT episode_id FROM comprehension_assessment",
      );
      eventIds = (idResult[0]?.values ?? []).map((r) => String(r[0]));
    } catch { /* table may not exist */ }

    return {
      value: Math.round(avg * 100),
      weight: w,
      confidence: cnt >= 10 ? "high" : cnt >= 5 ? "medium" : "low",
      dataPoints: cnt,
      evidenceEventIds: eventIds,
    };
  } catch {
    return { value: 50, weight: w, confidence: "low", dataPoints: 0, evidenceEventIds: [] };
  }
}

async function computeComprehensionEfficiency(
  ctx: AnalyzerContext,
  w: number,
): Promise<EfficiencySubMetric | null> {
  if (!ctx.knowledge) return null;

  try {
    const hasData = await ctx.knowledge.hasKnowledgeData();
    if (!hasData) return null;

    const windowStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const assessments = await ctx.knowledge.getComprehension({ since: windowStart });

    if (assessments.length < 2) {
      return {
        value: 50,
        weight: w,
        confidence: "low",
        dataPoints: assessments.length,
        evidenceEventIds: assessments.map((a) => a.episodeId),
      };
    }

    const sorted = [...assessments].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const earliest = sorted[0].overallScore;
    const latest = sorted[sorted.length - 1].overallScore;

    const delta = latest - earliest;
    const normalizedDelta = Math.max(0, Math.min(100, 50 + delta));

    return {
      value: Math.round(normalizedDelta),
      weight: w,
      confidence: assessments.length >= 5 ? "high" : assessments.length >= 3 ? "medium" : "low",
      dataPoints: assessments.length,
      evidenceEventIds: assessments.map((a) => a.episodeId),
    };
  } catch {
    return null;
  }
}

// ─── Adjustments ────────────────────────────────────────────────────────────

async function computePhaseMultiplier(db: AnalyzerContext["analytics"]): Promise<number> {
  try {
    const result = await db.exec(`
      SELECT
        SUM(CASE WHEN execution_phase IN ('planning', 'designing') THEN 1 ELSE 0 END) as planning,
        SUM(CASE WHEN execution_phase IN ('debugging', 'investigating') THEN 1 ELSE 0 END) as debugging,
        COUNT(*) as total
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '24 hours'`);
    const planning = Number(result[0]?.values[0]?.[0] ?? 0);
    const debugging = Number(result[0]?.values[0]?.[1] ?? 0);
    const total = Number(result[0]?.values[0]?.[2] ?? 0);
    if (total === 0) return 1.0;
    return 1.0 + (planning / total) * 0.5 - (debugging / total) * 0.3;
  } catch {
    return 1.0;
  }
}

async function computeOutcomeAdjustment(db: AnalyzerContext["analytics"]): Promise<number> {
  try {
    const result = await db.exec(`
      SELECT SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures, COUNT(*) as total
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '24 hours'
        AND outcome IS NOT NULL`);
    const failures = Number(result[0]?.values[0]?.[0] ?? 0);
    const total = Number(result[0]?.values[0]?.[1] ?? 0);
    if (total === 0) return 1.0;
    return 1.0 - (failures / total) * 0.2;
  } catch {
    return 1.0;
  }
}

async function computeHistory(db: AnalyzerContext["analytics"]): Promise<Array<{ date: string; aes: number }>> {
  try {
    const result = await db.exec("SELECT date, rdi FROM metric_snapshots ORDER BY date DESC LIMIT 30");
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => ({ date: String(row[0]), aes: Number(row[1] ?? 0) })).reverse();
  } catch {
    return [];
  }
}

function computeTrend(history: Array<{ aes: number }>): "improving" | "stable" | "declining" | null {
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

function generateInsight(aes: number, metrics: Array<{ name: string } & EfficiencySubMetric>): string | null {
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

// ─── Meta + Diagnostics ─────────────────────────────────────────────────────

async function buildMeta(
  db: AnalyzerContext["analytics"],
  totalDataPoints: number,
  confidence: "high" | "medium" | "low",
  updatedAt: string,
): Promise<AnalyzerOutputMeta> {
  let watermark = updatedAt;
  let stalenessMs = 0;

  try {
    const result = await db.exec(
      "SELECT MAX(ts) FROM events WHERE source IN ('ai-session', 'mcp-active')",
    );
    const maxTs = result[0]?.values[0]?.[0] as string | null;
    if (maxTs) {
      watermark = maxTs;
      stalenessMs = Math.max(0, Date.now() - new Date(maxTs).getTime());
    }
  } catch { /* non-fatal */ }

  return { updatedAt, dataPoints: totalDataPoints, confidence, watermark, stalenessMs };
}

function buildDiagnostics(
  aes: number,
  trend: "improving" | "stable" | "declining" | null,
  namedMetrics: Array<{ name: string } & EfficiencySubMetric>,
): DiagnosticMessage[] {
  const diagnostics: DiagnosticMessage[] = [];

  if (trend === "declining") {
    const weakest = namedMetrics.reduce((min, m) => (m.value < min.value ? m : min));
    diagnostics.push({
      severity: "warning",
      message: `AES declining — ${weakest.name} dropped to ${weakest.value}%`,
      evidence: `7-day trend analysis: AES moving downward, ${weakest.name} is the primary drag`,
      actionable: `Focus on improving ${weakest.name} — it has the highest improvement potential at weight ${Math.round(weakest.weight * 100)}%`,
      relatedAnalyzers: ["comprehension-radar", "loop-detector"],
      evidenceEventIds: weakest.evidenceEventIds,
    });
  }

  const criticalMetrics = namedMetrics.filter((m) => m.value < 30 && m.dataPoints >= 5);
  for (const metric of criticalMetrics) {
    diagnostics.push({
      severity: "critical",
      message: `${metric.name} critically low at ${metric.value}% — dragging AES`,
      evidence: `${metric.dataPoints} data points show consistent low ${metric.name}`,
      actionable: `Improving ${metric.name} from ${metric.value}% to 50% would raise AES by ~${Math.round((50 - metric.value) * metric.weight)}`,
      relatedAnalyzers: [],
      evidenceEventIds: metric.evidenceEventIds,
    });
  }

  if (aes >= 80 && trend !== "declining") {
    diagnostics.push({
      severity: "info",
      message: `Strong AES at ${aes}/100 — your AI workflow is highly efficient`,
      evidence: `All sub-metrics above 50%; composite score in top quartile`,
      actionable: "Maintain current workflow patterns; consider sharing your approach with team members",
      relatedAnalyzers: [],
      evidenceEventIds: [],
    });
  }

  return diagnostics;
}

// ─── Full Computation ───────────────────────────────────────────────────────

async function computeEfficiency(ctx: AnalyzerContext): Promise<Efficiency> {
  const now = new Date().toISOString();
  const db = ctx.analytics;

  const comprehension = await computeComprehensionEfficiency(ctx, KNOWLEDGE_WEIGHTS.comprehensionEfficiency);
  const hasComprehension = comprehension !== null;
  const w = hasComprehension ? KNOWLEDGE_WEIGHTS : BASE_WEIGHTS;

  const direction = await computeDirectionDensity(db, w.directionDensity);
  const tokenEff = await computeTokenEfficiency(db, w.tokenEfficiency);
  const iteration = await computeIterationRatio(db, w.iterationRatio);
  const context = await computeContextLeverage(db, w.contextLeverage);
  const modification = await computeModificationDepth(db, w.modificationDepth);

  const phaseMultiplier = await computePhaseMultiplier(db);
  const outcomeAdjustment = await computeOutcomeAdjustment(db);

  let rawAes =
    direction.value * direction.weight +
    tokenEff.value * tokenEff.weight +
    iteration.value * iteration.weight +
    context.value * context.weight +
    modification.value * modification.weight;

  if (hasComprehension) {
    rawAes += comprehension!.value * comprehension!.weight;
  }

  const aes = Math.round(Math.min(100, Math.max(0, rawAes * phaseMultiplier * outcomeAdjustment)));

  const allMetrics = [direction, tokenEff, iteration, context, modification];
  if (hasComprehension) allMetrics.push(comprehension!);

  const minConfidence = allMetrics.reduce((min, m) => {
    const order = { high: 2, medium: 1, low: 0 };
    return order[m.confidence] < order[min.confidence] ? m : min;
  });

  const history = await computeHistory(db);
  const trend = computeTrend(history);

  const namedMetrics = [
    { name: "direction density", ...direction },
    { name: "token efficiency", ...tokenEff },
    { name: "iteration ratio", ...iteration },
    { name: "context leverage", ...context },
    { name: "modification depth", ...modification },
  ];
  if (hasComprehension) {
    namedMetrics.push({ name: "comprehension efficiency", ...comprehension! });
  }

  const topInsight = generateInsight(aes, namedMetrics);
  const totalDataPoints = allMetrics.reduce((s, m) => s + m.dataPoints, 0);
  const _meta = await buildMeta(db, totalDataPoints, minConfidence.confidence, now);
  const diagnostics = buildDiagnostics(aes, trend, namedMetrics);

  return {
    aes,
    confidence: minConfidence.confidence,
    subMetrics: {
      directionDensity: direction,
      tokenEfficiency: tokenEff,
      iterationRatio: iteration,
      contextLeverage: context,
      modificationDepth: modification,
      ...(hasComprehension ? { comprehensionEfficiency: comprehension! } : {}),
    },
    trend,
    history,
    topInsight,
    updatedAt: now,
    period: "24h",
    _meta,
    diagnostics,
  };
}

// ─── IncrementalAnalyzer Export ──────────────────────────────────────────────

export const efficiencyAnalyzer: IncrementalAnalyzer<EfficiencyState, Efficiency> = {
  name: "efficiency",
  outputFile: "efficiency.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 5,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<EfficiencyState>> {
    logger.info("[efficiency] Initializing efficiency analyzer");
    const output = await computeEfficiency(ctx);
    logger.info("[efficiency] Initialized", { aes: output.aes });
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

    const output = await computeEfficiency(ctx);
    const oldAES = state.value.output.aes;
    const newAES = output.aes;
    const changed = Math.abs(newAES - oldAES) > 2;

    return {
      state: {
        value: { output },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
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

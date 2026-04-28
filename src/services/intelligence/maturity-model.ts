// FILE: src/services/intelligence/maturity-model.ts
// Collaboration Maturity Model — deterministic 4-phase assessment aligned with
// the Transmission Thesis (Bare Engine → First Gear → Multi-Gear → Tuned Vehicle).
// Aggregates 7 dimensions from upstream analyzer states. Zero LLM cost.
// Registered as an IncrementalAnalyzer in the DAG scheduler.

import type { AnalyzerContext } from "./analyzers/index.js";
import { diagnosticStream } from "./diagnostic-stream.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";
import { bayesianSmooth, mannKendall } from "./utils/stats.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PhaseLabel = "bare-engine" | "first-gear" | "multi-gear" | "tuned-vehicle";

export interface MaturityAssessment {
  phase: number;
  phaseLabel: PhaseLabel;
  subPhasePosition: number;
  confidence: number;
  dimensions: MaturityDimension[];
  trajectory: MaturityDataPoint[];
  bottlenecks: MaturityBottleneck[];
  nextPhaseRequirements: PhaseRequirement[];
  assessedAt: string;
  projectId: string;
}

export interface MaturityDimension {
  name: string;
  score: number;
  weight: number;
  trend: "improving" | "stable" | "declining";
  explanation: string;
  sources: string[];
}

export interface MaturityDataPoint {
  date: string;
  phase: number;
  confidence: number;
}

export interface MaturityBottleneck {
  dimension: string;
  currentScore: number;
  requiredScore: number;
  description: string;
  impact: number;
}

export interface PhaseRequirement {
  action: string;
  rationale: string;
  targetDimension: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface MaturityModelState {
  currentPhase: number;
  dimensions: MaturityDimension[];
  trajectory: MaturityDataPoint[];
  previousDimensionScores: Record<string, number>;
  scoreHistory: Record<string, number[]>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Dimension definitions
// ---------------------------------------------------------------------------

interface DimensionDef {
  name: string;
  weight: number;
  description: string;
  sources: string[];
  compute: (ctx: AnalyzerContext) => number;
}

const DIMENSION_DEFS: DimensionDef[] = [
  {
    name: "direction",
    weight: 0.2,
    description: "How much you direct vs. accept AI output",
    sources: ["window-aggregator"],
    compute: (ctx) => {
      const ws = ctx.dependencyStates?.get("window-aggregator");
      if (!ws) return 0;
      const windows = (ws.value as { windows?: Record<string, { directionDensity?: number }> })
        ?.windows;
      const density = windows?.["24h"]?.directionDensity ?? 0;
      return normalize(density / 100, 0, 0.8);
    },
  },
  {
    name: "modification-depth",
    weight: 0.15,
    description: "How deeply you engage with AI output before accepting",
    sources: ["comprehension-radar"],
    compute: (ctx) => {
      const cs = ctx.dependencyStates?.get("comprehension-radar");
      if (!cs) return 0.3;
      const overall = (cs.value as { output?: { overall?: number } })?.output?.overall ?? 0;
      return normalize(overall / 100, 0, 1);
    },
  },
  {
    name: "context-leverage",
    weight: 0.2,
    description: "How effectively you reuse prior reasoning across sessions",
    sources: ["prompt-patterns", "decision-replay"],
    compute: (ctx) => {
      const pp = ctx.dependencyStates?.get("prompt-patterns");
      const dr = ctx.dependencyStates?.get("decision-replay");
      const patternCount = pp
        ? ((pp.value as { output?: { totalPromptsAnalyzed?: number } })?.output
            ?.totalPromptsAnalyzed ?? 0)
        : 0;
      const replayCount = dr
        ? ((dr.value as { output?: { replays?: unknown[] } })?.output?.replays?.length ?? 0)
        : 0;
      const patternScore = Math.min(1, patternCount / 100);
      const replayScore = Math.min(1, replayCount / 10);
      return patternScore * 0.6 + replayScore * 0.4;
    },
  },
  {
    name: "prompt-effectiveness",
    weight: 0.15,
    description: "How well your prompting strategies produce quality output",
    sources: ["efficiency"],
    compute: (ctx) => {
      const eff = ctx.dependencyStates?.get("efficiency");
      if (!eff) return 0.3;
      const aes = (eff.value as { output?: { aes?: number } })?.output?.aes ?? 50;
      return normalize(aes / 100, 0, 1);
    },
  },
  {
    name: "domain-consistency",
    weight: 0.1,
    description: "Whether your effectiveness is consistent across feature areas",
    sources: ["velocity-tracker"],
    compute: (ctx) => {
      const vt = ctx.dependencyStates?.get("velocity-tracker");
      if (!vt) return 0.5;
      const byDomain =
        (vt.value as { output?: { byDomain?: Record<string, unknown> } })?.output?.byDomain ?? {};
      const domainCount = Object.keys(byDomain).length;
      return domainCount >= 3 ? 0.7 : domainCount >= 2 ? 0.5 : 0.3;
    },
  },
  {
    name: "loop-resilience",
    weight: 0.1,
    description: "How quickly you recognize and escape unproductive loops",
    sources: ["loop-detector"],
    compute: (ctx) => {
      const ld = ctx.dependencyStates?.get("loop-detector");
      if (!ld) return 0.5;
      const loops = (ld.value as { output?: { stuckLoops?: unknown[] } })?.output?.stuckLoops ?? [];
      const activeLoops = Array.isArray(loops) ? loops.length : 0;
      return Math.max(0, 1 - activeLoops * 0.2);
    },
  },
  {
    name: "decision-durability",
    weight: 0.1,
    description: "How often your AI-assisted decisions stick vs. get revised",
    sources: ["decision-replay"],
    compute: (ctx) => {
      const dr = ctx.dependencyStates?.get("decision-replay");
      if (!dr) return 0.5;
      const replays = (dr.value as { output?: { replays?: unknown[] } })?.output?.replays ?? [];
      const replayCount = Array.isArray(replays) ? replays.length : 0;
      return Math.max(0, 1 - replayCount * 0.1);
    },
  },
];

// ---------------------------------------------------------------------------
// Phase thresholds for bottleneck detection
// ---------------------------------------------------------------------------

const PHASE_THRESHOLDS: Record<number, Record<string, number>> = {
  2: {
    direction: 0.3,
    "modification-depth": 0.25,
    "context-leverage": 0.15,
    "prompt-effectiveness": 0.25,
    "domain-consistency": 0.2,
    "loop-resilience": 0.3,
    "decision-durability": 0.3,
  },
  3: {
    direction: 0.5,
    "modification-depth": 0.4,
    "context-leverage": 0.35,
    "prompt-effectiveness": 0.45,
    "domain-consistency": 0.4,
    "loop-resilience": 0.5,
    "decision-durability": 0.5,
  },
  4: {
    direction: 0.65,
    "modification-depth": 0.55,
    "context-leverage": 0.55,
    "prompt-effectiveness": 0.6,
    "domain-consistency": 0.55,
    "loop-resilience": 0.65,
    "decision-durability": 0.65,
  },
};

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const maturityModelAnalyzer: IncrementalAnalyzer<MaturityModelState, MaturityAssessment> = {
  name: "maturity-model",
  outputFile: "maturity-assessment.json",
  eventFilter: { sources: [], types: [] },
  dependsOn: [
    "window-aggregator",
    "comprehension-radar",
    "efficiency",
    "loop-detector",
    "velocity-tracker",
    "prompt-patterns",
    "decision-replay",
  ],
  minDataPoints: 20,

  async initialize(ctx): Promise<IncrementalState<MaturityModelState>> {
    const dimensions = computeDimensions(ctx, {}, {});
    const phase = computeMaturityPhase(dimensions);
    const scoreHistory: Record<string, number[]> = {};
    for (const d of dimensions) scoreHistory[d.name] = [d.score];
    return {
      value: {
        currentPhase: phase,
        dimensions,
        trajectory: [{ date: new Date().toISOString().slice(0, 10), phase, confidence: 0.3 }],
        previousDimensionScores: Object.fromEntries(dimensions.map((d) => [d.name, d.score])),
        scoreHistory,
        updatedAt: new Date().toISOString(),
      },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<MaturityModelState>> {
    if (batch.events.length === 0 && !hasDependencyChanges(ctx)) {
      return { state, changed: false };
    }

    const dimensions = computeDimensions(
      ctx,
      state.value.previousDimensionScores,
      state.value.scoreHistory,
    );
    const phase = computeMaturityPhase(dimensions);
    const confidence = computeConfidence(state.eventCount + batch.events.length);

    const scoreHistory = { ...state.value.scoreHistory };
    for (const d of dimensions) {
      const hist = scoreHistory[d.name] ?? [];
      hist.push(d.score);
      if (hist.length > 30) hist.splice(0, hist.length - 30);
      scoreHistory[d.name] = hist;
    }

    const today = new Date().toISOString().slice(0, 10);
    const trajectory = [...state.value.trajectory];
    const lastPoint = trajectory[trajectory.length - 1];
    if (!lastPoint || lastPoint.date !== today) {
      trajectory.push({ date: today, phase, confidence });
    } else {
      lastPoint.phase = phase;
      lastPoint.confidence = confidence;
    }

    const cutoff = Date.now() - 90 * 86400 * 1000;
    const trimmedTrajectory = trajectory.filter((p) => new Date(p.date).getTime() > cutoff);

    const prevPhase = state.value.currentPhase;
    if (Math.floor(phase) > Math.floor(prevPhase)) {
      diagnosticStream.emit({
        type: "observation",
        scope: "day",
        analyzer: "maturity-model",
        message: `Phase transition: ${phaseToLabel(prevPhase)} → ${phaseToLabel(phase)} (Phase ${phase.toFixed(1)})`,
        actionable: false,
        confidence,
        relatedEventIds: batch.events.slice(0, 5).map((e) => e.id),
      });
    }

    const changed = Math.abs(phase - prevPhase) > 0.1;

    return {
      state: {
        value: {
          currentPhase: phase,
          dimensions,
          trajectory: trimmedTrajectory,
          previousDimensionScores: Object.fromEntries(dimensions.map((d) => [d.name, d.score])),
          scoreHistory,
          updatedAt: new Date().toISOString(),
        },
        watermark:
          batch.events.length > 0 ? batch.events[batch.events.length - 1].ts : state.watermark,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: Math.abs(phase - prevPhase) / 4,
    };
  },

  derive(state): MaturityAssessment {
    const { currentPhase, dimensions, trajectory } = state.value;
    return {
      phase: currentPhase,
      phaseLabel: phaseToLabel(currentPhase),
      subPhasePosition: currentPhase - Math.floor(currentPhase),
      confidence: computeConfidence(state.eventCount),
      dimensions,
      trajectory,
      bottlenecks: detectBottlenecks(dimensions, currentPhase),
      nextPhaseRequirements: computeNextPhaseRequirements(dimensions, currentPhase),
      assessedAt: state.updatedAt,
      projectId: "",
    };
  },
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function computeDimensions(
  ctx: AnalyzerContext,
  previousScores: Record<string, number>,
  scoreHistory?: Record<string, number[]>,
): MaturityDimension[] {
  const globalAvg = computeGlobalPrior(ctx, previousScores);

  return DIMENSION_DEFS.map((def) => {
    const rawScore = Math.max(0, Math.min(1, def.compute(ctx)));

    const eventCount = estimateDataPointsForDimension(ctx, def.name);
    const smoothed = bayesianSmooth(rawScore, eventCount, globalAvg, 15);
    const score = eventCount >= 20 ? rawScore : smoothed.smoothed;

    const history = scoreHistory?.[def.name] ?? [];
    const trend = detectDimensionTrend(score, history);

    return {
      name: def.name,
      score: Math.round(score * 1000) / 1000,
      weight: def.weight,
      trend,
      explanation: `${def.description} — ${Math.round(score * 100)}%${eventCount < 20 ? " (smoothed: low data)" : ""}`,
      sources: def.sources,
    };
  });
}

function computeGlobalPrior(_ctx: AnalyzerContext, previousScores: Record<string, number>): number {
  const values = Object.values(previousScores);
  if (values.length === 0) return 0.35;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function estimateDataPointsForDimension(ctx: AnalyzerContext, dimName: string): number {
  const depMap: Record<string, string> = {
    direction: "window-aggregator",
    "modification-depth": "comprehension-radar",
    "context-leverage": "prompt-patterns",
    "prompt-effectiveness": "efficiency",
    "domain-consistency": "velocity-tracker",
    "loop-resilience": "loop-detector",
    "decision-durability": "decision-replay",
  };

  const analyzerName = depMap[dimName];
  if (!analyzerName) return 10;

  const state = ctx.dependencyStates?.get(analyzerName);
  if (!state) return 5;
  return Number(state.eventCount ?? 10);
}

function detectDimensionTrend(currentScore: number, history: number[]): MaturityDimension["trend"] {
  const series = [...history, currentScore];

  if (series.length >= 4) {
    const mk = mannKendall(series, 0.1);
    if (mk.significant) {
      return mk.trend === "increasing"
        ? "improving"
        : mk.trend === "decreasing"
          ? "declining"
          : "stable";
    }
  }

  if (series.length >= 2) {
    const prev = series[series.length - 2];
    if (currentScore > prev + 0.05) return "improving";
    if (currentScore < prev - 0.05) return "declining";
  }

  return "stable";
}

function computeMaturityPhase(dimensions: MaturityDimension[]): number {
  const composite = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);

  if (composite < 0.2) return 1.0 + (composite / 0.2) * 0.9;
  if (composite < 0.45) return 2.0 + ((composite - 0.2) / 0.25) * 0.9;
  if (composite < 0.7) return 3.0 + ((composite - 0.45) / 0.25) * 0.9;
  return Math.min(4.0, 3.0 + ((composite - 0.7) / 0.3) * 1.0);
}

function computeConfidence(eventCount: number): number {
  return Math.min(0.95, 0.3 + 0.65 * (1 - Math.exp(-eventCount / 300)));
}

function phaseToLabel(phase: number): PhaseLabel {
  if (phase < 2) return "bare-engine";
  if (phase < 3) return "first-gear";
  if (phase < 4) return "multi-gear";
  return "tuned-vehicle";
}

function detectBottlenecks(
  dimensions: MaturityDimension[],
  currentPhase: number,
): MaturityBottleneck[] {
  const nextPhase = Math.ceil(currentPhase);
  if (nextPhase > 4) return [];
  const thresholds = PHASE_THRESHOLDS[nextPhase];
  if (!thresholds) return [];

  return dimensions
    .filter((d) => d.score < (thresholds[d.name] ?? 0.5))
    .map((d) => ({
      dimension: d.name,
      currentScore: d.score,
      requiredScore: thresholds[d.name] ?? 0.5,
      description: `${d.name} is at ${Math.round(d.score * 100)}% — needs ${Math.round((thresholds[d.name] ?? 0.5) * 100)}% for Phase ${nextPhase}`,
      impact: ((thresholds[d.name] ?? 0.5) - d.score) * d.weight,
    }))
    .sort((a, b) => b.impact - a.impact);
}

function computeNextPhaseRequirements(
  dimensions: MaturityDimension[],
  currentPhase: number,
): PhaseRequirement[] {
  const bottlenecks = detectBottlenecks(dimensions, currentPhase);
  return bottlenecks.slice(0, 3).map((b, i) => ({
    action: `Improve ${b.dimension} from ${Math.round(b.currentScore * 100)}% to ${Math.round(b.requiredScore * 100)}%`,
    rationale: b.description,
    targetDimension: b.dimension,
    priority: i + 1,
  }));
}

function hasDependencyChanges(ctx: AnalyzerContext): boolean {
  return (ctx.dependencyStates?.size ?? 0) > 0;
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

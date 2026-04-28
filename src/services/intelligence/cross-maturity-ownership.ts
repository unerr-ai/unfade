// FILE: src/services/intelligence/cross-maturity-ownership.ts
// Cross-source: fuses maturity dimensions with file expertise.
// Answers: "Is your maturity phase genuine or inflated by AI dependency?"
// A developer at Phase 3 who owns 10% of their files has hollow maturity.
// A developer at Phase 2 who owns 80% has genuine understanding.

import type { AnalyzerContext } from "./analyzers/index.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaturityOwnershipOutput {
  adjustedPhase: number;
  rawPhase: number;
  ownershipScore: number;
  adjustmentFactor: number;
  genuineness: "genuine" | "mixed" | "hollow";
  perDimensionOwnership: Array<{
    dimension: string;
    rawScore: number;
    ownershipWeight: number;
    adjustedScore: number;
  }>;
  riskAreas: Array<{
    module: string;
    maturityClaim: number;
    actualExpertise: number;
    gap: number;
  }>;
  updatedAt: string;
}

interface MaturityOwnershipState {
  output: MaturityOwnershipOutput;
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const maturityOwnershipAnalyzer: IncrementalAnalyzer<
  MaturityOwnershipState,
  MaturityOwnershipOutput
> = {
  name: "maturity-ownership",
  outputFile: "maturity-ownership.json",
  eventFilter: { sources: [] },
  dependsOn: ["maturity-model", "expertise-map"],
  minDataPoints: 15,

  async initialize(ctx): Promise<IncrementalState<MaturityOwnershipState>> {
    const output = computeFromDependencies(ctx);
    return {
      value: { output },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<MaturityOwnershipState>> {
    const output = computeFromDependencies(ctx);
    await enrichComprehensionGenuineness(output, ctx);
    const prevPhase = state.value.output.adjustedPhase;
    const changed = Math.abs(output.adjustedPhase - prevPhase) > 0.1;

    return {
      state: {
        value: { output },
        watermark:
          batch.events.length > 0 ? batch.events[batch.events.length - 1].ts : state.watermark,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: Math.abs(output.adjustedPhase - prevPhase) / 4,
    };
  },

  derive(state): MaturityOwnershipOutput {
    return state.value.output;
  },
};

// ---------------------------------------------------------------------------
// KGI-12.4: Comprehension genuineness enrichment
// ---------------------------------------------------------------------------

async function enrichComprehensionGenuineness(output: MaturityOwnershipOutput, ctx: AnalyzerContext): Promise<void> {
  if (!ctx.knowledge) return;
  try {
    const hasData = await ctx.knowledge.hasKnowledgeData();
    if (!hasData) return;
    const assessments = await ctx.knowledge.getComprehension({});
    if (assessments.length === 0) return;
    const avgComprehension = assessments.reduce((s, a) => s + a.overallScore, 0) / assessments.length;
    const highMaturity = output.rawPhase >= 3;
    const highComprehension = avgComprehension > 50;
    if (highMaturity && highComprehension) output.genuineness = "genuine";
    else if (highMaturity && !highComprehension) output.genuineness = "hollow";
    else output.genuineness = "mixed";
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function computeFromDependencies(ctx: AnalyzerContext): MaturityOwnershipOutput {
  const now = new Date().toISOString();

  const maturityState = ctx.dependencyStates?.get("maturity-model");
  const expertiseState = ctx.dependencyStates?.get("expertise-map");

  const maturity = extractMaturity(maturityState);
  const expertise = extractExpertise(expertiseState);

  const ownershipScore = expertise.overallExpertise;
  const adjustmentFactor = 0.5 + ownershipScore * 0.5;
  const adjustedPhase = Math.round(maturity.phase * adjustmentFactor * 100) / 100;

  let genuineness: MaturityOwnershipOutput["genuineness"];
  if (ownershipScore > 0.6) genuineness = "genuine";
  else if (ownershipScore > 0.3) genuineness = "mixed";
  else genuineness = "hollow";

  const perDimensionOwnership = maturity.dimensions.map((dim) => {
    const ownershipWeight = computeDimensionOwnership(dim.name, expertise);
    const adjustedScore = Math.round(dim.score * (0.5 + ownershipWeight * 0.5) * 1000) / 1000;
    return {
      dimension: dim.name,
      rawScore: dim.score,
      ownershipWeight: Math.round(ownershipWeight * 1000) / 1000,
      adjustedScore,
    };
  });

  const riskAreas = expertise.modules
    .filter((m) => m.aiDependentCount > 0 && m.avgExpertise < 0.3)
    .map((m) => ({
      module: m.module,
      maturityClaim: maturity.phase,
      actualExpertise: m.avgExpertise,
      gap: Math.round((maturity.phase / 4 - m.avgExpertise) * 1000) / 1000,
    }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 10);

  return {
    adjustedPhase,
    rawPhase: maturity.phase,
    ownershipScore: Math.round(ownershipScore * 1000) / 1000,
    adjustmentFactor: Math.round(adjustmentFactor * 1000) / 1000,
    genuineness,
    perDimensionOwnership,
    riskAreas,
    updatedAt: now,
  };
}

function computeDimensionOwnership(
  dimName: string,
  expertise: { overallExpertise: number; aiDependencyRate: number },
): number {
  const base = expertise.overallExpertise;
  const penaltyByDim: Record<string, number> = {
    direction: 0,
    "modification-depth": 0.1,
    "context-leverage": 0,
    "prompt-effectiveness": 0,
    "domain-consistency": 0.15,
    "loop-resilience": 0.1,
    "decision-durability": 0.2,
  };
  const penalty = (penaltyByDim[dimName] ?? 0) * expertise.aiDependencyRate;
  return Math.max(0, Math.min(1, base - penalty));
}

interface MaturityData {
  phase: number;
  dimensions: Array<{ name: string; score: number }>;
}

function extractMaturity(state: IncrementalState<unknown> | undefined): MaturityData {
  if (!state) return { phase: 1, dimensions: [] };
  const val = state.value as {
    currentPhase?: number;
    dimensions?: Array<{ name: string; score: number }>;
  };
  return {
    phase: val?.currentPhase ?? 1,
    dimensions: val?.dimensions ?? [],
  };
}

interface ExpertiseData {
  overallExpertise: number;
  aiDependencyRate: number;
  modules: Array<{ module: string; avgExpertise: number; aiDependentCount: number }>;
}

function extractExpertise(state: IncrementalState<unknown> | undefined): ExpertiseData {
  if (!state) return { overallExpertise: 0.5, aiDependencyRate: 0, modules: [] };
  const val = state.value as {
    output?: {
      overallExpertise?: number;
      aiDependencyRate?: number;
      byModule?: Array<{ module: string; avgExpertise: number; aiDependentCount: number }>;
    };
  };
  return {
    overallExpertise: val?.output?.overallExpertise ?? 0.5,
    aiDependencyRate: val?.output?.aiDependencyRate ?? 0,
    modules: val?.output?.byModule ?? [],
  };
}

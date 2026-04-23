// FILE: src/services/intelligence/cross-efficiency-survival.ts
// Cross-source: fuses AI efficiency (AES from efficiency analyzer) with
// code survival signals (file churn from git, decision durability from replay).
// Answers: "Are your efficient AI sessions producing code that LASTS?"
// High AES + low churn + high durability = truly effective.
// High AES + high churn = fast but fragile.

import type { AnalyzerContext } from "./analyzers/index.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EfficiencySurvivalOutput {
  compositeScore: number;
  components: {
    aiEfficiency: number;
    codeSurvival: number;
    decisionDurability: number;
  };
  interpretation: string;
  quadrant:
    | "effective-durable"
    | "effective-fragile"
    | "inefficient-durable"
    | "inefficient-fragile";
  fileHealthSummary: {
    totalFiles: number;
    highChurnFiles: number;
    stableFiles: number;
    churnToEfficiencyRatio: number;
  };
  updatedAt: string;
}

interface EfficiencySurvivalState {
  output: EfficiencySurvivalOutput;
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const efficiencySurvivalAnalyzer: IncrementalAnalyzer<
  EfficiencySurvivalState,
  EfficiencySurvivalOutput
> = {
  name: "efficiency-survival",
  outputFile: "efficiency-survival.json",
  eventFilter: { sources: [] },
  dependsOn: ["efficiency", "file-churn", "decision-replay"],
  minDataPoints: 10,

  async initialize(ctx): Promise<IncrementalState<EfficiencySurvivalState>> {
    const output = computeFromDependencies(ctx);
    return {
      value: { output },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<EfficiencySurvivalState>> {
    const output = computeFromDependencies(ctx);
    const prevScore = state.value.output.compositeScore;
    const changed = Math.abs(output.compositeScore - prevScore) > 0.02;

    return {
      state: {
        value: { output },
        watermark:
          batch.events.length > 0 ? batch.events[batch.events.length - 1].ts : state.watermark,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: Math.abs(output.compositeScore - prevScore),
    };
  },

  derive(state): EfficiencySurvivalOutput {
    return state.value.output;
  },
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function computeFromDependencies(ctx: AnalyzerContext): EfficiencySurvivalOutput {
  const now = new Date().toISOString();

  const effState = ctx.dependencyStates?.get("efficiency");
  const churnState = ctx.dependencyStates?.get("file-churn");
  const replayState = ctx.dependencyStates?.get("decision-replay");

  const aes = extractAES(effState) / 100;
  const churnData = extractChurn(churnState);
  const durability = extractDurability(replayState);

  const survivalScore = 1 - Math.min(1, churnData.churnRate * 5);
  const compositeScore =
    Math.round((aes * 0.4 + survivalScore * 0.35 + durability * 0.25) * 1000) / 1000;

  const isEfficient = aes > 0.5;
  const isDurable = survivalScore > 0.5 && durability > 0.5;

  let quadrant: EfficiencySurvivalOutput["quadrant"];
  if (isEfficient && isDurable) quadrant = "effective-durable";
  else if (isEfficient && !isDurable) quadrant = "effective-fragile";
  else if (!isEfficient && isDurable) quadrant = "inefficient-durable";
  else quadrant = "inefficient-fragile";

  const interpretations: Record<EfficiencySurvivalOutput["quadrant"], string> = {
    "effective-durable":
      "Your AI-assisted work is both efficient and produces lasting code. This is the target state.",
    "effective-fragile":
      "You work efficiently with AI but the output doesn't survive — high churn and frequent revisions suggest quality issues.",
    "inefficient-durable":
      "Your code survives well but AI efficiency is low — you may be over-iterating to reach good outcomes.",
    "inefficient-fragile":
      "Both efficiency and code survival are low — consider slowing down, adding constraints, and reviewing before committing.",
  };

  return {
    compositeScore,
    components: {
      aiEfficiency: Math.round(aes * 1000) / 1000,
      codeSurvival: Math.round(survivalScore * 1000) / 1000,
      decisionDurability: Math.round(durability * 1000) / 1000,
    },
    interpretation: interpretations[quadrant],
    quadrant,
    fileHealthSummary: {
      totalFiles: churnData.totalFiles,
      highChurnFiles: churnData.hotFileCount,
      stableFiles: Math.max(0, churnData.totalFiles - churnData.hotFileCount),
      churnToEfficiencyRatio: aes > 0 ? Math.round((churnData.churnRate / aes) * 1000) / 1000 : 0,
    },
    updatedAt: now,
  };
}

function extractAES(state: IncrementalState<unknown> | undefined): number {
  if (!state) return 50;
  const val = state.value as { output?: { aes?: number } };
  return val?.output?.aes ?? 50;
}

function extractChurn(state: IncrementalState<unknown> | undefined): {
  churnRate: number;
  totalFiles: number;
  hotFileCount: number;
} {
  if (!state) return { churnRate: 0, totalFiles: 0, hotFileCount: 0 };
  const val = state.value as {
    output?: { avgChurnRate?: number; totalFilesTracked?: number; hotFiles?: unknown[] };
  };
  return {
    churnRate: val?.output?.avgChurnRate ?? 0,
    totalFiles: val?.output?.totalFilesTracked ?? 0,
    hotFileCount: val?.output?.hotFiles?.length ?? 0,
  };
}

function extractDurability(state: IncrementalState<unknown> | undefined): number {
  if (!state) return 0.5;
  const val = state.value as { output?: { replays?: unknown[] } };
  const replayCount = val?.output?.replays?.length ?? 0;
  return Math.max(0, 1 - replayCount * 0.1);
}

// FILE: src/services/intelligence/cross-dual-velocity.ts
// Cross-source: compares AI velocity (prompt patterns, turns-to-resolution)
// with git velocity (commit frequency, AI-to-commit rate).
// Answers: "Is AI speed translating into shipping speed?"
// High AI velocity + low git velocity = lots of talking, little shipping.
// Low AI velocity + high git velocity = independent coding (low AI leverage).

import type { AnalyzerContext } from "./analyzers/index.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DualVelocityOutput {
  aiVelocity: {
    turnsPerSession: number;
    sessionsPerDay: number;
    promptEffectiveness: number;
    normalizedScore: number;
  };
  gitVelocity: {
    commitsPerDay: number;
    filesPerCommit: number;
    aiToCommitRate: number;
    normalizedScore: number;
  };
  velocityRatio: number;
  alignment: "ai-heavy" | "balanced" | "git-heavy" | "both-low";
  translationEfficiency: number;
  interpretation: string;
  updatedAt: string;
}

interface DualVelocityState {
  output: DualVelocityOutput;
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const dualVelocityAnalyzer: IncrementalAnalyzer<DualVelocityState, DualVelocityOutput> = {
  name: "dual-velocity",
  outputFile: "dual-velocity.json",
  eventFilter: { sources: [] },
  dependsOn: ["velocity-tracker", "efficiency", "commit-analyzer", "ai-git-linker"],
  minDataPoints: 10,

  async initialize(ctx): Promise<IncrementalState<DualVelocityState>> {
    const output = computeFromDependencies(ctx);
    return {
      value: { output },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<DualVelocityState>> {
    const output = computeFromDependencies(ctx);
    const prevRatio = state.value.output.velocityRatio;
    const changed = Math.abs(output.velocityRatio - prevRatio) > 0.05;

    return {
      state: {
        value: { output },
        watermark:
          batch.events.length > 0 ? batch.events[batch.events.length - 1].ts : state.watermark,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: Math.abs(output.velocityRatio - prevRatio),
    };
  },

  derive(state): DualVelocityOutput {
    return state.value.output;
  },
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function computeFromDependencies(ctx: AnalyzerContext): DualVelocityOutput {
  const now = new Date().toISOString();

  const velocityState = ctx.dependencyStates?.get("velocity-tracker");
  const effState = ctx.dependencyStates?.get("efficiency");
  const commitState = ctx.dependencyStates?.get("commit-analyzer");
  const linkerState = ctx.dependencyStates?.get("ai-git-linker");

  const aiData = extractAIVelocity(velocityState, effState);
  const gitData = extractGitVelocity(commitState, linkerState);

  const aiNorm =
    normalize(aiData.sessionsPerDay, 0, 20) * 0.5 +
    normalize(aiData.promptEffectiveness, 0, 1) * 0.5;
  const gitNorm =
    normalize(gitData.commitsPerDay, 0, 10) * 0.6 + normalize(gitData.aiToCommitRate, 0, 1) * 0.4;

  const ratio = gitNorm > 0 ? Math.round((aiNorm / gitNorm) * 100) / 100 : aiNorm > 0 ? 10 : 1;

  let alignment: DualVelocityOutput["alignment"];
  if (aiNorm < 0.2 && gitNorm < 0.2) alignment = "both-low";
  else if (ratio > 2) alignment = "ai-heavy";
  else if (ratio < 0.5) alignment = "git-heavy";
  else alignment = "balanced";

  const translationEfficiency =
    aiNorm > 0 ? Math.round(((gitData.aiToCommitRate * gitNorm) / aiNorm) * 1000) / 1000 : 0;

  const interpretations: Record<DualVelocityOutput["alignment"], string> = {
    "ai-heavy":
      "High AI session activity but low commit output. AI conversations may not be translating into shipped code. Focus on actionable prompts that lead to commits.",
    balanced:
      "AI and git velocity are in sync. Your AI sessions are translating effectively into code changes.",
    "git-heavy":
      "More commits than AI sessions suggest you're coding independently. Consider leveraging AI for complex tasks to accelerate further.",
    "both-low":
      "Both AI and git activity are low. This may indicate a planning phase, or insufficient tool utilization.",
  };

  return {
    aiVelocity: {
      turnsPerSession: aiData.turnsPerSession,
      sessionsPerDay: aiData.sessionsPerDay,
      promptEffectiveness: aiData.promptEffectiveness,
      normalizedScore: Math.round(aiNorm * 1000) / 1000,
    },
    gitVelocity: {
      commitsPerDay: gitData.commitsPerDay,
      filesPerCommit: gitData.filesPerCommit,
      aiToCommitRate: gitData.aiToCommitRate,
      normalizedScore: Math.round(gitNorm * 1000) / 1000,
    },
    velocityRatio: ratio,
    alignment,
    translationEfficiency,
    interpretation: interpretations[alignment],
    updatedAt: now,
  };
}

function extractAIVelocity(
  velocityState: IncrementalState<unknown> | undefined,
  effState: IncrementalState<unknown> | undefined,
): { turnsPerSession: number; sessionsPerDay: number; promptEffectiveness: number } {
  const velVal = velocityState?.value as
    | {
        output?: { byDomain?: Record<string, { currentTurnsToAcceptance?: number }> };
      }
    | undefined;
  const effVal = effState?.value as { output?: { aes?: number } } | undefined;

  const domains = velVal?.output?.byDomain ?? {};
  const domainValues = Object.values(domains);
  const avgTurns =
    domainValues.length > 0
      ? domainValues.reduce((s, d) => s + (d.currentTurnsToAcceptance ?? 5), 0) /
        domainValues.length
      : 5;

  return {
    turnsPerSession: Math.round(avgTurns * 10) / 10,
    sessionsPerDay: domainValues.length,
    promptEffectiveness: (effVal?.output?.aes ?? 50) / 100,
  };
}

function extractGitVelocity(
  commitState: IncrementalState<unknown> | undefined,
  linkerState: IncrementalState<unknown> | undefined,
): { commitsPerDay: number; filesPerCommit: number; aiToCommitRate: number } {
  const commitVal = commitState?.value as
    | {
        output?: { recentVelocity?: number; avgFilesPerCommit?: number };
      }
    | undefined;
  const linkerVal = linkerState?.value as
    | {
        output?: { aiToCommitRate?: number };
      }
    | undefined;

  return {
    commitsPerDay: Math.round(((commitVal?.output?.recentVelocity ?? 0) / 7) * 10) / 10,
    filesPerCommit: commitVal?.output?.avgFilesPerCommit ?? 0,
    aiToCommitRate: linkerVal?.output?.aiToCommitRate ?? 0,
  };
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// FILE: src/services/intelligence/prompt-chain.ts
// Multi-turn prompt chain analysis. Reconstructs conversation dynamics
// from prompts_all + session_id grouping. Detects refinement patterns,
// scope evolution, and strategy shifts. Zero LLM cost.

import type { DbLike } from "../cache/manager.js";
import type { FeatureRegistry } from "./feature-registry.js";
import { extractPathsFromPrompt, resolveFeatures } from "./feature-registry.js";
import { classifyPrompt, type PromptType } from "./prompt-classifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChainPattern =
  | "single-shot"
  | "linear-refinement"
  | "exploratory-convergence"
  | "hypothesis-testing"
  | "scope-expansion"
  | "strategy-pivot"
  | "iterative-correction"
  | "decomposition"
  | "mixed";

export interface PromptChain {
  sessionId: string;
  turns: PromptTurn[];
  pattern: ChainPattern;
  scopeEvolution: ScopeEvolution;
  featureTrajectory: string[];
  effectiveness: ChainEffectiveness;
}

export interface PromptTurn {
  turnIndex: number;
  type: PromptType;
  specificity: number;
  filesReferenced: string[];
  deltaFromPrevious: TurnDelta | null;
}

export interface TurnDelta {
  tokenOverlap: number;
  typeShift: boolean;
  fileScopeChange: "same" | "narrowed" | "broadened" | "shifted";
  constraintDelta: number;
  addedContext: boolean;
}

export interface ScopeEvolution {
  fileCountTrend: "expanding" | "contracting" | "stable" | "oscillating";
  featureGroupCount: number;
  crossFeature: boolean;
}

export interface ChainEffectiveness {
  turnsToFirstAccept: number | null;
  chainDirectionScore: number;
  effortAmplification: number;
  refinementValue: "positive" | "neutral" | "negative";
}

interface SessionEvent {
  promptText: string;
  turnIndex: number;
  hds: number;
  filesReferenced: string[];
  filesModified: string[];
  outcome: string | null;
  branch: string | null;
}

// ---------------------------------------------------------------------------
// Chain analysis
// ---------------------------------------------------------------------------

export function analyzePromptChain(
  sessionEvents: SessionEvent[],
  featureRegistry: FeatureRegistry | null,
): PromptChain {
  if (sessionEvents.length === 0) {
    return makeEmptyChain("");
  }

  const sorted = [...sessionEvents].sort((a, b) => a.turnIndex - b.turnIndex);
  const turns: PromptTurn[] = [];
  const featureIds = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const evt = sorted[i];
    const classification = classifyPrompt(evt.promptText, {
      filesReferenced: evt.filesReferenced,
      filesModified: evt.filesModified,
      branch: evt.branch ?? undefined,
      turnIndex: i,
      totalTurns: sorted.length,
    });

    const allPaths = [
      ...evt.filesReferenced,
      ...evt.filesModified,
      ...extractPathsFromPrompt(evt.promptText),
    ];
    if (featureRegistry) {
      for (const f of resolveFeatures(featureRegistry, allPaths)) {
        featureIds.add(f.id);
      }
    }

    const delta: TurnDelta | null =
      i > 0
        ? computeTurnDelta(sorted[i - 1], evt, turns[i - 1].type, classification.primaryType)
        : null;

    turns.push({
      turnIndex: evt.turnIndex,
      type: classification.primaryType,
      specificity: classification.specificity,
      filesReferenced: evt.filesReferenced,
      deltaFromPrevious: delta,
    });
  }

  const pattern = detectPattern(turns, sorted);
  const scopeEvolution = computeScopeEvolution(turns, featureIds.size);
  const effectiveness = computeEffectiveness(sorted, turns);
  const featureTrajectory = [...featureIds];

  return {
    sessionId: "",
    turns,
    pattern,
    scopeEvolution,
    featureTrajectory,
    effectiveness,
  };
}

// ---------------------------------------------------------------------------
// Turn delta computation
// ---------------------------------------------------------------------------

function computeTurnDelta(
  prev: SessionEvent,
  curr: SessionEvent,
  prevType: PromptType,
  currType: PromptType,
): TurnDelta {
  const prevWords = new Set(tokenize(prev.promptText));
  const currWords = new Set(tokenize(curr.promptText));

  let overlap = 0;
  for (const w of currWords) {
    if (prevWords.has(w)) overlap++;
  }
  const union = new Set([...prevWords, ...currWords]).size;
  const tokenOverlap = union > 0 ? overlap / union : 0;

  const prevFiles = new Set(prev.filesReferenced);
  const currFiles = new Set(curr.filesReferenced);
  let fileScopeChange: TurnDelta["fileScopeChange"] = "same";
  if (currFiles.size > prevFiles.size * 1.3) fileScopeChange = "broadened";
  else if (currFiles.size < prevFiles.size * 0.7 && prevFiles.size > 0)
    fileScopeChange = "narrowed";
  else if (currFiles.size > 0 && prevFiles.size > 0) {
    let shared = 0;
    for (const f of currFiles) if (prevFiles.has(f)) shared++;
    if (shared / Math.max(currFiles.size, 1) < 0.3) fileScopeChange = "shifted";
  }

  const prevConstraints = countConstraints(prev.promptText);
  const currConstraints = countConstraints(curr.promptText);

  return {
    tokenOverlap,
    typeShift: prevType !== currType,
    fileScopeChange,
    constraintDelta: currConstraints - prevConstraints,
    addedContext: curr.promptText.length > prev.promptText.length * 1.2,
  };
}

function countConstraints(text: string): number {
  return (text.match(/\b(must|should|require|never|always|only|do not|don'?t)\b/gi) ?? []).length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

function detectPattern(turns: PromptTurn[], events: SessionEvent[]): ChainPattern {
  if (turns.length <= 1) return "single-shot";

  const deltas = turns.slice(1).map((t) => t.deltaFromPrevious!);

  const avgOverlap = deltas.reduce((s, d) => s + d.tokenOverlap, 0) / deltas.length;
  const constraintIncreasing = deltas.every((d) => d.constraintDelta >= 0);
  const typeShiftCount = deltas.filter((d) => d.typeShift).length;

  if (avgOverlap > 0.6 && constraintIncreasing) return "linear-refinement";

  const halfIdx = Math.floor(turns.length / 2);
  const firstHalfDiscovery = turns.slice(0, halfIdx).filter((t) => t.type === "discovery").length;
  const secondHalfBuilding = turns.slice(halfIdx).filter((t) => t.type === "building").length;
  if (firstHalfDiscovery >= halfIdx * 0.6 && secondHalfBuilding >= (turns.length - halfIdx) * 0.5) {
    return "exploratory-convergence";
  }

  const questionTurns = turns.filter((t) => t.type === "discovery").length;
  if (questionTurns >= turns.length * 0.4 && typeShiftCount >= 2) return "hypothesis-testing";

  const fileCounts = turns.map((t) => t.filesReferenced.length);
  if (fileCounts.length >= 3 && isMonotonicallyIncreasing(fileCounts)) return "scope-expansion";

  if (typeShiftCount >= 1) {
    const lastShift = deltas.findIndex((d) => d.typeShift && d.fileScopeChange === "shifted");
    if (lastShift >= 0) return "strategy-pivot";
  }

  const sameType = turns.every((t) => t.type === turns[0].type);
  const hdsDecline = events.length >= 3 && events[events.length - 1].hds < events[0].hds * 0.7;
  if (sameType && hdsDecline) return "iterative-correction";

  const narrowing = deltas.filter((d) => d.fileScopeChange === "narrowed").length;
  if (narrowing >= deltas.length * 0.5) return "decomposition";

  return "mixed";
}

function isMonotonicallyIncreasing(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) return false;
  }
  return arr[arr.length - 1] > arr[0];
}

// ---------------------------------------------------------------------------
// Scope evolution
// ---------------------------------------------------------------------------

function computeScopeEvolution(turns: PromptTurn[], featureGroupCount: number): ScopeEvolution {
  const fileCounts = turns.map((t) => t.filesReferenced.length);
  let fileCountTrend: ScopeEvolution["fileCountTrend"] = "stable";

  if (fileCounts.length >= 3) {
    const firstHalf = fileCounts.slice(0, Math.floor(fileCounts.length / 2));
    const secondHalf = fileCounts.slice(Math.floor(fileCounts.length / 2));
    const avg1 = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

    if (avg2 > avg1 * 1.3) fileCountTrend = "expanding";
    else if (avg2 < avg1 * 0.7) fileCountTrend = "contracting";
    else {
      const diffs = fileCounts.slice(1).map((v, i) => v - fileCounts[i]);
      const signChanges = diffs.filter(
        (d, i) => i > 0 && Math.sign(d) !== Math.sign(diffs[i - 1]),
      ).length;
      if (signChanges >= 2) fileCountTrend = "oscillating";
    }
  }

  return {
    fileCountTrend,
    featureGroupCount,
    crossFeature: featureGroupCount > 1,
  };
}

// ---------------------------------------------------------------------------
// Effectiveness
// ---------------------------------------------------------------------------

function computeEffectiveness(events: SessionEvent[], _turns: PromptTurn[]): ChainEffectiveness {
  const successIdx = events.findIndex((e) => e.outcome === "success");
  const turnsToFirstAccept = successIdx >= 0 ? successIdx + 1 : null;

  const hdsValues = events.map((e) => e.hds).filter((h) => h != null);
  const chainDirectionScore =
    hdsValues.length > 0 ? hdsValues.reduce((s, v) => s + v, 0) / hdsValues.length : 0;

  const totalTurns = events.length;
  const effortAmplification = totalTurns > 0 ? 1 / totalTurns : 0;

  let refinementValue: ChainEffectiveness["refinementValue"] = "neutral";
  if (hdsValues.length >= 2) {
    const first = hdsValues[0];
    const last = hdsValues[hdsValues.length - 1];
    if (last > first * 1.2) refinementValue = "positive";
    else if (last < first * 0.8) refinementValue = "negative";
  }

  return {
    turnsToFirstAccept,
    chainDirectionScore: Math.round(chainDirectionScore * 1000) / 1000,
    effortAmplification: Math.round(effortAmplification * 1000) / 1000,
    refinementValue,
  };
}

// ---------------------------------------------------------------------------
// Batch analysis — writes to DuckDB
// ---------------------------------------------------------------------------

export async function analyzeUnanalyzedChains(
  db: DbLike,
  featureRegistry: FeatureRegistry | null,
  limit = 50,
): Promise<number> {
  try {
    const result = await db.exec(
      `SELECT DISTINCT session_id FROM events
       WHERE session_id IS NOT NULL
         AND source IN ('ai-session', 'mcp-active')
         AND session_id NOT IN (SELECT session_id FROM prompt_chains)
       LIMIT $1`,
      [limit],
    );

    if (!result[0]?.values.length) return 0;

    let analyzed = 0;
    for (const row of result[0].values) {
      const sessionId = row[0] as string;
      if (!sessionId) continue;

      const eventsResult = await db.exec(
        `SELECT
           COALESCE(metadata_extra->>'prompt_full', content_summary) as prompt_text,
           turn_count as turn_idx,
           human_direction_score as hds,
           files_referenced,
           files_modified,
           outcome,
           content_branch
         FROM events
         WHERE session_id = $1
         ORDER BY ts ASC`,
        [sessionId],
      );

      if (!eventsResult[0]?.values.length) continue;

      const sessionEvents: SessionEvent[] = eventsResult[0].values.map((r, i) => ({
        promptText: (r[0] as string) ?? "",
        turnIndex: (r[1] as number) ?? i,
        hds: (r[2] as number) ?? 0,
        filesReferenced: Array.isArray(r[3]) ? (r[3] as string[]) : [],
        filesModified: Array.isArray(r[4]) ? (r[4] as string[]) : [],
        outcome: (r[5] as string) ?? null,
        branch: (r[6] as string) ?? null,
      }));

      const chain = analyzePromptChain(sessionEvents, featureRegistry);
      chain.sessionId = sessionId;

      db.run(
        `INSERT OR REPLACE INTO prompt_chains
         (session_id, chain_pattern, turn_count, scope_evolution, cross_feature,
          turns_to_first_accept, chain_direction_score, effort_amplification,
          refinement_value, feature_trajectory, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [
          sessionId,
          chain.pattern,
          chain.turns.length,
          chain.scopeEvolution.fileCountTrend,
          chain.scopeEvolution.crossFeature,
          chain.effectiveness.turnsToFirstAccept,
          chain.effectiveness.chainDirectionScore,
          chain.effectiveness.effortAmplification,
          chain.effectiveness.refinementValue,
          chain.featureTrajectory.join(",") || null,
        ],
      );

      // Write chain_pattern back to events for this session
      db.run(
        `UPDATE events SET
           chain_pattern = $1,
           chain_effectiveness = $2
         WHERE session_id = $3 AND chain_pattern IS NULL`,
        [chain.pattern, chain.effectiveness.chainDirectionScore, sessionId],
      );

      analyzed++;
    }

    return analyzed;
  } catch {
    return 0;
  }
}

function makeEmptyChain(sessionId: string): PromptChain {
  return {
    sessionId,
    turns: [],
    pattern: "single-shot",
    scopeEvolution: { fileCountTrend: "stable", featureGroupCount: 0, crossFeature: false },
    featureTrajectory: [],
    effectiveness: {
      turnsToFirstAccept: null,
      chainDirectionScore: 0,
      effortAmplification: 0,
      refinementValue: "neutral",
    },
  };
}

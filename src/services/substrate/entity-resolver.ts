// FILE: src/services/substrate/entity-resolver.ts
// Entity resolution: merges multiple analyzer contributions for the same entity
// into a unified state. Configurable merge strategies per field type ensure
// numeric values use latest-wins, arrays union, counters sum, etc.

import type { EntityContribution } from "./substrate-engine.js";

// ---------------------------------------------------------------------------
// Merge strategies
// ---------------------------------------------------------------------------

export type MergeStrategy = (existing: unknown, incoming: unknown) => unknown;

const latestWins: MergeStrategy = (_old, next) => next;
const arrayUnion: MergeStrategy = (old, next) => {
  const a = Array.isArray(old) ? old : [];
  const b = Array.isArray(next) ? next : [];
  return [...new Set([...a, ...b])];
};
const sum: MergeStrategy = (old, next) => ((old as number) ?? 0) + ((next as number) ?? 0);
const max: MergeStrategy = (old, next) => Math.max((old as number) ?? 0, (next as number) ?? 0);
const min: MergeStrategy = (old, next) =>
  Math.min(
    (old as number) ?? Number.POSITIVE_INFINITY,
    (next as number) ?? Number.POSITIVE_INFINITY,
  );

const EWMA_ALPHA = 0.3;
const ewma: MergeStrategy = (old, next) => {
  const oldVal = typeof old === "number" ? old : 0;
  const nextVal = typeof next === "number" ? next : oldVal;
  return Math.round((EWMA_ALPHA * nextVal + (1 - EWMA_ALPHA) * oldVal) * 10000) / 10000;
};

export const BUILTIN_STRATEGIES: Record<string, MergeStrategy> = {
  loopRisk: ewma,
  efficiency: ewma,
  comprehension: ewma,
  velocity: ewma,
  directionTrend: latestWins,
  currentPhase: latestWins,
  phase: latestWins,
  outcome: latestWins,
  avgHds: latestWins,
  confidence: max,
  turnCount: max,
  eventCount: max,
  totalSessions: max,
  techniques: arrayUnion,
  learnedTechniques: arrayUnion,
  applicableFeatures: arrayUnion,
  executionPhases: arrayUnion,
  occurrences: sum,
  contributionCount: sum,
};

// ---------------------------------------------------------------------------
// Resolution result
// ---------------------------------------------------------------------------

export interface ResolvedEntity {
  entityId: string;
  entityType: EntityContribution["entityType"];
  projectId: string;
  mergedState: Record<string, unknown>;
  sources: string[];
  relationships: EntityContribution["relationships"];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve multiple contributions into a single merged entity per entityId.
 * Groups by entityId, merges stateFragments using strategy registry,
 * unions relationships, and collects unique source analyzers.
 */
export function resolveContributions(
  contributions: EntityContribution[],
  strategies?: Record<string, MergeStrategy>,
): ResolvedEntity[] {
  const strategyMap = { ...BUILTIN_STRATEGIES, ...strategies };

  const grouped = new Map<string, EntityContribution[]>();
  for (const c of contributions) {
    const arr = grouped.get(c.entityId) ?? [];
    arr.push(c);
    grouped.set(c.entityId, arr);
  }

  const resolved: ResolvedEntity[] = [];

  for (const [entityId, contribs] of grouped) {
    const first = contribs[0];
    const mergedState = mergeStateFragments(contribs, strategyMap);
    const sources = [...new Set(contribs.map((c) => c.analyzerName))];
    const relationships = mergeRelationships(contribs);

    resolved.push({
      entityId,
      entityType: first.entityType,
      projectId: first.projectId,
      mergedState,
      sources,
      relationships,
    });
  }

  return resolved;
}

/**
 * Merge a single contribution's stateFragment into an existing state.
 * Used for incremental updates to already-existing entities.
 */
export function mergeIntoExisting(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  strategies?: Record<string, MergeStrategy>,
): Record<string, unknown> {
  const strategyMap = { ...BUILTIN_STRATEGIES, ...strategies };
  const result = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    const existingVal = result[key];
    if (existingVal === undefined) {
      result[key] = value;
      continue;
    }

    const strategy = strategyMap[key];
    if (strategy) {
      result[key] = strategy(existingVal, value);
    } else {
      result[key] = inferMerge(existingVal, value);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function mergeStateFragments(
  contributions: EntityContribution[],
  strategies: Record<string, MergeStrategy>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const contrib of contributions) {
    for (const [key, value] of Object.entries(contrib.stateFragment)) {
      const existing = merged[key];
      if (existing === undefined) {
        merged[key] = value;
        continue;
      }

      const strategy = strategies[key];
      if (strategy) {
        merged[key] = strategy(existing, value);
      } else {
        merged[key] = inferMerge(existing, value);
      }
    }
  }

  return merged;
}

function inferMerge(existing: unknown, incoming: unknown): unknown {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return [...new Set([...existing, ...incoming])];
  }
  if (typeof existing === "number" && typeof incoming === "number") {
    return incoming;
  }
  return incoming;
}

function mergeRelationships(
  contributions: EntityContribution[],
): EntityContribution["relationships"] {
  const seen = new Map<string, EntityContribution["relationships"][0]>();

  for (const contrib of contributions) {
    for (const rel of contrib.relationships) {
      const key = `${rel.targetEntityId}:${rel.type}`;
      const existing = seen.get(key);
      if (!existing || rel.weight > existing.weight) {
        seen.set(key, rel);
      }
    }
  }

  return [...seen.values()];
}

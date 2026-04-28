// FILE: src/services/intelligence/analyzers/index.ts
// Canonical AnalyzerContext for the intelligence layer.
// Three-DB: DuckDB (analytics) for time-series, SQLite (operational) for lookups,
// CozoDB (knowledge) for extracted entity graph + comprehension + facts.

import type { DbLike } from "../../cache/manager.js";
import type { IncrementalState } from "../incremental-state.js";
import type { KnowledgeReader } from "../knowledge-reader.js";

export interface AnalyzerContext {
  analytics: DbLike;
  operational: DbLike;
  repoRoot: string;
  config: Record<string, unknown>;
  dependencyStates?: Map<string, IncrementalState<unknown>>;
  /** CozoDB knowledge graph access — null when CozoDB is unavailable or extraction hasn't run yet.
   *  Analyzers MUST gracefully degrade when this is null. */
  knowledge: KnowledgeReader | null;
}

export interface AnalyzerResult {
  analyzer: string;
  updatedAt: string;
  data: Record<string, unknown>;
  insightCount: number;
  sourceEventIds: string[];
}

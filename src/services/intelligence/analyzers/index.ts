// FILE: src/services/intelligence/analyzers/index.ts
// Canonical AnalyzerContext for the intelligence layer.
// Dual-DB: analyzers query DuckDB (analytics) for typed-column aggregations.
// Lineage writes go to SQLite (operational) via the engine.

import type { DbLike } from "../../cache/manager.js";
import type { IncrementalState } from "../incremental-state.js";

export interface AnalyzerContext {
  analytics: DbLike;
  operational: DbLike;
  repoRoot: string;
  config: Record<string, unknown>;
  dependencyStates?: Map<string, IncrementalState<unknown>>;
}

export interface AnalyzerResult {
  analyzer: string;
  updatedAt: string;
  data: Record<string, unknown>;
  insightCount: number;
  sourceEventIds: string[];
}

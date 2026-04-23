// FILE: src/services/intelligence/incremental-state.ts
// Foundation for incremental intelligence: stateful analyzers that process
// only new events (delta) instead of full-table scans. Persistence layer
// enables resume-from-watermark on restart.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { DbLike } from "../cache/manager.js";
import type { Domain } from "./domain-classifier.js";

// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

export interface IncrementalState<T> {
  value: T;
  watermark: string;
  eventCount: number;
  updatedAt: string;
}

export interface NewEventBatch {
  events: AnalyzerEvent[];
  sessionUpdates: string[];
  featureUpdates: string[];
}

export interface AnalyzerEvent {
  id: string;
  projectId: string;
  ts: string;
  source: string;
  type: string;
  sessionId: string | null;
  contentSummary: string | null;
  contentBranch: string | null;
  contentProject: string | null;
  humanDirectionScore: number | null;
  promptSpecificity: number | null;
  turnCount: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  estimatedCost: number | null;
  executionPhase: string | null;
  outcome: string | null;
  aiTool: string | null;
  filesReferenced: string[];
  filesModified: string[];
  promptType: string | null;
  featureGroupId: string | null;
  chainPattern: string | null;
  domain: Domain;
}

export interface UpdateResult<TState> {
  state: IncrementalState<TState>;
  changed: boolean;
  changeMagnitude?: number;
}

import type { AnalyzerContext } from "./analyzers/index.js";

export type { AnalyzerContext } from "./analyzers/index.js";

export interface IncrementalAnalyzer<TState, TOutput> {
  name: string;
  outputFile: string;

  eventFilter: {
    sources?: string[];
    types?: string[];
    requireFields?: string[];
  };

  dependsOn?: string[];

  minDataPoints: number;

  initialize(ctx: AnalyzerContext): Promise<IncrementalState<TState>>;

  update(
    state: IncrementalState<TState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<TState>>;

  derive(state: IncrementalState<TState>): TOutput;

  /**
   * Contribute entities to the intelligence graph after update.
   * Optional: analyzers without this method produce JSON files only.
   * When present, the SubstrateEngine ingests these contributions after
   * the DAG scheduler completes each cycle.
   */
  contributeEntities?(
    state: IncrementalState<TState>,
    batch: NewEventBatch,
  ): import("../substrate/substrate-engine.js").EntityContribution[];
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

function getStateDir(repoRoot?: string): string {
  const intelligenceDir = getIntelligenceDir(repoRoot);
  return join(intelligenceDir, "state");
}

export function loadState<T>(analyzerName: string, repoRoot?: string): IncrementalState<T> | null {
  try {
    const dir = getStateDir(repoRoot);
    const path = join(dir, `${analyzerName}.state.json`);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as IncrementalState<T>;
  } catch (err) {
    logger.debug(`Failed to load state for ${analyzerName}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function saveState<T>(
  analyzerName: string,
  state: IncrementalState<T>,
  repoRoot?: string,
): void {
  try {
    const dir = getStateDir(repoRoot);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${analyzerName}.state.json`);
    const tmp = `${target}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    logger.debug(`Failed to save state for ${analyzerName}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Batch construction from DuckDB
// ---------------------------------------------------------------------------

export async function buildEventBatch(
  db: DbLike,
  watermark: string,
  limit = 500,
): Promise<NewEventBatch> {
  const events: AnalyzerEvent[] = [];
  const sessionSet = new Set<string>();
  const featureSet = new Set<string>();

  try {
    const result = await db.exec(
      `SELECT
        id, project_id, ts, source, type, session_id,
        content_summary, content_branch, content_project,
        human_direction_score, prompt_specificity, turn_count,
        tokens_in, tokens_out, estimated_cost,
        execution_phase, outcome, ai_tool,
        files_referenced, files_modified,
        prompt_type, feature_group_id, chain_pattern
      FROM events
      WHERE ts > $1::TIMESTAMP
      ORDER BY ts ASC
      LIMIT $2`,
      [watermark || "1970-01-01T00:00:00Z", limit],
    );

    if (!result[0]?.values.length) {
      return { events: [], sessionUpdates: [], featureUpdates: [] };
    }

    for (const row of result[0].values) {
      const sessionId = (row[5] as string) ?? null;
      const featureGroupId = (row[21] as string) ?? null;

      if (sessionId) sessionSet.add(sessionId);
      if (featureGroupId) featureSet.add(featureGroupId);

      events.push({
        id: row[0] as string,
        projectId: (row[1] as string) ?? "",
        ts: (row[2] as string) ?? "",
        source: (row[3] as string) ?? "",
        type: (row[4] as string) ?? "",
        sessionId,
        contentSummary: (row[6] as string) ?? null,
        contentBranch: (row[7] as string) ?? null,
        contentProject: (row[8] as string) ?? null,
        humanDirectionScore: (row[9] as number) ?? null,
        promptSpecificity: (row[10] as number) ?? null,
        turnCount: (row[11] as number) ?? null,
        tokensIn: (row[12] as number) ?? null,
        tokensOut: (row[13] as number) ?? null,
        estimatedCost: (row[14] as number) ?? null,
        executionPhase: (row[15] as string) ?? null,
        outcome: (row[16] as string) ?? null,
        aiTool: (row[17] as string) ?? null,
        filesReferenced: Array.isArray(row[18]) ? (row[18] as string[]) : [],
        filesModified: Array.isArray(row[19]) ? (row[19] as string[]) : [],
        promptType: (row[20] as string) ?? null,
        featureGroupId,
        chainPattern: (row[22] as string) ?? null,
        domain: "general",
      });
    }
  } catch (err) {
    logger.debug("Failed to build event batch from DuckDB", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    events,
    sessionUpdates: [...sessionSet],
    featureUpdates: [...featureSet],
  };
}

/**
 * Filter a batch to only events matching an analyzer's eventFilter.
 */
export function filterBatch(
  batch: NewEventBatch,
  filter: IncrementalAnalyzer<unknown, unknown>["eventFilter"],
): NewEventBatch {
  let filtered = batch.events;

  if (filter.sources?.length) {
    const sourceSet = new Set(filter.sources);
    filtered = filtered.filter((e) => sourceSet.has(e.source));
  }
  if (filter.types?.length) {
    const typeSet = new Set(filter.types);
    filtered = filtered.filter((e) => typeSet.has(e.type));
  }
  if (filter.requireFields?.length) {
    filtered = filtered.filter((e) => {
      for (const field of filter.requireFields!) {
        if ((e as unknown as Record<string, unknown>)[field] == null) return false;
      }
      return true;
    });
  }

  return {
    events: filtered,
    sessionUpdates: batch.sessionUpdates,
    featureUpdates: batch.featureUpdates,
  };
}

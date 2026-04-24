// FILE: src/services/intelligence/cold-start.ts
// Cold-start initialization for the intelligence pipeline.
// On first run or after `unfade doctor --rebuild-intelligence`:
// 1. Clears all persisted analyzer states
// 2. Creates the IntelligenceScheduler with all analyzers
// 3. Calls initialize() on each analyzer in topological order
// 4. Persists the resulting states
// 5. Runs one full processing cycle

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { DbLike } from "../cache/manager.js";
import { allAnalyzers } from "./analyzers/all.js";
import type { AnalyzerContext } from "./analyzers/index.js";
import { IntelligenceScheduler } from "./engine.js";

// ---------------------------------------------------------------------------
// Cold start
// ---------------------------------------------------------------------------

export interface ColdStartResult {
  analyzersInitialized: number;
  analyzersFailed: string[];
  stateFilesWritten: number;
  processingResult: {
    nodesProcessed: number;
    totalEventsInBatch: number;
  } | null;
  durationMs: number;
}

/**
 * Perform a full cold start of the intelligence pipeline.
 * Clears existing state, initializes all analyzers, runs one cycle.
 */
export async function coldStartIntelligence(
  analyticsDb: DbLike,
  operationalDb: DbLike,
  config: Record<string, unknown> = {},
): Promise<ColdStartResult> {
  const startMs = Date.now();
  const failed: string[] = [];

  logger.info("Intelligence cold start: clearing existing state");
  const cleared = clearAllState();
  logger.info(`Cleared ${cleared} state files`);

  const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
  for (const analyzer of allAnalyzers) {
    scheduler.register(analyzer);
  }

  const ctx: AnalyzerContext = {
    analytics: analyticsDb,
    operational: operationalDb,
    repoRoot: "",
    config,
  };

  logger.info(`Initializing ${allAnalyzers.length} analyzers in topological order`);

  let initialized = 0;
  try {
    await scheduler.initialize(ctx);
    initialized = allAnalyzers.length;
  } catch (err) {
    logger.error("Cold start initialization failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const stateDir = join(getIntelligenceDir(), "state");
  const stateFiles = existsSync(stateDir)
    ? readdirSync(stateDir).filter((f) => f.endsWith(".state.json")).length
    : 0;

  logger.info(`Running initial processing cycle`);
  let processingResult: ColdStartResult["processingResult"] = null;

  try {
    const result = await scheduler.processEvents(ctx);
    processingResult = {
      nodesProcessed: result.nodesProcessed,
      totalEventsInBatch: result.totalEventsInBatch,
    };
  } catch (err) {
    logger.error("Cold start processing cycle failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const durationMs = Date.now() - startMs;
  logger.info(
    `Cold start complete in ${durationMs}ms: ${initialized} analyzers, ${stateFiles} state files`,
  );

  return {
    analyzersInitialized: initialized,
    analyzersFailed: failed,
    stateFilesWritten: stateFiles,
    processingResult,
    durationMs,
  };
}

/**
 * Clear all persisted analyzer state files.
 * Returns the number of files removed.
 */
export function clearAllState(): number {
  const stateDir = join(getIntelligenceDir(), "state");
  if (!existsSync(stateDir)) return 0;

  let removed = 0;
  try {
    const files = readdirSync(stateDir).filter((f) => f.endsWith(".state.json"));
    for (const file of files) {
      try {
        rmSync(join(stateDir, file));
        removed++;
      } catch {
        // non-fatal
      }
    }
  } catch {
    // non-fatal
  }

  return removed;
}

/**
 * Check if the intelligence system has been initialized (state files exist).
 */
export function isIntelligenceInitialized(): boolean {
  const stateDir = join(getIntelligenceDir(), "state");
  if (!existsSync(stateDir)) return false;
  try {
    const files = readdirSync(stateDir).filter((f) => f.endsWith(".state.json"));
    return files.length >= 5;
  } catch {
    return false;
  }
}

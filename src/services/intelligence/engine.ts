// FILE: src/services/intelligence/engine.ts
// IntelligenceScheduler — DAG-based scheduler for IncrementalAnalyzers.
// Topologically sorts analyzers by dependsOn declarations, processes dirty
// nodes only, cascades changes to dependents with magnitude throttling.
// Replaces both the old IntelligenceEngine and the 16C IncrementalEngine.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { AnalyzerContext, AnalyzerResult } from "./analyzers/index.js";
import {
  buildEventBatch,
  filterBatch,
  type IncrementalAnalyzer,
  type IncrementalState,
  loadState,
  type NewEventBatch,
  saveState,
  type UpdateResult,
} from "./incremental-state.js";
import { writeInsightMappings } from "./lineage.js";

// ---------------------------------------------------------------------------
// DAG node
// ---------------------------------------------------------------------------

interface DagNode {
  analyzer: IncrementalAnalyzer<unknown, unknown>;
  state: IncrementalState<unknown> | null;
  dependents: string[];
  dependencies: string[];
  dirty: boolean;
  lastChanged: boolean;
  lastChangeMagnitude: number;
}

// ---------------------------------------------------------------------------
// Scheduler result
// ---------------------------------------------------------------------------

export interface SchedulerResult {
  results: AnalyzerResult[];
  nodesProcessed: number;
  nodesCascaded: number;
  totalEventsInBatch: number;
  entityContributions: import("../substrate/substrate-engine.js").EntityContribution[];
}

export interface AnalyzerProgressInfo {
  analyzerName: string;
  index: number;
  total: number;
  phase: "starting" | "complete";
  changed: boolean;
}

// ---------------------------------------------------------------------------
// IntelligenceScheduler
// ---------------------------------------------------------------------------

const CASCADE_MAGNITUDE_THRESHOLD = 0.05;

export class IntelligenceScheduler {
  private graph = new Map<string, DagNode>();
  private topoOrder: string[] = [];
  private lastRunMs = 0;
  private minIntervalMs: number;
  private globalWatermark = "";

  constructor(opts: { minIntervalMs?: number } = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 10_000;
  }

  setMinInterval(ms: number): void {
    this.minIntervalMs = ms;
  }

  register(analyzer: IncrementalAnalyzer<unknown, unknown>): void {
    this.graph.set(analyzer.name, {
      analyzer,
      state: null,
      dependents: [],
      dependencies: analyzer.dependsOn ?? [],
      dirty: false,
      lastChanged: false,
      lastChangeMagnitude: 0,
    });
    this.rebuildTopology();
    logger.debug("Registered analyzer in DAG", {
      name: analyzer.name,
      dependsOn: analyzer.dependsOn ?? [],
    });
  }

  async initialize(ctx: AnalyzerContext): Promise<void> {
    for (const name of this.topoOrder) {
      const node = this.graph.get(name)!;
      try {
        node.state = loadState(name) ?? (await node.analyzer.initialize(ctx));
        saveState(name, node.state);
      } catch (err) {
        logger.debug(`Failed to initialize ${name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async processEvents(
    ctx: AnalyzerContext,
    onProgress?: (info: AnalyzerProgressInfo) => void,
  ): Promise<SchedulerResult> {
    const now = Date.now();
    if (now - this.lastRunMs < this.minIntervalMs) {
      return {
        results: [],
        nodesProcessed: 0,
        nodesCascaded: 0,
        totalEventsInBatch: 0,
        entityContributions: [],
      };
    }
    this.lastRunMs = now;

    const hasData = await this.checkMinData(ctx);
    if (!hasData) {
      return {
        results: [],
        nodesProcessed: 0,
        nodesCascaded: 0,
        totalEventsInBatch: 0,
        entityContributions: [],
      };
    }

    const batchStartMs = Date.now();
    const batch = await buildEventBatch(ctx.analytics, this.globalWatermark);
    logger.info(`[intelligence] Event batch built`, {
      events: batch.events.length,
      watermark: this.globalWatermark || "(none)",
      buildMs: Date.now() - batchStartMs,
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });

    if (batch.events.length === 0) {
      return {
        results: [],
        nodesProcessed: 0,
        nodesCascaded: 0,
        totalEventsInBatch: 0,
        entityContributions: [],
      };
    }

    const intelligenceDir = getIntelligenceDir();
    mkdirSync(intelligenceDir, { recursive: true });

    // Phase 1: Mark dirty nodes — analyzers with matching events in this batch
    this.markDirtyFromBatch(batch);

    // Phase 2: Process dirty nodes in topological order, cascade to dependents
    const results: AnalyzerResult[] = [];
    const allEntityContributions: import("../substrate/substrate-engine.js").EntityContribution[] =
      [];
    let nodesProcessed = 0;
    let nodesCascaded = 0;

    for (let nodeIdx = 0; nodeIdx < this.topoOrder.length; nodeIdx++) {
      const name = this.topoOrder[nodeIdx];
      const node = this.graph.get(name)!;
      if (!node.dirty) {
        node.lastChanged = false;
        continue;
      }

      // Yield to event loop between analyzer runs to prevent blocking
      if (nodeIdx > 0) {
        await new Promise<void>((r) => setImmediate(r));
      }

      if (onProgress) {
        onProgress({
          analyzerName: name,
          index: nodeIdx,
          total: this.topoOrder.length,
          phase: "starting",
          changed: false,
        });
      }

      try {
        const analyzerStartMs = Date.now();

        // Ensure state exists (cold start)
        if (!node.state) {
          node.state = loadState(name) ?? null;
        }
        if (!node.state) {
          if (batch.events.length < node.analyzer.minDataPoints) {
            node.dirty = false;
            node.lastChanged = false;
            logger.info(
              `[intelligence] Skipping ${name}: insufficient data (${batch.events.length} < ${node.analyzer.minDataPoints})`,
            );
            continue;
          }
          node.state = await node.analyzer.initialize(ctx);
          saveState(name, node.state);
        }

        // Inject dependency states
        const enrichedCtx = this.injectDependencyStates(name, ctx);

        // Filter batch to this analyzer's interests
        const filtered = filterBatch(batch, node.analyzer.eventFilter);
        logger.info(
          `[intelligence] Running ${name}: ${filtered.events.length} events (${nodeIdx + 1}/${this.topoOrder.length})`,
        );

        // Run update
        const updateResult: UpdateResult<unknown> = await node.analyzer.update(
          node.state,
          filtered,
          enrichedCtx,
        );

        const analyzerMs = Date.now() - analyzerStartMs;
        logger.info(`[intelligence] ${name} complete in ${analyzerMs}ms`, {
          changed: updateResult.changed,
          changeMagnitude: updateResult.changeMagnitude,
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });

        node.state = updateResult.state;
        node.dirty = false;
        nodesProcessed++;

        // Force write if output file doesn't exist yet — ensures first run
        // always produces output even when computed values match initial defaults.
        const outputFileExists = existsSync(join(intelligenceDir, node.analyzer.outputFile));
        const effectiveChanged = updateResult.changed || !outputFileExists;

        node.lastChanged = effectiveChanged;
        node.lastChangeMagnitude = updateResult.changeMagnitude ?? (effectiveChanged ? 1 : 0);

        if (effectiveChanged) {
          const output = node.analyzer.derive(node.state);
          writeResultAtomically(
            intelligenceDir,
            node.analyzer.outputFile,
            output as Record<string, unknown>,
          );
          saveState(name, node.state);
          if (!outputFileExists) {
            logger.info(`[intelligence] First-run write for ${name} → ${node.analyzer.outputFile}`);
          }

          results.push({
            analyzer: name,
            updatedAt: node.state.updatedAt,
            data: output as Record<string, unknown>,
            insightCount: 1,
            sourceEventIds: filtered.events.slice(0, 20).map((e) => e.id),
          });

          if (filtered.events.length > 0) {
            writeInsightMappings(
              ctx.operational,
              `${name}:${node.state.updatedAt}`,
              name,
              filtered.events.slice(0, 20).map((e) => e.id),
            );
          }

          if (node.analyzer.contributeEntities && node.state) {
            try {
              const entityContribs = node.analyzer.contributeEntities(node.state, filtered);
              if (entityContribs.length > 0) {
                allEntityContributions.push(...entityContribs);
              }
            } catch {
              // non-fatal — entity contribution failure doesn't block analysis
            }
          }

          // Cascade: mark dependents dirty if change magnitude exceeds threshold
          if (node.lastChangeMagnitude >= CASCADE_MAGNITUDE_THRESHOLD) {
            for (const depName of node.dependents) {
              const depNode = this.graph.get(depName);
              if (depNode && !depNode.dirty) {
                depNode.dirty = true;
                nodesCascaded++;
              }
            }
          }
        }
        if (onProgress) {
          onProgress({
            analyzerName: name,
            index: nodeIdx,
            total: this.topoOrder.length,
            phase: "complete",
            changed: updateResult.changed,
          });
        }
      } catch (err) {
        logger.warn(`[intelligence] Analyzer ${name} failed (non-fatal)`, {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" | ") : undefined,
        });
        node.dirty = false;
        node.lastChanged = false;
        node.lastChangeMagnitude = 0;

        if (onProgress) {
          onProgress({
            analyzerName: name,
            index: nodeIdx,
            total: this.topoOrder.length,
            phase: "complete",
            changed: false,
          });
        }
      }
    }

    if (batch.events.length > 0) {
      const lastTs = batch.events[batch.events.length - 1].ts;
      // Safety: ensure watermark is always a string (DuckDB can return {micros} objects)
      this.globalWatermark =
        typeof lastTs === "string"
          ? lastTs
          : lastTs && typeof lastTs === "object" && "micros" in (lastTs as Record<string, unknown>)
            ? new Date(Number((lastTs as { micros: number }).micros) / 1000).toISOString()
            : String(lastTs);
    }

    return {
      results,
      nodesProcessed,
      nodesCascaded,
      totalEventsInBatch: batch.events.length,
      entityContributions: allEntityContributions,
    };
  }

  getState<T>(analyzerName: string): IncrementalState<T> | null {
    const node = this.graph.get(analyzerName);
    return (node?.state as IncrementalState<T>) ?? null;
  }

  getChangedAnalyzers(): Map<string, UpdateResult<unknown>> {
    const changed = new Map<string, UpdateResult<unknown>>();
    for (const [name, node] of this.graph) {
      if (node.lastChanged && node.state) {
        changed.set(name, {
          state: node.state,
          changed: true,
          changeMagnitude: node.lastChangeMagnitude,
        });
      }
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Topology
  // ---------------------------------------------------------------------------

  private rebuildTopology(): void {
    // Wire up reverse dependency edges (dependents)
    for (const [, node] of this.graph) {
      node.dependents = [];
    }
    for (const [name, node] of this.graph) {
      for (const dep of node.dependencies) {
        const depNode = this.graph.get(dep);
        if (depNode) depNode.dependents.push(name);
      }
    }

    // Kahn's algorithm for topological sort
    const inDegree = new Map<string, number>();
    for (const [name, node] of this.graph) {
      inDegree.set(name, node.dependencies.filter((d) => this.graph.has(d)).length);
    }

    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      const node = this.graph.get(current)!;
      for (const dependent of node.dependents) {
        const deg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, deg);
        if (deg === 0) queue.push(dependent);
      }
    }

    // Any remaining nodes not in sorted = cycle (add them at the end with a warning)
    for (const name of this.graph.keys()) {
      if (!sorted.includes(name)) {
        logger.debug(`Cycle detected in DAG involving ${name} — appending at end`);
        sorted.push(name);
      }
    }

    this.topoOrder = sorted;
  }

  private markDirtyFromBatch(batch: NewEventBatch): void {
    for (const [, node] of this.graph) {
      node.dirty = false;
      node.lastChanged = false;
      node.lastChangeMagnitude = 0;
    }

    for (const [_name, node] of this.graph) {
      const filtered = filterBatch(batch, node.analyzer.eventFilter);
      if (filtered.events.length > 0) {
        node.dirty = true;
        continue;
      }

      // Dependency-only analyzers: dirty if any dependency is dirty
      if (node.dependencies.length > 0 && node.analyzer.eventFilter.sources?.length === 0) {
        node.dirty = true;
      }
    }
  }

  private injectDependencyStates(analyzerName: string, baseCtx: AnalyzerContext): AnalyzerContext {
    const node = this.graph.get(analyzerName)!;
    if (!node.dependencies.length) return baseCtx;

    const deps = new Map<string, IncrementalState<unknown>>();
    for (const depName of node.dependencies) {
      const depNode = this.graph.get(depName);
      if (depNode?.state) deps.set(depName, depNode.state);
    }

    return { ...baseCtx, dependencyStates: deps };
  }

  private async checkMinData(ctx: AnalyzerContext): Promise<boolean> {
    try {
      const result = await ctx.analytics.exec("SELECT COUNT(*) FROM events");
      const count = Number(result[0]?.values[0]?.[0] ?? 0);
      return count >= 3;
    } catch {
      return false;
    }
  }
}

// Keep this export name so repo-manager.ts import doesn't break
export { IntelligenceScheduler as IncrementalEngine };

function writeResultAtomically(dir: string, filename: string, data: Record<string, unknown>): void {
  const target = join(dir, filename);
  const tmp = join(dir, `${filename}.tmp.${process.pid}`);
  writeFileSync(
    tmp,
    JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? Number(value) : value), 2),
    "utf-8",
  );
  renameSync(tmp, target);
}

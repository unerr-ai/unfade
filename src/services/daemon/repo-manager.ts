// FILE: src/services/daemon/repo-manager.ts
// UF-307: Manages N EmbeddedDaemon + N MaterializerDaemon pairs, one per registered repo.
// Used by unfade-server.ts for startup, hot-add from registry watcher, and graceful shutdown.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config/manager.js";
import { localToday } from "../../utils/date.js";
import { logger } from "../../utils/logger.js";
import { getEventsDir, getProjectDataDir } from "../../utils/paths.js";
import { MaterializerDaemon } from "../cache/materializer-daemon.js";
import {
  aggregateComprehensionByModule,
  computeComprehensionBatch,
  upsertComprehensionScores,
} from "../intelligence/comprehension.js";
import { assignEventsToFeatures, linkRelatedEvents } from "../intelligence/feature-boundary.js";
import { classifyAllUnclassified } from "../intelligence/outcome-classifier.js";
import { appendRecentInsight } from "../intelligence/recent-insights.js";
import { writePartialSnapshot } from "../intelligence/snapshot.js";
import { readSummary } from "../intelligence/summary-writer.js";
import type { RepoEntry } from "../registry/registry.js";
import { type SchedulerHandle, startScheduler } from "../scheduler/scheduler.js";
import { ensureBinaries } from "./binary.js";
import { EmbeddedDaemon } from "./embedded-daemon.js";

const PARTIAL_SNAPSHOT_INTERVAL_MS = 4 * 3600 * 1000;

export interface ManagedRepo {
  entry: RepoEntry;
  daemon: EmbeddedDaemon;
  materializer: MaterializerDaemon;
  scheduler: SchedulerHandle | null;
  lastPartialSnapshotMs: number;
}

export class RepoManager {
  private repos = new Map<string, ManagedRepo>();
  private globalAiDaemon: EmbeddedDaemon | null = null;

  /**
   * Start the single global AI capture daemon.
   * This runs ONE instance that watches all AI tool directories (~/.claude/, Cursor, etc.)
   * and tags events with projectId via registry matching.
   */
  startGlobalAICapture(): void {
    if (this.globalAiDaemon) return;

    try {
      ensureBinaries();
    } catch {
      logger.debug("Global AI capture: binary not available — skipping");
      return;
    }

    this.globalAiDaemon = new EmbeddedDaemon("", {
      captureMode: "ai-global",
      projectId: "global-ai",
      onRestart: (attempt) => {
        logger.warn(`[ai-global] capture restarted (attempt ${attempt})`);
      },
    });
    this.globalAiDaemon.start();
    logger.debug("Global AI capture daemon started", { pid: this.globalAiDaemon.getPid() });
  }

  /**
   * Stop the global AI capture daemon.
   */
  async stopGlobalAICapture(): Promise<void> {
    if (this.globalAiDaemon) {
      await this.globalAiDaemon.stop();
      this.globalAiDaemon = null;
    }
  }

  /**
   * Add a repo: ensure binaries, start daemon, materializer, and scheduler.
   * Skips repos with monitoring === "paused".
   */
  async addRepo(entry: RepoEntry): Promise<ManagedRepo | null> {
    if (this.repos.has(entry.id)) return this.repos.get(entry.id)!;

    if (entry.monitoring === "paused") {
      logger.debug(`Repo ${entry.label}: monitoring paused — skipping daemon`);
      return null;
    }

    try {
      ensureBinaries();
    } catch {
      logger.debug(`Repo ${entry.label}: binary not available — skipping`);
      return null;
    }

    const daemon = new EmbeddedDaemon(entry.root, {
      projectId: entry.id,
      onRestart: (attempt, repoRoot) => {
        appendRecentInsight(repoRoot, {
          claim: `Capture engine restarted (attempt ${attempt})`,
          insightType: "system",
          severity: "warning",
          metrics: { restartAttempt: attempt },
        });
      },
    });
    daemon.start();

    // 11A.4: Wait for ingest lock to clear before materializer processes
    await waitForIngestClear(entry.root);

    const repoConfig = loadConfig({ projectDataDir: getProjectDataDir(entry.root) });
    const materializer = createMaterializerForRepo(entry.root, repoConfig);
    await materializer.start();

    const scheduler = startScheduler(repoConfig, entry.root);

    const managed: ManagedRepo = {
      entry,
      daemon,
      materializer,
      scheduler,
      lastPartialSnapshotMs: 0,
    };

    this.repos.set(entry.id, managed);
    logger.debug(`Repo ${entry.label} added to manager`, { pid: daemon.getPid() });
    return managed;
  }

  /**
   * Remove a repo: stop its daemon, materializer, and scheduler.
   */
  async removeRepo(id: string): Promise<void> {
    const managed = this.repos.get(id);
    if (!managed) return;

    // Always remove from map first to prevent concurrent access during cleanup
    this.repos.delete(id);

    try {
      managed.scheduler?.stop();
      managed.materializer.stop();
      await managed.daemon.stop();
    } finally {
      // Ensure materializer DB is closed even if daemon.stop() throws
      try {
        await managed.materializer.close();
      } catch (err) {
        logger.debug(`Materializer close failed for ${managed.entry.label}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Get all managed repos.
   */
  getAll(): Map<string, ManagedRepo> {
    return this.repos;
  }

  /**
   * Get a managed repo by ID.
   */
  get(id: string): ManagedRepo | undefined {
    return this.repos.get(id);
  }

  /**
   * Number of managed repos.
   */
  get size(): number {
    return this.repos.size;
  }

  /**
   * Get per-repo health status for the health endpoint.
   */
  getHealthStatus(): Array<{
    id: string;
    label: string;
    root: string;
    daemonPid: number | null;
    daemonRunning: boolean;
    daemonRestartCount: number;
    daemonUptimeMs: number;
    materializerLagMs: number;
  }> {
    const statuses: ReturnType<RepoManager["getHealthStatus"]> = [];
    for (const [id, managed] of this.repos) {
      statuses.push({
        id,
        label: managed.entry.label,
        root: managed.entry.root,
        daemonPid: managed.daemon.getPid(),
        daemonRunning: managed.daemon.isRunning(),
        daemonRestartCount: managed.daemon.getRestartCount(),
        daemonUptimeMs: managed.daemon.getUptimeMs(),
        materializerLagMs: managed.materializer.getLagMs(),
      });
    }
    return statuses;
  }

  /**
   * Graceful shutdown of all repos: schedulers → materializers → daemons.
   */
  async shutdownAll(): Promise<void> {
    for (const [, managed] of this.repos) {
      managed.scheduler?.stop();
    }

    for (const [, managed] of this.repos) {
      try {
        await managed.materializer.triggerNow();
      } catch {
        // best effort
      }
      managed.materializer.stop();
    }

    const stopPromises: Promise<void>[] = [];
    for (const [, managed] of this.repos) {
      stopPromises.push(managed.daemon.stop());
    }
    stopPromises.push(this.stopGlobalAICapture());
    await Promise.all(stopPromises);

    for (const [, managed] of this.repos) {
      await managed.materializer.close();
    }

    try {
      const { CozoManager } = await import("../substrate/cozo-manager.js");
      await CozoManager.close();
    } catch {
      // non-fatal
    }

    this.repos.clear();
  }
}

/**
 * Wait for the Go daemon's ingest lock to clear before starting materialization.
 * Checks the global events dir (not per-project).
 */
async function waitForIngestClear(_repoRoot: string, timeoutMs = 30_000): Promise<void> {
  const lockPath = join(getEventsDir(), ".ingest.lock");
  if (!existsSync(lockPath)) return;

  logger.debug("Waiting for ingest lock to clear");
  const deadline = Date.now() + timeoutMs;
  while (existsSync(lockPath) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (existsSync(lockPath)) {
    logger.debug("Ingest lock still present after timeout — materializer will defer per-tick");
  }
}

const INCREMENTAL_DISTILL_INTERVAL_MS = 5 * 60 * 1000; // 5 min throttle

/**
 * Create the global materializer. All artifacts write to ~/.unfade/ (no repoRoot override).
 * Profile, graph, amplification → ~/.unfade/ (global).
 * Intelligence, distills, metrics → ~/.unfade/ (global for now; Sprint 14E adds per-project routing).
 */
function createMaterializerForRepo(
  _repoRoot: string,
  config: ReturnType<typeof loadConfig>,
): MaterializerDaemon {
  let lastPartialMs = 0;
  let engine: import("../intelligence/engine.js").IntelligenceScheduler | null = null;
  let lastIncrementalDistillMs = 0;

  return new MaterializerDaemon({
    intervalMs: 2000,
    onTick: async function onTick(newRows) {
      if (newRows <= 0) return;

      const { CacheManager } = await import("../cache/manager.js");
      const cache = new CacheManager();
      const db = await cache.getDb();
      if (!db) return;

      const analyticsDb = cache.analytics ?? db;

      // Comprehension scoring (reads SQLite metadata column, writes to both)
      try {
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const recentResult = await db.exec(
          `SELECT id, source, metadata FROM events
           WHERE ts >= ? AND source IN ('ai-session', 'mcp-active')
             AND id NOT IN (SELECT event_id FROM comprehension_proxy)
           LIMIT 100`,
          [cutoff],
        );

        if (recentResult[0]?.values.length) {
          const inputs = recentResult[0].values.map((row) => ({
            eventId: row[0] as string,
            source: row[1] as string,
            metadata: JSON.parse((row[2] as string) || "{}") as Record<string, unknown>,
          }));
          const scores = computeComprehensionBatch(inputs);
          if (scores.length > 0) upsertComprehensionScores(db, scores);
        }

        await aggregateComprehensionByModule(analyticsDb);
      } catch {
        // non-fatal
      }

      // Feature boundary detection and event linking → SQLite (operational)
      try {
        const recentIds = await db.exec(
          `SELECT id FROM events WHERE id NOT IN (SELECT event_id FROM event_features) ORDER BY ts DESC LIMIT ?`,
          [newRows + 10],
        );
        const unlinkedIds = (recentIds[0]?.values ?? []).map((r) => r[0] as string);
        if (unlinkedIds.length > 0) {
          assignEventsToFeatures(db, unlinkedIds);
          linkRelatedEvents(db, unlinkedIds);
        }
      } catch {
        // non-fatal — feature detection is additive
      }

      // Materialize session metrics → DuckDB
      try {
        const { materializeSessionMetrics } = await import(
          "../intelligence/session-materializer.js"
        );
        await materializeSessionMetrics(analyticsDb);
      } catch {
        // non-fatal — session materialization is additive
      }

      // Summary snapshot + insights (reads from summary.json written by engine)
      try {
        const summary = readSummary();
        if (summary) {
          const now = Date.now();
          if (now - lastPartialMs >= PARTIAL_SNAPSHOT_INTERVAL_MS) {
            const today = localToday();
            writePartialSnapshot(today, {
              directionDensity: summary.directionDensity24h,
              comprehensionScore: summary.comprehensionScore,
              eventCount: summary.eventCount24h,
              topDomain: summary.topDomain,
            });
            lastPartialMs = now;
          }

          appendRecentInsight(undefined, {
            claim: `${newRows} new events indexed; direction ${summary.directionDensity24h}%`,
            insightType: "materializer_tick",
            severity: "info",
            metrics: {
              newRows,
              directionDensity24h: summary.directionDensity24h,
              comprehensionScore: summary.comprehensionScore,
              costPerDirectedDecision: summary.costPerDirectedDecision,
            },
          });
        }
      } catch {
        // non-fatal
      }

      // Prompt type classification → DuckDB (16B.1)
      try {
        const { classifyUnclassifiedEvents } = await import("../intelligence/prompt-classifier.js");
        await classifyUnclassifiedEvents(analyticsDb);
      } catch {
        // non-fatal — classification is additive
      }

      // Prompt chain analysis → DuckDB (16B.3)
      try {
        const { analyzeUnanalyzedChains } = await import("../intelligence/prompt-chain.js");
        await analyzeUnanalyzedChains(analyticsDb, null);
      } catch {
        // non-fatal
      }

      // Prompt→response correlation → DuckDB (16B.4)
      try {
        const { computeAndStoreCorrelations } = await import(
          "../intelligence/prompt-response-synthesis.js"
        );
        await computeAndStoreCorrelations(analyticsDb);
      } catch {
        // non-fatal
      }

      // Outcome classification → SQLite
      try {
        classifyAllUnclassified(db);
      } catch {
        // non-fatal
      }

      // IntelligenceScheduler → DAG-ordered processing → ~/.unfade/intelligence/
      try {
        if (!engine) {
          const { IntelligenceScheduler } = await import("../intelligence/engine.js");
          const { allAnalyzers } = await import("../intelligence/analyzers/all.js");
          engine = new IntelligenceScheduler({ minIntervalMs: 10_000 });
          for (const analyzer of allAnalyzers) {
            engine.register(analyzer);
          }
        }
        const schedulerCtx = {
          repoRoot: "",
          analytics: analyticsDb,
          operational: db,
          config: config as unknown as Record<string, unknown>,
        };
        const schedulerResult = await engine.processEvents(schedulerCtx);

        if (schedulerResult.results.length > 0) {
          const { getActionRunner } = await import("../actions/index.js");
          const runner = getActionRunner();
          await runner.fire("intelligence_update", {
            repoRoot: undefined as unknown as string,
            config: config as unknown as import("../../schemas/config.js").UnfadeConfig,
            trigger: "intelligence_update" as const,
          });

          // Dynamic cross-analyzer correlation discovery
          try {
            const { discoverCorrelations } = await import("../intelligence/cross-analyzer.js");
            await discoverCorrelations(engine.getChangedAnalyzers(), schedulerCtx);
          } catch {
            // non-fatal
          }

          // Semantic Substrate — analyzer-driven entity production (SUB-7)
          if (schedulerResult.nodesProcessed > 0) {
            try {
              const { CozoManager } = await import("../substrate/cozo-manager.js");
              const { SubstrateEngine } = await import("../substrate/substrate-engine.js");
              const { DiagnosticAccumulator } = await import(
                "../substrate/diagnostic-accumulator.js"
              );
              const { diagnosticStream } = await import("../intelligence/diagnostic-stream.js");
              const graphDb = await CozoManager.getInstance();
              const substrate = new SubstrateEngine(graphDb);

              let contributions = schedulerResult.entityContributions ?? [];

              if (contributions.length === 0) {
                const { buildAllContributions } = await import("../substrate/entity-mapper.js");
                contributions = await buildAllContributions(analyticsDb, "");
              }

              const activeDiags = diagnosticStream.getActive();
              if (activeDiags.length > 0) {
                const accumulator = new DiagnosticAccumulator();
                const diagContributions = accumulator.accumulateWithEntities(activeDiags);
                contributions.push(...diagContributions);
              }
              let graphDirty = false;
              if (contributions.length > 0) {
                const upserted = await substrate.ingest(contributions);
                if (upserted > 0) graphDirty = true;
                await substrate.propagate();

                if (graphDirty) {
                  try {
                    const { runGenerationDepth } = await import("../substrate/generation-depth.js");
                    await runGenerationDepth(substrate);
                  } catch {
                    // non-fatal — generation depth is additive
                  }
                }
              }

              // Graph context: only write when graph changed
              if (graphDirty) {
                try {
                  const { getGraphContextForSession } = await import(
                    "../substrate/graph-queries.js"
                  );
                  const { writeFileSync, renameSync, mkdirSync } = await import("node:fs");
                  const { join } = await import("node:path");
                  const { getIntelligenceDir } = await import("../../utils/paths.js");
                  const graphCtx = await getGraphContextForSession(substrate, "");
                  if (graphCtx) {
                    const dir = getIntelligenceDir();
                    mkdirSync(dir, { recursive: true });
                    const target = join(dir, "graph-context.json");
                    const tmp = `${target}.tmp.${process.pid}`;
                    writeFileSync(tmp, JSON.stringify(graphCtx, null, 2), "utf-8");
                    renameSync(tmp, target);
                  }
                } catch {
                  // non-fatal
                }
              }
            } catch {
              // non-fatal — substrate is additive
            }
          }

          // Cross-project intelligence
          try {
            const { runCrossProjectIntelligence } = await import(
              "../intelligence/cross-project.js"
            );
            await runCrossProjectIntelligence();
          } catch {
            // non-fatal — graph context is additive
          }
        }
      } catch {
        // non-fatal — intelligence is additive
      }

      // Incremental distill → ~/.unfade/distills/ (global, 5 min throttle)
      if (Date.now() - lastIncrementalDistillMs > INCREMENTAL_DISTILL_INTERVAL_MS) {
        try {
          const { distillIncremental } = await import("../distill/distiller.js");
          const today = localToday();
          await distillIncremental(today);
          lastIncrementalDistillMs = Date.now();
        } catch {
          // non-fatal — incremental distill is additive
        }
      }

      // Weekly digest schedule check
      try {
        const { getActionRunner } = await import("../actions/index.js");
        const runner = getActionRunner();
        const actionCtx = {
          repoRoot: undefined as unknown as string,
          config: config as unknown as import("../../schemas/config.js").UnfadeConfig,
          trigger: "schedule_weekly" as const,
        };
        await runner.fire("schedule_weekly", actionCtx);
      } catch {
        // non-fatal
      }
    },
  });
}

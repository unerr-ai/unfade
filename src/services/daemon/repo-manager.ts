// FILE: src/services/daemon/repo-manager.ts
// UF-307: Manages N EmbeddedDaemon + N MaterializerDaemon pairs, one per registered repo.
// Used by unfade-server.ts for startup, hot-add from registry watcher, and graceful shutdown.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config/manager.js";
import { logger } from "../../utils/logger.js";
import { getEventsDir, getProjectDataDir } from "../../utils/paths.js";
import { MaterializerDaemon } from "../cache/materializer-daemon.js";
import {
  aggregateComprehensionByModule,
  computeComprehensionBatch,
  upsertComprehensionScores,
} from "../intelligence/comprehension.js";
import { assignEventsToFeatures, linkRelatedEvents } from "../intelligence/feature-boundary.js";
import { computeDirectionByFile } from "../intelligence/file-direction.js";
import { classifyAllUnclassified } from "../intelligence/outcome-classifier.js";
import { appendRecentInsight } from "../intelligence/recent-insights.js";
import { writePartialSnapshot } from "../intelligence/snapshot.js";
import { writeSummary } from "../intelligence/summary-writer.js";
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

  /**
   * Add a repo: ensure binaries, start daemon, materializer, and scheduler.
   */
  async addRepo(entry: RepoEntry): Promise<ManagedRepo | null> {
    if (this.repos.has(entry.id)) return this.repos.get(entry.id)!;

    try {
      ensureBinaries(entry.root);
    } catch {
      logger.debug(`Repo ${entry.label}: binary not available — skipping`);
      return null;
    }

    const daemon = new EmbeddedDaemon(entry.root, {
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

    managed.scheduler?.stop();
    managed.materializer.stop();
    await managed.daemon.stop();
    await managed.materializer.close();

    this.repos.delete(id);
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
    await Promise.all(stopPromises);

    for (const [, managed] of this.repos) {
      await managed.materializer.close();
    }

    this.repos.clear();
  }
}

/**
 * 11A.4: Wait for the Go daemon's ingest lock to clear before starting materialization.
 * Polls every 500ms, gives up after 30s (materializer tick-based deferral will handle it).
 */
async function waitForIngestClear(repoRoot: string, timeoutMs = 30_000): Promise<void> {
  const lockPath = join(getEventsDir(repoRoot), ".ingest.lock");
  if (!existsSync(lockPath)) return;

  logger.debug("Waiting for ingest lock to clear", { repoRoot });
  const deadline = Date.now() + timeoutMs;
  while (existsSync(lockPath) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (existsSync(lockPath)) {
    logger.debug("Ingest lock still present after timeout — materializer will defer per-tick");
  }
}

function createMaterializerForRepo(
  repoRoot: string,
  config: ReturnType<typeof loadConfig>,
): MaterializerDaemon {
  let lastPartialMs = 0;
  let engine: import("../intelligence/engine.js").IntelligenceEngine | null = null;
  let lastCorrelationMs = 0;
  let lastDebuggingArcMs = 0;

  return new MaterializerDaemon({
    intervalMs: 2000,
    cwd: repoRoot,
    onTick: async function onTick(newRows) {
      if (newRows <= 0) return;

      const { CacheManager } = await import("../cache/manager.js");
      const cache = new CacheManager(repoRoot);
      const db = await cache.getDb();
      if (!db) return;

      try {
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const recentResult = db.exec(
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

        aggregateComprehensionByModule(db);
        computeDirectionByFile(db);
      } catch {
        // non-fatal
      }

      // Feature boundary detection and event linking
      try {
        const recentIds = db.exec(
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

      // 12C.13: Materialize session metrics
      try {
        const { materializeSessionMetrics } = await import(
          "../intelligence/session-materializer.js"
        );
        materializeSessionMetrics(db);
      } catch {
        // non-fatal — session materialization is additive
      }

      try {
        const summary = writeSummary(db, repoRoot, { pricing: config.pricing ?? {} });

        const now = Date.now();
        if (now - lastPartialMs >= PARTIAL_SNAPSHOT_INTERVAL_MS) {
          const today = new Date().toISOString().slice(0, 10);
          writePartialSnapshot(
            today,
            {
              directionDensity: summary.directionDensity24h,
              comprehensionScore: summary.comprehensionScore,
              eventCount: summary.eventCount24h,
              topDomain: summary.topDomain,
            },
            repoRoot,
          );
          lastPartialMs = now;
        }

        appendRecentInsight(repoRoot, {
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
      } catch {
        // non-fatal
      }

      // 12A.5: Outcome classification (before intelligence engine)
      try {
        classifyAllUnclassified(db);
      } catch {
        // non-fatal — classification is additive
      }

      // 12A.2: Intelligence Engine — runs all registered analyzers (10s throttle)
      try {
        if (!engine) {
          const { IntelligenceEngine } = await import("../intelligence/engine.js");
          const { allAnalyzers } = await import("../intelligence/analyzers/all.js");
          engine = new IntelligenceEngine({ minIntervalMs: 10_000 });
          for (const analyzer of allAnalyzers) {
            engine.register(analyzer);
          }
        }
        const results = await engine.run({
          repoRoot,
          db,
          config: config as unknown as Record<string, unknown>,
        });

        // 12B.9: Fire proactive actions on intelligence update
        if (results.length > 0) {
          const { getActionRunner } = await import("../actions/index.js");
          const runner = getActionRunner();
          const actionCtx = {
            repoRoot,
            config: config as unknown as import("../../schemas/config.js").UnfadeConfig,
            trigger: "intelligence_update" as const,
          };
          await runner.fire("intelligence_update", actionCtx);
        }
      } catch {
        // non-fatal — intelligence is additive
      }

      // 13A / UF-402: Decision durability (runs after intelligence engine, needs decisions table)
      try {
        const { computeDecisionDurability, writeDecisionDurability } = await import(
          "../intelligence/decision-durability.js"
        );
        const report = computeDecisionDurability(db);
        if (report.decisions.length > 0) {
          writeDecisionDurability(report, repoRoot);
        }
      } catch {
        // non-fatal — decision durability is additive
      }

      // 13B / UF-405: Cross-analyzer correlations (5 min throttle)
      if (Date.now() - lastCorrelationMs > 300_000) {
        try {
          const { computeCorrelations, writeCorrelations } = await import(
            "../intelligence/cross-analyzer.js"
          );
          const report = computeCorrelations({
            repoRoot,
            db,
            config: config as unknown as Record<string, unknown>,
          });
          if (report.correlations.length > 0) {
            writeCorrelations(report, repoRoot);
            lastCorrelationMs = Date.now();

            // 13B / UF-406: Narrative synthesis (only when fresh correlations exist)
            try {
              const { synthesizeNarratives } = await import(
                "../intelligence/narrative-synthesizer.js"
              );
              synthesizeNarratives(repoRoot);
            } catch {
              // non-fatal
            }
          }
        } catch {
          // non-fatal — correlations are additive
        }
      }

      // 13B / UF-407: Debugging arcs (60s throttle)
      if (Date.now() - lastDebuggingArcMs > 60_000) {
        try {
          const { detectDebuggingArcs, writeDebuggingArcs } = await import(
            "../intelligence/debugging-arcs.js"
          );
          const arcs = detectDebuggingArcs(db);
          if (arcs.length > 0) {
            writeDebuggingArcs(arcs, repoRoot);
          }
          lastDebuggingArcMs = Date.now();
        } catch {
          // non-fatal — debugging arcs are additive
        }
      }

      // 12B.9: Check weekly digest schedule
      try {
        const { getActionRunner } = await import("../actions/index.js");
        const runner = getActionRunner();
        const actionCtx = {
          repoRoot,
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

// FILE: src/services/daemon/repo-manager.ts
// UF-307: Manages N EmbeddedDaemon + N MaterializerDaemon pairs, one per registered repo.
// Used by unfade-server.ts for startup, hot-add from registry watcher, and graceful shutdown.

import { loadConfig } from "../../config/manager.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir } from "../../utils/paths.js";
import { MaterializerDaemon } from "../cache/materializer-daemon.js";
import {
  aggregateComprehensionByModule,
  computeComprehensionBatch,
  upsertComprehensionScores,
} from "../intelligence/comprehension.js";
import { computeDirectionByFile } from "../intelligence/file-direction.js";
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

    const daemon = new EmbeddedDaemon(entry.root);
    daemon.start();

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

function createMaterializerForRepo(
  repoRoot: string,
  config: ReturnType<typeof loadConfig>,
): MaterializerDaemon {
  let lastPartialMs = 0;

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
           WHERE ts >= '${cutoff}' AND source IN ('ai-session', 'mcp-active')
             AND id NOT IN (SELECT event_id FROM comprehension_proxy)
           LIMIT 100`,
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
    },
  });
}

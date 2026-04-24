// FILE: src/server/unfade-server.ts
// Phase 5.7: Unified server entry point — the single `unfade` command.
// Reads registry, delegates to RepoManager for daemon + materializer per repo,
// starts HTTP server, polls registry for hot-adds.

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  printInitStep,
  printRepoResuming,
  printRepoStarted,
  printServerHeader,
  printServerReady,
  printShutdownComplete,
  printShutdownCursorSaved,
  printShutdownDaemonStopped,
  printShutdownStart,
  printShutdownStep,
} from "../cli/server-banner.js";
import { loadConfig } from "../config/manager.js";
import { RepoManager } from "../services/daemon/repo-manager.js";
import { tryGenerateFirstRunReport } from "../services/intelligence/first-run-trigger.js";
import { loadRegistry, type RepoEntry, registerRepo } from "../services/registry/registry.js";
import { sendIPCCommand, waitForDaemonIPCReady } from "../utils/ipc.js";
import { logger } from "../utils/logger.js";
import { getDaemonProjectRoot, getDistillsDir, getEventsDir, getStateDir } from "../utils/paths.js";
import { type RunningServer, startServer } from "./http.js";
import { isSetupComplete, updateSynthesisProgress } from "./setup-state.js";
import { closeServerCache } from "./shared-cache.js";

const REGISTRY_POLL_INTERVAL_MS = 60_000;

export interface RunningUnfade {
  server: RunningServer;
  repoManager: RepoManager;
  shutdown: () => Promise<void>;
}

/**
 * Start the unified Unfade server for all registered repos.
 */
export async function startUnfadeServer(cwd?: string): Promise<RunningUnfade> {
  const effectiveCwd = cwd ?? process.cwd();

  printServerHeader();

  // Ensure cwd is registered
  const projectRoot = getDaemonProjectRoot(effectiveCwd);
  registerRepo(projectRoot);

  // Load config + registry
  const config = loadConfig();
  const registry = loadRegistry();

  // Start HTTP server first (so dashboard is available during daemon startup)
  const server = await startServer({ config, cwd: effectiveCwd });

  // Start RepoManager — daemons only start if setup is already complete
  const repoManager = new RepoManager();

  // Expose repo manager on global so setup route can trigger pipeline later
  (globalThis as Record<string, unknown>).__unfade_repo_manager = repoManager;

  if (isSetupComplete()) {
    // Setup already done — start capture pipeline immediately
    updateSynthesisProgress({ phase: "materializing", percent: 0 });
    await startCapturePipeline(repoManager, registry.repos);
    printServerReady(server.info.port, repoManager.size);
  } else {
    // Setup not done — daemons will start when POST /api/setup/complete fires
    printServerReady(server.info.port, 0);
    logger.info("Setup incomplete — daemons deferred until onboarding completes");
  }

  // Poll registry for hot-added repos
  const registryTimer = setInterval(() => {
    try {
      const currentRegistry = loadRegistry();
      for (const entry of currentRegistry.repos) {
        if (!repoManager.get(entry.id)) {
          logger.debug("Hot-adding new repo", { id: entry.id, label: entry.label });
          repoManager.addRepo(entry).then((managed) => {
            if (managed) triggerIngestWhenReady(entry.root);
          });
        }
      }
    } catch {
      // non-fatal
    }
  }, REGISTRY_POLL_INTERVAL_MS);

  // Shutdown handler — orchestrated with detailed progress
  const shutdown = async () => {
    clearInterval(registryTimer);
    printShutdownStart();

    // 1. Stop schedulers
    printShutdownStep("Stopping schedulers...");
    for (const [, managed] of repoManager.getAll()) {
      managed.scheduler?.stop();
    }

    // 2. Final materialization tick + save cursors
    printShutdownStep("Final materialization + saving state...");
    for (const [, managed] of repoManager.getAll()) {
      try {
        const cursorState = await managed.materializer.getCursorState();
        printShutdownCursorSaved(managed.entry.label, cursorState.totalByteOffset);
      } catch {
        // best effort
      }
    }

    // 3. Close materializers (triggers final tick + cursor save + DB close)
    for (const [, managed] of repoManager.getAll()) {
      await managed.materializer.close();
    }

    // 4. Stop ALL daemons (per-project + global AI capture)
    printShutdownStep("Stopping capture engines...");
    const stopPromises: Promise<void>[] = [];
    for (const [, managed] of repoManager.getAll()) {
      const pid = managed.daemon.getPid();
      stopPromises.push(
        managed.daemon.stop().then(() => {
          printShutdownDaemonStopped(managed.entry.label, pid);
        }),
      );
    }
    stopPromises.push(
      repoManager.stopGlobalAICapture().then(() => {
        printShutdownStep("Global AI capture stopped");
      }),
    );
    await Promise.all(stopPromises);

    // 5. Close shared cache + server
    await closeServerCache();
    printShutdownStep("Closing server...");
    server.close();
    try {
      unlinkSync(join(getStateDir(effectiveCwd), "server.json"));
    } catch {
      // may already be gone
    }

    printShutdownComplete();
  };

  return { server, repoManager, shutdown };
}

/**
 * Start all capture daemons, materializers, ingest, and distill backfill.
 * Called immediately if setup is complete, or deferred until POST /api/setup/complete.
 */
export async function startCapturePipeline(
  repoManager: RepoManager,
  repos?: RepoEntry[],
): Promise<void> {
  const registry = repos ?? loadRegistry().repos;

  // Start single global AI capture daemon
  repoManager.startGlobalAICapture();

  for (const entry of registry) {
    const managed = await repoManager.addRepo(entry);
    if (managed) {
      const isResume = existsSync(join(entry.root, ".unfade", "state", "materializer.json"));
      if (isResume) {
        printRepoResuming(entry.label, estimateProcessedEvents(entry.root));
      } else {
        printRepoStarted(entry.label, managed.daemon.getPid() ?? 0);
      }

      triggerIngestWhenReady(entry.root);
      tryGenerateFirstRunReport(entry.root);
    } else {
      printInitStep(`${entry.label}: skipped (binary not available)`);
    }
  }

  // Expose primary repo's materializer for SSE health ticks
  const primaryManaged = repoManager.get(registry[0]?.id ?? "");
  if (primaryManaged) {
    (globalThis as Record<string, unknown>).__unfade_materializer = primaryManaged.materializer;
  }

  triggerBackfillDistill();

  logger.info("Capture pipeline started", { repos: registry.length });
}

async function triggerIngestWhenReady(repoRoot: string): Promise<void> {
  try {
    // Check if ingest is actively running — only skip if still in progress.
    // The Go daemon handles "completed" state internally: it uses the last
    // completion timestamp as the new boundary to collect missed data.
    const ingestPath = join(repoRoot, ".unfade", "state", "ingest.json");
    if (existsSync(ingestPath)) {
      const ingest = JSON.parse(readFileSync(ingestPath, "utf-8"));
      if (ingest.status === "running") {
        const startedAt = Date.parse(ingest.startedAt ?? "");
        if (startedAt > 0 && Date.now() - startedAt > 3600_000) {
          logger.warn("Stale ingest detected (>1h), marking as failed for re-trigger", {
            repoRoot,
          });
          const recovered = {
            ...ingest,
            status: "failed",
            failedAt: new Date().toISOString(),
            reason: "Timeout — process likely crashed",
          };
          const tmpPath = `${ingestPath}.tmp.${process.pid}`;
          writeFileSync(tmpPath, JSON.stringify(recovered, null, 2), "utf-8");
          renameSync(tmpPath, ingestPath);
        } else {
          logger.debug("Ingest still running, skipping re-trigger", { repoRoot });
          return;
        }
      }
    }

    const ready = await waitForDaemonIPCReady(repoRoot, 10_000);
    if (ready) {
      await sendIPCCommand({ cmd: "ingest" }, repoRoot, 5000);
    }
  } catch {
    // non-fatal
  }
}

/**
 * Backfill distills for all event dates that don't have a distill yet.
 * Uses global paths (~/.unfade/) — not per-repo. Fire-and-forget.
 */
function triggerBackfillDistill(): void {
  const eventsDir = getEventsDir();
  const distillsDir = getDistillsDir();

  if (!existsSync(eventsDir)) return;

  (async () => {
    try {
      const eventFiles = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
      if (eventFiles.length === 0) return;

      const { distillIncremental } = await import("../services/distill/distiller.js");

      const dates = eventFiles
        .map((f) => f.replace(".jsonl", ""))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();

      const existingDistills = new Set(
        existsSync(distillsDir)
          ? readdirSync(distillsDir)
              .filter((f) => f.endsWith(".md"))
              .map((f) => f.replace(".md", ""))
          : [],
      );

      const missing = dates.filter((d) => !existingDistills.has(d));
      if (missing.length === 0) return;

      logger.info("Backfill distill: processing undistilled days", {
        total: dates.length,
        missing: missing.length,
      });

      for (const date of missing) {
        await distillIncremental(date);
      }

      logger.info("Backfill distill complete", { days: missing.length });
    } catch {
      // non-fatal — backfill distill is best-effort
    }
  })();
}

function estimateProcessedEvents(repoRoot: string): number {
  try {
    const cursorPath = join(repoRoot, ".unfade", "state", "materializer.json");
    if (!existsSync(cursorPath)) return 0;
    const cursor = JSON.parse(readFileSync(cursorPath, "utf-8"));
    let totalBytes = 0;
    for (const stream of Object.values(cursor.streams ?? {})) {
      totalBytes += (stream as { byteOffset?: number }).byteOffset ?? 0;
    }
    return totalBytes > 0 ? Math.floor(totalBytes / 200) : 0;
  } catch {
    return 0;
  }
}

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
import { getDaemonProjectRoot, getStateDir } from "../utils/paths.js";
import { type RunningServer, startServer } from "./http.js";

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

  // Start RepoManager with all registered repos
  const repoManager = new RepoManager();

  // Start single global AI capture daemon (watches ~/.claude/, Cursor, Codex, Aider)
  repoManager.startGlobalAICapture();

  for (const entry of registry.repos) {
    const managed = await repoManager.addRepo(entry);
    if (managed) {
      const isResume = existsSync(join(entry.root, ".unfade", "state", "materializer.json"));
      if (isResume) {
        printRepoResuming(entry.label, estimateProcessedEvents(entry.root));
      } else {
        printRepoStarted(entry.label, managed.daemon.getPid() ?? 0);
      }

      // Trigger ingest in background (non-blocking)
      triggerIngestWhenReady(entry.root);

      // First-run analysis if needed
      tryGenerateFirstRunReport(entry.root);

      // First-run incremental distill: populate distills/profile/graph immediately
      // when events exist but no distills have been generated yet.
      triggerFirstRunDistill(entry.root);
    } else {
      printInitStep(`${entry.label}: skipped (binary not available)`);
    }
  }

  // Expose repo manager on global for health endpoint
  (globalThis as Record<string, unknown>).__unfade_repo_manager = repoManager;

  // Expose primary repo's materializer for SSE health ticks (Fix 2)
  const primaryManaged = repoManager.get(registry.repos[0]?.id ?? "");
  if (primaryManaged) {
    (globalThis as Record<string, unknown>).__unfade_materializer = primaryManaged.materializer;
  }

  printServerReady(server.info.port, repoManager.size);

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

    // 4. Stop daemons
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
    await Promise.all(stopPromises);

    // 5. Close server
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

async function triggerIngestWhenReady(repoRoot: string): Promise<void> {
  try {
    // Fix 5: Check ingest state — skip if already completed or running
    const ingestPath = join(repoRoot, ".unfade", "state", "ingest.json");
    if (existsSync(ingestPath)) {
      const ingest = JSON.parse(readFileSync(ingestPath, "utf-8"));
      if (ingest.status === "completed") {
        logger.debug("Ingest already completed, skipping", { repoRoot });
        return;
      }
      if (ingest.status === "running") {
        // Crash recovery: if running for > 1 hour, mark as failed
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
      await sendIPCCommand({ cmd: "ingest", args: { days: 7 } }, repoRoot, 5000);
    }
  } catch {
    // non-fatal
  }
}

/**
 * On first run, if events/ has data but distills/ is empty, run incremental
 * distill for each day with events. Non-blocking — runs in background.
 */
function triggerFirstRunDistill(repoRoot: string): void {
  const distillsDir = join(repoRoot, ".unfade", "distills");
  const eventsDir = join(repoRoot, ".unfade", "events");

  // Only trigger if distills/ is empty or missing, and events/ has files
  if (existsSync(distillsDir)) {
    const files = readdirSync(distillsDir).filter((f) => f.endsWith(".md"));
    if (files.length > 0) return; // Already have distills
  }

  if (!existsSync(eventsDir)) return;

  // Fire and forget — run in background
  (async () => {
    try {
      const eventFiles = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
      if (eventFiles.length === 0) return;

      const { distillIncremental } = await import("../services/distill/distiller.js");

      // Extract dates from filenames (YYYY-MM-DD.jsonl)
      const dates = eventFiles
        .map((f) => f.replace(".jsonl", ""))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();

      logger.debug("First-run distill: processing event days", { count: dates.length, repoRoot });

      for (const date of dates) {
        await distillIncremental(date, { cwd: repoRoot });
      }

      logger.debug("First-run distill complete", { days: dates.length });
    } catch {
      // non-fatal — first-run distill is best-effort
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

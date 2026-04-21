// FILE: src/server/routes/system-health.ts
// Fix 2: Unified system health endpoint — aggregates daemon, materializer, config, and ingest status.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { getProjectDataDir, getStateDir } from "../../utils/paths.js";

export const systemHealthRoutes = new Hono();

interface RepoHealth {
  id: string;
  label: string;
  root: string;
  daemonPid: number | null;
  daemonRunning: boolean;
  daemonRestartCount: number;
  daemonUptimeMs: number;
  materializerLagMs: number;
}

interface SystemHealthResponse {
  status: "ok" | "degraded";
  version: string;
  pid: number;
  uptime: number;
  configuredProvider: string;
  configuredModel: string;
  repoCount: number;
  repos: RepoHealth[];
  ingestStatus: string | null;
  intelligenceReady: boolean;
  degradedReasons: string[];
}

/**
 * GET /api/system/health — unified health aggregating all subsystems.
 * Used by UI health chips, CLI `unfade status`, and monitoring.
 */
systemHealthRoutes.get("/api/system/health", (c) => {
  const repoManager = (globalThis as Record<string, unknown>).__unfade_repo_manager as
    | {
        getHealthStatus(): RepoHealth[];
        size: number;
      }
    | undefined;

  const repos = repoManager?.getHealthStatus() ?? [];
  const degradedReasons: string[] = [];

  // Check config
  let configuredProvider = "none";
  let configuredModel = "llama3.2";
  try {
    const configPath = join(getProjectDataDir(), "config.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      configuredProvider = raw?.distill?.provider ?? "none";
      configuredModel = raw?.distill?.model ?? "llama3.2";
    }
  } catch {
    // fallback to defaults
  }

  if (configuredProvider === "none") {
    degradedReasons.push("No LLM provider configured");
  }

  // Check ingest status
  let ingestStatus: string | null = null;
  try {
    const ingestPath = join(getStateDir(), "ingest.json");
    if (existsSync(ingestPath)) {
      const ingest = JSON.parse(readFileSync(ingestPath, "utf-8"));
      ingestStatus = ingest.status ?? null;
    }
  } catch {
    // no ingest state
  }

  // Check daemon health
  for (const repo of repos) {
    if (!repo.daemonRunning) {
      degradedReasons.push(`Capture engine not running for ${repo.label}`);
    }
    if (repo.daemonRestartCount > 0) {
      degradedReasons.push(
        `Capture engine for ${repo.label} restarted ${repo.daemonRestartCount} time(s)`,
      );
    }
    if (repo.materializerLagMs > 30_000) {
      degradedReasons.push(
        `Materializer lag for ${repo.label}: ${Math.round(repo.materializerLagMs / 1000)}s`,
      );
    }
  }

  // Check intelligence readiness
  let intelligenceReady = false;
  try {
    const intelligenceDir = join(getProjectDataDir(), "intelligence");
    intelligenceReady = existsSync(join(intelligenceDir, "efficiency.json"));
  } catch {
    // not ready
  }

  const status: SystemHealthResponse = {
    status: degradedReasons.length > 0 ? "degraded" : "ok",
    version: "0.1.0",
    pid: process.pid,
    uptime: process.uptime(),
    configuredProvider,
    configuredModel,
    repoCount: repoManager?.size ?? 0,
    repos,
    ingestStatus,
    intelligenceReady,
    degradedReasons,
  };

  return c.json({
    data: status,
    _meta: { tool: "system-health", durationMs: 0 },
  });
});

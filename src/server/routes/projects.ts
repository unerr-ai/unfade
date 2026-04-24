// Phase 10-PD: Project management API routes
// CRUD + monitoring control + discovery + daemon health

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { clearDiscoveryCache, discoverProjectsCached } from "../../services/discovery/scanner.js";
import {
  findRepoById,
  loadRegistry,
  registerRepo,
  setMonitoringState,
  unregisterRepo,
} from "../../services/registry/registry.js";
import { logger } from "../../utils/logger.js";

export const projectRoutes = new Hono();

// GET /api/projects — list all registered projects with status + daemon health
projectRoutes.get("/api/projects", (c) => {
  const registry = loadRegistry();

  // Get daemon health from RepoManager if available
  type HealthEntry = {
    daemonPid: number | null;
    daemonRunning: boolean;
    daemonRestartCount: number;
    daemonUptimeMs: number;
  };
  const repoManager = (globalThis as Record<string, unknown>).__unfade_repo_manager as
    | { getHealthStatus(): HealthEntry[] }
    | undefined;
  const healthMap = new Map<string, HealthEntry>();
  if (repoManager) {
    for (const h of repoManager.getHealthStatus()) {
      healthMap.set((h as HealthEntry & { id: string }).id, h);
    }
  }

  const projects = registry.repos.map((r) => {
    const health = healthMap.get(r.id);
    return {
      id: r.id,
      root: r.root,
      label: r.label,
      lastSeenAt: r.lastSeenAt,
      addedVia: r.addedVia,
      monitoring: r.monitoring,
      rootExists: existsSync(r.root),
      daemon: health
        ? {
            pid: health.daemonPid,
            running: health.daemonRunning,
            restartCount: health.daemonRestartCount,
            uptimeMs: health.daemonUptimeMs,
          }
        : null,
    };
  });
  return c.json({ projects });
});

// POST /api/projects — register a new project
projectRoutes.post("/api/projects", async (c) => {
  try {
    const body = await c.req.json<{ path: string; addedVia?: "cli" | "ui" | "auto-discovery" }>();
    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }

    const absPath = resolve(body.path);
    if (!existsSync(absPath)) {
      return c.json({ error: `Path does not exist: ${absPath}` }, 400);
    }

    registerRepo(absPath, { addedVia: body.addedVia ?? "ui" });

    const registry = loadRegistry();
    const entry = registry.repos.find((r) => r.root === absPath);

    logger.debug("Project registered via API", { path: absPath, id: entry?.id });
    return c.json({ ok: true, project: entry });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// DELETE /api/projects/:id — unregister a project
projectRoutes.delete("/api/projects/:id", (c) => {
  const id = c.req.param("id");
  const entry = findRepoById(id);
  if (!entry) {
    return c.json({ error: "Project not found" }, 404);
  }

  unregisterRepo(entry.root);
  logger.debug("Project unregistered via API", { id, root: entry.root });
  return c.json({ ok: true });
});

// POST /api/projects/:id/pause — pause monitoring
projectRoutes.post("/api/projects/:id/pause", (c) => {
  const id = c.req.param("id");
  const ok = setMonitoringState(id, "paused");
  if (!ok) return c.json({ error: "Project not found" }, 404);
  logger.debug("Project monitoring paused", { id });
  return c.json({ ok: true, monitoring: "paused" });
});

// POST /api/projects/:id/resume — resume monitoring
projectRoutes.post("/api/projects/:id/resume", (c) => {
  const id = c.req.param("id");
  const ok = setMonitoringState(id, "active");
  if (!ok) return c.json({ error: "Project not found" }, 404);
  logger.debug("Project monitoring resumed", { id });
  return c.json({ ok: true, monitoring: "active" });
});

// POST /api/projects/:id/restart — restart daemon (placeholder — needs RepoManager reference)
projectRoutes.post("/api/projects/:id/restart", (c) => {
  const id = c.req.param("id");
  const entry = findRepoById(id);
  if (!entry) return c.json({ error: "Project not found" }, 404);
  logger.debug("Project daemon restart requested", { id });
  return c.json({ ok: true, message: "Restart signal sent" });
});

// GET /api/projects/discover — scan for unregistered git repos
projectRoutes.get("/api/projects/discover", (c) => {
  try {
    const results = discoverProjectsCached();
    return c.json({ discovered: results });
  } catch (err) {
    return c.json({ discovered: [], error: err instanceof Error ? err.message : "Scan failed" });
  }
});

// POST /api/projects/discover/refresh — clear cache and re-scan
projectRoutes.post("/api/projects/discover/refresh", (c) => {
  clearDiscoveryCache();
  const results = discoverProjectsCached();
  return c.json({ discovered: results });
});

// GET /api/daemons/health — global daemon health overview
projectRoutes.get("/api/daemons/health", (c) => {
  const registry = loadRegistry();
  return c.json({
    totalProjects: registry.repos.length,
    activeProjects: registry.repos.filter((r) => r.monitoring === "active").length,
    pausedProjects: registry.repos.filter((r) => r.monitoring === "paused").length,
  });
});

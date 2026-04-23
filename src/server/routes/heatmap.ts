import { Hono } from "hono";
import { CacheManager } from "../../services/cache/manager.js";
import { readModuleComprehension } from "../../services/intelligence/comprehension.js";
import { readDirectionByFile } from "../../services/intelligence/file-direction.js";
import { findRepoById } from "../../services/registry/registry.js";

export const heatmapRoutes = new Hono();

interface HeatmapModule {
  path: string;
  directionDensity: number;
  comprehensionScore: number | null;
  eventCount: number;
  riskLevel: "augmented" | "neutral" | "dependent";
}

function classifyRisk(direction: number): "augmented" | "neutral" | "dependent" {
  if (direction >= 60) return "augmented";
  if (direction >= 35) return "neutral";
  return "dependent";
}

// GET /api/repos/:id/heatmap — heatmap data for a specific repo
heatmapRoutes.get("/api/repos/:id/heatmap", async (c) => {
  const id = c.req.param("id");
  const repo = findRepoById(id);
  if (!repo) {
    return c.json({ error: "Repo not found" }, 404);
  }

  const cache = new CacheManager(repo.root);
  await cache.getDb();
  const analyticsDb = cache.analytics;
  if (!analyticsDb) {
    return c.json({ modules: [] });
  }

  const directionEntries = await readDirectionByFile(analyticsDb);
  const comprehensionEntries = await readModuleComprehension(analyticsDb);

  const comprehensionMap = new Map(comprehensionEntries.map((m) => [m.module, m.score]));

  const modules: HeatmapModule[] = directionEntries.map((entry) => ({
    path: entry.path,
    directionDensity: entry.directionDensity,
    comprehensionScore: comprehensionMap.get(entry.path) ?? null,
    eventCount: entry.eventCount,
    riskLevel: classifyRisk(entry.directionDensity),
  }));

  await cache.close();

  return c.json({
    repoId: id,
    repoLabel: repo.label,
    modules,
  });
});

// GET /heatmap — heatmap for the current project (single-repo mode)
heatmapRoutes.get("/api/heatmap", async (c) => {
  const cache = new CacheManager();
  const db = await cache.getDb();
  if (!db) {
    return c.json({ modules: [] });
  }

  const directionEntries = await readDirectionByFile(db);
  const comprehensionEntries = await readModuleComprehension(db);

  const comprehensionMap = new Map(comprehensionEntries.map((m) => [m.module, m.score]));

  const modules: HeatmapModule[] = directionEntries.map((entry) => ({
    path: entry.path,
    directionDensity: entry.directionDensity,
    comprehensionScore: comprehensionMap.get(entry.path) ?? null,
    eventCount: entry.eventCount,
    riskLevel: classifyRisk(entry.directionDensity),
  }));

  await cache.close();

  return c.json({ modules });
});

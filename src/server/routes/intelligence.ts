// FILE: src/server/routes/intelligence.ts
// UF-104/UF-105 + 11E.4: API routes for Phase 7 intelligence data.
// Reads from .unfade/intelligence/*.json files (written by IntelligenceEngine).
// 11E.4: Lineage endpoint for insight drill-through.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { CacheManager } from "../../services/cache/manager.js";
import { getEventsForInsight } from "../../services/intelligence/lineage.js";
import { getProjectDataDir } from "../../utils/paths.js";

export const intelligenceRoutes = new Hono();

function readIntelligenceFile(filename: string, cwd?: string): unknown | null {
  const path = join(getProjectDataDir(cwd), "intelligence", filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function jsonOr202(
  c: {
    json: (data: unknown, status?: number) => Response;
    body: (data: null, status: number) => Response;
  },
  data: unknown,
) {
  if (!data)
    return c.json(
      {
        status: "warming_up",
        message: "Intelligence engine is collecting data. Results will appear shortly.",
      },
      202,
    );
  return c.json(data);
}

intelligenceRoutes.get("/api/intelligence/efficiency", (c) =>
  jsonOr202(c, readIntelligenceFile("efficiency.json")),
);
intelligenceRoutes.get("/api/intelligence/costs", (c) =>
  jsonOr202(c, readIntelligenceFile("costs.json")),
);
intelligenceRoutes.get("/api/intelligence/comprehension", (c) =>
  jsonOr202(c, readIntelligenceFile("comprehension.json")),
);
intelligenceRoutes.get("/api/intelligence/prompt-patterns", (c) =>
  jsonOr202(c, readIntelligenceFile("prompt-patterns.json")),
);
intelligenceRoutes.get("/api/intelligence/coach", (c) =>
  jsonOr202(c, readIntelligenceFile("prompt-patterns.json")),
);
intelligenceRoutes.get("/api/intelligence/velocity", (c) =>
  jsonOr202(c, readIntelligenceFile("velocity.json")),
);
intelligenceRoutes.get("/api/intelligence/rejections", (c) =>
  jsonOr202(c, readIntelligenceFile("rejections.idx.json")),
);
intelligenceRoutes.get("/api/intelligence/alerts", (c) =>
  jsonOr202(c, readIntelligenceFile("alerts.json")),
);
intelligenceRoutes.get("/api/intelligence/replays", (c) =>
  jsonOr202(c, readIntelligenceFile("replays.json")),
);

// 11E.4: Lineage endpoint — returns source events and analyzer chain for an insight
intelligenceRoutes.get("/api/intelligence/lineage/:insightId", async (c) => {
  const insightId = c.req.param("insightId");
  if (!insightId) {
    return c.json({ data: null, _meta: { error: "Missing insightId" } }, 400);
  }

  const cache = new CacheManager();
  const db = await cache.getDb();
  if (!db) {
    return c.json(
      { data: null, _meta: { degraded: true, degradedReason: "No cache database" } },
      503,
    );
  }

  try {
    const mappings = getEventsForInsight(db, insightId);
    if (mappings.length === 0) {
      return c.json({ data: { insight: insightId, sourceEvents: [], analyzerChain: [] }, _meta: { tool: "lineage" } });
    }

    // Get unique analyzers in the chain
    const analyzerChain = [...new Set(mappings.map((m) => m.analyzer))];

    // Fetch actual event data for the source events
    const eventIds = mappings.map((m) => m.eventId);
    const placeholders = eventIds.map(() => "?").join(",");
    const result = db.exec(
      `SELECT id, ts, source, content_summary, git_branch,
              json_extract(metadata, '$.domain') as domain
       FROM events WHERE id IN (${placeholders})
       ORDER BY ts DESC`,
      eventIds,
    );

    const sourceEvents = (result[0]?.values ?? []).map((row) => ({
      id: row[0] as string,
      ts: row[1] as string,
      source: row[2] as string,
      summary: row[3] as string,
      branch: row[4] as string | null,
      domain: row[5] as string | null,
      contributionWeight: mappings.find((m) => m.eventId === row[0])?.contributionWeight ?? 1.0,
    }));

    return c.json({
      data: { insight: insightId, sourceEvents, analyzerChain },
      _meta: { tool: "lineage", durationMs: 0 },
    });
  } catch (err) {
    return c.json(
      { data: null, _meta: { degraded: true, degradedReason: err instanceof Error ? err.message : String(err) } },
      500,
    );
  }
});

// 11E.2: Narratives endpoint
intelligenceRoutes.get("/api/intelligence/narratives", (c) => {
  const dir = join(getProjectDataDir(), "intelligence");
  const filePath = join(dir, "narratives.jsonl");
  if (!existsSync(filePath)) return jsonOr202(c, null);
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return jsonOr202(c, null);
    const narratives = content
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    return c.json({ narratives, count: narratives.length });
  } catch {
    return jsonOr202(c, null);
  }
});

// 11E.1: Correlations endpoint
intelligenceRoutes.get("/api/intelligence/correlations", (c) =>
  jsonOr202(c, readIntelligenceFile("correlation.json")),
);

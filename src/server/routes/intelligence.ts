// FILE: src/server/routes/intelligence.ts
// UF-104/UF-105 + 11E.4: API routes for Phase 7 intelligence data.
// Reads from .unfade/intelligence/*.json files (written by IntelligenceEngine).
// 11E.4: Lineage endpoint for insight drill-through.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { CacheManager } from "../../services/cache/manager.js";
import { getEventsForInsight } from "../../services/intelligence/lineage.js";
import { getIntelligenceDir, getProjectDataDir } from "../../utils/paths.js";

export const intelligenceRoutes = new Hono();

async function readIntelligenceFile(filename: string): Promise<unknown | null> {
  const path = join(getIntelligenceDir(), filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8"));
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

intelligenceRoutes.get("/api/intelligence/efficiency", async (c) =>
  jsonOr202(c, await readIntelligenceFile("efficiency.json")),
);
intelligenceRoutes.get("/api/intelligence/costs", async (c) =>
  jsonOr202(c, await readIntelligenceFile("costs.json")),
);
intelligenceRoutes.get("/api/intelligence/comprehension", async (c) =>
  jsonOr202(c, await readIntelligenceFile("comprehension.json")),
);
intelligenceRoutes.get("/api/intelligence/prompt-patterns", async (c) =>
  jsonOr202(c, await readIntelligenceFile("prompt-patterns.json")),
);
intelligenceRoutes.get("/api/intelligence/coach", async (c) =>
  jsonOr202(c, await readIntelligenceFile("prompt-patterns.json")),
);
intelligenceRoutes.get("/api/intelligence/velocity", async (c) =>
  jsonOr202(c, await readIntelligenceFile("velocity.json")),
);
intelligenceRoutes.get("/api/intelligence/rejections", async (c) =>
  jsonOr202(c, await readIntelligenceFile("rejections.idx.json")),
);
intelligenceRoutes.get("/api/intelligence/alerts", async (c) =>
  jsonOr202(c, await readIntelligenceFile("alerts.json")),
);
intelligenceRoutes.get("/api/intelligence/replays", async (c) =>
  jsonOr202(c, await readIntelligenceFile("replays.json")),
);

// 13A / UF-401: Decision durability endpoint (consumed by velocity-page.ts)
intelligenceRoutes.get("/api/intelligence/decision-durability", async (c) =>
  jsonOr202(c, await readIntelligenceFile("decision-durability.json")),
);

// 13C / UF-410: Actions log endpoint — reads .unfade/logs/actions.jsonl
intelligenceRoutes.get("/api/intelligence/actions", async (c) => {
  const logsDir = join(getProjectDataDir(), "logs");
  const filePath = join(logsDir, "actions.jsonl");
  if (!existsSync(filePath)) return c.json({ actions: [], count: 0 });
  try {
    const content = (await readFile(filePath, "utf-8")).trim();
    if (!content) return c.json({ actions: [], count: 0 });
    const actions = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse()
      .slice(0, 10);
    return c.json({ actions, count: actions.length });
  } catch {
    return c.json({ actions: [], count: 0 });
  }
});

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
    const mappings = await getEventsForInsight(db, insightId);
    if (mappings.length === 0) {
      return c.json({
        data: { insight: insightId, sourceEvents: [], analyzerChain: [] },
        _meta: { tool: "lineage" },
      });
    }

    // Get unique analyzers in the chain
    const analyzerChain = [...new Set(mappings.map((m) => m.analyzer))];

    // Fetch actual event data for the source events
    const eventIds = mappings.map((m) => m.eventId);
    const placeholders = eventIds.map(() => "?").join(",");
    const result = await db.exec(
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
      {
        data: null,
        _meta: { degraded: true, degradedReason: err instanceof Error ? err.message : String(err) },
      },
      500,
    );
  }
});

// 11E.2: Narratives endpoint
intelligenceRoutes.get("/api/intelligence/narratives", async (c) => {
  const filePath = join(getIntelligenceDir(), "narratives.jsonl");
  if (!existsSync(filePath)) return jsonOr202(c, null);
  try {
    const content = (await readFile(filePath, "utf-8")).trim();
    if (!content) return jsonOr202(c, null);
    const narratives = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return c.json({ narratives, count: narratives.length });
  } catch {
    return jsonOr202(c, null);
  }
});

// 11E.1: Correlations endpoint
intelligenceRoutes.get("/api/intelligence/correlations", async (c) =>
  jsonOr202(c, await readIntelligenceFile("correlation.json")),
);

// Sprint 15G: Phase 16 intelligence endpoints
intelligenceRoutes.get("/api/intelligence/maturity-assessment", async (c) =>
  jsonOr202(c, await readIntelligenceFile("maturity-assessment.json")),
);
intelligenceRoutes.get("/api/intelligence/commit-analysis", async (c) =>
  jsonOr202(c, await readIntelligenceFile("commit-analysis.json")),
);
intelligenceRoutes.get("/api/intelligence/expertise-map", async (c) =>
  jsonOr202(c, await readIntelligenceFile("expertise-map.json")),
);
intelligenceRoutes.get("/api/intelligence/dual-velocity", async (c) =>
  jsonOr202(c, await readIntelligenceFile("dual-velocity.json")),
);
intelligenceRoutes.get("/api/intelligence/efficiency-survival", async (c) =>
  jsonOr202(c, await readIntelligenceFile("efficiency-survival.json")),
);
intelligenceRoutes.get("/api/intelligence/file-churn", async (c) =>
  jsonOr202(c, await readIntelligenceFile("file-churn.json")),
);
intelligenceRoutes.get("/api/intelligence/ai-git-links", async (c) =>
  jsonOr202(c, await readIntelligenceFile("ai-git-links.json")),
);
intelligenceRoutes.get("/api/intelligence/sessions/active", async (c) =>
  jsonOr202(c, await readIntelligenceFile("sessions-active.json")),
);
intelligenceRoutes.get("/api/intelligence/diagnostics/active", async (c) =>
  jsonOr202(c, await readIntelligenceFile("diagnostics-active.json")),
);
intelligenceRoutes.get("/api/intelligence/cross-project", async (c) =>
  jsonOr202(c, await readIntelligenceFile("cross-project.json")),
);

// Sprint 15F: Autonomy composite endpoint
intelligenceRoutes.get("/api/intelligence/autonomy", async (c) => {
  const efficiency = (await readIntelligenceFile("efficiency.json")) as {
    aes?: number;
    subMetrics?: {
      directionDensity?: { value: number };
      modificationDepth?: { value: number };
      contextLeverage?: { value: number };
    };
    history?: Array<{ date: string; aes: number }>;
  } | null;

  const comprehension = (await readIntelligenceFile("comprehension.json")) as {
    overall?: number;
    byModule?: Record<string, { score: number; sessions: number }>;
    blindSpots?: Array<{ module: string }>;
  } | null;

  if (!efficiency && !comprehension) return jsonOr202(c, null);

  const hds = efficiency?.subMetrics?.directionDensity?.value ?? 0;
  const modRate = efficiency?.subMetrics?.modificationDepth?.value ?? 0;
  const ctxLeverage = efficiency?.subMetrics?.contextLeverage?.value ?? 0;
  const compOverall = comprehension?.overall ?? 0;
  const compTrend = Math.min(100, Math.max(0, compOverall));

  const independenceIndex = Math.round(
    hds * 0.3 + modRate * 0.25 + ctxLeverage * 0.2 + compTrend * 0.25,
  );

  const trend: "improving" | "stable" | "declining" =
    (efficiency?.history?.length ?? 0) >= 7
      ? (() => {
          const hist = efficiency!.history!;
          const recent = hist.slice(-3).reduce((s, h) => s + h.aes, 0) / 3;
          const older = hist.slice(-7, -3).reduce((s, h) => s + h.aes, 0) / Math.min(4, hist.length - 3);
          return recent > older + 3 ? "improving" : recent < older - 3 ? "declining" : "stable";
        })()
      : "stable";

  const dependencyMap = comprehension?.byModule
    ? Object.entries(comprehension.byModule).map(([domain, data]) => ({
        domain,
        acceptanceRate: Math.max(0, 100 - (data.score ?? 50)),
        comprehension: data.score ?? 50,
      }))
    : [];

  return c.json({
    independenceIndex,
    breakdown: {
      hds: Math.round(hds),
      modificationRate: Math.round(modRate),
      alternativesEval: Math.round(ctxLeverage),
      comprehensionTrend: Math.round(compTrend),
    },
    trend,
    hdsHistory: (efficiency?.history ?? []).map((h) => ({
      date: h.date,
      value: h.aes,
    })),
    dependencyMap,
  });
});

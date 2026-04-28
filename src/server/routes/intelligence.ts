// Intelligence API routes — Layer 4 IP-9 enriched endpoints.
// Evidence drill-through, correlation serving, enriched _meta on all responses.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { Correlation } from "../../schemas/intelligence-presentation.js";
import { loadCorrelations } from "../../services/intelligence/correlation-engine.js";
import { loadEvidenceFile } from "../../services/intelligence/evidence-linker.js";
import { getEventsForInsight } from "../../services/intelligence/lineage.js";
import { getIntelligenceDir, getProjectDataDir } from "../../utils/paths.js";
import { getServerCache } from "../shared-cache.js";

export const intelligenceRoutes = new Hono();

// ─── Helpers ────────────────────────────────────────────────────────────────

const intDir = () => getIntelligenceDir();

async function readIntelligenceFile(filename: string): Promise<unknown | null> {
  const path = join(intDir(), filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

function jsonOr202(
  c: { json: (data: unknown, status?: number) => Response },
  data: unknown,
) {
  if (!data)
    return c.json(
      { status: "warming_up", message: "Intelligence engine is collecting data. Results will appear shortly." },
      202,
    );
  return c.json(data);
}

async function getCorrelationsForAnalyzer(analyzerName: string): Promise<Correlation[]> {
  const all = await loadCorrelations(intDir());
  return all.filter((c) => c.analyzers.includes(analyzerName));
}

function extractMeta(data: unknown): {
  freshness: { updatedAt: string; dataPoints: number; confidence: string } | null;
} {
  if (!data || typeof data !== "object") return { freshness: null };
  const obj = data as Record<string, unknown>;
  const meta = obj._meta as Record<string, unknown> | undefined;
  if (!meta) return { freshness: null };
  return {
    freshness: {
      updatedAt: (meta.updatedAt as string) ?? "",
      dataPoints: (meta.dataPoints as number) ?? 0,
      confidence: (meta.confidence as string) ?? "low",
    },
  };
}

type ResponseContext = { json: (data: unknown, status?: number) => Response };

async function enrichedResponse(
  c: ResponseContext,
  filename: string,
  analyzerName: string,
  startMs: number,
): Promise<Response> {
  const data = await readIntelligenceFile(filename);
  if (!data) return jsonOr202(c, null);

  const { freshness } = extractMeta(data);
  const correlations = await getCorrelationsForAnalyzer(analyzerName);

  return c.json({
    data,
    _meta: {
      tool: "intelligence",
      durationMs: Date.now() - startMs,
      freshness,
      evidenceAvailable: true,
      correlations,
    },
  });
}

// ─── IP-9.1: Evidence Endpoints ─────────────────────────────────────────────

intelligenceRoutes.get("/api/intelligence/evidence/:analyzerName", async (c) => {
  const analyzerName = c.req.param("analyzerName");
  const chains = await loadEvidenceFile(analyzerName, intDir());

  if (chains.length === 0) {
    const filePath = join(intDir(), "evidence", `${analyzerName}.json`);
    if (!existsSync(filePath)) {
      return c.json({ error: `No evidence found for analyzer "${analyzerName}"` }, 404);
    }
  }

  return c.json({ data: chains, _meta: { tool: "evidence", analyzerName } });
});

intelligenceRoutes.get("/api/intelligence/evidence/:analyzerName/:metric", async (c) => {
  const analyzerName = c.req.param("analyzerName");
  const metric = c.req.param("metric");
  const chains = await loadEvidenceFile(analyzerName, intDir());

  const chain = chains.find((ch) => ch.metric === metric);
  if (!chain) {
    return c.json({ error: `No evidence found for metric "${metric}" in analyzer "${analyzerName}"` }, 404);
  }

  return c.json({ data: chain, _meta: { tool: "evidence", analyzerName, metric } });
});

// ─── IP-9.1: Correlations Endpoint ──────────────────────────────────────────

intelligenceRoutes.get("/api/intelligence/correlations", async (c) => {
  const correlations = await loadCorrelations(intDir());
  return c.json({ data: correlations, _meta: { tool: "correlations", count: correlations.length } });
});

// ─── IP-9.1: Explain Endpoint ───────────────────────────────────────────────

intelligenceRoutes.get("/api/intelligence/explain/:insightId", async (c) => {
  const insightId = c.req.param("insightId");

  const correlations = await loadCorrelations(intDir());
  const correlation = correlations.find((corr) => corr.id === insightId);

  if (correlation) {
    return c.json({
      data: {
        explanation: `${correlation.title}: ${correlation.explanation}`,
        evidenceEventIds: correlation.evidenceEventIds,
        actionable: correlation.actionable,
      },
      _meta: { tool: "explain", source: "correlation" },
    });
  }

  return c.json({
    data: {
      explanation: `Insight ${insightId} — generated from analyzer pipeline.`,
      evidenceEventIds: [],
      actionable: "Check the analyzer output for details.",
    },
    _meta: { tool: "explain", source: "template" },
  });
});

// ─── IP-9.2: Enriched Intelligence Endpoints ────────────────────────────────

intelligenceRoutes.get("/api/intelligence/efficiency", async (c) => {
  return enrichedResponse(c, "efficiency.json", "efficiency", Date.now());
});

intelligenceRoutes.get("/api/intelligence/costs", async (c) => {
  return enrichedResponse(c, "cost-attribution.json", "cost-attribution", Date.now());
});

intelligenceRoutes.get("/api/intelligence/comprehension", async (c) => {
  return enrichedResponse(c, "comprehension.json", "comprehension-radar", Date.now());
});

intelligenceRoutes.get("/api/intelligence/prompt-patterns", async (c) => {
  return enrichedResponse(c, "prompt-patterns.json", "prompt-patterns", Date.now());
});

intelligenceRoutes.get("/api/intelligence/coach", async (c) => {
  return enrichedResponse(c, "prompt-patterns.json", "prompt-patterns", Date.now());
});

intelligenceRoutes.get("/api/intelligence/velocity", async (c) => {
  return enrichedResponse(c, "velocity.json", "velocity-tracker", Date.now());
});

intelligenceRoutes.get("/api/intelligence/rejections", async (c) => {
  return enrichedResponse(c, "rejections.json", "loop-detector", Date.now());
});

intelligenceRoutes.get("/api/intelligence/alerts", async (c) => {
  return enrichedResponse(c, "alerts.json", "blind-spot-detector", Date.now());
});

intelligenceRoutes.get("/api/intelligence/replays", async (c) => {
  return enrichedResponse(c, "decision-replay.json", "decision-replay", Date.now());
});

intelligenceRoutes.get("/api/intelligence/decision-durability", async (c) =>
  jsonOr202(c, await readIntelligenceFile("decision-durability.json")),
);

// ─── Actions Log ────────────────────────────────────────────────────────────

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
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .reverse()
      .slice(0, 10);
    return c.json({ actions, count: actions.length });
  } catch {
    return c.json({ actions: [], count: 0 });
  }
});

// ─── Lineage ────────────────────────────────────────────────────────────────

intelligenceRoutes.get("/api/intelligence/lineage/:insightId", async (c) => {
  const insightId = c.req.param("insightId");
  if (!insightId) return c.json({ data: null, _meta: { error: "Missing insightId" } }, 400);

  const cache = getServerCache();
  const db = await cache.getDb();
  if (!db) return c.json({ data: null, _meta: { degraded: true, degradedReason: "No cache database" } }, 503);

  try {
    const mappings = await getEventsForInsight(db, insightId);
    if (mappings.length === 0) {
      return c.json({ data: { insight: insightId, sourceEvents: [], analyzerChain: [] }, _meta: { tool: "lineage" } });
    }

    const analyzerChain = [...new Set(mappings.map((m) => m.analyzer))];
    const eventIds = mappings.map((m) => m.eventId);
    const placeholders = eventIds.map(() => "?").join(",");
    const result = await db.exec(
      `SELECT id, ts, source, content_summary, git_branch, json_extract(metadata, '$.domain') as domain
       FROM events WHERE id IN (${placeholders}) ORDER BY ts DESC`,
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

    return c.json({ data: { insight: insightId, sourceEvents, analyzerChain }, _meta: { tool: "lineage", durationMs: 0 } });
  } catch (err) {
    return c.json({ data: null, _meta: { degraded: true, degradedReason: err instanceof Error ? err.message : String(err) } }, 500);
  }
});

// ─── Narratives ─────────────────────────────────────────────────────────────

intelligenceRoutes.get("/api/intelligence/narratives", async (c) => {
  const data = await readIntelligenceFile("narratives.json");
  if (data) return c.json(data);

  const filePath = join(intDir(), "narratives.jsonl");
  if (!existsSync(filePath)) return jsonOr202(c, null);
  try {
    const content = (await readFile(filePath, "utf-8")).trim();
    if (!content) return jsonOr202(c, null);
    const narratives = content.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    return c.json({ narratives, count: narratives.length });
  } catch {
    return jsonOr202(c, null);
  }
});

// ─── Phase 16 Intelligence Endpoints ────────────────────────────────────────

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

// ─── Autonomy Composite ─────────────────────────────────────────────────────

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

  const correlations = await getCorrelationsForAnalyzer("efficiency");

  return c.json({
    data: {
      independenceIndex,
      breakdown: {
        hds: Math.round(hds),
        modificationRate: Math.round(modRate),
        alternativesEval: Math.round(ctxLeverage),
        comprehensionTrend: Math.round(compTrend),
      },
      trend,
      hdsHistory: (efficiency?.history ?? []).map((h) => ({ date: h.date, value: h.aes })),
      dependencyMap,
    },
    _meta: { tool: "intelligence", evidenceAvailable: true, correlations },
  });
});

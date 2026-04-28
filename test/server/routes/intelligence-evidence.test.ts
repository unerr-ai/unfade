import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { Correlation, EvidenceChain } from "../../../src/schemas/intelligence-presentation.js";

// Mock the paths module to use temp directories
const tempBase = join(tmpdir(), `unfade-api-test-${Date.now()}`);
const intDir = join(tempBase, "intelligence");
const projDir = join(tempBase, "project");

vi.mock("../../../src/utils/paths.js", () => ({
  getIntelligenceDir: () => intDir,
  getProjectDataDir: () => projDir,
  getUnfadeHome: () => tempBase,
}));

vi.mock("../../../src/server/shared-cache.js", () => ({
  getServerCache: () => ({
    getDb: async () => null,
  }),
}));

vi.mock("../../../src/services/intelligence/lineage.js", () => ({
  getEventsForInsight: async () => [],
}));

// Import after mocks
const { intelligenceRoutes } = await import("../../../src/server/routes/intelligence.js");
const { substrateRoutes } = await import("../../../src/server/routes/substrate.js");

function makeEvidenceChains(): EvidenceChain[] {
  return [
    {
      metric: "directionDensity",
      events: [
        { eventId: "evt-1", timestamp: "2026-04-28T10:00:00Z", source: "ai-session", type: "ai-conversation", summary: "Auth module discussion", contribution: 0.8, role: "primary" },
        { eventId: "evt-2", timestamp: "2026-04-28T11:00:00Z", source: "git", type: "commit", summary: "Fix auth", contribution: 0.5, role: "corroborating" },
      ],
      analyzers: ["efficiency"],
      confidence: 0.85,
    },
  ];
}

function makeCorrelations(): Correlation[] {
  return [
    {
      id: "corr-1",
      type: "efficiency-blind-spot",
      severity: "warning",
      title: "Efficiency declining in blind spot",
      explanation: "AES dropping while auth is a blind spot.",
      analyzers: ["efficiency", "comprehension-radar"],
      domain: "auth",
      evidenceEventIds: ["evt-corr-1"],
      actionable: "Review auth domain.",
      detectedAt: "2026-04-28T12:00:00Z",
    },
  ];
}

function makeEfficiencyOutput(): Record<string, unknown> {
  return {
    aes: 67,
    confidence: "medium",
    subMetrics: { directionDensity: { value: 65, weight: 0.3, confidence: "medium", dataPoints: 15, evidenceEventIds: [] } },
    trend: "stable",
    history: [],
    topInsight: null,
    updatedAt: "2026-04-28T12:00:00Z",
    period: "24h",
    _meta: { updatedAt: "2026-04-28T12:00:00Z", dataPoints: 15, confidence: "medium", watermark: "2026-04-28T12:00:00Z", stalenessMs: 0 },
    diagnostics: [],
  };
}

async function request(app: typeof intelligenceRoutes, path: string): Promise<{ status: number; body: unknown }> {
  const req = new Request(`http://localhost${path}`);
  const res = await app.fetch(req);
  const body = await res.json();
  return { status: res.status, body };
}

describe("Intelligence API — Evidence + Correlation (IP-9)", () => {
  beforeEach(() => {
    mkdirSync(intDir, { recursive: true });
    mkdirSync(join(intDir, "evidence"), { recursive: true });
    mkdirSync(projDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempBase)) rmSync(tempBase, { recursive: true });
  });

  describe("GET /api/intelligence/evidence/:analyzerName", () => {
    it("returns evidence chains for a valid analyzer", async () => {
      const chains = makeEvidenceChains();
      writeFileSync(join(intDir, "evidence", "efficiency.json"), JSON.stringify(chains));

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/evidence/efficiency");
      expect(status).toBe(200);
      const resp = body as { data: EvidenceChain[]; _meta: unknown };
      expect(resp.data).toHaveLength(1);
      expect(resp.data[0].metric).toBe("directionDensity");
      expect(resp.data[0].events).toHaveLength(2);
    });

    it("returns 404 for unknown analyzer", async () => {
      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/evidence/nonexistent");
      expect(status).toBe(404);
      expect((body as { error: string }).error).toContain("nonexistent");
    });
  });

  describe("GET /api/intelligence/evidence/:analyzerName/:metric", () => {
    it("returns specific metric chain", async () => {
      const chains = makeEvidenceChains();
      writeFileSync(join(intDir, "evidence", "efficiency.json"), JSON.stringify(chains));

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/evidence/efficiency/directionDensity");
      expect(status).toBe(200);
      const resp = body as { data: EvidenceChain };
      expect(resp.data.metric).toBe("directionDensity");
    });

    it("returns 404 for unknown metric", async () => {
      const chains = makeEvidenceChains();
      writeFileSync(join(intDir, "evidence", "efficiency.json"), JSON.stringify(chains));

      const { status } = await request(intelligenceRoutes, "/api/intelligence/evidence/efficiency/unknown-metric");
      expect(status).toBe(404);
    });
  });

  describe("GET /api/intelligence/correlations", () => {
    it("returns detected correlations", async () => {
      const correlations = makeCorrelations();
      writeFileSync(join(intDir, "correlations.json"), JSON.stringify(correlations));

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/correlations");
      expect(status).toBe(200);
      const resp = body as { data: Correlation[]; _meta: { count: number } };
      expect(resp.data).toHaveLength(1);
      expect(resp.data[0].type).toBe("efficiency-blind-spot");
      expect(resp._meta.count).toBe(1);
    });

    it("returns empty array on cold start", async () => {
      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/correlations");
      expect(status).toBe(200);
      const resp = body as { data: Correlation[] };
      expect(resp.data).toEqual([]);
    });
  });

  describe("GET /api/intelligence/explain/:insightId", () => {
    it("returns correlation-based explanation when correlation exists", async () => {
      const correlations = makeCorrelations();
      writeFileSync(join(intDir, "correlations.json"), JSON.stringify(correlations));

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/explain/corr-1");
      expect(status).toBe(200);
      const resp = body as { data: { explanation: string; evidenceEventIds: string[] }; _meta: { source: string } };
      expect(resp.data.explanation).toContain("Efficiency declining");
      expect(resp.data.evidenceEventIds).toContain("evt-corr-1");
      expect(resp._meta.source).toBe("correlation");
    });

    it("returns template fallback for unknown insight", async () => {
      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/explain/unknown-id");
      expect(status).toBe(200);
      const resp = body as { data: { explanation: string }; _meta: { source: string } };
      expect(resp._meta.source).toBe("template");
    });
  });

  describe("Enriched intelligence responses (IP-9.2)", () => {
    it("efficiency endpoint includes _meta with freshness + correlations", async () => {
      const effData = makeEfficiencyOutput();
      writeFileSync(join(intDir, "efficiency.json"), JSON.stringify(effData));

      const correlations = makeCorrelations();
      writeFileSync(join(intDir, "correlations.json"), JSON.stringify(correlations));

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/efficiency");
      expect(status).toBe(200);

      const resp = body as { data: unknown; _meta: { tool: string; freshness: unknown; evidenceAvailable: boolean; correlations: Correlation[] } };
      expect(resp._meta.tool).toBe("intelligence");
      expect(resp._meta.freshness).toBeDefined();
      expect(resp._meta.evidenceAvailable).toBe(true);
      expect(resp._meta.correlations).toHaveLength(1);
    });

    it("returns 202 warming_up when no data exists", async () => {
      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/efficiency");
      expect(status).toBe(202);
      expect((body as { status: string }).status).toBe("warming_up");
    });
  });
});

describe("Substrate API — Explore (IP-9.3)", () => {
  beforeEach(() => {
    mkdirSync(intDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempBase)) rmSync(tempBase, { recursive: true });
  });

  it("returns entity with neighbors and evidenceEventIds", async () => {
    const topology = {
      entities: [
        {
          id: "ent-auth",
          type: "feature",
          state: { name: "Auth Module", domain: "auth", evidenceEventIds: ["evt-s1", "evt-s2"] },
          confidence: 0.8,
          neighbors: [{ id: "ent-jwt", type: "USES", weight: 0.9 }],
        },
      ],
    };
    writeFileSync(join(intDir, "substrate-topology.json"), JSON.stringify(topology));

    const { status, body } = await request(substrateRoutes, "/api/substrate/explore/ent-auth");
    expect(status).toBe(200);

    const resp = body as { data: { entityId: string; entity: { name: string }; neighbors: unknown[]; evidenceEventIds: string[] } };
    expect(resp.data.entityId).toBe("ent-auth");
    expect(resp.data.entity.name).toBe("Auth Module");
    expect(resp.data.neighbors).toHaveLength(1);
    expect(resp.data.evidenceEventIds).toContain("evt-s1");
  });

  it("returns 404 for unknown entity", async () => {
    const topology = { entities: [{ id: "ent-other", type: "feature" }] };
    writeFileSync(join(intDir, "substrate-topology.json"), JSON.stringify(topology));

    const { status } = await request(substrateRoutes, "/api/substrate/explore/nonexistent");
    expect(status).toBe(404);
  });

  it("returns empty result when no topology file", async () => {
    const { status, body } = await request(substrateRoutes, "/api/substrate/explore/ent-any");
    expect(status).toBe(200);
    const resp = body as { data: { found: boolean }; _meta: { found: boolean } };
    expect(resp._meta.found).toBe(false);
  });
});

// IP-14.2: API Integration Test — verifies all intelligence endpoints with seeded data.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { Correlation, EvidenceChain } from "../../src/schemas/intelligence-presentation.js";

const tempBase = join(tmpdir(), `unfade-api-ip14-${Date.now()}`);
const intDir = join(tempBase, "intelligence");
const projDir = join(tempBase, "project");

vi.mock("../../src/utils/paths.js", () => ({
  getIntelligenceDir: () => intDir,
  getProjectDataDir: () => projDir,
  getUnfadeHome: () => tempBase,
}));

vi.mock("../../src/server/shared-cache.js", () => ({
  getServerCache: () => ({ getDb: async () => null }),
}));

vi.mock("../../src/services/intelligence/lineage.js", () => ({
  getEventsForInsight: async () => [],
}));

const { intelligenceRoutes } = await import("../../src/server/routes/intelligence.js");
const { substrateRoutes } = await import("../../src/server/routes/substrate.js");

async function request(app: typeof intelligenceRoutes, path: string) {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

function seedEfficiency() {
  writeFileSync(join(intDir, "efficiency.json"), JSON.stringify({
    aes: 67, confidence: "medium", trend: "stable",
    subMetrics: { directionDensity: { value: 65, weight: 0.3, confidence: "medium", dataPoints: 15, evidenceEventIds: ["e1"] } },
    history: [], topInsight: null, updatedAt: new Date().toISOString(), period: "24h",
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 15, confidence: "medium", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [{ severity: "info", message: "Stable AES", evidence: "trend", actionable: "maintain", relatedAnalyzers: [], evidenceEventIds: [] }],
  }));
}

function seedCorrelations() {
  const corrs: Correlation[] = [{
    id: "corr-api-1", type: "efficiency-blind-spot", severity: "warning",
    title: "Efficiency declining in blind spot", explanation: "AES dropping while auth blind",
    analyzers: ["efficiency", "comprehension-radar"], domain: "auth",
    evidenceEventIds: ["evt-api-1"], actionable: "Review auth", detectedAt: new Date().toISOString(),
  }];
  writeFileSync(join(intDir, "correlations.json"), JSON.stringify(corrs));
}

function seedEvidence() {
  const chains: EvidenceChain[] = [{
    metric: "directionDensity",
    events: [{ eventId: "evt-ev-1", timestamp: new Date().toISOString(), source: "ai-session", type: "ai-conversation", summary: "Auth discussion", contribution: 0.8, role: "primary" }],
    analyzers: ["efficiency"], confidence: 0.85,
  }];
  mkdirSync(join(intDir, "evidence"), { recursive: true });
  writeFileSync(join(intDir, "evidence", "efficiency.json"), JSON.stringify(chains));
}

function seedSubstrate() {
  writeFileSync(join(intDir, "substrate-topology.json"), JSON.stringify({
    entities: [{
      id: "ent-auth", type: "feature",
      state: { name: "Auth Module", domain: "auth", evidenceEventIds: ["evt-s1"] },
      confidence: 0.8, neighbors: [{ id: "ent-jwt", type: "USES", weight: 0.9 }],
    }],
  }));
}

describe("IP-14.2: API Integration", () => {
  beforeEach(() => {
    mkdirSync(intDir, { recursive: true });
    mkdirSync(projDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempBase)) rmSync(tempBase, { recursive: true });
  });

  describe("enriched intelligence endpoints", () => {
    it("efficiency returns _meta.freshness + correlations", async () => {
      seedEfficiency();
      seedCorrelations();

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/efficiency");
      expect(status).toBe(200);
      expect(body._meta).toBeDefined();

      const meta = body._meta as Record<string, unknown>;
      expect(meta.tool).toBe("intelligence");
      expect(meta.freshness).toBeDefined();
      expect(meta.evidenceAvailable).toBe(true);
      expect(Array.isArray(meta.correlations)).toBe(true);
      expect((meta.correlations as Correlation[]).length).toBe(1);
    });

    it("returns 202 when no data seeded", async () => {
      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/efficiency");
      expect(status).toBe(202);
      expect((body as Record<string, unknown>).status).toBe("warming_up");
    });
  });

  describe("evidence endpoints", () => {
    it("returns evidence chains for seeded analyzer", async () => {
      seedEvidence();

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/evidence/efficiency");
      expect(status).toBe(200);
      expect((body as { data: unknown[] }).data).toHaveLength(1);
    });

    it("returns specific metric chain", async () => {
      seedEvidence();

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/evidence/efficiency/directionDensity");
      expect(status).toBe(200);
      expect((body as { data: { metric: string } }).data.metric).toBe("directionDensity");
    });

    it("returns 404 for unknown analyzer", async () => {
      const { status } = await request(intelligenceRoutes, "/api/intelligence/evidence/nonexistent");
      expect(status).toBe(404);
    });
  });

  describe("correlation endpoint", () => {
    it("returns all correlations", async () => {
      seedCorrelations();

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/correlations");
      expect(status).toBe(200);

      const data = (body as { data: Correlation[] }).data;
      expect(data).toHaveLength(1);
      expect(data[0].type).toBe("efficiency-blind-spot");
    });

    it("returns empty on cold start", async () => {
      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/correlations");
      expect(status).toBe(200);
      expect((body as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe("explain endpoint", () => {
    it("returns correlation-based explanation", async () => {
      seedCorrelations();

      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/explain/corr-api-1");
      expect(status).toBe(200);

      const data = (body as { data: { explanation: string; evidenceEventIds: string[] } }).data;
      expect(data.explanation).toContain("Efficiency declining");
      expect(data.evidenceEventIds).toContain("evt-api-1");
    });

    it("returns template fallback for unknown insight", async () => {
      const { status, body } = await request(intelligenceRoutes, "/api/intelligence/explain/unknown");
      expect(status).toBe(200);
      expect((body as { _meta: { source: string } })._meta.source).toBe("template");
    });
  });

  describe("substrate explore endpoint", () => {
    it("returns entity with neighborhood", async () => {
      seedSubstrate();

      const { status, body } = await request(substrateRoutes, "/api/substrate/explore/ent-auth");
      expect(status).toBe(200);

      const data = (body as { data: { entity: { name: string }; neighbors: unknown[]; evidenceEventIds: string[] } }).data;
      expect(data.entity.name).toBe("Auth Module");
      expect(data.neighbors).toHaveLength(1);
      expect(data.evidenceEventIds).toContain("evt-s1");
    });

    it("returns 404 for unknown entity", async () => {
      seedSubstrate();
      const { status } = await request(substrateRoutes, "/api/substrate/explore/nonexistent");
      expect(status).toBe(404);
    });
  });
});

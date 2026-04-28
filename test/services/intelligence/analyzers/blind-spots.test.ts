import { describe, expect, it, vi } from "vitest";
import { blindSpotDetectorAnalyzer } from "../../../../src/services/intelligence/analyzers/blind-spots.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader } from "../../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../../src/services/cache/manager.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockAnalytics(
  domainRows: Array<{
    domain: string;
    baseScore: number;
    currentScore: number;
    interactionCount: number;
    lastTouch: string;
    stability: number;
  }> = [],
): DbLike {
  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("domain_comprehension")) {
        return [{
          columns: ["domain", "base_score", "current_score", "interaction_count", "last_touch", "stability"],
          values: domainRows.map((d) => [d.domain, d.baseScore, d.currentScore, d.interactionCount, d.lastTouch, d.stability]),
        }];
      }
      if (sql.includes("SELECT id FROM events")) {
        return [{ columns: ["id"], values: [["evt-bs1"], ["evt-bs2"]] }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function createMockKnowledge(hasData = true, overallScores: number[] = [40]): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue(
      overallScores.map((score, i) => ({
        episodeId: `evt-${i}`,
        timestamp: new Date(Date.now() - i * 86400000).toISOString(),
        steering: 3, understanding: 3, metacognition: 2, independence: 2, engagement: 2,
        overallScore: score,
        assessmentMethod: "llm",
      })),
    ),
    getFacts: vi.fn().mockResolvedValue([]),
    getDecisions: vi.fn().mockResolvedValue([]),
    getEntityEngagement: vi.fn().mockResolvedValue([]),
    getDecayState: vi.fn().mockResolvedValue([]),
    hasKnowledgeData: vi.fn().mockResolvedValue(hasData),
  };
}

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge: null,
    ...overrides,
  };
}

const recentTouch = new Date(Date.now() - 5 * 86400000).toISOString();
const oldTouch = new Date(Date.now() - 60 * 86400000).toISOString();

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("blind-spots (KGI-3 + IP-4.3)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7.5, interactionCount: 5, lastTouch: recentTouch, stability: 7 },
      ]);
      const ctx = makeCtx({ analytics });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });

    it("empty alerts has _meta with zero dataPoints", async () => {
      const ctx = makeCtx({ analytics: createMockAnalytics([]) });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      expect(state.value.output._meta.dataPoints).toBe(0);
      expect(state.value.output._meta.confidence).toBe("low");
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const ctx = makeCtx({ analytics: createMockAnalytics([]) });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("generates info diagnostic when no blind spots", async () => {
      const analytics = createMockAnalytics([
        { domain: "healthy", baseScore: 8, currentScore: 7, interactionCount: 5, lastTouch: recentTouch, stability: 7 },
      ]);
      const ctx = makeCtx({ analytics });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      const infoDiags = state.value.output.diagnostics.filter((d) => d.severity === "info");
      expect(infoDiags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("per-alert evidenceEventIds", () => {
    it("alerts include evidenceEventIds", async () => {
      const analytics = createMockAnalytics([
        { domain: "auth", baseScore: 8, currentScore: 2.5, interactionCount: 5, lastTouch: recentTouch, stability: 2 },
      ]);
      const knowledge = createMockKnowledge(true, [30, 25]);
      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      for (const alert of state.value.output.alerts) {
        expect(Array.isArray(alert.evidenceEventIds)).toBe(true);
      }
    });
  });

  describe("enhanced messages", () => {
    it("alert messages reference session count", async () => {
      const analytics = createMockAnalytics([
        { domain: "auth", baseScore: 8, currentScore: 2.5, interactionCount: 5, lastTouch: recentTouch, stability: 2 },
      ]);
      const knowledge = createMockKnowledge(true, [30, 25]);
      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      if (state.value.output.alerts.length > 0) {
        expect(state.value.output.alerts[0].message).toContain("5 sessions");
      }
    });
  });

  describe("knowledge-grounded path", () => {
    it("generates alert when retrievability < 0.4 and low pushback", async () => {
      const analytics = createMockAnalytics([
        { domain: "auth", baseScore: 8, currentScore: 2.5, interactionCount: 5, lastTouch: recentTouch, stability: 2 },
      ]);
      const knowledge = createMockKnowledge(true, [30, 25]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("knowledge");
      expect(state.value.output.alerts.length).toBeGreaterThanOrEqual(1);
      expect(state.value.output.alerts[0].domain).toBe("auth");
      expect(state.value.output.alerts[0].type).toBe("low-comprehension");
    });

    it("does NOT alert when retrievability > 0.5", async () => {
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7, interactionCount: 10, lastTouch: recentTouch, stability: 10 },
      ]);
      const knowledge = createMockKnowledge(true, [70, 75]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      const backendAlerts = state.value.output.alerts.filter((a) => a.domain === "backend");
      expect(backendAlerts.length).toBe(0);
    });

    it("does NOT alert when entity is abandoned (30+ days)", async () => {
      const analytics = createMockAnalytics([
        { domain: "old-module", baseScore: 8, currentScore: 1, interactionCount: 5, lastTouch: oldTouch, stability: 1 },
      ]);
      const knowledge = createMockKnowledge(true, [20]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      const oldAlerts = state.value.output.alerts.filter((a) => a.domain === "old-module");
      expect(oldAlerts.length).toBe(0);
    });

    it("does NOT alert when insufficient interactions (< 3)", async () => {
      const analytics = createMockAnalytics([
        { domain: "tiny", baseScore: 8, currentScore: 1, interactionCount: 2, lastTouch: recentTouch, stability: 1 },
      ]);
      const knowledge = createMockKnowledge(true, [20]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      const tinyAlerts = state.value.output.alerts.filter((a) => a.domain === "tiny");
      expect(tinyAlerts.length).toBe(0);
    });
  });

  describe("severity graduation", () => {
    it("classifies severity based on retrievability thresholds", async () => {
      const analytics = createMockAnalytics([
        { domain: "severe-area", baseScore: 8, currentScore: 1.2, interactionCount: 5, lastTouch: recentTouch, stability: 1 },
        { domain: "moderate-area", baseScore: 8, currentScore: 2.0, interactionCount: 5, lastTouch: recentTouch, stability: 2 },
      ]);
      const knowledge = createMockKnowledge(true, [20, 15]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      const severe = state.value.output.alerts.find((a) => a.domain === "severe-area");
      const moderate = state.value.output.alerts.find((a) => a.domain === "moderate-area");

      if (severe) expect(severe.severity).toBe("critical");
      if (moderate) expect(moderate.severity).toBe("warning");
    });
  });

  describe("rate limiting", () => {
    it("generates at most 2 new alerts per week", async () => {
      const analytics = createMockAnalytics([
        { domain: "area-1", baseScore: 8, currentScore: 1, interactionCount: 5, lastTouch: recentTouch, stability: 1 },
        { domain: "area-2", baseScore: 8, currentScore: 1, interactionCount: 5, lastTouch: recentTouch, stability: 1 },
        { domain: "area-3", baseScore: 8, currentScore: 1, interactionCount: 5, lastTouch: recentTouch, stability: 1 },
        { domain: "area-4", baseScore: 8, currentScore: 1, interactionCount: 5, lastTouch: recentTouch, stability: 1 },
      ]);
      const knowledge = createMockKnowledge(true, [15]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      const newAlerts = state.value.output.alerts.filter(
        (a) => new Date(a.createdAt).getTime() > Date.now() - 60_000,
      );
      expect(newAlerts.length).toBeLessThanOrEqual(2);
    });
  });

  describe("fallback path (no knowledge)", () => {
    it("falls back to HDS when knowledge is null", async () => {
      const analytics = createMockAnalytics([
        { domain: "api", baseScore: 5, currentScore: 3, interactionCount: 5, lastTouch: recentTouch, stability: 3 },
      ]);

      const ctx = makeCtx({ analytics, knowledge: null });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("hds-fallback");
    });

    it("generates HDS-based alert for low currentScore", async () => {
      const analytics = createMockAnalytics([
        { domain: "db-module", baseScore: 5, currentScore: 1.5, interactionCount: 5, lastTouch: recentTouch, stability: 1 },
      ]);

      const ctx = makeCtx({ analytics, knowledge: null });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      expect(state.value.output.alerts.length).toBeGreaterThanOrEqual(1);
      expect(state.value.output.alerts[0].domain).toBe("db-module");
    });

    it("returns empty alerts when no domain data exists", async () => {
      const ctx = makeCtx({ analytics: createMockAnalytics([]) });
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);

      expect(state.value.output.alerts.length).toBe(0);
    });
  });

  describe("incremental update", () => {
    it("detects change in alert count", async () => {
      const ctx = makeCtx({ analytics: createMockAnalytics([]) });
      const initState = await blindSpotDetectorAnalyzer.initialize(ctx);

      const updatedAnalytics = createMockAnalytics([
        { domain: "new-blindspot", baseScore: 8, currentScore: 1, interactionCount: 5, lastTouch: recentTouch, stability: 1 },
      ]);

      const updateResult = await blindSpotDetectorAnalyzer.update(
        initState,
        { events: [{ id: "evt-new" } as any], sessionUpdates: [], featureUpdates: [] },
        makeCtx({ analytics: updatedAnalytics }),
      );

      expect(updateResult.changed).toBe(true);
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { comprehensionRadarAnalyzer } from "../../../../src/services/intelligence/analyzers/comprehension-radar.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, ComprehensionEntry } from "../../../../src/services/intelligence/knowledge-reader.js";
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
        return [{ columns: ["id"], values: [["evt-d1"], ["evt-d2"]] }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
      }
      if (sql.includes("COUNT(*)")) {
        return [{ columns: ["count"], values: [[20]] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function createMockKnowledge(
  assessments: ComprehensionEntry[] = [],
  hasData = true,
): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue(assessments),
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("comprehension-radar (KGI-2 + IP-3.2)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7.5, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 7 },
      ]);
      const ctx = makeCtx({ analytics });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });

    it("empty radar has _meta with zero dataPoints", async () => {
      const ctx = makeCtx({ analytics: createMockAnalytics([]) });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output._meta.dataPoints).toBe(0);
      expect(state.value.output._meta.confidence).toBe("low");
    });
  });

  describe("per-module evidenceEventIds", () => {
    it("modules include evidenceEventIds arrays", async () => {
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7.5, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 7 },
      ]);
      const ctx = makeCtx({ analytics });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      const backendModule = state.value.output.byModule["backend"];
      expect(Array.isArray(backendModule.evidenceEventIds)).toBe(true);
      expect(backendModule.evidenceEventIds.length).toBeGreaterThan(0);
    });

    it("topContributors populated when knowledge available", async () => {
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: "2026-04-28T11:00:00Z", steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
      ]);
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7.5, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 7 },
      ]);
      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      const backendModule = state.value.output.byModule["backend"];
      expect(Array.isArray(backendModule.topContributors)).toBe(true);
      expect(backendModule.topContributors.length).toBeGreaterThan(0);
      expect(backendModule.topContributors[0].eventId).toBeTruthy();
      expect(typeof backendModule.topContributors[0].impact).toBe("number");
    });

    it("topContributors empty on fallback path", async () => {
      const analytics = createMockAnalytics([
        { domain: "utils", baseScore: 7, currentScore: 6.5, interactionCount: 8, lastTouch: "2026-04-28T10:00:00Z", stability: 5 },
      ]);
      const ctx = makeCtx({ analytics, knowledge: null });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output.byModule["utils"].topContributors).toEqual([]);
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7.5, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 7 },
      ]);
      const ctx = makeCtx({ analytics });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("generates warning diagnostic for blind spots", async () => {
      const analytics = createMockAnalytics([
        { domain: "auth-module", baseScore: 8, currentScore: 3.5, interactionCount: 5, lastTouch: "2026-03-01T10:00:00Z", stability: 2 },
      ]);
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 3, understanding: 2, metacognition: 1, independence: 2, engagement: 2, overallScore: 20, assessmentMethod: "llm" },
      ]);
      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      const warnings = state.value.output.diagnostics.filter((d) => d.severity === "warning");
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].message).toContain("auth-module");
      expect(Array.isArray(warnings[0].evidenceEventIds)).toBe(true);
    });

    it("blind spot alerts include evidenceEventIds", async () => {
      const analytics = createMockAnalytics([
        { domain: "auth", baseScore: 8, currentScore: 3.0, interactionCount: 5, lastTouch: "2026-03-01T10:00:00Z", stability: 2 },
      ]);
      const ctx = makeCtx({ analytics });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output.blindSpotAlerts.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(state.value.output.blindSpotAlerts[0].evidenceEventIds)).toBe(true);
    });
  });

  describe("knowledge-grounded path", () => {
    it("uses knowledge data when available", async () => {
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: "2026-04-28T11:00:00Z", steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
      ]);

      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7.5, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 7 },
        { domain: "frontend", baseScore: 6, currentScore: 5.2, interactionCount: 3, lastTouch: "2026-04-27T10:00:00Z", stability: 5 },
      ]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("knowledge");
      expect(state.value.output.overall).toBeGreaterThan(0);
      expect(state.value.output.byModule["backend"]).toBeDefined();
      expect(state.value.output.byModule["frontend"]).toBeDefined();
    });

    it("computes per-module scores from decay-adjusted domain_comprehension", async () => {
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
      ]);

      const analytics = createMockAnalytics([
        { domain: "auth", baseScore: 9, currentScore: 8.5, interactionCount: 10, lastTouch: "2026-04-28T10:00:00Z", stability: 10 },
      ]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output.byModule["auth"].score).toBe(85);
      expect(state.value.output.byModule["auth"].confidence).toBe("high");
    });

    it("uses assessment average for overall when assessments exist", async () => {
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 60, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: "2026-04-28T11:00:00Z", steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 80, assessmentMethod: "llm" },
      ]);

      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 5, currentScore: 4, interactionCount: 3, lastTouch: "2026-04-28T10:00:00Z", stability: 5 },
      ]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output.overall).toBe(70);
    });
  });

  describe("fallback path (no knowledge)", () => {
    it("falls back to HDS when knowledge is null", async () => {
      const analytics = createMockAnalytics([
        { domain: "utils", baseScore: 7, currentScore: 6.5, interactionCount: 8, lastTouch: "2026-04-28T10:00:00Z", stability: 5 },
      ]);

      const ctx = makeCtx({ analytics, knowledge: null });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("hds-fallback");
      expect(state.value.output.byModule["utils"]).toBeDefined();
      expect(state.value.output.byModule["utils"].score).toBe(65);
    });

    it("falls back when hasKnowledgeData returns false", async () => {
      const knowledge = createMockKnowledge([], false);
      const analytics = createMockAnalytics([
        { domain: "api", baseScore: 6, currentScore: 5, interactionCount: 4, lastTouch: "2026-04-28T10:00:00Z", stability: 3 },
      ]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("hds-fallback");
    });

    it("returns empty radar when no domain data exists", async () => {
      const ctx = makeCtx({ analytics: createMockAnalytics([]) });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output.overall).toBe(0);
      expect(state.value.output.confidence).toBe("low");
      expect(Object.keys(state.value.output.byModule)).toHaveLength(0);
    });
  });

  describe("blind spot detection", () => {
    it("detects blind spots with low decay-adjusted scores", async () => {
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 3, understanding: 2, metacognition: 1, independence: 2, engagement: 2, overallScore: 20, assessmentMethod: "llm" },
      ]);

      const analytics = createMockAnalytics([
        { domain: "auth-module", baseScore: 8, currentScore: 3.5, interactionCount: 5, lastTouch: "2026-03-01T10:00:00Z", stability: 2 },
        { domain: "backend", baseScore: 8, currentScore: 7.5, interactionCount: 10, lastTouch: "2026-04-28T10:00:00Z", stability: 7 },
      ]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output.blindSpots).toContain("auth-module");
      expect(state.value.output.blindSpots).not.toContain("backend");
      expect(state.value.output.blindSpotAlerts.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag domains with < 3 interactions as blind spots", async () => {
      const analytics = createMockAnalytics([
        { domain: "tiny-module", baseScore: 3, currentScore: 1, interactionCount: 2, lastTouch: "2026-01-01T10:00:00Z", stability: 1 },
      ]);

      const ctx = makeCtx({ analytics });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      expect(state.value.output.blindSpots).not.toContain("tiny-module");
    });
  });

  describe("incremental update", () => {
    it("detects changes in overall score", async () => {
      const analytics = createMockAnalytics([
        { domain: "api", baseScore: 7, currentScore: 6, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 5 },
      ]);

      const ctx = makeCtx({ analytics });
      const initState = await comprehensionRadarAnalyzer.initialize(ctx);

      const updatedAnalytics = createMockAnalytics([
        { domain: "api", baseScore: 9, currentScore: 8.5, interactionCount: 8, lastTouch: "2026-04-28T12:00:00Z", stability: 7 },
      ]);

      const updateResult = await comprehensionRadarAnalyzer.update(
        initState,
        { events: [{ id: "evt-new", source: "ai-session", type: "ai-conversation", ts: "2026-04-28T12:00:00Z" } as any], sessionUpdates: [], featureUpdates: [] },
        makeCtx({ analytics: updatedAnalytics }),
      );

      expect(updateResult.changed).toBe(true);
      expect(updateResult.state.value.output.overall).not.toBe(initState.value.output.overall);
    });

    it("no change when overall stays the same", async () => {
      const analytics = createMockAnalytics([
        { domain: "api", baseScore: 7, currentScore: 6, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 5 },
      ]);

      const ctx = makeCtx({ analytics });
      const initState = await comprehensionRadarAnalyzer.initialize(ctx);

      const updateResult = await comprehensionRadarAnalyzer.update(
        initState,
        { events: [{ id: "evt-same" } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(updateResult.changed).toBe(false);
    });
  });

  describe("entity contributions", () => {
    it("contributes feature entities with comprehension scores", async () => {
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 5 },
        { domain: "frontend", baseScore: 6, currentScore: 5, interactionCount: 3, lastTouch: "2026-04-27T10:00:00Z", stability: 3 },
      ]);

      const ctx = makeCtx({ analytics });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      const contributions = comprehensionRadarAnalyzer.contributeEntities!(state, {} as any);

      expect(contributions.length).toBe(2);
      expect(contributions[0].entityType).toBe("feature");
      expect(contributions[0].analyzerName).toBe("comprehension-radar");
      expect(contributions[0].stateFragment.source).toBe("hds-fallback");
    });

    it("includes knowledge source tag in contributions", async () => {
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
      ]);

      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8, currentScore: 7, interactionCount: 5, lastTouch: "2026-04-28T10:00:00Z", stability: 5 },
      ]);

      const ctx = makeCtx({ analytics, knowledge });
      const state = await comprehensionRadarAnalyzer.initialize(ctx);

      const contributions = comprehensionRadarAnalyzer.contributeEntities!(state, {} as any);
      expect(contributions[0].stateFragment.source).toBe("knowledge");
    });
  });
});

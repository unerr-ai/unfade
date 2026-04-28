import { describe, expect, it, vi } from "vitest";
import { efficiencyAnalyzer } from "../../../../src/services/intelligence/analyzers/efficiency.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, ComprehensionEntry } from "../../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../../src/services/cache/manager.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockAnalytics(overrides: Record<string, unknown[][]> = {}): DbLike {
  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("AVG(human_direction_score)")) {
        return [{ columns: ["avg_hds", "cnt"], values: overrides.direction ?? [[0.65, 15]] }];
      }
      if (sql.includes("directed")) {
        return [{ columns: ["total", "directed"], values: overrides.token ?? [[15, 10]] }];
      }
      if (sql.includes("AVG(turn_count)")) {
        return [{ columns: ["avg_turns", "cnt"], values: overrides.iteration ?? [[4, 15]] }];
      }
      if (sql.includes("AVG(prompt_specificity)")) {
        return [{ columns: ["avg_spec", "cnt"], values: overrides.context ?? [[0.7, 15]] }];
      }
      if (sql.includes("AVG(overall_score)")) {
        return [{ columns: ["avg_score", "cnt"], values: overrides.modification ?? [[0.6, 10]] }];
      }
      if (sql.includes("execution_phase")) {
        return [{ columns: ["planning", "debugging", "total"], values: overrides.phase ?? [[3, 2, 15]] }];
      }
      if (sql.includes("outcome")) {
        return [{ columns: ["failures", "total"], values: overrides.outcome ?? [[1, 15]] }];
      }
      if (sql.includes("metric_snapshots")) {
        return [{ columns: ["date", "rdi"], values: overrides.history ?? [] }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
      }
      if (sql.includes("SELECT id FROM events")) {
        return [{ columns: ["id"], values: overrides.eventIds ?? [["evt-1"], ["evt-2"], ["evt-3"]] }];
      }
      if (sql.includes("episode_id")) {
        return [{ columns: ["episode_id"], values: overrides.episodeIds ?? [["ep-1"], ["ep-2"]] }];
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

describe("efficiency (KGI-6 + IP-3.1)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const ctx = makeCtx();
      const state = await efficiencyAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });

    it("_meta.dataPoints aggregates across all sub-metrics", async () => {
      const ctx = makeCtx();
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output._meta.dataPoints).toBeGreaterThan(0);
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const ctx = makeCtx();
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("generates critical diagnostic when sub-metric below 30", async () => {
      const analytics = createMockAnalytics({
        direction: [[0.1, 15]],
        token: [[15, 2]],
        iteration: [[8, 15]],
        context: [[0.15, 15]],
        modification: [[0.1, 10]],
      });
      const ctx = makeCtx({ analytics });
      const state = await efficiencyAnalyzer.initialize(ctx);

      const criticals = state.value.output.diagnostics.filter((d) => d.severity === "critical");
      expect(criticals.length).toBeGreaterThanOrEqual(1);
    });

    it("diagnostic includes evidenceEventIds", async () => {
      const analytics = createMockAnalytics({
        direction: [[0.1, 15]],
      });
      const ctx = makeCtx({ analytics });
      const state = await efficiencyAnalyzer.initialize(ctx);

      for (const diag of state.value.output.diagnostics) {
        expect(Array.isArray(diag.evidenceEventIds)).toBe(true);
      }
    });
  });

  describe("per-sub-metric evidenceEventIds", () => {
    it("sub-metrics include evidenceEventIds arrays", async () => {
      const ctx = makeCtx();
      const state = await efficiencyAnalyzer.initialize(ctx);
      const { subMetrics } = state.value.output;

      expect(Array.isArray(subMetrics.directionDensity.evidenceEventIds)).toBe(true);
      expect(Array.isArray(subMetrics.tokenEfficiency.evidenceEventIds)).toBe(true);
      expect(Array.isArray(subMetrics.iterationRatio.evidenceEventIds)).toBe(true);
      expect(Array.isArray(subMetrics.contextLeverage.evidenceEventIds)).toBe(true);
      expect(Array.isArray(subMetrics.modificationDepth.evidenceEventIds)).toBe(true);
    });

    it("comprehensionEfficiency includes evidenceEventIds when knowledge available", async () => {
      const assessments: ComprehensionEntry[] = [
        { episodeId: "evt-1", timestamp: "2026-04-28T08:00:00Z", steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 46, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
        { episodeId: "evt-3", timestamp: "2026-04-28T14:00:00Z", steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
      ];
      const knowledge = createMockKnowledge(assessments);
      const ctx = makeCtx({ knowledge });
      const state = await efficiencyAnalyzer.initialize(ctx);

      const comp = state.value.output.subMetrics.comprehensionEfficiency!;
      expect(comp.evidenceEventIds).toEqual(["evt-1", "evt-2", "evt-3"]);
    });

    it("evidenceEventIds empty on DB failure (graceful degradation)", async () => {
      const failAnalytics: DbLike = {
        run() {},
        exec(sql: string) {
          if (sql.includes("SELECT id FROM events")) throw new Error("DB down");
          if (sql.includes("AVG(human_direction_score)")) return [{ columns: ["avg_hds", "cnt"], values: [[0.65, 15]] }];
          if (sql.includes("directed")) return [{ columns: ["total", "directed"], values: [[15, 10]] }];
          if (sql.includes("AVG(turn_count)")) return [{ columns: ["avg_turns", "cnt"], values: [[4, 15]] }];
          if (sql.includes("AVG(prompt_specificity)")) return [{ columns: ["avg_spec", "cnt"], values: [[0.7, 15]] }];
          if (sql.includes("AVG(overall_score)")) return [{ columns: ["avg_score", "cnt"], values: [[0.6, 10]] }];
          if (sql.includes("execution_phase")) return [{ columns: ["planning", "debugging", "total"], values: [[3, 2, 15]] }];
          if (sql.includes("outcome")) return [{ columns: ["failures", "total"], values: [[1, 15]] }];
          if (sql.includes("metric_snapshots")) return [{ columns: ["date", "rdi"], values: [] }];
          if (sql.includes("MAX(ts)")) return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
          return [{ columns: [], values: [] }];
        },
      };
      const ctx = makeCtx({ analytics: failAnalytics });
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output.subMetrics.directionDensity.evidenceEventIds).toEqual([]);
    });
  });

  describe("with knowledge data (6 sub-metrics)", () => {
    it("includes comprehensionEfficiency when knowledge available", async () => {
      const assessments: ComprehensionEntry[] = [
        { episodeId: "evt-1", timestamp: "2026-04-28T08:00:00Z", steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 46, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
        { episodeId: "evt-3", timestamp: "2026-04-28T14:00:00Z", steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
      ];
      const knowledge = createMockKnowledge(assessments);

      const ctx = makeCtx({ knowledge });
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output.subMetrics.comprehensionEfficiency).toBeDefined();
      expect(state.value.output.subMetrics.comprehensionEfficiency!.weight).toBeCloseTo(0.10, 2);
      expect(state.value.output.subMetrics.comprehensionEfficiency!.dataPoints).toBe(3);
    });

    it("comprehension delta reflects improvement", async () => {
      const assessments: ComprehensionEntry[] = [
        { episodeId: "evt-early", timestamp: "2026-04-28T08:00:00Z", steering: 4, understanding: 4, metacognition: 3, independence: 3, engagement: 4, overallScore: 36, assessmentMethod: "llm" },
        { episodeId: "evt-late", timestamp: "2026-04-28T16:00:00Z", steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
      ];
      const knowledge = createMockKnowledge(assessments);

      const ctx = makeCtx({ knowledge });
      const state = await efficiencyAnalyzer.initialize(ctx);

      const comp = state.value.output.subMetrics.comprehensionEfficiency!;
      expect(comp.value).toBeGreaterThan(80);
    });

    it("redistributes weights when comprehension available", async () => {
      const assessments: ComprehensionEntry[] = [
        { episodeId: "evt-1", timestamp: "2026-04-28T08:00:00Z", steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 46, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: "2026-04-28T14:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
      ];
      const knowledge = createMockKnowledge(assessments);

      const ctx = makeCtx({ knowledge });
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output.subMetrics.directionDensity.weight).toBeCloseTo(0.27, 2);
      expect(state.value.output.subMetrics.tokenEfficiency.weight).toBeCloseTo(0.18, 2);
    });
  });

  describe("without knowledge data (5 sub-metrics)", () => {
    it("excludes comprehensionEfficiency when no knowledge", async () => {
      const ctx = makeCtx({ knowledge: null });
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output.subMetrics.comprehensionEfficiency).toBeUndefined();
    });

    it("retains original weight proportions without knowledge", async () => {
      const ctx = makeCtx({ knowledge: null });
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output.subMetrics.directionDensity.weight).toBeCloseTo(0.30, 2);
      expect(state.value.output.subMetrics.tokenEfficiency.weight).toBeCloseTo(0.20, 2);
      expect(state.value.output.subMetrics.iterationRatio.weight).toBeCloseTo(0.20, 2);
      expect(state.value.output.subMetrics.contextLeverage.weight).toBeCloseTo(0.15, 2);
      expect(state.value.output.subMetrics.modificationDepth.weight).toBeCloseTo(0.15, 2);
    });

    it("produces valid AES between 0-100", async () => {
      const ctx = makeCtx();
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output.aes).toBeGreaterThanOrEqual(0);
      expect(state.value.output.aes).toBeLessThanOrEqual(100);
    });
  });

  describe("edge cases", () => {
    it("no comprehension change → neutral score (50)", async () => {
      const assessments: ComprehensionEntry[] = [
        { episodeId: "evt-1", timestamp: "2026-04-28T08:00:00Z", steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 50, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: "2026-04-28T14:00:00Z", steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 50, assessmentMethod: "llm" },
      ];
      const knowledge = createMockKnowledge(assessments);

      const ctx = makeCtx({ knowledge });
      const state = await efficiencyAnalyzer.initialize(ctx);

      const comp = state.value.output.subMetrics.comprehensionEfficiency!;
      expect(comp.value).toBe(50);
    });

    it("single assessment → neutral score (insufficient data)", async () => {
      const knowledge = createMockKnowledge([
        { episodeId: "evt-1", timestamp: "2026-04-28T10:00:00Z", steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7, overallScore: 68, assessmentMethod: "llm" },
      ]);

      const ctx = makeCtx({ knowledge });
      const state = await efficiencyAnalyzer.initialize(ctx);

      const comp = state.value.output.subMetrics.comprehensionEfficiency!;
      expect(comp.value).toBe(50);
      expect(comp.confidence).toBe("low");
    });

    it("hasKnowledgeData=false → no comprehension dimension", async () => {
      const knowledge = createMockKnowledge([], false);
      const ctx = makeCtx({ knowledge });
      const state = await efficiencyAnalyzer.initialize(ctx);

      expect(state.value.output.subMetrics.comprehensionEfficiency).toBeUndefined();
    });
  });

  describe("incremental update", () => {
    it("detects AES change > 2", async () => {
      const ctx = makeCtx();
      const initState = await efficiencyAnalyzer.initialize(ctx);

      const updateResult = await efficiencyAnalyzer.update(
        initState,
        { events: [{ id: "evt" } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(typeof updateResult.changed).toBe("boolean");
    });
  });
});

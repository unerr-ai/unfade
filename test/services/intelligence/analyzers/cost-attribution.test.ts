import { describe, expect, it } from "vitest";
import { costAttributionAnalyzer } from "../../../../src/services/intelligence/analyzers/cost-attribution.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { DbLike } from "../../../../src/services/cache/manager.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockAnalytics(overrides: Record<string, unknown[][]> = {}): DbLike {
  return {
    run() {},
    exec(sql: string, params?: unknown[]) {
      if (sql.includes("COALESCE(model_id") && sql.includes("GROUP BY")) {
        return [{
          columns: ["model", "cnt"],
          values: overrides.byModel ?? [["claude-4", 30], ["gpt-4", 20]],
        }];
      }
      if (sql.includes("intent_summary") && sql.includes("GROUP BY")) {
        return [{
          columns: ["domain", "cnt"],
          values: overrides.byDomain ?? [["auth", 15], ["database", 10]],
        }];
      }
      if (sql.includes("git_branch") && sql.includes("GROUP BY")) {
        return [{
          columns: ["branch", "cnt"],
          values: overrides.byBranch ?? [["main", 25], ["feat/auth", 15]],
        }];
      }
      if (sql.includes("features") && sql.includes("JOIN")) {
        return [{ columns: ["feature_name", "cnt"], values: overrides.byFeature ?? [] }];
      }
      if (sql.includes("human_direction_score < 0.2")) {
        return [{
          columns: ["total", "low_direction"],
          values: overrides.waste ?? [[50, 15]],
        }];
      }
      if (sql.includes("AVG(prompt_specificity)")) {
        return [{ columns: ["avg_spec"], values: overrides.context ?? [[0.6]] }];
      }
      if (sql.includes("human_direction_score >= 0.5") && sql.includes("COUNT(*)")) {
        return [{ columns: ["count"], values: overrides.directed ?? [[30]] }];
      }
      if (sql.includes("MIN(ts)") && sql.includes("MAX(ts)")) {
        return [{ columns: ["min", "max"], values: overrides.period ?? [["2026-04-01T00:00:00Z", "2026-04-28T12:00:00Z"]] }];
      }
      if (sql.includes("outcome = 'abandoned'")) {
        return [{
          columns: ["model", "cnt"],
          values: overrides.abandoned ?? [["claude-4", 3]],
        }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
      }
      if (sql.includes("SELECT id FROM events") && params) {
        return [{ columns: ["id"], values: [["evt-c1"], ["evt-c2"]] }];
      }
      if (sql.includes("SELECT id FROM events")) {
        return [{ columns: ["id"], values: [["evt-c1"], ["evt-c2"], ["evt-c3"]] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: { pricing: { "claude-4": 0.03, "gpt-4": 0.06 } },
    knowledge: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("cost-attribution (IP-3.3)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });

    it("_meta.dataPoints equals sum of model event counts", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      expect(state.value.output._meta.dataPoints).toBe(50);
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("generates warning for high waste ratio", async () => {
      const analytics = createMockAnalytics({
        waste: [[20, 10]],
      });
      const ctx = makeCtx({ analytics });
      const state = await costAttributionAnalyzer.initialize(ctx);

      const warnings = state.value.output.diagnostics.filter((d) =>
        d.message.includes("waste ratio"),
      );
      expect(warnings.length).toBeGreaterThanOrEqual(1);
    });

    it("generates diagnostic for abandoned sessions", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      const abandonedDiags = state.value.output.diagnostics.filter((d) =>
        d.message.includes("abandoned"),
      );
      expect(abandonedDiags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("per-dimension evidenceEventIds", () => {
    it("byModel dimensions include evidenceEventIds", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      for (const dim of state.value.output.byModel) {
        expect(Array.isArray(dim.evidenceEventIds)).toBe(true);
      }
    });

    it("byBranch dimensions include evidenceEventIds", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      for (const dim of state.value.output.byBranch) {
        expect(Array.isArray(dim.evidenceEventIds)).toBe(true);
      }
    });

    it("byDomain dimensions include evidenceEventIds", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      for (const dim of state.value.output.byDomain) {
        expect(Array.isArray(dim.evidenceEventIds)).toBe(true);
      }
    });
  });

  describe("no artificial LIMIT caps", () => {
    it("returns all model dimensions without truncation", async () => {
      const manyModels = Array.from({ length: 20 }, (_, i) => [`model-${i}`, 10 + i]);
      const analytics = createMockAnalytics({ byModel: manyModels });
      const ctx = makeCtx({ analytics });
      const state = await costAttributionAnalyzer.initialize(ctx);

      expect(state.value.output.byModel.length).toBe(20);
    });

    it("returns all branch dimensions without truncation", async () => {
      const manyBranches = Array.from({ length: 15 }, (_, i) => [`branch-${i}`, 5 + i]);
      const analytics = createMockAnalytics({ byBranch: manyBranches });
      const ctx = makeCtx({ analytics });
      const state = await costAttributionAnalyzer.initialize(ctx);

      expect(state.value.output.byBranch.length).toBe(15);
    });
  });

  describe("cost computation", () => {
    it("computes total estimated cost from model pricing", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      expect(state.value.output.totalEstimatedCost).toBeGreaterThan(0);
      expect(state.value.output.isProxy).toBe(true);
      expect(state.value.output.disclaimer).toBeTruthy();
    });

    it("computes waste ratio when sufficient data", async () => {
      const ctx = makeCtx();
      const state = await costAttributionAnalyzer.initialize(ctx);

      expect(state.value.output.wasteRatio).not.toBeNull();
      expect(state.value.output.wasteRatio!).toBeGreaterThanOrEqual(0);
      expect(state.value.output.wasteRatio!).toBeLessThanOrEqual(1);
    });
  });

  describe("incremental update", () => {
    it("detects cost change", async () => {
      const ctx = makeCtx();
      const initState = await costAttributionAnalyzer.initialize(ctx);

      const updateResult = await costAttributionAnalyzer.update(
        initState,
        { events: [{ id: "evt" } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(typeof updateResult.changed).toBe("boolean");
    });
  });
});

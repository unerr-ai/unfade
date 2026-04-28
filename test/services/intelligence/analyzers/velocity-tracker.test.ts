import { describe, expect, it, vi } from "vitest";
import { velocityTrackerAnalyzer } from "../../../../src/services/intelligence/analyzers/velocity-tracker.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { DbLike } from "../../../../src/services/cache/manager.js";

vi.mock("../../../../src/services/workers/pool.js", () => ({
  getWorkerPool: () => ({
    classifyVelocityRows: vi.fn().mockResolvedValue({
      backend: [5, 4, 3, 4, 3],
      frontend: [6, 7, 8, 7, 8],
    }),
  }),
}));

function createMockAnalytics(): DbLike {
  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("content_summary") && sql.includes("turn_count")) {
        return [{
          columns: ["content_summary", "turns", "date"],
          values: [
            ["backend work", 4, "2026-04-20"],
            ["frontend fix", 7, "2026-04-21"],
          ],
        }];
      }
      if (sql.includes("SELECT id FROM events")) {
        return [{ columns: ["id"], values: [["evt-v1"], ["evt-v2"]] }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
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
    config: {},
    knowledge: null,
    ...overrides,
  };
}

describe("velocity-tracker (IP-4.1)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const ctx = makeCtx();
      const state = await velocityTrackerAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const ctx = makeCtx();
      const state = await velocityTrackerAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("diagnostics have valid structure", async () => {
      const ctx = makeCtx();
      const state = await velocityTrackerAnalyzer.initialize(ctx);

      for (const diag of state.value.output.diagnostics) {
        expect(["info", "warning", "critical"]).toContain(diag.severity);
        expect(diag.message).toBeTruthy();
        expect(Array.isArray(diag.evidenceEventIds)).toBe(true);
      }
    });
  });

  describe("per-domain evidenceEventIds", () => {
    it("domains include evidenceEventIds", async () => {
      const ctx = makeCtx();
      const state = await velocityTrackerAnalyzer.initialize(ctx);

      for (const [, domain] of Object.entries(state.value.output.byDomain)) {
        expect(Array.isArray(domain.evidenceEventIds)).toBe(true);
      }
    });
  });

  describe("computation", () => {
    it("computes domain velocity with trends", async () => {
      const ctx = makeCtx();
      const state = await velocityTrackerAnalyzer.initialize(ctx);

      expect(state.value.output.byDomain.backend).toBeDefined();
      expect(state.value.output.byDomain.frontend).toBeDefined();
      expect(["accelerating", "stable", "decelerating"]).toContain(state.value.output.overallTrend);
    });

    it("handles empty data gracefully", async () => {
      const emptyAnalytics: DbLike = {
        run() {},
        exec(sql: string) {
          if (sql.includes("MAX(ts)")) return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
          return [{ columns: [], values: [] }];
        },
      };
      const ctx = makeCtx({ analytics: emptyAnalytics });
      const state = await velocityTrackerAnalyzer.initialize(ctx);

      expect(state.value.output.dataPoints).toBe(0);
      expect(state.value.output.overallTrend).toBe("stable");
    });
  });

  describe("incremental update", () => {
    it("detects trend changes", async () => {
      const ctx = makeCtx();
      const initState = await velocityTrackerAnalyzer.initialize(ctx);

      const updateResult = await velocityTrackerAnalyzer.update(
        initState,
        { events: [{ id: "evt" } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(typeof updateResult.changed).toBe("boolean");
    });
  });
});

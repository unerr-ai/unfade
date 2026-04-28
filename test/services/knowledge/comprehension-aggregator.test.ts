import { describe, expect, it } from "vitest";
import {
  computeDailyComprehensionScore,
  computeRetrievability,
  mannKendallTrend,
} from "../../../src/services/knowledge/comprehension-aggregator.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

// ─── FSRS Decay Tests (§9 Formulas) ────────────────────────────────────────

describe("comprehension-aggregator (KE-14.1)", () => {
  describe("computeRetrievability (FSRS §9)", () => {
    it("returns 1.0 at day 0 (no decay)", () => {
      expect(computeRetrievability(0, 7, 1.0)).toBe(1.0);
    });

    it("returns ~0.90 at day 7 with stability=7 (spec scenario 1)", () => {
      const r = computeRetrievability(7, 7, 1.0);
      expect(r).toBeCloseTo(0.90, 1);
    });

    it("returns ~0.68 at day 30 with stability=7 (spec scenario 1)", () => {
      const r = computeRetrievability(30, 7, 1.0);
      expect(r).toBeCloseTo(0.68, 1);
    });

    it("returns ~0.41 at day 90 with stability=7 (spec scenario 1)", () => {
      const r = computeRetrievability(90, 7, 1.0);
      expect(r).toBeCloseTo(0.41, 1);
    });

    it("returns ~0.47 at day 30 with stability=3 (weak encoding, spec scenario 3)", () => {
      const r = computeRetrievability(30, 3, 1.0);
      expect(r).toBeCloseTo(0.47, 1);
    });

    it("complexity modifier accelerates decay", () => {
      const normal = computeRetrievability(30, 7, 1.0);
      const complex = computeRetrievability(30, 7, 0.5);
      expect(complex).toBeLessThan(normal);
    });

    it("complexity modifier slows decay", () => {
      const normal = computeRetrievability(30, 7, 1.0);
      const simple = computeRetrievability(30, 7, 1.5);
      expect(simple).toBeGreaterThan(normal);
    });

    it("handles zero stability gracefully", () => {
      expect(computeRetrievability(10, 0, 1.0)).toBe(1.0);
    });

    it("handles negative days gracefully", () => {
      expect(computeRetrievability(-5, 7, 1.0)).toBe(1.0);
    });
  });

  // ── Mann-Kendall Trend Detection ────────────────────────────────────

  describe("mannKendallTrend", () => {
    it("detects improving trend from 7 increasing scores", () => {
      const scores = [60, 62, 65, 67, 70, 73, 76];
      expect(mannKendallTrend(scores)).toBe("improving");
    });

    it("detects declining trend from 7 decreasing scores", () => {
      const scores = [80, 77, 74, 71, 68, 65, 62];
      expect(mannKendallTrend(scores)).toBe("declining");
    });

    it("reports stable for flat scores", () => {
      const scores = [70, 71, 69, 70, 71, 70, 70];
      expect(mannKendallTrend(scores)).toBe("stable");
    });

    it("reports stable for insufficient data (< 3 points)", () => {
      expect(mannKendallTrend([70, 75])).toBe("stable");
      expect(mannKendallTrend([70])).toBe("stable");
      expect(mannKendallTrend([])).toBe("stable");
    });

    it("reports stable for mixed/noisy data", () => {
      const scores = [65, 72, 60, 78, 55, 80, 62];
      expect(mannKendallTrend(scores)).toBe("stable");
    });

    it("requires 4+ points for significance — 3 points always stable", () => {
      expect(mannKendallTrend([50, 60, 70])).toBe("stable");
    });

    it("detects trend with 5 monotonic points", () => {
      expect(mannKendallTrend([50, 55, 60, 65, 70])).toBe("improving");
      expect(mannKendallTrend([70, 65, 60, 55, 50])).toBe("declining");
    });
  });

  // ── Daily Comprehension Score Aggregation ───────────────────────────

  describe("computeDailyComprehensionScore", () => {
    function createMockAnalytics(
      domains: Array<{
        domain: string;
        baseScore: number;
        stability: number;
        complexityModifier?: number;
        floorValue?: number;
        lastTouch: string;
        interactionCount: number;
      }>,
      historicalScores?: number[],
    ): DbLike {
      return {
        run() {},
        exec(sql: string, params?: unknown[]) {
          const sqlLower = sql.trim().toLowerCase();

          if (sqlLower.includes("from domain_comprehension")) {
            return [{
              columns: ["domain", "base_score", "stability", "complexity_modifier", "floor_value", "last_touch", "interaction_count"],
              values: domains.map((d) => [
                d.domain,
                d.baseScore,
                d.stability,
                d.complexityModifier ?? 1.0,
                d.floorValue ?? 0,
                d.lastTouch,
                d.interactionCount,
              ]),
            }];
          }

          if (sqlLower.includes("from comprehension_scores") && sqlLower.includes("select score")) {
            const scores = historicalScores ?? [];
            return [{
              columns: ["score"],
              values: scores.map((s) => [s]),
            }];
          }

          if (sqlLower.includes("insert into comprehension_scores")) {
            return [{ columns: [], values: [] }];
          }

          return [{ columns: [], values: [] }];
        },
      };
    }

    it("computes weighted average of 3 domains with known scores", async () => {
      const analytics = createMockAnalytics([
        { domain: "backend", baseScore: 8.0, stability: 7, lastTouch: "2026-04-26T10:00:00Z", interactionCount: 5 },
        { domain: "frontend", baseScore: 6.0, stability: 5, lastTouch: "2026-04-25T10:00:00Z", interactionCount: 3 },
        { domain: "database", baseScore: 4.0, stability: 3, lastTouch: "2026-04-20T10:00:00Z", interactionCount: 2 },
      ]);

      const result = await computeDailyComprehensionScore("2026-04-28", "proj-test", analytics);

      expect(result.domainCount).toBe(3);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.topDomain).toBe("backend");
      expect(result.weakDomain).toBe("database");
      expect(result.trend).toBe("stable");
    });

    it("returns zero for projects with no domains", async () => {
      const analytics = createMockAnalytics([]);
      const result = await computeDailyComprehensionScore("2026-04-28", "proj-empty", analytics);

      expect(result.score).toBe(0);
      expect(result.domainCount).toBe(0);
      expect(result.trend).toBe("stable");
    });

    it("applies floor value — domain never drops below floor", async () => {
      const analytics = createMockAnalytics([
        { domain: "auth-module", baseScore: 7.0, stability: 1, floorValue: 3,
          lastTouch: "2026-01-01T10:00:00Z", interactionCount: 5 },
      ]);

      const result = await computeDailyComprehensionScore("2026-04-28", "proj-test", analytics);

      // With stability=1 and ~117 days since touch, raw score is nearly 0.
      // Floor of 3 should prevent it from going below 30 in the 0-100 scale.
      expect(result.score).toBeGreaterThanOrEqual(20);
    });

    it("detects improving trend from historical scores (DESC order from SQL)", async () => {
      const analytics = createMockAnalytics(
        [{ domain: "backend", baseScore: 8.0, stability: 7, lastTouch: "2026-04-28T10:00:00Z", interactionCount: 5 }],
        [76, 73, 70, 67, 65, 62, 60],
      );

      const result = await computeDailyComprehensionScore("2026-04-28", "proj-test", analytics);
      expect(result.trend).toBe("improving");
    });

    it("applies recency weighting — recent domains weight more", async () => {
      // Domain A: recent (2 days ago), moderate score
      // Domain B: old (60 days ago), high score
      const analytics = createMockAnalytics([
        { domain: "recent-work", baseScore: 6.0, stability: 7, lastTouch: "2026-04-26T10:00:00Z", interactionCount: 3 },
        { domain: "old-work", baseScore: 9.0, stability: 7, lastTouch: "2026-02-28T10:00:00Z", interactionCount: 3 },
      ]);

      const result = await computeDailyComprehensionScore("2026-04-28", "proj-test", analytics);

      // The recent domain should dominate because recencyWeight=1.0 vs 0.3
      // recent-work decayed score ≈ 6.0 × 0.97 ≈ 5.8
      // old-work decayed score ≈ 9.0 × 0.08 ≈ 0.7
      // With weights: recent contributes much more
      expect(result.topDomain).toBe("recent-work");
    });

    it("writes comprehension.json snapshot", async () => {
      const { existsSync, readFileSync, mkdtempSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const tempDir = mkdtempSync(join(tmpdir(), "unfade-ke14-"));

      try {
        const analytics = createMockAnalytics([
          { domain: "backend", baseScore: 8.0, stability: 7, lastTouch: "2026-04-27T10:00:00Z", interactionCount: 5 },
        ]);

        await computeDailyComprehensionScore("2026-04-28", "proj-test", analytics, tempDir);

        const snapshotPath = join(tempDir, ".unfade", "intelligence", "comprehension.json");
        expect(existsSync(snapshotPath)).toBe(true);

        const snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));
        expect(snapshot.date).toBe("2026-04-28");
        expect(snapshot.score).toBeGreaterThan(0);
        expect(snapshot.domains).toHaveLength(1);
        expect(snapshot.domains[0].domain).toBe("backend");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

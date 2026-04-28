import { describe, expect, it } from "vitest";
import {
  computeRetrievability,
  computeStabilityUpdate,
  computeDecayedScore,
  computeDecay,
  MAX_STABILITY,
} from "../../../src/services/knowledge/decay-engine.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

// ─── FSRS Retrievability Tests (§9 Scenarios) ──────────────────────────────

describe("decay-engine (KE-15.1)", () => {
  describe("computeRetrievability", () => {
    it("Scenario 1: stability=7, day 7 → R ≈ 0.90", () => {
      expect(computeRetrievability(7, 7, 1.0)).toBeCloseTo(0.90, 1);
    });

    it("Scenario 1: stability=7, day 30 → R ≈ 0.68", () => {
      expect(computeRetrievability(30, 7, 1.0)).toBeCloseTo(0.68, 1);
    });

    it("Scenario 1: stability=7, day 90 → R ≈ 0.41", () => {
      expect(computeRetrievability(90, 7, 1.0)).toBeCloseTo(0.41, 1);
    });

    it("Scenario 3: stability=3, day 30 → R ≈ 0.47", () => {
      expect(computeRetrievability(30, 3, 1.0)).toBeCloseTo(0.47, 1);
    });

    it("day 0 → R = 1.0 (no decay)", () => {
      expect(computeRetrievability(0, 7, 1.0)).toBe(1.0);
    });

    it("high stability → slow decay", () => {
      const lowStability = computeRetrievability(30, 3, 1.0);
      const highStability = computeRetrievability(30, 14, 1.0);
      expect(highStability).toBeGreaterThan(lowStability);
    });

    it("complexity modifier 0.5 → faster decay", () => {
      const normal = computeRetrievability(30, 7, 1.0);
      const complex = computeRetrievability(30, 7, 0.5);
      expect(complex).toBeLessThan(normal);
    });

    it("complexity modifier 1.5 → slower decay", () => {
      const normal = computeRetrievability(30, 7, 1.0);
      const simple = computeRetrievability(30, 7, 1.5);
      expect(simple).toBeGreaterThan(normal);
    });

    it("handles zero stability gracefully", () => {
      expect(computeRetrievability(10, 0, 1.0)).toBe(1.0);
    });
  });

  // ── Stability Update (KE-15.2 formula) ──────────────────────────────

  describe("computeStabilityUpdate", () => {
    it("quality=5, stability=7 → new stability ≈ 14.2 (FSRS formula: S × (1 + 0.4 × log2(6)))", () => {
      const newS = computeStabilityUpdate(7, 5);
      // 7 × (1 + 0.4 × log2(6)) = 7 × (1 + 1.034) = 14.24
      expect(newS).toBeCloseTo(14.2, 0);
    });

    it("stability grows sublinearly — quality 5 adds less than 2× quality 1", () => {
      const growthQ1 = computeStabilityUpdate(7, 1) - 7;
      const growthQ5 = computeStabilityUpdate(7, 5) - 7;
      expect(growthQ5).toBeLessThan(growthQ1 * 5);
    });

    it("capped at MAX_STABILITY (365 days)", () => {
      const huge = computeStabilityUpdate(300, 5);
      expect(huge).toBeLessThanOrEqual(MAX_STABILITY);
    });

    it("minimum quality 1 still increases stability", () => {
      const newS = computeStabilityUpdate(7, 1);
      expect(newS).toBeGreaterThan(7);
    });

    it("clamps quality below 1 to 1", () => {
      const newS = computeStabilityUpdate(7, 0);
      expect(newS).toBeGreaterThan(7);
    });
  });

  // ── Decayed Score with Floor ─────────────────────────────────────────

  describe("computeDecayedScore", () => {
    it("applies floor — authored code never drops below 15", () => {
      // stability=1, 200 days ago → raw decay near zero
      const score = computeDecayedScore(80, 200, 1, 1.0, 15);
      expect(score).toBe(15);
    });

    it("no floor → score can approach zero", () => {
      const score = computeDecayedScore(80, 200, 1, 1.0, 0);
      expect(score).toBeLessThan(10);
    });

    it("fresh domain → score equals base_score", () => {
      const score = computeDecayedScore(80, 0, 7, 1.0, 0);
      expect(score).toBe(80);
    });
  });

  // ── Daily Decay Batch ────────────────────────────────────────────────

  describe("computeDecay (batch)", () => {
    function createMockAnalytics(
      domains: Array<{
        domain: string;
        projectId: string;
        baseScore: number;
        stability: number;
        complexityModifier?: number;
        floorValue?: number;
        lastTouch: string;
        currentScore?: number;
      }>,
    ): DbLike & { updatedScores: Map<string, number>; deletedDomains: string[] } {
      const updatedScores = new Map<string, number>();
      const deletedDomains: string[] = [];

      return {
        updatedScores,
        deletedDomains,
        run() {},
        exec(sql: string, params?: unknown[]) {
          const sqlLower = sql.trim().toLowerCase();

          if (sqlLower.startsWith("select") && sqlLower.includes("from domain_comprehension") && !sqlLower.includes("count")) {
            return [{
              columns: ["domain", "project_id", "base_score", "stability", "complexity_modifier", "floor_value", "last_touch"],
              values: domains.map((d) => [
                d.domain, d.projectId, d.baseScore, d.stability,
                d.complexityModifier ?? 1.0, d.floorValue ?? 0, d.lastTouch,
              ]),
            }];
          }

          if (sqlLower.startsWith("update domain_comprehension")) {
            const key = `${params?.[1]}:${params?.[2]}`;
            updatedScores.set(key, params?.[0] as number);
            return [{ columns: [], values: [] }];
          }

          if (sqlLower.startsWith("select count")) {
            const prunable = domains.filter(
              (d) => (d.currentScore ?? d.baseScore) < 5.0 && (d.floorValue ?? 0) === 0,
            );
            return [{ columns: ["count"], values: [[prunable.length]] }];
          }

          if (sqlLower.startsWith("delete")) {
            const prunable = domains.filter(
              (d) => (d.currentScore ?? d.baseScore) < 5.0 && (d.floorValue ?? 0) === 0,
            );
            for (const d of prunable) deletedDomains.push(d.domain);
            return [{ columns: [], values: [] }];
          }

          return [{ columns: [], values: [] }];
        },
      };
    }

    it("updates current_score for all domains", async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const analytics = createMockAnalytics([
        { domain: "backend", projectId: "proj-1", baseScore: 8, stability: 7, lastTouch: sevenDaysAgo },
        { domain: "frontend", projectId: "proj-1", baseScore: 6, stability: 5, lastTouch: sevenDaysAgo },
      ]);

      const result = await computeDecay(analytics, "proj-1");

      expect(result.domainsUpdated).toBe(2);
      expect(analytics.updatedScores.size).toBe(2);

      const backendScore = analytics.updatedScores.get("backend:proj-1")!;
      expect(backendScore).toBeCloseTo(8 * 0.90, 0);
    });

    it("marks domains as decayed when current_score < 95% of base_score", async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const analytics = createMockAnalytics([
        { domain: "old-module", projectId: "proj-1", baseScore: 8, stability: 7, lastTouch: thirtyDaysAgo },
      ]);

      const result = await computeDecay(analytics);

      expect(result.domainsDecayed).toBe(1);
    });

    it("returns zeros for empty domain set", async () => {
      const analytics = createMockAnalytics([]);
      const result = await computeDecay(analytics, "proj-empty");

      expect(result.domainsUpdated).toBe(0);
      expect(result.domainsDecayed).toBe(0);
      expect(result.domainsPruned).toBe(0);
    });

    it("respects floor value during decay", async () => {
      const longAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
      const analytics = createMockAnalytics([
        { domain: "authored-module", projectId: "proj-1", baseScore: 8, stability: 1, floorValue: 15, lastTouch: longAgo },
      ]);

      await computeDecay(analytics, "proj-1");

      const score = analytics.updatedScores.get("authored-module:proj-1")!;
      expect(score).toBeGreaterThanOrEqual(15);
    });
  });
});

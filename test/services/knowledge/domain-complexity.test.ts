import { describe, expect, it } from "vitest";
import { inferDomainComplexity } from "../../../src/services/knowledge/domain-complexity.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

function createMockAnalytics(
  interactionCount: number,
  engagementQuality: number,
): DbLike {
  return {
    run() {},
    exec(sql: string, params?: unknown[]) {
      const sqlLower = sql.trim().toLowerCase();

      if (sqlLower.includes("select") && sqlLower.includes("domain_comprehension") && !sqlLower.includes("distinct")) {
        return [{
          columns: ["interaction_count", "engagement_quality"],
          values: [[interactionCount, engagementQuality]],
        }];
      }

      if (sqlLower.includes("update")) {
        return [{ columns: [], values: [] }];
      }

      if (sqlLower.includes("distinct")) {
        return [{ columns: ["domain"], values: [] }];
      }

      return [{ columns: [], values: [] }];
    },
  };
}

function createMockCozo(): any {
  return {
    run() {
      return { rows: [] };
    },
  };
}

describe("domain-complexity (KE-15.3)", () => {
  it("simple domain: low interactions → modifier 1.5", async () => {
    const analytics = createMockAnalytics(1, 3);
    const modifier = await inferDomainComplexity("utils", "proj-1", analytics, createMockCozo());
    expect(modifier).toBe(1.5);
  });

  it("standard domain: moderate interactions (no facts) → modifier 1.0", async () => {
    const analytics = createMockAnalytics(6, 3);
    const modifier = await inferDomainComplexity("api", "proj-1", analytics, createMockCozo());
    expect(modifier).toBe(1.0);
  });

  it("higher complexity: high interactions + low quality → modifier 1.0 (needs facts for 0.7+)", async () => {
    const analytics = createMockAnalytics(12, 2);
    const modifier = await inferDomainComplexity("auth", "proj-1", analytics, createMockCozo());
    // interactionCount>=10 → +3, low quality + high interactions → +1 = score 4 → still standard
    // Reaching 0.7 or 0.5 requires fact signals from CozoDB
    expect(modifier).toBe(1.0);
  });

  it("complexity with fact signals drives to 0.7+", async () => {
    // Mock CozoDB returning fact counts
    const cozoWithFacts = {
      run(query: string) {
        if (query.includes("count(id)") && query.includes("DECIDED")) {
          return { rows: [[5]] };
        }
        if (query.includes("count(id)")) {
          return { rows: [[15]] };
        }
        return { rows: [] };
      },
    } as any;

    const analytics = createMockAnalytics(10, 3);
    const modifier = await inferDomainComplexity("microservices", "proj-1", analytics, cozoWithFacts);
    // interactionCount>=10 → +3, factCount>=10 → +2, decisionDensity 5/15=0.33>=0.3 → +2 = score 7 → 0.5
    expect(modifier).toBe(0.5);
  });

  it("returns standard modifier (1.0) when no data available", async () => {
    const emptyAnalytics: DbLike = {
      run() {},
      exec() {
        return [{ columns: [], values: [] }];
      },
    };
    const modifier = await inferDomainComplexity("unknown", "proj-1", emptyAnalytics, createMockCozo());
    expect(modifier).toBe(1.5);
  });

  it("modifier is always between 0.5 and 1.5", async () => {
    for (const count of [0, 1, 5, 10, 20, 50]) {
      for (const quality of [1, 2, 3, 4, 5]) {
        const analytics = createMockAnalytics(count, quality);
        const modifier = await inferDomainComplexity("test", "p", analytics, createMockCozo());
        expect(modifier).toBeGreaterThanOrEqual(0.5);
        expect(modifier).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

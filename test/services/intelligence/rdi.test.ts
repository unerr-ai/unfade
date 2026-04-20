import { describe, expect, it } from "vitest";
import type { DailyDistill } from "../../../src/schemas/distill.js";
import { computeGravityRDI, computeRDI } from "../../../src/services/intelligence/rdi.js";

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-17",
    summary: "Test distill",
    decisions: [],
    eventsProcessed: 10,
    ...overrides,
  };
}

// T-114: RDI for 3-decision distill → score in 50-70 range
describe("computeRDI", () => {
  it("scores 50-70 for a 3-decision distill with moderate depth", () => {
    const distill = makeDistill({
      decisions: [
        {
          decision: "Used DI over singletons",
          rationale: "Testability",
          domain: "architecture",
          alternativesConsidered: 3,
        },
        {
          decision: "Chose PostgreSQL",
          rationale: "Query complexity",
          domain: "database",
          alternativesConsidered: 2,
        },
        {
          decision: "Added circuit breaker",
          rationale: "Resilience",
          domain: "infrastructure",
          alternativesConsidered: 3,
        },
      ],
      tradeOffs: [
        {
          tradeOff: "Consistency vs availability",
          chose: "Consistency",
          rejected: "Availability",
        },
      ],
      deadEnds: [
        {
          description: "Tried Redis for sessions",
          resolution: "Switched to JWT",
        },
      ],
      domains: ["architecture", "database", "infrastructure"],
    });

    const rdi = computeRDI(distill, null);
    expect(rdi).toBeGreaterThanOrEqual(50);
    expect(rdi).toBeLessThanOrEqual(70);
  });

  // T-115: Zero-decision distill → RDI 0, no errors
  it("returns 0 for zero-decision distill", () => {
    const distill = makeDistill({ decisions: [] });
    expect(computeRDI(distill, null)).toBe(0);
  });

  it("returns 0 for empty decisions array", () => {
    const distill = makeDistill({ decisions: [], eventsProcessed: 0 });
    expect(computeRDI(distill, null)).toBe(0);
  });

  it("handles single decision with no alternatives", () => {
    const distill = makeDistill({
      decisions: [
        {
          decision: "Fix bug",
          rationale: "Was broken",
          alternativesConsidered: 0,
        },
      ],
    });
    const rdi = computeRDI(distill, null);
    expect(rdi).toBeGreaterThanOrEqual(0);
    expect(rdi).toBeLessThanOrEqual(30);
  });

  it("scores higher when dead ends have resolutions", () => {
    const base = {
      decisions: [{ decision: "A", rationale: "R", alternativesConsidered: 2, domain: "backend" }],
    };
    const withRecovery = makeDistill({
      ...base,
      deadEnds: [
        { description: "Dead end", resolution: "Found workaround" },
        { description: "Another dead end", resolution: "Reverted and tried again" },
      ],
    });
    const withoutRecovery = makeDistill({
      ...base,
      deadEnds: [{ description: "Dead end" }, { description: "Another dead end" }],
    });

    expect(computeRDI(withRecovery, null)).toBeGreaterThan(computeRDI(withoutRecovery, null));
  });

  it("scores higher with multi-domain decisions", () => {
    const singleDomain = makeDistill({
      decisions: [
        { decision: "A", rationale: "R", domain: "backend", alternativesConsidered: 2 },
        { decision: "B", rationale: "R", domain: "backend", alternativesConsidered: 2 },
      ],
      domains: ["backend"],
    });
    const multiDomain = makeDistill({
      decisions: [
        { decision: "A", rationale: "R", domain: "backend", alternativesConsidered: 2 },
        { decision: "B", rationale: "R", domain: "frontend", alternativesConsidered: 2 },
      ],
      domains: ["backend", "frontend"],
    });

    expect(computeRDI(multiDomain, null)).toBeGreaterThan(computeRDI(singleDomain, null));
  });

  it("always returns value in 0-100 range", () => {
    const highDistill = makeDistill({
      decisions: Array.from({ length: 10 }, (_, i) => ({
        decision: `Decision ${i}`,
        rationale: "Deep analysis",
        domain: `domain-${i % 5}`,
        alternativesConsidered: 5,
      })),
      tradeOffs: Array.from({ length: 10 }, (_, i) => ({
        tradeOff: `Trade-off ${i}`,
        chose: "A",
        rejected: "B",
      })),
      deadEnds: Array.from({ length: 5 }, (_, i) => ({
        description: `Dead end ${i}`,
        resolution: "Recovered",
      })),
      domains: ["a", "b", "c", "d", "e"],
    });

    const rdi = computeRDI(highDistill, null);
    expect(rdi).toBeGreaterThanOrEqual(0);
    expect(rdi).toBeLessThanOrEqual(100);
  });
});

// T-116: Gravity-weighted RDI
describe("computeGravityRDI", () => {
  it("multi-file cross-domain decision scores higher than single-file single-domain", () => {
    const multiFile = makeDistill({
      decisions: [
        {
          decision: "Major refactor",
          rationale: "R",
          domain: "architecture",
          alternativesConsidered: 4,
        },
        { decision: "DB change", rationale: "R", domain: "database", alternativesConsidered: 3 },
      ],
      tradeOffs: [{ tradeOff: "T", chose: "A", rejected: "B" }],
      domains: ["architecture", "database"],
    });

    const singleFile = makeDistill({
      decisions: [
        { decision: "Fix typo", rationale: "R", domain: "frontend", alternativesConsidered: 1 },
      ],
      domains: ["frontend"],
    });

    const gravityMulti = computeGravityRDI(multiFile, [
      "src/auth.ts",
      "src/db.ts",
      "src/models/user.ts",
      "tests/auth.test.ts",
    ]);
    const gravitySingle = computeGravityRDI(singleFile, ["src/page.tsx"]);

    expect(gravityMulti).toBeGreaterThan(gravitySingle);
  });

  it("returns 0 for zero decisions", () => {
    expect(computeGravityRDI(makeDistill(), [])).toBe(0);
  });
});

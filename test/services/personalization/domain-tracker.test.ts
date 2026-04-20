// Tests for UF-071: Domain tracker v2
// T-192, T-193, T-194, T-195
import { describe, expect, it } from "vitest";
import type { Decision } from "../../../src/schemas/distill.js";
import {
  detectCrossDomainConnections,
  trackDomains,
} from "../../../src/services/personalization/domain-tracker.js";

function makeDecision(
  overrides: Partial<Decision & { date: string }> = {},
): Decision & { date: string } {
  return {
    decision: "Test decision",
    rationale: "Test rationale",
    domain: "backend",
    alternativesConsidered: 2,
    date: "2026-04-15",
    ...overrides,
  };
}

describe("trackDomains", () => {
  // T-192: tracks frequency distribution across domains
  it("T-192: tracks frequency distribution across domains", () => {
    const decisions = [
      makeDecision({ domain: "backend", date: "2026-04-10" }),
      makeDecision({ domain: "backend", date: "2026-04-11" }),
      makeDecision({ domain: "backend", date: "2026-04-12" }),
      makeDecision({ domain: "frontend", date: "2026-04-10" }),
      makeDecision({ domain: "frontend", date: "2026-04-11" }),
      makeDecision({ domain: "database", date: "2026-04-10" }),
    ];

    const domains = trackDomains({ decisions });

    expect(domains.length).toBe(3);
    // Sorted by frequency descending
    expect(domains[0].domain).toBe("backend");
    expect(domains[0].frequency).toBe(3);
    expect(domains[1].domain).toBe("frontend");
    expect(domains[1].frequency).toBe(2);
    expect(domains[2].domain).toBe("database");
    expect(domains[2].frequency).toBe(1);

    // percentageOfTotal should sum to ~1
    const totalPct = domains.reduce((s, d) => s + d.percentageOfTotal, 0);
    expect(totalPct).toBeCloseTo(1, 2);
  });

  // T-193: detects depth progression (shallow → moderate → deep)
  it("T-193: detects depth progression (shallow → moderate → deep)", () => {
    // 3 decisions with low alternatives → shallow
    const shallowDecisions = Array.from({ length: 3 }, (_, i) =>
      makeDecision({
        domain: "frontend",
        alternativesConsidered: 1,
        date: `2026-04-${String(10 + i).padStart(2, "0")}`,
      }),
    );

    const shallowResult = trackDomains({ decisions: shallowDecisions });
    expect(shallowResult[0].depth).toBe("shallow");

    // 10 decisions with moderate alternatives → moderate
    const moderateDecisions = Array.from({ length: 10 }, (_, i) =>
      makeDecision({
        domain: "backend",
        alternativesConsidered: 2,
        date: `2026-04-${String(10 + i).padStart(2, "0")}`,
      }),
    );

    const moderateResult = trackDomains({ decisions: moderateDecisions });
    expect(moderateResult[0].depth).toBe("moderate");

    // 20 decisions with high alternatives → deep
    const deepDecisions = Array.from({ length: 20 }, (_, i) =>
      makeDecision({
        domain: "infrastructure",
        alternativesConsidered: 4,
        date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      }),
    );

    const deepResult = trackDomains({ decisions: deepDecisions });
    expect(deepResult[0].depth).toBe("deep");
  });

  // T-194: identifies cross-domain connections
  it("T-194: identifies cross-domain connections", () => {
    const decisions = [
      // backend + database appear together on multiple dates
      makeDecision({ domain: "backend", date: "2026-04-10" }),
      makeDecision({ domain: "database", date: "2026-04-10" }),
      makeDecision({ domain: "backend", date: "2026-04-11" }),
      makeDecision({ domain: "database", date: "2026-04-11" }),
      makeDecision({ domain: "frontend", date: "2026-04-12" }),
    ];

    const connections = detectCrossDomainConnections(decisions);
    expect(connections.length).toBeGreaterThan(0);

    const backendDb = connections.find(
      (c) =>
        (c.domainA === "backend" && c.domainB === "database") ||
        (c.domainA === "database" && c.domainB === "backend"),
    );
    expect(backendDb).toBeDefined();
    expect(backendDb?.coOccurrences).toBe(2);
  });

  // T-195: calculates depth trend (stable/deepening/broadening)
  it("T-195: calculates depth trend (stable/deepening/broadening)", () => {
    // Start with shallow existing domain
    const existingDomains = [
      {
        domain: "backend",
        frequency: 3,
        percentageOfTotal: 0.5,
        lastSeen: "2026-04-05",
        depth: "shallow" as const,
        depthTrend: "stable" as const,
        avgAlternativesInDomain: 1,
      },
    ];

    // Add many more decisions with high complexity → should deepen
    const decisions = Array.from({ length: 15 }, (_, i) =>
      makeDecision({
        domain: "backend",
        alternativesConsidered: 4,
        date: `2026-04-${String(10 + i).padStart(2, "0")}`,
      }),
    );

    const domains = trackDomains({ decisions, existingDomains });
    const backend = domains.find((d) => d.domain === "backend");
    expect(backend).toBeDefined();
    expect(backend?.depthTrend).toBe("deepening");
    expect(backend?.depth).not.toBe("shallow");
  });

  it("returns empty array for no decisions", () => {
    const domains = trackDomains({ decisions: [] });
    expect(domains).toEqual([]);
  });

  it("preserves existing domains not in new decisions", () => {
    const existingDomains = [
      {
        domain: "old-domain",
        frequency: 5,
        percentageOfTotal: 0.3,
        lastSeen: "2026-04-01",
        depth: "moderate" as const,
        depthTrend: "stable" as const,
        avgAlternativesInDomain: 2,
      },
    ];

    const decisions = [makeDecision({ domain: "new-domain", date: "2026-04-15" })];

    const domains = trackDomains({ decisions, existingDomains });
    const oldDomain = domains.find((d) => d.domain === "old-domain");
    expect(oldDomain).toBeDefined();
    expect(oldDomain?.frequency).toBe(5);
  });

  it("calculates avgAlternativesInDomain correctly", () => {
    const decisions = [
      makeDecision({ domain: "backend", alternativesConsidered: 2, date: "2026-04-10" }),
      makeDecision({ domain: "backend", alternativesConsidered: 4, date: "2026-04-11" }),
      makeDecision({ domain: "backend", alternativesConsidered: 6, date: "2026-04-12" }),
    ];

    const domains = trackDomains({ decisions });
    expect(domains[0].avgAlternativesInDomain).toBe(4);
  });
});

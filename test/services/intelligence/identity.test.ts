import { describe, expect, it } from "vitest";
import type { ReasoningModelV2 } from "../../../src/schemas/profile.js";
import { computeIdentityLabels } from "../../../src/services/intelligence/identity.js";

function makeProfile(overrides: Partial<ReasoningModelV2> = {}): ReasoningModelV2 {
  return {
    version: 2,
    lastUpdated: "2026-04-17",
    dataPoints: 30,
    decisionStyle: {
      avgAlternativesEvaluated: 2.5,
      medianAlternativesEvaluated: 2,
      explorationDepthMinutes: { overall: 15, byDomain: {} },
      aiAcceptanceRate: 0.6,
      aiModificationRate: 0.3,
      aiModificationByDomain: {},
    },
    tradeOffPreferences: [],
    domainDistribution: [
      {
        domain: "backend",
        frequency: 20,
        percentageOfTotal: 0.5,
        lastSeen: "2026-04-17",
        depth: "moderate",
        depthTrend: "deepening",
        avgAlternativesInDomain: 3,
      },
      {
        domain: "frontend",
        frequency: 10,
        percentageOfTotal: 0.25,
        lastSeen: "2026-04-16",
        depth: "shallow",
        depthTrend: "stable",
        avgAlternativesInDomain: 1.5,
      },
    ],
    patterns: [],
    temporalPatterns: {
      mostProductiveHours: [10, 14],
      avgDecisionsPerDay: 4,
      peakDecisionDays: ["2026-04-15"],
    },
    ...overrides,
  };
}

// T-117: Profile with avgAlternatives > 3 for 14+ days → "Thorough Explorer" label present
describe("computeIdentityLabels", () => {
  it("produces Thorough Explorer for avgAlternatives > 3 with 14+ days", () => {
    const profile = makeProfile({
      dataPoints: 30,
      decisionStyle: {
        avgAlternativesEvaluated: 4.2,
        medianAlternativesEvaluated: 4,
        explorationDepthMinutes: { overall: 20, byDomain: {} },
        aiAcceptanceRate: 0.5,
        aiModificationRate: 0.3,
        aiModificationByDomain: {},
      },
    });

    const labels = computeIdentityLabels(profile, 65);
    const names = labels.map((l) => l.label);
    expect(names).toContain("Thorough Explorer");
  });

  // T-118: Profile with <7 days of data → zero labels
  it("returns zero labels for less than 14 days of data", () => {
    const profile = makeProfile({ dataPoints: 5 });
    expect(computeIdentityLabels(profile, 80)).toEqual([]);
  });

  it("produces Domain Expert when a domain has depth=deep", () => {
    const profile = makeProfile({
      domainDistribution: [
        {
          domain: "backend",
          frequency: 50,
          percentageOfTotal: 0.8,
          lastSeen: "2026-04-17",
          depth: "deep",
          depthTrend: "stable",
          avgAlternativesInDomain: 3.5,
        },
      ],
    });

    const labels = computeIdentityLabels(profile, 60);
    expect(labels.map((l) => l.label)).toContain("Domain Expert");
  });

  it("produces Architectural Thinker for RDI >= 70", () => {
    const profile = makeProfile();
    const labels = computeIdentityLabels(profile, 75);
    expect(labels.map((l) => l.label)).toContain("Architectural Thinker");
  });

  it("does not produce Architectural Thinker for RDI < 70", () => {
    const profile = makeProfile();
    const labels = computeIdentityLabels(profile, 40);
    expect(labels.map((l) => l.label)).not.toContain("Architectural Thinker");
  });

  it("produces Pattern Synthesizer for multi-domain active developer", () => {
    const profile = makeProfile({
      domainDistribution: [
        {
          domain: "backend",
          frequency: 15,
          percentageOfTotal: 0.4,
          lastSeen: "2026-04-17",
          depth: "moderate",
          depthTrend: "deepening",
          avgAlternativesInDomain: 3,
        },
        {
          domain: "infrastructure",
          frequency: 10,
          percentageOfTotal: 0.3,
          lastSeen: "2026-04-16",
          depth: "moderate",
          depthTrend: "stable",
          avgAlternativesInDomain: 2.5,
        },
      ],
    });

    const labels = computeIdentityLabels(profile, 55);
    expect(labels.map((l) => l.label)).toContain("Pattern Synthesizer");
  });

  it("all labels have valid confidence and category", () => {
    const profile = makeProfile({
      dataPoints: 30,
      decisionStyle: {
        avgAlternativesEvaluated: 4.5,
        medianAlternativesEvaluated: 4,
        explorationDepthMinutes: { overall: 20, byDomain: {} },
        aiAcceptanceRate: 0.5,
        aiModificationRate: 0.3,
        aiModificationByDomain: {},
      },
      domainDistribution: [
        {
          domain: "backend",
          frequency: 30,
          percentageOfTotal: 0.6,
          lastSeen: "2026-04-17",
          depth: "deep",
          depthTrend: "stable",
          avgAlternativesInDomain: 4,
        },
        {
          domain: "frontend",
          frequency: 10,
          percentageOfTotal: 0.3,
          lastSeen: "2026-04-17",
          depth: "moderate",
          depthTrend: "deepening",
          avgAlternativesInDomain: 3,
        },
      ],
    });

    const labels = computeIdentityLabels(profile, 75);
    for (const label of labels) {
      expect(label.confidence).toBeGreaterThanOrEqual(0);
      expect(label.confidence).toBeLessThanOrEqual(1);
      expect(["decision_style", "trade_off", "domain", "ai_interaction", "exploration"]).toContain(
        label.category,
      );
    }
  });
});

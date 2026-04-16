// T-013: ReasoningModelV2Schema validates a complete profile
import { describe, expect, it } from "vitest";
import { ReasoningModelV2Schema } from "../../src/schemas/profile.js";

describe("ReasoningModelV2Schema", () => {
  it("T-013: validates a complete reasoning profile", () => {
    const profile = {
      version: 2,
      lastUpdated: "2026-04-15T12:00:00Z",
      dataPoints: 42,
      decisionStyle: {
        avgAlternativesEvaluated: 3.2,
        medianAlternativesEvaluated: 3,
        explorationDepthMinutes: {
          overall: 15,
          byDomain: { infrastructure: 25, frontend: 8 },
        },
        aiAcceptanceRate: 0.65,
        aiModificationRate: 0.6,
        aiModificationByDomain: { auth: 0.8, frontend: 0.3 },
      },
      tradeOffPreferences: [
        {
          preference: "simplicity over flexibility",
          confidence: 0.85,
          supportingDecisions: 8,
          contradictingDecisions: 2,
          firstObserved: "2026-03-01",
          lastObserved: "2026-04-15",
        },
      ],
      domainDistribution: [
        {
          domain: "backend",
          frequency: 20,
          percentageOfTotal: 0.45,
          lastSeen: "2026-04-15",
          depth: "deep",
          depthTrend: "stable",
          avgAlternativesInDomain: 3.5,
        },
      ],
      patterns: [
        {
          pattern: "Evaluates 3+ alternatives for infrastructure decisions",
          confidence: 0.82,
          observedSince: "2026-03-10",
          lastObserved: "2026-04-15",
          examples: 12,
          category: "decision_style",
        },
      ],
      temporalPatterns: {
        mostProductiveHours: [10, 14, 15],
        avgDecisionsPerDay: 4.2,
        peakDecisionDays: ["2026-04-10", "2026-04-12"],
      },
    };

    const result = ReasoningModelV2Schema.safeParse(profile);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(2);
      expect(result.data.decisionStyle.avgAlternativesEvaluated).toBe(3.2);
      expect(result.data.domainDistribution).toHaveLength(1);
      expect(result.data.patterns).toHaveLength(1);
      expect(result.data.tradeOffPreferences).toHaveLength(1);
      expect(result.data.temporalPatterns.mostProductiveHours).toHaveLength(3);
    }
  });
});

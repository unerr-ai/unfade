// T-013: ReasoningModelSchema validates a complete profile
import { describe, expect, it } from "vitest";
import { ReasoningModelSchema } from "../../src/schemas/profile.js";

describe("ReasoningModelSchema", () => {
  it("T-013: validates a complete reasoning profile", () => {
    const profile = {
      decisionStyle: "data-driven" as const,
      tradeOffWeights: {
        performance: 0.8,
        readability: 0.7,
        simplicity: 0.9,
        correctness: 1.0,
      },
      domainDepth: {
        typescript: "expert" as const,
        go: "intermediate" as const,
        "system-design": "advanced" as const,
      },
      explorationHabits: {
        triesToAlternatives: 3,
        revertFrequency: 0.15,
        prototypeBeforeCommit: true,
      },
      blindSpots: ["edge-case testing", "documentation"],
      failurePatterns: [
        {
          pattern: "Premature optimization in hot paths",
          frequency: 0.2,
          lastOccurred: "2026-04-10T14:30:00Z",
        },
      ],
    };

    const result = ReasoningModelSchema.safeParse(profile);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisionStyle).toBe("data-driven");
      expect(result.data.tradeOffWeights.performance).toBe(0.8);
      expect(result.data.domainDepth.typescript).toBe("expert");
      expect(result.data.explorationHabits.prototypeBeforeCommit).toBe(true);
      expect(result.data.blindSpots).toHaveLength(2);
      expect(result.data.failurePatterns).toHaveLength(1);
    }
  });
});

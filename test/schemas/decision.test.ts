// T-012: DecisionSchema validates a complete decision record
import { describe, expect, it } from "vitest";
import { DecisionSchema } from "../../src/schemas/decision.js";

describe("DecisionSchema", () => {
  it("T-012: validates a complete decision record", () => {
    const decision = {
      date: "2026-04-15",
      decision: "Use Zod 4 instead of Zod 3 for schema validation",
      rationale: "Zod 4 has better performance and smaller bundle size",
      alternativesEvaluated: ["io-ts", "yup", "ajv", "zod 3"],
      domain: "tooling",
      deadEnd: false,
      aiModified: true,
      sources: ["git:abc123", "ai-session:cursor-20260415"],
    };

    const result = DecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision).toContain("Zod 4");
      expect(result.data.alternativesEvaluated).toHaveLength(4);
      expect(result.data.deadEnd).toBe(false);
      expect(result.data.aiModified).toBe(true);
    }
  });
});

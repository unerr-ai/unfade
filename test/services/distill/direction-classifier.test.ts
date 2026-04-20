import { describe, expect, it } from "vitest";
import { classifyAmbiguous } from "../../../src/services/distill/direction-classifier.js";

// T-104: Direction classifier: skips LLM call when zero ambiguous decisions
describe("classifyAmbiguous", () => {
  it("returns immediately with zero tokens when no decisions", async () => {
    const result = await classifyAmbiguous([], null);
    expect(result).toEqual([]);
  });

  it("uses heuristic fallback when no provider", async () => {
    const decisions = [
      { eventId: "e1", summary: "Used DI", hds: 0.85 },
      { eventId: "e2", summary: "Accepted suggestion", hds: 0.15 },
      { eventId: "e3", summary: "Iterative refinement", hds: 0.45 },
    ];

    const result = await classifyAmbiguous(decisions, null);

    expect(result).toHaveLength(3);
    expect(result[0].classification).toBe("human-directed");
    expect(result[1].classification).toBe("llm-directed");
    expect(result[2].classification).toBe("collaborative");
  });

  it("maps HDS thresholds correctly: >=0.6 human, >=0.3 collaborative, <0.3 llm", async () => {
    const decisions = [
      { eventId: "e1", summary: "A", hds: 0.6 },
      { eventId: "e2", summary: "B", hds: 0.3 },
      { eventId: "e3", summary: "C", hds: 0.29 },
    ];

    const result = await classifyAmbiguous(decisions, null);
    expect(result[0].classification).toBe("human-directed");
    expect(result[1].classification).toBe("collaborative");
    expect(result[2].classification).toBe("llm-directed");
  });
});

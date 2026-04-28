import { describe, expect, it } from "vitest";
import {
  readComprehensionOverview,
  readModuleComprehension,
} from "../../../src/services/intelligence/comprehension.js";

/** Minimal mock that returns canned DuckDB-style results. */
function mockDb(responses: Array<{ columns: string[]; values: unknown[][] }>) {
  let callIndex = 0;
  return {
    exec: async () => {
      const result = responses[callIndex] ?? { columns: [], values: [] };
      callIndex++;
      return [result];
    },
  };
}

describe("comprehension readers (Layer 2.5)", () => {
  it("readComprehensionOverview returns data from assessment + domain tables", async () => {
    const db = mockDb([
      // First call: comprehension_assessment overall score
      { columns: ["overall_score", "cnt"], values: [[72, 5]] },
      // Second call: domain_comprehension rows
      {
        columns: ["domain", "current_score", "stability", "interaction_count", "last_touch"],
        values: [
          ["auth", 85, 0.9, 12, "2026-04-27T10:00:00Z"],
          ["payments", 45, 0.6, 8, "2026-04-26T14:00:00Z"],
        ],
      },
    ]);

    const overview = await readComprehensionOverview(db);
    expect(overview.overallScore).toBe(72);
    expect(overview.assessmentCount).toBe(5);
    expect(overview.domainScores).toHaveLength(2);
    expect(overview.domainScores[0].domain).toBe("auth");
    expect(overview.domainScores[0].currentScore).toBe(85);
    expect(overview.domainScores[1].domain).toBe("payments");
  });

  it("readComprehensionOverview returns nulls for empty DB", async () => {
    const db = mockDb([
      { columns: [], values: [] },
      { columns: [], values: [] },
    ]);

    const overview = await readComprehensionOverview(db);
    expect(overview.overallScore).toBeNull();
    expect(overview.assessmentCount).toBe(0);
    expect(overview.domainScores).toHaveLength(0);
  });

  it("readModuleComprehension maps domain→module", async () => {
    const db = mockDb([
      {
        columns: ["domain", "current_score", "interaction_count"],
        values: [
          ["api-layer", 78, 15],
          ["database", 92, 22],
        ],
      },
    ]);

    const modules = await readModuleComprehension(db);
    expect(modules).toHaveLength(2);
    expect(modules[0].module).toBe("api-layer");
    expect(modules[0].score).toBe(78);
    expect(modules[0].eventCount).toBe(15);
  });

  it("readModuleComprehension returns empty for no data", async () => {
    const db = mockDb([{ columns: [], values: [] }]);
    const modules = await readModuleComprehension(db);
    expect(modules).toHaveLength(0);
  });
});

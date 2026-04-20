import { describe, expect, it } from "vitest";
import {
  computeComprehension,
  computeComprehensionBatch,
} from "../../../src/services/intelligence/comprehension.js";

describe("comprehension proxy (UF-217)", () => {
  it("scores high engagement from direction signals", () => {
    const score = computeComprehension({
      eventId: "e1",
      source: "ai-session",
      metadata: {
        direction_signals: {
          prompt_specificity: 0.9,
          rejection_count: 2,
          modification_after_accept: true,
          domain_injection: true,
          human_direction_score: 0.85,
        },
      },
    });
    expect(score).not.toBeNull();
    expect(score?.score).toBeGreaterThan(0.5);
  });

  it("returns null for git-only events", () => {
    expect(
      computeComprehension({
        eventId: "e2",
        source: "git",
        metadata: {},
      }),
    ).toBeNull();
  });

  it("computeComprehensionBatch filters to AI events", () => {
    const batch = computeComprehensionBatch([
      {
        eventId: "a",
        source: "ai-session",
        metadata: { direction_signals: { prompt_specificity: 0.5 } },
      },
      { eventId: "b", source: "git", metadata: {} },
    ]);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.eventId).toBe("a");
  });
});

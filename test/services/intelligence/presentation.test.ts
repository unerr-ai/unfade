import { describe, expect, it } from "vitest";
import { presentMetric } from "../../../src/services/intelligence/presentation.js";

// T-119: RDI 34 → framing contains "reflex mode" or equivalent, improvement suggestion present
describe("presentMetric", () => {
  it("frames RDI 34 as reflex/fast mode with improvement suggestion", () => {
    const result = presentMetric("rdi", 34, []);

    expect(result.score).toBe(34);
    expect(result.label.toLowerCase()).toContain("pragmatic");
    expect(result.framing.toLowerCase()).toMatch(/fast|decisive/);
    expect(result.improvement).toBeDefined();
    expect(result.improvement?.length).toBeGreaterThan(10);
  });

  it("frames RDI 75 as architectural thinker", () => {
    const result = presentMetric("rdi", 75, []);
    expect(result.label).toBe("Architectural Thinker");
    expect(result.improvement).toBeUndefined();
  });

  it("frames RDI 15 as reflex mode with improvement", () => {
    const result = presentMetric("rdi", 15, []);
    expect(result.label).toBe("Reflex Mode");
    expect(result.improvement).toBeDefined();
  });

  it("returns null trend with insufficient history", () => {
    const result = presentMetric("rdi", 60, [50, 55, 58]);
    expect(result.trend).toBeNull();
  });

  it("detects upward trend from sufficient history", () => {
    const history = [40, 42, 45, 48, 50, 53, 56, 59, 62, 65];
    const result = presentMetric("rdi", 65, history);
    expect(result.trend).toBe("up");
    expect(result.trendMagnitude).toBeGreaterThan(0);
  });

  it("detects downward trend", () => {
    const history = [80, 77, 74, 71, 68, 65, 62, 59, 56, 53];
    const result = presentMetric("rdi", 53, history);
    expect(result.trend).toBe("down");
  });

  it("detects stable trend", () => {
    const history = [60, 60, 61, 60, 59, 60, 61, 60, 60, 60];
    const result = presentMetric("rdi", 60, history);
    expect(result.trend).toBe("stable");
  });

  it("handles DCS metric", () => {
    const result = presentMetric("dcs", 45, []);
    expect(result.label).toBe("Developing Clarity");
    expect(result.improvement).toBeDefined();
  });

  it("handles CWI metric", () => {
    const result = presentMetric("cwi", 3, []);
    expect(result.label).toBe("Strong Growth");
  });

  it("score is always preserved in output", () => {
    for (const score of [0, 25, 50, 75, 100]) {
      const result = presentMetric("rdi", score, []);
      expect(result.score).toBe(score);
    }
  });
});

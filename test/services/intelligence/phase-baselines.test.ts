// T-343/T-344: Phase-normalized baselines tests
import { describe, expect, it } from "vitest";
import {
  computePhaseBaselines,
  getPhaseExpectedRange,
  isHdsConcerning,
  normalizeHds,
  type PhaseBaseline,
} from "../../../src/services/intelligence/phase-baselines.js";

function createMockDb(events: Array<{ phase: string; hds: number }>) {
  return {
    run(): void {},
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }> {
      if (sql.includes("execution_phase") && sql.includes("human_direction_score")) {
        return [
          {
            columns: ["phase", "hds"],
            values: events.map((e) => [e.phase, e.hds]),
          },
        ];
      }
      return [];
    },
  };
}

describe("phase baselines", () => {
  it("computes per-phase mean HDS and stddev", async () => {
    const events = [
      // 60 planning events with high HDS
      ...Array.from({ length: 60 }, () => ({ phase: "planning", hds: 0.85 })),
      // 60 debugging events with low HDS
      ...Array.from({ length: 60 }, () => ({ phase: "debugging", hds: 0.25 })),
    ];

    const { baselines } = await computePhaseBaselines(createMockDb(events) as any);

    expect(baselines.planning).toBeDefined();
    expect(baselines.planning.trusted).toBe(true);
    expect(baselines.planning.meanHds).toBeCloseTo(0.85, 1);
    expect(baselines.planning.eventCount).toBe(60);

    expect(baselines.debugging).toBeDefined();
    expect(baselines.debugging.trusted).toBe(true);
    expect(baselines.debugging.meanHds).toBeCloseTo(0.25, 1);
  });

  it("marks baseline as untrusted with < 50 events", async () => {
    const events = Array.from({ length: 30 }, () => ({ phase: "review", hds: 0.6 }));
    const { baselines } = await computePhaseBaselines(createMockDb(events) as any);

    expect(baselines.review).toBeDefined();
    expect(baselines.review.trusted).toBe(false);
    expect(baselines.review.eventCount).toBe(30);
  });

  it("returns empty baselines when no data exists", async () => {
    const { baselines } = await computePhaseBaselines(createMockDb([]) as any);
    expect(Object.keys(baselines).length).toBe(0);
  });
});

describe("normalizeHds", () => {
  const baselines: Record<string, PhaseBaseline> = {
    debugging: { phase: "debugging", meanHds: 0.3, stdDev: 0.15, eventCount: 100, trusted: true },
    planning: { phase: "planning", meanHds: 0.85, stdDev: 0.1, eventCount: 100, trusted: true },
  };

  it("returns ~0 for HDS at phase mean", () => {
    const normalized = normalizeHds(0.3, "debugging", baselines);
    expect(normalized).toBeCloseTo(0, 1);
  });

  it("returns negative for HDS below phase mean", () => {
    const normalized = normalizeHds(0.1, "debugging", baselines);
    expect(normalized).toBeLessThan(0);
  });

  it("returns positive for HDS above phase mean", () => {
    const normalized = normalizeHds(0.5, "debugging", baselines);
    expect(normalized).toBeGreaterThan(0);
  });

  it("uses default ranges for untrusted baselines", () => {
    const untrusted: Record<string, PhaseBaseline> = {};
    const normalized = normalizeHds(0.3, "debugging", untrusted);
    // Default debugging range: 0.1-0.5, midpoint=0.3 → should be ~0
    expect(normalized).toBeCloseTo(0, 1);
  });
});

describe("isHdsConcerning", () => {
  const baselines: Record<string, PhaseBaseline> = {
    debugging: { phase: "debugging", meanHds: 0.3, stdDev: 0.1, eventCount: 100, trusted: true },
    planning: { phase: "planning", meanHds: 0.85, stdDev: 0.1, eventCount: 100, trusted: true },
  };

  it("debugging with HDS 0.3 is NOT concerning", () => {
    expect(isHdsConcerning(0.3, "debugging", baselines)).toBe(false);
  });

  it("planning with HDS 0.3 IS concerning (> 1.5 stddev below mean)", () => {
    expect(isHdsConcerning(0.3, "planning", baselines)).toBe(true);
  });

  it("debugging with HDS 0.05 IS concerning (very low even for debugging)", () => {
    expect(isHdsConcerning(0.05, "debugging", baselines)).toBe(true);
  });
});

describe("getPhaseExpectedRange", () => {
  it("returns empirical range for trusted baselines", () => {
    const baselines: Record<string, PhaseBaseline> = {
      debugging: { phase: "debugging", meanHds: 0.3, stdDev: 0.1, eventCount: 100, trusted: true },
    };
    const range = getPhaseExpectedRange("debugging", baselines);
    expect(range.low).toBeCloseTo(0.2, 1);
    expect(range.high).toBeCloseTo(0.4, 1);
  });

  it("returns default range for unknown phases", () => {
    const range = getPhaseExpectedRange("unknown-phase", {});
    expect(range.low).toBe(0.3);
    expect(range.high).toBe(0.7);
  });
});

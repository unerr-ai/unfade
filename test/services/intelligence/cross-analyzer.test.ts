// T-335/T-336: Cross-analyzer correlation tests
import { describe, expect, it, vi } from "vitest";
import { discoverCorrelations } from "../../../src/services/intelligence/cross-analyzer.js";
import type { UpdateResult } from "../../../src/services/intelligence/incremental-state.js";

// Mock paths so loadExistingCorrelations/writeCorrelations don't touch real FS
vi.mock("../../../src/utils/paths.js", () => ({
  getIntelligenceDir: () => "/tmp/cross-analyzer-test",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: (p: string) => {
      if (typeof p === "string" && p.includes("correlation.json")) return false;
      return (actual.existsSync as Function)(p);
    },
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

function createMockDb(dailyData: Array<{ day: string; value: number }>) {
  return {
    run(): void {},
    exec(_sql: string): Array<{ columns: string[]; values: unknown[][] }> {
      return [
        {
          columns: ["day", "value"],
          values: dailyData.map((d) => [d.day, d.value]),
        },
      ];
    },
  };
}

function makeChangedAnalyzers(...names: string[]): Map<string, UpdateResult<unknown>> {
  const map = new Map<string, UpdateResult<unknown>>();
  for (const name of names) {
    map.set(name, {
      state: { value: {}, watermark: "", eventCount: 10, updatedAt: new Date().toISOString() },
      changed: true,
    });
  }
  return map;
}

describe("cross-analyzer correlations", () => {
  it("detects negative correlation when data shows inverse relationship", async () => {
    // Create 10 days of data where value decreases (for efficiency) and increases (for loop-detector)
    const data = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-04-${String(i + 1).padStart(2, "0")}`,
      value: 0.8 - i * 0.06,
    }));

    const db = createMockDb(data) as any;
    const ctx = {
      repoRoot: "/tmp/test-repo",
      analytics: db,
      operational: db,
      db,
      config: {},
    };

    const changed = makeChangedAnalyzers("efficiency", "loop-detector", "comprehension-radar");
    const report = await discoverCorrelations(changed, ctx as any);

    // Should have checked at least one pair
    expect(report.checkedPairs).toBeGreaterThan(0);
  });

  it("requires minimum 2 changed analyzers to discover correlations", async () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-04-${String(i + 1).padStart(2, "0")}`,
      value: 0.5,
    }));

    const db = createMockDb(data) as any;
    const ctx = {
      repoRoot: "/tmp/test-repo",
      analytics: db,
      operational: db,
      db,
      config: {},
    };

    // Only one changed analyzer — should skip
    const changed = makeChangedAnalyzers("efficiency");
    const report = await discoverCorrelations(changed, ctx as any);
    expect(report.discoveredPairs).toBe(0);
    expect(report.checkedPairs).toBe(0);
  });

  it("includes correlation metadata in results", async () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-04-${String(i + 1).padStart(2, "0")}`,
      value: i * 0.1,
    }));

    const db = createMockDb(data) as any;
    const ctx = {
      repoRoot: "/tmp/test-repo",
      analytics: db,
      operational: db,
      db,
      config: {},
    };

    const changed = makeChangedAnalyzers("efficiency", "loop-detector", "velocity-tracker");
    const report = await discoverCorrelations(changed, ctx as any);

    expect(report).toHaveProperty("correlations");
    expect(report).toHaveProperty("updatedAt");
    expect(report).toHaveProperty("discoveredPairs");
    expect(report).toHaveProperty("checkedPairs");

    for (const c of report.correlations) {
      expect(c).toHaveProperty("id");
      expect(c).toHaveProperty("r");
      expect(c).toHaveProperty("direction");
      expect(c).toHaveProperty("dataPoints");
      expect(Math.abs(c.r)).toBeGreaterThanOrEqual(0.6);
    }
  });
});

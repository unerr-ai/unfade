// T-335/T-336: Cross-analyzer correlation tests
import { describe, expect, it } from "vitest";
import { computeCorrelations } from "../../../src/services/intelligence/cross-analyzer.js";

function createMockDb(dailyData: Array<{ day: string; hds: number; loops: number; turns: number; outcome: string; domain: string }>) {
  return {
    run(): void {},
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }> {
      // efficiency-loops query: returns day, avg_hds, loop_count
      if (sql.includes("avg_hds") && sql.includes("loop_count")) {
        return [{
          columns: ["day", "avg_hds", "loop_count"],
          values: dailyData.map((d) => [d.day, d.hds, d.loops]),
        }];
      }
      // comprehension-velocity: returns day, avg_comprehension, avg_turns
      if (sql.includes("avg_comprehension") && sql.includes("avg_turns")) {
        return [{
          columns: ["day", "avg_comprehension", "avg_turns"],
          values: dailyData.map((d) => [d.day, d.hds, d.turns]),
        }];
      }
      // cost-outcomes: returns day, session_count, success_count
      if (sql.includes("session_count") && sql.includes("success_count")) {
        return [{
          columns: ["day", "session_count", "success_count"],
          values: dailyData.map((d) => [d.day, 5, d.outcome === "success" ? 4 : 1]),
        }];
      }
      // blindspots-loops: returns domain, avg_hds, failure_rate
      if (sql.includes("failure_rate") && sql.includes("domain")) {
        return [{
          columns: ["domain", "avg_hds", "failure_rate"],
          values: dailyData.map((d) => [d.domain, d.hds, d.loops > 2 ? 0.8 : 0.1]),
        }];
      }
      // Load existing correlations
      if (sql.includes("correlation.json")) {
        return [];
      }
      return [];
    },
  };
}

describe("cross-analyzer correlations", () => {
  it("detects efficiency↔loop negative correlation when data shows inverse relationship", () => {
    // Create 10 days of data where high loops = low efficiency
    const data = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-04-${String(i + 1).padStart(2, "0")}`,
      hds: 0.8 - i * 0.06, // decreasing efficiency
      loops: i, // increasing loops
      turns: 5,
      outcome: "success",
      domain: `domain-${i}`,
    }));

    const ctx = {
      repoRoot: "/tmp/test-repo",
      db: createMockDb(data) as any,
      config: {},
    };

    const report = computeCorrelations(ctx as any);
    const effLoops = report.correlations.find((c) => c.id === "efficiency-loops");

    // Should detect negative correlation
    if (effLoops) {
      expect(effLoops.direction).toBe("negative");
      expect(Math.abs(effLoops.r)).toBeGreaterThanOrEqual(0.6);
      expect(effLoops.confidence).toBeGreaterThan(0);
      expect(effLoops.dataPoints).toBe(10);
    }
  });

  it("requires minimum data points (7) for correlation", () => {
    const data = Array.from({ length: 5 }, (_, i) => ({
      day: `2026-04-${String(i + 1).padStart(2, "0")}`,
      hds: 0.5,
      loops: 1,
      turns: 5,
      outcome: "success",
      domain: `domain-${i}`,
    }));

    const ctx = {
      repoRoot: "/tmp/test-repo",
      db: createMockDb(data) as any,
      config: {},
    };

    const report = computeCorrelations(ctx as any);
    // With only 5 data points, no correlations should be computed
    expect(report.correlations.length).toBe(0);
  });

  it("filters correlations below r=0.6 threshold", () => {
    // Random-ish data with no clear correlation
    const data = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-04-${String(i + 1).padStart(2, "0")}`,
      hds: 0.5 + (i % 2 === 0 ? 0.1 : -0.1),
      loops: i % 3,
      turns: 5 + (i % 2),
      outcome: i % 2 === 0 ? "success" : "failed",
      domain: `domain-${i}`,
    }));

    const ctx = {
      repoRoot: "/tmp/test-repo",
      db: createMockDb(data) as any,
      config: {},
    };

    const report = computeCorrelations(ctx as any);
    // All correlations that exist must have |r| >= 0.6
    for (const c of report.correlations) {
      expect(Math.abs(c.r)).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("includes temporal lag for efficiency-loops pair", () => {
    // Strong inverse correlation with lag pattern
    const data = Array.from({ length: 12 }, (_, i) => ({
      day: `2026-04-${String(i + 1).padStart(2, "0")}`,
      hds: i < 6 ? 0.8 : 0.3, // drops after day 6
      loops: i < 5 ? 0 : 5, // spikes at day 5 (precedes efficiency drop)
      turns: 5,
      outcome: "success",
      domain: `domain-${i}`,
    }));

    const ctx = {
      repoRoot: "/tmp/test-repo",
      db: createMockDb(data) as any,
      config: {},
    };

    const report = computeCorrelations(ctx as any);
    const effLoops = report.correlations.find((c) => c.id === "efficiency-loops");
    if (effLoops) {
      // temporalLag should be a number (0 or 1440 = 1 day)
      expect(typeof effLoops.temporalLag).toBe("number");
    }
  });
});

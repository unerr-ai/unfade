import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DailyDistill } from "../../../src/schemas/distill.js";
import type { ReasoningModelV2 } from "../../../src/schemas/profile.js";
import { readSnapshots, writeMetricSnapshot } from "../../../src/services/intelligence/snapshot.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function rmrf(dir: string): void {
  try {
    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-17",
    summary: "Test",
    decisions: [
      {
        decision: "Used DI",
        rationale: "Testability",
        domain: "backend",
        alternativesConsidered: 3,
      },
      {
        decision: "Chose Postgres",
        rationale: "Query flexibility",
        domain: "database",
        alternativesConsidered: 2,
      },
    ],
    tradeOffs: [{ tradeOff: "Speed vs safety", chose: "Safety", rejected: "Speed" }],
    deadEnds: [{ description: "Tried Redis", resolution: "Switched to JWT" }],
    eventsProcessed: 15,
    domains: ["backend", "database"],
    ...overrides,
  };
}

function makeProfile(): ReasoningModelV2 {
  return {
    version: 2,
    lastUpdated: "2026-04-17",
    dataPoints: 30,
    decisionStyle: {
      avgAlternativesEvaluated: 3.0,
      medianAlternativesEvaluated: 3,
      explorationDepthMinutes: { overall: 15, byDomain: {} },
      aiAcceptanceRate: 0.6,
      aiModificationRate: 0.3,
      aiModificationByDomain: {},
    },
    tradeOffPreferences: [],
    domainDistribution: [],
    patterns: [],
    temporalPatterns: {
      mostProductiveHours: [10],
      avgDecisionsPerDay: 4,
      peakDecisionDays: [],
    },
  };
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmrf(tmpDir);
});

// T-120: Writes valid JSONL line to .unfade/metrics/daily.jsonl after distill
describe("writeMetricSnapshot", () => {
  it("writes a valid JSONL line to daily.jsonl", () => {
    const distill = makeDistill();
    const profile = makeProfile();

    const snapshot = writeMetricSnapshot("2026-04-17", distill, profile, tmpDir);

    expect(snapshot.rdi).toBeGreaterThan(0);
    expect(snapshot.date).toBe("2026-04-17");
    expect(snapshot.decisionsCount).toBe(2);
    expect(snapshot.eventsProcessed).toBe(15);
    expect(snapshot.topDomain).toBe("backend");

    const filePath = join(tmpDir, ".unfade", "metrics", "daily.jsonl");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.rdi).toBe(snapshot.rdi);
    expect(parsed.date).toBe("2026-04-17");
  });

  it("is idempotent — same date overwrites, does not duplicate", () => {
    const distill = makeDistill();
    const profile = makeProfile();

    writeMetricSnapshot("2026-04-17", distill, profile, tmpDir);
    writeMetricSnapshot("2026-04-17", distill, profile, tmpDir);

    const filePath = join(tmpDir, ".unfade", "metrics", "daily.jsonl");
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });

  it("appends separate lines for different dates", () => {
    const profile = makeProfile();

    writeMetricSnapshot("2026-04-17", makeDistill({ date: "2026-04-17" }), profile, tmpDir);
    writeMetricSnapshot("2026-04-18", makeDistill({ date: "2026-04-18" }), profile, tmpDir);

    const filePath = join(tmpDir, ".unfade", "metrics", "daily.jsonl");
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("handles null profile gracefully", () => {
    const distill = makeDistill();
    const snapshot = writeMetricSnapshot("2026-04-17", distill, null, tmpDir);

    expect(snapshot.rdi).toBeGreaterThanOrEqual(0);
    expect(snapshot.identityLabels).toEqual([]);
  });

  it("creates metrics directory if missing", () => {
    const distill = makeDistill();
    writeMetricSnapshot("2026-04-17", distill, null, tmpDir);

    const metricsDir = join(tmpDir, ".unfade", "metrics");
    expect(existsSync(metricsDir)).toBe(true);
  });
});

describe("readSnapshots", () => {
  it("returns empty array when file does not exist", () => {
    expect(readSnapshots(join(tmpDir, "nonexistent.jsonl"))).toEqual([]);
  });

  it("reads back what was written", () => {
    const distill = makeDistill();
    const profile = makeProfile();

    writeMetricSnapshot("2026-04-17", distill, profile, tmpDir);

    const filePath = join(tmpDir, ".unfade", "metrics", "daily.jsonl");
    const snapshots = readSnapshots(filePath);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].date).toBe("2026-04-17");
    expect(snapshots[0].rdi).toBeGreaterThan(0);
  });
});

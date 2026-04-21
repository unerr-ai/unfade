// Tests for UF-055: Profile reader (v2 only)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProfile } from "../../src/tools/unfade-profile.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../.tmp-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeProfile(dir: string, profile: Record<string, unknown>): void {
  const profileDir = join(dir, ".unfade", "profile");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(profile), "utf-8");
}

const sampleV2Profile = {
  version: 2,
  lastUpdated: "2026-04-15T10:00:00Z",
  dataPoints: 5,
  decisionStyle: {
    avgAlternativesEvaluated: 2.3,
    medianAlternativesEvaluated: 2,
    explorationDepthMinutes: { overall: 0, byDomain: {} },
    aiAcceptanceRate: 0.75,
    aiModificationRate: 0.1,
    aiModificationByDomain: {},
  },
  tradeOffPreferences: [],
  domainDistribution: [
    {
      domain: "TypeScript",
      frequency: 8,
      percentageOfTotal: 0.7,
      lastSeen: "2026-04-15",
      depth: "moderate",
      depthTrend: "stable",
      avgAlternativesInDomain: 2,
    },
    {
      domain: "Go",
      frequency: 3,
      percentageOfTotal: 0.3,
      lastSeen: "2026-04-14",
      depth: "shallow",
      depthTrend: "deepening",
      avgAlternativesInDomain: 1.5,
    },
  ],
  patterns: [
    {
      pattern: "Polyglot developer",
      confidence: 0.8,
      observedSince: "2026-04-01",
      lastObserved: "2026-04-15",
      examples: 5,
      category: "exploration",
    },
    {
      pattern: "High AI acceptance",
      confidence: 0.9,
      observedSince: "2026-04-01",
      lastObserved: "2026-04-15",
      examples: 10,
      category: "ai_interaction",
    },
  ],
  temporalPatterns: {
    mostProductiveHours: [10, 14, 16],
    avgDecisionsPerDay: 4,
    peakDecisionDays: ["2026-04-15"],
  },
};

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("getProfile", () => {
  it("returns degraded empty profile when no profile exists", () => {
    const result = getProfile(tmpDir);
    expect(result._meta.tool).toBe("unfade-profile");
    expect(result._meta.degraded).toBe(true);
    expect(result._meta.degradedReason).toContain("not found");
    expect(result._meta.lastUpdated).toBeNull();
    expect(result.data.distillCount).toBe(0);
    expect(result.data.patterns).toEqual([]);
    expect(result.data.domainDistribution).toEqual([]);
  });

  it("reads existing v2 profile correctly", () => {
    writeProfile(tmpDir, sampleV2Profile);

    const result = getProfile(tmpDir);
    expect(result._meta.degraded).toBe(false);
    expect(result._meta.lastUpdated).not.toBeNull();
    expect(result.data.version).toBe(2);
    expect(result.data.distillCount).toBe(5);
    expect(result.data.avgAlternativesEvaluated).toBe(2.3);
    expect(result.data.aiAcceptanceRate).toBe(0.75);
    expect(result.data.aiModificationRate).toBe(0.1);
    expect(result.data.avgDecisionsPerDay).toBe(4);
  });

  it("returns domain distribution", () => {
    writeProfile(tmpDir, sampleV2Profile);

    const result = getProfile(tmpDir);
    expect(result.data.domainDistribution.length).toBe(2);
    expect(result.data.domainDistribution[0].domain).toBe("TypeScript");
    expect(result.data.domainDistribution[0].frequency).toBe(8);
  });

  it("returns patterns", () => {
    writeProfile(tmpDir, sampleV2Profile);

    const result = getProfile(tmpDir);
    expect(result.data.patterns).toEqual(["Polyglot developer", "High AI acceptance"]);
  });

  it("handles corrupted JSON gracefully", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), "NOT JSON{{{", "utf-8");

    const result = getProfile(tmpDir);
    expect(result._meta.degraded).toBe(true);
    expect(result._meta.degradedReason).toContain("Failed to read");
    expect(result.data.distillCount).toBe(0);
  });

  it("includes durationMs in _meta", () => {
    const result = getProfile(tmpDir);
    expect(result._meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns updatedAt from profile data", () => {
    writeProfile(tmpDir, sampleV2Profile);

    const result = getProfile(tmpDir);
    expect(result.data.updatedAt).toBe("2026-04-15T10:00:00Z");
  });

  it("returns degraded for unrecognized version", () => {
    writeProfile(tmpDir, { version: 99, foo: "bar" });

    const result = getProfile(tmpDir);
    expect(result._meta.degraded).toBe(true);
    expect(result._meta.degradedReason).toContain("unrecognized");
    expect(result.data.distillCount).toBe(0);
  });
});

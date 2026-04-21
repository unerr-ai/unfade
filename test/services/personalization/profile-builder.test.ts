// T-041: Profile builder tests (v2 only)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DailyDistill, ExtractedSignals } from "../../../src/schemas/distill.js";
import { updateProfileV2 } from "../../../src/services/personalization/profile-builder.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  // Create .git so getProjectDataDir resolves to this dir
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function rmrf(dir: string): void {
  try {
    const { rmSync } = require("node:fs");
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-15",
    summary: "Test distill",
    decisions: [
      {
        decision: "Added auth",
        rationale: "Security",
        domain: "backend",
        alternativesConsidered: 2,
      },
    ],
    eventsProcessed: 5,
    synthesizedBy: "fallback",
    ...overrides,
  };
}

function makeSignals(overrides: Partial<ExtractedSignals> = {}): ExtractedSignals {
  return {
    date: "2026-04-15",
    decisions: [],
    tradeOffs: [],
    deadEnds: [],
    breakthroughs: [],
    debuggingSessions: [],
    stats: {
      totalEvents: 5,
      commitCount: 3,
      aiCompletions: 2,
      aiRejections: 1,
      branchSwitches: 1,
      reverts: 0,
      filesChanged: ["src/auth.ts"],
      domains: ["TypeScript"],
    },
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmrf(tmpDir);
});

describe("updateProfileV2", () => {
  it("T-041a: creates default profile on first run", () => {
    const profile = updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    expect(profile.version).toBe(2);
    expect(profile.dataPoints).toBe(1);
    expect(profile.temporalPatterns.avgDecisionsPerDay).toBeGreaterThan(0);
  });

  it("T-041b: writes profile to .unfade/profile/reasoning_model.json", () => {
    updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    const profilePath = join(tmpDir, ".unfade", "profile", "reasoning_model.json");
    expect(existsSync(profilePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
    expect(parsed.version).toBe(2);
  });

  it("T-041c: increments dataPoints on subsequent runs", () => {
    updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    const profile = updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    expect(profile.dataPoints).toBe(2);
  });

  it("T-041d: computes running averages with temporal decay", () => {
    // Day 1: 1 decision with 2 alternatives
    updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    // Day 2: 3 decisions with 4 alternatives each
    const distill2 = makeDistill({
      decisions: [
        { decision: "A", rationale: "r", alternativesConsidered: 4 },
        { decision: "B", rationale: "r", alternativesConsidered: 4 },
        { decision: "C", rationale: "r", alternativesConsidered: 4 },
      ],
    });
    const profile = updateProfileV2(distill2, makeSignals(), tmpDir);
    // With decay weighting, new data is weighted 2x
    expect(profile.decisionStyle.avgAlternativesEvaluated).toBeGreaterThan(2);
  });

  it("T-041e: tracks domain distribution", () => {
    const distill = makeDistill({
      decisions: [
        { decision: "A", rationale: "r", domain: "TypeScript", alternativesConsidered: 1 },
        { decision: "B", rationale: "r", domain: "Go", alternativesConsidered: 1 },
      ],
    });
    const profile = updateProfileV2(distill, makeSignals(), tmpDir);
    expect(profile.domainDistribution.length).toBeGreaterThanOrEqual(1);
  });

  it("T-041f: accumulates domain frequency across runs", () => {
    const distill = makeDistill({
      decisions: [
        { decision: "A", rationale: "r", domain: "TypeScript", alternativesConsidered: 1 },
      ],
    });
    updateProfileV2(distill, makeSignals(), tmpDir);
    const profile = updateProfileV2(distill, makeSignals(), tmpDir);
    const tsDomain = profile.domainDistribution.find((d) => d.domain === "TypeScript");
    expect(tsDomain).toBeDefined();
    expect(tsDomain!.frequency).toBe(2);
  });

  it("T-041j: atomic write — no .tmp file left behind", () => {
    updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    const tmpPath = join(tmpDir, ".unfade", "profile", "reasoning_model.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);
  });

  it("T-041k: survives corrupted existing profile", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), "NOT JSON", "utf-8");
    const profile = updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    expect(profile.dataPoints).toBe(1);
  });

  it("T-041n: v2 with missing peakDecisionDays coerces correctly", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({
        version: 2,
        lastUpdated: "2026-01-01T00:00:00.000Z",
        dataPoints: 1,
        decisionStyle: {
          avgAlternativesEvaluated: 0,
          medianAlternativesEvaluated: 0,
          explorationDepthMinutes: { overall: 0, byDomain: {} },
          aiAcceptanceRate: 0,
          aiModificationRate: 0,
          aiModificationByDomain: {},
        },
        tradeOffPreferences: [],
        domainDistribution: [],
        patterns: [],
        temporalPatterns: {
          mostProductiveHours: [],
          avgDecisionsPerDay: 1,
        },
      }),
      "utf-8",
    );
    const distill = makeDistill({
      decisions: Array.from({ length: 5 }, () => ({
        decision: "x",
        rationale: "r",
        domain: "d",
        alternativesConsidered: 0,
      })),
    });
    expect(() => updateProfileV2(distill, makeSignals(), tmpDir)).not.toThrow();
    const out = JSON.parse(readFileSync(join(profileDir, "reasoning_model.json"), "utf-8"));
    expect(Array.isArray(out.temporalPatterns.peakDecisionDays)).toBe(true);
  });

  it("T-041o: updates AI acceptance rate from signals", () => {
    const signals = makeSignals({
      stats: {
        totalEvents: 10,
        commitCount: 5,
        aiCompletions: 8,
        aiRejections: 2,
        branchSwitches: 0,
        reverts: 0,
        filesChanged: [],
        domains: [],
      },
    });
    const profile = updateProfileV2(makeDistill(), signals, tmpDir);
    expect(profile.decisionStyle.aiAcceptanceRate).toBeGreaterThan(0);
  });

  it("T-041p: detects trade-off preferences", () => {
    const distill = makeDistill({
      tradeOffs: [{ chose: "speed", rejected: "safety", rationale: "deadline" }],
    });
    const profile = updateProfileV2(distill, makeSignals(), tmpDir);
    expect(profile.tradeOffPreferences.length).toBe(1);
    expect(profile.tradeOffPreferences[0].preference).toBe("speed over safety");
  });
});

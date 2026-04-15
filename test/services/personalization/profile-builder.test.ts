// T-041: Profile builder tests
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DailyDistill, ExtractedSignals } from "../../../src/schemas/distill.js";
import { updateProfile } from "../../../src/services/personalization/profile-builder.js";

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

describe("updateProfile", () => {
  it("T-041a: creates default profile on first run", () => {
    const profile = updateProfile(makeDistill(), makeSignals(), tmpDir);
    expect(profile.version).toBe(1);
    expect(profile.distillCount).toBe(1);
    expect(profile.avgDecisionsPerDay).toBe(1);
  });

  it("T-041b: writes profile to .unfade/profile/reasoning_model.json", () => {
    updateProfile(makeDistill(), makeSignals(), tmpDir);
    const profilePath = join(tmpDir, ".unfade", "profile", "reasoning_model.json");
    expect(existsSync(profilePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
    expect(parsed.version).toBe(1);
  });

  it("T-041c: increments distillCount on subsequent runs", () => {
    updateProfile(makeDistill(), makeSignals(), tmpDir);
    const profile = updateProfile(makeDistill(), makeSignals(), tmpDir);
    expect(profile.distillCount).toBe(2);
  });

  it("T-041d: computes running averages correctly", () => {
    // Day 1: 1 decision with 2 alternatives
    updateProfile(makeDistill(), makeSignals(), tmpDir);
    // Day 2: 3 decisions with 4 alternatives each
    const distill2 = makeDistill({
      decisions: [
        { decision: "A", rationale: "r", alternativesConsidered: 4 },
        { decision: "B", rationale: "r", alternativesConsidered: 4 },
        { decision: "C", rationale: "r", alternativesConsidered: 4 },
      ],
    });
    const profile = updateProfile(distill2, makeSignals(), tmpDir);
    // After 2 runs: avg alternatives = 2 + (4-2)/2 = 3
    expect(profile.avgAlternativesEvaluated).toBe(3);
    // Decisions per day: 1 + (3-1)/2 = 2
    expect(profile.avgDecisionsPerDay).toBe(2);
  });

  it("T-041e: tracks domain distribution", () => {
    const distill = makeDistill({ domains: ["TypeScript", "Go"] });
    const profile = updateProfile(distill, makeSignals(), tmpDir);
    expect(profile.domainDistribution).toHaveLength(2);
    expect(profile.domainDistribution[0].domain).toBe("TypeScript");
    expect(profile.domainDistribution[0].frequency).toBe(1);
  });

  it("T-041f: accumulates domain frequency across runs", () => {
    const distill = makeDistill({ domains: ["TypeScript"] });
    updateProfile(distill, makeSignals(), tmpDir);
    const profile = updateProfile(distill, makeSignals(), tmpDir);
    expect(profile.domainDistribution[0].frequency).toBe(2);
  });

  it("T-041g: detects multi-alternative pattern", () => {
    const distill = makeDistill({
      decisions: [
        { decision: "A", rationale: "r", domain: "infra", alternativesConsidered: 5 },
        { decision: "B", rationale: "r", domain: "infra", alternativesConsidered: 4 },
      ],
    });
    const profile = updateProfile(distill, makeSignals(), tmpDir);
    expect(profile.patterns.some((p) => p.includes("Explores 3+"))).toBe(true);
  });

  it("T-041h: detects high AI acceptance pattern", () => {
    const signals = makeSignals({
      stats: {
        totalEvents: 10,
        commitCount: 5,
        aiCompletions: 8,
        aiRejections: 1,
        branchSwitches: 0,
        reverts: 0,
        filesChanged: [],
        domains: [],
      },
    });
    const profile = updateProfile(makeDistill(), signals, tmpDir);
    expect(profile.patterns.some((p) => p.includes("High AI suggestion acceptance"))).toBe(true);
  });

  it("T-041i: detects polyglot pattern", () => {
    const distill = makeDistill({
      domains: ["TypeScript", "Go", "Python", "Rust"],
    });
    const profile = updateProfile(distill, makeSignals(), tmpDir);
    expect(profile.patterns.some((p) => p.includes("Polyglot developer"))).toBe(true);
  });

  it("T-041j: atomic write — no .tmp file left behind", () => {
    updateProfile(makeDistill(), makeSignals(), tmpDir);
    const tmpPath = join(tmpDir, ".unfade", "profile", "reasoning_model.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);
  });

  it("T-041k: survives corrupted existing profile", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), "NOT JSON", "utf-8");
    const profile = updateProfile(makeDistill(), makeSignals(), tmpDir);
    expect(profile.distillCount).toBe(1);
  });
});

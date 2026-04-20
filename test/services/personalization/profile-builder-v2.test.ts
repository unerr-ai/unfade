// Tests for UF-072: Profile builder v2
// T-196, T-197, T-198, T-199
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DailyDistill, ExtractedSignals } from "../../../src/schemas/distill.js";
import {
  type ReasoningProfile,
  updateProfileV2,
} from "../../../src/services/personalization/profile-builder.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-profile-v2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-15",
    summary: "Test distill",
    decisions: [
      {
        decision: "Added auth middleware",
        rationale: "Security requirement",
        domain: "backend",
        alternativesConsidered: 3,
      },
      {
        decision: "Chose Redis for cache",
        rationale: "Low latency",
        domain: "infrastructure",
        alternativesConsidered: 4,
      },
    ],
    tradeOffs: [
      {
        tradeOff: "Cache consistency vs speed",
        chose: "simplicity",
        rejected: "flexibility",
      },
    ],
    eventsProcessed: 10,
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
      totalEvents: 10,
      commitCount: 5,
      aiCompletions: 6,
      aiRejections: 2,
      branchSwitches: 1,
      reverts: 0,
      filesChanged: ["src/auth.ts", "src/cache.ts"],
      domains: ["TypeScript"],
    },
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("updateProfileV2", () => {
  // T-196: merges new data with running averages
  it("T-196: merges new data with running averages", () => {
    // First run
    const profile1 = updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    expect(profile1.version).toBe(2);
    expect(profile1.dataPoints).toBe(2); // 2 decisions

    // Second run with different alternatives
    const distill2 = makeDistill({
      date: "2026-04-16",
      decisions: [
        {
          decision: "Added logging",
          rationale: "Observability",
          domain: "backend",
          alternativesConsidered: 1,
        },
      ],
    });
    const profile2 = updateProfileV2(distill2, makeSignals(), tmpDir);
    expect(profile2.dataPoints).toBe(3); // 2 + 1

    // avgAlternativesEvaluated should be between the two values
    // First run: avg = (3+4)/2 = 3.5, second run: 1
    // With temporal decay (2x weight on new): (3.5 + 2*1)/3 ≈ 1.83
    expect(profile2.decisionStyle.avgAlternativesEvaluated).toBeLessThan(3.5);
    expect(profile2.decisionStyle.avgAlternativesEvaluated).toBeGreaterThan(0);
  });

  // T-197: applies temporal decay (recent data weighted higher)
  it("T-197: applies temporal decay (recent data weighted higher)", () => {
    // First run: high alternatives
    const distill1 = makeDistill({
      decisions: [
        {
          decision: "A",
          rationale: "r",
          domain: "backend",
          alternativesConsidered: 5,
        },
      ],
    });
    updateProfileV2(distill1, makeSignals(), tmpDir);

    // Second run: low alternatives — should heavily influence avg due to 2x decay
    const distill2 = makeDistill({
      date: "2026-04-16",
      decisions: [
        {
          decision: "B",
          rationale: "r",
          domain: "backend",
          alternativesConsidered: 1,
        },
      ],
    });
    const profile = updateProfileV2(distill2, makeSignals(), tmpDir);

    // With 2x weight on recent: (5 + 2*1)/3 ≈ 2.33
    // Without decay: (5+1)/2 = 3
    // So result should be closer to 1 than to 5
    expect(profile.decisionStyle.avgAlternativesEvaluated).toBeLessThan(3);
  });

  // T-198: detects trade-off preferences from history
  it("T-198: detects trade-off preferences from history", () => {
    const distill = makeDistill({
      tradeOffs: [
        { tradeOff: "t1", chose: "simplicity", rejected: "flexibility" },
        { tradeOff: "t2", chose: "simplicity", rejected: "flexibility" },
        { tradeOff: "t3", chose: "simplicity", rejected: "flexibility" },
      ],
    });

    const profile = updateProfileV2(distill, makeSignals(), tmpDir);
    expect(profile.tradeOffPreferences.length).toBeGreaterThan(0);

    const simplicity = profile.tradeOffPreferences.find((p) => p.preference.includes("simplicity"));
    expect(simplicity).toBeDefined();
    expect(simplicity?.supportingDecisions).toBe(3);
    expect(simplicity?.confidence).toBe(1); // All supporting, no contradicting
  });

  // T-199: handles v1 → v2 migration (profile builder reads v1 and writes v2)
  it("T-199: handles v1 → v2 migration via updateProfileV2", () => {
    // Write a v1 profile first
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    const v1Profile: ReasoningProfile = {
      version: 1,
      updatedAt: "2026-04-10T00:00:00Z",
      distillCount: 5,
      avgAlternativesEvaluated: 2.5,
      aiAcceptanceRate: 0.7,
      aiModificationRate: 0.3,
      avgDecisionsPerDay: 3,
      avgDeadEndsPerDay: 0.5,
      domainDistribution: [{ domain: "backend", frequency: 10, lastSeen: "2026-04-10" }],
      patterns: ["High AI suggestion acceptance (80%+)"],
    };
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(v1Profile), "utf-8");

    // updateProfileV2 should NOT read v1 as v2 — it should start fresh v2
    const profile = updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    expect(profile.version).toBe(2);
    // Should have the new decisions counted
    expect(profile.dataPoints).toBe(2);
  });

  it("writes v2 profile to disk", () => {
    updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    const profilePath = join(tmpDir, ".unfade", "profile", "reasoning_model.json");
    expect(existsSync(profilePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
    expect(parsed.version).toBe(2);
  });

  it("populates domain distribution", () => {
    const profile = updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    expect(profile.domainDistribution.length).toBeGreaterThan(0);
    const backend = profile.domainDistribution.find((d) => d.domain === "backend");
    expect(backend).toBeDefined();
    expect(backend?.frequency).toBeGreaterThan(0);
  });

  it("tracks temporal patterns", () => {
    const distill = makeDistill({
      decisions: Array.from({ length: 6 }, (_, i) => ({
        decision: `Decision ${i}`,
        rationale: "r",
        domain: "backend",
        alternativesConsidered: 2,
      })),
    });
    const profile = updateProfileV2(distill, makeSignals(), tmpDir);
    expect(profile.temporalPatterns.peakDecisionDays).toContain("2026-04-15");
  });

  it("atomic write — no .tmp file left behind", () => {
    updateProfileV2(makeDistill(), makeSignals(), tmpDir);
    const tmpPath = join(tmpDir, ".unfade", "profile", "reasoning_model.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);
  });
});

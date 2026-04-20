// Tests for UF-077: Profile migration v1 → v2
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateProfileOnDisk, migrateV1ToV2 } from "../../src/config/migrations.js";
import type { ReasoningProfile } from "../../src/services/personalization/profile-builder.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../.tmp-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function makeV1Profile(overrides: Partial<ReasoningProfile> = {}): ReasoningProfile {
  return {
    version: 1,
    updatedAt: "2026-04-10T12:00:00Z",
    distillCount: 10,
    avgAlternativesEvaluated: 2.5,
    aiAcceptanceRate: 0.75,
    aiModificationRate: 0.3,
    avgDecisionsPerDay: 4,
    avgDeadEndsPerDay: 0.5,
    domainDistribution: [
      { domain: "backend", frequency: 15, lastSeen: "2026-04-10" },
      { domain: "frontend", frequency: 8, lastSeen: "2026-04-09" },
      { domain: "database", frequency: 3, lastSeen: "2026-04-08" },
    ],
    patterns: [
      "Explores 3+ alternatives for infrastructure decisions",
      "High AI suggestion acceptance (80%+)",
      "Polyglot developer — works across 4+ domains in a day",
    ],
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

describe("migrateV1ToV2", () => {
  it("converts v1 profile to v2 format", () => {
    const v1 = makeV1Profile();
    const v2 = migrateV1ToV2(v1);

    expect(v2.version).toBe(2);
    expect(v2.dataPoints).toBe(v1.distillCount);
    expect(v2.lastUpdated).toBe(v1.updatedAt);
  });

  it("preserves decision style from v1", () => {
    const v1 = makeV1Profile();
    const v2 = migrateV1ToV2(v1);

    expect(v2.decisionStyle.avgAlternativesEvaluated).toBe(v1.avgAlternativesEvaluated);
    expect(v2.decisionStyle.aiAcceptanceRate).toBe(v1.aiAcceptanceRate);
    expect(v2.decisionStyle.aiModificationRate).toBe(v1.aiModificationRate);
  });

  it("migrates domain distribution with depth classification", () => {
    const v1 = makeV1Profile();
    const v2 = migrateV1ToV2(v1);

    expect(v2.domainDistribution.length).toBe(3);

    const backend = v2.domainDistribution.find((d) => d.domain === "backend");
    expect(backend).toBeDefined();
    expect(backend?.frequency).toBe(15);
    expect(backend?.depth).toBe("moderate"); // 15 decisions → moderate
    expect(backend?.depthTrend).toBe("stable"); // No historical comparison
    expect(backend?.percentageOfTotal).toBeCloseTo(15 / 26, 2);

    const database = v2.domainDistribution.find((d) => d.domain === "database");
    expect(database).toBeDefined();
    expect(database?.depth).toBe("shallow"); // 3 decisions → shallow
  });

  it("migrates patterns with inferred categories", () => {
    const v1 = makeV1Profile();
    const v2 = migrateV1ToV2(v1);

    expect(v2.patterns.length).toBe(3);

    const explorationPattern = v2.patterns.find((p) => p.pattern.includes("alternatives"));
    expect(explorationPattern).toBeDefined();
    expect(explorationPattern?.category).toBe("exploration");
    expect(explorationPattern?.confidence).toBe(0.7);

    const aiPattern = v2.patterns.find((p) => p.pattern.includes("AI"));
    expect(aiPattern).toBeDefined();
    expect(aiPattern?.category).toBe("ai_interaction");

    const domainPattern = v2.patterns.find((p) => p.pattern.includes("Polyglot"));
    expect(domainPattern).toBeDefined();
    expect(domainPattern?.category).toBe("domain");
  });

  it("preserves temporal patterns from v1", () => {
    const v1 = makeV1Profile();
    const v2 = migrateV1ToV2(v1);

    expect(v2.temporalPatterns.avgDecisionsPerDay).toBe(v1.avgDecisionsPerDay);
    expect(v2.temporalPatterns.mostProductiveHours).toEqual([]); // Not in v1
    expect(v2.temporalPatterns.peakDecisionDays).toEqual([]); // Not in v1
  });

  it("initializes empty fields for data not in v1", () => {
    const v1 = makeV1Profile();
    const v2 = migrateV1ToV2(v1);

    expect(v2.tradeOffPreferences).toEqual([]);
    expect(v2.decisionStyle.explorationDepthMinutes.overall).toBe(0);
    expect(v2.decisionStyle.aiModificationByDomain).toEqual({});
  });
});

describe("migrateProfileOnDisk", () => {
  it("migrates v1 profile and creates backup", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    const v1 = makeV1Profile();
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(v1), "utf-8");

    const result = migrateProfileOnDisk(tmpDir);

    expect(result).not.toBeNull();
    expect(result?.version).toBe(2);

    // Backup exists
    expect(existsSync(join(profileDir, "reasoning_model.v1.backup.json"))).toBe(true);
    const backup = JSON.parse(
      readFileSync(join(profileDir, "reasoning_model.v1.backup.json"), "utf-8"),
    );
    expect(backup.version).toBe(1);

    // Main file is now v2
    const main = JSON.parse(readFileSync(join(profileDir, "reasoning_model.json"), "utf-8"));
    expect(main.version).toBe(2);
  });

  it("returns null when no profile exists", () => {
    const result = migrateProfileOnDisk(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null when profile is already v2", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    const v2 = { version: 2, lastUpdated: "2026-04-15", dataPoints: 5 };
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(v2), "utf-8");

    const result = migrateProfileOnDisk(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for corrupted profile", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), "NOT JSON", "utf-8");

    const result = migrateProfileOnDisk(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for unknown version", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({ version: 99 }),
      "utf-8",
    );

    const result = migrateProfileOnDisk(tmpDir);
    expect(result).toBeNull();
  });
});

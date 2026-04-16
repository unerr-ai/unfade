// Tests for UF-055: Profile reader
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

const sampleProfile = {
  version: 1,
  updatedAt: "2026-04-15T10:00:00Z",
  distillCount: 5,
  avgAlternativesEvaluated: 2.3,
  aiAcceptanceRate: 0.75,
  aiModificationRate: 0.1,
  avgDecisionsPerDay: 4,
  avgDeadEndsPerDay: 0.5,
  domainDistribution: [
    { domain: "TypeScript", frequency: 8, lastSeen: "2026-04-15" },
    { domain: "Go", frequency: 3, lastSeen: "2026-04-14" },
  ],
  patterns: ["Polyglot developer", "High AI acceptance"],
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

  it("reads existing profile correctly", () => {
    writeProfile(tmpDir, sampleProfile);

    const result = getProfile(tmpDir);
    expect(result._meta.degraded).toBe(false);
    expect(result._meta.lastUpdated).not.toBeNull();
    expect(result.data.version).toBe(1);
    expect(result.data.distillCount).toBe(5);
    expect(result.data.avgAlternativesEvaluated).toBe(2.3);
    expect(result.data.aiAcceptanceRate).toBe(0.75);
    expect(result.data.aiModificationRate).toBe(0.1);
    expect(result.data.avgDecisionsPerDay).toBe(4);
    expect(result.data.avgDeadEndsPerDay).toBe(0.5);
  });

  it("returns domain distribution", () => {
    writeProfile(tmpDir, sampleProfile);

    const result = getProfile(tmpDir);
    expect(result.data.domainDistribution.length).toBe(2);
    expect(result.data.domainDistribution[0].domain).toBe("TypeScript");
    expect(result.data.domainDistribution[0].frequency).toBe(8);
  });

  it("returns patterns", () => {
    writeProfile(tmpDir, sampleProfile);

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
    writeProfile(tmpDir, sampleProfile);

    const result = getProfile(tmpDir);
    expect(result.data.updatedAt).toBe("2026-04-15T10:00:00Z");
  });
});

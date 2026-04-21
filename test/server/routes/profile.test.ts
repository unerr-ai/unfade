// Tests for UF-051: GET /unfade/profile route
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-prof-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeAll(() => {
  originalCwd = process.cwd();
});

afterAll(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("GET /unfade/profile", () => {
  it("returns reasoning profile", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({
        version: 2,
        lastUpdated: "2026-04-15T10:00:00Z",
        dataPoints: 5,
        decisionStyle: {
          avgAlternativesEvaluated: 2.5,
          medianAlternativesEvaluated: 2,
          explorationDepthMinutes: { overall: 0, byDomain: {} },
          aiAcceptanceRate: 0.8,
          aiModificationRate: 0.1,
          aiModificationByDomain: {},
        },
        tradeOffPreferences: [],
        domainDistribution: [
          { domain: "TypeScript", frequency: 10, percentageOfTotal: 1, lastSeen: "2026-04-15", depth: "moderate", depthTrend: "stable", avgAlternativesInDomain: 2 },
        ],
        patterns: [
          { pattern: "Polyglot", confidence: 0.9, observedSince: "2026-04-01", lastObserved: "2026-04-15", examples: 5, category: "exploration" },
        ],
        temporalPatterns: { mostProductiveHours: [], avgDecisionsPerDay: 3, peakDecisionDays: [] },
      }),
      "utf-8",
    );

    const app = createApp();
    const res = await app.request("/unfade/profile");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.distillCount).toBe(5);
    expect(body.data.patterns).toContain("Polyglot");
    expect(body._meta.tool).toBe("unfade-profile");
    expect(body._meta.degraded).toBe(false);
  });

  it("returns degraded profile when no file exists", async () => {
    const app = createApp();
    const res = await app.request("/unfade/profile");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
    expect(body.data.distillCount).toBe(0);
  });
});

// T-148: Web UI — GET /profile returns profile visualization HTML page
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-profile-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Profile page (GET /profile)", () => {
  it("returns HTML page with profile metrics", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Reasoning Fingerprint");
    // Empty state or populated profile — both use layout + surface card
    expect(html.includes("Not enough data") || html.includes("grid grid-cols-2")).toBe(true);
  });

  it("renders profile page (empty or populated)", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("<html");
    expect(
      html.includes("Not enough data") || html.includes("No profile") || html.includes("Reasoning Fingerprint"),
    ).toBe(true);
  });

  it("shows domain distribution when v2 profile exists", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({
        version: 2,
        lastUpdated: "2026-04-16T00:00:00Z",
        dataPoints: 10,
        decisionStyle: {
          avgAlternativesEvaluated: 2.5,
          medianAlternativesEvaluated: 2.0,
          explorationDepthMinutes: { overall: 10, byDomain: {} },
          aiAcceptanceRate: 0.7,
          aiModificationRate: 0.2,
          aiModificationByDomain: {},
        },
        tradeOffPreferences: [],
        domainDistribution: [
          {
            domain: "backend",
            frequency: 10,
            percentageOfTotal: 0.67,
            lastSeen: "2026-04-16",
            depth: "deep",
            depthTrend: "stable",
            avgAlternativesInDomain: 2.5,
          },
          {
            domain: "frontend",
            frequency: 5,
            percentageOfTotal: 0.33,
            lastSeen: "2026-04-15",
            depth: "moderate",
            depthTrend: "stable",
            avgAlternativesInDomain: 2.0,
          },
        ],
        patterns: [
          {
            pattern: "Explores 2+ alternatives before deciding",
            confidence: 0.8,
            observedSince: "2026-03-01",
            lastObserved: "2026-04-15",
            examples: 5,
            category: "decision_style",
          },
        ],
        temporalPatterns: {
          mostProductiveHours: [],
          avgDecisionsPerDay: 3.0,
          peakDecisionDays: [],
        },
      }),
    );

    // Mock paths to point to tmp dir
    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    vi.resetModules();
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();
    expect(html).toContain("backend");
    expect(html).toContain("frontend");
    expect(html).toContain("Explores 2+ alternatives before deciding");
    expect(html).not.toContain("Not enough data");
  });

  it("includes AI acceptance and modification rates when v2 profile exists", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({
        version: 2,
        lastUpdated: "2026-04-16T00:00:00Z",
        dataPoints: 5,
        decisionStyle: {
          avgAlternativesEvaluated: 2.0,
          medianAlternativesEvaluated: 2.0,
          explorationDepthMinutes: { overall: 0, byDomain: {} },
          aiAcceptanceRate: 0.7,
          aiModificationRate: 0.2,
          aiModificationByDomain: {},
        },
        tradeOffPreferences: [],
        domainDistribution: [],
        patterns: [],
        temporalPatterns: {
          mostProductiveHours: [],
          avgDecisionsPerDay: 2.0,
          peakDecisionDays: [],
        },
      }),
    );

    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    vi.resetModules();
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();
    expect(html).toContain("AI acceptance rate");
    expect(html).toContain("AI modification rate");
  });
});

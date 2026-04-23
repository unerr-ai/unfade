// T-206, T-207, T-208: Profile page v2 tests — decision style, domain distribution, patterns
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/setup-state.js", () => ({
  isSetupComplete: () => true,
  invalidateSetupCache: () => {},
}));

import type { ReasoningModelV2 } from "../../../src/schemas/profile.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-profile-v2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function makeV2Profile(overrides?: Partial<ReasoningModelV2>): ReasoningModelV2 {
  return {
    version: 2,
    lastUpdated: "2026-04-16T00:00:00Z",
    dataPoints: 10,
    decisionStyle: {
      avgAlternativesEvaluated: 3.2,
      medianAlternativesEvaluated: 3.0,
      explorationDepthMinutes: { overall: 15, byDomain: { backend: 20, frontend: 10 } },
      aiAcceptanceRate: 0.65,
      aiModificationRate: 0.25,
      aiModificationByDomain: { backend: 0.3, frontend: 0.2 },
    },
    tradeOffPreferences: [
      {
        preference: "Favors simplicity over flexibility",
        confidence: 0.85,
        supportingDecisions: 8,
        contradictingDecisions: 2,
        firstObserved: "2026-03-01",
        lastObserved: "2026-04-15",
      },
    ],
    domainDistribution: [
      {
        domain: "backend",
        frequency: 15,
        percentageOfTotal: 0.5,
        lastSeen: "2026-04-16",
        depth: "deep",
        depthTrend: "deepening",
        avgAlternativesInDomain: 3.5,
      },
      {
        domain: "frontend",
        frequency: 9,
        percentageOfTotal: 0.3,
        lastSeen: "2026-04-15",
        depth: "moderate",
        depthTrend: "stable",
        avgAlternativesInDomain: 2.5,
      },
      {
        domain: "infrastructure",
        frequency: 6,
        percentageOfTotal: 0.2,
        lastSeen: "2026-04-14",
        depth: "shallow",
        depthTrend: "broadening",
        avgAlternativesInDomain: 2.0,
      },
    ],
    patterns: [
      {
        pattern: "Explores multiple alternatives before committing",
        confidence: 0.9,
        observedSince: "2026-03-01",
        lastObserved: "2026-04-15",
        examples: 12,
        category: "decision_style",
      },
      {
        pattern: "Prefers backend solutions over frontend workarounds",
        confidence: 0.75,
        observedSince: "2026-03-10",
        lastObserved: "2026-04-14",
        examples: 8,
        category: "domain",
      },
      {
        pattern: "Low confidence pattern",
        confidence: 0.4,
        observedSince: "2026-04-10",
        lastObserved: "2026-04-12",
        examples: 2,
        category: "exploration",
      },
    ],
    temporalPatterns: {
      mostProductiveHours: [10, 14, 15],
      avgDecisionsPerDay: 3.5,
      peakDecisionDays: ["2026-04-10", "2026-04-12"],
    },
    ...overrides,
  };
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
  vi.restoreAllMocks();
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Profile page v2 (GET /profile)", () => {
  // T-206: Decision style rendering — avg/median alternatives, AI rates
  it("T-206: renders decision style stats from v2 profile", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    expect(res.status).toBe(200);
    const html = await res.text();

    // Identity narrative section with KPI cards
    expect(html).toContain("Identity narrative");
    expect(html).toContain("3.2"); // avgAlternativesEvaluated rendered as Alternatives
    expect(html).toContain("25%"); // modificationRate = Math.round(aiModificationRate * 100)
    expect(html).toContain("Modification");
    expect(html).toContain("Held rate");
  });

  // T-207: Domain distribution with depth badges and trend arrows
  it("T-207: renders domain distribution with depth and trends", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();

    // Domain names
    expect(html).toContain("backend");
    expect(html).toContain("frontend");
    expect(html).toContain("infrastructure");

    // Depth levels (rendered lowercase, CSS text-transform:uppercase)
    expect(html).toContain("deep");
    expect(html).toContain("moderate");
    expect(html).toContain("shallow");

    // Trend arrows
    expect(html).toContain("Deepening"); // title attr for ↑
    expect(html).toContain("Stable"); // title attr for —
    expect(html).toContain("Broadening"); // title attr for →

    // Avg alternatives per domain
    expect(html).toContain("3.5 avg alts");
    expect(html).toContain("2.5 avg alts");
  });

  // T-208: Patterns with confidence bars (only >0.7 shown)
  it("T-208: renders high-confidence patterns, hides low-confidence", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();

    // High-confidence patterns shown
    expect(html).toContain("Explores multiple alternatives before committing");
    expect(html).toContain("90%"); // confidence bar
    expect(html).toContain("decision_style"); // category badge
    expect(html).toContain("Prefers backend solutions over frontend workarounds");
    expect(html).toContain("75%");

    // Low-confidence pattern NOT shown (0.4 < 0.7)
    expect(html).not.toContain("Low confidence pattern");

    // Pattern metadata
    expect(html).toContain("12 examples");
    expect(html).toContain("8 examples");
    expect(html).toContain("10 observations"); // dataPoints
  });

  it("renders trade-off preferences section", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();

    expect(html).toContain("Trade-off Preferences");
    expect(html).toContain("Favors simplicity over flexibility");
    expect(html).toContain("8 supporting");
    expect(html).toContain("2 contradicting");
  });

  it("renders temporal activity patterns", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();

    expect(html).toContain("Activity Patterns");
    expect(html).toContain("3.5"); // avgDecisionsPerDay
    expect(html).toContain("10:00"); // mostProductiveHours
  });

  it("shows degraded state for v1 profiles", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-04-16T00:00:00Z",
        distillCount: 5,
        avgAlternativesEvaluated: 2.5,
        aiAcceptanceRate: 0.7,
        aiModificationRate: 0.2,
        avgDecisionsPerDay: 3.0,
        avgDeadEndsPerDay: 1.0,
        domainDistribution: [],
        patterns: [],
      }),
    );

    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();

    expect(html).toContain("Not enough data");
  });
});

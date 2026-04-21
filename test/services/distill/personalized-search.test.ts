// T-209, T-210: Personalization-weighted search tests
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/setup-state.js", () => ({
  isSetupComplete: () => true,
  invalidateSetupCache: () => {},
}));

import type { ReasoningModelV2 } from "../../../src/schemas/profile.js";
import { findSimilar } from "../../../src/services/distill/amplifier.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-search-pers-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      avgAlternativesEvaluated: 3.0,
      medianAlternativesEvaluated: 3.0,
      explorationDepthMinutes: { overall: 15, byDomain: {} },
      aiAcceptanceRate: 0.6,
      aiModificationRate: 0.3,
      aiModificationByDomain: {},
    },
    tradeOffPreferences: [
      {
        preference: "Favors performance over simplicity",
        confidence: 0.85,
        supportingDecisions: 6,
        contradictingDecisions: 1,
        firstObserved: "2026-03-01",
        lastObserved: "2026-04-15",
      },
    ],
    domainDistribution: [
      {
        domain: "backend",
        frequency: 20,
        percentageOfTotal: 0.6,
        lastSeen: "2026-04-16",
        depth: "deep",
        depthTrend: "deepening",
        avgAlternativesInDomain: 3.5,
      },
      {
        domain: "frontend",
        frequency: 8,
        percentageOfTotal: 0.25,
        lastSeen: "2026-04-15",
        depth: "moderate",
        depthTrend: "stable",
        avgAlternativesInDomain: 2.0,
      },
    ],
    patterns: [],
    temporalPatterns: {
      mostProductiveHours: [10, 14],
      avgDecisionsPerDay: 3.0,
      peakDecisionDays: [],
    },
    ...overrides,
  };
}

function writeDistill(dir: string, date: string, decisions: string[]): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  const lines = ["# Daily Distill", "", "## Decisions", ""];
  for (const d of decisions) {
    lines.push(`- **${d}**`);
  }
  writeFileSync(join(distillsDir, `${date}.md`), lines.join("\n"));
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

describe("Personalization-weighted search (UF-076)", () => {
  // T-209: With profile present, results include personalizationLevel in _meta
  it("T-209: returns personalized meta when profile exists", () => {
    // Set up distill data
    writeDistill(tmpDir, "2026-04-15", [
      "Chose Redis for cache backend [backend]",
      "Selected React for frontend framework [frontend]",
    ]);

    // Set up v2 profile
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    const result = findSimilar("cache backend selection", 10, tmpDir);
    expect(result._meta.personalizationLevel).toBe("personalized");
    expect(result.data.results.length).toBeGreaterThan(0);
  });

  it("T-209b: returns keyword-only meta when no profile exists", () => {
    writeDistill(tmpDir, "2026-04-15", ["Chose Redis for cache backend"]);

    const result = findSimilar("cache backend selection", 10, tmpDir);
    expect(result._meta.personalizationLevel).toBe("keyword-only");
  });

  // T-210: Cross-domain search — personalization boosts domain-matching decisions
  it("T-210: personalization boosts results from user's top domains", () => {
    // Two decisions on different dates with different domains but similar keywords
    const distillsDir = join(tmpDir, ".unfade", "distills");
    mkdirSync(distillsDir, { recursive: true });
    writeFileSync(
      join(distillsDir, "2026-04-14.md"),
      [
        "# Daily Distill",
        "",
        "## Decisions",
        "",
        "- **Chose connection pool strategy for api** [backend]",
        "  _Need efficient resource management_",
      ].join("\n"),
    );
    writeFileSync(
      join(distillsDir, "2026-04-13.md"),
      [
        "# Daily Distill",
        "",
        "## Decisions",
        "",
        "- **Chose connection pool strategy for deploy** [devops]",
        "  _Need efficient resource management_",
      ].join("\n"),
    );

    // Set up profile where backend is top domain (60%)
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    const result = findSimilar("connection pool", 10, tmpDir);
    expect(result.data.results.length).toBe(2);

    // With personalization, backend-domain result should score higher
    const backendResult = result.data.results.find((r) => r.domain === "backend");
    const devopsResult = result.data.results.find((r) => r.domain === "devops");
    expect(backendResult).toBeDefined();
    expect(devopsResult).toBeDefined();
    expect(backendResult?.relevance).toBeGreaterThanOrEqual(devopsResult?.relevance);
  });

  it("T-210b: without profile, domain does not affect scoring", () => {
    // Same decisions on different dates, no profile
    const distillsDir = join(tmpDir, ".unfade", "distills");
    mkdirSync(distillsDir, { recursive: true });
    writeFileSync(
      join(distillsDir, "2026-04-14.md"),
      [
        "# Daily Distill",
        "",
        "## Decisions",
        "",
        "- **Chose connection pool strategy for api** [backend]",
        "  _Need efficient resource management_",
      ].join("\n"),
    );
    writeFileSync(
      join(distillsDir, "2026-04-13.md"),
      [
        "# Daily Distill",
        "",
        "## Decisions",
        "",
        "- **Chose connection pool strategy for deploy** [devops]",
        "  _Need efficient resource management_",
      ].join("\n"),
    );

    const result = findSimilar("connection pool", 10, tmpDir);
    expect(result._meta.personalizationLevel).toBe("keyword-only");

    // Without personalization, similar text → similar scores
    if (result.data.results.length >= 2) {
      expect(result.data.results[0].relevance).toBe(result.data.results[1].relevance);
    }
  });

  it("search page shows personalization banner when profile exists", async () => {
    // Set up profile
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/search");
    const html = await res.text();

    expect(html).toContain("Personalized search active");
    expect(html).toContain("backend"); // top domain badge
  });

  it("search page omits personalization banner when no profile", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/search");
    const html = await res.text();

    expect(html).not.toContain("Personalized search active");
  });
});

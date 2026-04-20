// T-211, T-212, T-213, T-214: Site generator tests
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReasoningModelV2 } from "../../../src/schemas/profile.js";
import { generateSiteData } from "../../../src/services/site/site-generator.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-site-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeDistill(dir: string, date: string, content: string): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  writeFileSync(join(distillsDir, `${date}.md`), content);
}

function makeDistillContent(opts: {
  date: string;
  decisions: string[];
  tradeOffs?: string[];
  deadEnds?: string[];
  summary?: string;
  domains?: string[];
}): string {
  const lines = [`# Daily Distill — ${opts.date}`, ""];
  if (opts.summary) {
    lines.push(`> ${opts.summary}`, "");
  }
  lines.push("## Decisions", "");
  for (const d of opts.decisions) {
    const domain = opts.domains?.[0] ? ` [${opts.domains[0]}]` : "";
    lines.push(`- **${d}**${domain}`);
  }
  if (opts.tradeOffs && opts.tradeOffs.length > 0) {
    lines.push("", "## Trade-offs", "");
    for (const t of opts.tradeOffs) {
      lines.push(`- **${t}**`);
    }
  }
  if (opts.deadEnds && opts.deadEnds.length > 0) {
    lines.push("", "## Dead Ends", "");
    for (const d of opts.deadEnds) {
      lines.push(`- **${d}**`);
    }
  }
  if (opts.domains && opts.domains.length > 0) {
    lines.push("", "## Domains", "", opts.domains.join(", "));
  }
  return lines.join("\n");
}

function makeV2Profile(overrides?: Partial<ReasoningModelV2>): ReasoningModelV2 {
  return {
    version: 2,
    lastUpdated: "2026-04-16T00:00:00Z",
    dataPoints: 10,
    decisionStyle: {
      avgAlternativesEvaluated: 3.2,
      medianAlternativesEvaluated: 3.0,
      explorationDepthMinutes: { overall: 15, byDomain: {} },
      aiAcceptanceRate: 0.65,
      aiModificationRate: 0.25,
      aiModificationByDomain: {},
    },
    tradeOffPreferences: [],
    domainDistribution: [
      {
        domain: "backend",
        frequency: 15,
        percentageOfTotal: 0.5,
        lastSeen: "2026-04-16",
        depth: "deep",
        depthTrend: "stable",
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
    ],
    temporalPatterns: {
      mostProductiveHours: [10, 14],
      avgDecisionsPerDay: 3.5,
      peakDecisionDays: [],
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
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Site generator (UF-080)", () => {
  // T-211: Reads events and computes daily decision counts
  it("T-211: computes heatmap data from distill files", () => {
    writeDistill(
      tmpDir,
      "2026-04-15",
      makeDistillContent({
        date: "2026-04-15",
        decisions: ["Chose Redis for cache", "Selected REST over GraphQL"],
        tradeOffs: ["Chose speed over type safety"],
        deadEnds: ["Tried gRPC but abandoned"],
      }),
    );
    writeDistill(
      tmpDir,
      "2026-04-14",
      makeDistillContent({
        date: "2026-04-14",
        decisions: ["Adopted Vitest for testing"],
      }),
    );

    const data = generateSiteData(tmpDir);
    expect(data.heatmap.length).toBe(2);

    const apr15 = data.heatmap.find((d) => d.date === "2026-04-15");
    expect(apr15).toBeDefined();
    expect(apr15?.decisions).toBe(2);
    expect(apr15?.tradeOffs).toBe(1);
    expect(apr15?.deadEnds).toBe(1);
    // intensity = 2 + 1*1.5 + 1*2 = 5.5
    expect(apr15?.intensity).toBe(5.5);

    const apr14 = data.heatmap.find((d) => d.date === "2026-04-14");
    expect(apr14).toBeDefined();
    expect(apr14?.decisions).toBe(1);
    expect(apr14?.intensity).toBe(1);
  });

  // T-212: Extracts domain distribution from reasoning model
  it("T-212: extracts domain distribution from v2 profile", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    const data = generateSiteData(tmpDir);
    expect(data.domains.length).toBe(2);
    expect(data.domains[0].domain).toBe("backend");
    expect(data.domains[0].percentage).toBe(0.5);
    expect(data.domains[0].depth).toBe("deep");
    expect(data.domains[1].domain).toBe("frontend");
  });

  // T-213: Compiles recent distills (last 7 days)
  it("T-213: compiles last 7 distills in reverse chronological order", () => {
    // Write 10 distills
    for (let i = 0; i < 10; i++) {
      const day = String(16 - i).padStart(2, "0");
      const date = `2026-04-${day}`;
      writeDistill(
        tmpDir,
        date,
        makeDistillContent({
          date,
          decisions: [`Decision on ${date}`],
          summary: `Summary for ${date}`,
          domains: ["backend"],
        }),
      );
    }

    const data = generateSiteData(tmpDir);
    expect(data.distills.length).toBe(7);
    // Most recent first
    expect(data.distills[0].date).toBe("2026-04-16");
    expect(data.distills[6].date).toBe("2026-04-10");
    expect(data.distills[0].summary).toBe("Summary for 2026-04-16");
    expect(data.distills[0].decisionCount).toBe(1);
    expect(data.distills[0].domains).toContain("backend");
  });

  // T-214: Handles empty data gracefully (new user)
  it("T-214: handles empty data gracefully", () => {
    // No distills, no profile — just the .unfade directory
    mkdirSync(join(tmpDir, ".unfade"), { recursive: true });

    const data = generateSiteData(tmpDir);
    expect(data.heatmap).toEqual([]);
    expect(data.domains).toEqual([]);
    expect(data.profile).toBeNull();
    expect(data.distills).toEqual([]);
    expect(data.generatedAt).toBeTruthy();
  });

  it("extracts profile summary with top pattern", () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    const data = generateSiteData(tmpDir);
    expect(data.profile).not.toBeNull();
    expect(data.profile?.avgAlternatives).toBe(3.2);
    expect(data.profile?.aiAcceptanceRate).toBe(0.65);
    expect(data.profile?.topPattern).toBe("Explores multiple alternatives before committing");
    expect(data.profile?.dataPoints).toBe(10);
  });
});

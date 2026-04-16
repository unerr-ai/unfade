// T-221, T-222, T-223: `unfade publish` command tests
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReasoningModelV2 } from "../../src/schemas/profile.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../.tmp-publish-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeDistill(dir: string, date: string, decisions: string[]): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  const lines = [`# Daily Distill — ${date}`, "", "> A summary of the day", "", "## Decisions", ""];
  for (const d of decisions) {
    lines.push(`- **${d}** [backend]`);
  }
  lines.push("", "## Domains", "", "backend");
  writeFileSync(join(distillsDir, `${date}.md`), lines.join("\n"));
}

function makeV2Profile(): ReasoningModelV2 {
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
    ],
    patterns: [],
    temporalPatterns: {
      mostProductiveHours: [10, 14],
      avgDecisionsPerDay: 3.5,
      peakDecisionDays: [],
    },
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
  // Create .unfade so the command doesn't bail
  mkdirSync(join(tmpDir, ".unfade"), { recursive: true });
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("unfade publish command (UF-083)", () => {
  // T-221: Creates .unfade/site/ directory
  it("T-221: creates site output directory", async () => {
    writeDistill(tmpDir, "2026-04-15", ["Chose Redis for cache"]);

    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    // Mock card generator to avoid font dependency
    vi.doMock("../../src/services/card/generator.js", () => ({
      generateCard: async () => Buffer.from("fake-png-data"),
    }));

    const { publishCommand } = await import("../../src/commands/publish.js");
    await publishCommand();

    const siteDir = join(tmpDir, ".unfade", "site");
    expect(existsSync(siteDir)).toBe(true);
  });

  // T-222: Generates index.html
  it("T-222: generates index.html with Thinking Graph content", async () => {
    writeDistill(tmpDir, "2026-04-15", ["Chose Redis for cache"]);

    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "reasoning_model.json"), JSON.stringify(makeV2Profile()));

    vi.doMock("../../src/services/card/generator.js", () => ({
      generateCard: async () => Buffer.from("fake-png-data"),
    }));

    const { publishCommand } = await import("../../src/commands/publish.js");
    await publishCommand();

    const indexPath = join(tmpDir, ".unfade", "site", "index.html");
    expect(existsSync(indexPath)).toBe(true);

    const html = readFileSync(indexPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Thinking Graph");
    expect(html).toContain("Decision Density Heatmap");
    expect(html).toContain("Domain Distribution");
    expect(html).toContain("Reasoning Profile");
    expect(html).toContain("backend");

    // data.json should also exist
    const dataPath = join(tmpDir, ".unfade", "site", "data.json");
    expect(existsSync(dataPath)).toBe(true);

    // style.css should also exist
    const cssPath = join(tmpDir, ".unfade", "site", "style.css");
    expect(existsSync(cssPath)).toBe(true);
  });

  // T-223: Includes OG card image
  it("T-223: generates OG card image in assets/", async () => {
    writeDistill(tmpDir, "2026-04-15", ["Chose Redis for cache"]);

    vi.doMock("../../src/services/card/generator.js", () => ({
      generateCard: async () => Buffer.from("fake-png-data"),
    }));

    const { publishCommand } = await import("../../src/commands/publish.js");
    await publishCommand();

    const ogCardPath = join(tmpDir, ".unfade", "site", "assets", "og-card.png");
    expect(existsSync(ogCardPath)).toBe(true);
    const content = readFileSync(ogCardPath);
    expect(content.toString()).toBe("fake-png-data");
  });

  it("supports --output flag for custom directory", async () => {
    writeDistill(tmpDir, "2026-04-15", ["Chose Redis for cache"]);

    vi.doMock("../../src/services/card/generator.js", () => ({
      generateCard: async () => Buffer.from("fake-png-data"),
    }));

    const customOutput = join(tmpDir, "custom-site");

    const { publishCommand } = await import("../../src/commands/publish.js");
    await publishCommand({ output: customOutput });

    expect(existsSync(join(customOutput, "index.html"))).toBe(true);
    expect(existsSync(join(customOutput, "data.json"))).toBe(true);
    expect(existsSync(join(customOutput, "style.css"))).toBe(true);
  });

  it("handles missing .unfade/ directory gracefully", async () => {
    // Remove .unfade
    rmSync(join(tmpDir, ".unfade"), { recursive: true, force: true });
    // Also remove .git so getProjectDataDir points to a non-existent .unfade
    rmSync(join(tmpDir, ".git"), { recursive: true, force: true });

    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    process.chdir(emptyDir);

    const { publishCommand } = await import("../../src/commands/publish.js");
    await publishCommand();

    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

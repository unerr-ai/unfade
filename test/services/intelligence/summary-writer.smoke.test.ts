import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSummary,
  summaryWriterAnalyzer,
} from "../../../src/services/intelligence/summary-writer.js";

describe("summary-writer (UF-215) + token/cost wiring", () => {
  let root: string;
  const origHome = process.env.UNFADE_HOME;

  afterEach(async () => {
    if (origHome) process.env.UNFADE_HOME = origHome;
    else delete process.env.UNFADE_HOME;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("summaryWriterAnalyzer exports expected interface", () => {
    expect(summaryWriterAnalyzer).toBeDefined();
    expect(summaryWriterAnalyzer.name).toBe("summary-writer");
    expect(summaryWriterAnalyzer.outputFile).toBe("summary-writer.json");
    expect(summaryWriterAnalyzer.minDataPoints).toBe(1);
    expect(summaryWriterAnalyzer.dependsOn).toContain("window-aggregator");
    expect(summaryWriterAnalyzer.dependsOn).toContain("token-proxy");
    expect(typeof summaryWriterAnalyzer.initialize).toBe("function");
    expect(typeof summaryWriterAnalyzer.update).toBe("function");
    expect(typeof summaryWriterAnalyzer.derive).toBe("function");
  });

  it("readSummary returns null when no summary exists", () => {
    root = mkdtempSync(join(tmpdir(), "unfade-sum-"));
    process.env.UNFADE_HOME = join(root, ".unfade");
    mkdirSync(join(root, ".unfade", "state"), { recursive: true });

    const result = readSummary(root);
    expect(result).toBeNull();
  });

  it("readSummary returns parsed summary when file exists", () => {
    root = mkdtempSync(join(tmpdir(), "unfade-sum-"));
    process.env.UNFADE_HOME = join(root, ".unfade");
    const stateDir = join(root, ".unfade", "state");
    mkdirSync(stateDir, { recursive: true });

    const summary = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      freshnessMs: 0,
      directionDensity24h: 0.5,
      eventCount24h: 10,
      comprehensionScore: 0.7,
      topDomain: "backend",
      toolMix: { "claude-code": 5 },
      reasoningVelocityProxy: 0.8,
      firstRunComplete: true,
      costPerDirectedDecision: 0.02,
      costQualityTrend: "stable",
      todaySpendProxy: 0.15,
      todayDirectedDecisions: 3,
    };
    writeFileSync(join(stateDir, "summary.json"), JSON.stringify(summary));

    const disk = readSummary(root);
    expect(disk).not.toBeNull();
    expect(disk?.schemaVersion).toBe(1);
    expect(disk?.topDomain).toBe("backend");
    expect(disk?.eventCount24h).toBe(10);
  });
});

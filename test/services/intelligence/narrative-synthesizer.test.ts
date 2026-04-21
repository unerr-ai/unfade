// T-337/T-338: Narrative synthesizer tests
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CorrelationReport } from "../../../src/services/intelligence/cross-analyzer.js";
import { readNarratives, synthesizeNarratives } from "../../../src/services/intelligence/narrative-synthesizer.js";

const TEST_ROOT = join("/tmp", "narrative-test-" + process.pid);
const INTEL_DIR = join(TEST_ROOT, ".unfade", "intelligence");

beforeEach(() => {
  mkdirSync(INTEL_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

function writeCorrelation(report: CorrelationReport): void {
  writeFileSync(join(INTEL_DIR, "correlation.json"), JSON.stringify(report), "utf-8");
}

describe("narrative synthesizer", () => {
  it("produces causal claim from efficiency-loops correlation", () => {
    const report: CorrelationReport = {
      correlations: [
        {
          id: "efficiency-loops",
          a: "efficiency",
          b: "loop-detector",
          r: -0.75,
          direction: "negative",
          temporalLag: 0,
          confidence: 0.8,
          computedAt: new Date().toISOString(),
          dataPoints: 14,
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    writeCorrelation(report);

    const insights = synthesizeNarratives(TEST_ROOT);
    expect(insights.length).toBeGreaterThanOrEqual(1);

    const loopInsight = insights.find((i) => i.correlationId === "efficiency-loops");
    expect(loopInsight).toBeDefined();
    expect(loopInsight!.claim).toContain("efficiency");
    expect(loopInsight!.severity).toMatch(/^(info|warning|critical)$/);
    expect(loopInsight!.sources).toContain("efficiency");
    expect(loopInsight!.sources).toContain("loop-detector");
  });

  it("writes to narratives.jsonl ring buffer", () => {
    const report: CorrelationReport = {
      correlations: [
        {
          id: "efficiency-loops",
          a: "efficiency",
          b: "loop-detector",
          r: -0.85,
          direction: "negative",
          temporalLag: 0,
          confidence: 0.9,
          computedAt: new Date().toISOString(),
          dataPoints: 20,
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    writeCorrelation(report);
    synthesizeNarratives(TEST_ROOT);

    const narratives = readNarratives(TEST_ROOT);
    expect(narratives.length).toBeGreaterThanOrEqual(1);
    expect(narratives[0].id).toBeTruthy();
    expect(narratives[0].ts).toBeTruthy();
    expect(narratives[0].claim).toBeTruthy();
  });

  it("deduplicates identical claims within 24h", () => {
    const report: CorrelationReport = {
      correlations: [
        {
          id: "efficiency-loops",
          a: "efficiency",
          b: "loop-detector",
          r: -0.75,
          direction: "negative",
          temporalLag: 0,
          confidence: 0.8,
          computedAt: new Date().toISOString(),
          dataPoints: 14,
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    writeCorrelation(report);

    // Run twice with same data
    synthesizeNarratives(TEST_ROOT);
    synthesizeNarratives(TEST_ROOT);

    const narratives = readNarratives(TEST_ROOT);
    // Should not duplicate — same claim within 24h
    const effClaims = narratives.filter((n) => n.correlationId === "efficiency-loops");
    expect(effClaims.length).toBe(1);
  });

  it("enforces MAX_NARRATIVES=50 ring buffer limit", () => {
    // Pre-fill with 48 narratives
    const existing = Array.from({ length: 48 }, (_, i) => JSON.stringify({
      id: `old-${i}`,
      ts: new Date(Date.now() - 86400 * 1000 * 2).toISOString(), // 2 days ago (outside 24h dedup)
      claim: `Old claim ${i}`,
      severity: "info",
      sources: ["test"],
      confidence: 0.5,
      sourceEventIds: [],
      correlationId: "test",
    }));
    writeFileSync(join(INTEL_DIR, "narratives.jsonl"), existing.join("\n") + "\n", "utf-8");

    const report: CorrelationReport = {
      correlations: [
        {
          id: "efficiency-loops",
          a: "efficiency",
          b: "loop-detector",
          r: -0.75,
          direction: "negative",
          temporalLag: 0,
          confidence: 0.8,
          computedAt: new Date().toISOString(),
          dataPoints: 14,
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    writeCorrelation(report);
    synthesizeNarratives(TEST_ROOT);

    const narratives = readNarratives(TEST_ROOT);
    expect(narratives.length).toBeLessThanOrEqual(50);
  });

  it("returns empty array when no correlations exist", () => {
    const insights = synthesizeNarratives(TEST_ROOT);
    expect(insights).toEqual([]);
  });

  it("skips correlations below r=0.6 threshold (template condition)", () => {
    const report: CorrelationReport = {
      correlations: [
        {
          id: "efficiency-loops",
          a: "efficiency",
          b: "loop-detector",
          r: -0.4, // below threshold
          direction: "negative",
          temporalLag: 0,
          confidence: 0.5,
          computedAt: new Date().toISOString(),
          dataPoints: 10,
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    writeCorrelation(report);
    const insights = synthesizeNarratives(TEST_ROOT);
    expect(insights.length).toBe(0);
  });
});

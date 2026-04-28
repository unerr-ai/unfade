import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  CorrelationEngine,
  writeCorrelations,
  loadCorrelations,
  createCorrelationEngine,
} from "../../../src/services/intelligence/correlation-engine.js";
import { ALL_CORRELATION_PATTERNS } from "../../../src/services/intelligence/correlation-patterns.js";
import type { Correlation } from "../../../src/schemas/intelligence-presentation.js";

// ─── Mock Output Factories ──────────────────────────────────────────────────

function makeEfficiency(overrides: Record<string, unknown> = {}) {
  return {
    aes: 55,
    trend: "declining" as const,
    confidence: "medium" as const,
    subMetrics: {
      directionDensity: { value: 40, weight: 0.3, confidence: "medium", dataPoints: 10, evidenceEventIds: ["evt-eff-1"] },
      tokenEfficiency: { value: 50, weight: 0.2, confidence: "medium", dataPoints: 10, evidenceEventIds: ["evt-eff-2"] },
      iterationRatio: { value: 60, weight: 0.2, confidence: "medium", dataPoints: 10, evidenceEventIds: [] },
      contextLeverage: { value: 45, weight: 0.15, confidence: "medium", dataPoints: 10, evidenceEventIds: [] },
      modificationDepth: { value: 55, weight: 0.15, confidence: "medium", dataPoints: 10, evidenceEventIds: [] },
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeComprehension(overrides: Record<string, unknown> = {}) {
  return {
    overall: 45,
    confidence: "medium" as const,
    byModule: {
      auth: { score: 30, decisionsCount: 5, lastUpdated: "", confidence: "low", evidenceEventIds: ["evt-comp-auth-1", "evt-comp-auth-2"] },
      backend: { score: 75, decisionsCount: 10, lastUpdated: "", confidence: "high", evidenceEventIds: ["evt-comp-be-1"] },
    },
    byDomain: { auth: 30, backend: 75 },
    blindSpots: ["auth"],
    blindSpotAlerts: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCost(overrides: Record<string, unknown> = {}) {
  return {
    totalEstimatedCost: 15.50,
    wasteRatio: 0.35,
    period: "all-time",
    isProxy: true as const,
    byModel: [],
    byDomain: [
      { key: "auth", eventCount: 20, estimatedCost: 5, percentage: 30, evidenceEventIds: ["evt-cost-1"] },
      { key: "backend", eventCount: 30, estimatedCost: 10, percentage: 60, evidenceEventIds: ["evt-cost-2"] },
    ],
    byBranch: [],
    updatedAt: new Date().toISOString(),
    disclaimer: "",
    ...overrides,
  };
}

function makeLoops(overrides: Record<string, unknown> = {}) {
  return {
    entries: [],
    stuckLoops: [
      { domain: "auth", approach: "repeated-intent", occurrences: 5, firstSeen: "", lastSeen: "", resolution: null, evidenceEventIds: ["evt-loop-1", "evt-loop-2"] },
    ],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeVelocity(overrides: Record<string, unknown> = {}) {
  return {
    byDomain: {
      auth: { currentTurnsToAcceptance: 8, previousTurnsToAcceptance: 5, velocityChange: 60, dataPoints: 10, trend: "decelerating" as const, evidenceEventIds: ["evt-vel-1"] },
      backend: { currentTurnsToAcceptance: 3, previousTurnsToAcceptance: 4, velocityChange: -25, dataPoints: 8, trend: "accelerating" as const, evidenceEventIds: ["evt-vel-2"] },
    },
    overallTrend: "decelerating" as const,
    overallMagnitude: 20,
    dataPoints: 18,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePatterns(overrides: Record<string, unknown> = {}) {
  return {
    effectivePatterns: [
      { domain: "backend", pattern: "Using constraints improves direction by 40%", acceptanceRate: 0.82, sampleSize: 15, exampleSessionIds: ["evt-pat-1", "evt-pat-2"] },
    ],
    antiPatterns: [],
    updatedAt: new Date().toISOString(),
    totalPromptsAnalyzed: 50,
    ...overrides,
  };
}

function makeAlerts(overrides: Record<string, unknown> = {}) {
  return {
    alerts: [
      { id: "alert-1", type: "low-comprehension", severity: "warning", domain: "auth", message: "", detail: "", metric: 30, threshold: 40, sustainedWeeks: 2, createdAt: new Date().toISOString(), acknowledged: false, acknowledgedAt: null, evidenceEventIds: ["evt-alert-1"] },
    ],
    maxPerWeek: 2,
    lastGeneratedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function wrap(output: unknown, eventIds: string[] = []): { output: unknown; sourceEventIds: string[] } {
  return { output, sourceEventIds: eventIds };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CorrelationEngine (IP-5)", () => {
  describe("engine mechanics", () => {
    it("creates engine with all 6 patterns registered", () => {
      const engine = createCorrelationEngine();
      expect(engine.patternCount).toBe(6);
    });

    it("returns empty array when no outputs provided", async () => {
      const engine = createCorrelationEngine();
      const results = await engine.detect(new Map());
      expect(results).toEqual([]);
    });

    it("skips patterns when required analyzers are missing", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["efficiency", wrap(makeEfficiency())],
      ]);
      const results = await engine.detect(outputs);
      const effBlindSpot = results.find((r) => r.type === "efficiency-blind-spot");
      expect(effBlindSpot).toBeUndefined();
    });

    it("handles pattern throwing error gracefully", async () => {
      const engine = new CorrelationEngine();
      engine.register({
        id: "faulty",
        name: "Faulty pattern",
        analyzers: ["efficiency"],
        detect() { throw new Error("boom"); },
      });
      const outputs = new Map([["efficiency", wrap(makeEfficiency())]]);
      const results = await engine.detect(outputs);
      expect(results).toEqual([]);
    });

    it("returns multiple correlations when multiple patterns fire", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["efficiency", wrap(makeEfficiency({ trend: "declining", aes: 35 }))],
        ["comprehension-radar", wrap(makeComprehension({ blindSpots: ["auth"], byDomain: { auth: 25 } }))],
        ["cost-attribution", wrap(makeCost({ wasteRatio: 0.45 }))],
        ["loop-detector", wrap(makeLoops())],
        ["velocity-tracker", wrap(makeVelocity())],
        ["prompt-patterns", wrap(makePatterns({ effectivePatterns: [] }))],
        ["blind-spot-detector", wrap(makeAlerts())],
      ]);
      const results = await engine.detect(outputs);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Pattern 1: efficiency-blind-spot", () => {
    it("fires when efficiency declining + blind spots exist", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["efficiency", wrap(makeEfficiency({ trend: "declining", aes: 45 }))],
        ["comprehension-radar", wrap(makeComprehension({ blindSpots: ["auth"] }))],
      ]);
      const results = await engine.detect(outputs);
      const corr = results.find((r) => r.type === "efficiency-blind-spot");
      expect(corr).toBeDefined();
      expect(corr!.severity).toMatch(/warning|critical/);
      expect(corr!.analyzers).toContain("efficiency");
      expect(corr!.analyzers).toContain("comprehension-radar");
    });

    it("does NOT fire when efficiency is stable", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["efficiency", wrap(makeEfficiency({ trend: "stable", aes: 70 }))],
        ["comprehension-radar", wrap(makeComprehension({ blindSpots: ["auth"] }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "efficiency-blind-spot")).toBeUndefined();
    });

    it("does NOT fire when no blind spots", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["efficiency", wrap(makeEfficiency({ trend: "declining" }))],
        ["comprehension-radar", wrap(makeComprehension({ blindSpots: [] }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "efficiency-blind-spot")).toBeUndefined();
    });
  });

  describe("Pattern 2: cost-loop", () => {
    it("fires when high waste + stuck loops", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["cost-attribution", wrap(makeCost({ wasteRatio: 0.35 }))],
        ["loop-detector", wrap(makeLoops())],
      ]);
      const results = await engine.detect(outputs);
      const corr = results.find((r) => r.type === "cost-loop");
      expect(corr).toBeDefined();
      expect(corr!.severity).toMatch(/warning|critical/);
    });

    it("does NOT fire when waste ratio is low", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["cost-attribution", wrap(makeCost({ wasteRatio: 0.1 }))],
        ["loop-detector", wrap(makeLoops())],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "cost-loop")).toBeUndefined();
    });

    it("does NOT fire when no stuck loops", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["cost-attribution", wrap(makeCost({ wasteRatio: 0.5 }))],
        ["loop-detector", wrap(makeLoops({ stuckLoops: [] }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "cost-loop")).toBeUndefined();
    });
  });

  describe("Pattern 3: velocity-comprehension", () => {
    it("fires when velocity decelerating in low-comprehension domain", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["velocity-tracker", wrap(makeVelocity())],
        ["comprehension-radar", wrap(makeComprehension({ byDomain: { auth: 25, backend: 80 } }))],
      ]);
      const results = await engine.detect(outputs);
      const corr = results.find((r) => r.type === "velocity-comprehension");
      expect(corr).toBeDefined();
      expect(corr!.domain).toBe("auth");
    });

    it("does NOT fire when all decelerating domains have high comprehension", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["velocity-tracker", wrap(makeVelocity())],
        ["comprehension-radar", wrap(makeComprehension({ byDomain: { auth: 80, backend: 90 } }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "velocity-comprehension")).toBeUndefined();
    });
  });

  describe("Pattern 4: pattern-efficiency", () => {
    it("fires when effective patterns exist + AES is high", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["prompt-patterns", wrap(makePatterns())],
        ["efficiency", wrap(makeEfficiency({ aes: 75, trend: "improving" }))],
      ]);
      const results = await engine.detect(outputs);
      const corr = results.find((r) => r.type === "pattern-efficiency");
      expect(corr).toBeDefined();
      expect(corr!.severity).toBe("info");
    });

    it("does NOT fire when AES is low", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["prompt-patterns", wrap(makePatterns())],
        ["efficiency", wrap(makeEfficiency({ aes: 40 }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "pattern-efficiency")).toBeUndefined();
    });

    it("does NOT fire when no effective patterns", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["prompt-patterns", wrap(makePatterns({ effectivePatterns: [] }))],
        ["efficiency", wrap(makeEfficiency({ aes: 80 }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "pattern-efficiency")).toBeUndefined();
    });
  });

  describe("Pattern 5: expertise-cost", () => {
    it("fires when high cost in high-comprehension domain", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["cost-attribution", wrap(makeCost({
          totalEstimatedCost: 20,
          byDomain: [{ key: "backend", eventCount: 40, estimatedCost: 15, percentage: 70, evidenceEventIds: ["evt-x"] }],
        }))],
        ["comprehension-radar", wrap(makeComprehension({ byDomain: { backend: 85 } }))],
      ]);
      const results = await engine.detect(outputs);
      const corr = results.find((r) => r.type === "expertise-cost");
      expect(corr).toBeDefined();
      expect(corr!.severity).toBe("warning");
    });

    it("does NOT fire when comprehension is low in expensive domains", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["cost-attribution", wrap(makeCost({
          totalEstimatedCost: 20,
          byDomain: [{ key: "auth", eventCount: 40, estimatedCost: 15, percentage: 70, evidenceEventIds: [] }],
        }))],
        ["comprehension-radar", wrap(makeComprehension({ byDomain: { auth: 30 } }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "expertise-cost")).toBeUndefined();
    });
  });

  describe("Pattern 6: blind-spot-acceptance", () => {
    it("fires when active alerts in confirmed blind spot domains", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["blind-spot-detector", wrap(makeAlerts())],
        ["comprehension-radar", wrap(makeComprehension({ blindSpots: ["auth"], byDomain: { auth: 25 } }))],
      ]);
      const results = await engine.detect(outputs);
      const corr = results.find((r) => r.type === "blind-spot-acceptance");
      expect(corr).toBeDefined();
      expect(corr!.severity).toBe("critical");
    });

    it("does NOT fire when no active warning/critical alerts", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["blind-spot-detector", wrap(makeAlerts({ alerts: [{ ...makeAlerts().alerts[0], severity: "info" }] }))],
        ["comprehension-radar", wrap(makeComprehension())],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "blind-spot-acceptance")).toBeUndefined();
    });

    it("does NOT fire when alert domains have decent comprehension", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["blind-spot-detector", wrap(makeAlerts())],
        ["comprehension-radar", wrap(makeComprehension({ blindSpots: [], byDomain: { auth: 65 } }))],
      ]);
      const results = await engine.detect(outputs);
      expect(results.find((r) => r.type === "blind-spot-acceptance")).toBeUndefined();
    });
  });

  describe("persistence", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `unfade-test-corr-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    it("round-trips correlations through write/load", async () => {
      const correlations: Correlation[] = [
        {
          id: "test-corr-1",
          type: "test-type",
          severity: "info",
          title: "Test Correlation",
          explanation: "Test explanation",
          analyzers: ["a", "b"],
          domain: "test",
          evidenceEventIds: ["evt-1"],
          actionable: "Do something",
          detectedAt: new Date().toISOString(),
        },
      ];

      await writeCorrelations(correlations, tempDir);
      const loaded = await loadCorrelations(tempDir);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("test-corr-1");
      expect(loaded[0].type).toBe("test-type");
      expect(loaded[0].evidenceEventIds).toEqual(["evt-1"]);
    });

    it("loadCorrelations returns empty for missing file", async () => {
      const loaded = await loadCorrelations(join(tempDir, "nonexistent"));
      expect(loaded).toEqual([]);
    });

    it("writeCorrelations creates directory if needed", async () => {
      const nested = join(tempDir, "deep", "nested");
      await writeCorrelations([{
        id: "c1", type: "t", severity: "info", title: "", explanation: "",
        analyzers: [], evidenceEventIds: [], actionable: "", detectedAt: "",
      }], nested);

      const loaded = await loadCorrelations(nested);
      expect(loaded).toHaveLength(1);
    });
  });

  describe("correlation structure validation", () => {
    it("all correlations have required fields", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["efficiency", wrap(makeEfficiency({ trend: "declining", aes: 35 }))],
        ["comprehension-radar", wrap(makeComprehension({ blindSpots: ["auth"], byDomain: { auth: 25 } }))],
        ["cost-attribution", wrap(makeCost({ wasteRatio: 0.45 }))],
        ["loop-detector", wrap(makeLoops())],
        ["velocity-tracker", wrap(makeVelocity())],
        ["prompt-patterns", wrap(makePatterns())],
        ["blind-spot-detector", wrap(makeAlerts())],
      ]);
      const results = await engine.detect(outputs);

      for (const corr of results) {
        expect(corr.id).toBeTruthy();
        expect(corr.type).toBeTruthy();
        expect(["info", "warning", "critical"]).toContain(corr.severity);
        expect(corr.title).toBeTruthy();
        expect(corr.explanation).toBeTruthy();
        expect(corr.analyzers.length).toBeGreaterThanOrEqual(2);
        expect(Array.isArray(corr.evidenceEventIds)).toBe(true);
        expect(corr.actionable).toBeTruthy();
        expect(corr.detectedAt).toBeTruthy();
      }
    });
  });
});

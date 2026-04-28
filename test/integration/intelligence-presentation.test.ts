// IP-14: E2E Verification — Pipeline Integration + Performance Budget + Cold Start.
//
// Verifies the full Layer 4 pipeline:
//   1. Enriched analyzer outputs include _meta + diagnostics + evidenceEventIds
//   2. Correlation engine detects cross-analyzer patterns
//   3. Evidence linker builds per-metric chains
//   4. Persistence round-trips for evidence + correlations
//   5. Performance within budget
//   6. Cold start (empty state) doesn't crash

import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Correlation } from "../../src/schemas/intelligence-presentation.js";
import {
  createCorrelationEngine,
  writeCorrelations,
  loadCorrelations,
} from "../../src/services/intelligence/correlation-engine.js";
import {
  buildAndPersistAllEvidence,
  loadEvidenceFile,
  type AnalyzerOutputWithEvidence,
  type EvidenceLinkerConfig,
} from "../../src/services/intelligence/evidence-linker.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeEfficiencyOutput() {
  return {
    aes: 45,
    trend: "declining",
    confidence: "medium",
    subMetrics: {
      directionDensity: { value: 30, weight: 0.3, confidence: "medium", dataPoints: 10, evidenceEventIds: ["evt-eff-1", "evt-eff-2"] },
      tokenEfficiency: { value: 50, weight: 0.2, confidence: "medium", dataPoints: 10, evidenceEventIds: ["evt-eff-3"] },
    },
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 20, confidence: "medium", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [{ severity: "warning", message: "AES declining", evidence: "trend", actionable: "review", relatedAnalyzers: [], evidenceEventIds: ["evt-eff-1"] }],
  };
}

function makeComprehensionOutput() {
  return {
    overall: 30,
    confidence: "low",
    byModule: { auth: { score: 25, decisionsCount: 5, lastUpdated: "", confidence: "low", evidenceEventIds: ["evt-comp-1", "evt-comp-2"] } },
    byDomain: { auth: 25 },
    blindSpots: ["auth"],
    blindSpotAlerts: [{ module: "auth", score: 25, eventCount: 5, suggestion: "Review auth", evidenceEventIds: ["evt-comp-1"] }],
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 5, confidence: "low", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [],
  };
}

function makeCostOutput() {
  return {
    totalEstimatedCost: 15,
    wasteRatio: 0.4,
    period: "all-time",
    isProxy: true as const,
    byModel: [{ key: "claude-4", eventCount: 30, estimatedCost: 10, percentage: 65, evidenceEventIds: ["evt-cost-1"] }],
    byDomain: [{ key: "auth", eventCount: 20, estimatedCost: 8, percentage: 50, evidenceEventIds: ["evt-cost-2"] }],
    byBranch: [],
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 50, confidence: "high", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [],
    updatedAt: new Date().toISOString(),
    disclaimer: "Estimates only",
  };
}

function makeLoopOutput() {
  return {
    entries: [],
    stuckLoops: [{ domain: "auth", approach: "repeated", occurrences: 5, firstSeen: "", lastSeen: "", resolution: null, evidenceEventIds: ["evt-loop-1"] }],
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 5, confidence: "medium", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [],
    updatedAt: new Date().toISOString(),
  };
}

function makeVelocityOutput() {
  return {
    byDomain: { auth: { currentTurnsToAcceptance: 8, previousTurnsToAcceptance: 5, velocityChange: 60, dataPoints: 10, trend: "decelerating" as const, evidenceEventIds: ["evt-vel-1"] } },
    overallTrend: "decelerating" as const,
    overallMagnitude: 30,
    dataPoints: 10,
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 10, confidence: "medium", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [],
    updatedAt: new Date().toISOString(),
  };
}

function makePatternsOutput() {
  return {
    effectivePatterns: [{ domain: "backend", pattern: "constraints improve direction", acceptanceRate: 0.82, sampleSize: 15, exampleSessionIds: ["evt-pat-1"] }],
    antiPatterns: [],
    totalPromptsAnalyzed: 50,
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 50, confidence: "high", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [],
    updatedAt: new Date().toISOString(),
  };
}

function makeAlertsOutput() {
  return {
    alerts: [{ id: "alert-1", type: "low-comprehension", severity: "warning", domain: "auth", message: "Low comp", detail: "", metric: 25, threshold: 40, sustainedWeeks: 2, createdAt: new Date().toISOString(), acknowledged: false, acknowledgedAt: null, evidenceEventIds: ["evt-alert-1"] }],
    maxPerWeek: 2,
    lastGeneratedAt: new Date().toISOString(),
    _meta: { updatedAt: new Date().toISOString(), dataPoints: 5, confidence: "medium", watermark: new Date().toISOString(), stalenessMs: 0 },
    diagnostics: [],
    updatedAt: new Date().toISOString(),
  };
}

function wrap(output: unknown): { output: unknown; sourceEventIds: string[] } {
  return { output, sourceEventIds: [] };
}

function makeAnalyzerOutputMap() {
  return new Map<string, { output: unknown; sourceEventIds: string[] }>([
    ["efficiency", wrap(makeEfficiencyOutput())],
    ["comprehension-radar", wrap(makeComprehensionOutput())],
    ["cost-attribution", wrap(makeCostOutput())],
    ["loop-detector", wrap(makeLoopOutput())],
    ["velocity-tracker", wrap(makeVelocityOutput())],
    ["prompt-patterns", wrap(makePatternsOutput())],
    ["blind-spot-detector", wrap(makeAlertsOutput())],
  ]);
}

function makeMockAnalytics() {
  return {
    run() {},
    exec(sql: string, params?: unknown[]) {
      if (sql.includes("SELECT id, ts, source")) {
        const ids = (params ?? []) as string[];
        return [{
          columns: ["id", "ts", "source", "type", "content_summary"],
          values: ids.map((id) => [id, new Date().toISOString(), "ai-session", "ai-conversation", `Summary for ${id}`]),
        }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("IP-14: E2E Pipeline Verification", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `unfade-ip14-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  });

  describe("IP-14.1: Pipeline Integration", () => {
    it("all analyzer outputs include _meta with required fields", () => {
      const outputs = makeAnalyzerOutputMap();

      for (const [name, { output }] of outputs) {
        const data = output as Record<string, unknown>;
        expect(data._meta, `${name} should have _meta`).toBeDefined();

        const meta = data._meta as Record<string, unknown>;
        expect(typeof meta.updatedAt).toBe("string");
        expect(typeof meta.dataPoints).toBe("number");
        expect(["high", "medium", "low"]).toContain(meta.confidence);
        expect(typeof meta.watermark).toBe("string");
        expect(typeof meta.stalenessMs).toBe("number");
      }
    });

    it("correlation engine detects patterns from overlapping data", async () => {
      const engine = createCorrelationEngine();
      const outputs = makeAnalyzerOutputMap();

      const correlations = await engine.detect(outputs);

      expect(correlations.length).toBeGreaterThanOrEqual(1);

      const effBlindSpot = correlations.find((c) => c.type === "efficiency-blind-spot");
      expect(effBlindSpot).toBeDefined();
      expect(effBlindSpot!.severity).toMatch(/warning|critical/);
      expect(effBlindSpot!.analyzers).toContain("efficiency");
      expect(effBlindSpot!.analyzers).toContain("comprehension-radar");
    });

    it("correlations persist to disk and round-trip correctly", async () => {
      const engine = createCorrelationEngine();
      const outputs = makeAnalyzerOutputMap();

      const correlations = await engine.detect(outputs);
      await writeCorrelations(correlations, tempDir);

      const loaded = await loadCorrelations(tempDir);
      expect(loaded.length).toBe(correlations.length);

      for (const corr of loaded) {
        expect(corr.id).toBeTruthy();
        expect(corr.type).toBeTruthy();
        expect(corr.analyzers.length).toBeGreaterThanOrEqual(2);
        expect(corr.detectedAt).toBeTruthy();
      }
    });

    it("evidence linker builds and persists per-analyzer chains", async () => {
      const evidenceOutputs = new Map<string, AnalyzerOutputWithEvidence>([
        ["efficiency", {
          metrics: [
            { name: "directionDensity", value: 0.3, sourceEventIds: ["evt-eff-1", "evt-eff-2"] },
            { name: "tokenEfficiency", value: 0.5, sourceEventIds: ["evt-eff-3"] },
          ],
          confidence: 0.7,
        }],
        ["comprehension-radar", {
          sourceEventIds: ["evt-comp-1", "evt-comp-2"],
          confidence: 0.5,
        }],
      ]);

      const config: EvidenceLinkerConfig = {
        intelligenceDir: tempDir,
        analytics: makeMockAnalytics() as any,
      };

      const report = await buildAndPersistAllEvidence(evidenceOutputs, config);

      expect(report.analyzersProcessed).toBe(2);
      expect(report.chainsBuilt).toBeGreaterThanOrEqual(2);

      const effChains = await loadEvidenceFile("efficiency", tempDir);
      expect(effChains.length).toBe(2);
      expect(effChains[0].metric).toBe("directionDensity");
      expect(effChains[0].events.length).toBe(2);
      expect(effChains[0].analyzers).toContain("efficiency");

      const compChains = await loadEvidenceFile("comprehension-radar", tempDir);
      expect(compChains.length).toBe(1);
      expect(compChains[0].events.length).toBe(2);
    });

    it("evidence chains link back to source events", async () => {
      const evidenceOutputs = new Map<string, AnalyzerOutputWithEvidence>([
        ["efficiency", {
          metrics: [{ name: "direction", value: 0.5, sourceEventIds: ["evt-a", "evt-b"] }],
          confidence: 0.8,
        }],
      ]);

      const config: EvidenceLinkerConfig = {
        intelligenceDir: tempDir,
        analytics: makeMockAnalytics() as any,
      };

      await buildAndPersistAllEvidence(evidenceOutputs, config);
      const chains = await loadEvidenceFile("efficiency", tempDir);

      expect(chains[0].events.length).toBe(2);
      expect(chains[0].events[0].eventId).toBe("evt-a");
      expect(chains[0].events[1].eventId).toBe("evt-b");
      expect(chains[0].events[0].summary).toContain("evt-a");
    });

    it("multiple correlation patterns fire simultaneously", async () => {
      const engine = createCorrelationEngine();
      const outputs = makeAnalyzerOutputMap();

      const correlations = await engine.detect(outputs);

      const types = new Set(correlations.map((c) => c.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    });

    it("all correlations have valid structure", async () => {
      const engine = createCorrelationEngine();
      const outputs = makeAnalyzerOutputMap();
      const correlations = await engine.detect(outputs);

      for (const corr of correlations) {
        expect(corr.id).toBeTruthy();
        expect(corr.type).toBeTruthy();
        expect(["info", "warning", "critical"]).toContain(corr.severity);
        expect(corr.title.length).toBeGreaterThan(0);
        expect(corr.explanation.length).toBeGreaterThan(0);
        expect(corr.analyzers.length).toBeGreaterThanOrEqual(2);
        expect(Array.isArray(corr.evidenceEventIds)).toBe(true);
        expect(corr.actionable.length).toBeGreaterThan(0);
        expect(corr.detectedAt).toBeTruthy();
      }
    });
  });

  describe("IP-14.3: Performance Budget", () => {
    it("correlation detection (6 patterns) completes within 100ms", async () => {
      const engine = createCorrelationEngine();
      const outputs = makeAnalyzerOutputMap();

      const start = performance.now();
      await engine.detect(outputs);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it("evidence building for 2 analyzers completes within 500ms", async () => {
      const evidenceOutputs = new Map<string, AnalyzerOutputWithEvidence>([
        ["efficiency", {
          metrics: [
            { name: "direction", value: 0.5, sourceEventIds: Array.from({ length: 50 }, (_, i) => `evt-${i}`) },
          ],
          confidence: 0.8,
        }],
        ["comprehension", {
          sourceEventIds: Array.from({ length: 30 }, (_, i) => `evt-comp-${i}`),
          confidence: 0.6,
        }],
      ]);

      const config: EvidenceLinkerConfig = {
        intelligenceDir: tempDir,
        analytics: makeMockAnalytics() as any,
      };

      const start = performance.now();
      await buildAndPersistAllEvidence(evidenceOutputs, config);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it("correlation persistence round-trip within 50ms", async () => {
      const correlations: Correlation[] = Array.from({ length: 10 }, (_, i) => ({
        id: `corr-${i}`,
        type: `pattern-${i}`,
        severity: "info" as const,
        title: `Test correlation ${i}`,
        explanation: `Explanation ${i}`,
        analyzers: ["a", "b"],
        evidenceEventIds: [`evt-${i}`],
        actionable: `Action ${i}`,
        detectedAt: new Date().toISOString(),
      }));

      const start = performance.now();
      await writeCorrelations(correlations, tempDir);
      const loaded = await loadCorrelations(tempDir);
      const elapsed = performance.now() - start;

      expect(loaded.length).toBe(10);
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("IP-14.4: Cold Start Verification", () => {
    it("loadCorrelations returns empty array for nonexistent file", async () => {
      const result = await loadCorrelations(join(tempDir, "nonexistent"));
      expect(result).toEqual([]);
    });

    it("loadEvidenceFile returns empty array for nonexistent analyzer", async () => {
      const result = await loadEvidenceFile("nonexistent", tempDir);
      expect(result).toEqual([]);
    });

    it("correlation engine returns empty for missing analyzer outputs", async () => {
      const engine = createCorrelationEngine();
      const result = await engine.detect(new Map());
      expect(result).toEqual([]);
    });

    it("correlation engine handles partial outputs gracefully", async () => {
      const engine = createCorrelationEngine();
      const outputs = new Map([
        ["efficiency", wrap(makeEfficiencyOutput())],
      ]);

      const result = await engine.detect(outputs);
      expect(Array.isArray(result)).toBe(true);
    });

    it("evidence linker handles empty outputs", async () => {
      const config: EvidenceLinkerConfig = {
        intelligenceDir: tempDir,
        analytics: makeMockAnalytics() as any,
      };

      const report = await buildAndPersistAllEvidence(new Map(), config);
      expect(report.analyzersProcessed).toBe(0);
      expect(report.chainsBuilt).toBe(0);
    });

    it("evidence linker handles analyzer with no event IDs", async () => {
      const evidenceOutputs = new Map<string, AnalyzerOutputWithEvidence>([
        ["empty-analyzer", { metrics: [], confidence: 0.5 }],
      ]);

      const config: EvidenceLinkerConfig = {
        intelligenceDir: tempDir,
        analytics: makeMockAnalytics() as any,
      };

      const report = await buildAndPersistAllEvidence(evidenceOutputs, config);
      expect(report.analyzersProcessed).toBe(1);
      expect(report.chainsBuilt).toBe(0);
    });
  });
});

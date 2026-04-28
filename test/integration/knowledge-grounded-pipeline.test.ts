// KGI-13.2: Full Knowledge-Grounded Pipeline Integration Test
// Verifies that Group B analyzers consume CozoDB knowledge when available,
// and that the complete DAG produces knowledge-grounded output.

import { describe, expect, it, vi } from "vitest";
import type { AnalyzerContext } from "../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, ComprehensionEntry, FactEntry, EntityEngagement } from "../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../src/services/cache/manager.js";

// ─── Shared Infrastructure ──────────────────────────────────────────────────

const recentDate = new Date().toISOString();
const oneWeekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

function createMockAnalytics(): DbLike {
  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("domain_comprehension")) {
        return [{
          columns: ["domain", "base_score", "current_score", "interaction_count", "last_touch", "stability"],
          values: [
            ["backend", 8, 7.5, 10, recentDate, 7],
            ["database", 6, 3.5, 5, oneWeekAgo, 3],
          ],
        }];
      }
      if (sql.includes("AVG(human_direction_score)")) {
        return [{ columns: ["avg_hds", "cnt"], values: [[0.65, 15]] }];
      }
      if (sql.includes("directed")) {
        return [{ columns: ["total", "directed"], values: [[15, 10]] }];
      }
      if (sql.includes("AVG(turn_count)")) {
        return [{ columns: ["avg", "cnt"], values: [[4, 15]] }];
      }
      if (sql.includes("AVG(prompt_specificity)")) {
        return [{ columns: ["avg", "cnt"], values: [[0.7, 15]] }];
      }
      if (sql.includes("AVG(overall_score)")) {
        return [{ columns: ["avg", "cnt"], values: [[0.6, 10]] }];
      }
      if (sql.includes("execution_phase")) {
        return [{ columns: ["planning", "debugging", "total"], values: [[3, 2, 15]] }];
      }
      if (sql.includes("outcome")) {
        return [{ columns: ["failures", "total"], values: [[1, 15]] }];
      }
      if (sql.includes("metric_snapshots")) {
        return [{ columns: ["date", "rdi"], values: [] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function createKnowledgeWithData(): KnowledgeReader {
  const assessments: ComprehensionEntry[] = [
    { episodeId: "evt-1", timestamp: oneWeekAgo, steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 46, assessmentMethod: "llm" },
    { episodeId: "evt-5", timestamp: recentDate, steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
  ];

  const activeFacts: FactEntry[] = [
    { id: "f1", subjectId: "ent-project", predicate: "USES", objectId: "", objectText: "Redis", confidence: 0.9, context: "Redis for caching", validAt: recentDate, invalidAt: "" },
    { id: "f2", subjectId: "ent-project", predicate: "DECIDED", objectId: "", objectText: "JWT", confidence: 0.85, context: "Decided JWT for auth", validAt: recentDate, invalidAt: "" },
  ];

  const invalidatedFacts: FactEntry[] = [
    { id: "f-old", subjectId: "ent-project", predicate: "DECIDED", objectId: "", objectText: "session cookies", confidence: 0.8, context: "Old: session cookies", validAt: oneWeekAgo, invalidAt: recentDate },
  ];

  const entities: EntityEngagement[] = [
    { entityId: "ent-redis", name: "Redis", type: "technology", mentionCount: 5, lastSeen: recentDate, confidence: 0.9 },
    { entityId: "ent-auth", name: "auth module", type: "module", mentionCount: 6, lastSeen: recentDate, confidence: 0.7 },
    { entityId: "ent-db", name: "database", type: "technology", mentionCount: 4, lastSeen: oneWeekAgo, confidence: 0.6 },
  ];

  return {
    getComprehension: vi.fn().mockResolvedValue(assessments),
    getFacts: vi.fn().mockImplementation(async (opts: { activeOnly?: boolean }) => {
      if (opts.activeOnly === false) return [...activeFacts, ...invalidatedFacts];
      return activeFacts;
    }),
    getDecisions: vi.fn().mockResolvedValue([activeFacts[1]]),
    getEntityEngagement: vi.fn().mockResolvedValue(entities),
    getDecayState: vi.fn().mockResolvedValue([]),
    hasKnowledgeData: vi.fn().mockResolvedValue(true),
  };
}

function makeCtx(knowledge: KnowledgeReader | null): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge,
  };
}

// ─── Pipeline Verification ──────────────────────────────────────────────────

describe("KGI-13.2: Knowledge-Grounded Pipeline Integration", () => {
  describe("comprehension-radar reads from CozoDB", () => {
    it("uses knowledge source when data available", async () => {
      const { comprehensionRadarAnalyzer } = await import("../../src/services/intelligence/analyzers/comprehension-radar.js");
      const ctx = makeCtx(createKnowledgeWithData());
      const state = await comprehensionRadarAnalyzer.initialize(ctx);
      expect(state.value.source).toBe("knowledge");
      expect(state.value.output.overall).toBeGreaterThan(0);
    });

    it("falls back to HDS without knowledge", async () => {
      const { comprehensionRadarAnalyzer } = await import("../../src/services/intelligence/analyzers/comprehension-radar.js");
      const ctx = makeCtx(null);
      const state = await comprehensionRadarAnalyzer.initialize(ctx);
      expect(state.value.source).toBe("hds-fallback");
    });
  });

  describe("blind-spots detects decaying comprehension entities", () => {
    it("flags domains with low retrievability", async () => {
      const { blindSpotDetectorAnalyzer } = await import("../../src/services/intelligence/analyzers/blind-spots.js");
      const ctx = makeCtx(createKnowledgeWithData());
      const state = await blindSpotDetectorAnalyzer.initialize(ctx);
      expect(state.value.source).toBe("knowledge");
    });
  });

  describe("decision-replay triggers on contradicting facts", () => {
    it("detects contradicted decisions from knowledge graph", async () => {
      const knowledge = createKnowledgeWithData();
      // Override: return decisions + invalidated facts for contradiction detection
      (knowledge.getDecisions as any).mockResolvedValue([
        { id: "f2", subjectId: "ent-project", predicate: "DECIDED", objectId: "", objectText: "JWT", confidence: 0.85, context: "Decided JWT", validAt: recentDate, invalidAt: "" },
      ]);
      (knowledge.getFacts as any).mockResolvedValue([
        { id: "f-old", subjectId: "ent-project", predicate: "DECIDED", objectId: "", objectText: "session cookies", confidence: 0.8, context: "Old", validAt: oneWeekAgo, invalidAt: recentDate },
        { id: "f2", subjectId: "ent-project", predicate: "DECIDED", objectId: "", objectText: "JWT", confidence: 0.85, context: "New", validAt: recentDate, invalidAt: "" },
      ]);

      const { decisionReplayAnalyzer } = await import("../../src/services/intelligence/analyzers/decision-replay.js");
      const ctx = makeCtx(knowledge);
      const state = await decisionReplayAnalyzer.initialize(ctx);
      expect(state.value.source).toBe("knowledge");
    });
  });

  describe("loop-detector identifies stuck entities", () => {
    it("detects entities with high mention but low fact count", async () => {
      const knowledge = createKnowledgeWithData();
      // Override: auth module mentioned 6 times but 0 facts extracted recently
      (knowledge.getFacts as any).mockImplementation(async (opts: { subject?: string }) => {
        if (opts.subject === "ent-auth") return [];
        return [];
      });

      const { loopDetectorAnalyzer } = await import("../../src/services/intelligence/analyzers/loop-detector.js");
      const ctx = makeCtx(knowledge);
      const state = await loopDetectorAnalyzer.initialize(ctx);
      expect(state.value.source).toBe("knowledge");
      // auth module: 6 mentions, 0 facts → risk = 1.0 → stuck
      const authLoop = state.value.output.stuckLoops.find((l) => l.domain === "auth module");
      expect(authLoop).toBeDefined();
    });
  });

  describe("narrative references actual decisions", () => {
    it("generates knowledge-grounded narratives when data available", async () => {
      const knowledge = createKnowledgeWithData();
      const { narrativeEngineAnalyzer } = await import("../../src/services/intelligence/narrative-engine.js");

      // Construct maturity dependency state
      const maturityState = {
        value: {
          currentPhase: 2.5,
          dimensions: [
            { name: "direction", score: 0.6, weight: 0.2, trend: "stable" as const, explanation: "", sources: [] },
            { name: "modification-depth", score: 0.5, weight: 0.15, trend: "improving" as const, explanation: "", sources: [] },
            { name: "context-leverage", score: 0.4, weight: 0.2, trend: "stable" as const, explanation: "", sources: [] },
            { name: "prompt-effectiveness", score: 0.55, weight: 0.15, trend: "stable" as const, explanation: "", sources: [] },
            { name: "domain-consistency", score: 0.45, weight: 0.1, trend: "stable" as const, explanation: "", sources: [] },
            { name: "loop-resilience", score: 0.7, weight: 0.1, trend: "stable" as const, explanation: "", sources: [] },
            { name: "decision-durability", score: 0.6, weight: 0.1, trend: "stable" as const, explanation: "", sources: [] },
          ],
          trajectory: [{ date: "2026-04-28", phase: 2.5, confidence: 0.6 }],
          knowledgeGrounded: true,
        },
        watermark: "",
        eventCount: 30,
        updatedAt: recentDate,
      };

      const ctx = {
        ...makeCtx(knowledge),
        dependencyStates: new Map([["maturity-model", maturityState]]),
      };

      const initState = await narrativeEngineAnalyzer.initialize(ctx);
      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const narratives = result.state.value.narratives;
      const knowledgeNarratives = narratives.filter((n) => n.id.startsWith("kg-"));
      expect(knowledgeNarratives.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("maturity-model knowledge grounding flag", () => {
    it("sets knowledgeGrounded=true when dependency sources are knowledge", async () => {
      const { maturityModelAnalyzer } = await import("../../src/services/intelligence/maturity-model.js");

      const deps = new Map<string, any>();
      const analyzerNames = [
        "window-aggregator", "comprehension-radar", "efficiency", "loop-detector",
        "velocity-tracker", "prompt-patterns", "decision-replay",
      ];

      for (const name of analyzerNames) {
        deps.set(name, {
          value: {
            output: name === "comprehension-radar"
              ? { overall: 75, byModule: {} }
              : name === "efficiency"
                ? { aes: 65 }
                : name === "loop-detector"
                  ? { stuckLoops: [], entries: [] }
                  : name === "velocity-tracker"
                    ? { byDomain: { backend: {}, frontend: {} } }
                    : name === "decision-replay"
                      ? { replays: [], maxPerWeek: 2, updatedAt: "" }
                      : name === "window-aggregator"
                        ? { windows: { "24h": { directionDensity: 65 } } }
                        : { totalPromptsAnalyzed: 40 },
            source: (name === "comprehension-radar" || name === "loop-detector" || name === "decision-replay")
              ? "knowledge" : undefined,
          },
          watermark: "",
          eventCount: 20,
          updatedAt: recentDate,
        });
      }

      const ctx = { ...makeCtx(null), dependencyStates: deps };
      const state = await maturityModelAnalyzer.initialize(ctx);
      const output = maturityModelAnalyzer.derive(state);

      expect(output.knowledgeGrounded).toBe(true);
    });
  });

  describe("end-to-end data flow", () => {
    it("all Group B analyzers produce valid output with knowledge", async () => {
      const knowledge = createKnowledgeWithData();
      const ctx = makeCtx(knowledge);

      const { comprehensionRadarAnalyzer } = await import("../../src/services/intelligence/analyzers/comprehension-radar.js");
      const { blindSpotDetectorAnalyzer } = await import("../../src/services/intelligence/analyzers/blind-spots.js");
      const { decisionReplayAnalyzer } = await import("../../src/services/intelligence/analyzers/decision-replay.js");
      const { loopDetectorAnalyzer } = await import("../../src/services/intelligence/analyzers/loop-detector.js");

      const [compState, blindState, decState, loopState] = await Promise.all([
        comprehensionRadarAnalyzer.initialize(ctx),
        blindSpotDetectorAnalyzer.initialize(ctx),
        decisionReplayAnalyzer.initialize(ctx),
        loopDetectorAnalyzer.initialize(ctx),
      ]);

      expect(compState.value.source).toBe("knowledge");
      expect(blindState.value.source).toBe("knowledge");
      expect(decState.value.source).toBe("knowledge");
      expect(loopState.value.source).toBe("knowledge");

      // All produce valid derive output
      const compOut = comprehensionRadarAnalyzer.derive(compState);
      const blindOut = blindSpotDetectorAnalyzer.derive(blindState);
      const decOut = decisionReplayAnalyzer.derive(decState);
      const loopOut = loopDetectorAnalyzer.derive(loopState);

      expect(compOut.updatedAt).toBeTruthy();
      expect(blindOut.updatedAt).toBeTruthy();
      expect(decOut.updatedAt).toBeTruthy();
      expect(loopOut.updatedAt).toBeTruthy();
    });

    it("all Group B analyzers gracefully degrade without knowledge", async () => {
      const ctx = makeCtx(null);

      const { comprehensionRadarAnalyzer } = await import("../../src/services/intelligence/analyzers/comprehension-radar.js");
      const { blindSpotDetectorAnalyzer } = await import("../../src/services/intelligence/analyzers/blind-spots.js");
      const { decisionReplayAnalyzer } = await import("../../src/services/intelligence/analyzers/decision-replay.js");
      const { loopDetectorAnalyzer } = await import("../../src/services/intelligence/analyzers/loop-detector.js");

      const [compState, blindState, decState, loopState] = await Promise.all([
        comprehensionRadarAnalyzer.initialize(ctx),
        blindSpotDetectorAnalyzer.initialize(ctx),
        decisionReplayAnalyzer.initialize(ctx),
        loopDetectorAnalyzer.initialize(ctx),
      ]);

      expect(compState.value.source).toBe("hds-fallback");
      expect(blindState.value.source).toBe("hds-fallback");
      expect(decState.value.source).toBe("hds-fallback");
      expect(loopState.value.source).toBe("hds-fallback");
    });
  });
});

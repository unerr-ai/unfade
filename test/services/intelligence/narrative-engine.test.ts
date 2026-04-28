import { describe, expect, it, vi } from "vitest";
import { narrativeEngineAnalyzer, generateNarratives, type Narrative } from "../../../src/services/intelligence/narrative-engine.js";
import type { AnalyzerContext } from "../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, FactEntry, ComprehensionEntry, EntityEngagement } from "../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../src/services/cache/manager.js";
import type { IncrementalState } from "../../../src/services/intelligence/incremental-state.js";
import type { Correlation } from "../../../src/schemas/intelligence-presentation.js";

function createMockAnalytics(): DbLike {
  return { run() {}, exec() { return [{ columns: [], values: [] }]; } };
}

function createMockKnowledge(overrides: Partial<{
  decisions: FactEntry[];
  facts: FactEntry[];
  assessments: ComprehensionEntry[];
  entities: EntityEngagement[];
  hasData: boolean;
}> = {}): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue(overrides.assessments ?? []),
    getFacts: vi.fn().mockResolvedValue(overrides.facts ?? []),
    getDecisions: vi.fn().mockResolvedValue(overrides.decisions ?? []),
    getEntityEngagement: vi.fn().mockResolvedValue(overrides.entities ?? []),
    getDecayState: vi.fn().mockResolvedValue([]),
    hasKnowledgeData: vi.fn().mockResolvedValue(overrides.hasData ?? true),
  };
}

function makeMaturityState(overrides: Record<string, unknown> = {}): IncrementalState<unknown> {
  return {
    value: {
      currentPhase: 2.5,
      dimensions: [
        { name: "direction", score: 0.6, weight: 0.2, trend: "stable", explanation: "", sources: [] },
        { name: "modification-depth", score: 0.5, weight: 0.15, trend: "improving", explanation: "", sources: [] },
        { name: "context-leverage", score: 0.4, weight: 0.2, trend: "stable", explanation: "", sources: [] },
        { name: "prompt-effectiveness", score: 0.55, weight: 0.15, trend: "stable", explanation: "", sources: [] },
        { name: "domain-consistency", score: 0.45, weight: 0.1, trend: "stable", explanation: "", sources: [] },
        { name: "loop-resilience", score: 0.7, weight: 0.1, trend: "stable", explanation: "", sources: [] },
        { name: "decision-durability", score: 0.6, weight: 0.1, trend: "stable", explanation: "", sources: [] },
      ],
      trajectory: [
        { date: "2026-04-21", phase: 2.3, confidence: 0.5 },
        { date: "2026-04-28", phase: 2.5, confidence: 0.6 },
      ],
      knowledgeGrounded: false,
      ...overrides,
    },
    watermark: "",
    eventCount: 30,
    updatedAt: new Date().toISOString(),
  };
}

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge: null,
    dependencyStates: new Map([["maturity-model", makeMaturityState()]]),
    ...overrides,
  };
}

function makeCorrelation(overrides: Partial<Correlation> = {}): Correlation {
  return {
    id: "corr-test",
    type: "efficiency-blind-spot",
    severity: "warning",
    title: "Efficiency declining in blind spot",
    explanation: "AES dropping while auth is a blind spot.",
    analyzers: ["efficiency", "comprehension-radar"],
    domain: "auth",
    evidenceEventIds: ["evt-corr-1", "evt-corr-2"],
    actionable: "Review auth domain more carefully.",
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

const recentDate = new Date().toISOString();

describe("narrative-engine (KGI-10 + IP-6)", () => {
  describe("knowledge-grounded narratives", () => {
    it("generates decision-insight when knowledge decisions exist", async () => {
      const decisions: FactEntry[] = [
        { id: "d1", subjectId: "ent-1", predicate: "DECIDED", objectId: "", objectText: "JWT", confidence: 0.8, context: "Decided JWT for auth", validAt: recentDate, invalidAt: "" },
        { id: "d2", subjectId: "ent-1", predicate: "ADOPTED", objectId: "", objectText: "Redis", confidence: 0.85, context: "Adopted Redis", validAt: recentDate, invalidAt: "" },
      ];
      const knowledge = createMockKnowledge({ decisions, facts: [], hasData: true });
      const ctx = makeCtx({ knowledge });
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const narratives = result.state.value.narratives;
      const decisionNarrative = narratives.find((n) => n.id === "kg-decision-insight");
      expect(decisionNarrative).toBeDefined();
      expect(decisionNarrative!.headline).toContain("2 decisions");
    });

    it("generates contradiction narrative when decisions are contradicted", async () => {
      const decisions: FactEntry[] = [
        { id: "d1", subjectId: "ent-1", predicate: "DECIDED", objectId: "", objectText: "Zustand", confidence: 0.85, context: "Decided Zustand", validAt: recentDate, invalidAt: "" },
      ];
      const facts: FactEntry[] = [
        { id: "old-d", subjectId: "ent-1", predicate: "DECIDED", objectId: "", objectText: "Redux", confidence: 0.8, context: "Decided Redux", validAt: "2026-04-20T10:00:00Z", invalidAt: recentDate },
      ];
      const knowledge = createMockKnowledge({ decisions, facts, hasData: true });
      const ctx = makeCtx({ knowledge });
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const narratives = result.state.value.narratives;
      const decisionNarrative = narratives.find((n) => n.id === "kg-decision-insight");
      expect(decisionNarrative).toBeDefined();
      expect(decisionNarrative!.headline).toContain("contradicted");
    });

    it("generates stuck-loop narrative when entities are stuck", async () => {
      const entities: EntityEngagement[] = [
        { entityId: "ent-stuck", name: "auth module", type: "module", mentionCount: 5, lastSeen: recentDate, confidence: 0.8 },
      ];
      const knowledge = createMockKnowledge({ entities, facts: [], hasData: true });
      const ctx = makeCtx({ knowledge });
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const narratives = result.state.value.narratives;
      const stuckNarrative = narratives.find((n) => n.id === "kg-stuck-loop");
      expect(stuckNarrative).toBeDefined();
      expect(stuckNarrative!.headline).toContain("auth module");
    });
  });

  describe("correlation-aware narratives (IP-6)", () => {
    it("generates correlation narrative when critical correlations exist", async () => {
      const correlations = [makeCorrelation({ severity: "critical", title: "Critical blind spot pattern" })];
      const ctx = makeCtx();

      const result = await generateNarratives(
        new Map(),
        { llmConfig: null, correlations, intelligenceDir: "/tmp" },
        ctx,
        makeMaturityState(),
        30,
        "",
      );

      const corrNarrative = result.narratives.find((n) => n.type === "correlation");
      expect(corrNarrative).toBeDefined();
      expect(corrNarrative!.headline).toContain("Critical blind spot pattern");
      expect(corrNarrative!.evidenceEventIds.length).toBeGreaterThan(0);
      expect(corrNarrative!.relatedAnalyzers.length).toBeGreaterThanOrEqual(2);
    });

    it("generates correlation summary when 2+ correlations exist", async () => {
      const correlations = [
        makeCorrelation({ id: "c1", type: "efficiency-blind-spot", severity: "warning" }),
        makeCorrelation({ id: "c2", type: "cost-loop", severity: "info", title: "Cost-loop pattern" }),
      ];
      const ctx = makeCtx();

      const result = await generateNarratives(
        new Map(),
        { llmConfig: null, correlations, intelligenceDir: "/tmp" },
        ctx,
        makeMaturityState(),
        30,
        "",
      );

      const summaryNarrative = result.narratives.find((n) => n.id === "corr-narrative-summary");
      expect(summaryNarrative).toBeDefined();
      expect(summaryNarrative!.headline).toContain("2 cross-analyzer patterns");
    });

    it("does NOT generate correlation narratives when no correlations", async () => {
      const ctx = makeCtx();

      const result = await generateNarratives(
        new Map(),
        { llmConfig: null, correlations: [], intelligenceDir: "/tmp" },
        ctx,
        makeMaturityState(),
        30,
        "",
      );

      const corrNarratives = result.narratives.filter((n) => n.type === "correlation");
      expect(corrNarratives.length).toBe(0);
    });

    it("correlation narratives include evidenceEventIds from correlations", async () => {
      const correlations = [
        makeCorrelation({ evidenceEventIds: ["evt-a", "evt-b", "evt-c"] }),
      ];
      const ctx = makeCtx();

      const result = await generateNarratives(
        new Map(),
        { llmConfig: null, correlations, intelligenceDir: "/tmp" },
        ctx,
        makeMaturityState(),
        30,
        "",
      );

      const corrNarrative = result.narratives.find((n) => n.type === "correlation");
      expect(corrNarrative).toBeDefined();
      expect(corrNarrative!.evidenceEventIds).toContain("evt-a");
    });
  });

  describe("evidence linking (IP-6)", () => {
    it("all narratives have evidenceEventIds field", async () => {
      const knowledge = createMockKnowledge({
        decisions: [{ id: "d1", subjectId: "e1", predicate: "DECIDED", objectId: "", objectText: "X", confidence: 0.8, context: "test", validAt: recentDate, invalidAt: "" }],
        hasData: true,
      });
      const ctx = makeCtx({ knowledge });
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      for (const n of result.state.value.narratives) {
        expect(Array.isArray(n.evidenceEventIds)).toBe(true);
      }
    });

    it("all narratives have relatedAnalyzers field", async () => {
      const ctx = makeCtx();
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      for (const n of result.state.value.narratives) {
        expect(Array.isArray(n.relatedAnalyzers)).toBe(true);
      }
    });
  });

  describe("LLM path (IP-6)", () => {
    it("falls back to templates when no LLM configured", async () => {
      const knowledge = createMockKnowledge({
        decisions: [{ id: "d1", subjectId: "e1", predicate: "DECIDED", objectId: "", objectText: "X", confidence: 0.8, context: "test", validAt: recentDate, invalidAt: "" }],
        hasData: true,
      });
      const ctx = makeCtx({ knowledge });
      const result = await generateNarratives(
        new Map(),
        { llmConfig: null, correlations: [], intelligenceDir: "/tmp" },
        ctx,
        makeMaturityState(),
        30,
        "",
      );

      expect(result.narratives.length).toBeGreaterThan(0);
      expect(result.lastLlmRunAt).toBe("");
    });

    it("falls back to templates when LLM run was recent (< 24h)", async () => {
      const knowledge = createMockKnowledge({
        decisions: [{ id: "d1", subjectId: "e1", predicate: "DECIDED", objectId: "", objectText: "X", confidence: 0.8, context: "test", validAt: recentDate, invalidAt: "" }],
        hasData: true,
      });
      const ctx = makeCtx({ knowledge });
      const recentLlmRun = new Date().toISOString();

      const result = await generateNarratives(
        new Map(),
        { llmConfig: { provider: "openai", model: "gpt-4" }, correlations: [], intelligenceDir: "/tmp" },
        ctx,
        makeMaturityState(),
        30,
        recentLlmRun,
      );

      expect(result.narratives.length).toBeGreaterThan(0);
      expect(result.lastLlmRunAt).toBe(recentLlmRun);
    });
  });

  describe("fallback (no knowledge)", () => {
    it("does not generate knowledge narratives when no knowledge data", async () => {
      const ctx = makeCtx({ knowledge: null });
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const knowledgeNarratives = result.state.value.narratives.filter((n) => n.id.startsWith("kg-"));
      expect(knowledgeNarratives.length).toBe(0);
    });

    it("existing templates still fire without knowledge", async () => {
      const maturityWithLowScores = makeMaturityState({
        currentPhase: 1.5,
        dimensions: [
          { name: "direction", score: 0.2, weight: 0.2, trend: "declining", explanation: "", sources: [] },
          { name: "modification-depth", score: 0.2, weight: 0.15, trend: "declining", explanation: "", sources: [] },
          { name: "context-leverage", score: 0.1, weight: 0.2, trend: "stable", explanation: "", sources: [] },
          { name: "prompt-effectiveness", score: 0.3, weight: 0.15, trend: "stable", explanation: "", sources: [] },
          { name: "domain-consistency", score: 0.3, weight: 0.1, trend: "stable", explanation: "", sources: [] },
          { name: "loop-resilience", score: 0.2, weight: 0.1, trend: "stable", explanation: "", sources: [] },
          { name: "decision-durability", score: 0.3, weight: 0.1, trend: "stable", explanation: "", sources: [] },
        ],
        trajectory: [{ date: "2026-04-28", phase: 1.5, confidence: 0.4 }],
        knowledgeGrounded: false,
      });

      const ctx = makeCtx({
        knowledge: null,
        dependencyStates: new Map([["maturity-model", maturityWithLowScores]]),
      });
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const vehicleNarratives = result.state.value.narratives.filter((n) => n.id.startsWith("diag-") || n.id.startsWith("rx-"));
      expect(vehicleNarratives.length).toBeGreaterThan(0);
    });
  });

  describe("executive summary", () => {
    it("generates non-empty executive summary", async () => {
      const ctx = makeCtx();
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(result.state.value.executiveSummary.length).toBeGreaterThan(0);
      expect(result.state.value.executiveSummary).toContain("Phase");
    });

    it("executive summary mentions correlations when present", async () => {
      const correlations = [makeCorrelation({ severity: "critical" })];
      const ctx = makeCtx();

      const result = await generateNarratives(
        new Map(),
        { llmConfig: null, correlations, intelligenceDir: "/tmp" },
        ctx,
        makeMaturityState(),
        30,
        "",
      );

      expect(result.executiveSummary).toContain("critical");
    });
  });

  describe("basic structure", () => {
    it("initializes with empty narratives", async () => {
      const ctx = makeCtx();
      const state = await narrativeEngineAnalyzer.initialize(ctx);
      expect(state.value.narratives).toEqual([]);
    });

    it("sorts narratives by importance", async () => {
      const knowledge = createMockKnowledge({
        decisions: [
          { id: "d1", subjectId: "e1", predicate: "DECIDED", objectId: "", objectText: "X", confidence: 0.8, context: "test", validAt: recentDate, invalidAt: "" },
        ],
        hasData: true,
      });
      const ctx = makeCtx({ knowledge });
      const initState = await narrativeEngineAnalyzer.initialize(ctx);

      const result = await narrativeEngineAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: recentDate } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const narratives = result.state.value.narratives;
      for (let i = 1; i < narratives.length; i++) {
        expect(narratives[i].importance).toBeLessThanOrEqual(narratives[i - 1].importance);
      }
    });
  });
});

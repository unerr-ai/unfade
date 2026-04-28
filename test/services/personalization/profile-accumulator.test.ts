import { describe, expect, it, vi } from "vitest";
import { profileAccumulatorAnalyzer } from "../../../src/services/personalization/profile-accumulator.js";
import type { AnalyzerContext } from "../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, FactEntry, ComprehensionEntry, EntityEngagement } from "../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

function createMockAnalytics(): DbLike {
  return { run() {}, exec() { return [{ columns: [], values: [] }]; } };
}

const recentDate = new Date().toISOString();

function createMockKnowledge(overrides: Partial<{
  assessments: ComprehensionEntry[];
  facts: FactEntry[];
  decisions: FactEntry[];
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

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge: null,
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    sessionId: "s-1",
    ts: recentDate,
    source: "ai-session",
    type: "ai-conversation",
    projectId: "proj-1",
    humanDirectionScore: 0.65,
    promptSpecificity: 0.7,
    domain: "backend",
    ...overrides,
  } as any;
}

describe("profile-accumulator (KGI-11)", () => {
  describe("knowledge-enriched profile", () => {
    it("includes domainExpertise from CozoDB comprehension data", async () => {
      const assessments: ComprehensionEntry[] = [
        { episodeId: "e1", timestamp: "2026-04-20T10:00:00Z", steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 46, assessmentMethod: "llm" },
        { episodeId: "e2", timestamp: "2026-04-28T10:00:00Z", steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
      ];
      const knowledge = createMockKnowledge({ assessments, hasData: true, facts: [], entities: [] });
      const ctx = makeCtx({ knowledge });
      const initState = await profileAccumulatorAnalyzer.initialize(ctx);

      const result = await profileAccumulatorAnalyzer.update(
        initState,
        { events: [makeEvent()], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const output = profileAccumulatorAnalyzer.derive(result.state);
      expect(output.domainExpertise).toBeDefined();
      expect(output.domainExpertise!.length).toBeGreaterThanOrEqual(1);
      expect(output.domainExpertise![0].comprehensionScore).toBeGreaterThan(0);
    });

    it("includes decisionPatterns from extracted decisions", async () => {
      const decisions: FactEntry[] = [
        { id: "d1", subjectId: "e1", predicate: "DECIDED", objectId: "", objectText: "JWT", confidence: 0.8, context: "test", validAt: recentDate, invalidAt: "" },
      ];
      const facts: FactEntry[] = [
        ...decisions,
        { id: "d-old", subjectId: "e1", predicate: "DECIDED", objectId: "", objectText: "sessions", confidence: 0.7, context: "old", validAt: "2026-04-15T10:00:00Z", invalidAt: recentDate },
      ];
      const knowledge = createMockKnowledge({ decisions, facts, hasData: true, assessments: [], entities: [] });
      const ctx = makeCtx({ knowledge });
      const initState = await profileAccumulatorAnalyzer.initialize(ctx);

      const result = await profileAccumulatorAnalyzer.update(
        initState,
        { events: [makeEvent()], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const output = profileAccumulatorAnalyzer.derive(result.state);
      expect(output.decisionPatterns).toBeDefined();
      expect(output.decisionPatterns!.totalDecisions).toBe(2);
      expect(output.decisionPatterns!.superseded).toBe(1);
      expect(output.decisionPatterns!.durable).toBe(1);
    });

    it("includes topEntities from entity engagement", async () => {
      const entities: EntityEngagement[] = [
        { entityId: "e1", name: "Redis", type: "technology", mentionCount: 8, lastSeen: recentDate, confidence: 0.9 },
        { entityId: "e2", name: "auth module", type: "module", mentionCount: 5, lastSeen: recentDate, confidence: 0.7 },
      ];
      const knowledge = createMockKnowledge({ entities, hasData: true, facts: [], assessments: [] });
      const ctx = makeCtx({ knowledge });
      const initState = await profileAccumulatorAnalyzer.initialize(ctx);

      const result = await profileAccumulatorAnalyzer.update(
        initState,
        { events: [makeEvent()], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const output = profileAccumulatorAnalyzer.derive(result.state);
      expect(output.topEntities).toBeDefined();
      expect(output.topEntities!.length).toBe(2);
      expect(output.topEntities![0].name).toBe("Redis");
    });

    it("includes knowledgeVelocity (facts/day)", async () => {
      const facts: FactEntry[] = Array.from({ length: 15 }, (_, i) => ({
        id: `f-${i}`,
        subjectId: "e1",
        predicate: "USES",
        objectId: "",
        objectText: `thing-${i}`,
        confidence: 0.8,
        context: "test",
        validAt: recentDate,
        invalidAt: "",
      }));
      const knowledge = createMockKnowledge({ facts, hasData: true, assessments: [], entities: [] });
      const ctx = makeCtx({ knowledge });
      const initState = await profileAccumulatorAnalyzer.initialize(ctx);

      const result = await profileAccumulatorAnalyzer.update(
        initState,
        { events: [makeEvent()], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const output = profileAccumulatorAnalyzer.derive(result.state);
      expect(output.knowledgeVelocity).toBeDefined();
      expect(output.knowledgeVelocity!).toBeGreaterThan(0);
    });
  });

  describe("fallback (no knowledge)", () => {
    it("knowledge fields absent when no knowledge data", async () => {
      const ctx = makeCtx({ knowledge: null });
      const initState = await profileAccumulatorAnalyzer.initialize(ctx);

      const result = await profileAccumulatorAnalyzer.update(
        initState,
        { events: [makeEvent()], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const output = profileAccumulatorAnalyzer.derive(result.state);
      expect(output.domainExpertise).toBeUndefined();
      expect(output.decisionPatterns).toBeUndefined();
      expect(output.topEntities).toBeUndefined();
      expect(output.knowledgeVelocity).toBeUndefined();
    });

    it("behavioral profile still works without knowledge", async () => {
      const ctx = makeCtx();
      const initState = await profileAccumulatorAnalyzer.initialize(ctx);
      const baseEvents = initState.value.decisionStyle.totalEvents;

      const result = await profileAccumulatorAnalyzer.update(
        initState,
        { events: [makeEvent(), makeEvent({ id: "evt-2", humanDirectionScore: 0.8 })], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const output = profileAccumulatorAnalyzer.derive(result.state);
      expect(output.decisionStyle.totalEvents).toBe(baseEvents + 2);
      expect(output.domainDistribution.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("basic behavior", () => {
    it("initializes successfully", async () => {
      const ctx = makeCtx();
      const state = await profileAccumulatorAnalyzer.initialize(ctx);
      expect(state.value.decisionStyle).toBeDefined();
      expect(typeof state.value.decisionStyle.totalEvents).toBe("number");
    });

    it("accumulates domain distribution incrementally", async () => {
      const ctx = makeCtx();
      const initState = await profileAccumulatorAnalyzer.initialize(ctx);
      const baseBackend = initState.value.domainDistribution["backend"] ?? 0;

      const events = [
        makeEvent({ domain: "backend" }),
        makeEvent({ id: "e2", domain: "frontend" }),
        makeEvent({ id: "e3", domain: "backend" }),
      ];

      const result = await profileAccumulatorAnalyzer.update(
        initState,
        { events, sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const output = profileAccumulatorAnalyzer.derive(result.state);
      const backend = output.domainDistribution.find((d) => d.domain === "backend");
      expect(backend?.eventCount).toBe(baseBackend + 2);
    });
  });
});

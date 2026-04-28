import { describe, expect, it, vi } from "vitest";
import { sessionIntelligenceAnalyzer, type SessionIntelligence } from "../../../src/services/intelligence/session-intelligence.js";
import type { AnalyzerContext } from "../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, FactEntry, ComprehensionEntry } from "../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockAnalytics(): DbLike {
  return { run() {}, exec() { return [{ columns: [], values: [] }]; } };
}

function createMockKnowledge(
  facts: FactEntry[] = [],
  decisions: FactEntry[] = [],
  assessments: ComprehensionEntry[] = [],
  hasData = true,
): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue(assessments),
    getFacts: vi.fn().mockResolvedValue(facts),
    getDecisions: vi.fn().mockResolvedValue(decisions),
    getEntityEngagement: vi.fn().mockResolvedValue([{ entityId: "ent-1", name: "Redis", type: "technology", mentionCount: 3, lastSeen: "", confidence: 0.9 }]),
    getDecayState: vi.fn().mockResolvedValue([]),
    hasKnowledgeData: vi.fn().mockResolvedValue(hasData),
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
    sessionId: "session-001",
    ts: new Date().toISOString(),
    source: "ai-session",
    type: "ai-conversation",
    projectId: "proj-1",
    executionPhase: "implementing",
    humanDirectionScore: 0.6,
    ...overrides,
  } as any;
}

const recentDate = new Date().toISOString();

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("session-intelligence (KGI-7)", () => {
  describe("knowledge progress enrichment", () => {
    it("populates knowledgeProgress when facts are extracted", async () => {
      const sessionStart = new Date(Date.now() - 3600_000).toISOString();
      const factTime = new Date(Date.now() - 1800_000).toISOString();

      const facts: FactEntry[] = [
        { id: "f1", subjectId: "ent-1", predicate: "USES", objectId: "", objectText: "caching", confidence: 0.9, context: "test", validAt: factTime, invalidAt: "" },
        { id: "f2", subjectId: "ent-1", predicate: "DEPENDS_ON", objectId: "", objectText: "ioredis", confidence: 0.85, context: "test", validAt: factTime, invalidAt: "" },
      ];
      const decisions: FactEntry[] = [
        { id: "d1", subjectId: "ent-1", predicate: "DECIDED", objectId: "", objectText: "JWT", confidence: 0.8, context: "test", validAt: factTime, invalidAt: "" },
      ];
      const knowledge = createMockKnowledge(facts, decisions);

      const ctx = makeCtx({ knowledge });
      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);

      const events = [
        makeEvent({ ts: sessionStart }),
        makeEvent({ id: "evt-2", ts: new Date(Date.now() - 1000).toISOString() }),
      ];

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events, sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const session = result.state.value.sessions["session-001"];
      expect(session).toBeDefined();
      expect(session.knowledgeProgress).not.toBeNull();
      expect(session.knowledgeProgress!.factsExtracted).toBe(2);
      expect(session.knowledgeProgress!.decisionsRecorded).toBe(1);
      expect(session.knowledgeProgress!.entitiesEngaged).toBeGreaterThanOrEqual(1);
    });

    it("suggests deeper questions when no facts after 5+ turns", async () => {
      const knowledge = createMockKnowledge([], [], []);
      const ctx = makeCtx({ knowledge });

      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);

      const events = Array.from({ length: 6 }, (_, i) =>
        makeEvent({ id: `evt-${i}`, sessionId: "session-nofacts", ts: new Date(Date.now() + i * 1000).toISOString() }),
      );

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events, sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const session = result.state.value.sessions["session-nofacts"];
      expect(session).toBeDefined();
      expect(session.knowledgeProgress?.factsExtracted).toBe(0);
      expect(session.suggestedAction).toContain("no new knowledge");
    });

    it("tracks comprehension delta within session", async () => {
      const sessionStart = new Date(Date.now() - 3600_000).toISOString();
      const assessments: ComprehensionEntry[] = [
        { episodeId: "evt-1", timestamp: new Date(Date.now() - 1800_000).toISOString(), steering: 5, understanding: 5, metacognition: 4, independence: 4, engagement: 5, overallScore: 46, assessmentMethod: "llm" },
        { episodeId: "evt-2", timestamp: new Date(Date.now() - 900_000).toISOString(), steering: 8, understanding: 9, metacognition: 7, independence: 6, engagement: 8, overallScore: 78, assessmentMethod: "llm" },
      ];
      const knowledge = createMockKnowledge([], [], assessments);
      const ctx = makeCtx({ knowledge });

      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);
      const events = [
        makeEvent({ ts: sessionStart }),
        makeEvent({ id: "evt-2", ts: new Date(Date.now() - 1000).toISOString() }),
      ];

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events, sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const session = result.state.value.sessions["session-001"];
      expect(session.knowledgeProgress).not.toBeNull();
      expect(session.knowledgeProgress!.comprehensionDelta).toBeGreaterThan(0);
    });
  });

  describe("fallback (no knowledge)", () => {
    it("knowledgeProgress is null when knowledge unavailable", async () => {
      const ctx = makeCtx({ knowledge: null });
      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events: [makeEvent()], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const session = result.state.value.sessions["session-001"];
      expect(session.knowledgeProgress).toBeNull();
    });

    it("existing diagnostics still work without knowledge", async () => {
      const ctx = makeCtx({ knowledge: null });
      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);

      const events = Array.from({ length: 15 }, (_, i) =>
        makeEvent({
          id: `evt-loop-${i}`,
          sessionId: "session-loop",
          humanDirectionScore: 0.1,
          ts: new Date(Date.now() + i * 1000).toISOString(),
        }),
      );

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events, sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      const session = result.state.value.sessions["session-loop"];
      expect(session.loopRisk).toBeGreaterThan(0);
      expect(session.turnCount).toBe(15);
    });
  });

  describe("basic session tracking", () => {
    it("creates new session on first event", async () => {
      const ctx = makeCtx();
      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events: [makeEvent({ sessionId: "session-new" })], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(result.state.value.sessions["session-new"]).toBeDefined();
      expect(result.state.value.sessions["session-new"].turnCount).toBe(1);
      expect(result.changed).toBe(true);
    });

    it("increments turn count on subsequent events", async () => {
      const ctx = makeCtx();
      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);

      const events = [
        makeEvent({ id: "evt-1", sessionId: "s1" }),
        makeEvent({ id: "evt-2", sessionId: "s1", ts: new Date(Date.now() + 1000).toISOString() }),
        makeEvent({ id: "evt-3", sessionId: "s1", ts: new Date(Date.now() + 2000).toISOString() }),
      ];

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events, sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(result.state.value.sessions["s1"].turnCount).toBe(3);
    });

    it("skips events without sessionId", async () => {
      const ctx = makeCtx();
      const initState = await sessionIntelligenceAnalyzer.initialize(ctx);

      const result = await sessionIntelligenceAnalyzer.update(
        initState,
        { events: [makeEvent({ sessionId: undefined })], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(Object.keys(result.state.value.sessions)).toHaveLength(0);
    });
  });
});

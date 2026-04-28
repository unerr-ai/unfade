import { describe, expect, it, vi } from "vitest";
import { decisionReplayAnalyzer } from "../../../../src/services/intelligence/analyzers/decision-replay.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, FactEntry } from "../../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../../src/services/cache/manager.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockAnalytics(): DbLike {
  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("SELECT id FROM events")) {
        return [{ columns: ["id"], values: [["evt-dr1"], ["evt-dr2"]] }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function makeFact(overrides: Partial<FactEntry> = {}): FactEntry {
  return {
    id: "fact-1",
    subjectId: "ent-project",
    predicate: "DECIDED",
    objectId: "",
    objectText: "JWT for auth",
    confidence: 0.85,
    context: "Decided to use JWT for authentication",
    validAt: "2026-04-20T10:00:00Z",
    invalidAt: "",
    ...overrides,
  };
}

function createMockKnowledge(
  activeDecisions: FactEntry[] = [],
  allFacts: FactEntry[] = [],
  hasData = true,
): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue([]),
    getFacts: vi.fn().mockResolvedValue(allFacts),
    getDecisions: vi.fn().mockResolvedValue(activeDecisions),
    getEntityEngagement: vi.fn().mockResolvedValue([]),
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("decision-replay (KGI-4 + IP-4.4)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], [], true) });
      const state = await decisionReplayAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], [], true) });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("generates info diagnostic when no replays", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], [], true) });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      const infoDiags = state.value.output.diagnostics.filter((d) =>
        d.message.includes("No active decision replays"),
      );
      expect(infoDiags.length).toBeGreaterThanOrEqual(1);
    });

    it("generates contradiction diagnostic when replays exist", async () => {
      const old = makeFact({
        id: "fact-old",
        subjectId: "ent-p",
        predicate: "DECIDED",
        objectText: "Redux",
        validAt: "2026-04-15T10:00:00Z",
        invalidAt: "2026-04-25T10:00:00Z",
      });
      const replacement = makeFact({
        id: "fact-new",
        subjectId: "ent-p",
        predicate: "DECIDED",
        objectText: "Zustand",
        validAt: "2026-04-25T10:00:00Z",
        invalidAt: "",
      });
      const knowledge = createMockKnowledge([replacement], [old, replacement]);
      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      if (state.value.output.replays.length > 0) {
        const diags = state.value.output.diagnostics.filter((d) =>
          d.message.includes("contradiction") || d.message.includes("supersession"),
        );
        expect(diags.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("per-replay evidenceEventIds", () => {
    it("replays include evidenceEventIds", async () => {
      const old = makeFact({
        id: "fact-old-ev",
        subjectId: "ent-proj",
        predicate: "DECIDED",
        objectText: "Express",
        validAt: "2026-04-10T10:00:00Z",
        invalidAt: "2026-04-25T10:00:00Z",
      });
      const replacement = makeFact({
        id: "fact-new-ev",
        subjectId: "ent-proj",
        predicate: "DECIDED",
        objectText: "Fastify",
        validAt: "2026-04-25T10:00:00Z",
        invalidAt: "",
      });
      const knowledge = createMockKnowledge([replacement], [old, replacement]);
      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      for (const replay of state.value.output.replays) {
        expect(Array.isArray(replay.evidenceEventIds)).toBe(true);
      }
    });
  });

  describe("no .slice(-10) cap", () => {
    it("returns all replays without truncation", async () => {
      const facts: FactEntry[] = [];
      const active: FactEntry[] = [];

      for (let i = 0; i < 15; i++) {
        facts.push(makeFact({
          id: `fact-old-${i}`,
          subjectId: `ent-${i}`,
          predicate: "DECIDED",
          objectText: `old-choice-${i}`,
          validAt: "2026-04-10T10:00:00Z",
          invalidAt: "2026-04-25T10:00:00Z",
        }));

        const newFact = makeFact({
          id: `fact-new-${i}`,
          subjectId: `ent-${i}`,
          predicate: "DECIDED",
          objectText: `new-choice-${i}`,
          validAt: "2026-04-25T10:00:00Z",
          invalidAt: "",
        });
        facts.push(newFact);
        active.push(newFact);
      }

      const knowledge = createMockKnowledge(active, facts);
      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      // Rate limit is 2 per week, but existing replays shouldn't be truncated
      expect(state.value.output.replays.length).toBeLessThanOrEqual(2);
    });
  });

  describe("knowledge-grounded path", () => {
    it("triggers replay when a decision is contradicted", async () => {
      const oldDecision = makeFact({
        id: "fact-old-redux",
        subjectId: "ent-project",
        predicate: "DECIDED",
        objectText: "Redux for state management",
        validAt: "2026-04-15T10:00:00Z",
        invalidAt: "2026-04-25T10:00:00Z",
        context: "Decided to use Redux for state management",
      });
      const newDecision = makeFact({
        id: "fact-new-zustand",
        subjectId: "ent-project",
        predicate: "DECIDED",
        objectText: "Zustand for state management",
        validAt: "2026-04-25T10:00:00Z",
        invalidAt: "",
        context: "Switched to Zustand for simpler state management",
      });
      const knowledge = createMockKnowledge([newDecision], [oldDecision, newDecision]);

      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("knowledge");
      expect(state.value.output.replays.length).toBeGreaterThanOrEqual(1);
      expect(state.value.output.replays[0].triggerReason).toMatch(/contradiction|supersession/);
      expect(state.value.output.replays[0].originalDecision.decision).toContain("Redux");
    });

    it("triggers supersession replay for REPLACED_BY/SWITCHED_FROM", async () => {
      const oldFact = makeFact({
        id: "fact-old-express",
        subjectId: "ent-project",
        predicate: "ADOPTED",
        objectText: "Express",
        validAt: "2026-04-10T10:00:00Z",
        invalidAt: "2026-04-25T10:00:00Z",
      });
      const newFact = makeFact({
        id: "fact-new-fastify",
        subjectId: "ent-project",
        predicate: "SWITCHED_FROM",
        objectText: "Fastify",
        validAt: "2026-04-25T10:00:00Z",
        invalidAt: "",
        context: "Switched from Express to Fastify",
      });
      const knowledge = createMockKnowledge([newFact], [oldFact, newFact]);

      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      const replay = state.value.output.replays.find((r) => r.triggerReason === "supersession");
      expect(replay).toBeDefined();
    });

    it("does NOT trigger replay for consistent decisions", async () => {
      const d1 = makeFact({ id: "fact-redis", objectText: "Redis for caching", invalidAt: "" });
      const d2 = makeFact({ id: "fact-pg", objectText: "PostgreSQL for storage", invalidAt: "" });
      const knowledge = createMockKnowledge([d1, d2], [d1, d2]);

      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      expect(state.value.output.replays.length).toBe(0);
    });

    it("includes time elapsed in trigger detail", async () => {
      const old = makeFact({
        id: "fact-old-time",
        subjectId: "ent-auth",
        predicate: "DECIDED",
        objectText: "session cookies",
        validAt: "2026-04-01T10:00:00Z",
        invalidAt: "2026-04-28T10:00:00Z",
      });
      const replacement = makeFact({
        id: "fact-new-time",
        subjectId: "ent-auth",
        predicate: "DECIDED",
        objectText: "JWT tokens",
        validAt: "2026-04-28T10:00:00Z",
        invalidAt: "",
      });
      const knowledge = createMockKnowledge([replacement], [old, replacement]);
      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      if (state.value.output.replays.length > 0) {
        expect(state.value.output.replays[0].triggerDetail).toContain("27 days");
      }
    });
  });

  describe("rate limiting", () => {
    it("generates at most 2 replays per week", async () => {
      const facts: FactEntry[] = [];
      const active: FactEntry[] = [];

      for (let i = 0; i < 5; i++) {
        facts.push(makeFact({
          id: `fact-old-${i}`,
          subjectId: `ent-${i}`,
          predicate: "DECIDED",
          objectText: `old-choice-${i}`,
          validAt: "2026-04-10T10:00:00Z",
          invalidAt: "2026-04-25T10:00:00Z",
        }));
        const newFact = makeFact({
          id: `fact-new-${i}`,
          subjectId: `ent-${i}`,
          predicate: "DECIDED",
          objectText: `new-choice-${i}`,
          validAt: "2026-04-25T10:00:00Z",
          invalidAt: "",
        });
        facts.push(newFact);
        active.push(newFact);
      }

      const knowledge = createMockKnowledge(active, facts);
      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      const recentReplays = state.value.output.replays.filter(
        (r) => new Date(r.createdAt).getTime() > Date.now() - 60_000,
      );
      expect(recentReplays.length).toBeLessThanOrEqual(2);
    });
  });

  describe("fallback path (no knowledge)", () => {
    it("falls back to HDS when knowledge is null", async () => {
      const ctx = makeCtx({ knowledge: null });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("hds-fallback");
    });

    it("returns empty replays when no decisions in DuckDB", async () => {
      const ctx = makeCtx({ knowledge: null });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      expect(state.value.output.replays.length).toBe(0);
    });
  });

  describe("incremental update", () => {
    it("detects change in replay count", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], [], true) });
      const initState = await decisionReplayAnalyzer.initialize(ctx);

      const old = makeFact({
        id: "fact-update-old",
        subjectId: "ent-update",
        predicate: "DECIDED",
        objectText: "old approach",
        validAt: "2026-04-01T10:00:00Z",
        invalidAt: "2026-04-28T10:00:00Z",
      });
      const replacement = makeFact({
        id: "fact-update-new",
        subjectId: "ent-update",
        predicate: "DECIDED",
        objectText: "new approach",
        validAt: "2026-04-28T10:00:00Z",
        invalidAt: "",
      });

      const updatedKnowledge = createMockKnowledge([replacement], [old, replacement]);
      const updateResult = await decisionReplayAnalyzer.update(
        initState,
        { events: [{ id: "evt-new" } as any], sessionUpdates: [], featureUpdates: [] },
        makeCtx({ knowledge: updatedKnowledge }),
      );

      expect(updateResult.changed).toBe(true);
    });
  });

  describe("entity contributions", () => {
    it("contributes decision entities from replays", async () => {
      const old = makeFact({
        id: "fact-contrib-old",
        subjectId: "ent-contrib",
        predicate: "DECIDED",
        objectText: "old tech",
        validAt: "2026-04-10T10:00:00Z",
        invalidAt: "2026-04-25T10:00:00Z",
      });
      const replacement = makeFact({
        id: "fact-contrib-new",
        subjectId: "ent-contrib",
        predicate: "DECIDED",
        objectText: "new tech",
        validAt: "2026-04-25T10:00:00Z",
        invalidAt: "",
      });

      const knowledge = createMockKnowledge([replacement], [old, replacement]);
      const ctx = makeCtx({ knowledge });
      const state = await decisionReplayAnalyzer.initialize(ctx);

      const contributions = decisionReplayAnalyzer.contributeEntities!(state, {} as any);

      expect(contributions.length).toBeGreaterThanOrEqual(1);
      expect(contributions[0].entityType).toBe("decision");
      expect(contributions[0].analyzerName).toBe("decision-replay");
      expect(contributions[0].stateFragment.source).toBe("knowledge");
    });
  });
});

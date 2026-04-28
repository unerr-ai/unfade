import { describe, expect, it, vi } from "vitest";
import { loopDetectorAnalyzer } from "../../../../src/services/intelligence/analyzers/loop-detector.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, EntityEngagement, FactEntry } from "../../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../../src/services/cache/manager.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockAnalytics(): DbLike {
  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("SELECT id FROM events")) {
        return [{ columns: ["id"], values: [["evt-l1"], ["evt-l2"], ["evt-l3"]] }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function makeEntity(overrides: Partial<EntityEngagement> = {}): EntityEngagement {
  return {
    entityId: "ent-redis",
    name: "Redis",
    type: "technology",
    mentionCount: 5,
    lastSeen: new Date().toISOString(),
    confidence: 0.9,
    ...overrides,
  };
}

function makeFact(overrides: Partial<FactEntry> = {}): FactEntry {
  return {
    id: "fact-1",
    subjectId: "ent-redis",
    predicate: "USES",
    objectId: "",
    objectText: "caching",
    confidence: 0.85,
    context: "Redis for caching",
    validAt: new Date().toISOString(),
    invalidAt: "",
    ...overrides,
  };
}

function createMockKnowledge(
  entities: EntityEngagement[] = [],
  factsBySubject: Map<string, FactEntry[]> = new Map(),
  hasData = true,
): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue([]),
    getFacts: vi.fn().mockImplementation(async (opts: { subject?: string }) => {
      if (opts.subject) return factsBySubject.get(opts.subject) ?? [];
      return Array.from(factsBySubject.values()).flat();
    }),
    getDecisions: vi.fn().mockResolvedValue([]),
    getEntityEngagement: vi.fn().mockResolvedValue(entities),
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

const recentDate = new Date().toISOString();

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("loop-detector (KGI-5 + IP-3.4)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], new Map()) });
      const state = await loopDetectorAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });

    it("empty index has _meta with zero dataPoints", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], new Map()) });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.output._meta.dataPoints).toBe(0);
      expect(state.value.output._meta.confidence).toBe("low");
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], new Map()) });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("generates diagnostic per stuck loop", async () => {
      const entities = [makeEntity({ entityId: "ent-auth", name: "auth module", mentionCount: 5 })];
      const facts = new Map([["ent-auth", [makeFact({ subjectId: "ent-auth", validAt: recentDate })]]]);
      const knowledge = createMockKnowledge(entities, facts);

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      const loopDiags = state.value.output.diagnostics.filter((d) =>
        d.message.includes("Stuck loop"),
      );
      expect(loopDiags.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(loopDiags[0].evidenceEventIds)).toBe(true);
    });

    it("generates critical diagnostic when 3+ stuck loops", async () => {
      const entities = [
        makeEntity({ entityId: "ent-a", name: "module-a", mentionCount: 6 }),
        makeEntity({ entityId: "ent-b", name: "module-b", mentionCount: 7 }),
        makeEntity({ entityId: "ent-c", name: "module-c", mentionCount: 8 }),
      ];
      const knowledge = createMockKnowledge(entities, new Map());

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      const criticals = state.value.output.diagnostics.filter((d) => d.severity === "critical");
      expect(criticals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("per-loop evidenceEventIds", () => {
    it("stuck loops include evidenceEventIds", async () => {
      const entities = [makeEntity({ entityId: "ent-auth", name: "auth module", mentionCount: 5 })];
      const facts = new Map([["ent-auth", [makeFact({ subjectId: "ent-auth", validAt: recentDate })]]]);
      const knowledge = createMockKnowledge(entities, facts);

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      for (const loop of state.value.output.stuckLoops) {
        expect(Array.isArray(loop.evidenceEventIds)).toBe(true);
        expect(loop.evidenceEventIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe("no artificial caps", () => {
    it("returns all entries without .slice(-20) truncation", async () => {
      const manyEntities = Array.from({ length: 30 }, (_, i) =>
        makeEntity({ entityId: `ent-${i}`, name: `entity-${i}`, mentionCount: 5 }),
      );
      const knowledge = createMockKnowledge(manyEntities, new Map());

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.output.entries.length).toBe(30);
      expect(state.value.output.stuckLoops.length).toBe(30);
    });
  });

  describe("knowledge-grounded path", () => {
    it("detects loop: entity discussed 5 times with only 1 fact", async () => {
      const entities = [makeEntity({ entityId: "ent-auth", name: "auth module", mentionCount: 5 })];
      const facts = new Map([["ent-auth", [makeFact({ subjectId: "ent-auth", validAt: recentDate })]]]);
      const knowledge = createMockKnowledge(entities, facts);

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("knowledge");
      expect(state.value.output.stuckLoops.length).toBeGreaterThanOrEqual(1);
      expect(state.value.output.stuckLoops[0].domain).toBe("auth module");
    });

    it("no loop: entity discussed 5 times with 5 facts (good progress)", async () => {
      const entities = [makeEntity({ entityId: "ent-redis", name: "Redis", mentionCount: 5 })];
      const facts = new Map([
        ["ent-redis", Array.from({ length: 5 }, (_, i) => makeFact({
          id: `fact-${i}`,
          subjectId: "ent-redis",
          validAt: recentDate,
        }))],
      ]);
      const knowledge = createMockKnowledge(entities, facts);

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      const redisLoops = state.value.output.stuckLoops.filter((l) => l.domain === "Redis");
      expect(redisLoops.length).toBe(0);
    });

    it("no loop: entity discussed only 2 times (below threshold)", async () => {
      const entities = [makeEntity({ entityId: "ent-tiny", name: "utils", mentionCount: 2 })];
      const knowledge = createMockKnowledge(entities, new Map());

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.output.stuckLoops.length).toBe(0);
    });

    it("calculates risk score correctly", async () => {
      const entities = [makeEntity({ entityId: "ent-db", name: "database", mentionCount: 8 })];
      const facts = new Map([
        ["ent-db", [
          makeFact({ id: "f1", subjectId: "ent-db", validAt: recentDate }),
          makeFact({ id: "f2", subjectId: "ent-db", validAt: recentDate }),
        ]],
      ]);
      const knowledge = createMockKnowledge(entities, facts);

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.output.stuckLoops.length).toBe(1);
      expect(state.value.output.stuckLoops[0].domain).toBe("database");
      expect(state.value.output.stuckLoops[0].occurrences).toBe(8);
    });

    it("no stuck loop when risk is below threshold", async () => {
      const entities = [makeEntity({ entityId: "ent-ok", name: "api", mentionCount: 5 })];
      const facts = new Map([
        ["ent-ok", Array.from({ length: 3 }, (_, i) => makeFact({
          id: `f-${i}`,
          subjectId: "ent-ok",
          validAt: recentDate,
        }))],
      ]);
      const knowledge = createMockKnowledge(entities, facts);

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      const apiLoops = state.value.output.stuckLoops.filter((l) => l.domain === "api");
      expect(apiLoops.length).toBe(0);
    });

    it("empty entities → empty index", async () => {
      const knowledge = createMockKnowledge([], new Map());
      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.output.stuckLoops.length).toBe(0);
      expect(state.value.output.entries.length).toBe(0);
    });
  });

  describe("fallback path", () => {
    it("falls back to HDS when knowledge is null", async () => {
      const ctx = makeCtx({ knowledge: null });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("hds-fallback");
    });

    it("falls back when hasKnowledgeData returns false", async () => {
      const knowledge = createMockKnowledge([], new Map(), false);
      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      expect(state.value.source).toBe("hds-fallback");
    });
  });

  describe("incremental update", () => {
    it("detects change in stuck loop count", async () => {
      const ctx = makeCtx({ knowledge: createMockKnowledge([], new Map()) });
      const initState = await loopDetectorAnalyzer.initialize(ctx);

      const entities = [makeEntity({ entityId: "ent-new-loop", name: "new-loop", mentionCount: 6 })];
      const knowledge = createMockKnowledge(entities, new Map());

      const updateResult = await loopDetectorAnalyzer.update(
        initState,
        { events: [{ id: "evt" } as any], sessionUpdates: [], featureUpdates: [] },
        makeCtx({ knowledge }),
      );

      expect(updateResult.changed).toBe(true);
    });
  });

  describe("entity contributions", () => {
    it("contributes hotspot entities for stuck loops", async () => {
      const entities = [makeEntity({ entityId: "ent-stuck", name: "stuck-thing", mentionCount: 7 })];
      const knowledge = createMockKnowledge(entities, new Map());

      const ctx = makeCtx({ knowledge });
      const state = await loopDetectorAnalyzer.initialize(ctx);

      const contributions = loopDetectorAnalyzer.contributeEntities!(state, {} as any);

      expect(contributions.length).toBeGreaterThanOrEqual(1);
      expect(contributions[0].entityType).toBe("hotspot");
      expect(contributions[0].analyzerName).toBe("loop-detector");
      expect(contributions[0].stateFragment.source).toBe("knowledge");
    });
  });
});

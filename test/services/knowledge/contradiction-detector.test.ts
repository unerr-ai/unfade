import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CozoDb } from "cozo-node";
import type { PersistedFact } from "../../../src/schemas/knowledge.js";
import {
  FACT_SCHEMA,
  EDGE_SCHEMA,
} from "../../../src/services/substrate/schema.js";

// ─── Mock generateText ──────────────────────────────────────────────────────

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

const {
  findContradictionCandidates,
  classifyContradictionBatch,
  detectContradictions,
} = await import("../../../src/services/knowledge/contradiction-detector.js");
const { getValidFactsForSubject } = await import(
  "../../../src/services/knowledge/fact-writer-graph.js"
);

// ─── Test Setup ─────────────────────────────────────────────────────────────

let db: CozoDb;

function escCozo(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

beforeAll(async () => {
  db = new CozoDb("mem", "");
  await db.run(FACT_SCHEMA);
  await db.run(EDGE_SCHEMA);
});

afterAll(() => {
  try { db.close(); } catch { /* */ }
});

beforeEach(() => {
  mockGenerateText.mockReset();
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makePersisted(overrides: Partial<PersistedFact> = {}): PersistedFact {
  return {
    id: `fact-${Math.random().toString(36).slice(2, 10)}`,
    subject: "project",
    predicate: "USES",
    object: "Redis",
    confidence: 0.9,
    explicit: true,
    temporalHint: "ongoing",
    context: "The project uses Redis for caching",
    subjectId: "ent-project-001",
    objectId: "ent-redis-001",
    objectText: null,
    validAt: "2026-04-28T10:00:00Z",
    invalidAt: null,
    createdAt: "2026-04-28T12:00:00Z",
    expiredAt: null,
    sourceEpisode: "evt-001",
    sourceSegment: null,
    extractionMethod: "llm",
    ...overrides,
  };
}

async function insertFactIntoCozoDB(fact: PersistedFact): Promise<void> {
  const f = fact;
  await db.run(
    `?[id, subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method] <- [
      ['${escCozo(f.id)}', '${escCozo(f.subjectId)}', '${escCozo(f.predicate)}', '${escCozo(f.objectId ?? "")}', '${escCozo(f.objectText ?? "")}', ${f.confidence}, ${f.explicit}, '${escCozo(f.temporalHint)}', '${escCozo(f.context)}', '${escCozo(f.validAt)}', '${escCozo(f.invalidAt ?? "")}', '${escCozo(f.createdAt)}', '${escCozo(f.expiredAt ?? "")}', '${escCozo(f.sourceEpisode)}', '${escCozo(f.sourceSegment ?? "")}', '${escCozo(f.extractionMethod)}']
    ]
    :put fact {id => subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method}`,
  );
}

function makeConfig() {
  return {
    model: {} as any,
    provider: "test",
    modelName: "test-model",
    concurrency: 1,
    timeoutMs: 30_000,
  };
}

// ─── Stage 1: Candidate Retrieval ───────────────────────────────────────────

describe("contradiction-detector (KE-12)", () => {
  describe("findContradictionCandidates (Stage 1)", () => {
    it("finds candidates with same subject and predicate", async () => {
      const existingFact = makePersisted({
        id: "fact-existing-redis",
        subject: "project",
        predicate: "USES",
        object: "Memcached",
        objectId: "ent-memcached-001",
        context: "project uses Memcached for caching",
      });
      await insertFactIntoCozoDB(existingFact);

      const newFact = makePersisted({
        id: "fact-new-redis",
        subject: "project",
        predicate: "USES",
        object: "Redis",
        objectId: "ent-redis-001",
        context: "project uses Redis for caching",
      });

      const candidates = await findContradictionCandidates(newFact, db);

      expect(candidates.length).toBeGreaterThanOrEqual(1);
      const memcachedCandidate = candidates.find((c) => c.existingFactId === "fact-existing-redis");
      expect(memcachedCandidate).toBeDefined();
    });

    it("excludes invalidated facts from candidates", async () => {
      const invalidatedFact = makePersisted({
        id: "fact-invalidated-001",
        predicate: "DEPENDS_ON",
        object: "Webpack",
        invalidAt: "2026-04-27T00:00:00Z",
      });
      await insertFactIntoCozoDB(invalidatedFact);

      const newFact = makePersisted({
        id: "fact-new-bundler",
        predicate: "DEPENDS_ON",
        object: "Vite",
      });

      const candidates = await findContradictionCandidates(newFact, db);
      const found = candidates.find((c) => c.existingFactId === "fact-invalidated-001");
      expect(found).toBeUndefined();
    });

    it("excludes the new fact itself from candidates", async () => {
      const fact = makePersisted({ id: "fact-self-001", predicate: "CREATED" });
      await insertFactIntoCozoDB(fact);

      const candidates = await findContradictionCandidates(fact, db);
      const selfMatch = candidates.find((c) => c.existingFactId === "fact-self-001");
      expect(selfMatch).toBeUndefined();
    });

    it("returns empty array when no candidates exist", async () => {
      const newFact = makePersisted({
        id: "fact-no-match",
        subjectId: "ent-unique-subject-999",
        predicate: "DESIGNED",
      });

      const candidates = await findContradictionCandidates(newFact, db);
      expect(candidates).toEqual([]);
    });

    it("skips embedding path gracefully when no embedFn provided", async () => {
      const newFact = makePersisted({ id: "fact-no-embed" });
      const candidates = await findContradictionCandidates(newFact, db);
      // Should not throw — predicate fallback used
      expect(Array.isArray(candidates)).toBe(true);
    });

    it("handles embedding errors gracefully", async () => {
      const embedFn = vi.fn().mockRejectedValue(new Error("embedding unavailable"));
      const newFact = makePersisted({ id: "fact-embed-err" });

      const candidates = await findContradictionCandidates(newFact, db, embedFn);
      expect(Array.isArray(candidates)).toBe(true);
    });
  });

  // ── Stage 2: LLM Classification ─────────────────────────────────────

  describe("classifyContradictionBatch (Stage 2)", () => {
    it("classifies contradictory facts and invalidates old fact", async () => {
      const existingFact = makePersisted({
        id: "fact-classify-old",
        predicate: "USES",
        object: "Redux",
        objectId: "ent-redux-001",
        context: "project uses Redux for state management",
      });
      await insertFactIntoCozoDB(existingFact);

      const newFact = makePersisted({
        id: "fact-classify-new",
        predicate: "USES",
        object: "Zustand",
        objectId: "ent-zustand-001",
        context: "project uses Zustand for state management",
      });
      await insertFactIntoCozoDB(newFact);

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          classification: "CONTRADICTORY",
          confidence: 0.92,
          reasoning: "Both facts describe the state management library used. Redux and Zustand serve the same purpose — only one can be the current choice.",
        }),
      });

      const candidates = [{
        existingFactId: "fact-classify-old",
        existingFact: {
          id: "fact-classify-old",
          subject: "project",
          subjectId: "ent-project-001",
          predicate: "USES",
          object: "Redux",
          objectId: "ent-redux-001",
          objectText: "",
          confidence: 0.9,
          explicit: true,
          temporalHint: "ongoing",
          context: "project uses Redux for state management",
          validAt: "2026-04-25T10:00:00Z",
        },
        similarity: 1.0,
      }];

      const results = await classifyContradictionBatch(candidates, newFact, makeConfig(), db);

      expect(results).toHaveLength(1);
      expect(results[0].classification).toBe("CONTRADICTORY");
      expect(results[0].confidence).toBe(0.92);
      expect(results[0].existingFactId).toBe("fact-classify-old");
      expect(results[0].newFactId).toBe("fact-classify-new");

      // Verify old fact was invalidated
      const check = await db.run(
        "?[invalid_at] := *fact{id: 'fact-classify-old', invalid_at}",
      );
      const rows = (check as { rows: unknown[][] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).not.toBe("");
    });

    it("does not invalidate facts classified as CONSISTENT", async () => {
      const existingFact = makePersisted({
        id: "fact-consistent-old",
        predicate: "USES",
        object: "Redis",
        context: "project uses Redis for caching",
      });
      await insertFactIntoCozoDB(existingFact);

      const newFact = makePersisted({
        id: "fact-consistent-new",
        predicate: "USES",
        object: "PostgreSQL",
        context: "project uses PostgreSQL for data storage",
      });

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          classification: "CONSISTENT",
          confidence: 0.95,
          reasoning: "Redis is for caching, PostgreSQL is for data storage. Different purposes, no conflict.",
        }),
      });

      const candidates = [{
        existingFactId: "fact-consistent-old",
        existingFact: {
          id: "fact-consistent-old",
          subject: "project",
          subjectId: "ent-project-001",
          predicate: "USES",
          object: "Redis",
          objectId: "ent-redis-001",
          objectText: "",
          confidence: 0.9,
          explicit: true,
          temporalHint: "ongoing",
          context: "project uses Redis for caching",
          validAt: "2026-04-25T10:00:00Z",
        },
        similarity: 1.0,
      }];

      const results = await classifyContradictionBatch(candidates, newFact, makeConfig(), db);

      expect(results[0].classification).toBe("CONSISTENT");

      // Verify old fact was NOT invalidated
      const check = await db.run(
        "?[invalid_at] := *fact{id: 'fact-consistent-old', invalid_at}",
      );
      const rows = (check as { rows: unknown[][] }).rows;
      expect(rows[0][0]).toBe("");
    });

    it("handles LLM returning invalid JSON gracefully", async () => {
      mockGenerateText.mockResolvedValue({ text: "not valid json at all" });

      const newFact = makePersisted({ id: "fact-bad-json" });
      const candidates = [{
        existingFactId: "fact-existing-redis",
        existingFact: {
          id: "fact-existing-redis",
          subject: "project",
          subjectId: "ent-project-001",
          predicate: "USES",
          object: "Memcached",
          objectId: "ent-memcached-001",
          objectText: "",
          confidence: 0.9,
          explicit: true,
          temporalHint: "ongoing",
          context: "project uses Memcached",
          validAt: "2026-04-25T10:00:00Z",
        },
        similarity: 1.0,
      }];

      const results = await classifyContradictionBatch(candidates, newFact, makeConfig(), db);
      expect(results).toHaveLength(0);
    });

    it("SUPERSEDES classification invalidates old fact", async () => {
      const oldFact = makePersisted({
        id: "fact-supersede-old",
        predicate: "DEPLOYED_ON",
        object: "Heroku",
        context: "deployed on Heroku",
      });
      await insertFactIntoCozoDB(oldFact);

      const newFact = makePersisted({
        id: "fact-supersede-new",
        predicate: "DEPLOYED_ON",
        object: "Vercel",
        context: "migrated to Vercel",
        validAt: "2026-04-28T10:00:00Z",
      });

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          classification: "SUPERSEDES",
          confidence: 0.88,
          reasoning: "Deployment moved from Heroku to Vercel.",
        }),
      });

      const candidates = [{
        existingFactId: "fact-supersede-old",
        existingFact: {
          id: "fact-supersede-old",
          subject: "project",
          subjectId: "ent-project-001",
          predicate: "DEPLOYED_ON",
          object: "Heroku",
          objectId: "",
          objectText: "Heroku",
          confidence: 0.9,
          explicit: true,
          temporalHint: "ongoing",
          context: "deployed on Heroku",
          validAt: "2026-04-20T10:00:00Z",
        },
        similarity: 1.0,
      }];

      const results = await classifyContradictionBatch(candidates, newFact, makeConfig(), db);
      expect(results[0].classification).toBe("SUPERSEDES");

      const check = await db.run("?[invalid_at] := *fact{id: 'fact-supersede-old', invalid_at}");
      expect(((check as { rows: unknown[][] }).rows[0][0] as string).length).toBeGreaterThan(0);
    });
  });

  // ── Combined Pipeline ──────────────────────────────────────────────

  describe("detectContradictions (combined)", () => {
    it("finds candidates and classifies them end-to-end", async () => {
      const existingFact = makePersisted({
        id: "fact-e2e-old",
        predicate: "CONFIGURED_WITH",
        object: "webpack.config.js",
        objectText: "webpack.config.js",
        objectId: "",
        context: "project configured with webpack",
      });
      await insertFactIntoCozoDB(existingFact);

      const newFact = makePersisted({
        id: "fact-e2e-new",
        predicate: "CONFIGURED_WITH",
        object: "vite.config.ts",
        objectText: "vite.config.ts",
        objectId: "",
        context: "project configured with vite",
      });
      await insertFactIntoCozoDB(newFact);

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          classification: "SUPERSEDES",
          confidence: 0.85,
          reasoning: "Migrated from webpack to vite for build tooling.",
        }),
      });

      const result = await detectContradictions([newFact], makeConfig(), db);

      expect(result.candidatesFound).toBeGreaterThanOrEqual(1);
      expect(result.results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty results when no candidates found", async () => {
      const uniqueFact = makePersisted({
        id: "fact-unique-001",
        subjectId: "ent-totally-unique-99",
        predicate: "DESIGNED",
      });

      const result = await detectContradictions([uniqueFact], makeConfig(), db);

      expect(result.candidatesFound).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });
});

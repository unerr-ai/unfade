import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CozoDb } from "cozo-node";
import { createKnowledgeReader, type KnowledgeReader } from "../../../src/services/intelligence/knowledge-reader.js";
import {
  ENTITY_SCHEMA,
  ENTITY_ALIAS_SCHEMA,
  FACT_SCHEMA,
  COMPREHENSION_ASSESSMENT_SCHEMA,
  METACOGNITIVE_SIGNAL_SCHEMA,
} from "../../../src/services/substrate/schema.js";

// ─── Test Setup ─────────────────────────────────────────────────────────────

let cozo: CozoDb;
let reader: KnowledgeReader;

const ZERO_VEC_64 = `[${Array.from({ length: 64 }, () => "0.0").join(",")}]`;

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

beforeAll(async () => {
  cozo = new CozoDb("mem", "");
  await cozo.run(ENTITY_SCHEMA);
  await cozo.run(ENTITY_ALIAS_SCHEMA);
  await cozo.run(FACT_SCHEMA);
  await cozo.run(COMPREHENSION_ASSESSMENT_SCHEMA);
  await cozo.run(METACOGNITIVE_SIGNAL_SCHEMA);

  // Seed entities
  await cozo.run(
    `?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state, embedding] <- [
      ['ent-redis', 'technology', 'proj-1', 1714300000.0, 1714386000.0, 0.9, 'emerging', {"name":"Redis","normalizedName":"redis","mentionCount":5,"context":"caching","aliases":[]}, ${ZERO_VEC_64}],
      ['ent-pg', 'technology', 'proj-1', 1714300000.0, 1714370000.0, 0.85, 'emerging', {"name":"PostgreSQL","normalizedName":"postgresql","mentionCount":3,"context":"database","aliases":["postgres"]}, ${ZERO_VEC_64}],
      ['ent-auth', 'module', 'proj-1', 1714300000.0, 1714350000.0, 0.7, 'emerging', {"name":"auth module","normalizedName":"auth module","mentionCount":2,"context":"authentication","aliases":[]}, ${ZERO_VEC_64}]
    ]
    :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state, embedding}`,
  );

  // Seed facts
  await cozo.run(
    `?[id, subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method] <- [
      ['fact-1', 'ent-redis', 'USES', '', 'caching', 0.9, true, 'ongoing', 'Redis for caching', '2026-04-25T10:00:00Z', '', '2026-04-25T12:00:00Z', '', 'evt-001', '', 'llm'],
      ['fact-2', 'ent-pg', 'USES', '', 'data storage', 0.85, true, 'ongoing', 'PostgreSQL for storage', '2026-04-26T10:00:00Z', '', '2026-04-26T12:00:00Z', '', 'evt-002', '', 'llm'],
      ['fact-3', 'ent-auth', 'DECIDED', '', 'JWT', 0.8, true, 'ongoing', 'Decided to use JWT for auth', '2026-04-27T10:00:00Z', '', '2026-04-27T12:00:00Z', '', 'evt-003', '', 'llm'],
      ['fact-4', 'ent-auth', 'SWITCHED_FROM', '', 'session cookies', 0.75, true, 'supersedes_previous', 'Switched from session cookies', '2026-04-27T14:00:00Z', '', '2026-04-27T14:00:00Z', '', 'evt-004', '', 'llm'],
      ['fact-5', 'ent-redis', 'ADOPTED', '', 'ioredis', 0.7, true, 'ongoing', 'Adopted ioredis client', '2026-04-28T10:00:00Z', '2026-04-28T15:00:00Z', '2026-04-28T10:00:00Z', '2026-04-28T15:00:00Z', 'evt-005', '', 'llm']
    ]
    :put fact {id => subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method}`,
  );

  // Seed comprehension assessments
  await cozo.run(
    `?[episode_id, timestamp, steering, understanding, metacognition, independence, engagement, overall_score, rubber_stamp_count, pushback_count, assessment_method] <- [
      ['evt-001', '2026-04-25T10:00:00Z', 7.0, 8.0, 6.0, 5.0, 7.0, 68.0, 1, 3, 'llm'],
      ['evt-002', '2026-04-26T10:00:00Z', 5.0, 6.0, 4.0, 4.0, 5.0, 50.0, 2, 1, 'llm'],
      ['evt-003', '2026-04-27T10:00:00Z', 8.0, 9.0, 7.0, 6.0, 8.0, 78.0, 0, 4, 'llm']
    ]
    :put comprehension_assessment {episode_id => timestamp, steering, understanding, metacognition, independence, engagement, overall_score, rubber_stamp_count, pushback_count, assessment_method}`,
  );

  reader = createKnowledgeReader(cozo);
});

afterAll(() => {
  try { cozo.close(); } catch { /* */ }
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("knowledge-reader (KGI-1)", () => {
  describe("hasKnowledgeData", () => {
    it("returns true when facts and assessments exist", async () => {
      expect(await reader.hasKnowledgeData()).toBe(true);
    });

    it("returns false on empty graph", async () => {
      const emptyCozo = new CozoDb("mem", "");
      await emptyCozo.run(FACT_SCHEMA);
      await emptyCozo.run(COMPREHENSION_ASSESSMENT_SCHEMA);

      const emptyReader = createKnowledgeReader(emptyCozo);
      expect(await emptyReader.hasKnowledgeData()).toBe(false);

      emptyCozo.close();
    });
  });

  describe("getComprehension", () => {
    it("returns all assessments", async () => {
      const results = await reader.getComprehension({});
      expect(results.length).toBe(3);
      expect(results[0].episodeId).toBeTruthy();
      expect(results[0].steering).toBeGreaterThanOrEqual(0);
      expect(results[0].overallScore).toBeGreaterThanOrEqual(0);
    });

    it("filters by since date", async () => {
      const results = await reader.getComprehension({ since: "2026-04-27T00:00:00Z" });
      expect(results.length).toBe(1);
      expect(results[0].episodeId).toBe("evt-003");
    });

    it("returns empty array on error", async () => {
      const badCozo = new CozoDb("mem", "");
      const badReader = createKnowledgeReader(badCozo);
      const results = await badReader.getComprehension({});
      expect(results).toEqual([]);
      badCozo.close();
    });
  });

  describe("getFacts", () => {
    it("returns all active (non-invalidated) facts by default", async () => {
      const results = await reader.getFacts({});
      expect(results.length).toBe(4);
      const invalidated = results.find((f) => f.id === "fact-5");
      expect(invalidated).toBeUndefined();
    });

    it("includes invalidated facts when activeOnly=false", async () => {
      const results = await reader.getFacts({ activeOnly: false });
      expect(results.length).toBe(5);
    });

    it("filters by subject", async () => {
      const results = await reader.getFacts({ subject: "ent-redis" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every((f) => f.subjectId === "ent-redis")).toBe(true);
    });

    it("filters by predicate", async () => {
      const results = await reader.getFacts({ predicate: "USES" });
      expect(results.length).toBe(2);
      expect(results.every((f) => f.predicate === "USES")).toBe(true);
    });

    it("returns empty array when no matches", async () => {
      const results = await reader.getFacts({ subject: "nonexistent-entity" });
      expect(results).toEqual([]);
    });
  });

  describe("getDecisions", () => {
    it("returns only decision-predicate facts", async () => {
      const results = await reader.getDecisions({});
      expect(results.length).toBe(2);

      const predicates = results.map((r) => r.predicate);
      expect(predicates).toContain("DECIDED");
      expect(predicates).toContain("SWITCHED_FROM");
      expect(predicates).not.toContain("USES");
    });

    it("filters by since date", async () => {
      const results = await reader.getDecisions({ since: "2026-04-27T12:00:00Z" });
      expect(results.length).toBe(1);
      expect(results[0].predicate).toBe("SWITCHED_FROM");
    });
  });

  describe("getEntityEngagement", () => {
    it("returns all non-archived entities with names", async () => {
      const results = await reader.getEntityEngagement({});
      expect(results.length).toBe(3);
      expect(results.some((e) => e.name === "Redis")).toBe(true);
      expect(results.some((e) => e.name === "PostgreSQL")).toBe(true);
    });

    it("filters by minimum occurrences", async () => {
      const results = await reader.getEntityEngagement({ minOccurrences: 4 });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Redis");
      expect(results[0].mentionCount).toBe(5);
    });

    it("includes entity type and confidence", async () => {
      const results = await reader.getEntityEngagement({});
      const redis = results.find((e) => e.name === "Redis");
      expect(redis).toBeDefined();
      expect(redis!.type).toBe("technology");
      expect(redis!.confidence).toBe(0.9);
    });
  });

  describe("getDecayState", () => {
    it("returns empty array (decay lives in DuckDB, not CozoDB)", async () => {
      const results = await reader.getDecayState({});
      expect(results).toEqual([]);
    });
  });

  describe("null safety", () => {
    it("all methods return empty arrays on completely empty graph", async () => {
      const emptyCozo = new CozoDb("mem", "");
      await emptyCozo.run(ENTITY_SCHEMA);
      await emptyCozo.run(ENTITY_ALIAS_SCHEMA);
      await emptyCozo.run(FACT_SCHEMA);
      await emptyCozo.run(COMPREHENSION_ASSESSMENT_SCHEMA);
      await emptyCozo.run(METACOGNITIVE_SIGNAL_SCHEMA);

      const emptyReader = createKnowledgeReader(emptyCozo);

      expect(await emptyReader.getComprehension({})).toEqual([]);
      expect(await emptyReader.getFacts({})).toEqual([]);
      expect(await emptyReader.getDecisions({})).toEqual([]);
      expect(await emptyReader.getEntityEngagement({})).toEqual([]);
      expect(await emptyReader.getDecayState({})).toEqual([]);
      expect(await emptyReader.hasKnowledgeData()).toBe(false);

      emptyCozo.close();
    });
  });
});

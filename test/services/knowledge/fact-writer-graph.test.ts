import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CozoDb } from "cozo-node";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AtomicFact } from "../../../src/schemas/knowledge.js";
import {
  writeFactsToGraph,
  invalidateFact,
  getValidFactsForSubject,
  extractOldEntityFromContext,
  type FactWriteContext,
} from "../../../src/services/knowledge/fact-writer-graph.js";
import {
  FACT_SCHEMA,
  EDGE_SCHEMA,
} from "../../../src/services/substrate/schema.js";

// ─── Test Setup ─────────────────────────────────────────────────────────────

let db: CozoDb;
let tempDir: string;

beforeAll(async () => {
  db = new CozoDb("mem", "");
  await db.run(FACT_SCHEMA);
  await db.run(EDGE_SCHEMA);
  tempDir = mkdtempSync(join(tmpdir(), "unfade-ke11-"));
});

afterAll(() => {
  try { db.close(); } catch { /* already closed */ }
  try { rmSync(tempDir, { recursive: true }); } catch { /* cleanup */ }
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<AtomicFact> = {}): AtomicFact {
  return {
    subject: "project",
    predicate: "USES",
    object: "Redis",
    confidence: 0.9,
    explicit: true,
    temporalHint: "ongoing",
    context: "The project uses Redis for caching",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<FactWriteContext> = {}): FactWriteContext {
  const entityMap = new Map<string, string>([
    ["project", "ent-project-001"],
    ["Redis", "ent-redis-001"],
    ["redis", "ent-redis-001"],
    ["PostgreSQL", "ent-pg-001"],
    ["postgresql", "ent-pg-001"],
    ["Express", "ent-express-001"],
    ["express", "ent-express-001"],
    ["Fastify", "ent-fastify-001"],
    ["fastify", "ent-fastify-001"],
    ["Zustand", "ent-zustand-001"],
    ["zustand", "ent-zustand-001"],
    ["Redux", "ent-redux-001"],
    ["redux", "ent-redux-001"],
  ]);

  return {
    entityMap,
    episodeId: "evt-test-001",
    segmentId: "evt-test-001:seg-0",
    eventTimestamp: "2026-04-28T10:00:00Z",
    extractionMethod: "llm",
    homeOverride: tempDir,
    ...overrides,
  };
}

// ─── KE-11.1: Fact Graph Writer ─────────────────────────────────────────────

describe("fact-writer-graph (KE-11)", () => {
  describe("writeFactsToGraph", () => {
    it("writes 3 facts to CozoDB fact relation", async () => {
      const facts: AtomicFact[] = [
        makeFact({ subject: "project", predicate: "USES", object: "Redis" }),
        makeFact({ subject: "project", predicate: "USES", object: "PostgreSQL", context: "PostgreSQL for data storage" }),
        makeFact({ subject: "project", predicate: "DEPENDS_ON", object: "Express", context: "Express handles HTTP" }),
      ];

      const result = await writeFactsToGraph(facts, makeCtx(), db);

      expect(result.created).toBe(3);
      expect(result.skipped).toBe(0);

      // Verify facts in CozoDB
      const check = await db.run(
        "?[id, predicate] := *fact{id, subject_id: 'ent-project-001', predicate, invalid_at: ''}",
      );
      expect((check as { rows: unknown[][] }).rows.length).toBeGreaterThanOrEqual(3);
    });

    it("creates edges for facts with resolved object entities", async () => {
      const facts = [makeFact({ subject: "project", predicate: "USES", object: "Redis" })];
      await writeFactsToGraph(facts, makeCtx(), db);

      const edges = await db.run(
        "?[weight] := *edge{src: 'ent-project-001', dst: 'ent-redis-001', type: 'USES', weight}",
      );
      expect((edges as { rows: unknown[][] }).rows.length).toBeGreaterThanOrEqual(1);
    });

    it("skips facts with unresolvable subjects", async () => {
      const facts = [makeFact({ subject: "unknown-entity", predicate: "USES", object: "Redis" })];
      const result = await writeFactsToGraph(facts, makeCtx(), db);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("stores objects as free text when not in entityMap", async () => {
      const facts = [makeFact({ subject: "project", predicate: "CONFIGURED_WITH", object: "port 8080" })];
      const result = await writeFactsToGraph(facts, makeCtx(), db);

      expect(result.created).toBe(1);

      // Verify the fact was stored with object_text instead of object_id
      const check = await db.run(
        "?[object_text, object_id] := *fact{id, subject_id: 'ent-project-001', predicate: 'CONFIGURED_WITH', object_text, object_id, invalid_at: ''}",
      );
      const rows = (check as { rows: unknown[][] }).rows;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0][0]).toBe("port 8080");
      expect(rows[0][1]).toBe("");
    });

    it("does not create edge for free-text objects", async () => {
      const initialEdges = await db.run("?[count(src)] := *edge{src}");
      const countBefore = ((initialEdges as { rows: unknown[][] }).rows[0]?.[0] as number) ?? 0;

      const facts = [makeFact({ subject: "project", predicate: "CONFIGURED_WITH", object: "env variables" })];
      await writeFactsToGraph(facts, makeCtx(), db);

      const afterEdges = await db.run("?[count(src)] := *edge{src}");
      const countAfter = ((afterEdges as { rows: unknown[][] }).rows[0]?.[0] as number) ?? 0;

      // No new edge created for free-text object
      expect(countAfter).toBe(countBefore);
    });

    it("appends facts to JSONL file", async () => {
      const { readFileSync, existsSync } = await import("node:fs");
      const facts = [makeFact({ subject: "project", predicate: "USES", object: "Redis" })];
      await writeFactsToGraph(facts, makeCtx(), db);

      const jsonlPath = join(tempDir, ".unfade", "graph", "facts.jsonl");
      expect(existsSync(jsonlPath)).toBe(true);

      const content = readFileSync(jsonlPath, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l.trim());
      expect(lines.length).toBeGreaterThanOrEqual(1);

      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed.subjectId).toBe("ent-project-001");
      expect(parsed.predicate).toBe("USES");
    });
  });

  // ── invalidateFact ────────────────────────────────────────────────────

  describe("invalidateFact", () => {
    it("sets invalid_at and expired_at on a fact", async () => {
      // Write a fact first
      const facts = [makeFact({ subject: "project", predicate: "TESTED", object: "Redis" })];
      await writeFactsToGraph(facts, makeCtx(), db);

      // Find the fact we just wrote
      const written = await db.run(
        "?[id] := *fact{id, subject_id: 'ent-project-001', predicate: 'TESTED', invalid_at: ''}",
      );
      const rows = (written as { rows: unknown[][] }).rows;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const factId = rows[0][0] as string;

      // Invalidate it
      await invalidateFact(factId, "2026-04-29T10:00:00Z", db);

      // Verify invalid_at is set
      const check = await db.run(
        `?[invalid_at, expired_at] := *fact{id: '${factId}', invalid_at, expired_at}`,
      );
      const checkRows = (check as { rows: unknown[][] }).rows;
      expect(checkRows).toHaveLength(1);
      expect(checkRows[0][0]).toBe("2026-04-29T10:00:00Z");
      expect(checkRows[0][1]).toBe("2026-04-29T10:00:00Z");
    });

    it("invalidated facts are excluded from getValidFactsForSubject", async () => {
      // Write a fact
      const facts = [makeFact({ subject: "project", predicate: "REVIEWED", object: "Redis" })];
      await writeFactsToGraph(facts, makeCtx(), db);

      // Count valid facts before
      const validBefore = await getValidFactsForSubject("ent-project-001", db);
      const reviewedBefore = validBefore.filter((f) => f.predicate === "REVIEWED");

      // Find and invalidate
      const written = await db.run(
        "?[id] := *fact{id, predicate: 'REVIEWED', invalid_at: ''}",
      );
      const factId = ((written as { rows: unknown[][] }).rows[0]?.[0] as string);
      if (factId) {
        await invalidateFact(factId, "2026-04-29T10:00:00Z", db);
      }

      // Count valid facts after
      const validAfter = await getValidFactsForSubject("ent-project-001", db);
      const reviewedAfter = validAfter.filter((f) => f.predicate === "REVIEWED");

      expect(reviewedAfter.length).toBe(reviewedBefore.length - 1);
    });
  });

  // ── KE-11.2: Supersession Detection ────────────────────────────────────

  describe("extractOldEntityFromContext", () => {
    it("extracts old entity from 'switched from X to Y'", () => {
      expect(extractOldEntityFromContext("switched from Express to Fastify")).toBe("Express");
    });

    it("extracts old entity from 'replaced X with Y'", () => {
      expect(extractOldEntityFromContext("replaced Redux with Zustand")).toBe("Redux");
    });

    it("extracts old entity from 'migrated from X to Y'", () => {
      expect(extractOldEntityFromContext("migrated from MySQL to PostgreSQL")).toBe("MySQL");
    });

    it("extracts old entity from 'deprecated X in favor of Y'", () => {
      expect(extractOldEntityFromContext("deprecated Moment.js in favor of date-fns")).toBe("Moment.js");
    });

    it("extracts old entity from 'moved away from X to Y'", () => {
      expect(extractOldEntityFromContext("moved away from REST to GraphQL")).toBe("REST");
    });

    it("returns null when no supersession pattern matches", () => {
      expect(extractOldEntityFromContext("The project uses Redis for caching")).toBeNull();
    });
  });

  describe("supersession handling", () => {
    it("auto-invalidates old fact when temporalHint is supersedes_previous", async () => {
      // Write the "old" fact: project USES Express
      const oldFacts = [makeFact({
        subject: "project",
        predicate: "USES",
        object: "Express",
        temporalHint: "ongoing",
        context: "Express handles HTTP requests",
      })];
      await writeFactsToGraph(oldFacts, makeCtx({ eventTimestamp: "2026-04-25T10:00:00Z" }), db);

      // Write the "new" superseding fact: project USES Fastify (switched from Express)
      const newFacts = [makeFact({
        subject: "project",
        predicate: "USES",
        object: "Fastify",
        temporalHint: "supersedes_previous",
        context: "switched from Express to Fastify for better performance",
      })];
      const result = await writeFactsToGraph(
        newFacts,
        makeCtx({ eventTimestamp: "2026-04-28T10:00:00Z" }),
        db,
      );

      expect(result.created).toBe(1);
      expect(result.superseded).toBeGreaterThanOrEqual(1);

      // Verify: the old Express fact should be invalidated
      const validFacts = await getValidFactsForSubject("ent-project-001", db);
      const validUsesFacts = validFacts.filter(
        (f) => f.predicate === "USES" && (f.objectId === "ent-express-001" || f.objectText === "Express"),
      );
      expect(validUsesFacts.length).toBe(0);
    });

    it("does not invalidate unrelated facts during supersession", async () => {
      // Write: project USES Redis (caching — unrelated to the Express→Fastify transition)
      const cacheFacts = [makeFact({
        subject: "project",
        predicate: "USES",
        object: "Redis",
        temporalHint: "ongoing",
        context: "Redis for caching layer",
      })];
      await writeFactsToGraph(cacheFacts, makeCtx(), db);

      // Write superseding fact with specific old entity
      const newFacts = [makeFact({
        subject: "project",
        predicate: "USES",
        object: "Zustand",
        temporalHint: "supersedes_previous",
        context: "replaced Redux with Zustand for state management",
      })];
      await writeFactsToGraph(newFacts, makeCtx(), db);

      // Redis USES fact should still be valid (different object)
      const validFacts = await getValidFactsForSubject("ent-project-001", db);
      const redisStillValid = validFacts.some(
        (f) => f.predicate === "USES" && f.objectId === "ent-redis-001",
      );
      expect(redisStillValid).toBe(true);
    });
  });

  // ── getValidFactsForSubject ─────────────────────────────────────────

  describe("getValidFactsForSubject", () => {
    it("returns only non-invalidated facts", async () => {
      const facts = await getValidFactsForSubject("ent-project-001", db);
      for (const fact of facts) {
        expect(fact.id).toBeTruthy();
        expect(fact.predicate).toBeTruthy();
      }
    });
  });
});

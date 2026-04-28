import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CozoDb } from "cozo-node";
import type { ExtractedEntity } from "../../../src/schemas/knowledge.js";
import {
  writeEntitiesToGraph,
  findEntityByNormalizedName,
  findEntityByAlias,
  getAllEntityNames,
  type ResolvedEntity,
} from "../../../src/services/knowledge/entity-writer.js";
import {
  ENTITY_SCHEMA,
  ENTITY_ALIAS_SCHEMA,
} from "../../../src/services/substrate/schema.js";

// ─── Test Setup: In-Memory CozoDB ───────────────────────────────────────────

let db: CozoDb;

beforeAll(async () => {
  db = new CozoDb("mem", "");
  // Create only the relations we need for entity-writer tests
  await db.run(ENTITY_SCHEMA);
  await db.run(ENTITY_ALIAS_SCHEMA);
});

afterAll(() => {
  try {
    db.close();
  } catch {
    // already closed
  }
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeExtracted(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    name: "Redis",
    normalizedName: "redis",
    type: "technology",
    context: "Used for caching",
    confidence: 0.9,
    aliases: ["cache layer"],
    ...overrides,
  };
}

function makeResolved(overrides: Partial<ResolvedEntity> = {}): ResolvedEntity {
  return {
    id: "ent-redis-001",
    isNew: true,
    matchMethod: "new",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("entity-writer (KE-9.2)", () => {
  describe("writeEntitiesToGraph", () => {
    it("creates new entities in CozoDB", async () => {
      const resolved: ResolvedEntity[] = [
        makeResolved({ id: "ent-redis-test1", isNew: true, matchMethod: "new" }),
        makeResolved({ id: "ent-pg-test1", isNew: true, matchMethod: "new" }),
      ];
      const extracted: ExtractedEntity[] = [
        makeExtracted({ name: "Redis", normalizedName: "redis", type: "technology", confidence: 0.9 }),
        makeExtracted({ name: "PostgreSQL", normalizedName: "postgresql", type: "technology", confidence: 0.85, aliases: ["postgres", "pg"] }),
      ];

      const result = await writeEntitiesToGraph(resolved, extracted, "evt-001", "proj-test", db);

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);

      // Verify entities exist in CozoDB (use variable binding — CozoDB can't have literals in head)
      const check1 = await db.run("?[type, confidence] := *entity{id: 'ent-redis-test1', type, confidence}");
      expect((check1 as { rows: unknown[][] }).rows).toHaveLength(1);
      expect((check1 as { rows: unknown[][] }).rows[0][0]).toBe("technology");

      const check2 = await db.run("?[type] := *entity{id: 'ent-pg-test1', type}");
      expect((check2 as { rows: unknown[][] }).rows).toHaveLength(1);
    });

    it("updates existing entities (bumps mentionCount, takes max confidence)", async () => {
      // First write — create the entity
      await writeEntitiesToGraph(
        [makeResolved({ id: "ent-update-test1", isNew: true })],
        [makeExtracted({ name: "Express", normalizedName: "express", confidence: 0.7 })],
        "evt-002",
        "proj-test",
        db,
      );

      // Second write — update with higher confidence
      const result = await writeEntitiesToGraph(
        [makeResolved({ id: "ent-update-test1", isNew: false, matchMethod: "exact" })],
        [makeExtracted({ name: "Express", normalizedName: "express", confidence: 0.95, context: "Web framework for Node.js" })],
        "evt-003",
        "proj-test",
        db,
      );

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);

      // Verify confidence is max(0.7, 0.95) = 0.95
      const check = await db.run("?[confidence, state] := *entity{id: 'ent-update-test1', confidence, state}");
      const rows = (check as { rows: unknown[][] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe(0.95);

      // Verify mentionCount incremented
      const state = typeof rows[0][1] === "string" ? JSON.parse(rows[0][1]) : rows[0][1];
      expect(state.mentionCount).toBe(2);
    });

    it("writes aliases to entity_alias relation", async () => {
      await writeEntitiesToGraph(
        [makeResolved({ id: "ent-alias-test1", isNew: true, mergedAliases: ["cache-db"] })],
        [makeExtracted({ name: "Redis", normalizedName: "redis", aliases: ["cache layer"] })],
        "evt-004",
        "proj-test",
        db,
      );

      // Check aliases exist
      const aliases = await db.run("?[alias] := *entity_alias{entity_id: 'ent-alias-test1', alias}");
      const aliasRows = (aliases as { rows: unknown[][] }).rows;
      const aliasValues = aliasRows.map((r) => r[0] as string).sort();

      expect(aliasValues).toContain("redis");
      expect(aliasValues).toContain("cache layer");
      expect(aliasValues).toContain("cache-db");
    });

    it("throws on resolved/extracted length mismatch", async () => {
      await expect(
        writeEntitiesToGraph(
          [makeResolved()],
          [makeExtracted(), makeExtracted()],
          "evt-005",
          "proj-test",
          db,
        ),
      ).rejects.toThrow("length mismatch");
    });

    it("handles mixed create + update batch", async () => {
      // Pre-create one entity
      await writeEntitiesToGraph(
        [makeResolved({ id: "ent-mix-existing", isNew: true })],
        [makeExtracted({ name: "Fastify", normalizedName: "fastify", confidence: 0.8 })],
        "evt-006",
        "proj-test",
        db,
      );

      // Batch: 1 existing + 1 new
      const result = await writeEntitiesToGraph(
        [
          makeResolved({ id: "ent-mix-existing", isNew: false, matchMethod: "exact" }),
          makeResolved({ id: "ent-mix-new", isNew: true, matchMethod: "new" }),
        ],
        [
          makeExtracted({ name: "Fastify", normalizedName: "fastify", confidence: 0.9 }),
          makeExtracted({ name: "Hono", normalizedName: "hono", confidence: 0.75, aliases: [] }),
        ],
        "evt-007",
        "proj-test",
        db,
      );

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
    });
  });

  // ── Query Helpers ─────────────────────────────────────────────────────

  describe("findEntityByAlias", () => {
    it("finds entity by alias", async () => {
      // ent-alias-test1 was created above with alias "cache layer"
      const found = await findEntityByAlias(db, "cache layer");
      expect(found).toBe("ent-alias-test1");
    });

    it("returns null for unknown alias", () => {
      return expect(findEntityByAlias(db, "nonexistent-alias")).resolves.toBeNull();
    });
  });

  describe("getAllEntityNames", () => {
    it("returns all entity names", async () => {
      const names = await getAllEntityNames(db);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("Redis");
    });
  });
});

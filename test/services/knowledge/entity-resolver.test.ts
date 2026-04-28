import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CozoDb } from "cozo-node";
import type { ExtractedEntity } from "../../../src/schemas/knowledge.js";
import { resolveEntities } from "../../../src/services/knowledge/entity-resolver.js";
import { writeEntitiesToGraph, type ResolvedEntity } from "../../../src/services/knowledge/entity-writer.js";
import {
  ENTITY_SCHEMA,
  ENTITY_ALIAS_SCHEMA,
} from "../../../src/services/substrate/schema.js";

// ─── Test Setup: In-Memory CozoDB ───────────────────────────────────────────

let db: CozoDb;

beforeAll(async () => {
  db = new CozoDb("mem", "");
  await db.run(ENTITY_SCHEMA);
  await db.run(ENTITY_ALIAS_SCHEMA);

  // Seed the graph with known entities for resolution tests
  await writeEntitiesToGraph(
    [
      { id: "ent-redis-seed", isNew: true, matchMethod: "new" },
      { id: "ent-react-hooks-seed", isNew: true, matchMethod: "new" },
      { id: "ent-express-seed", isNew: true, matchMethod: "new", mergedAliases: ["expressjs", "express.js"] },
    ],
    [
      makeExtracted({ name: "Redis", normalizedName: "redis", type: "technology", confidence: 0.9, aliases: ["cache layer"] }),
      makeExtracted({ name: "React Hooks", normalizedName: "react hooks", type: "pattern", confidence: 0.85, aliases: ["hooks", "useeffect"] }),
      makeExtracted({ name: "Express", normalizedName: "express", type: "library", confidence: 0.8, aliases: ["express.js", "expressjs"] }),
    ],
    "evt-seed",
    "proj-test",
    db,
  );
});

afterAll(() => {
  try { db.close(); } catch { /* already closed */ }
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeExtracted(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    name: "Test Entity",
    normalizedName: "test entity",
    type: "technology",
    context: "Used for testing",
    confidence: 0.8,
    aliases: [],
    ...overrides,
  };
}

// ─── Pass 1: Exact Normalized Name Match ────────────────────────────────────

describe("entity-resolver (KE-10.1)", () => {
  describe("Pass 1: Exact match", () => {
    it("resolves known entity 'Redis' via exact name match", async () => {
      const extracted = [makeExtracted({ name: "Redis", normalizedName: "redis" })];
      const results = await resolveEntities(extracted, db);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("ent-redis-seed");
      expect(results[0].isNew).toBe(false);
      expect(results[0].matchMethod).toBe("exact");
    });

    it("resolves 'react hooks' (case-insensitive) to existing 'React Hooks'", async () => {
      const extracted = [makeExtracted({ name: "react hooks", normalizedName: "react hooks" })];
      const results = await resolveEntities(extracted, db);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("ent-react-hooks-seed");
      expect(results[0].isNew).toBe(false);
      expect(results[0].matchMethod).toBe("exact");
    });

    it("resolves 'React Hooks' with version ('React Hooks 18') after stripping version", async () => {
      const extracted = [makeExtracted({ name: "React Hooks 18", normalizedName: "react hooks" })];
      const results = await resolveEntities(extracted, db);

      expect(results[0].id).toBe("ent-react-hooks-seed");
      expect(results[0].matchMethod).toBe("exact");
    });
  });

  // ── Pass 2: Alias Match ─────────────────────────────────────────────────

  describe("Pass 2: Alias match", () => {
    it("resolves entity via known alias in entity_alias table", async () => {
      // "hooks" is a known alias of "React Hooks" (seeded in beforeAll)
      const extracted = [makeExtracted({ name: "hooks", normalizedName: "hooks" })];
      const results = await resolveEntities(extracted, db);

      expect(results[0].isNew).toBe(false);
      expect(results[0].id).toBe("ent-react-hooks-seed");
      expect(results[0].matchMethod).toBe("alias");
    });

    it("resolves via extracted alias matching existing canonical name", async () => {
      // Unknown entity "caching tool" but with alias "redis" that matches existing canonical name
      const extracted = [makeExtracted({
        name: "caching tool",
        normalizedName: "caching tool",
        aliases: ["redis"],
      })];
      const results = await resolveEntities(extracted, db);

      expect(results[0].isNew).toBe(false);
      expect(results[0].id).toBe("ent-redis-seed");
      expect(results[0].matchMethod).toBe("alias");
    });

    it("resolves via extracted alias found in alias table", async () => {
      // Unknown entity "server framework" with alias "expressjs" — "expressjs" is in alias table
      const extracted = [makeExtracted({
        name: "server framework",
        normalizedName: "server framework",
        aliases: ["expressjs"],
      })];
      const results = await resolveEntities(extracted, db);

      expect(results[0].isNew).toBe(false);
      expect(results[0].id).toBe("ent-express-seed");
      expect(results[0].matchMethod).toBe("alias");
    });
  });

  // ── New Entity Creation ─────────────────────────────────────────────────

  describe("New entity creation", () => {
    it("creates new entity for unknown 'Drizzle ORM'", async () => {
      const extracted = [makeExtracted({ name: "Drizzle ORM", normalizedName: "drizzle orm" })];
      const results = await resolveEntities(extracted, db);

      expect(results).toHaveLength(1);
      expect(results[0].isNew).toBe(true);
      expect(results[0].matchMethod).toBe("new");
      expect(results[0].id).toMatch(/^ke-/);
    });

    it("assigns UUID with ke- prefix for new entities", async () => {
      const extracted = [makeExtracted({ name: "Vitest", normalizedName: "vitest" })];
      const results = await resolveEntities(extracted, db);

      expect(results[0].id).toMatch(/^ke-[0-9a-f-]{36}$/);
    });

    it("handles empty entity name gracefully", async () => {
      const extracted = [makeExtracted({ name: "", normalizedName: "" })];
      const results = await resolveEntities(extracted, db);

      expect(results[0].isNew).toBe(true);
      expect(results[0].matchMethod).toBe("new");
    });
  });

  // ── Within-Batch Deduplication ──────────────────────────────────────────

  describe("Within-batch deduplication", () => {
    it("resolves 'Redis' and 'redis' to the same entity", async () => {
      const extracted = [
        makeExtracted({ name: "Redis", normalizedName: "redis" }),
        makeExtracted({ name: "redis", normalizedName: "redis" }),
      ];
      const results = await resolveEntities(extracted, db);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe(results[1].id);
      expect(results[0].id).toBe("ent-redis-seed");
    });

    it("deduplicates unknown entities in the same batch", async () => {
      const extracted = [
        makeExtracted({ name: "SvelteKit", normalizedName: "sveltekit" }),
        makeExtracted({ name: "sveltekit", normalizedName: "sveltekit" }),
        makeExtracted({ name: "SvelteKit 2", normalizedName: "sveltekit" }),
      ];
      const results = await resolveEntities(extracted, db);

      expect(results[0].id).toBe(results[1].id);
      expect(results[1].id).toBe(results[2].id);
      expect(results[0].isNew).toBe(true);
      expect(results[0].matchMethod).toBe("new");
    });

    it("merges aliases from batch group into new entity", async () => {
      const extracted = [
        makeExtracted({ name: "Bun", normalizedName: "bun", aliases: ["bun runtime"] }),
        makeExtracted({ name: "bun", normalizedName: "bun", aliases: ["bun.js"] }),
      ];
      const results = await resolveEntities(extracted, db);

      expect(results[0].mergedAliases).toBeDefined();
      const aliases = results[0].mergedAliases ?? [];
      expect(aliases).toContain("bun runtime");
      expect(aliases).toContain("bun.js");
    });
  });

  // ── Mixed Batch Resolution ──────────────────────────────────────────────

  describe("Mixed batch", () => {
    it("resolves a batch with known, alias, and unknown entities", async () => {
      const extracted = [
        makeExtracted({ name: "Redis", normalizedName: "redis" }),
        makeExtracted({ name: "hooks", normalizedName: "hooks" }),
        makeExtracted({ name: "Turso", normalizedName: "turso" }),
      ];
      const results = await resolveEntities(extracted, db);

      expect(results).toHaveLength(3);
      // Redis → exact match
      expect(results[0].isNew).toBe(false);
      expect(results[0].matchMethod).toBe("exact");

      // hooks → alias match (alias of React Hooks)
      expect(results[1].isNew).toBe(false);
      expect(results[1].matchMethod).toBe("alias");

      // Turso → new entity
      expect(results[2].isNew).toBe(true);
      expect(results[2].matchMethod).toBe("new");
    });
  });

  // ── Pass 3: Embedding Similarity (Optional) ────────────────────────────

  describe("Pass 3: Embedding match", () => {
    it("skips embedding pass when no embedFn is provided", async () => {
      const extracted = [makeExtracted({ name: "unknown thing", normalizedName: "unknown thing" })];
      const results = await resolveEntities(extracted, db);

      expect(results[0].isNew).toBe(true);
      expect(results[0].matchMethod).toBe("new");
    });

    it("calls embedFn for unresolved entities when provided", async () => {
      const embedFn = vi.fn().mockResolvedValue(Array.from({ length: 64 }, () => 0.1));

      const extracted = [makeExtracted({ name: "mystery entity", normalizedName: "mystery entity" })];
      const results = await resolveEntities(extracted, db, embedFn);

      expect(embedFn).toHaveBeenCalledWith("mystery entity");
      // HNSW search likely returns no results (zero-vector entities) → still new
      expect(results[0].isNew).toBe(true);
    });

    it("does not call embedFn for entities resolved in earlier passes", async () => {
      const embedFn = vi.fn().mockResolvedValue(Array.from({ length: 64 }, () => 0.1));

      const extracted = [makeExtracted({ name: "Redis", normalizedName: "redis" })];
      const results = await resolveEntities(extracted, db, embedFn);

      expect(embedFn).not.toHaveBeenCalled();
      expect(results[0].matchMethod).toBe("exact");
    });

    it("handles embedFn errors gracefully", async () => {
      const embedFn = vi.fn().mockRejectedValue(new Error("Embedding service unavailable"));

      const extracted = [makeExtracted({ name: "broken embed", normalizedName: "broken embed" })];
      const results = await resolveEntities(extracted, db, embedFn);

      expect(results[0].isNew).toBe(true);
      expect(results[0].matchMethod).toBe("new");
    });

    it("handles empty embedding result gracefully", async () => {
      const embedFn = vi.fn().mockResolvedValue([]);

      const extracted = [makeExtracted({ name: "no embed", normalizedName: "no embed" })];
      const results = await resolveEntities(extracted, db, embedFn);

      expect(results[0].isNew).toBe(true);
    });
  });

  // ── Options ─────────────────────────────────────────────────────────────

  describe("options", () => {
    it("accepts projectId option for scoped resolution", async () => {
      const extracted = [makeExtracted({ name: "Redis", normalizedName: "redis" })];
      const results = await resolveEntities(extracted, db, undefined, {
        projectId: "proj-test",
      });

      expect(results[0].isNew).toBe(false);
      expect(results[0].id).toBe("ent-redis-seed");
    });
  });
});

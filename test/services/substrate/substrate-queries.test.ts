import { describe, expect, it, vi } from "vitest";
import {
  SubstrateEngine,
  type EntityContribution,
  type EntityWithEvidence,
} from "../../../src/services/substrate/substrate-engine.js";

// ─── Mock CozoDB ─────────────────────────────────────────────────────────────
// Simulates CozoDB's run() method with pattern-matched Datalog query responses.

function createMockDb(
  queryResponses: Map<string, { headers: string[]; rows: unknown[][] }> = new Map(),
) {
  return {
    run: vi.fn().mockImplementation(async (datalog: string) => {
      for (const [pattern, response] of queryResponses) {
        if (datalog.includes(pattern)) return response;
      }
      return { headers: [], rows: [] };
    }),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function entityRows(
  entities: Array<{ id: string; type: string; state: Record<string, unknown>; confidence: number }>,
): { headers: string[]; rows: unknown[][] } {
  return {
    headers: ["id", "type", "state", "confidence"],
    rows: entities.map((e) => [e.id, e.type, JSON.stringify(e.state), e.confidence]),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SubstrateEngine — SubstrateQueries (IP-7)", () => {
  describe("entitiesByDomain()", () => {
    it("returns entities matching domain, ordered by engagement", async () => {
      const responses = new Map([
        ["is_in(state", entityRows([
          { id: "ent-auth-jwt", type: "technology", state: { name: "JWT", domain: "auth", mentionCount: 10 }, confidence: 0.8 },
          { id: "ent-auth-session", type: "technology", state: { name: "Sessions", domain: "auth", mentionCount: 5 }, confidence: 0.6 },
          { id: "ent-db-pg", type: "technology", state: { name: "PostgreSQL", domain: "database", mentionCount: 15 }, confidence: 0.9 },
        ])],
        ["*fact{subject_id", { headers: ["episode"], rows: [["evt-fact-1"], ["evt-fact-2"]] }],
        ["*fact{object_id", { headers: ["episode"], rows: [] }],
      ]);

      const db = createMockDb(responses);
      const engine = new SubstrateEngine(db as any);
      const results = await engine.entitiesByDomain("auth");

      expect(results.length).toBe(2);
      expect(results[0].name).toBe("JWT");
      expect(results[0].engagement).toBe(10);
      expect(results[1].name).toBe("Sessions");
      expect(results.every((r) => r.domain === "auth")).toBe(true);
    });

    it("returns entities with evidenceEventIds from fact relation", async () => {
      const responses = new Map([
        ["is_in(state", entityRows([
          { id: "ent-auth-jwt", type: "technology", state: { name: "JWT", domain: "auth", mentionCount: 5 }, confidence: 0.8 },
        ])],
        ["*fact{subject_id", { headers: ["episode"], rows: [["evt-session-1"], ["evt-session-2"]] }],
        ["*fact{object_id", { headers: ["episode"], rows: [["evt-session-3"]] }],
      ]);

      const db = createMockDb(responses);
      const engine = new SubstrateEngine(db as any);
      const results = await engine.entitiesByDomain("auth");

      expect(results.length).toBe(1);
      expect(results[0].evidenceEventIds).toContain("evt-session-1");
      expect(results[0].evidenceEventIds).toContain("evt-session-2");
      expect(results[0].evidenceEventIds).toContain("evt-session-3");
    });

    it("returns empty array when no entities match domain", async () => {
      const responses = new Map([
        ["is_in(state", entityRows([
          { id: "ent-db-pg", type: "technology", state: { name: "PostgreSQL", domain: "database" }, confidence: 0.9 },
        ])],
      ]);

      const db = createMockDb(responses);
      const engine = new SubstrateEngine(db as any);
      const results = await engine.entitiesByDomain("nonexistent");

      expect(results).toEqual([]);
    });

    it("returns empty array for empty graph", async () => {
      const db = createMockDb(new Map());
      const engine = new SubstrateEngine(db as any);
      const results = await engine.entitiesByDomain("auth");

      expect(results).toEqual([]);
    });
  });

  describe("findPath()", () => {
    it("returns path between connected entities", async () => {
      const responses = new Map([
        ["node = 'ent-b'", { headers: ["node", "dist", "prev"], rows: [["ent-b", 1, "ent-a"]] }],
        ["path[src, d1]", {
          headers: ["src", "dst", "type", "weight"],
          rows: [["ent-a", "ent-b", "USES", 0.8]],
        }],
      ]);

      const db = createMockDb(responses);
      const engine = new SubstrateEngine(db as any);
      const path = await engine.findPath("ent-a", "ent-b");

      expect(path).not.toBeNull();
      expect(path!.nodes).toContain("ent-a");
      expect(path!.nodes).toContain("ent-b");
      expect(path!.edges.length).toBe(1);
      expect(path!.edges[0].type).toBe("USES");
      expect(path!.length).toBe(1);
    });

    it("returns null for disconnected entities", async () => {
      const db = createMockDb(new Map());
      const engine = new SubstrateEngine(db as any);
      const path = await engine.findPath("ent-isolated-1", "ent-isolated-2");

      expect(path).toBeNull();
    });

    it("returns null when path query finds node but no edges", async () => {
      const responses = new Map([
        ["node = 'ent-b'", { headers: ["node", "dist", "prev"], rows: [["ent-b", 1, "ent-a"]] }],
        ["path[src, d1]", { headers: ["src", "dst", "type", "weight"], rows: [] }],
      ]);

      const db = createMockDb(responses);
      const engine = new SubstrateEngine(db as any);
      const path = await engine.findPath("ent-a", "ent-b");

      expect(path).toBeNull();
    });
  });

  describe("hubEntities()", () => {
    it("returns entities ordered by degree centrality", async () => {
      const responses = new Map([
        ["degree[id, cnt]", {
          headers: ["id", "type", "state", "confidence", "deg"],
          rows: [
            ["ent-hub-1", "feature", JSON.stringify({ name: "Auth Module", domain: "auth" }), 0.9, 15],
            ["ent-hub-2", "technology", JSON.stringify({ name: "PostgreSQL", domain: "database" }), 0.8, 8],
          ],
        }],
      ]);

      const db = createMockDb(responses);
      const engine = new SubstrateEngine(db as any);
      const hubs = await engine.hubEntities(5);

      expect(hubs.length).toBe(2);
      expect(hubs[0].name).toBe("Auth Module");
      expect(hubs[0].engagement).toBe(15);
      expect(hubs[1].engagement).toBe(8);
    });

    it("returns empty array for empty graph", async () => {
      const db = createMockDb(new Map());
      const engine = new SubstrateEngine(db as any);
      const hubs = await engine.hubEntities();

      expect(hubs).toEqual([]);
    });
  });

  describe("crossValidatedEntities()", () => {
    it("returns entities with 2+ source analyzers", async () => {
      const responses = new Map([
        ["multi_source[id, source_count]", {
          headers: ["id", "type", "state", "confidence", "source_count"],
          rows: [
            ["ent-cross-1", "feature", JSON.stringify({ name: "Auth", domain: "auth", evidenceEventIds: ["evt-1", "evt-2"] }), 0.85, 3],
          ],
        }],
      ]);

      const db = createMockDb(responses);
      const engine = new SubstrateEngine(db as any);
      const results = await engine.crossValidatedEntities();

      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Auth");
      expect(results[0].engagement).toBe(3);
      expect(results[0].evidenceEventIds).toEqual(["evt-1", "evt-2"]);
    });

    it("returns empty array when no multi-source entities", async () => {
      const db = createMockDb(new Map());
      const engine = new SubstrateEngine(db as any);
      const results = await engine.crossValidatedEntities();

      expect(results).toEqual([]);
    });
  });

  describe("EntityContribution.evidenceEventIds (IP-7.2)", () => {
    it("merges evidenceEventIds into entity state during ingest", async () => {
      const capturedPuts: string[] = [];
      const db = {
        run: vi.fn().mockImplementation(async (datalog: string) => {
          if (datalog.includes(":put")) capturedPuts.push(datalog);
          return { headers: [], rows: [] };
        }),
      };

      const engine = new SubstrateEngine(db as any);
      const contributions: EntityContribution[] = [
        {
          entityId: "ent-test",
          entityType: "work-unit",
          projectId: "proj-1",
          analyzerName: "efficiency",
          stateFragment: { aes: 75 },
          relationships: [],
          evidenceEventIds: ["evt-a", "evt-b"],
        },
      ];

      await engine.ingest(contributions);

      const entityPut = capturedPuts.find((p) => p.includes(":put entity"));
      expect(entityPut).toBeDefined();
      expect(entityPut).toContain("evt-a");
      expect(entityPut).toContain("evt-b");
    });

    it("deduplicates evidenceEventIds from multiple contributions for same entity", async () => {
      const capturedPuts: string[] = [];
      const db = {
        run: vi.fn().mockImplementation(async (datalog: string) => {
          if (datalog.includes(":put")) capturedPuts.push(datalog);
          return { headers: [], rows: [] };
        }),
      };

      const engine = new SubstrateEngine(db as any);
      const contributions: EntityContribution[] = [
        {
          entityId: "ent-shared",
          entityType: "feature",
          projectId: "proj-1",
          analyzerName: "efficiency",
          stateFragment: { aes: 60 },
          relationships: [],
          evidenceEventIds: ["evt-1", "evt-2"],
        },
        {
          entityId: "ent-shared",
          entityType: "feature",
          projectId: "proj-1",
          analyzerName: "comprehension-radar",
          stateFragment: { comprehension: 0.7 },
          relationships: [],
          evidenceEventIds: ["evt-2", "evt-3"],
        },
      ];

      await engine.ingest(contributions);

      const entityPut = capturedPuts.find((p) => p.includes(":put entity") && p.includes("ent-shared"));
      expect(entityPut).toBeDefined();
      expect(entityPut).toContain("evt-1");
      expect(entityPut).toContain("evt-2");
      expect(entityPut).toContain("evt-3");
    });
  });

  describe("query()", () => {
    it("returns results from CozoDB", async () => {
      const db = createMockDb(new Map([
        ["*entity", { headers: ["id"], rows: [["ent-1"], ["ent-2"]] }],
      ]));
      const engine = new SubstrateEngine(db as any);
      const result = await engine.query("?[id] := *entity{id}");

      expect(result.rows.length).toBe(2);
    });

    it("returns empty result on error", async () => {
      const db = {
        run: vi.fn().mockRejectedValue(new Error("Datalog syntax error")),
      };
      const engine = new SubstrateEngine(db as any);
      const result = await engine.query("invalid datalog");

      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  storeSegments,
  loadSegments,
} from "../../../src/services/knowledge/segment-storage.js";
import type { ConversationSegment } from "../../../src/schemas/knowledge.js";

/** Create a minimal ConversationSegment for testing. */
function makeSegment(overrides: Partial<ConversationSegment> = {}): ConversationSegment {
  return {
    segmentId: "evt-001:seg-0",
    episodeId: "evt-001",
    turnRange: [0, 5],
    topicLabel: "src/auth",
    summary: "Fix auth middleware",
    filesInScope: ["src/auth/login.ts", "src/auth/session.ts"],
    modulesInScope: ["src/auth"],
    segmentMethod: "structural",
    ...overrides,
  };
}

/** Minimal mock for DuckDB-style DbLike that tracks SQL calls. */
function mockDuckDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    db: {
      run(_sql: string, _params?: unknown[]) {},
      exec(sql: string, params?: unknown[]) {
        calls.push({ sql, params: params ?? [] });
        return Promise.resolve([{ columns: [], values: [] }]);
      },
    },
    calls,
  };
}

/** Minimal mock for SQLite-style DbLike that stores data in memory. */
function mockSqliteDb() {
  const rows: Array<{ sql: string; params: unknown[] }> = [];
  const storedRows: unknown[][] = [];

  return {
    db: {
      run(sql: string, params?: unknown[]) {
        rows.push({ sql, params: params ?? [] });
        // Simulate storing the row for INSERT operations
        if (sql.includes("INSERT")) {
          storedRows.push(params ?? []);
        }
      },
      exec(sql: string, params?: unknown[]) {
        rows.push({ sql, params: params ?? [] });
        if (sql.includes("SELECT")) {
          // Return stored segment data for loadSegments queries
          return Promise.resolve([{
            columns: ["segment_id", "turn_start", "turn_end", "topic_label", "summary", "files_in_scope", "modules_in_scope", "segment_method"],
            values: storedRows.map((r) => [
              r[2],  // segment_id
              r[3],  // turn_start
              r[4],  // turn_end
              r[5],  // topic_label
              r[6],  // summary
              r[7],  // files_in_scope (JSON string)
              r[8],  // modules_in_scope (JSON string)
              r[9],  // segment_method
            ]),
          }]);
        }
        return Promise.resolve([{ columns: [], values: [] }]);
      },
    },
    rows,
    storedRows,
  };
}

describe("segment-storage (KE-6.2)", () => {
  // ── storeSegments ──────────────────────────────────────────────────────────

  it("writes segments to both DuckDB and SQLite", async () => {
    const { db: duckDb, calls: duckCalls } = mockDuckDb();
    const { db: sqliteDb, rows: sqliteRows } = mockSqliteDb();

    const segments = [
      makeSegment({ segmentId: "evt-001:seg-0", turnRange: [0, 5] }),
      makeSegment({ segmentId: "evt-001:seg-6", turnRange: [6, 12], topicLabel: "lib/database" }),
    ];

    await storeSegments("evt-001", segments, duckDb, sqliteDb);

    // DuckDB: 1 DELETE + 2 INSERTs + 1 UPDATE (segments JSON column)
    expect(duckCalls).toHaveLength(4);
    expect(duckCalls[0].sql).toContain("DELETE");
    expect(duckCalls[1].sql).toContain("INSERT INTO event_segments");
    expect(duckCalls[2].sql).toContain("INSERT INTO event_segments");
    expect(duckCalls[3].sql).toContain("UPDATE events SET segments");

    // SQLite: 1 DELETE + 2 INSERTs
    const sqliteInserts = sqliteRows.filter((r) => r.sql.includes("INSERT"));
    expect(sqliteInserts).toHaveLength(2);
  });

  it("no-ops on empty segments array", async () => {
    const { db: duckDb, calls: duckCalls } = mockDuckDb();
    const { db: sqliteDb, rows: sqliteRows } = mockSqliteDb();

    await storeSegments("evt-001", [], duckDb, sqliteDb);

    expect(duckCalls).toHaveLength(0);
    expect(sqliteRows).toHaveLength(0);
  });

  it("deletes existing segments before inserting (idempotent)", async () => {
    const { db: duckDb, calls: duckCalls } = mockDuckDb();
    const { db: sqliteDb, rows: sqliteRows } = mockSqliteDb();

    const segments = [makeSegment()];
    await storeSegments("evt-001", segments, duckDb, sqliteDb);

    // DuckDB first call is DELETE
    expect(duckCalls[0].sql).toContain("DELETE FROM event_segments WHERE event_id");
    expect(duckCalls[0].params).toEqual(["evt-001"]);

    // SQLite first call is DELETE
    expect(sqliteRows[0].sql).toContain("DELETE FROM event_segments WHERE event_id");
  });

  it("passes correct params to DuckDB INSERT", async () => {
    const { db: duckDb, calls } = mockDuckDb();
    const { db: sqliteDb } = mockSqliteDb();

    const seg = makeSegment({
      segmentId: "evt-002:seg-0",
      turnRange: [0, 10],
      topicLabel: "auth module",
      summary: "Fixed auth bugs",
      filesInScope: ["src/auth.ts"],
      modulesInScope: ["src/auth"],
    });

    await storeSegments("evt-002", [seg], duckDb, sqliteDb);

    const insertCall = calls[1]; // First INSERT after DELETE
    expect(insertCall.params[0]).toBe("evt-002"); // event_id
    expect(insertCall.params[1]).toBe(0); // segment_index
    expect(insertCall.params[2]).toBe("evt-002:seg-0"); // segment_id
    expect(insertCall.params[3]).toBe(0); // turn_start
    expect(insertCall.params[4]).toBe(10); // turn_end
    expect(insertCall.params[5]).toBe("auth module"); // topic_label
    expect(insertCall.params[6]).toBe("Fixed auth bugs"); // summary
  });

  it("updates events.segments JSON column in DuckDB", async () => {
    const { db: duckDb, calls } = mockDuckDb();
    const { db: sqliteDb } = mockSqliteDb();

    const segments = [makeSegment()];
    await storeSegments("evt-001", segments, duckDb, sqliteDb);

    const updateCall = calls[calls.length - 1];
    expect(updateCall.sql).toContain("UPDATE events SET segments");
    const jsonPayload = JSON.parse(updateCall.params[0] as string);
    expect(jsonPayload).toHaveLength(1);
    expect(jsonPayload[0].segmentId).toBe("evt-001:seg-0");
  });

  it("serializes files_in_scope as JSON for SQLite", async () => {
    const { db: duckDb } = mockDuckDb();
    const { db: sqliteDb, rows } = mockSqliteDb();

    const seg = makeSegment({
      filesInScope: ["src/a.ts", "src/b.ts"],
      modulesInScope: ["src"],
    });

    await storeSegments("evt-001", [seg], duckDb, sqliteDb);

    const insertRow = rows.find((r) => r.sql.includes("INSERT"));
    // files_in_scope should be JSON string
    expect(insertRow?.params[7]).toBe(JSON.stringify(["src/a.ts", "src/b.ts"]));
    expect(insertRow?.params[8]).toBe(JSON.stringify(["src"]));
  });

  // ── loadSegments ───────────────────────────────────────────────────────────

  it("loads segments from SQLite and reconstructs ConversationSegment[]", async () => {
    const { db: sqliteDb } = mockSqliteDb();

    // First store
    const { db: duckDb } = mockDuckDb();
    const seg = makeSegment({
      segmentId: "evt-003:seg-0",
      turnRange: [0, 5],
      topicLabel: "auth fixes",
      summary: "Fixed authentication",
      filesInScope: ["src/auth.ts"],
      modulesInScope: ["src/auth"],
    });
    await storeSegments("evt-003", [seg], duckDb, sqliteDb);

    // Then load
    const loaded = await loadSegments("evt-003", sqliteDb);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].segmentId).toBe("evt-003:seg-0");
    expect(loaded[0].episodeId).toBe("evt-003");
    expect(loaded[0].turnRange).toEqual([0, 5]);
    expect(loaded[0].topicLabel).toBe("auth fixes");
    expect(loaded[0].filesInScope).toEqual(["src/auth.ts"]);
    expect(loaded[0].modulesInScope).toEqual(["src/auth"]);
    expect(loaded[0].segmentMethod).toBe("structural");
  });

  it("returns empty array when no segments exist", async () => {
    const db = {
      run() {},
      exec(_sql: string, _params?: unknown[]) {
        return Promise.resolve([{ columns: [], values: [] }]);
      },
    };

    const loaded = await loadSegments("evt-nonexistent", db);
    expect(loaded).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  getUnextractedEvents,
  markExtracted,
  markFailed,
  markDeferred,
  getExtractionStats,
  resetFailedEvents,
} from "../../../src/services/knowledge/extraction-tracker.js";

/** Minimal mock that returns canned DuckDB-style results. */
function mockDb(responses: Array<{ columns: string[]; values: unknown[][] }>) {
  let callIndex = 0;
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    db: {
      run(_sql: string, _params?: unknown[]) {},
      exec(sql: string, params?: unknown[]) {
        calls.push({ sql, params: params ?? [] });
        const result = responses[callIndex] ?? { columns: [], values: [] };
        callIndex++;
        return Promise.resolve([result]);
      },
    },
    calls,
  };
}

describe("extraction-tracker (KE-4.2)", () => {
  // ── getUnextractedEvents ────────────────────────────────────────────────

  it("returns unextracted events from DuckDB", async () => {
    const { db } = mockDb([
      {
        columns: ["id", "project_id", "source", "type", "ts", "retry_count"],
        values: [
          ["evt-1", "proj-a", "ai-session", "conversation", "2026-04-28T10:00:00Z", 0],
          ["evt-2", "proj-a", "ai-session", "conversation", "2026-04-28T09:00:00Z", 1],
        ],
      },
    ]);

    const events = await getUnextractedEvents(db, 50);
    expect(events).toHaveLength(2);
    expect(events[0].eventId).toBe("evt-1");
    expect(events[0].projectId).toBe("proj-a");
    expect(events[0].source).toBe("ai-session");
    expect(events[0].retryCount).toBe(0);
    expect(events[1].eventId).toBe("evt-2");
    expect(events[1].retryCount).toBe(1);
  });

  it("returns empty array when no events need extraction", async () => {
    const { db } = mockDb([{ columns: [], values: [] }]);
    const events = await getUnextractedEvents(db, 50);
    expect(events).toHaveLength(0);
  });

  it("passes projectId filter when provided", async () => {
    const { db, calls } = mockDb([{ columns: [], values: [] }]);
    await getUnextractedEvents(db, 25, "proj-x");
    expect(calls[0].params).toEqual([25, "proj-x"]);
    expect(calls[0].sql).toContain("e.project_id = $2");
  });

  // ── markExtracted ───────────────────────────────────────────────────────

  it("executes INSERT ... ON CONFLICT for extracted status", async () => {
    const { db, calls } = mockDb([{ columns: [], values: [] }]);
    await markExtracted(db, "evt-1", "proj-a");
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("'extracted'");
    expect(calls[0].params).toEqual(["evt-1", "proj-a"]);
  });

  it("defaults projectId to empty string", async () => {
    const { db, calls } = mockDb([{ columns: [], values: [] }]);
    await markExtracted(db, "evt-2");
    expect(calls[0].params).toEqual(["evt-2", ""]);
  });

  // ── markFailed ──────────────────────────────────────────────────────────

  it("passes error string and increments retry count", async () => {
    const { db, calls } = mockDb([{ columns: [], values: [] }]);
    await markFailed(db, "evt-3", "LLM timeout", "proj-b");
    expect(calls[0].sql).toContain("'failed'");
    expect(calls[0].sql).toContain("retry_count + 1");
    expect(calls[0].params).toEqual(["evt-3", "proj-b", "LLM timeout"]);
  });

  // ── markDeferred ────────────────────────────────────────────────────────

  it("marks event as deferred", async () => {
    const { db, calls } = mockDb([{ columns: [], values: [] }]);
    await markDeferred(db, "evt-4", "proj-c");
    expect(calls[0].sql).toContain("'deferred'");
    expect(calls[0].params).toEqual(["evt-4", "proj-c"]);
  });

  // ── getExtractionStats ─────────────────────────────────────────────────

  it("returns aggregate stats from extraction_status", async () => {
    const { db } = mockDb([
      {
        columns: ["total", "extracted", "pending", "failed", "deferred"],
        values: [[100, 85, 5, 8, 2]],
      },
    ]);

    const stats = await getExtractionStats(db);
    expect(stats.total).toBe(100);
    expect(stats.extracted).toBe(85);
    expect(stats.pending).toBe(5);
    expect(stats.failed).toBe(8);
    expect(stats.deferred).toBe(2);
  });

  it("returns zeros for empty table", async () => {
    const { db } = mockDb([{ columns: [], values: [] }]);
    const stats = await getExtractionStats(db);
    expect(stats).toEqual({ total: 0, extracted: 0, pending: 0, failed: 0, deferred: 0 });
  });

  it("filters by projectId when provided", async () => {
    const { db, calls } = mockDb([
      { columns: ["total", "extracted", "pending", "failed", "deferred"], values: [[10, 8, 1, 1, 0]] },
    ]);
    await getExtractionStats(db, "proj-z");
    expect(calls[0].sql).toContain("WHERE project_id = $1");
    expect(calls[0].params).toEqual(["proj-z"]);
  });

  // ── resetFailedEvents ──────────────────────────────────────────────────

  it("resets failed events and returns count", async () => {
    const { db } = mockDb([
      {
        columns: ["event_id"],
        values: [["evt-5"], ["evt-6"], ["evt-7"]],
      },
    ]);

    const count = await resetFailedEvents(db);
    expect(count).toBe(3);
  });

  it("returns 0 when no failed events exist", async () => {
    const { db } = mockDb([{ columns: [], values: [] }]);
    const count = await resetFailedEvents(db);
    expect(count).toBe(0);
  });

  it("filters reset by projectId", async () => {
    const { db, calls } = mockDb([{ columns: ["event_id"], values: [["evt-8"]] }]);
    await resetFailedEvents(db, "proj-d");
    expect(calls[0].sql).toContain("AND project_id = $1");
    expect(calls[0].params).toEqual(["proj-d"]);
  });
});

// T-328 through T-331: Outcome classifier tests
import { describe, expect, it } from "vitest";
import { classifyOutcomes } from "../../../src/services/intelligence/outcome-classifier.js";

/**
 * In-memory mock DB that implements DbLike for testing outcome classification.
 */
function createMockDb(events: Array<{ id: string; metadata: Record<string, unknown> }>) {
  const rows = events.map((e) => ({
    id: e.id,
    metadata: JSON.stringify(e.metadata),
    type: "ai-conversation",
    source: "ai-session",
  }));

  return {
    run(_sql: string, _params?: unknown[]): void {
      // Track updates
      const id = _params?.[1] as string;
      const meta = _params?.[0] as string;
      const row = rows.find((r) => r.id === id);
      if (row) row.metadata = meta;
    },
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> {
      if (sql.includes("SELECT id, metadata, type, source FROM events WHERE id = ?")) {
        const id = params?.[0] as string;
        const row = rows.find((r) => r.id === id);
        if (!row) return [];
        return [
          {
            columns: ["id", "metadata", "type", "source"],
            values: [[row.id, row.metadata, row.type, row.source]],
          },
        ];
      }
      if (sql.includes("SELECT id FROM events WHERE type = 'ai-conversation'")) {
        const unclassified = rows.filter((r) => {
          const meta = JSON.parse(r.metadata);
          return !meta.outcome;
        });
        if (unclassified.length === 0) return [];
        return [{ columns: ["id"], values: unclassified.map((r) => [r.id]) }];
      }
      // For context switch detection (next event query)
      if (sql.includes("SELECT metadata FROM events")) {
        return [];
      }
      return [];
    },
    getMetadata(id: string): Record<string, unknown> | null {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      return JSON.parse(row.metadata);
    },
  };
}

describe("classifyOutcomes", () => {
  it("T-328: files_modified present → success", () => {
    const db = createMockDb([
      { id: "ev-1", metadata: { files_modified: ["src/auth.ts"], session_id: "s1" } },
    ]);
    const count = classifyOutcomes(db, ["ev-1"]);
    expect(count).toBe(1);
    const meta = db.getMetadata("ev-1");
    expect(meta?.outcome).toBe("success");
  });

  it("T-329: abandon keywords in last prompt → abandoned", () => {
    const db = createMockDb([
      {
        id: "ev-2",
        metadata: { prompts_all: ["implement auth", "never mind, skip this"], session_id: "s1" },
      },
    ]);
    const count = classifyOutcomes(db, ["ev-2"]);
    expect(count).toBe(1);
    const meta = db.getMetadata("ev-2");
    expect(meta?.outcome).toBe("abandoned");
  });

  it("T-330: iteration_count > 5 with no files → failed", () => {
    const db = createMockDb([{ id: "ev-3", metadata: { iteration_count: 8, session_id: "s1" } }]);
    const count = classifyOutcomes(db, ["ev-3"]);
    expect(count).toBe(1);
    const meta = db.getMetadata("ev-3");
    expect(meta?.outcome).toBe("failed");
  });

  it("T-331: conversation_complete with no files → partial", () => {
    const db = createMockDb([
      { id: "ev-4", metadata: { conversation_complete: true, session_id: "s1" } },
    ]);
    const count = classifyOutcomes(db, ["ev-4"]);
    expect(count).toBe(1);
    const meta = db.getMetadata("ev-4");
    expect(meta?.outcome).toBe("partial");
  });

  it("T-331b: already classified events are skipped", () => {
    const db = createMockDb([
      { id: "ev-5", metadata: { outcome: "success", files_modified: ["x.ts"] } },
    ]);
    const count = classifyOutcomes(db, ["ev-5"]);
    expect(count).toBe(0); // Already has outcome
  });

  it("T-331c: empty event list returns 0", () => {
    const db = createMockDb([]);
    const count = classifyOutcomes(db, []);
    expect(count).toBe(0);
  });
});

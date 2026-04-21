// T-341/T-342: Lineage endpoint tests
import { describe, expect, it } from "vitest";
import { getEventsForInsight, writeInsightMappings } from "../../../src/services/intelligence/lineage.js";

function createMockDb() {
  const mappings: Array<{
    event_id: string;
    insight_id: string;
    analyzer: string;
    contribution_weight: number;
    computed_at: string;
  }> = [];

  const events: Array<{
    id: string;
    ts: string;
    source: string;
    content_summary: string;
    git_branch: string | null;
    domain: string | null;
  }> = [
    { id: "evt-1", ts: "2026-04-20T10:00:00Z", source: "ai-session", content_summary: "Refactored auth", git_branch: "feat/auth", domain: "auth" },
    { id: "evt-2", ts: "2026-04-20T11:00:00Z", source: "ai-session", content_summary: "Fixed login bug", git_branch: "feat/auth", domain: "auth" },
    { id: "evt-3", ts: "2026-04-20T12:00:00Z", source: "mcp-active", content_summary: "Updated tests", git_branch: "feat/auth", domain: "testing" },
  ];

  return {
    run(sql: string, params?: unknown[]): void {
      if (sql.includes("INSERT OR REPLACE INTO event_insight_map")) {
        mappings.push({
          event_id: params![0] as string,
          insight_id: params![1] as string,
          analyzer: params![2] as string,
          contribution_weight: params![3] as number,
          computed_at: params![4] as string,
        });
      }
    },
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> {
      if (sql.includes("FROM event_insight_map WHERE insight_id")) {
        const insightId = sql.match(/'([^']+)'/)?.[1] ?? "";
        const matches = mappings.filter((m) => m.insight_id === insightId);
        if (matches.length === 0) return [];
        return [{
          columns: ["event_id", "insight_id", "analyzer", "contribution_weight", "computed_at"],
          values: matches.map((m) => [m.event_id, m.insight_id, m.analyzer, m.contribution_weight, m.computed_at]),
        }];
      }
      if (sql.includes("FROM event_insight_map WHERE event_id")) {
        const eventId = sql.match(/'([^']+)'/)?.[1] ?? "";
        const matches = mappings.filter((m) => m.event_id === eventId);
        if (matches.length === 0) return [];
        return [{
          columns: ["event_id", "insight_id", "analyzer", "contribution_weight", "computed_at"],
          values: matches.map((m) => [m.event_id, m.insight_id, m.analyzer, m.contribution_weight, m.computed_at]),
        }];
      }
      if (sql.includes("FROM events WHERE id IN")) {
        const ids = params as string[] ?? [];
        const matches = events.filter((e) => ids.includes(e.id));
        if (matches.length === 0) return [];
        return [{
          columns: ["id", "ts", "source", "content_summary", "git_branch", "domain"],
          values: matches.map((e) => [e.id, e.ts, e.source, e.content_summary, e.git_branch, e.domain]),
        }];
      }
      return [];
    },
    getMappings: () => mappings,
    getEvents: () => events,
  };
}

describe("lineage service", () => {
  it("writeInsightMappings records event-to-insight relationships", () => {
    const db = createMockDb();
    writeInsightMappings(db, "insight-abc", "efficiency", ["evt-1", "evt-2"]);

    const mappings = db.getMappings();
    expect(mappings.length).toBe(2);
    expect(mappings[0].event_id).toBe("evt-1");
    expect(mappings[0].insight_id).toBe("insight-abc");
    expect(mappings[0].analyzer).toBe("efficiency");
  });

  it("getEventsForInsight returns source events", () => {
    const db = createMockDb();
    writeInsightMappings(db, "insight-abc", "efficiency", ["evt-1", "evt-2"]);

    const events = getEventsForInsight(db, "insight-abc");
    expect(events.length).toBe(2);
    expect(events[0].insightId).toBe("insight-abc");
    expect(events[0].analyzer).toBe("efficiency");
  });

  it("returns empty for unknown insight ID", () => {
    const db = createMockDb();
    const events = getEventsForInsight(db, "nonexistent");
    expect(events.length).toBe(0);
  });

  it("supports custom contribution weights", () => {
    const db = createMockDb();
    writeInsightMappings(db, "insight-xyz", "comprehension", ["evt-1", "evt-2"], [0.8, 0.2]);

    const mappings = db.getMappings();
    expect(mappings[0].contribution_weight).toBe(0.8);
    expect(mappings[1].contribution_weight).toBe(0.2);
  });
});

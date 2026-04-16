// Tests for UF-046: MCP Zod schemas
import { describe, expect, it } from "vitest";
import {
  ContextInputSchema,
  ContextOutputSchema,
  DecisionsInputSchema,
  DecisionsOutputSchema,
  McpMetaSchema,
  ProfileOutputSchema,
  QueryInputSchema,
  QueryOutputSchema,
  QueryResultItemSchema,
} from "../../src/schemas/mcp.js";

describe("McpMetaSchema", () => {
  it("validates a complete _meta object", () => {
    const result = McpMetaSchema.safeParse({
      tool: "unfade-query",
      durationMs: 42,
      degraded: false,
      lastUpdated: "2026-04-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null lastUpdated", () => {
    const result = McpMetaSchema.safeParse({
      tool: "unfade-profile",
      durationMs: 5,
      degraded: true,
      degradedReason: "File missing",
      lastUpdated: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing tool field", () => {
    const result = McpMetaSchema.safeParse({ durationMs: 1, degraded: false, lastUpdated: null });
    expect(result.success).toBe(false);
  });
});

describe("QueryInputSchema", () => {
  it("validates minimal input with defaults", () => {
    const result = QueryInputSchema.safeParse({ query: "caching" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it("validates full input with date range", () => {
    const result = QueryInputSchema.safeParse({
      query: "auth module",
      dateRange: { from: "2026-04-01", to: "2026-04-15" },
      limit: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty query", () => {
    const result = QueryInputSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("rejects limit out of range", () => {
    expect(QueryInputSchema.safeParse({ query: "x", limit: 0 }).success).toBe(false);
    expect(QueryInputSchema.safeParse({ query: "x", limit: 51 }).success).toBe(false);
  });
});

describe("QueryResultItemSchema", () => {
  it("validates event result", () => {
    const result = QueryResultItemSchema.safeParse({
      source: "event",
      date: "2026-04-15",
      summary: "Added caching layer",
      score: 0.85,
    });
    expect(result.success).toBe(true);
  });

  it("validates distill result with detail", () => {
    const result = QueryResultItemSchema.safeParse({
      source: "distill",
      date: "2026-04-15",
      summary: "Daily summary",
      detail: "Lots of caching work",
      score: 0.5,
    });
    expect(result.success).toBe(true);
  });
});

describe("QueryOutputSchema", () => {
  it("validates complete output", () => {
    const result = QueryOutputSchema.safeParse({
      data: {
        results: [{ source: "event", date: "2026-04-15", summary: "test", score: 0.5 }],
        total: 1,
      },
      _meta: { tool: "unfade-query", durationMs: 10, degraded: false, lastUpdated: null },
    });
    expect(result.success).toBe(true);
  });
});

describe("ContextInputSchema", () => {
  it("defaults scope to today", () => {
    const result = ContextInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBe("today");
    }
  });

  it("accepts all scope values", () => {
    for (const scope of ["last_2h", "today", "this_week"]) {
      expect(ContextInputSchema.safeParse({ scope }).success).toBe(true);
    }
  });

  it("accepts optional project", () => {
    const result = ContextInputSchema.safeParse({ scope: "today", project: "unfade" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid scope", () => {
    expect(ContextInputSchema.safeParse({ scope: "yesterday" }).success).toBe(false);
  });
});

describe("ContextOutputSchema", () => {
  it("validates complete output", () => {
    const result = ContextOutputSchema.safeParse({
      data: {
        scope: "today",
        events: [
          {
            id: "abc",
            timestamp: "2026-04-15T10:00:00Z",
            source: "git",
            type: "commit",
            summary: "test",
          },
        ],
        eventCount: 1,
        distillSummary: "Built auth module",
      },
      _meta: { tool: "unfade-context", durationMs: 5, degraded: false, lastUpdated: null },
    });
    expect(result.success).toBe(true);
  });

  it("accepts null distillSummary", () => {
    const result = ContextOutputSchema.safeParse({
      data: { scope: "today", events: [], eventCount: 0, distillSummary: null },
      _meta: { tool: "unfade-context", durationMs: 1, degraded: false, lastUpdated: null },
    });
    expect(result.success).toBe(true);
  });
});

describe("DecisionsInputSchema", () => {
  it("defaults limit to 10", () => {
    const result = DecisionsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it("accepts domain filter", () => {
    const result = DecisionsInputSchema.safeParse({ limit: 5, domain: "backend" });
    expect(result.success).toBe(true);
  });
});

describe("DecisionsOutputSchema", () => {
  it("validates complete output", () => {
    const result = DecisionsOutputSchema.safeParse({
      data: {
        decisions: [
          { date: "2026-04-15", decision: "Added auth", rationale: "Security", domain: "backend" },
        ],
        total: 1,
      },
      _meta: { tool: "unfade-decisions", durationMs: 3, degraded: false, lastUpdated: null },
    });
    expect(result.success).toBe(true);
  });
});

describe("ProfileOutputSchema", () => {
  it("validates complete profile output", () => {
    const result = ProfileOutputSchema.safeParse({
      data: {
        version: 1,
        updatedAt: "2026-04-15T10:00:00Z",
        distillCount: 5,
        avgAlternativesEvaluated: 2.5,
        aiAcceptanceRate: 0.8,
        aiModificationRate: 0.1,
        avgDecisionsPerDay: 3,
        avgDeadEndsPerDay: 0.5,
        domainDistribution: [{ domain: "TypeScript", frequency: 10, lastSeen: "2026-04-15" }],
        patterns: ["Polyglot"],
      },
      _meta: {
        tool: "unfade-profile",
        durationMs: 2,
        degraded: false,
        lastUpdated: "2026-04-15T10:00:00Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("validates degraded empty profile", () => {
    const result = ProfileOutputSchema.safeParse({
      data: {
        version: 1,
        updatedAt: "2026-04-15T10:00:00Z",
        distillCount: 0,
        avgAlternativesEvaluated: 0,
        aiAcceptanceRate: 0,
        aiModificationRate: 0,
        avgDecisionsPerDay: 0,
        avgDeadEndsPerDay: 0,
        domainDistribution: [],
        patterns: [],
      },
      _meta: {
        tool: "unfade-profile",
        durationMs: 1,
        degraded: true,
        degradedReason: "Profile not found",
        lastUpdated: null,
      },
    });
    expect(result.success).toBe(true);
  });
});

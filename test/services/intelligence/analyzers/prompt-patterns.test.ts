import { describe, expect, it, vi } from "vitest";
import { promptPatternsAnalyzer } from "../../../../src/services/intelligence/analyzers/prompt-patterns.js";
import type { AnalyzerContext } from "../../../../src/services/intelligence/analyzers/index.js";
import type { DbLike } from "../../../../src/services/cache/manager.js";

vi.mock("../../../../src/services/intelligence/domain-classifier.js", () => ({
  classifyDomainFast: (text: string) => {
    if (text.toLowerCase().includes("auth")) return "auth";
    if (text.toLowerCase().includes("database")) return "database";
    return "general";
  },
}));

function createMockAnalytics(promptRows: unknown[][] = []): DbLike {
  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("prompt_full") || sql.includes("content_summary")) {
        if (promptRows.length > 0) {
          return [{
            columns: ["id", "prompt_text", "prompts_context", "hds", "spec"],
            values: promptRows,
          }];
        }
        return [{ columns: [], values: [] }];
      }
      if (sql.includes("MAX(ts)")) {
        return [{ columns: ["max_ts"], values: [["2026-04-28T12:00:00Z"]] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function makePromptRows(count: number, domain: string, opts: { withConstraints?: boolean; hds?: number } = {}): unknown[][] {
  return Array.from({ length: count }, (_, i) => {
    const text = opts.withConstraints
      ? `${domain} auth module must validate tokens and should enforce rate limits`
      : `${domain} auth fix something`;
    return [`evt-${domain}-${i}`, text, "", opts.hds ?? 0.7, 0.6];
  });
}

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge: null,
    ...overrides,
  };
}

describe("prompt-patterns (IP-4.2)", () => {
  describe("_meta enrichment", () => {
    it("output includes _meta with all required fields", async () => {
      const rows = [
        ...makePromptRows(8, "auth", { withConstraints: true, hds: 0.8 }),
        ...makePromptRows(8, "auth", { withConstraints: false, hds: 0.3 }),
      ];
      const analytics = createMockAnalytics(rows);
      const ctx = makeCtx({ analytics });
      const state = await promptPatternsAnalyzer.initialize(ctx);
      const { _meta } = state.value.output;

      expect(_meta).toBeDefined();
      expect(_meta.updatedAt).toBeTruthy();
      expect(typeof _meta.dataPoints).toBe("number");
      expect(["high", "medium", "low"]).toContain(_meta.confidence);
      expect(_meta.watermark).toBeTruthy();
      expect(typeof _meta.stalenessMs).toBe("number");
    });
  });

  describe("diagnostics enrichment", () => {
    it("output includes diagnostics array", async () => {
      const ctx = makeCtx();
      const state = await promptPatternsAnalyzer.initialize(ctx);

      expect(Array.isArray(state.value.output.diagnostics)).toBe(true);
    });

    it("generates insufficient data diagnostic when < 20 prompts", async () => {
      const rows = makePromptRows(5, "auth");
      const analytics = createMockAnalytics(rows);
      const ctx = makeCtx({ analytics });
      const state = await promptPatternsAnalyzer.initialize(ctx);

      const infoDiags = state.value.output.diagnostics.filter((d) =>
        d.message.includes("prompts analyzed"),
      );
      expect(infoDiags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("exampleSessionIds per pattern", () => {
    it("effective patterns include exampleSessionIds", async () => {
      const rows = [
        ...makePromptRows(8, "auth", { withConstraints: true, hds: 0.85 }),
        ...makePromptRows(8, "auth", { withConstraints: false, hds: 0.3 }),
      ];
      const analytics = createMockAnalytics(rows);
      const ctx = makeCtx({ analytics });
      const state = await promptPatternsAnalyzer.initialize(ctx);

      for (const pattern of state.value.output.effectivePatterns) {
        expect(Array.isArray(pattern.exampleSessionIds)).toBe(true);
      }
    });

    it("anti-patterns include exampleSessionIds", async () => {
      const rows = [
        ...makePromptRows(5, "auth", { withConstraints: false, hds: 0.1 }),
        ...makePromptRows(3, "auth", { withConstraints: true, hds: 0.6 }),
        ...makePromptRows(5, "auth", { withConstraints: false, hds: 0.2 }),
      ];
      const analytics = createMockAnalytics(rows);
      const ctx = makeCtx({ analytics });
      const state = await promptPatternsAnalyzer.initialize(ctx);

      for (const pattern of state.value.output.antiPatterns) {
        expect(Array.isArray(pattern.exampleSessionIds)).toBe(true);
      }
    });
  });

  describe("no LIMIT 500 cap", () => {
    it("processes all prompt rows without truncation", async () => {
      const rows = makePromptRows(600, "auth", { withConstraints: true, hds: 0.7 });
      const analytics = createMockAnalytics(rows);
      const ctx = makeCtx({ analytics });
      const state = await promptPatternsAnalyzer.initialize(ctx);

      expect(state.value.output.totalPromptsAnalyzed).toBe(600);
    });
  });

  describe("computation", () => {
    it("returns empty patterns when insufficient data", async () => {
      const ctx = makeCtx();
      const state = await promptPatternsAnalyzer.initialize(ctx);

      expect(state.value.output.effectivePatterns).toEqual([]);
      expect(state.value.output.antiPatterns).toEqual([]);
      expect(state.value.output.totalPromptsAnalyzed).toBe(0);
    });
  });

  describe("incremental update", () => {
    it("detects pattern changes", async () => {
      const ctx = makeCtx();
      const initState = await promptPatternsAnalyzer.initialize(ctx);

      const updateResult = await promptPatternsAnalyzer.update(
        initState,
        { events: [{ id: "evt" } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(typeof updateResult.changed).toBe("boolean");
    });
  });
});

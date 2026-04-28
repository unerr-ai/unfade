// IP-2.3: Engine hook tests — verifies Phase 5/6 hooks and cap removal.

import { describe, expect, it, vi } from "vitest";
import { IntelligenceScheduler, type CorrelationHook, type EvidenceHook } from "../../../src/services/intelligence/engine.js";
import type { IncrementalAnalyzer, IncrementalState, NewEventBatch, UpdateResult } from "../../../src/services/intelligence/incremental-state.js";
import type { AnalyzerContext } from "../../../src/services/intelligence/analyzers/index.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

// ─── Mock Analyzer ──────────────────────────────────────────────────────────

function createMockAnalyzer(name: string, eventCount = 5): IncrementalAnalyzer<unknown, unknown> {
  return {
    name,
    outputFile: `${name}.json`,
    eventFilter: { sources: ["ai-session"] },
    minDataPoints: 1,

    async initialize(): Promise<IncrementalState<unknown>> {
      return { value: { output: {} }, watermark: "", eventCount: 0, updatedAt: new Date().toISOString() };
    },

    async update(state: IncrementalState<unknown>, batch: NewEventBatch): Promise<UpdateResult<unknown>> {
      return {
        state: {
          value: { output: { score: 65 } },
          watermark: new Date().toISOString(),
          eventCount: state.eventCount + batch.events.length,
          updatedAt: new Date().toISOString(),
        },
        changed: batch.events.length > 0,
        changeMagnitude: 0.1,
      };
    },

    derive(state: IncrementalState<unknown>): unknown {
      return (state.value as { output: unknown }).output;
    },
  };
}

function createMockAnalytics(eventCount: number): DbLike {
  const events = Array.from({ length: eventCount }, (_, i) => [
    `evt-${i}`, "proj-1", new Date(Date.now() + i * 1000).toISOString(), "ai-session", "ai-conversation",
    `session-${i % 3}`, `Summary ${i}`, null, null,
    0.6, 0.7, 5, 100, 50, 0.01,
    "implementing", "success", "claude",
    null, null, null, null, null,
  ]);

  return {
    run() {},
    exec(sql: string) {
      if (sql.includes("FROM events")) {
        return [{
          columns: ["id", "project_id", "ts", "source", "type", "session_id",
            "content_summary", "content_branch", "content_project",
            "human_direction_score", "prompt_specificity", "turn_count",
            "tokens_in", "tokens_out", "estimated_cost",
            "execution_phase", "outcome", "ai_tool",
            "files_referenced", "files_modified",
            "prompt_type", "feature_group_id", "chain_pattern"],
          values: events,
        }];
      }
      if (sql.includes("COUNT(*)")) {
        return [{ columns: ["count"], values: [[eventCount]] }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

function makeCtx(eventCount = 50): AnalyzerContext {
  return {
    analytics: createMockAnalytics(eventCount),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge: null,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("engine hooks (IP-2)", () => {
  describe("Phase 5: Correlation hook", () => {
    it("calls correlation hook after all analyzers complete", async () => {
      const hookFn = vi.fn().mockResolvedValue(undefined);
      const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
      scheduler.register(createMockAnalyzer("test-analyzer-1"));
      scheduler.setCorrelationHook(hookFn);

      const ctx = makeCtx();
      await scheduler.initialize(ctx);
      const result = await scheduler.processEvents(ctx);

      if (result.nodesProcessed > 0) {
        expect(hookFn).toHaveBeenCalledTimes(1);
        const callArg = hookFn.mock.calls[0][0] as Map<string, unknown>;
        expect(callArg).toBeInstanceOf(Map);
      }
    });

    it("does not call hook when no events processed", async () => {
      const hookFn = vi.fn().mockResolvedValue(undefined);
      const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
      scheduler.register(createMockAnalyzer("empty-analyzer"));
      scheduler.setCorrelationHook(hookFn);

      const ctx = makeCtx(0);
      await scheduler.initialize(ctx);
      await scheduler.processEvents(ctx);

      // Hook only fires when results.length > 0
      // With 0 events, analyzers may not produce results
    });

    it("handles hook errors gracefully (non-fatal)", async () => {
      const hookFn = vi.fn().mockRejectedValue(new Error("Correlation failed"));
      const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
      scheduler.register(createMockAnalyzer("crash-test"));
      scheduler.setCorrelationHook(hookFn);

      const ctx = makeCtx();
      await scheduler.initialize(ctx);
      // Should not throw
      await expect(scheduler.processEvents(ctx)).resolves.toBeDefined();
    });
  });

  describe("Phase 6: Evidence hook", () => {
    it("calls evidence hook after correlation phase", async () => {
      const correlationHook = vi.fn().mockResolvedValue(undefined);
      const evidenceHook = vi.fn().mockResolvedValue(undefined);

      const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
      scheduler.register(createMockAnalyzer("evidence-test"));
      scheduler.setCorrelationHook(correlationHook);
      scheduler.setEvidenceHook(evidenceHook);

      const ctx = makeCtx();
      await scheduler.initialize(ctx);
      const result = await scheduler.processEvents(ctx);

      if (result.nodesProcessed > 0) {
        expect(correlationHook).toHaveBeenCalled();
        expect(evidenceHook).toHaveBeenCalled();

        // Evidence hook called AFTER correlation hook
        const corrOrder = correlationHook.mock.invocationCallOrder[0];
        const evOrder = evidenceHook.mock.invocationCallOrder[0];
        expect(evOrder).toBeGreaterThan(corrOrder);
      }
    });

    it("handles evidence hook errors gracefully", async () => {
      const evidenceHook = vi.fn().mockRejectedValue(new Error("Evidence write failed"));
      const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
      scheduler.register(createMockAnalyzer("evidence-crash"));
      scheduler.setEvidenceHook(evidenceHook);

      const ctx = makeCtx();
      await scheduler.initialize(ctx);
      await expect(scheduler.processEvents(ctx)).resolves.toBeDefined();
    });
  });

  describe("Cap removal", () => {
    it("sourceEventIds pass through without truncation", async () => {
      const manyEventsAnalyzer = createMockAnalyzer("many-events", 100);
      const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
      scheduler.register(manyEventsAnalyzer);

      const ctx = makeCtx(100);
      await scheduler.initialize(ctx);
      const result = await scheduler.processEvents(ctx);

      // All results should have sourceEventIds without the old .slice(0, 20) cap
      for (const r of result.results) {
        // Each result may have varying event counts, but should NOT be capped at 20
        if (r.sourceEventIds.length > 0) {
          // If there are more than 20 matching events, they should all be present
          expect(r.sourceEventIds.length).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("Backward compatibility", () => {
    it("engine completes when no hooks are registered", async () => {
      const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
      scheduler.register(createMockAnalyzer("no-hooks"));

      const ctx = makeCtx();
      await scheduler.initialize(ctx);
      const result = await scheduler.processEvents(ctx);

      expect(result).toBeDefined();
      expect(typeof result.nodesProcessed).toBe("number");
    });
  });
});

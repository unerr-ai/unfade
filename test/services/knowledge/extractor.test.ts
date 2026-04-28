import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CozoDb } from "cozo-node";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import type { DbLike } from "../../../src/services/cache/manager.js";
import {
  ENTITY_SCHEMA,
  ENTITY_ALIAS_SCHEMA,
  FACT_SCHEMA,
  EDGE_SCHEMA,
  COMPREHENSION_ASSESSMENT_SCHEMA,
  METACOGNITIVE_SIGNAL_SCHEMA,
} from "../../../src/services/substrate/schema.js";

// ─── Mock generateText ──────────────────────────────────────────────────────

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  APICallError: class extends Error { static isInstance = () => false; },
  RetryError: class extends Error { static isInstance = () => false; },
}));

const { extractKnowledge } = await import("../../../src/services/knowledge/extractor.js");

// ─── Test Setup ─────────────────────────────────────────────────────────────

let cozo: CozoDb;
let tempDir: string;

const VALID_LLM_RESPONSE = JSON.stringify({
  entities: [
    { name: "Redis", normalizedName: "redis", type: "technology", context: "Used for caching", confidence: 0.9, aliases: ["cache layer"] },
  ],
  facts: [
    { subject: "Redis", predicate: "USES", object: "caching", confidence: 0.85, explicit: true, temporalHint: "ongoing", context: "Redis for caching" },
  ],
  comprehension: {
    dimensions: { steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7 },
    evidence: ["Developer asked why"],
    rubberStampCount: 0,
    pushbackCount: 1,
    domainTags: ["backend"],
  },
  metacognitiveSignals: [
    { turnIndex: 0, signalType: "why-question", quote: "Why Redis?", strength: 0.8 },
  ],
  agencyClassification: [],
  sustainabilitySignal: null,
  reasoningChains: [],
});

function createMockAnalytics(): DbLike {
  const store = new Map<string, unknown>();
  return {
    run() {},
    exec(sql: string, params?: unknown[]) {
      const sqlLower = sql.trim().toLowerCase();

      if (sqlLower.startsWith("insert") || sqlLower.startsWith("update") || sqlLower.startsWith("delete")) {
        if (params?.[0]) store.set(String(params[0]), params);
        return [{ columns: [], values: [] }];
      }

      if (sqlLower.includes("from domain_comprehension")) {
        return [{ columns: ["base_score", "stability", "interaction_count"], values: [] }];
      }

      if (sqlLower.includes("from extraction_status") || sqlLower.includes("from comprehension")) {
        return [{ columns: [], values: [] }];
      }

      return [{ columns: [], values: [] }];
    },
  };
}

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: "evt-test-001",
    projectId: "proj-test",
    timestamp: "2026-04-28T10:00:00Z",
    source: "ai-session",
    type: "ai-conversation",
    content: {
      summary: "Discussed Redis caching",
      detail: "user: Why use Redis? | assistant: Redis provides fast in-memory caching.",
    },
    ...overrides,
  };
}

const STUB_MODEL = {} as any;

function makeConfig(overrides: Partial<any> = {}) {
  return {
    model: STUB_MODEL,
    provider: "test",
    modelName: "test-model",
    concurrency: 1,
    timeoutMs: 30_000,
    ...overrides,
  };
}

beforeAll(async () => {
  cozo = new CozoDb("mem", "");
  await cozo.run(ENTITY_SCHEMA);
  await cozo.run(ENTITY_ALIAS_SCHEMA);
  await cozo.run(FACT_SCHEMA);
  await cozo.run(EDGE_SCHEMA);
  await cozo.run(COMPREHENSION_ASSESSMENT_SCHEMA);
  await cozo.run(METACOGNITIVE_SIGNAL_SCHEMA);
  tempDir = mkdtempSync(join(tmpdir(), "unfade-ke17-"));
});

afterAll(() => {
  try { cozo.close(); } catch { /* */ }
  try { rmSync(tempDir, { recursive: true }); } catch { /* */ }
});

beforeEach(() => {
  mockGenerateText.mockReset();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("extractor (KE-17.1)", () => {
  describe("full pipeline with LLM", () => {
    it("processes an event through the complete 10-step pipeline", async () => {
      mockGenerateText.mockResolvedValue({ text: VALID_LLM_RESPONSE });

      const result = await extractKnowledge([makeEvent()], {
        llmConfig: makeConfig(),
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsDeferred).toBe(0);
      expect(result.eventsFailed).toBe(0);
      expect(result.entitiesCreated).toBeGreaterThanOrEqual(0);
      expect(result.assessmentsWritten).toBe(1);
      expect(result.signalsDetected).toBe(1);
    });

    it("processes multiple events in a batch", async () => {
      mockGenerateText.mockResolvedValue({ text: VALID_LLM_RESPONSE });

      const events = [
        makeEvent({ id: "evt-batch-001" as any }),
        makeEvent({ id: "evt-batch-002" as any }),
        makeEvent({ id: "evt-batch-003" as any }),
      ];

      const result = await extractKnowledge(events, {
        llmConfig: makeConfig(),
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      expect(result.eventsProcessed).toBe(3);
    });

    it("writes comprehension to CozoDB", async () => {
      mockGenerateText.mockResolvedValue({ text: VALID_LLM_RESPONSE });

      await extractKnowledge([makeEvent({ id: "evt-comp-001" as any })], {
        llmConfig: makeConfig(),
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      const check = await cozo.run(
        "?[overall_score, assessment_method] := *comprehension_assessment{episode_id: 'evt-comp-001', overall_score, assessment_method}",
      );
      const rows = (check as { rows: unknown[][] }).rows;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0][1]).toBe("llm");
    });

    it("writes metacognitive signals to CozoDB", async () => {
      mockGenerateText.mockResolvedValue({ text: VALID_LLM_RESPONSE });

      await extractKnowledge([makeEvent({ id: "evt-meta-001" as any })], {
        llmConfig: makeConfig(),
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      const check = await cozo.run(
        "?[signal_type, strength] := *metacognitive_signal{episode_id: 'evt-meta-001', signal_type, strength}",
      );
      const rows = (check as { rows: unknown[][] }).rows;
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("no LLM configured (deferred path)", () => {
    it("defers events when no LLM is configured", async () => {
      const result = await extractKnowledge([makeEvent()], {
        llmConfig: null,
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      expect(result.eventsDeferred).toBe(1);
      expect(result.eventsProcessed).toBe(0);
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it("computes heuristic comprehension for AI conversations when deferred", async () => {
      const result = await extractKnowledge(
        [makeEvent({ id: "evt-heur-001" as any })],
        {
          llmConfig: null,
          embeddingModel: null,
          cozo,
          analytics: createMockAnalytics(),
        },
      );

      expect(result.eventsDeferred).toBe(1);
      expect(result.assessmentsWritten).toBe(1);
    });

    it("does not compute heuristic for git events", async () => {
      const result = await extractKnowledge(
        [makeEvent({ source: "git", type: "commit", id: "evt-git-001" as any })],
        {
          llmConfig: null,
          embeddingModel: null,
          cozo,
          analytics: createMockAnalytics(),
        },
      );

      expect(result.eventsDeferred).toBe(1);
      expect(result.assessmentsWritten).toBe(0);
    });
  });

  describe("error isolation", () => {
    it("continues processing after one event fails", async () => {
      let callCount = 0;
      mockGenerateText.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("LLM unavailable");
        return { text: VALID_LLM_RESPONSE };
      });

      const events = [
        makeEvent({ id: "evt-fail-001" as any }),
        makeEvent({ id: "evt-ok-001" as any }),
      ];

      const result = await extractKnowledge(events, {
        llmConfig: makeConfig(),
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      expect(result.eventsFailed).toBe(1);
      expect(result.eventsProcessed).toBe(1);
    });

    it("handles empty event batch", async () => {
      const result = await extractKnowledge([], {
        llmConfig: makeConfig(),
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      expect(result.eventsProcessed).toBe(0);
      expect(result.eventsDeferred).toBe(0);
      expect(result.eventsFailed).toBe(0);
    });
  });

  describe("return value aggregation", () => {
    it("aggregates results across multiple events", async () => {
      mockGenerateText.mockResolvedValue({ text: VALID_LLM_RESPONSE });

      const events = [
        makeEvent({ id: "evt-agg-001" as any }),
        makeEvent({ id: "evt-agg-002" as any }),
      ];

      const result = await extractKnowledge(events, {
        llmConfig: makeConfig(),
        embeddingModel: null,
        cozo,
        analytics: createMockAnalytics(),
      });

      expect(result.eventsProcessed).toBe(2);
      expect(result.assessmentsWritten).toBe(2);
      expect(result.signalsDetected).toBeGreaterThanOrEqual(2);
    });
  });
});

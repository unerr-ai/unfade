import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import type { ConversationSegment } from "../../../src/schemas/knowledge.js";
import type { Turn } from "../../../src/services/knowledge/turn-parser.js";
import {
  ExtractionParseError,
  LlmConversationOutputSchema,
  LlmGitOutputSchema,
  type ExtractionConfig,
} from "../../../src/services/knowledge/llm-extractor.js";

// ─── Mock generateText at the module level ──────────────────────────────────

const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  APICallError: class extends Error { static isInstance = () => false; },
  RetryError: class extends Error { static isInstance = () => false; },
}));

// Dynamic import AFTER mock is set up (the mock applies to the module's import too)
const { extractFromEvent, extractBatch } = await import(
  "../../../src/services/knowledge/llm-extractor.js"
);

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: "evt-test-001",
    projectId: "proj-test",
    timestamp: "2026-04-28T10:00:00Z",
    source: "ai-session",
    type: "ai-conversation",
    content: { summary: "Test conversation" },
    ...overrides,
  };
}

function makeTurns(): Turn[] {
  return [
    { index: 0, role: "user", content: "Add Redis caching to the auth module" },
    { index: 1, role: "assistant", content: "I'll set up Redis with ioredis for session caching." },
    { index: 2, role: "user", content: "Why not use the built-in Map? What's the trade-off?" },
    { index: 3, role: "assistant", content: "Map doesn't persist across restarts. Redis gives TTL." },
  ];
}

function makeSegments(): ConversationSegment[] {
  return [{
    segmentId: "evt-test-001:seg-0",
    episodeId: "evt-test-001",
    turnRange: [0, 3],
    topicLabel: "Redis caching",
    summary: "Adding Redis caching to auth",
    filesInScope: ["src/cache.ts"],
    modulesInScope: ["src/cache"],
    segmentMethod: "structural",
  }];
}

const VALID_CONVERSATION_OUTPUT = JSON.stringify({
  entities: [
    { name: "Redis", normalizedName: "redis", type: "technology", context: "Used for session caching", confidence: 0.9, aliases: ["cache layer"] },
    { name: "ioredis", normalizedName: "ioredis", type: "library", context: "Redis client library", confidence: 0.8, aliases: [] },
  ],
  facts: [
    { subject: "auth module", predicate: "USES", object: "Redis", confidence: 0.85, explicit: true, temporalHint: "ongoing", context: "Add Redis caching to the auth module" },
  ],
  comprehension: {
    dimensions: { steering: 7, understanding: 8, metacognition: 6, independence: 5, engagement: 7 },
    evidence: ["Developer asked about trade-offs between Redis and Map"],
    rubberStampCount: 0,
    pushbackCount: 1,
    domainTags: ["caching", "backend"],
  },
  metacognitiveSignals: [
    { turnIndex: 2, signalType: "why-question", quote: "Why not use the built-in Map?", strength: 0.8 },
  ],
  agencyClassification: [
    { segmentId: "evt-test-001:seg-0", classification: "developer-directed", reasoning: "Developer set the goal and questioned decisions" },
  ],
  sustainabilitySignal: {
    direction: "builds-capability",
    reasoning: "Developer engaged with trade-off reasoning",
    evidence: ["Asked about trade-offs"],
  },
  reasoningChains: [
    { decision: "Use Redis for caching", alternatives: ["Built-in Map"], rationale: "Persistence across restarts and TTL", tradeOffs: ["External dependency"], context: "Why not use the built-in Map?" },
  ],
});

const VALID_GIT_OUTPUT = JSON.stringify({
  entities: [
    { name: "Redis", normalizedName: "redis", type: "technology", context: "Added as caching layer", confidence: 0.8, aliases: [] },
  ],
  facts: [
    { subject: "project", predicate: "USES", object: "Redis", confidence: 0.8, explicit: true, temporalHint: "ongoing", context: "feat: add Redis caching" },
  ],
  reasoningChains: [],
});

/** Stub model object — generateText is mocked so this is never actually called. */
const STUB_MODEL = {} as any;

function makeConfig(overrides: Partial<ExtractionConfig> = {}): ExtractionConfig {
  return {
    model: STUB_MODEL,
    provider: "test",
    modelName: "test-model",
    concurrency: 2,
    timeoutMs: 30_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockGenerateText.mockReset();
});

// ─── Schema Validation Tests ────────────────────────────────────────────────

describe("LLM output schemas", () => {
  it("LlmConversationOutputSchema parses valid output", () => {
    const result = LlmConversationOutputSchema.safeParse(JSON.parse(VALID_CONVERSATION_OUTPUT));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entities).toHaveLength(2);
      expect(result.data.facts).toHaveLength(1);
      expect(result.data.comprehension).not.toBeNull();
      expect(result.data.metacognitiveSignals).toHaveLength(1);
    }
  });

  it("LlmConversationOutputSchema defaults empty arrays for missing fields", () => {
    const minimal = { entities: [], facts: [] };
    const result = LlmConversationOutputSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metacognitiveSignals).toEqual([]);
      expect(result.data.agencyClassification).toEqual([]);
      expect(result.data.comprehension).toBeNull();
      expect(result.data.sustainabilitySignal).toBeNull();
    }
  });

  it("LlmConversationOutputSchema rejects invalid entity type", () => {
    const invalid = {
      entities: [{ name: "X", normalizedName: "x", type: "INVALID", context: "c", confidence: 0.5, aliases: [] }],
      facts: [],
    };
    const result = LlmConversationOutputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("LlmGitOutputSchema parses valid output", () => {
    const result = LlmGitOutputSchema.safeParse(JSON.parse(VALID_GIT_OUTPUT));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entities).toHaveLength(1);
      expect(result.data.facts).toHaveLength(1);
    }
  });
});

// ─── extractFromEvent Tests ─────────────────────────────────────────────────

describe("extractFromEvent", () => {
  it("returns valid ExtractionResult from LLM response", async () => {
    mockGenerateText.mockResolvedValue({ text: VALID_CONVERSATION_OUTPUT });
    const config = makeConfig();
    const event = makeEvent();

    const result = await extractFromEvent(event, makeTurns(), makeSegments(), config);

    expect(result.episodeId).toBe("evt-test-001");
    expect(result.entities).toHaveLength(2);
    expect(result.facts).toHaveLength(1);
    expect(result.comprehension).not.toBeNull();
    expect(result.comprehension!.episodeId).toBe("evt-test-001");
    expect(result.comprehension!.timestamp).toBe("2026-04-28T10:00:00Z");
    expect(result.comprehension!.assessmentMethod).toBe("llm");
    expect(result.comprehension!.overallScore).toBeGreaterThan(0);
    expect(result.comprehension!.overallScore).toBeLessThanOrEqual(100);
    expect(result.metacognitiveSignals).toHaveLength(1);
    expect(result.agencyClassification).toHaveLength(1);
    expect(result.sustainabilitySignal).not.toBeNull();
    expect(result.reasoningChains).toHaveLength(1);
    expect(result.segments).toHaveLength(1);
  });

  it("returns empty result for events with no turns (no LLM call)", async () => {
    const config = makeConfig();
    const event = makeEvent();

    const result = await extractFromEvent(event, [], [], config);

    expect(result.episodeId).toBe("evt-test-001");
    expect(result.entities).toEqual([]);
    expect(result.facts).toEqual([]);
    expect(result.comprehension).toBeNull();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("handles git commit events (no comprehension)", async () => {
    mockGenerateText.mockResolvedValue({ text: VALID_GIT_OUTPUT });
    const config = makeConfig();
    const event = makeEvent({ source: "git", type: "commit" });
    const turns: Turn[] = [
      { index: 0, role: "user", content: "feat: add Redis caching", filesModified: ["src/cache.ts"] },
    ];

    const result = await extractFromEvent(event, turns, [], config);

    expect(result.episodeId).toBe("evt-test-001");
    expect(result.entities).toHaveLength(1);
    expect(result.facts).toHaveLength(1);
    expect(result.comprehension).toBeNull();
    expect(result.metacognitiveSignals).toEqual([]);
    expect(result.agencyClassification).toEqual([]);
    expect(result.sustainabilitySignal).toBeNull();
  });

  it("retries on malformed JSON and throws ExtractionParseError on second failure", async () => {
    mockGenerateText.mockResolvedValue({ text: "This is not JSON at all" });
    const config = makeConfig();
    const event = makeEvent();

    await expect(
      extractFromEvent(event, makeTurns(), makeSegments(), config),
    ).rejects.toThrow(ExtractionParseError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("handles markdown-fenced JSON response", async () => {
    const fencedResponse = "```json\n" + VALID_CONVERSATION_OUTPUT + "\n```";
    mockGenerateText.mockResolvedValue({ text: fencedResponse });
    const config = makeConfig();
    const event = makeEvent();

    const result = await extractFromEvent(event, makeTurns(), makeSegments(), config);
    expect(result.entities).toHaveLength(2);
  });

  it("computes overallScore deterministically from dimension weights", async () => {
    mockGenerateText.mockResolvedValue({ text: VALID_CONVERSATION_OUTPUT });
    const config = makeConfig();
    const event = makeEvent();

    const result = await extractFromEvent(event, makeTurns(), makeSegments(), config);
    const dims = result.comprehension!.dimensions;

    const expected = Math.round(
      (dims.steering * 0.25 +
        dims.understanding * 0.30 +
        dims.metacognition * 0.20 +
        dims.independence * 0.15 +
        dims.engagement * 0.10) * 10,
    );
    expect(result.comprehension!.overallScore).toBe(expected);
  });

  it("succeeds on retry when first response is invalid then second is valid", async () => {
    mockGenerateText
      .mockResolvedValueOnce({ text: "invalid json garbage" })
      .mockResolvedValueOnce({ text: VALID_CONVERSATION_OUTPUT });

    const config = makeConfig();
    const event = makeEvent();

    const result = await extractFromEvent(event, makeTurns(), makeSegments(), config);
    expect(result.entities).toHaveLength(2);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });
});

// ─── extractBatch Tests ─────────────────────────────────────────────────────

describe("extractBatch", () => {
  it("processes batch of events with concurrency", async () => {
    mockGenerateText.mockResolvedValue({ text: VALID_CONVERSATION_OUTPUT });
    const config = makeConfig();

    const events = [
      { event: makeEvent({ id: "evt-001" as any }), turns: makeTurns(), segments: makeSegments() },
      { event: makeEvent({ id: "evt-002" as any }), turns: makeTurns(), segments: makeSegments() },
      { event: makeEvent({ id: "evt-003" as any }), turns: makeTurns(), segments: makeSegments() },
    ];

    const results = await extractBatch(events, config);

    expect(results.size).toBe(3);
    expect(results.has("evt-001")).toBe(true);
    expect(results.has("evt-002")).toBe(true);
    expect(results.has("evt-003")).toBe(true);
  });

  it("skips failed events in batch without halting", async () => {
    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      // First event gets 2 calls (initial + retry) = calls 1,2 both invalid
      // Second event gets call 3 which is valid
      if (callCount <= 2) return { text: "not json" };
      return { text: VALID_CONVERSATION_OUTPUT };
    });

    const config = makeConfig({ concurrency: 1 });

    const events = [
      { event: makeEvent({ id: "evt-fail" as any }), turns: makeTurns(), segments: makeSegments() },
      { event: makeEvent({ id: "evt-pass" as any }), turns: makeTurns(), segments: makeSegments() },
    ];

    const results = await extractBatch(events, config);

    expect(results.has("evt-pass")).toBe(true);
    expect(results.has("evt-fail")).toBe(false);
  });

  it("returns empty map for empty events array", async () => {
    const config = makeConfig();
    const results = await extractBatch([], config);
    expect(results.size).toBe(0);
  });
});

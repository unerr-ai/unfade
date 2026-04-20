import { describe, expect, it } from "vitest";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import {
  aggregateDirectionSignals,
  extractSignals,
} from "../../../src/services/distill/signal-extractor.js";

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "commit",
    source: "git",
    timestamp: "2026-04-17T10:00:00Z",
    content: {
      summary: "Added auth module",
      files: ["src/auth.ts"],
      branch: "main",
    },
    ...overrides,
  };
}

function makeAIEvent(hds: number, confidence: "high" | "low", tool = "claude-code"): CaptureEvent {
  return makeEvent({
    type: "ai-conversation",
    source: "ai-session",
    content: {
      summary: `AI session: DI vs singletons discussion (HDS: ${hds})`,
      branch: "main",
    },
    metadata: {
      ai_tool: tool,
      session_id: `sess-${Math.random().toString(36).slice(2)}`,
      conversation_id: `conv-${Math.random().toString(36).slice(2)}`,
      turn_count: 6,
      direction_signals: {
        human_direction_score: hds,
        confidence,
        rejection_count: hds > 0.5 ? 2 : 0,
      },
    },
  });
}

// T-103: Signal extractor: AI session events weighted 3x over git commits
describe("extractSignals with AI session events", () => {
  it("includes AI session events as decisions", () => {
    const events = [makeEvent(), makeAIEvent(0.75, "high"), makeAIEvent(0.45, "low")];

    const signals = extractSignals(events, "2026-04-17");

    // 1 commit + 2 AI conversations = 3 decisions
    expect(signals.decisions.length).toBe(3);
  });

  it("counts AI completions including conversations", () => {
    const events = [
      makeAIEvent(0.8, "high"),
      makeEvent({ type: "ai-completion", source: "ai-session" }),
    ];

    const signals = extractSignals(events, "2026-04-17");
    expect(signals.stats.aiCompletions).toBeGreaterThanOrEqual(1);
  });
});

describe("aggregateDirectionSignals", () => {
  it("aggregates HDS across AI session events", () => {
    const events = [
      makeAIEvent(0.8, "high", "claude-code"),
      makeAIEvent(0.6, "high", "claude-code"),
      makeAIEvent(0.2, "high", "cursor"),
    ];

    const result = aggregateDirectionSignals(events);

    expect(result.averageHDS).toBeCloseTo((0.8 + 0.6 + 0.2) / 3, 2);
    expect(result.classifications).toHaveLength(3);

    const humanDirected = result.classifications.filter(
      (c) => c.classification === "human-directed",
    );
    expect(humanDirected.length).toBe(2);

    expect(result.toolBreakdown.get("claude-code")?.events).toBe(2);
    expect(result.toolBreakdown.get("cursor")?.events).toBe(1);
  });

  it("returns empty for non-AI events", () => {
    const events = [makeEvent()];
    const result = aggregateDirectionSignals(events);

    expect(result.averageHDS).toBe(0);
    expect(result.classifications).toHaveLength(0);
  });

  it("skips events without direction_signals metadata", () => {
    const events = [
      makeEvent({
        type: "ai-conversation",
        source: "ai-session",
        metadata: { ai_tool: "cursor" },
      }),
    ];

    const result = aggregateDirectionSignals(events);
    expect(result.classifications).toHaveLength(0);
    expect(result.toolBreakdown.get("cursor")?.events).toBe(1);
  });
});

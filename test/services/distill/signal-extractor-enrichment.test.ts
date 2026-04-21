// T-332, T-333: Signal extractor enrichment tests (execution phase + outcome breakdowns)
import { describe, expect, it } from "vitest";
import { ExtractedSignalsSchema } from "../../../src/schemas/distill.js";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import { extractSignals } from "../../../src/services/distill/signal-extractor.js";

function makeAiEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    projectId: "test-project-id",
    type: "ai-conversation",
    source: "ai-session",
    timestamp: "2026-04-15T10:00:00Z",
    content: {
      summary: "AI conversation about auth",
      files: ["src/auth.ts"],
    },
    metadata: {},
    ...overrides,
  };
}

describe("extractSignals — enrichment", () => {
  const DATE = "2026-04-15";

  it("T-332: executionPhaseBreakdown aggregates phases from AI event metadata", () => {
    const events = [
      makeAiEvent({ metadata: { execution_phase: "debugging" } }),
      makeAiEvent({ metadata: { execution_phase: "debugging" } }),
      makeAiEvent({ metadata: { execution_phase: "implementing" } }),
      makeAiEvent({ metadata: { execution_phase: "testing" } }),
    ];

    const result = extractSignals(events, DATE);
    expect(ExtractedSignalsSchema.safeParse(result).success).toBe(true);
    expect(result.stats.executionPhaseBreakdown).toBeDefined();
    expect(result.stats.executionPhaseBreakdown!.debugging).toBe(2);
    expect(result.stats.executionPhaseBreakdown!.implementing).toBe(1);
    expect(result.stats.executionPhaseBreakdown!.testing).toBe(1);
  });

  it("T-333: outcomeBreakdown aggregates outcomes from AI event metadata", () => {
    const events = [
      makeAiEvent({ metadata: { outcome: "success" } }),
      makeAiEvent({ metadata: { outcome: "success" } }),
      makeAiEvent({ metadata: { outcome: "partial" } }),
      makeAiEvent({ metadata: { outcome: "failed" } }),
      makeAiEvent({ metadata: {} }), // unclassified
    ];

    const result = extractSignals(events, DATE);
    expect(ExtractedSignalsSchema.safeParse(result).success).toBe(true);
    expect(result.stats.outcomeBreakdown).toBeDefined();
    expect(result.stats.outcomeBreakdown!.success).toBe(2);
    expect(result.stats.outcomeBreakdown!.partial).toBe(1);
    expect(result.stats.outcomeBreakdown!.failed).toBe(1);
    expect(result.stats.outcomeBreakdown!.unclassified).toBe(1);
  });

  it("T-332b: executionPhaseBreakdown is undefined when no AI events", () => {
    const events: CaptureEvent[] = [
      {
        id: globalThis.crypto.randomUUID(),
        projectId: "test-project-id",
        type: "commit",
        source: "git",
        timestamp: "2026-04-15T10:00:00Z",
        content: { summary: "commit", files: ["src/x.ts"], branch: "main" },
        gitContext: { repo: "test", branch: "main", commitHash: "abc123" },
      },
    ];

    const result = extractSignals(events, DATE);
    expect(result.stats.executionPhaseBreakdown).toBeUndefined();
    expect(result.stats.outcomeBreakdown).toBeUndefined();
  });
});

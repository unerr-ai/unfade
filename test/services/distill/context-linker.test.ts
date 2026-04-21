// T-041: Context linker (Stage 2) tests
import { describe, expect, it } from "vitest";
import { LinkedSignalsSchema } from "../../../src/schemas/distill.js";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import { linkContext } from "../../../src/services/distill/context-linker.js";
import { extractSignals } from "../../../src/services/distill/signal-extractor.js";

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    projectId: "test-project-id",
    type: "commit",
    source: "git",
    timestamp: "2026-04-15T10:00:00Z",
    content: {
      summary: "Added user auth module",
      files: ["src/auth.ts", "src/auth.test.ts"],
      branch: "main",
    },
    gitContext: { repo: "test-repo", branch: "main", commitHash: "abc123" },
    ...overrides,
  };
}

describe("linkContext", () => {
  const DATE = "2026-04-15";

  it("T-041a: output validates against LinkedSignalsSchema", () => {
    const events = [makeEvent()];
    const signals = extractSignals(events, DATE);
    const linked = linkContext(signals, events);

    const parsed = LinkedSignalsSchema.safeParse(linked);
    expect(parsed.success).toBe(true);
  });

  it("T-041b: attaches git context to decisions", () => {
    const events = [makeEvent()];
    const signals = extractSignals(events, DATE);
    const linked = linkContext(signals, events);

    expect(linked.decisions).toHaveLength(1);
    expect(linked.decisions[0].files).toEqual(["src/auth.ts", "src/auth.test.ts"]);
    expect(linked.decisions[0].repo).toBe("test-repo");
  });

  it("T-041c: finds AI conversations referencing same files", () => {
    const commitId = globalThis.crypto.randomUUID();
    const aiId = globalThis.crypto.randomUUID();

    const events: CaptureEvent[] = [
      makeEvent({
        id: commitId,
        content: { summary: "Auth work", files: ["src/auth.ts"], branch: "main" },
      }),
      makeEvent({
        id: aiId,
        type: "ai-conversation",
        source: "ai-session",
        timestamp: "2026-04-15T09:30:00Z",
        content: { summary: "Discussed auth.ts approach", files: ["src/auth.ts"] },
      }),
    ];

    const signals = extractSignals(events, DATE);
    const linked = linkContext(signals, events);

    // The commit decision should reference the AI conversation
    const commitDecision = linked.decisions.find((d) => d.eventId === commitId);
    expect(commitDecision?.relatedAiConversations).toContain(aiId);
  });

  it("T-041d: builds temporal chains for modules with 2+ commits", () => {
    const events = [
      makeEvent({
        timestamp: "2026-04-15T09:00:00Z",
        content: { summary: "First auth commit", files: ["src/auth/login.ts"], branch: "main" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T10:00:00Z",
        content: { summary: "Second auth commit", files: ["src/auth/register.ts"], branch: "main" },
      }),
    ];

    const signals = extractSignals(events, DATE);
    const linked = linkContext(signals, events);

    const authChain = linked.temporalChains.find((c) => c.module === "src/auth");
    expect(authChain).toBeDefined();
    expect(authChain?.eventIds).toHaveLength(2);
  });

  it("T-041e: computes AI acceptance rate", () => {
    const events: CaptureEvent[] = [
      makeEvent({
        type: "ai-completion",
        source: "ai-session",
        content: { summary: "Accepted suggestion" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        type: "ai-completion",
        source: "ai-session",
        content: { summary: "Accepted suggestion 2" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        type: "ai-rejection",
        source: "ai-session",
        content: { summary: "Rejected suggestion" },
      }),
    ];

    const signals = extractSignals(events, DATE);
    const linked = linkContext(signals, events);

    // 2 completions / 3 total = 0.667
    expect(linked.stats.aiAcceptanceRate).toBeCloseTo(0.667, 2);
  });

  it("T-041f: links trade-offs to related commits via file overlap", () => {
    const commitId = globalThis.crypto.randomUUID();
    const rejectionId = globalThis.crypto.randomUUID();

    const events: CaptureEvent[] = [
      makeEvent({
        id: commitId,
        content: { summary: "Implemented auth", files: ["src/auth.ts"], branch: "main" },
      }),
      makeEvent({
        id: rejectionId,
        type: "ai-rejection",
        source: "ai-session",
        content: { summary: "Rejected AI auth approach", files: ["src/auth.ts"] },
      }),
    ];

    const signals = extractSignals(events, DATE);
    const linked = linkContext(signals, events);

    const tradeOff = linked.tradeOffs.find((t) => t.eventId === rejectionId);
    expect(tradeOff?.relatedCommits).toContain(commitId);
  });

  it("T-041g: handles empty signals gracefully", () => {
    const signals = extractSignals([], DATE);
    const linked = linkContext(signals, []);

    expect(linked.decisions).toHaveLength(0);
    expect(linked.temporalChains).toHaveLength(0);
    expect(linked.stats.aiAcceptanceRate).toBeUndefined();
  });
});

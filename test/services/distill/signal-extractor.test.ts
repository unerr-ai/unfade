// T-040: Signal extractor (Stage 1) tests
import { describe, expect, it } from "vitest";
import { ExtractedSignalsSchema } from "../../../src/schemas/distill.js";
import type { CaptureEvent } from "../../../src/schemas/event.js";
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
    gitContext: { repo: "test", branch: "main", commitHash: "abc123def456" },
    ...overrides,
  };
}

describe("extractSignals", () => {
  const DATE = "2026-04-15";

  it("T-040a: returns valid ExtractedSignals for empty events", () => {
    const result = extractSignals([], DATE);
    expect(ExtractedSignalsSchema.safeParse(result).success).toBe(true);
    expect(result.decisions).toHaveLength(0);
    expect(result.stats.totalEvents).toBe(0);
  });

  it("T-040b: classifies commits as decisions", () => {
    const events = [
      makeEvent({ timestamp: "2026-04-15T09:00:00Z" }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T10:00:00Z",
        content: {
          summary: "Refactored auth middleware",
          files: ["src/middleware.ts"],
          branch: "feat/auth",
        },
      }),
    ];

    const result = extractSignals(events, DATE);
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0].summary).toBe("Added user auth module");
    expect(result.decisions[1].branch).toBe("feat/auth");
    expect(result.stats.commitCount).toBe(2);
  });

  it("T-040c: classifies AI rejections as trade-offs", () => {
    const events = [
      makeEvent({
        type: "ai-rejection",
        source: "ai-session",
        content: { summary: "Rejected AI suggestion for auth", files: ["src/auth.ts"] },
      }),
    ];

    const result = extractSignals(events, DATE);
    expect(result.tradeOffs).toHaveLength(1);
    expect(result.tradeOffs[0].summary).toContain("Rejected AI suggestion");
    expect(result.stats.aiRejections).toBe(1);
  });

  it("T-040d: classifies reverts as dead ends with time estimate", () => {
    const events = [
      makeEvent({
        timestamp: "2026-04-15T09:00:00Z",
        content: { summary: "Start feature X", files: ["src/x.ts"], branch: "feat/x" },
        gitContext: { repo: "test", branch: "feat/x" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        type: "revert",
        timestamp: "2026-04-15T10:30:00Z",
        content: { summary: "Revert feature X", files: ["src/x.ts"], branch: "feat/x" },
        gitContext: { repo: "test", branch: "feat/x" },
      }),
    ];

    const result = extractSignals(events, DATE);
    expect(result.deadEnds).toHaveLength(1);
    expect(result.deadEnds[0].summary).toBe("Revert feature X");
    expect(result.deadEnds[0].timeSpentMinutes).toBe(90);
    expect(result.stats.reverts).toBe(1);
  });

  it("T-040e: detects debugging sessions from rapid fix commits", () => {
    const events = [
      makeEvent({
        timestamp: "2026-04-15T10:00:00Z",
        content: { summary: "fix auth bug", files: ["src/auth.ts"], branch: "main" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T10:05:00Z",
        content: { summary: "fix auth edge case", files: ["src/auth.ts"], branch: "main" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T10:12:00Z",
        content: { summary: "fix auth final", files: ["src/auth.ts"], branch: "main" },
      }),
    ];

    const result = extractSignals(events, DATE);
    expect(result.debuggingSessions).toHaveLength(1);
    expect(result.debuggingSessions[0].fixCount).toBe(3);
  });

  it("T-040f: extracts domains from file extensions", () => {
    const events = [
      makeEvent({
        content: { summary: "work", files: ["src/app.ts", "styles/main.css", "README.md"] },
      }),
    ];

    const result = extractSignals(events, DATE);
    expect(result.stats.domains).toContain("TypeScript");
    expect(result.stats.domains).toContain("Styles");
    expect(result.stats.domains).toContain("Docs");
  });

  it("T-040g: counts alternatives from branch overlap", () => {
    const events = [
      makeEvent({
        timestamp: "2026-04-15T09:00:00Z",
        content: { summary: "Impl A", files: ["src/auth.ts"], branch: "feat/auth-v1" },
        gitContext: { repo: "test", branch: "feat/auth-v1" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T10:00:00Z",
        content: { summary: "Impl B", files: ["src/auth.ts"], branch: "feat/auth-v2" },
        gitContext: { repo: "test", branch: "feat/auth-v2" },
      }),
    ];

    const result = extractSignals(events, DATE);
    // Both decisions touch src/auth.ts on different branches → 1 alternative each
    expect(result.decisions[0].alternativesCount).toBe(1);
    expect(result.decisions[1].alternativesCount).toBe(1);
  });

  it("T-040h: never throws on malformed input", () => {
    // Pass garbage that would cause issues if not guarded
    const events = [makeEvent({ timestamp: "not-a-date" })];
    expect(() => extractSignals(events, DATE)).not.toThrow();
  });

  it("T-040i: output validates against ExtractedSignalsSchema", () => {
    const events = [
      makeEvent(),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        type: "ai-rejection",
        source: "ai-session",
        content: { summary: "Rejected suggestion", files: [] },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        type: "branch-switch",
        content: { summary: "Switched to feat/auth" },
      }),
    ];

    const result = extractSignals(events, DATE);
    const parsed = ExtractedSignalsSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});

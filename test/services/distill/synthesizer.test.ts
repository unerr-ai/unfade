// T-042: Synthesizer (Stage 3 + fallback) tests
import { describe, expect, it } from "vitest";
import { DailyDistillSchema } from "../../../src/schemas/distill.js";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import { linkContext } from "../../../src/services/distill/context-linker.js";
import { extractSignals } from "../../../src/services/distill/signal-extractor.js";
import { synthesize, synthesizeFallback } from "../../../src/services/distill/synthesizer.js";

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "commit",
    source: "git",
    timestamp: "2026-04-15T10:00:00Z",
    content: {
      summary: "Added user auth module",
      files: ["src/auth.ts", "src/auth.test.ts"],
      branch: "main",
    },
    gitContext: { repo: "test", branch: "main", commitHash: "abc123" },
    ...overrides,
  };
}

function buildLinked(events: CaptureEvent[]) {
  const signals = extractSignals(events, "2026-04-15");
  return linkContext(signals, events);
}

describe("synthesizeFallback", () => {
  it("T-042a: produces valid DailyDistill from commit events", () => {
    const linked = buildLinked([
      makeEvent(),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T11:00:00Z",
        content: { summary: "Added tests", files: ["src/auth.test.ts"], branch: "main" },
      }),
    ]);

    const result = synthesizeFallback(linked);
    const parsed = DailyDistillSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.date).toBe("2026-04-15");
    expect(result.decisions).toHaveLength(2);
    expect(result.eventsProcessed).toBe(2);
    expect(result.synthesizedBy).toBe("fallback");
  });

  it("T-042b: includes domains from file extensions", () => {
    const linked = buildLinked([
      makeEvent({ content: { summary: "work", files: ["src/app.ts", "styles/main.css"] } }),
    ]);

    const result = synthesizeFallback(linked);
    expect(result.domains).toContain("TypeScript");
    expect(result.domains).toContain("Styles");
  });

  it("T-042c: includes trade-offs from AI rejections", () => {
    const linked = buildLinked([
      makeEvent({
        type: "ai-rejection",
        source: "ai-session",
        content: { summary: "Rejected inline auth", files: ["src/auth.ts"] },
      }),
    ]);

    const result = synthesizeFallback(linked);
    expect(result.tradeOffs).toHaveLength(1);
    expect(result.tradeOffs?.[0].tradeOff).toContain("Rejected inline auth");
  });

  it("T-042d: includes dead ends from reverts", () => {
    const linked = buildLinked([
      makeEvent({
        timestamp: "2026-04-15T09:00:00Z",
        content: { summary: "Start X", files: ["src/x.ts"], branch: "feat/x" },
        gitContext: { repo: "test", branch: "feat/x" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        type: "revert",
        timestamp: "2026-04-15T10:00:00Z",
        content: { summary: "Revert X", files: ["src/x.ts"], branch: "feat/x" },
        gitContext: { repo: "test", branch: "feat/x" },
      }),
    ]);

    const result = synthesizeFallback(linked);
    expect(result.deadEnds).toHaveLength(1);
    expect(result.deadEnds?.[0].description).toBe("Revert X");
  });

  it("T-042e: handles empty linked signals", () => {
    const linked = buildLinked([]);

    const result = synthesizeFallback(linked);
    const parsed = DailyDistillSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.decisions).toHaveLength(0);
    expect(result.summary).toContain("No significant activity");
  });

  it("T-042f: includes patterns from temporal chains", () => {
    const linked = buildLinked([
      makeEvent({
        timestamp: "2026-04-15T09:00:00Z",
        content: { summary: "Auth step 1", files: ["src/auth/login.ts"], branch: "main" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T10:00:00Z",
        content: { summary: "Auth step 2", files: ["src/auth/register.ts"], branch: "main" },
      }),
    ]);

    const result = synthesizeFallback(linked);
    expect(result.patterns?.some((p) => p.includes("src/auth"))).toBe(true);
  });
});

describe("synthesize", () => {
  it("T-042g: falls back when no provider given", async () => {
    const linked = buildLinked([makeEvent()]);

    const result = await synthesize(linked, null);
    expect(result.synthesizedBy).toBe("fallback");
    expect(DailyDistillSchema.safeParse(result).success).toBe(true);
  });

  it("T-042h: falls back when provider is undefined", async () => {
    const linked = buildLinked([makeEvent()]);

    const result = await synthesize(linked);
    expect(result.synthesizedBy).toBe("fallback");
  });
});

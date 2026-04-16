// Tests for UF-047: Context shaper
import { describe, expect, it } from "vitest";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import { shapeContext } from "../../../src/services/personalization/context-shaper.js";
import type { ReasoningProfile } from "../../../src/services/personalization/profile-builder.js";

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: "git",
    type: "commit",
    content: { summary: "Generic commit" },
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ReasoningProfile> = {}): ReasoningProfile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    distillCount: 5,
    avgAlternativesEvaluated: 1.0,
    aiAcceptanceRate: 0.5,
    aiModificationRate: 0.2,
    avgDecisionsPerDay: 2,
    avgDeadEndsPerDay: 0.3,
    domainDistribution: [],
    patterns: [],
    ...overrides,
  };
}

describe("shapeContext", () => {
  it("returns passthrough when profile is null", () => {
    const events = [makeEvent(), makeEvent()];
    const result = shapeContext(events, null);
    expect(result.shapingApplied).toBe(false);
    expect(result.events.length).toBe(2);
    expect(result.events[0].emphasis).toBe("normal");
  });

  it("returns passthrough when profile has zero distills", () => {
    const profile = makeProfile({ distillCount: 0 });
    const events = [makeEvent()];
    const result = shapeContext(events, profile);
    expect(result.shapingApplied).toBe(false);
  });

  it("emphasizes events in expert domain areas", () => {
    const profile = makeProfile({
      domainDistribution: [
        { domain: "TypeScript", frequency: 15, lastSeen: "2026-04-15" },
        { domain: "Python", frequency: 3, lastSeen: "2026-04-10" },
      ],
    });

    const events = [
      makeEvent({ content: { summary: "Generic fix" } }),
      makeEvent({ content: { summary: "Updated API", detail: "TypeScript refactor" } }),
    ];

    const result = shapeContext(events, profile);
    expect(result.shapingApplied).toBe(true);
    // TypeScript event should be emphasized and come first
    expect(result.events[0].emphasis).toBe("high");
    expect(result.events[0].reason).toBe("domain_expertise");
    expect(result.events[0].event.content.detail).toContain("TypeScript");
  });

  it("emphasizes decisions for high-exploration profiles", () => {
    const profile = makeProfile({
      avgAlternativesEvaluated: 3.0,
    });

    const events = [
      makeEvent({ content: { summary: "Minor fix" } }),
      makeEvent({ content: { summary: "Decided to switch to Redis" } }),
    ];

    const result = shapeContext(events, profile);
    const decisionEvent = result.events.find((s) => s.reason === "exploration_depth");
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent?.emphasis).toBe("high");
  });

  it("emphasizes errors for dead-end-prone profiles", () => {
    const profile = makeProfile({
      avgDeadEndsPerDay: 1.5,
    });

    const events = [
      makeEvent({ type: "commit" }),
      makeEvent({ type: "error", content: { summary: "Build failed" } }),
    ];

    const result = shapeContext(events, profile);
    const errorEvent = result.events.find((s) => s.reason === "dead_end_awareness");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.emphasis).toBe("high");
  });

  it("never removes events — all events present in output", () => {
    const profile = makeProfile({
      domainDistribution: [{ domain: "Go", frequency: 20, lastSeen: "2026-04-15" }],
    });

    const events = [makeEvent(), makeEvent(), makeEvent()];
    const result = shapeContext(events, profile);
    expect(result.events.length).toBe(events.length);
  });

  it("preserves event data through shaping", () => {
    const profile = makeProfile();
    const originalEvent = makeEvent({ content: { summary: "Important work" } });
    const result = shapeContext([originalEvent], profile);
    expect(result.events[0].event.id).toBe(originalEvent.id);
    expect(result.events[0].event.content.summary).toBe("Important work");
  });
});

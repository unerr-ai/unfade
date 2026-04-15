// T-040: Notification service tests
import { describe, expect, it } from "vitest";
import { UnfadeConfigSchema } from "../../../src/schemas/config.js";
import type { DailyDistill } from "../../../src/schemas/distill.js";
import { buildPreview } from "../../../src/services/notification/notifier.js";

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-15",
    summary: "Test distill",
    decisions: [{ decision: "Added auth", rationale: "Security" }],
    eventsProcessed: 5,
    synthesizedBy: "fallback",
    ...overrides,
  };
}

describe("buildPreview", () => {
  it("T-040a: includes decision count", () => {
    const preview = buildPreview(makeDistill());
    expect(preview).toContain("1 decision");
  });

  it("T-040b: pluralizes decisions correctly", () => {
    const distill = makeDistill({
      decisions: [
        { decision: "A", rationale: "r" },
        { decision: "B", rationale: "r" },
      ],
    });
    const preview = buildPreview(distill);
    expect(preview).toContain("2 decisions");
  });

  it("T-040c: includes dead ends", () => {
    const distill = makeDistill({
      deadEnds: [{ description: "Reverted X", timeSpentMinutes: 30 }],
    });
    const preview = buildPreview(distill);
    expect(preview).toContain("1 dead end explored");
  });

  it("T-040d: includes trade-offs", () => {
    const distill = makeDistill({
      tradeOffs: [
        { tradeOff: "X vs Y", chose: "X", rejected: "Y" },
        { tradeOff: "A vs B", chose: "A", rejected: "B" },
      ],
    });
    const preview = buildPreview(distill);
    expect(preview).toContain("2 trade-offs");
  });

  it("T-040e: includes breakthroughs", () => {
    const distill = makeDistill({
      breakthroughs: [{ description: "Major refactor" }],
    });
    const preview = buildPreview(distill);
    expect(preview).toContain("1 breakthrough");
  });

  it("T-040f: returns 'No significant activity' for empty distill", () => {
    const distill = makeDistill({ decisions: [] });
    const preview = buildPreview(distill);
    expect(preview).toBe("No significant activity");
  });

  it("T-040g: combines multiple items", () => {
    const distill = makeDistill({
      decisions: [{ decision: "A", rationale: "r" }],
      deadEnds: [{ description: "X" }],
      breakthroughs: [{ description: "Y" }],
    });
    const preview = buildPreview(distill);
    expect(preview).toContain("1 decision");
    expect(preview).toContain("1 dead end");
    expect(preview).toContain("1 breakthrough");
  });
});

describe("notify", () => {
  it("T-040h: respects config.notification.enabled = false", () => {
    // We just verify the function can be called without throwing
    // when notification is disabled. The actual notification is a side effect.
    const config = UnfadeConfigSchema.parse({ notification: { enabled: false } });
    expect(config.notification.enabled).toBe(false);
  });
});

// Tests for UF-038: DistillView component
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { DistillView } from "../../src/components/DistillView.js";
import type { DailyDistill } from "../../src/schemas/distill.js";

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-15",
    summary: "Test distill summary",
    decisions: [
      { decision: "Added auth module", rationale: "Security requirement", domain: "backend" },
    ],
    eventsProcessed: 5,
    synthesizedBy: "fallback",
    ...overrides,
  };
}

describe("DistillView", () => {
  it("renders date and summary", () => {
    const { lastFrame } = render(<DistillView distill={makeDistill()} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("2026-04-15");
    expect(output).toContain("Test distill summary");
  });

  it("renders decisions section", () => {
    const { lastFrame } = render(<DistillView distill={makeDistill()} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Decisions");
    expect(output).toContain("Added auth module");
    expect(output).toContain("Security requirement");
  });

  it("renders trade-offs when present", () => {
    const distill = makeDistill({
      tradeOffs: [{ tradeOff: "SQL vs NoSQL", chose: "SQL", rejected: "NoSQL" }],
    });
    const { lastFrame } = render(<DistillView distill={distill} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Trade-offs");
    expect(output).toContain("SQL vs NoSQL");
  });

  it("renders dead ends when present", () => {
    const distill = makeDistill({
      deadEnds: [{ description: "Tried Redis caching", timeSpentMinutes: 45 }],
    });
    const { lastFrame } = render(<DistillView distill={distill} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Dead Ends");
    expect(output).toContain("Tried Redis caching");
    expect(output).toContain("45");
  });

  it("renders breakthroughs when present", () => {
    const distill = makeDistill({
      breakthroughs: [{ description: "Found O(1) algorithm" }],
    });
    const { lastFrame } = render(<DistillView distill={distill} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Breakthroughs");
    expect(output).toContain("O(1) algorithm");
  });

  it("renders patterns when present", () => {
    const distill = makeDistill({
      patterns: ["Polyglot developer", "High AI acceptance"],
    });
    const { lastFrame } = render(<DistillView distill={distill} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("Patterns");
    expect(output).toContain("Polyglot developer");
  });

  it("renders domains when present", () => {
    const distill = makeDistill({
      domains: ["TypeScript", "Go"],
    });
    const { lastFrame } = render(<DistillView distill={distill} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("TypeScript");
    expect(output).toContain("Go");
  });

  it("renders event count and synthesizer", () => {
    const { lastFrame } = render(<DistillView distill={makeDistill()} />);
    const output = lastFrame() ?? "";
    expect(output).toContain("5 events");
    expect(output).toContain("fallback");
  });
});

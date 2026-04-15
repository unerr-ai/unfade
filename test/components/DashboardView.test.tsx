// Tests for UF-021 + UF-086c: DashboardView component
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { DashboardView, type PersonalizationLevel } from "../../src/components/DashboardView.js";
import type { DailyDistill } from "../../src/schemas/distill.js";
import type { StateDetails } from "../../src/state/detector.js";

function makeState(overrides: Partial<StateDetails> = {}): StateDetails {
  return {
    state: "daemon_running",
    checks: {
      unfadeDirExists: true,
      gitRepo: true,
      daemonRunning: true,
      shellHooksInstalled: true,
      autoStartRegistered: false,
      llmAvailable: false,
      hasEvents: true,
      hasDistills: true,
    },
    repairs: [],
    ...overrides,
  };
}

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-15",
    summary: "Test summary",
    decisions: [{ decision: "Added auth", rationale: "Security" }],
    eventsProcessed: 5,
    synthesizedBy: "fallback",
    ...overrides,
  };
}

const defaultLevel: PersonalizationLevel = {
  level: 2,
  label: "Developing",
  distillCount: 4,
};

const noop = async () => null;
const noopVoid = () => {};

describe("DashboardView", () => {
  it("shows Capturing status when daemon is running", () => {
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={10}
        latestDistill={makeDistill()}
        personalizationLevel={defaultLevel}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Capturing");
  });

  it("shows Capture paused when daemon is stopped", () => {
    const state = makeState({
      state: "daemon_stopped",
      checks: {
        unfadeDirExists: true,
        gitRepo: true,
        daemonRunning: false,
        shellHooksInstalled: true,
        autoStartRegistered: false,
        llmAvailable: false,
        hasEvents: true,
        hasDistills: true,
      },
    });
    const { lastFrame } = render(
      <DashboardView
        state={state}
        todayEventCount={0}
        latestDistill={null}
        personalizationLevel={{ level: 0, label: "New", distillCount: 0 }}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Capture paused");
  });

  it("shows event count", () => {
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={42}
        latestDistill={makeDistill()}
        personalizationLevel={defaultLevel}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("42");
    expect(output).toContain("events");
  });

  it("shows latest distill summary with top decisions", () => {
    const distill = makeDistill({
      decisions: [
        { decision: "Auth module", rationale: "r" },
        { decision: "Rate limiter", rationale: "r" },
        { decision: "Cache layer", rationale: "r" },
        { decision: "Fourth one", rationale: "r" },
      ],
    });
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={10}
        latestDistill={distill}
        personalizationLevel={defaultLevel}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Auth module");
    expect(output).toContain("Rate limiter");
    expect(output).toContain("Cache layer");
    expect(output).toContain("1 more");
  });

  it("shows personalization level indicator", () => {
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={10}
        latestDistill={makeDistill()}
        personalizationLevel={defaultLevel}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Developing");
    expect(output).toContain("4 distills");
  });

  it("shows 'No distills yet' when no distill available", () => {
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={0}
        latestDistill={null}
        personalizationLevel={{ level: 0, label: "New", distillCount: 0 }}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("No distills yet");
  });

  it("shows quick action keys", () => {
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={10}
        latestDistill={makeDistill()}
        personalizationLevel={defaultLevel}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("[d]");
    expect(output).toContain("[o]");
    expect(output).toContain("[q]");
  });

  it("shows Unfade header", () => {
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={10}
        latestDistill={makeDistill()}
        personalizationLevel={defaultLevel}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    expect(output).toContain("Unfade");
  });

  it("singular event text for count of 1", () => {
    const { lastFrame } = render(
      <DashboardView
        state={makeState()}
        todayEventCount={1}
        latestDistill={makeDistill()}
        personalizationLevel={defaultLevel}
        onDistill={noop}
        onOpenWeb={noopVoid}
      />,
    );
    const output = lastFrame() ?? "";
    // Should contain "1" and "event" (singular, not "events")
    expect(output).toMatch(/1\s+event[^s]/);
  });
});

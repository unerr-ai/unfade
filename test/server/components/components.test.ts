// Phase 15 component tests — verify pure HTML rendering functions
import { describe, expect, it } from "vitest";
import {
  confidenceBadge,
  dataFreshnessBadge,
  emptyState,
  estimateBadge,
  gaugeSvg,
  heatmapCell,
  heroMetricCard,
  kpiCard,
  kpiStrip,
  projectBadge,
  projectCard,
  projectSelector,
  sourceBadge,
  sparklineSvg,
  tabBar,
  trendArrow,
} from "../../../src/server/components/index.js";
import { activationSection } from "../../../src/server/components/system-reveal.js";

describe("heroMetricCard", () => {
  it("renders value and label", () => {
    const html = heroMetricCard({ value: 73, label: "Direction Density", unit: "%" });
    expect(html).toContain("73%");
    expect(html).toContain("Direction Density");
  });

  it("includes sublabel when provided", () => {
    const html = heroMetricCard({ value: 73, label: "AES", sublabel: "You steer confidently" });
    expect(html).toContain("You steer confidently");
  });

  it("shows trend arrow when provided", () => {
    const html = heroMetricCard({
      value: 64,
      label: "AES",
      trend: { direction: "up", value: "+8%" },
    });
    expect(html).toContain("↑");
    expect(html).toContain("+8%");
    expect(html).toContain("text-success");
  });
});

describe("kpiCard", () => {
  it("renders value and label", () => {
    const html = kpiCard({ value: 142, label: "Events (24h)" });
    expect(html).toContain("142");
    expect(html).toContain("Events (24h)");
  });

  it("includes delta when provided", () => {
    const html = kpiCard({ value: 42, label: "Test", delta: "+12%" });
    expect(html).toContain("+12%");
  });

  it("renders as link when href provided", () => {
    const html = kpiCard({ value: 10, label: "Test", href: "/intelligence" });
    expect(html).toContain('href="/intelligence"');
    expect(html).toContain("<a ");
  });
});

describe("kpiStrip", () => {
  it("renders multiple cards in grid", () => {
    const html = kpiStrip([
      { value: 3, label: "Projects" },
      { value: 142, label: "Events" },
    ]);
    expect(html).toContain("grid");
    expect(html).toContain("3");
    expect(html).toContain("142");
  });
});

describe("badges", () => {
  it("dataFreshnessBadge shows live for recent timestamp", () => {
    const html = dataFreshnessBadge({ updatedAt: new Date().toISOString() });
    expect(html).toContain("live");
  });

  it("estimateBadge wraps content with dashed border", () => {
    const html = estimateBadge("$12.40");
    expect(html).toContain("$12.40");
    expect(html).toContain("dashed");
    expect(html).toContain("≈");
  });

  it("confidenceBadge shows level and data points", () => {
    const html = confidenceBadge({ level: "high", dataPoints: 42 });
    expect(html).toContain("high");
    expect(html).toContain("42 sessions");
    expect(html).toContain("bg-success");
  });

  it("sourceBadge renders source name", () => {
    const html = sourceBadge("git");
    expect(html).toContain("git");
  });

  it("projectBadge renders project name", () => {
    const html = projectBadge("unfade-cli");
    expect(html).toContain("unfade-cli");
    expect(html).toContain("bg-accent/10");
  });
});

describe("charts", () => {
  it("gaugeSvg renders SVG with value", () => {
    const html = gaugeSvg({ value: 64, max: 100, size: 200, label: "AES" });
    expect(html).toContain("<svg");
    expect(html).toContain("64");
    expect(html).toContain("AES");
  });

  it("sparklineSvg renders polyline", () => {
    const html = sparklineSvg({ points: [10, 20, 15, 25], width: 120, height: 32 });
    expect(html).toContain("<svg");
    expect(html).toContain("<polyline");
  });

  it("sparklineSvg handles empty points", () => {
    const html = sparklineSvg({ points: [], width: 120, height: 32 });
    expect(html).toContain("<svg");
    expect(html).not.toContain("<polyline");
  });

  it("heatmapCell renders colored cell", () => {
    const html = heatmapCell("auth", 82);
    expect(html).toContain("auth");
    expect(html).toContain("82");
    expect(html).toContain("bg-success/20");
  });

  it("heatmapCell uses warning color for medium scores", () => {
    const html = heatmapCell("payments", 45);
    expect(html).toContain("bg-warning/20");
  });

  it("heatmapCell uses error color for low scores", () => {
    const html = heatmapCell("legacy", 20);
    expect(html).toContain("bg-error/20");
  });

  it("trendArrow renders direction and value", () => {
    const html = trendArrow("up", "+8%");
    expect(html).toContain("↑");
    expect(html).toContain("+8%");
    expect(html).toContain("text-success");
  });
});

describe("emptyState", () => {
  it("renders title and description", () => {
    const html = emptyState({ title: "No data", description: "Keep working" });
    expect(html).toContain("No data");
    expect(html).toContain("Keep working");
  });

  it("includes CTA when provided", () => {
    const html = emptyState({
      title: "Empty",
      description: "Desc",
      cta: { label: "Setup", href: "/setup" },
    });
    expect(html).toContain("Setup");
    expect(html).toContain('href="/setup"');
  });
});

describe("tabBar", () => {
  it("renders tabs with active state", () => {
    const html = tabBar({
      tabs: [
        { id: "overview", label: "Overview", active: true },
        { id: "cost", label: "Cost" },
      ],
      baseUrl: "/intelligence",
    });
    expect(html).toContain("Overview");
    expect(html).toContain("Cost");
    expect(html).toContain("border-accent");
    expect(html).toContain("hx-get");
  });

  it("shows badge count", () => {
    const html = tabBar({
      tabs: [{ id: "patterns", label: "Patterns", badge: 3 }],
      baseUrl: "/intelligence",
    });
    expect(html).toContain("3");
  });
});

describe("projectSelector", () => {
  it("renders All Projects default option", () => {
    const html = projectSelector({ repos: [], currentProjectId: "" });
    expect(html).toContain("All Projects");
    expect(html).toContain("<select");
  });

  it("renders repo options", () => {
    const html = projectSelector({
      repos: [{ id: "abc", label: "unfade-cli" }],
      currentProjectId: "",
    });
    expect(html).toContain("unfade-cli");
    expect(html).toContain('value="abc"');
  });
});

describe("projectCard", () => {
  it("renders project name and AES", () => {
    const html = projectCard({
      id: "abc",
      label: "unfade-cli",
      eventCount24h: 142,
      aes: 64,
      lastActivity: new Date().toISOString(),
    });
    expect(html).toContain("unfade-cli");
    expect(html).toContain("AES: 64");
    expect(html).toContain("142 events");
  });

  it("shows -- for null AES", () => {
    const html = projectCard({
      id: "abc",
      label: "test",
      eventCount24h: 0,
      aes: null,
      lastActivity: new Date().toISOString(),
    });
    expect(html).toContain("AES: --");
  });
});

describe("activationSection", () => {
  it("renders inline activation with status rows and progress", () => {
    const html = activationSection();
    expect(html).toContain('id="home-activation"');
    expect(html).toContain("ha-dot-sse");
    expect(html).toContain("ha-dot-capture");
    expect(html).toContain("ha-events");
    expect(html).toContain("ha-bar");
    expect(html).toContain("Skip to dashboard");
  });

  it("uses enterprise status dot classes without fixed overlay", () => {
    const html = activationSection();
    expect(html).toContain("ua-dot");
    expect(html).not.toContain("fixed inset-0");
    expect(html).not.toContain("z-50");
  });
});

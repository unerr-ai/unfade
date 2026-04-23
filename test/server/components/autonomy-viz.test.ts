// T-422/T-423/T-424: Sprint 15F autonomy visualization components
import { describe, expect, it } from "vitest";
import {
  dependencyHeatmap,
  independenceGauge,
  skillTrajectoryChart,
} from "../../../src/server/components/autonomy-viz.js";

describe("independenceGauge", () => {
  it("renders SVG ring with correct index value", () => {
    const html = independenceGauge({
      index: 72,
      breakdown: { hds: 80, modificationRate: 65, alternativesEval: 60, comprehensionTrend: 75 },
      trend: "improving",
    });
    expect(html).toContain("independence-index");
    expect(html).toContain("<svg");
    expect(html).toContain(">72<");
    expect(html).toContain("var(--success)");
    expect(html).toContain("↑ improving");
  });

  it("shows warning color for mid-range index", () => {
    const html = independenceGauge({
      index: 45,
      breakdown: { hds: 50, modificationRate: 40, alternativesEval: 45, comprehensionTrend: 45 },
      trend: "stable",
    });
    expect(html).toContain("var(--warning)");
    expect(html).toContain("→ stable");
  });

  it("shows error color for low index", () => {
    const html = independenceGauge({
      index: 25,
      breakdown: { hds: 20, modificationRate: 30, alternativesEval: 25, comprehensionTrend: 25 },
      trend: "declining",
    });
    expect(html).toContain("var(--error)");
    expect(html).toContain("↓ declining");
  });
});

describe("skillTrajectoryChart", () => {
  it("renders 3 overlaid trend lines from 30-day data", () => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-04-${(17 + i).toString().padStart(2, "0")}`,
      hds: 50 + i * 3,
      modificationRate: 40 + i * 2,
      comprehension: 60 + i,
    }));
    const html = skillTrajectoryChart({ points });
    expect(html).toContain("<svg");
    expect(html).toContain("<polyline");
    expect(html).toContain("Direction");
    expect(html).toContain("Modification");
    expect(html).toContain("Comprehension");
  });

  it("shows message for insufficient data", () => {
    const html = skillTrajectoryChart({ points: [{ date: "2026-04-23", hds: 50, modificationRate: 40, comprehension: 60 }] });
    expect(html).toContain("Need at least 2 data points");
  });
});

describe("dependencyHeatmap", () => {
  it("flags red cells when acceptance >80% and comprehension <40%", () => {
    const html = dependencyHeatmap({
      entries: [
        { domain: "auth", acceptanceRate: 30, comprehension: 80 },
        { domain: "payments", acceptanceRate: 90, comprehension: 25 },
      ],
    });
    expect(html).toContain("auth");
    expect(html).toContain("payments");
    expect(html).toContain("⚠ risk");
    expect(html).toContain("bg-error/5");
  });

  it("shows ok for balanced domains", () => {
    const html = dependencyHeatmap({
      entries: [{ domain: "utils", acceptanceRate: 40, comprehension: 70 }],
    });
    expect(html).toContain("ok");
    expect(html).not.toContain("⚠ risk");
  });

  it("handles empty entries", () => {
    const html = dependencyHeatmap({ entries: [] });
    expect(html).toContain("No domain dependency data");
  });
});

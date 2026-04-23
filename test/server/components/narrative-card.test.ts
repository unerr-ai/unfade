// T-421/T-425/T-426/T-427: Sprint 15F narrative components
import { describe, expect, it } from "vitest";
import {
  identityNarrative,
  knowledgeRetainedCard,
  vehicleHealthSummary,
} from "../../../src/server/components/narrative-card.js";

describe("vehicleHealthSummary", () => {
  it("renders phase progress bar and bottleneck", () => {
    const html = vehicleHealthSummary({
      phase: 2,
      phaseLabel: "Responsive",
      phaseProgress: 65,
      bottleneck: { dimension: "contextLeverage", score: 32 },
      topPrescription: { action: "Increase MCP usage", estimatedImpact: "+8 AES" },
      activeDiagnosticCount: 3,
      pendingPrescriptionCount: 2,
    });
    expect(html).toContain("vehicle-health");
    expect(html).toContain("Phase 2");
    expect(html).toContain("Responsive");
    expect(html).toContain("width:65%");
    expect(html).toContain("contextLeverage");
    expect(html).toContain("32/100");
    expect(html).toContain("Increase MCP usage");
    expect(html).toContain("3 active");
    expect(html).toContain("2 prescriptions");
  });

  it("omits prescription when not provided", () => {
    const html = vehicleHealthSummary({
      phase: 1,
      phaseLabel: "Discovering",
      phaseProgress: 20,
      bottleneck: { dimension: "direction", score: 15 },
      activeDiagnosticCount: 0,
      pendingPrescriptionCount: 0,
    });
    expect(html).not.toContain("Top prescription");
  });
});

describe("identityNarrative", () => {
  it("generates high-autonomy narrative with all traits", () => {
    const html = identityNarrative({
      avgAlternativesEvaluated: 4.2,
      modificationRate: 35,
      heldRate: 90,
      totalDecisions: 120,
      topDomain: "payments",
    });
    expect(html).toContain("identity-narrative");
    expect(html).toContain("architectural thinking");
    expect(html).toContain("active steering");
    expect(html).toContain("high-durability decisions");
    expect(html).toContain("payments");
    expect(html).toContain("120");
  });

  it("generates low-autonomy narrative for emerging style", () => {
    const html = identityNarrative({
      avgAlternativesEvaluated: 1.2,
      modificationRate: 10,
      heldRate: 40,
      totalDecisions: 5,
    });
    expect(html).toContain("still emerging");
    expect(html).not.toContain("architectural thinking");
  });
});

describe("knowledgeRetainedCard", () => {
  it("renders decision count and comprehension movements", () => {
    const html = knowledgeRetainedCard({
      decisionsLodged: 7,
      deadEndsExplored: 2,
      comprehensionMovements: [
        { domain: "auth", delta: 3 },
        { domain: "payments", delta: -2 },
      ],
      tradeOffsDocumented: 3,
    });
    expect(html).toContain("knowledge-retained");
    expect(html).toContain("7 decisions lodged");
    expect(html).toContain("2 dead ends mapped");
    expect(html).toContain("3 trade-offs documented");
    expect(html).toContain("auth");
    expect(html).toContain("↑3%");
    expect(html).toContain("payments");
    expect(html).toContain("↓2%");
  });
});

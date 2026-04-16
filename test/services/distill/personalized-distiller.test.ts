// Tests for UF-073: Personalized distill
// T-200, T-201, T-202
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DailyDistill } from "../../../src/schemas/distill.js";
import type { ReasoningModelV2 } from "../../../src/schemas/profile.js";
import { formatPersonalizationSection } from "../../../src/services/distill/distiller.js";

function makeProfile(overrides: Partial<ReasoningModelV2> = {}): ReasoningModelV2 {
  return {
    version: 2,
    lastUpdated: "2026-04-15T12:00:00Z",
    dataPoints: 42,
    decisionStyle: {
      avgAlternativesEvaluated: 3.2,
      medianAlternativesEvaluated: 3,
      explorationDepthMinutes: { overall: 15, byDomain: {} },
      aiAcceptanceRate: 0.65,
      aiModificationRate: 0.6,
      aiModificationByDomain: {},
    },
    tradeOffPreferences: [],
    domainDistribution: [
      {
        domain: "backend",
        frequency: 20,
        percentageOfTotal: 0.45,
        lastSeen: "2026-04-15",
        depth: "deep",
        depthTrend: "stable",
        avgAlternativesInDomain: 3.5,
      },
      {
        domain: "frontend",
        frequency: 10,
        percentageOfTotal: 0.25,
        lastSeen: "2026-04-14",
        depth: "moderate",
        depthTrend: "broadening",
        avgAlternativesInDomain: 1.2,
      },
    ],
    patterns: [
      {
        pattern: "Evaluates 3.5+ alternatives for backend decisions",
        confidence: 0.82,
        observedSince: "2026-03-10",
        lastObserved: "2026-04-15",
        examples: 12,
        category: "decision_style",
      },
      {
        pattern: "Low confidence pattern",
        confidence: 0.4,
        observedSince: "2026-04-10",
        lastObserved: "2026-04-15",
        examples: 2,
        category: "exploration",
      },
    ],
    temporalPatterns: {
      mostProductiveHours: [10, 14],
      avgDecisionsPerDay: 4.2,
      peakDecisionDays: [],
    },
    ...overrides,
  };
}

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-15",
    summary: "Test distill",
    decisions: [
      {
        decision: "Added auth middleware",
        rationale: "Security requirement",
        domain: "backend",
        alternativesConsidered: 4,
      },
      {
        decision: "Chose Redis for cache",
        rationale: "Low latency",
        domain: "infrastructure",
        alternativesConsidered: 3,
      },
    ],
    eventsProcessed: 10,
    synthesizedBy: "fallback",
    ...overrides,
  };
}

describe("formatPersonalizationSection", () => {
  // T-200: includes PERSONALIZATION section
  it("T-200: includes PERSONALIZATION section with decision style and domains", () => {
    const profile = makeProfile();
    const distill = makeDistill();

    const section = formatPersonalizationSection(profile, distill);

    expect(section).toContain("## Personalization");
    expect(section).toContain("Decision style:");
    expect(section).toContain("3.2");
    expect(section).toContain("Domain depth:");
    expect(section).toContain("backend");
    expect(section).toContain("deep");
  });

  // T-201: comparison to personal baseline
  it("T-201: includes comparison to personal baseline", () => {
    const profile = makeProfile();
    // Today: avg 4.0 alts, baseline: 3.2 → ratio 1.25 > 1.2 → above
    const distill = makeDistill({
      decisions: [
        {
          decision: "A",
          rationale: "r",
          domain: "backend",
          alternativesConsidered: 6,
        },
        {
          decision: "B",
          rationale: "r",
          domain: "backend",
          alternativesConsidered: 2,
        },
      ],
    });

    const section = formatPersonalizationSection(profile, distill);

    // 4.0 avg today vs 3.2 baseline → above
    expect(section).toContain("above your baseline");
  });

  it("T-201b: shows below baseline when today is lower", () => {
    const profile = makeProfile();
    const distill = makeDistill({
      decisions: [
        {
          decision: "A",
          rationale: "r",
          domain: "frontend",
          alternativesConsidered: 1,
        },
      ],
    });

    const section = formatPersonalizationSection(profile, distill);
    expect(section).toContain("below your baseline");
  });

  // T-202: only shows patterns above 0.7 confidence
  it("T-202: only shows patterns above 0.7 confidence", () => {
    const profile = makeProfile();
    const distill = makeDistill();

    const section = formatPersonalizationSection(profile, distill);

    // Should include high-confidence pattern
    expect(section).toContain("Evaluates 3.5+ alternatives for backend decisions");
    expect(section).toContain("confidence: 0.82");

    // Should NOT include low-confidence pattern
    expect(section).not.toContain("Low confidence pattern");
  });

  it("returns empty string when profile has fewer than 2 data points", () => {
    const profile = makeProfile({ dataPoints: 1 });
    const distill = makeDistill();

    const section = formatPersonalizationSection(profile, distill);
    expect(section).toBe("");
  });

  it("returns empty string when profile is null", () => {
    const section = formatPersonalizationSection(null, makeDistill());
    expect(section).toBe("");
  });

  it("includes blind spots for low-exploration domains", () => {
    const profile = makeProfile({
      domainDistribution: [
        {
          domain: "frontend",
          frequency: 10,
          percentageOfTotal: 0.5,
          lastSeen: "2026-04-15",
          depth: "moderate",
          depthTrend: "stable",
          avgAlternativesInDomain: 1.0,
        },
      ],
    });

    const section = formatPersonalizationSection(profile, makeDistill());
    expect(section).toContain("Blind spot");
    expect(section).toContain("frontend");
  });

  it("shows AI acceptance rate", () => {
    const profile = makeProfile();
    const section = formatPersonalizationSection(profile, makeDistill());
    expect(section).toContain("AI acceptance rate: 65%");
  });

  it("shows domain depth trend arrows", () => {
    const profile = makeProfile();
    const section = formatPersonalizationSection(profile, makeDistill());
    // frontend has broadening trend → should show →
    expect(section).toMatch(/frontend.*→/);
  });
});

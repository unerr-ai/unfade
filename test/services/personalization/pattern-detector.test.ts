// Tests for UF-070: Pattern detector v2
// T-186, T-187, T-188, T-189, T-190, T-191
import { describe, expect, it } from "vitest";
import type { Decision, TradeOff } from "../../../src/schemas/distill.js";
import {
  detectPatterns,
  type PatternDetectorInput,
  surfaceablePatterns,
} from "../../../src/services/personalization/pattern-detector.js";

function makeDecision(
  overrides: Partial<Decision & { date: string }> = {},
): Decision & { date: string } {
  return {
    decision: "Test decision",
    rationale: "Test rationale",
    domain: "backend",
    alternativesConsidered: 2,
    date: "2026-04-15",
    ...overrides,
  };
}

function makeTradeOff(
  overrides: Partial<TradeOff & { date: string }> = {},
): TradeOff & { date: string } {
  return {
    tradeOff: "Test trade-off",
    chose: "simplicity",
    rejected: "flexibility",
    date: "2026-04-15",
    ...overrides,
  };
}

describe("detectPatterns", () => {
  // T-186: detects "high alternatives evaluator" pattern from decision history
  it("T-186: detects high alternatives evaluator pattern", () => {
    const decisions = [
      makeDecision({ domain: "infrastructure", alternativesConsidered: 4, date: "2026-04-10" }),
      makeDecision({ domain: "infrastructure", alternativesConsidered: 5, date: "2026-04-11" }),
      makeDecision({ domain: "infrastructure", alternativesConsidered: 3, date: "2026-04-12" }),
      makeDecision({ domain: "infrastructure", alternativesConsidered: 4, date: "2026-04-13" }),
      makeDecision({ domain: "infrastructure", alternativesConsidered: 5, date: "2026-04-14" }),
    ];

    const patterns = detectPatterns({ decisions });
    const highAlts = patterns.find(
      (p) => p.category === "decision_style" && p.pattern.includes("alternatives"),
    );
    expect(highAlts).toBeDefined();
    expect(highAlts!.examples).toBeGreaterThanOrEqual(3);
  });

  // T-187: detects trade-off preference from consistent choices
  it("T-187: detects trade-off preference from consistent choices", () => {
    const tradeOffs = [
      makeTradeOff({ chose: "simplicity", rejected: "flexibility", date: "2026-04-10" }),
      makeTradeOff({ chose: "simplicity", rejected: "flexibility", date: "2026-04-11" }),
      makeTradeOff({ chose: "simplicity", rejected: "flexibility", date: "2026-04-12" }),
      makeTradeOff({ chose: "simplicity", rejected: "flexibility", date: "2026-04-13" }),
    ];

    const patterns = detectPatterns({ decisions: [], tradeOffs });
    const tradeOffPattern = patterns.find(
      (p) => p.category === "trade_off" && p.pattern.includes("simplicity"),
    );
    expect(tradeOffPattern).toBeDefined();
    expect(tradeOffPattern!.confidence).toBeGreaterThan(0.5);
  });

  // T-188: confidence increases with more supporting examples
  it("T-188: confidence increases with more supporting examples", () => {
    const baseDecisions = Array.from({ length: 3 }, (_, i) =>
      makeDecision({
        domain: "infra",
        alternativesConsidered: 4,
        date: `2026-04-${String(10 + i).padStart(2, "0")}`,
      }),
    );

    const moreDecisions = Array.from({ length: 8 }, (_, i) =>
      makeDecision({
        domain: "infra",
        alternativesConsidered: 4,
        date: `2026-04-${String(10 + i).padStart(2, "0")}`,
      }),
    );

    const patternsSmall = detectPatterns({ decisions: baseDecisions });
    const patternsLarge = detectPatterns({ decisions: moreDecisions });

    const smallMatch = patternsSmall.find(
      (p) => p.category === "decision_style" && p.pattern.includes("alternatives"),
    );
    const largeMatch = patternsLarge.find(
      (p) => p.category === "decision_style" && p.pattern.includes("alternatives"),
    );

    expect(smallMatch).toBeDefined();
    expect(largeMatch).toBeDefined();
    expect(largeMatch!.confidence).toBeGreaterThan(smallMatch!.confidence);
  });

  // T-189: contradicting evidence reduces confidence
  it("T-189: contradicting evidence reduces confidence", () => {
    // All high alternatives
    const consistentDecisions = Array.from({ length: 5 }, (_, i) =>
      makeDecision({
        domain: "infra",
        alternativesConsidered: 4,
        date: `2026-04-${String(10 + i).padStart(2, "0")}`,
      }),
    );

    // Mix of high and low alternatives
    const mixedDecisions = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          domain: "infra",
          alternativesConsidered: 4,
          date: `2026-04-${String(10 + i).padStart(2, "0")}`,
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeDecision({
          domain: "infra",
          alternativesConsidered: 1,
          date: `2026-04-${String(15 + i).padStart(2, "0")}`,
        }),
      ),
    ];

    const patternsConsistent = detectPatterns({ decisions: consistentDecisions });
    const patternsMixed = detectPatterns({ decisions: mixedDecisions });

    const consistentMatch = patternsConsistent.find(
      (p) => p.category === "decision_style" && p.pattern.includes("alternatives"),
    );
    const mixedMatch = patternsMixed.find(
      (p) => p.category === "decision_style" && p.pattern.includes("alternatives"),
    );

    expect(consistentMatch).toBeDefined();
    expect(mixedMatch).toBeDefined();
    expect(consistentMatch!.confidence).toBeGreaterThan(mixedMatch!.confidence);
  });

  // T-190: returns no surfaceable patterns below 0.7 confidence
  it("T-190: returns no patterns below 0.7 confidence via surfaceablePatterns", () => {
    // Just 1 decision — not enough for confident patterns
    const decisions = [
      makeDecision({ domain: "frontend", alternativesConsidered: 4, date: "2026-04-15" }),
    ];

    const patterns = detectPatterns({ decisions });
    const surfaceable = surfaceablePatterns(patterns);

    // With only 1 observation, no pattern should reach 0.7 confidence
    expect(surfaceable.length).toBe(0);
  });

  // T-191: detects AI modification rate by domain
  it("T-191: detects AI modification rate by domain", () => {
    const input: PatternDetectorInput = {
      decisions: [makeDecision({ domain: "auth", date: "2026-04-15" })],
      aiStats: {
        acceptanceRate: 0.4,
        modificationRate: 0.6,
        byDomain: {
          auth: { acceptanceRate: 0.3, modificationRate: 0.7 },
        },
      },
    };

    const patterns = detectPatterns(input);
    const aiPattern = patterns.find(
      (p) => p.category === "ai_interaction" && p.pattern.includes("auth"),
    );
    expect(aiPattern).toBeDefined();
    expect(aiPattern!.pattern).toContain("modification");
  });

  it("returns empty array when no decisions provided", () => {
    const patterns = detectPatterns({ decisions: [] });
    expect(patterns).toEqual([]);
  });

  it("preserves existing patterns when merging", () => {
    const existingPatterns = [
      {
        pattern: "Existing pattern",
        confidence: 0.8,
        observedSince: "2026-04-01",
        lastObserved: "2026-04-10",
        examples: 5,
        category: "decision_style" as const,
      },
    ];

    const patterns = detectPatterns({
      decisions: [makeDecision()],
      existingPatterns,
    });

    const preserved = patterns.find((p) => p.pattern === "Existing pattern");
    expect(preserved).toBeDefined();
  });
});

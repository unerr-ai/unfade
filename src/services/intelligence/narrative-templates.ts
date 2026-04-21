// FILE: src/services/intelligence/narrative-templates.ts
// 11E.3: Causal narrative templates that map correlation pairs to human-readable explanations.
// Each template: trigger condition (which correlations/thresholds), claim format, severity, source attribution.
// Template-based — no LLM in the real-time path. <5ms per narrative.

import type { CorrelationPair } from "./cross-analyzer.js";

export type NarrativeSeverity = "info" | "warning" | "critical";

export interface NarrativeTemplate {
  id: string;
  /** Which correlation pair ID triggers this template */
  triggerCorrelation: string;
  /** Additional condition: correlation direction and minimum |r| */
  condition: (pair: CorrelationPair, analyzerData: Record<string, unknown>) => boolean;
  /** Format the claim string from correlation + analyzer data */
  formatClaim: (pair: CorrelationPair, analyzerData: Record<string, unknown>) => string;
  /** Severity derivation */
  severity: (pair: CorrelationPair, analyzerData: Record<string, unknown>) => NarrativeSeverity;
  /** Which analyzers this template draws from */
  sources: string[];
}

function getNestedValue(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export const narrativeTemplates: NarrativeTemplate[] = [
  // 1. Loop + Efficiency Drop
  {
    id: "loops-cause-efficiency-drop",
    triggerCorrelation: "efficiency-loops",
    condition: (pair) => pair.direction === "negative" && Math.abs(pair.r) >= 0.6,
    formatClaim: (pair, data) => {
      const loopCount = getNestedValue(data, "loop-detector.stuckLoops.length") ?? "multiple";
      return `Your efficiency dropped because the loop detector found ${loopCount} stuck sessions. Loops and efficiency are inversely correlated (r=${pair.r}).`;
    },
    severity: (pair) => (Math.abs(pair.r) >= 0.8 ? "critical" : "warning"),
    sources: ["efficiency", "loop-detector"],
  },

  // 2. Loops in Blind Spots
  {
    id: "stuck-in-weak-area",
    triggerCorrelation: "blindspots-loops",
    condition: (pair) => pair.direction === "positive" && pair.r >= 0.6,
    formatClaim: (pair, data) => {
      const blindSpots = getNestedValue(data, "comprehension-radar.blindSpots") as string[] | undefined;
      const area = blindSpots?.[0] ?? "areas with low comprehension";
      return `You're getting stuck where you're weakest. Failure rate is highest in ${area} — consider breaking problems in this area into smaller sub-tasks or pair-programming.`;
    },
    severity: () => "warning",
    sources: ["blind-spot-detector", "loop-detector", "comprehension-radar"],
  },

  // 3. Comprehension Improves Velocity
  {
    id: "understanding-speeds-you-up",
    triggerCorrelation: "comprehension-velocity",
    condition: (pair) => pair.direction === "positive" && pair.r >= 0.6,
    formatClaim: (pair) =>
      `Higher comprehension correlates with faster task completion (r=${pair.r}). Investing time understanding before implementing is paying off.`,
    severity: () => "info",
    sources: ["comprehension-radar", "velocity-tracker"],
  },

  // 4. Low Comprehension Slows You Down
  {
    id: "low-understanding-slows-work",
    triggerCorrelation: "comprehension-velocity",
    condition: (pair) => pair.direction === "negative" && Math.abs(pair.r) >= 0.6,
    formatClaim: (pair) =>
      `Low comprehension is correlated with slower task completion (r=${pair.r}). Sessions where you engage less deeply take more turns to reach acceptance.`,
    severity: (pair) => (Math.abs(pair.r) >= 0.8 ? "warning" : "info"),
    sources: ["comprehension-radar", "velocity-tracker"],
  },

  // 5. Cost + Abandoned = Spending on Dead Ends
  {
    id: "spending-on-dead-ends",
    triggerCorrelation: "cost-outcomes",
    condition: (pair) => pair.direction === "negative" && Math.abs(pair.r) >= 0.6,
    formatClaim: (pair, data) => {
      const waste = getNestedValue(data, "cost-attribution.abandonedWaste.estimatedCost") as number | undefined;
      const wasteStr = waste != null ? ` (~$${waste.toFixed(2)} on abandoned sessions)` : "";
      return `Higher spending doesn't produce better outcomes${wasteStr}. Consider shorter exploratory sessions before committing to a direction.`;
    },
    severity: (pair) => (Math.abs(pair.r) >= 0.8 ? "critical" : "warning"),
    sources: ["cost-attribution"],
  },

  // 6. Cost + Good Outcomes = Investment Paying Off
  {
    id: "investment-paying-off",
    triggerCorrelation: "cost-outcomes",
    condition: (pair) => pair.direction === "positive" && pair.r >= 0.6,
    formatClaim: (pair) =>
      `Your AI investment is correlating with better outcomes (r=${pair.r}). More thorough sessions tend to succeed.`,
    severity: () => "info",
    sources: ["cost-attribution"],
  },

  // 7. Efficiency Drop from Loops with Temporal Lag
  {
    id: "loops-precede-efficiency-drop",
    triggerCorrelation: "efficiency-loops",
    condition: (pair) => pair.direction === "negative" && pair.temporalLag > 0,
    formatClaim: (pair) =>
      `Loop spikes tend to precede efficiency drops by ~${Math.round(pair.temporalLag / 60)}h. Breaking out of loops earlier could prevent the downstream productivity hit.`,
    severity: () => "warning",
    sources: ["efficiency", "loop-detector"],
  },

  // 8. Velocity Drop in New Domain
  {
    id: "learning-curve-expected",
    triggerCorrelation: "comprehension-velocity",
    condition: (pair, data) => {
      const newDomains = getNestedValue(data, "comprehension-radar.byModule") as Record<string, { decisionsCount: number }> | undefined;
      if (!newDomains) return false;
      // Check if any module has < 10 events (new domain)
      return Object.values(newDomains).some((m) => m.decisionsCount < 10);
    },
    formatClaim: (_pair, data) => {
      const modules = getNestedValue(data, "comprehension-radar.byModule") as Record<string, { decisionsCount: number }> | undefined;
      const newOnes = modules
        ? Object.entries(modules)
            .filter(([, m]) => m.decisionsCount < 10)
            .map(([name]) => name)
        : [];
      const area = newOnes[0] ?? "a new area";
      return `Velocity is lower in ${area} — this is expected when entering a new domain. Comprehension will improve with more exposure.`;
    },
    severity: () => "info",
    sources: ["comprehension-radar", "velocity-tracker"],
  },

  // 9. Blind Spot + High Acceptance = Autopilot Risk
  {
    id: "autopilot-in-blind-spot",
    triggerCorrelation: "blindspots-loops",
    condition: (pair, data) => {
      const alerts = getNestedValue(data, "alerts.alerts") as Array<{ type: string }> | undefined;
      return pair.r >= 0.6 && (alerts?.some((a) => a.type === "high-acceptance") ?? false);
    },
    formatClaim: (_pair, data) => {
      const blindSpots = getNestedValue(data, "comprehension-radar.blindSpots") as string[] | undefined;
      const area = blindSpots?.[0] ?? "certain modules";
      return `High acceptance rate combined with blind spots in ${area}. You may be on autopilot — consider reviewing AI output more carefully in this area.`;
    },
    severity: () => "critical",
    sources: ["blind-spot-detector", "comprehension-radar"],
  },

  // 10. Efficiency Recovering
  {
    id: "efficiency-recovering",
    triggerCorrelation: "efficiency-loops",
    condition: (pair) => pair.direction === "positive" && pair.r >= 0.6,
    formatClaim: () =>
      "Loop resolution is correlating with efficiency improvements. Your debugging approach is getting more effective.",
    severity: () => "info",
    sources: ["efficiency", "loop-detector"],
  },

  // 11. Cost Efficiency Improving
  {
    id: "cost-efficiency-improving",
    triggerCorrelation: "cost-outcomes",
    condition: (pair, data) => {
      const wasteRatio = getNestedValue(data, "cost-attribution.wasteRatio") as number | null;
      return pair.direction === "positive" && (wasteRatio != null ? wasteRatio < 0.15 : false);
    },
    formatClaim: (_pair, data) => {
      const wasteRatio = getNestedValue(data, "cost-attribution.wasteRatio") as number | null;
      return `Cost efficiency is strong — waste ratio is ${wasteRatio != null ? Math.round(wasteRatio * 100) : "<15"}%. Your sessions are productive.`;
    },
    severity: () => "info",
    sources: ["cost-attribution"],
  },

  // 12. Comprehension Debt Warning
  {
    id: "comprehension-debt-accumulating",
    triggerCorrelation: "comprehension-velocity",
    condition: (pair, data) => {
      const overall = getNestedValue(data, "comprehension-radar.overall") as number | undefined;
      return pair.direction === "negative" && (overall != null ? overall < 40 : false);
    },
    formatClaim: (_pair, data) => {
      const overall = getNestedValue(data, "comprehension-radar.overall") as number | undefined;
      return `Comprehension debt is accumulating (overall score: ${overall ?? "low"}). Velocity will continue declining without deeper engagement. Consider reviewing AI-generated changes before accepting.`;
    },
    severity: () => "critical",
    sources: ["comprehension-radar", "velocity-tracker"],
  },
];

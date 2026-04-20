import type { IdentityLabel, ReasoningModelV2 } from "../../schemas/profile.js";

const MIN_DATA_DAYS = 14;

/**
 * Compute identity labels from the reasoning profile and current RDI.
 * Labels require 2+ weeks of data (dataPoints as proxy for days active).
 * Returns empty array if insufficient history.
 */
export function computeIdentityLabels(profile: ReasoningModelV2, rdi: number): IdentityLabel[] {
  if (profile.dataPoints < MIN_DATA_DAYS) return [];

  const labels: IdentityLabel[] = [];
  const now = new Date().toISOString().slice(0, 10);

  if (isThoroughExplorer(profile)) {
    labels.push({
      label: "Thorough Explorer",
      confidence: computeExplorerConfidence(profile),
      since: findEarliestPatternDate(profile, "exploration") ?? now,
      category: "exploration",
    });
  }

  if (isResilientThinker(profile)) {
    labels.push({
      label: "Resilient Thinker",
      confidence: 0.8,
      since: now,
      category: "decision_style",
    });
  }

  if (isDomainExpert(profile)) {
    const deepDomain = profile.domainDistribution.find((d) => d.depth === "deep");
    labels.push({
      label: "Domain Expert",
      confidence: 0.85,
      since: deepDomain?.lastSeen ?? now,
      category: "domain",
    });
  }

  if (isPatternSynthesizer(profile)) {
    labels.push({
      label: "Pattern Synthesizer",
      confidence: 0.75,
      since: now,
      category: "trade_off",
    });
  }

  if (rdi >= 70) {
    labels.push({
      label: "Architectural Thinker",
      confidence: Math.min(rdi / 100, 0.95),
      since: now,
      category: "decision_style",
    });
  }

  return labels;
}

// --- Detection rules per Section 13.2 ---

function isThoroughExplorer(profile: ReasoningModelV2): boolean {
  return profile.decisionStyle.avgAlternativesEvaluated > 3;
}

function computeExplorerConfidence(profile: ReasoningModelV2): number {
  const avg = profile.decisionStyle.avgAlternativesEvaluated;
  if (avg <= 3) return 0;
  return Math.min((avg - 3) / 2 + 0.7, 0.95);
}

function isResilientThinker(_profile: ReasoningModelV2): boolean {
  const explorationPatterns = _profile.patterns.filter(
    (p) => p.category === "exploration" && p.confidence > 0.7,
  );
  return explorationPatterns.length >= 2;
}

function isDomainExpert(profile: ReasoningModelV2): boolean {
  return profile.domainDistribution.some((d) => d.depth === "deep");
}

function isPatternSynthesizer(profile: ReasoningModelV2): boolean {
  const domains = profile.domainDistribution;
  if (domains.length < 2) return false;

  let crossDomainCount = 0;
  for (const d of domains) {
    if (d.avgAlternativesInDomain > 2 && d.frequency >= 3) {
      crossDomainCount++;
    }
  }

  return crossDomainCount >= 2;
}

function findEarliestPatternDate(profile: ReasoningModelV2, category: string): string | null {
  const matching = profile.patterns.filter((p) => p.category === category);
  if (matching.length === 0) return null;

  let earliest = matching[0].observedSince;
  for (const p of matching) {
    if (p.observedSince < earliest) earliest = p.observedSince;
  }
  return earliest;
}

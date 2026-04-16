// FILE: src/services/personalization/domain-tracker.ts
// UF-071: Domain tracker v2 — track expertise evolution over time.
// Pure function: Decision[] → DomainDistributionV2[].
// Tracks frequency, depth progression, depth trend, cross-domain connections.

import type { Decision } from "../../schemas/distill.js";
import type { DepthLevel, DepthTrend, DomainDistributionV2 } from "../../schemas/profile.js";

/**
 * Input for domain tracking — accumulated decisions with dates.
 */
export interface DomainTrackerInput {
  decisions: (Decision & { date: string })[];
  existingDomains?: DomainDistributionV2[];
}

/**
 * Cross-domain connection — two domains that appear together in decisions.
 */
export interface CrossDomainConnection {
  domainA: string;
  domainB: string;
  coOccurrences: number;
  sharedDates: string[];
}

// Thresholds for depth classification
const SHALLOW_MAX_DECISIONS = 5;
const MODERATE_MAX_DECISIONS = 15;
// Above MODERATE_MAX_DECISIONS → deep

const SHALLOW_MAX_AVG_ALTS = 1.5;
const MODERATE_MAX_AVG_ALTS = 3.0;
// Above MODERATE_MAX_AVG_ALTS → deep (by complexity)

/**
 * Determine depth level based on decision count and average alternatives.
 * Depth reflects both volume and complexity of reasoning in a domain.
 */
function classifyDepth(decisionCount: number, avgAlternatives: number): DepthLevel {
  // Use the higher of the two signals
  const byCount =
    decisionCount <= SHALLOW_MAX_DECISIONS
      ? "shallow"
      : decisionCount <= MODERATE_MAX_DECISIONS
        ? "moderate"
        : "deep";

  const byComplexity =
    avgAlternatives <= SHALLOW_MAX_AVG_ALTS
      ? "shallow"
      : avgAlternatives <= MODERATE_MAX_AVG_ALTS
        ? "moderate"
        : "deep";

  const depthOrder: DepthLevel[] = ["shallow", "moderate", "deep"];
  const byCountIdx = depthOrder.indexOf(byCount);
  const byComplexityIdx = depthOrder.indexOf(byComplexity);

  return depthOrder[Math.max(byCountIdx, byComplexityIdx)];
}

/**
 * Determine depth trend by comparing current depth to existing depth.
 * Also considers frequency changes.
 */
function classifyTrend(
  current: { depth: DepthLevel; frequency: number },
  existing?: DomainDistributionV2,
): DepthTrend {
  if (!existing) return "stable"; // New domain — no trend yet

  const depthOrder: DepthLevel[] = ["shallow", "moderate", "deep"];
  const currentIdx = depthOrder.indexOf(current.depth);
  const existingIdx = depthOrder.indexOf(existing.depth);

  if (currentIdx > existingIdx) return "deepening";

  // Check if frequency is growing significantly (broadening = more frequent usage)
  const frequencyGrowth = current.frequency / (existing.frequency || 1);
  if (frequencyGrowth > 1.5 && currentIdx >= existingIdx) return "broadening";

  return "stable";
}

/**
 * Track domain distribution from accumulated decisions.
 * Returns domains with frequency, depth, depth trend, and average alternatives.
 */
export function trackDomains(input: DomainTrackerInput): DomainDistributionV2[] {
  const domainMap = new Map<
    string,
    { frequency: number; alternatives: number[]; dates: string[] }
  >();

  for (const d of input.decisions) {
    const domain = d.domain ?? "general";
    if (!domainMap.has(domain)) {
      domainMap.set(domain, { frequency: 0, alternatives: [], dates: [] });
    }
    const entry = domainMap.get(domain)!;
    entry.frequency += 1;
    entry.alternatives.push(d.alternativesConsidered ?? 0);
    if (!entry.dates.includes(d.date)) {
      entry.dates.push(d.date);
    }
  }

  const totalDecisions = input.decisions.length || 1;
  const existingMap = new Map<string, DomainDistributionV2>();
  if (input.existingDomains) {
    for (const d of input.existingDomains) {
      existingMap.set(d.domain, d);
    }
  }

  const results: DomainDistributionV2[] = [];

  for (const [domain, data] of domainMap) {
    const avgAlts =
      data.alternatives.length > 0
        ? data.alternatives.reduce((a, b) => a + b, 0) / data.alternatives.length
        : 0;

    // Merge frequency with existing
    const existing = existingMap.get(domain);
    const mergedFrequency = existing ? existing.frequency + data.frequency : data.frequency;

    const depth = classifyDepth(mergedFrequency, avgAlts);
    const trend = classifyTrend({ depth, frequency: mergedFrequency }, existing);

    const lastDate = data.dates.sort().pop() ?? "";

    results.push({
      domain,
      frequency: mergedFrequency,
      percentageOfTotal: data.frequency / totalDecisions,
      lastSeen: existing && existing.lastSeen > lastDate ? existing.lastSeen : lastDate,
      depth,
      depthTrend: trend,
      avgAlternativesInDomain: avgAlts,
    });
  }

  // Include existing domains not seen in new decisions (with decayed percentageOfTotal)
  for (const [domain, existing] of existingMap) {
    if (!domainMap.has(domain)) {
      results.push({
        ...existing,
        percentageOfTotal: 0, // Not seen in this batch
      });
    }
  }

  // Sort by frequency descending
  results.sort((a, b) => b.frequency - a.frequency);

  return results;
}

/**
 * Detect cross-domain connections — domains that co-occur on the same dates.
 */
export function detectCrossDomainConnections(
  decisions: (Decision & { date: string })[],
): CrossDomainConnection[] {
  // Group domains by date
  const dateTodomains = new Map<string, Set<string>>();

  for (const d of decisions) {
    const domain = d.domain ?? "general";
    if (!dateTodomains.has(d.date)) dateTodomains.set(d.date, new Set());
    dateTodomains.get(d.date)!.add(domain);
  }

  // Count co-occurrences
  const coOccurrences = new Map<string, { count: number; dates: string[] }>();

  for (const [date, domains] of dateTodomains) {
    const domainList = Array.from(domains).sort();
    for (let i = 0; i < domainList.length; i++) {
      for (let j = i + 1; j < domainList.length; j++) {
        const key = `${domainList[i]}|${domainList[j]}`;
        if (!coOccurrences.has(key)) coOccurrences.set(key, { count: 0, dates: [] });
        const entry = coOccurrences.get(key)!;
        entry.count += 1;
        entry.dates.push(date);
      }
    }
  }

  const results: CrossDomainConnection[] = [];

  for (const [key, data] of coOccurrences) {
    if (data.count < 2) continue; // Need at least 2 co-occurrences
    const [domainA, domainB] = key.split("|");
    results.push({
      domainA,
      domainB,
      coOccurrences: data.count,
      sharedDates: data.dates,
    });
  }

  return results.sort((a, b) => b.coOccurrences - a.coOccurrences);
}

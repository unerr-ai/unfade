// FILE: src/services/personalization/pattern-detector.ts
// UF-070: Pattern detector v2 — analyze accumulated decisions for recurring
// reasoning patterns. Pure function: Decision[] → PatternV2[].
// Patterns only surface at >0.7 confidence.

import type { Decision, TradeOff } from "../../schemas/distill.js";
import type { PatternCategory, PatternV2 } from "../../schemas/profile.js";

/**
 * Input for pattern detection — accumulated decisions and optional trade-offs
 * from multiple distills.
 */
export interface PatternDetectorInput {
  decisions: (Decision & { date: string })[];
  tradeOffs?: (TradeOff & { date: string })[];
  aiStats?: {
    acceptanceRate: number;
    modificationRate: number;
    byDomain: Record<string, { acceptanceRate: number; modificationRate: number }>;
  };
  existingPatterns?: PatternV2[];
}

const CONFIDENCE_THRESHOLD = 0.7;
const MIN_OBSERVATIONS = 3;

/**
 * Compute confidence based on supporting and contradicting evidence.
 * More examples increase confidence; contradictions decrease it.
 */
function computeConfidence(supporting: number, contradicting: number): number {
  if (supporting === 0) return 0;
  const total = supporting + contradicting;
  const baseConfidence = supporting / total;
  // Scale confidence up with more observations (asymptotic to baseConfidence)
  const scaleFactor = 1 - 1 / (1 + total / MIN_OBSERVATIONS);
  return baseConfidence * scaleFactor;
}

/**
 * Merge a new pattern candidate with existing patterns.
 * If a matching pattern exists, update its confidence and examples count.
 */
function mergePattern(
  existing: PatternV2[],
  candidate: {
    pattern: string;
    confidence: number;
    examples: number;
    category: PatternCategory;
    date: string;
  },
): PatternV2 | null {
  const match = existing.find(
    (p) => p.pattern === candidate.pattern && p.category === candidate.category,
  );

  if (match) {
    // Existing pattern — update with new evidence
    const updated: PatternV2 = {
      ...match,
      confidence: candidate.confidence,
      examples: candidate.examples,
      lastObserved: candidate.date > match.lastObserved ? candidate.date : match.lastObserved,
    };
    return updated;
  }

  // New pattern
  return {
    pattern: candidate.pattern,
    confidence: candidate.confidence,
    observedSince: candidate.date,
    lastObserved: candidate.date,
    examples: candidate.examples,
    category: candidate.category,
  };
}

/**
 * Detect "high alternatives evaluator" patterns by domain.
 * When a developer consistently evaluates 3+ alternatives in a domain.
 */
function detectAlternativesPatterns(decisions: (Decision & { date: string })[]): {
  pattern: string;
  confidence: number;
  examples: number;
  category: PatternCategory;
  date: string;
}[] {
  const byDomain = new Map<string, { alts: number[]; dates: string[] }>();

  for (const d of decisions) {
    const domain = d.domain ?? "general";
    if (!byDomain.has(domain)) byDomain.set(domain, { alts: [], dates: [] });
    const entry = byDomain.get(domain);
    if (!entry) continue;
    entry.alts.push(d.alternativesConsidered ?? 0);
    entry.dates.push(d.date);
  }

  const results: {
    pattern: string;
    confidence: number;
    examples: number;
    category: PatternCategory;
    date: string;
  }[] = [];

  for (const [domain, data] of byDomain) {
    const highAlts = data.alts.filter((a) => a >= 3);
    const lowAlts = data.alts.filter((a) => a < 3);
    const confidence = computeConfidence(highAlts.length, lowAlts.length);

    if (highAlts.length >= MIN_OBSERVATIONS) {
      const avg = data.alts.reduce((a, b) => a + b, 0) / data.alts.length;
      results.push({
        pattern: `Evaluates ${avg.toFixed(1)}+ alternatives for ${domain} decisions`,
        confidence,
        examples: highAlts.length,
        category: "decision_style",
        date: data.dates[data.dates.length - 1],
      });
    }
  }

  return results;
}

/**
 * Detect trade-off preference patterns from consistent choices.
 */
function detectTradeOffPatterns(tradeOffs: (TradeOff & { date: string })[]): {
  pattern: string;
  confidence: number;
  examples: number;
  category: PatternCategory;
  date: string;
}[] {
  // Group by normalized preference key (chose/rejected pairs)
  const prefMap = new Map<string, { supporting: number; contradicting: number; dates: string[] }>();

  for (const t of tradeOffs) {
    const chose = t.chose.toLowerCase().trim();
    const rejected = t.rejected.toLowerCase().trim();
    const key = `${chose} over ${rejected}`;
    const reverseKey = `${rejected} over ${chose}`;

    if (!prefMap.has(key) && !prefMap.has(reverseKey)) {
      prefMap.set(key, { supporting: 0, contradicting: 0, dates: [] });
    }

    if (prefMap.has(key)) {
      const entry = prefMap.get(key);
      if (entry) {
        entry.supporting += 1;
        entry.dates.push(t.date);
      }
    } else if (prefMap.has(reverseKey)) {
      const entry = prefMap.get(reverseKey);
      if (entry) {
        entry.contradicting += 1;
        entry.dates.push(t.date);
      }
    }
  }

  const results: {
    pattern: string;
    confidence: number;
    examples: number;
    category: PatternCategory;
    date: string;
  }[] = [];

  for (const [preference, data] of prefMap) {
    const confidence = computeConfidence(data.supporting, data.contradicting);
    if (data.supporting >= MIN_OBSERVATIONS) {
      results.push({
        pattern: `Favors ${preference}`,
        confidence,
        examples: data.supporting,
        category: "trade_off",
        date: data.dates[data.dates.length - 1],
      });
    }
  }

  return results;
}

/**
 * Detect AI interaction patterns by domain.
 */
function detectAiPatterns(aiStats: NonNullable<PatternDetectorInput["aiStats"]>): {
  pattern: string;
  confidence: number;
  examples: number;
  category: PatternCategory;
  date: string;
}[] {
  const results: {
    pattern: string;
    confidence: number;
    examples: number;
    category: PatternCategory;
    date: string;
  }[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Overall AI modification pattern
  if (aiStats.modificationRate > 0.5) {
    results.push({
      pattern: `Modifies ${Math.round(aiStats.modificationRate * 100)}% of AI suggestions`,
      confidence: 0.8,
      examples: 1,
      category: "ai_interaction",
      date: today,
    });
  }

  // Per-domain AI modification patterns
  for (const [domain, stats] of Object.entries(aiStats.byDomain)) {
    if (stats.modificationRate > 0.5) {
      results.push({
        pattern: `High AI modification rate in ${domain} (${Math.round(stats.modificationRate * 100)}%)`,
        confidence: 0.75,
        examples: 1,
        category: "ai_interaction",
        date: today,
      });
    }
  }

  return results;
}

/**
 * Detect exploration depth patterns — domains where the developer
 * spends significantly more or less exploration effort.
 */
function detectExplorationPatterns(decisions: (Decision & { date: string })[]): {
  pattern: string;
  confidence: number;
  examples: number;
  category: PatternCategory;
  date: string;
}[] {
  const byDomain = new Map<string, number[]>();

  for (const d of decisions) {
    const domain = d.domain ?? "general";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)?.push(d.alternativesConsidered ?? 0);
  }

  // Calculate overall average
  const allAlts = decisions.map((d) => d.alternativesConsidered ?? 0);
  if (allAlts.length === 0) return [];
  const overallAvg = allAlts.reduce((a, b) => a + b, 0) / allAlts.length;
  if (overallAvg === 0) return [];

  const results: {
    pattern: string;
    confidence: number;
    examples: number;
    category: PatternCategory;
    date: string;
  }[] = [];

  for (const [domain, alts] of byDomain) {
    if (alts.length < MIN_OBSERVATIONS) continue;
    const domainAvg = alts.reduce((a, b) => a + b, 0) / alts.length;
    const ratio = domainAvg / overallAvg;

    if (ratio >= 1.5) {
      results.push({
        pattern: `Deep explorer in ${domain} — ${ratio.toFixed(1)}x more alternatives than average`,
        confidence: computeConfidence(alts.length, 0),
        examples: alts.length,
        category: "exploration",
        date: decisions.filter((d) => (d.domain ?? "general") === domain).slice(-1)[0].date,
      });
    }
  }

  return results;
}

/**
 * Detect patterns from accumulated decision history.
 * Returns all patterns with their confidence scores.
 * Only patterns with confidence > 0.7 are considered "surfaceable",
 * but all are returned for profile storage (lower confidence patterns
 * can strengthen over time).
 */
export function detectPatterns(input: PatternDetectorInput): PatternV2[] {
  const candidates: {
    pattern: string;
    confidence: number;
    examples: number;
    category: PatternCategory;
    date: string;
  }[] = [];

  // 1. Decision breadth / alternatives patterns
  candidates.push(...detectAlternativesPatterns(input.decisions));

  // 2. Trade-off preference patterns
  if (input.tradeOffs && input.tradeOffs.length > 0) {
    candidates.push(...detectTradeOffPatterns(input.tradeOffs));
  }

  // 3. AI interaction patterns
  if (input.aiStats) {
    candidates.push(...detectAiPatterns(input.aiStats));
  }

  // 4. Exploration depth patterns
  candidates.push(...detectExplorationPatterns(input.decisions));

  // Merge with existing patterns
  const existing = input.existingPatterns ?? [];
  const merged = new Map<string, PatternV2>();

  // Start with existing patterns
  for (const p of existing) {
    merged.set(`${p.category}:${p.pattern}`, p);
  }

  // Merge candidates
  for (const c of candidates) {
    const result = mergePattern(existing, c);
    if (result) {
      merged.set(`${result.category}:${result.pattern}`, result);
    }
  }

  // Apply confidence reduction for existing patterns not seen in new data
  // (contradicting evidence effect)
  for (const [key, p] of merged) {
    const wasInCandidates = candidates.some(
      (c) => c.category === p.category && c.pattern === p.pattern,
    );
    if (
      !wasInCandidates &&
      existing.some((e) => e.category === p.category && e.pattern === p.pattern)
    ) {
      // Existing pattern not reinforced — slight confidence decay
      merged.set(key, { ...p, confidence: p.confidence * 0.95 });
    }
  }

  return Array.from(merged.values());
}

/**
 * Filter patterns to only those above the confidence threshold.
 * Use this for user-facing display.
 */
export function surfaceablePatterns(patterns: PatternV2[]): PatternV2[] {
  return patterns.filter((p) => p.confidence >= CONFIDENCE_THRESHOLD);
}

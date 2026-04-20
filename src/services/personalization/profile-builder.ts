// FILE: src/services/personalization/profile-builder.ts
// UF-041 (v1) + UF-072 (v2): Personalization profile builder.
// v1: Basic profile with running averages from distill signals.
// v2: Full personalization — pattern detector + domain tracker + temporal decay.
// After distillation, updates .unfade/profile/reasoning_model.json.
// Atomic write (tmp + rename) — never partial JSON.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyDistill, ExtractedSignals } from "../../schemas/distill.js";
import type {
  DomainDistributionV2,
  PatternV2,
  ReasoningModelV2,
  TradeOffPreference,
} from "../../schemas/profile.js";
import { logger } from "../../utils/logger.js";
import { getProfileDir } from "../../utils/paths.js";
import { trackDomains } from "./domain-tracker.js";
import { detectPatterns } from "./pattern-detector.js";

export interface DomainEntry {
  domain: string;
  frequency: number;
  lastSeen: string;
}

export interface ReasoningProfile {
  version: 1;
  updatedAt: string;
  distillCount: number;
  avgAlternativesEvaluated: number;
  aiAcceptanceRate: number;
  aiModificationRate: number;
  avgDecisionsPerDay: number;
  avgDeadEndsPerDay: number;
  domainDistribution: DomainEntry[];
  patterns: string[];
}

function defaultProfile(): ReasoningProfile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    distillCount: 0,
    avgAlternativesEvaluated: 0,
    aiAcceptanceRate: 0,
    aiModificationRate: 0,
    avgDecisionsPerDay: 0,
    avgDeadEndsPerDay: 0,
    domainDistribution: [],
    patterns: [],
  };
}

function loadProfile(profilePath: string): ReasoningProfile {
  if (!existsSync(profilePath)) return defaultProfile();

  try {
    const raw = readFileSync(profilePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ReasoningProfile>;
    const d = defaultProfile();
    return {
      ...d,
      ...parsed,
      version: 1,
      domainDistribution: Array.isArray(parsed.domainDistribution)
        ? parsed.domainDistribution
        : [...d.domainDistribution],
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [...d.patterns],
    };
  } catch {
    logger.warn("Could not read reasoning_model.json, starting fresh");
    return defaultProfile();
  }
}

/**
 * Incrementally update a running average.
 * newAvg = oldAvg + (newValue - oldAvg) / newCount
 */
function updateAverage(oldAvg: number, newValue: number, newCount: number): number {
  if (newCount <= 0) return oldAvg;
  return oldAvg + (newValue - oldAvg) / newCount;
}

/**
 * Detect patterns from the distill and signals (v1 logic).
 */
function detectPatternsV1(
  distill: DailyDistill,
  signals: ExtractedSignals,
  existing: string[],
): string[] {
  const patterns = new Set(existing);

  // Pattern: explores multiple alternatives for certain domains
  const altsPerDomain = new Map<string, number[]>();
  for (const d of distill.decisions) {
    const domain = d.domain ?? "general";
    if (!altsPerDomain.has(domain)) altsPerDomain.set(domain, []);
    altsPerDomain.get(domain)?.push(d.alternativesConsidered ?? 0);
  }
  for (const [domain, alts] of altsPerDomain) {
    const avg = alts.reduce((a, b) => a + b, 0) / alts.length;
    if (avg >= 3) {
      patterns.add(`Explores 3+ alternatives for ${domain} decisions`);
    }
  }

  // Pattern: high AI acceptance
  if (signals.stats.aiCompletions + signals.stats.aiRejections >= 5) {
    const total = signals.stats.aiCompletions + signals.stats.aiRejections;
    const rate = signals.stats.aiCompletions / total;
    if (rate >= 0.8) {
      patterns.add("High AI suggestion acceptance (80%+)");
    } else if (rate <= 0.3) {
      patterns.add("Selective AI usage — rejects most suggestions");
    }
  }

  // Pattern: debugging persistence
  if (signals.debuggingSessions.length > 0) {
    const totalFixes = signals.debuggingSessions.reduce((s, d) => s + d.fixCount, 0);
    if (totalFixes >= 5) {
      patterns.add("Persistent debugger — iterates through fix cycles");
    }
  }

  // Pattern: dead-end recovery
  if ((distill.deadEnds?.length ?? 0) >= 2) {
    patterns.add("Willing to revert and explore alternative approaches");
  }

  // Pattern: multi-domain work
  if ((distill.domains?.length ?? 0) >= 4) {
    patterns.add("Polyglot developer — works across 4+ domains in a day");
  }

  return Array.from(patterns);
}

/**
 * Update the reasoning profile after distillation.
 * Reads existing profile, computes incremental updates, writes atomically.
 */
export function updateProfile(
  distill: DailyDistill,
  signals: ExtractedSignals,
  cwd?: string,
): ReasoningProfile {
  const profileDir = getProfileDir(cwd);
  mkdirSync(profileDir, { recursive: true });

  const profilePath = join(profileDir, "reasoning_model.json");
  if (existsSync(profilePath)) {
    try {
      const parsed = JSON.parse(readFileSync(profilePath, "utf-8")) as { version?: number };
      if (parsed.version === 2) {
        logger.debug("Skipping v1 profile write — v2 reasoning_model.json on disk");
        return defaultProfile();
      }
    } catch {
      // fall through to loadProfile
    }
  }

  const profile = loadProfile(profilePath);

  // Increment distill count
  profile.distillCount += 1;
  const n = profile.distillCount;

  // Update running averages
  const avgAlts =
    distill.decisions.length > 0
      ? distill.decisions.reduce((s, d) => s + (d.alternativesConsidered ?? 0), 0) /
        distill.decisions.length
      : 0;
  profile.avgAlternativesEvaluated = updateAverage(profile.avgAlternativesEvaluated, avgAlts, n);

  // AI acceptance rate
  const totalAi = signals.stats.aiCompletions + signals.stats.aiRejections;
  if (totalAi > 0) {
    const dayRate = signals.stats.aiCompletions / totalAi;
    profile.aiAcceptanceRate = updateAverage(profile.aiAcceptanceRate, dayRate, n);
  }

  // Decisions per day
  profile.avgDecisionsPerDay = updateAverage(
    profile.avgDecisionsPerDay,
    distill.decisions.length,
    n,
  );

  // Dead ends per day
  profile.avgDeadEndsPerDay = updateAverage(
    profile.avgDeadEndsPerDay,
    distill.deadEnds?.length ?? 0,
    n,
  );

  // Domain distribution
  for (const domain of distill.domains ?? []) {
    const existing = profile.domainDistribution.find((d) => d.domain === domain);
    if (existing) {
      existing.frequency += 1;
      existing.lastSeen = distill.date;
    } else {
      profile.domainDistribution.push({
        domain,
        frequency: 1,
        lastSeen: distill.date,
      });
    }
  }
  // Sort by frequency descending
  profile.domainDistribution.sort((a, b) => b.frequency - a.frequency);

  // Detect patterns
  profile.patterns = detectPatternsV1(distill, signals, profile.patterns);

  // Metadata
  profile.updatedAt = new Date().toISOString();

  // Atomic write: tmp file → rename
  const tmpPath = `${profilePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, profilePath);

  logger.debug("Updated reasoning profile", {
    distillCount: n,
    patterns: profile.patterns.length,
  });

  return profile;
}

// ---------------------------------------------------------------------------
// v2 Profile Builder (UF-072)
// ---------------------------------------------------------------------------

/**
 * Default v2 profile — all fields initialized to empty/zero.
 */
function defaultProfileV2(): ReasoningModelV2 {
  return {
    version: 2,
    lastUpdated: new Date().toISOString(),
    dataPoints: 0,
    decisionStyle: {
      avgAlternativesEvaluated: 0,
      medianAlternativesEvaluated: 0,
      explorationDepthMinutes: { overall: 0, byDomain: {} },
      aiAcceptanceRate: 0,
      aiModificationRate: 0,
      aiModificationByDomain: {},
    },
    tradeOffPreferences: [],
    domainDistribution: [],
    patterns: [],
    temporalPatterns: {
      mostProductiveHours: [],
      avgDecisionsPerDay: 0,
      peakDecisionDays: [],
    },
  };
}

/**
 * Merge a partial v2 JSON object with defaults so profile updates never throw on missing arrays.
 */
function coerceReasoningModelV2(parsed: Partial<ReasoningModelV2>): ReasoningModelV2 {
  const d = defaultProfileV2();
  const ds = { ...d.decisionStyle, ...parsed.decisionStyle };
  const tp = { ...d.temporalPatterns, ...parsed.temporalPatterns };
  return {
    ...d,
    ...parsed,
    version: 2,
    decisionStyle: {
      ...ds,
      explorationDepthMinutes: {
        ...d.decisionStyle.explorationDepthMinutes,
        ...parsed.decisionStyle?.explorationDepthMinutes,
      },
    },
    tradeOffPreferences: Array.isArray(parsed.tradeOffPreferences)
      ? parsed.tradeOffPreferences
      : d.tradeOffPreferences,
    domainDistribution: Array.isArray(parsed.domainDistribution)
      ? parsed.domainDistribution
      : d.domainDistribution,
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns : d.patterns,
    temporalPatterns: {
      ...tp,
      peakDecisionDays: Array.isArray(parsed.temporalPatterns?.peakDecisionDays)
        ? parsed.temporalPatterns?.peakDecisionDays
        : d.temporalPatterns.peakDecisionDays,
      mostProductiveHours: Array.isArray(parsed.temporalPatterns?.mostProductiveHours)
        ? parsed.temporalPatterns?.mostProductiveHours
        : d.temporalPatterns.mostProductiveHours,
    },
  };
}

/**
 * Load a v2 profile from disk. Returns null if not found or if v1.
 */
function loadProfileV2(profilePath: string): ReasoningModelV2 | null {
  if (!existsSync(profilePath)) return null;

  try {
    const raw = readFileSync(profilePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version === 2) return coerceReasoningModelV2(parsed as Partial<ReasoningModelV2>);
    return null; // v1 profile — not loaded as v2
  } catch {
    return null;
  }
}

/**
 * Incrementally update a running average with temporal decay.
 * Recent data weighted 2x (decayWeight controls this).
 */
function updateAverageWithDecay(
  oldAvg: number,
  newValue: number,
  newCount: number,
  decayWeight: number = 2,
): number {
  if (newCount <= 0) return oldAvg;
  if (newCount === 1) return newValue;
  // Weighted update: new data gets decayWeight, old data gets 1
  const totalWeight = 1 + decayWeight;
  return (oldAvg + decayWeight * newValue) / totalWeight;
}

/**
 * Compute median from an array of numbers.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Detect trade-off preferences from accumulated trade-offs.
 * Merges with existing preferences, applying temporal decay.
 */
function detectTradeOffPreferences(
  tradeOffs: { chose: string; rejected: string; date: string }[],
  existing: TradeOffPreference[],
): TradeOffPreference[] {
  const prefMap = new Map<string, TradeOffPreference>();

  // Load existing preferences
  for (const p of existing) {
    prefMap.set(p.preference, { ...p });
  }

  // Process new trade-offs
  for (const t of tradeOffs) {
    const chose = t.chose.toLowerCase().trim();
    const rejected = t.rejected.toLowerCase().trim();
    const key = `${chose} over ${rejected}`;
    const reverseKey = `${rejected} over ${chose}`;

    if (prefMap.has(reverseKey)) {
      // Contradicting evidence
      const entry = prefMap.get(reverseKey);
      if (!entry) continue;
      entry.contradictingDecisions += 1;
      entry.lastObserved = t.date > entry.lastObserved ? t.date : entry.lastObserved;
      const total = entry.supportingDecisions + entry.contradictingDecisions;
      entry.confidence = entry.supportingDecisions / total;
    } else {
      const entry = prefMap.get(key);
      if (entry) {
        entry.supportingDecisions += 1;
        entry.lastObserved = t.date > entry.lastObserved ? t.date : entry.lastObserved;
        const total = entry.supportingDecisions + entry.contradictingDecisions;
        entry.confidence = entry.supportingDecisions / total;
      } else {
        prefMap.set(key, {
          preference: key,
          confidence: 1,
          supportingDecisions: 1,
          contradictingDecisions: 0,
          firstObserved: t.date,
          lastObserved: t.date,
        });
      }
    }
  }

  return Array.from(prefMap.values());
}

/**
 * Build or update a v2 reasoning profile from a daily distill and extracted signals.
 * Orchestrates pattern detector + domain tracker, merges with existing profile,
 * applies temporal decay, and writes atomically to disk.
 */
export function updateProfileV2(
  distill: DailyDistill,
  signals: ExtractedSignals,
  cwd?: string,
): ReasoningModelV2 {
  const profileDir = getProfileDir(cwd);
  mkdirSync(profileDir, { recursive: true });

  const profilePath = join(profileDir, "reasoning_model.json");
  const existing = loadProfileV2(profilePath);
  const profile = existing ?? defaultProfileV2();

  // Increment data points
  profile.dataPoints += distill.decisions.length;
  const n = profile.dataPoints;

  // --- Decision Style ---
  const decisionAlts = distill.decisions.map((d) => d.alternativesConsidered ?? 0);
  const newAvgAlts =
    decisionAlts.length > 0 ? decisionAlts.reduce((a, b) => a + b, 0) / decisionAlts.length : 0;

  profile.decisionStyle.avgAlternativesEvaluated = updateAverageWithDecay(
    profile.decisionStyle.avgAlternativesEvaluated,
    newAvgAlts,
    n,
  );

  // Median: merge with existing (approximate — track all values would be too heavy)
  profile.decisionStyle.medianAlternativesEvaluated = updateAverageWithDecay(
    profile.decisionStyle.medianAlternativesEvaluated,
    median(decisionAlts),
    n,
  );

  // AI rates
  const totalAi = signals.stats.aiCompletions + signals.stats.aiRejections;
  if (totalAi > 0) {
    const dayAcceptance = signals.stats.aiCompletions / totalAi;
    profile.decisionStyle.aiAcceptanceRate = updateAverageWithDecay(
      profile.decisionStyle.aiAcceptanceRate,
      dayAcceptance,
      n,
    );
  }

  // --- Pattern Detection ---
  const decisionsWithDates = distill.decisions.map((d) => ({ ...d, date: distill.date }));
  const tradeOffsWithDates = (distill.tradeOffs ?? []).map((t) => ({ ...t, date: distill.date }));

  const detectedPatterns = detectPatterns({
    decisions: decisionsWithDates,
    tradeOffs: tradeOffsWithDates,
    aiStats:
      totalAi > 0
        ? {
            acceptanceRate: signals.stats.aiCompletions / totalAi,
            modificationRate: profile.decisionStyle.aiModificationRate,
            byDomain: {},
          }
        : undefined,
    existingPatterns: profile.patterns,
  });
  profile.patterns = detectedPatterns;

  // --- Domain Tracking ---
  const trackedDomains = trackDomains({
    decisions: decisionsWithDates,
    existingDomains: profile.domainDistribution,
  });
  profile.domainDistribution = trackedDomains;

  // --- Trade-off Preferences ---
  if (tradeOffsWithDates.length > 0) {
    profile.tradeOffPreferences = detectTradeOffPreferences(
      tradeOffsWithDates,
      profile.tradeOffPreferences,
    );
  }

  // --- Temporal Patterns ---
  profile.temporalPatterns.avgDecisionsPerDay = updateAverageWithDecay(
    profile.temporalPatterns.avgDecisionsPerDay,
    distill.decisions.length,
    n,
  );

  // Track peak days (keep top 10)
  if (distill.decisions.length >= 5) {
    if (!profile.temporalPatterns.peakDecisionDays.includes(distill.date)) {
      profile.temporalPatterns.peakDecisionDays.push(distill.date);
      profile.temporalPatterns.peakDecisionDays.sort().reverse();
      if (profile.temporalPatterns.peakDecisionDays.length > 10) {
        profile.temporalPatterns.peakDecisionDays.length = 10;
      }
    }
  }

  // --- Direction Patterns (from AI session HDS data) ---
  if (distill.directionSummary) {
    const ds = distill.directionSummary;
    const existing = profile.directionPatterns ?? {
      runningAverageHDS: 0,
      trend: "stable" as const,
      commonSignals: [],
      byDomain: {},
      dataPoints: 0,
    };

    const newDp = existing.dataPoints + 1;
    const decayWeight = Math.min(newDp, 30);
    existing.runningAverageHDS =
      (existing.runningAverageHDS * (decayWeight - 1) + ds.averageHDS) / decayWeight;

    if (newDp >= 7) {
      if (ds.averageHDS > existing.runningAverageHDS + 0.05) existing.trend = "improving";
      else if (ds.averageHDS < existing.runningAverageHDS - 0.05) existing.trend = "declining";
      else existing.trend = "stable";
    }

    const signals: string[] = [];
    if (ds.humanDirectedCount > ds.collaborativeCount) signals.push("strong-direction");
    if (ds.collaborativeCount > ds.humanDirectedCount) signals.push("collaborative-style");
    if (ds.llmDirectedCount > 0) signals.push("ai-delegation");
    existing.commonSignals = signals;

    for (const dec of distill.decisions) {
      if (!dec.domain) continue;
      const domEntry = existing.byDomain[dec.domain] ?? { avgHDS: 0, decisionCount: 0 };
      const dc = domEntry.decisionCount + 1;
      domEntry.avgHDS = (domEntry.avgHDS * (dc - 1) + ds.averageHDS) / dc;
      domEntry.decisionCount = dc;
      existing.byDomain[dec.domain] = domEntry;
    }

    existing.dataPoints = newDp;
    profile.directionPatterns = existing;
  }

  // Metadata
  profile.lastUpdated = new Date().toISOString();

  // Atomic write
  const tmpPath = `${profilePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, profilePath);

  logger.debug("Updated reasoning profile v2", {
    dataPoints: n,
    patterns: profile.patterns.length,
    domains: profile.domainDistribution.length,
  });

  return profile;
}

/**
 * Build a v2 profile from components (used by migration and direct callers).
 * Does NOT read/write disk — pure computation.
 */
export function buildProfileV2(
  patterns: PatternV2[],
  domains: DomainDistributionV2[],
  tradeOffPreferences: TradeOffPreference[],
  decisionStyle: ReasoningModelV2["decisionStyle"],
  temporalPatterns: ReasoningModelV2["temporalPatterns"],
  dataPoints: number,
): ReasoningModelV2 {
  return {
    version: 2,
    lastUpdated: new Date().toISOString(),
    dataPoints,
    decisionStyle,
    tradeOffPreferences,
    domainDistribution: domains,
    patterns,
    temporalPatterns,
  };
}

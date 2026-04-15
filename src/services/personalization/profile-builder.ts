// FILE: src/services/personalization/profile-builder.ts
// UF-041: Personalization seed / profile builder.
// After distillation, extracts patterns from signals and updates
// .unfade/profile/reasoning_model.json with running averages.
// Atomic write (tmp + rename) — never partial JSON.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyDistill, ExtractedSignals } from "../../schemas/distill.js";
import { logger } from "../../utils/logger.js";
import { getProfileDir } from "../../utils/paths.js";

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
    return JSON.parse(raw) as ReasoningProfile;
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
 * Detect patterns from the distill and signals.
 */
function detectPatterns(
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
  profile.patterns = detectPatterns(distill, signals, profile.patterns);

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

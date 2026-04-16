// FILE: src/config/migrations.ts
// UF-077: Profile migration v1 → v2.
// Reads v1 reasoning_model.json, computes v2 fields from available data,
// writes v2 profile and preserves v1 as backup. Non-destructive.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasoningModelV2 } from "../schemas/profile.js";
import type { DomainEntry, ReasoningProfile } from "../services/personalization/profile-builder.js";
import { logger } from "../utils/logger.js";
import { getProfileDir } from "../utils/paths.js";

/**
 * Migrate a v1 DomainEntry to v2 DomainDistributionV2 format.
 */
function migrateDomainEntry(
  entry: DomainEntry,
  totalFrequency: number,
): ReasoningModelV2["domainDistribution"][number] {
  // Estimate depth from frequency alone (we don't have alternatives data from v1)
  const depth =
    entry.frequency <= 5
      ? ("shallow" as const)
      : entry.frequency <= 15
        ? ("moderate" as const)
        : ("deep" as const);

  return {
    domain: entry.domain,
    frequency: entry.frequency,
    percentageOfTotal: totalFrequency > 0 ? entry.frequency / totalFrequency : 0,
    lastSeen: entry.lastSeen,
    depth,
    depthTrend: "stable" as const, // No historical data to compute trend
    avgAlternativesInDomain: 0, // Not available in v1
  };
}

/**
 * Migrate a v1 pattern string to v2 PatternV2 format.
 * Infers category from pattern text.
 */
function migratePattern(pattern: string, date: string): ReasoningModelV2["patterns"][number] {
  let category: ReasoningModelV2["patterns"][number]["category"] = "decision_style";

  if (pattern.toLowerCase().includes("ai ")) {
    category = "ai_interaction";
  } else if (
    pattern.toLowerCase().includes("polyglot") ||
    pattern.toLowerCase().includes("domain")
  ) {
    category = "domain";
  } else if (
    pattern.toLowerCase().includes("alternative") ||
    pattern.toLowerCase().includes("explores")
  ) {
    category = "exploration";
  } else if (pattern.toLowerCase().includes("revert") || pattern.toLowerCase().includes("dead")) {
    category = "decision_style";
  }

  return {
    pattern,
    confidence: 0.7, // Assume threshold confidence — pattern existed in v1
    observedSince: date,
    lastObserved: date,
    examples: 1, // No example count in v1
    category,
  };
}

/**
 * Migrate a v1 ReasoningProfile to v2 ReasoningModelV2.
 * Preserves all accumulated data and computes new fields where possible.
 * Fields without v1 data are initialized to sensible defaults.
 */
export function migrateV1ToV2(v1: ReasoningProfile): ReasoningModelV2 {
  const totalDomainFrequency = v1.domainDistribution.reduce((s, d) => s + d.frequency, 0);

  return {
    version: 2,
    lastUpdated: v1.updatedAt,
    dataPoints: v1.distillCount,

    decisionStyle: {
      avgAlternativesEvaluated: v1.avgAlternativesEvaluated,
      medianAlternativesEvaluated: v1.avgAlternativesEvaluated, // Approximate median from avg
      explorationDepthMinutes: {
        overall: 0, // Not available in v1
        byDomain: {},
      },
      aiAcceptanceRate: v1.aiAcceptanceRate,
      aiModificationRate: v1.aiModificationRate,
      aiModificationByDomain: {},
    },

    tradeOffPreferences: [], // Not tracked in v1

    domainDistribution: v1.domainDistribution.map((d) =>
      migrateDomainEntry(d, totalDomainFrequency),
    ),

    patterns: v1.patterns.map((p) => migratePattern(p, v1.updatedAt)),

    temporalPatterns: {
      mostProductiveHours: [], // Not available in v1
      avgDecisionsPerDay: v1.avgDecisionsPerDay,
      peakDecisionDays: [], // Not available in v1
    },
  };
}

/**
 * Run the v1 → v2 profile migration on disk.
 * 1. Reads .unfade/profile/reasoning_model.json
 * 2. If v1, migrates to v2 and writes backup
 * 3. If already v2 or missing, no-op
 *
 * Returns the migrated profile, or null if no migration needed.
 */
export function migrateProfileOnDisk(cwd?: string): ReasoningModelV2 | null {
  const profileDir = getProfileDir(cwd);
  const profilePath = join(profileDir, "reasoning_model.json");

  if (!existsSync(profilePath)) {
    logger.debug("No profile to migrate — file does not exist");
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(profilePath, "utf-8");
  } catch {
    logger.warn("Could not read profile for migration");
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn("Profile is not valid JSON — skipping migration");
    return null;
  }

  // Already v2 — no migration needed
  if (parsed.version === 2) {
    logger.debug("Profile is already v2 — no migration needed");
    return null;
  }

  // Not v1 either — unknown format
  if (parsed.version !== 1) {
    logger.warn(`Unknown profile version: ${parsed.version} — skipping migration`);
    return null;
  }

  const v1 = parsed as unknown as ReasoningProfile;
  const v2 = migrateV1ToV2(v1);

  // Write backup
  mkdirSync(profileDir, { recursive: true });
  const backupPath = join(profileDir, "reasoning_model.v1.backup.json");
  writeFileSync(backupPath, `${raw}\n`, "utf-8");
  logger.info("Backed up v1 profile", { path: backupPath });

  // Write v2 atomically
  const tmpPath = `${profilePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(v2, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, profilePath);

  logger.info("Migrated profile v1 → v2", {
    dataPoints: v2.dataPoints,
    patterns: v2.patterns.length,
    domains: v2.domainDistribution.length,
  });

  return v2;
}

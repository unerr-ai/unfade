// FILE: src/tools/unfade-profile.ts
// UF-055: Profile reader — retrieve full reasoning profile from
// profile/reasoning_model.json. Handles both v1 (ReasoningProfile) and
// v2 (ReasoningModelV2) formats. Missing file returns empty profile
// with degraded: true.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta, ProfileOutput } from "../schemas/mcp.js";
import type { ReasoningModelV2 } from "../schemas/profile.js";
import type { ReasoningProfile } from "../services/personalization/profile-builder.js";
import { getProfileDir } from "../utils/paths.js";

/**
 * Convert a v2 profile to ProfileOutput data shape.
 */
function v2ToProfileData(profile: ReasoningModelV2): ProfileOutput["data"] {
  return {
    version: profile.version,
    updatedAt: profile.lastUpdated,
    distillCount: profile.dataPoints,
    avgAlternativesEvaluated: profile.decisionStyle.avgAlternativesEvaluated,
    aiAcceptanceRate: profile.decisionStyle.aiAcceptanceRate,
    aiModificationRate: profile.decisionStyle.aiModificationRate,
    avgDecisionsPerDay: profile.temporalPatterns.avgDecisionsPerDay,
    avgDeadEndsPerDay: 0, // Not tracked in v2 separately
    domainDistribution: profile.domainDistribution.map((d) => ({
      domain: d.domain,
      frequency: d.frequency,
      lastSeen: d.lastSeen,
    })),
    patterns: profile.patterns.map((p) => p.pattern),
  };
}

/**
 * Convert a v1 profile to ProfileOutput data shape.
 */
function v1ToProfileData(profile: ReasoningProfile): ProfileOutput["data"] {
  return {
    version: profile.version,
    updatedAt: profile.updatedAt,
    distillCount: profile.distillCount,
    avgAlternativesEvaluated: profile.avgAlternativesEvaluated,
    aiAcceptanceRate: profile.aiAcceptanceRate,
    aiModificationRate: profile.aiModificationRate,
    avgDecisionsPerDay: profile.avgDecisionsPerDay,
    avgDeadEndsPerDay: profile.avgDeadEndsPerDay,
    domainDistribution: profile.domainDistribution,
    patterns: profile.patterns,
  };
}

/**
 * Retrieve the full reasoning profile.
 * Returns the profile data wrapped in the MCP response envelope.
 * Missing file returns empty/default profile with degraded: true.
 */
export function getProfile(cwd?: string): ProfileOutput {
  const start = performance.now();

  const profileDir = getProfileDir(cwd);
  const profilePath = join(profileDir, "reasoning_model.json");

  let degraded = false;
  let degradedReason: string | undefined;
  let lastUpdated: string | null = null;

  let data: ProfileOutput["data"];

  if (!existsSync(profilePath)) {
    degraded = true;
    degradedReason = "Profile not found — no distills have been processed yet";
    data = {
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
  } else {
    try {
      const raw = readFileSync(profilePath, "utf-8");
      const parsed = JSON.parse(raw);
      lastUpdated = statSync(profilePath).mtime.toISOString();

      if (parsed.version === 2) {
        data = v2ToProfileData(parsed as ReasoningModelV2);
      } else {
        data = v1ToProfileData(parsed as ReasoningProfile);
      }
    } catch {
      degraded = true;
      degradedReason = "Failed to read profile — returning empty profile";
      data = {
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
  }

  const meta: McpMeta = {
    tool: "unfade-profile",
    durationMs: Math.round(performance.now() - start),
    degraded,
    degradedReason,
    lastUpdated,
  };

  return { data, _meta: meta };
}

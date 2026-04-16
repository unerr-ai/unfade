// FILE: src/tools/unfade-profile.ts
// UF-055: Profile reader — retrieve full reasoning profile from
// profile/reasoning_model.json. Uses the ReasoningProfile interface
// (the actual on-disk format from profile-builder.ts), NOT the
// ReasoningModel schema. Missing file returns empty profile with degraded: true.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta, ProfileOutput } from "../schemas/mcp.js";
import type { ReasoningProfile } from "../services/personalization/profile-builder.js";
import { getProfileDir } from "../utils/paths.js";

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

  let profile: ReasoningProfile;

  if (!existsSync(profilePath)) {
    degraded = true;
    degradedReason = "Profile not found — no distills have been processed yet";
    profile = {
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
      profile = JSON.parse(raw) as ReasoningProfile;
      lastUpdated = statSync(profilePath).mtime.toISOString();
    } catch {
      degraded = true;
      degradedReason = "Failed to read profile — returning empty profile";
      profile = {
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

  return {
    data: {
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
    },
    _meta: meta,
  };
}

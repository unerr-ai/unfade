// FILE: src/tools/unfade-profile.ts
// UF-055: Profile reader — retrieve full reasoning profile from
// profile/reasoning_model.json. Missing file returns empty profile
// with degraded: true.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta, ProfileOutput } from "../schemas/mcp.js";
import type { ReasoningModelV2 } from "../schemas/profile.js";
import { getProfileDir } from "../utils/paths.js";

/**
 * Convert a profile to ProfileOutput data shape.
 */
function toProfileData(profile: ReasoningModelV2): ProfileOutput["data"] {
  const domains = profile.domainDistribution ?? [];
  const patternRows = profile.patterns ?? [];
  const style = profile.decisionStyle;
  const temporal = profile.temporalPatterns;
  return {
    version: profile.version,
    updatedAt: profile.lastUpdated,
    distillCount: profile.dataPoints,
    avgAlternativesEvaluated: Number(style?.avgAlternativesEvaluated ?? 0),
    aiAcceptanceRate: Number(style?.aiAcceptanceRate ?? 0),
    aiModificationRate: Number(style?.aiModificationRate ?? 0),
    avgDecisionsPerDay: Number(temporal?.avgDecisionsPerDay ?? 0),
    avgDeadEndsPerDay: 0,
    domainDistribution: domains.map((d) => ({
      domain: d.domain,
      frequency: d.frequency,
      lastSeen: d.lastSeen,
    })),
    patterns: patternRows.map((p) => p.pattern),
  };
}

function emptyProfileData(): ProfileOutput["data"] {
  return {
    version: 2,
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
    data = emptyProfileData();
  } else {
    try {
      const raw = readFileSync(profilePath, "utf-8");
      const parsed = JSON.parse(raw);
      lastUpdated = statSync(profilePath).mtime.toISOString();

      if (parsed.version === 2) {
        data = toProfileData(parsed as ReasoningModelV2);
      } else {
        degraded = true;
        degradedReason = "Profile is in unrecognized format — returning empty profile";
        data = emptyProfileData();
      }
    } catch {
      degraded = true;
      degradedReason = "Failed to read profile — returning empty profile";
      data = emptyProfileData();
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

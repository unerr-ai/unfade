// FILE: src/tools/unfade-coach.ts
// UF-110: MCP tool — returns prompt patterns and coaching suggestions for the current domain.
// Includes active loop warnings when relevant.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta } from "../schemas/mcp.js";
import { getProjectDataDir } from "../utils/paths.js";

export interface CoachToolResult {
  data: {
    effectivePatterns: Array<{ domain: string; pattern: string; acceptanceRate: number }>;
    antiPatterns: Array<{ domain: string; pattern: string; suggestion: string }>;
    activeLoopWarnings: Array<{
      domain: string;
      approach: string;
      occurrences: number;
      lastSeen: string;
    }>;
  } | null;
  _meta: McpMeta;
}

export function getCoachInsights(opts?: { domain?: string }, cwd?: string): CoachToolResult {
  const start = Date.now();
  const dataDir = getProjectDataDir(cwd);

  const patternsPath = join(dataDir, "intelligence", "prompt-patterns.json");
  const rejectionsPath = join(dataDir, "intelligence", "rejections.idx.json");

  let effectivePatterns: CoachToolResult["data"] extends null
    ? never
    : NonNullable<CoachToolResult["data"]>["effectivePatterns"] = [];
  let antiPatterns: CoachToolResult["data"] extends null
    ? never
    : NonNullable<CoachToolResult["data"]>["antiPatterns"] = [];
  let activeLoopWarnings: CoachToolResult["data"] extends null
    ? never
    : NonNullable<CoachToolResult["data"]>["activeLoopWarnings"] = [];

  if (existsSync(patternsPath)) {
    try {
      const data = JSON.parse(readFileSync(patternsPath, "utf-8"));
      effectivePatterns = (data.effectivePatterns ?? [])
        .filter((p: Record<string, unknown>) => !opts?.domain || p.domain === opts.domain)
        .slice(0, 5)
        .map((p: Record<string, unknown>) => ({
          domain: p.domain as string,
          pattern: p.pattern as string,
          acceptanceRate: p.acceptanceRate as number,
        }));
      antiPatterns = (data.antiPatterns ?? [])
        .filter((p: Record<string, unknown>) => !opts?.domain || p.domain === opts.domain)
        .slice(0, 3)
        .map((p: Record<string, unknown>) => ({
          domain: p.domain as string,
          pattern: p.pattern as string,
          suggestion: p.suggestion as string,
        }));
    } catch {
      // non-fatal
    }
  }

  if (existsSync(rejectionsPath)) {
    try {
      const data = JSON.parse(readFileSync(rejectionsPath, "utf-8"));
      activeLoopWarnings = (data.stuckLoops ?? [])
        .filter((l: Record<string, unknown>) => !opts?.domain || l.domain === opts.domain)
        .slice(0, 3)
        .map((l: Record<string, unknown>) => ({
          domain: l.domain as string,
          approach: l.approach as string,
          occurrences: l.occurrences as number,
          lastSeen: l.lastSeen as string,
        }));
    } catch {
      // non-fatal
    }
  }

  const hasData =
    effectivePatterns.length > 0 || antiPatterns.length > 0 || activeLoopWarnings.length > 0;

  return {
    data: hasData ? { effectivePatterns, antiPatterns, activeLoopWarnings } : null,
    _meta: {
      tool: "unfade-coach",
      durationMs: Date.now() - start,
      degraded: !hasData,
      degradedReason: hasData ? undefined : "Not enough data for coaching insights yet",
      lastUpdated: hasData ? new Date().toISOString() : null,
    },
  };
}

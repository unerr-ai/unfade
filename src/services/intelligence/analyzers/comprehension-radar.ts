// FILE: src/services/intelligence/analyzers/comprehension-radar.ts
// UF-103 + 11E.7: Comprehension Radar — per-module comprehension with blind spot detection.
// Uses phase-normalized HDS baselines (11E.6) so debugging sessions aren't flagged as blind spots.

import type { ComprehensionRadar } from "../../../schemas/intelligence/comprehension.js";
import { computePhaseBaselines, isHdsConcerning, type PhaseBaseline } from "../phase-baselines.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./index.js";

const BLIND_SPOT_THRESHOLD = 40;
const MIN_EVENTS_FOR_BLIND_SPOT = 5;

export const comprehensionRadarAnalyzer: Analyzer = {
  name: "comprehension-radar",
  outputFile: "comprehension.json",
  minDataPoints: 5,

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const db = ctx.db;
    const now = new Date().toISOString();

    // 11E.6/11E.7: Compute phase baselines for normalized scoring
    const { baselines } = computePhaseBaselines(db);

    const byModule = computeByModule(db, now, baselines);
    const byDomain = computeByDomain(db);
    const overall = computeOverall(byModule);
    const { blindSpots, alerts } = detectBlindSpots(byModule);

    const totalDataPoints = Object.values(byModule).reduce((s, m) => s + m.decisionsCount, 0);

    const radar: ComprehensionRadar = {
      overall,
      confidence: totalDataPoints >= 20 ? "high" : totalDataPoints >= 10 ? "medium" : "low",
      byModule,
      byDomain,
      blindSpots,
      blindSpotAlerts: alerts,
      updatedAt: now,
    };

    const sourceEventIds = collectSourceEventIds(db);

    return {
      analyzer: "comprehension-radar",
      updatedAt: now,
      data: radar as unknown as Record<string, unknown>,
      insightCount: alerts.length,
      sourceEventIds,
    };
  },
};

function collectSourceEventIds(db: AnalyzerContext["db"]): string[] {
  try {
    const result = db.exec(`
      SELECT id FROM events
      WHERE source IN ('ai-session', 'mcp-active')
      ORDER BY ts DESC
      LIMIT 20
    `);
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => row[0] as string);
  } catch {
    return [];
  }
}

function computeByModule(
  db: AnalyzerContext["db"],
  now: string,
  baselines: Record<string, PhaseBaseline>,
): Record<
  string,
  {
    score: number;
    decisionsCount: number;
    lastUpdated: string;
    confidence: "high" | "medium" | "low";
  }
> {
  const modules: Record<
    string,
    {
      score: number;
      decisionsCount: number;
      lastUpdated: string;
      confidence: "high" | "medium" | "low";
    }
  > = {};

  try {
    const result = db.exec(
      "SELECT module, score, event_count, updated_at FROM comprehension_by_module ORDER BY event_count DESC",
    );
    if (!result[0]?.values.length) return modules;

    // 11E.7: Get dominant execution phase per module for phase-normalized scoring
    const modulePhases = getModuleDominantPhases(db);

    for (const row of result[0].values) {
      const module = row[0] as string;
      const rawScore = row[1] as number;
      const count = row[2] as number;
      const updated = (row[3] as string) ?? now;

      // 11E.7: Apply phase normalization — if the dominant phase for this module
      // explains the low score, adjust it upward to avoid false blind-spot alerts
      const dominantPhase = modulePhases[module];
      const score = adjustScoreForPhase(rawScore, dominantPhase, baselines);

      modules[module] = {
        score,
        decisionsCount: count,
        lastUpdated: updated,
        confidence: count >= 10 ? "high" : count >= 5 ? "medium" : "low",
      };
    }
  } catch {
    // table may not exist yet
  }

  return modules;
}

/**
 * 11E.7: Get the dominant execution phase for each module.
 * This tells us if a module's low HDS is expected (e.g., mostly debugging).
 */
function getModuleDominantPhases(db: AnalyzerContext["db"]): Record<string, string> {
  const phases: Record<string, string> = {};
  try {
    const result = db.exec(`
      SELECT
        COALESCE(json_extract(metadata, '$.domain'), 'unknown') as module,
        json_extract(metadata, '$.execution_phase') as phase,
        COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= datetime('now', '-30 days')
        AND json_extract(metadata, '$.execution_phase') IS NOT NULL
      GROUP BY module, phase
      ORDER BY module, cnt DESC
    `);
    if (!result[0]?.values.length) return phases;

    // Take the phase with highest count per module
    const seen = new Set<string>();
    for (const row of result[0].values) {
      const module = row[0] as string;
      const phase = row[1] as string;
      if (!seen.has(module)) {
        phases[module] = phase;
        seen.add(module);
      }
    }
  } catch {
    // non-fatal
  }
  return phases;
}

/**
 * 11E.7: Adjust comprehension score based on execution phase.
 * A debugging session with HDS 0.3 is NORMAL — don't penalize it.
 * Only flag deviations from phase norms.
 */
function adjustScoreForPhase(
  rawScore: number,
  dominantPhase: string | undefined,
  baselines: Record<string, PhaseBaseline>,
): number {
  if (!dominantPhase) return rawScore;

  // If the raw HDS is NOT concerning for this phase, boost the score
  // to prevent false blind-spot detection
  const rawHds = rawScore / 100; // score is 0-100, HDS is 0-1
  if (!isHdsConcerning(rawHds, dominantPhase, baselines)) {
    // Score is within expected range for this phase — normalize toward 50 (neutral)
    // so it doesn't trigger blind-spot threshold (< 40)
    return Math.max(rawScore, 50);
  }

  return rawScore;
}

function computeByDomain(db: AnalyzerContext["db"]): Record<string, number> {
  const domains: Record<string, number> = {};

  try {
    const result = db.exec(`
      SELECT domain, AVG(hds) as avg_hds
      FROM decisions
      WHERE domain IS NOT NULL AND domain != ''
      GROUP BY domain
    `);
    if (!result[0]?.values.length) return domains;

    for (const row of result[0].values) {
      domains[row[0] as string] = Math.round((row[1] as number) * 100);
    }
  } catch {
    // table may not exist
  }

  return domains;
}

function computeOverall(
  byModule: Record<string, { score: number; decisionsCount: number }>,
): number {
  const entries = Object.values(byModule);
  if (entries.length === 0) return 0;

  let totalWeighted = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    totalWeighted += entry.score * entry.decisionsCount;
    totalWeight += entry.decisionsCount;
  }

  return totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 0;
}

function detectBlindSpots(byModule: Record<string, { score: number; decisionsCount: number }>): {
  blindSpots: string[];
  alerts: Array<{ module: string; score: number; eventCount: number; suggestion: string }>;
} {
  const blindSpots: string[] = [];
  const alerts: Array<{ module: string; score: number; eventCount: number; suggestion: string }> =
    [];

  for (const [module, data] of Object.entries(byModule)) {
    if (data.score < BLIND_SPOT_THRESHOLD && data.decisionsCount >= MIN_EVENTS_FOR_BLIND_SPOT) {
      blindSpots.push(module);
      alerts.push({
        module,
        score: data.score,
        eventCount: data.decisionsCount,
        suggestion: `Your comprehension in ${module} is ${data.score}. Consider reviewing AI-generated code more carefully in this area, or pair-program on the next change.`,
      });
    }
  }

  return { blindSpots, alerts };
}

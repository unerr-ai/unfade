// FILE: src/services/intelligence/analyzers/comprehension-radar.ts
// UF-103: Comprehension Radar — extended per-module comprehension with blind spot detection.
// Extends the existing comprehension.ts scoring into an intelligence artifact.

import type { ComprehensionRadar } from "../../../schemas/intelligence/comprehension.js";
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

    const byModule = computeByModule(db, now);
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

    return {
      analyzer: "comprehension-radar",
      updatedAt: now,
      data: radar as unknown as Record<string, unknown>,
      insightCount: alerts.length,
    };
  },
};

function computeByModule(
  db: AnalyzerContext["db"],
  now: string,
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

    for (const row of result[0].values) {
      const module = row[0] as string;
      const score = row[1] as number;
      const count = row[2] as number;
      const updated = (row[3] as string) ?? now;

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

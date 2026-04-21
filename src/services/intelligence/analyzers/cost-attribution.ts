// FILE: src/services/intelligence/analyzers/cost-attribution.ts
// UF-102: Cost Attribution Engine — converts event counts × pricing to USD estimates.
// Groups by model, domain, branch. Computes waste ratio and context overhead proxy.
// All outputs labeled "estimated / proxy" per §0.3 trust requirement.

import type { CostAttribution, CostDimension } from "../../../schemas/intelligence/costs.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./index.js";

const DISCLAIMER =
  "These costs are estimates based on AI event counts × configurable pricing. They are not invoices. Compare with your provider bills for calibration.";

export const costAttributionAnalyzer: Analyzer = {
  name: "cost-attribution",
  outputFile: "costs.json",
  minDataPoints: 3,

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const db = ctx.db;
    const pricing = (ctx.config.pricing ?? {}) as Record<string, number>;
    const now = new Date().toISOString();

    const byModel = computeByModel(db, pricing);
    const byDomain = computeByDomain(db, pricing);
    const byBranch = computeByBranch(db, pricing);

    // 12C.14: Per-feature cost attribution via event_features join
    const byFeature = computeByFeature(db, pricing);

    const totalCost = byModel.reduce((s, m) => s + m.estimatedCost, 0);
    const wasteRatio = computeWasteRatio(db);
    const contextOverhead = computeContextOverhead(db);
    const costPerDirected = computeCostPerDirected(db, totalCost);

    // 12C.14: Waste detection — cost attributed to outcome=abandoned sessions
    const abandonedWaste = computeAbandonedWaste(db, pricing);

    const daysInPeriod = computeDaysInPeriod(db);
    const projectedMonthlyCost =
      daysInPeriod > 0 ? Math.round((totalCost / daysInPeriod) * 30 * 100) / 100 : null;

    const costs: CostAttribution = {
      totalEstimatedCost: Math.round(totalCost * 100) / 100,
      period: "all-time",
      isProxy: true,
      byModel,
      byDomain,
      byBranch,
      byFeature,
      abandonedWaste,
      wasteRatio,
      contextOverhead,
      projectedMonthlyCost,
      costPerDirectedDecision: costPerDirected,
      updatedAt: now,
      disclaimer: DISCLAIMER,
    };

    const sourceEventIds = collectSourceEventIds(db);

    return {
      analyzer: "cost-attribution",
      updatedAt: now,
      data: costs as unknown as Record<string, unknown>,
      insightCount: 0,
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

function computeByModel(
  db: AnalyzerContext["db"],
  pricing: Record<string, number>,
): CostDimension[] {
  try {
    const result = db.exec(`
      SELECT COALESCE(json_extract(metadata, '$.model'), json_extract(metadata, '$.ai_tool'), 'unknown') as model,
             COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
      GROUP BY model
      ORDER BY cnt DESC
    `);
    if (!result[0]?.values.length) return [];

    const total = result[0].values.reduce((s, r) => s + (r[1] as number), 0);
    return result[0].values.map((row) => {
      const model = (row[0] as string) ?? "unknown";
      const count = row[1] as number;
      const price = findPrice(model, pricing);
      return {
        key: model,
        eventCount: count,
        estimatedCost: Math.round(count * price * 100) / 100,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });
  } catch {
    return [];
  }
}

function computeByDomain(
  db: AnalyzerContext["db"],
  pricing: Record<string, number>,
): CostDimension[] {
  try {
    const result = db.exec(`
      SELECT content_summary, COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
      GROUP BY substr(content_summary, 1, 50)
      LIMIT 20
    `);
    return [];
  } catch {
    return [];
  }
}

function computeByBranch(
  db: AnalyzerContext["db"],
  pricing: Record<string, number>,
): CostDimension[] {
  try {
    const result = db.exec(`
      SELECT COALESCE(git_branch, 'unknown') as branch, COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND git_branch IS NOT NULL AND git_branch != ''
      GROUP BY branch
      ORDER BY cnt DESC
      LIMIT 10
    `);
    if (!result[0]?.values.length) return [];

    const total = result[0].values.reduce((s, r) => s + (r[1] as number), 0);
    return result[0].values.map((row) => ({
      key: (row[0] as string) ?? "unknown",
      eventCount: row[1] as number,
      estimatedCost: 0,
      percentage: total > 0 ? Math.round(((row[1] as number) / total) * 100) : 0,
    }));
  } catch {
    return [];
  }
}

function computeWasteRatio(db: AnalyzerContext["db"]): number | null {
  try {
    const result = db.exec(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL) < 0.2 THEN 1 ELSE 0 END) as low_direction
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.direction_signals.human_direction_score') IS NOT NULL
    `);
    const total = (result[0]?.values[0]?.[0] as number) ?? 0;
    const low = (result[0]?.values[0]?.[1] as number) ?? 0;
    if (total < 5) return null;
    return Math.round((low / total) * 100) / 100;
  } catch {
    return null;
  }
}

function computeContextOverhead(db: AnalyzerContext["db"]): number | null {
  try {
    const result = db.exec(`
      SELECT AVG(CAST(json_extract(metadata, '$.direction_signals.prompt_specificity') AS REAL)) as avg_spec
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.direction_signals.prompt_specificity') IS NOT NULL
    `);
    const avg = (result[0]?.values[0]?.[0] as number) ?? 0;
    return Math.round((1 - avg) * 100) / 100;
  } catch {
    return null;
  }
}

function computeCostPerDirected(db: AnalyzerContext["db"], totalCost: number): number | null {
  try {
    const result = db.exec(`
      SELECT COUNT(*) FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL) >= 0.5
    `);
    const directed = (result[0]?.values[0]?.[0] as number) ?? 0;
    if (directed === 0 || totalCost === 0) return null;
    return Math.round((totalCost / directed) * 100) / 100;
  } catch {
    return null;
  }
}

function computeDaysInPeriod(db: AnalyzerContext["db"]): number {
  try {
    const result = db.exec(`
      SELECT MIN(ts), MAX(ts) FROM events WHERE source IN ('ai-session', 'mcp-active')
    `);
    const min = result[0]?.values[0]?.[0] as string;
    const max = result[0]?.values[0]?.[1] as string;
    if (!min || !max) return 0;
    return Math.max(
      1,
      Math.round((new Date(max).getTime() - new Date(min).getTime()) / (86400 * 1000)),
    );
  } catch {
    return 0;
  }
}

/**
 * 12C.14: Per-feature cost attribution via event_features join.
 */
function computeByFeature(
  db: AnalyzerContext["db"],
  pricing: Record<string, number>,
): CostDimension[] {
  try {
    const result = db.exec(`
      SELECT f.name as feature_name, COUNT(DISTINCT e.id) as cnt
      FROM events e
      JOIN event_features ef ON ef.event_id = e.id
      JOIN features f ON f.id = ef.feature_id
      WHERE e.source IN ('ai-session', 'mcp-active')
      GROUP BY f.name
      ORDER BY cnt DESC
      LIMIT 10
    `);
    if (!result[0]?.values.length) return [];

    const total = result[0].values.reduce((s, r) => s + (r[1] as number), 0);
    return result[0].values.map((row) => ({
      key: (row[0] as string) ?? "unknown",
      eventCount: row[1] as number,
      estimatedCost: 0,
      percentage: total > 0 ? Math.round(((row[1] as number) / total) * 100) : 0,
    }));
  } catch {
    return [];
  }
}

/**
 * 12C.14: Waste detection — cost attributed to outcome=abandoned sessions.
 */
function computeAbandonedWaste(
  db: AnalyzerContext["db"],
  pricing: Record<string, number>,
): { eventCount: number; estimatedCost: number } {
  try {
    const result = db.exec(`
      SELECT
        COALESCE(json_extract(metadata, '$.model'), json_extract(metadata, '$.ai_tool'), 'unknown') as model,
        COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.outcome') = 'abandoned'
      GROUP BY model
    `);
    if (!result[0]?.values.length) return { eventCount: 0, estimatedCost: 0 };

    let totalEvents = 0;
    let totalCost = 0;
    for (const row of result[0].values) {
      const model = (row[0] as string) ?? "unknown";
      const count = row[1] as number;
      totalEvents += count;
      totalCost += count * findPrice(model, pricing);
    }
    return { eventCount: totalEvents, estimatedCost: Math.round(totalCost * 100) / 100 };
  } catch {
    return { eventCount: 0, estimatedCost: 0 };
  }
}

function findPrice(model: string, table: Record<string, number>): number {
  const lower = model.toLowerCase();
  if (table[lower] !== undefined) return table[lower];
  for (const [key, price] of Object.entries(table)) {
    if (lower.includes(key.toLowerCase())) return price;
  }
  return 0;
}

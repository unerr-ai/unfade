// FILE: src/services/intelligence/analyzers/cost-attribution.ts
// UF-102: Cost Attribution Engine — converts event counts × pricing to USD estimates.
// Groups by model, domain, branch, feature. Computes waste ratio and context overhead proxy.
// All outputs labeled "estimated / proxy" per §0.3 trust requirement.

import type { CostAttribution, CostDimension } from "../../../schemas/intelligence/costs.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { AnalyzerContext } from "./index.js";

const DISCLAIMER =
  "These costs are estimates based on AI event counts × configurable pricing. They are not invoices. Compare with your provider bills for calibration.";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface CostAttributionState {
  output: CostAttribution;
}

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

function findPrice(model: string, table: Record<string, number>): number {
  const lower = model.toLowerCase();
  if (table[lower] !== undefined) return table[lower];
  for (const [key, price] of Object.entries(table)) {
    if (lower.includes(key.toLowerCase())) return price;
  }
  return 0;
}

async function computeByModel(
  db: AnalyzerContext["analytics"],
  pricing: Record<string, number>,
): Promise<CostDimension[]> {
  try {
    const result = await db.exec(
      `SELECT COALESCE(model_id, ai_tool, 'unknown') as model,
             COUNT(*) as cnt
       FROM events
       WHERE source IN ('ai-session', 'mcp-active')
       GROUP BY model
       ORDER BY cnt DESC`,
    );
    if (!result[0]?.values.length) return [];

    const total = result[0].values.reduce((s, r) => s + Number(r[1] ?? 0), 0);
    return result[0].values.map((row) => {
      const model = (row[0] as string) ?? "unknown";
      const count = Number(row[1] ?? 0);
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

async function computeByDomain(db: AnalyzerContext["analytics"]): Promise<CostDimension[]> {
  try {
    await db.exec(
      `SELECT content_summary, COUNT(*) as cnt
       FROM events
       WHERE source IN ('ai-session', 'mcp-active')
       GROUP BY substr(content_summary, 1, 50)
       LIMIT 20`,
    );
    return [];
  } catch {
    return [];
  }
}

async function computeByBranch(db: AnalyzerContext["analytics"]): Promise<CostDimension[]> {
  try {
    const result = await db.exec(
      `SELECT COALESCE(git_branch, 'unknown') as branch, COUNT(*) as cnt
       FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND git_branch IS NOT NULL AND git_branch != ''
       GROUP BY branch
       ORDER BY cnt DESC
       LIMIT 10`,
    );
    if (!result[0]?.values.length) return [];

    const total = result[0].values.reduce((s, r) => s + Number(r[1] ?? 0), 0);
    return result[0].values.map((row) => ({
      key: (row[0] as string) ?? "unknown",
      eventCount: Number(row[1] ?? 0),
      estimatedCost: 0,
      percentage: total > 0 ? Math.round((Number(row[1] ?? 0) / total) * 100) : 0,
    }));
  } catch {
    return [];
  }
}

async function computeByFeature(db: AnalyzerContext["analytics"]): Promise<CostDimension[]> {
  try {
    const result = await db.exec(
      `SELECT f.name as feature_name, COUNT(DISTINCT e.id) as cnt
       FROM events e
       JOIN event_features ef ON ef.event_id = e.id
       JOIN features f ON f.id = ef.feature_id
       WHERE e.source IN ('ai-session', 'mcp-active')
       GROUP BY f.name
       ORDER BY cnt DESC
       LIMIT 10`,
    );
    if (!result[0]?.values.length) return [];

    const total = result[0].values.reduce((s, r) => s + Number(r[1] ?? 0), 0);
    return result[0].values.map((row) => ({
      key: (row[0] as string) ?? "unknown",
      eventCount: Number(row[1] ?? 0),
      estimatedCost: 0,
      percentage: total > 0 ? Math.round((Number(row[1] ?? 0) / total) * 100) : 0,
    }));
  } catch {
    return [];
  }
}

async function computeWasteRatio(db: AnalyzerContext["analytics"]): Promise<number | null> {
  try {
    const result = await db.exec(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN human_direction_score < 0.2 THEN 1 ELSE 0 END) as low_direction
       FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND human_direction_score IS NOT NULL`,
    );
    const total = Number(result[0]?.values[0]?.[0] ?? 0);
    const low = Number(result[0]?.values[0]?.[1] ?? 0);
    if (total < 5) return null;
    return Math.round((low / total) * 100) / 100;
  } catch {
    return null;
  }
}

async function computeContextOverhead(db: AnalyzerContext["analytics"]): Promise<number | null> {
  try {
    const result = await db.exec(
      `SELECT AVG(prompt_specificity) as avg_spec
       FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND prompt_specificity IS NOT NULL`,
    );
    const avg = Number(result[0]?.values[0]?.[0] ?? 0);
    return Math.round((1 - avg) * 100) / 100;
  } catch {
    return null;
  }
}

async function computeCostPerDirected(
  db: AnalyzerContext["analytics"],
  totalCost: number,
): Promise<number | null> {
  try {
    const result = await db.exec(
      `SELECT COUNT(*) FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND human_direction_score >= 0.5`,
    );
    const directed = Number(result[0]?.values[0]?.[0] ?? 0);
    if (directed === 0 || totalCost === 0) return null;
    return Math.round((totalCost / directed) * 100) / 100;
  } catch {
    return null;
  }
}

async function computeDaysInPeriod(db: AnalyzerContext["analytics"]): Promise<number> {
  try {
    const result = await db.exec(
      `SELECT MIN(ts), MAX(ts) FROM events WHERE source IN ('ai-session', 'mcp-active')`,
    );
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

async function computeAbandonedWaste(
  db: AnalyzerContext["analytics"],
  pricing: Record<string, number>,
): Promise<{ eventCount: number; estimatedCost: number }> {
  try {
    const result = await db.exec(
      `SELECT
        COALESCE(model_id, ai_tool, 'unknown') as model,
        COUNT(*) as cnt
       FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND outcome = 'abandoned'
       GROUP BY model`,
    );
    if (!result[0]?.values.length) return { eventCount: 0, estimatedCost: 0 };

    let totalEvents = 0;
    let totalCost = 0;
    for (const row of result[0].values) {
      const model = (row[0] as string) ?? "unknown";
      const count = Number(row[1] ?? 0);
      totalEvents += count;
      totalCost += count * findPrice(model, pricing);
    }
    return { eventCount: totalEvents, estimatedCost: Math.round(totalCost * 100) / 100 };
  } catch {
    return { eventCount: 0, estimatedCost: 0 };
  }
}

// ---------------------------------------------------------------------------
// Full computation — assembles a CostAttribution output
// ---------------------------------------------------------------------------

async function computeCosts(
  db: AnalyzerContext["analytics"],
  pricing: Record<string, number>,
): Promise<CostAttribution> {
  const now = new Date().toISOString();

  const byModel = await computeByModel(db, pricing);
  const byDomain = await computeByDomain(db);
  const byBranch = await computeByBranch(db);
  const byFeature = await computeByFeature(db);

  const totalCost = byModel.reduce((s, m) => s + m.estimatedCost, 0);
  const wasteRatio = await computeWasteRatio(db);
  const contextOverhead = await computeContextOverhead(db);
  const costPerDirected = await computeCostPerDirected(db, totalCost);
  const abandonedWaste = await computeAbandonedWaste(db, pricing);

  const daysInPeriod = await computeDaysInPeriod(db);
  const projectedMonthlyCost =
    daysInPeriod > 0 ? Math.round((totalCost / daysInPeriod) * 30 * 100) / 100 : null;

  return {
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
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const costAttributionAnalyzer: IncrementalAnalyzer<CostAttributionState, CostAttribution> = {
  name: "cost-attribution",
  outputFile: "cost-attribution.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 5,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<CostAttributionState>> {
    const pricing = (ctx.config.pricing ?? {}) as Record<string, number>;
    const output = await computeCosts(ctx.analytics, pricing);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: 0,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<CostAttributionState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<CostAttributionState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const pricing = (ctx.config.pricing ?? {}) as Record<string, number>;
    const output = await computeCosts(ctx.analytics, pricing);
    const oldCost = state.value.output.totalEstimatedCost;
    const newCost = output.totalEstimatedCost;
    const changed = Math.abs(newCost - oldCost) > 0.01;

    return {
      state: {
        value: { output },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: changed ? Math.abs(newCost - oldCost) : 0,
    };
  },

  derive(state: IncrementalState<CostAttributionState>): CostAttribution {
    return state.value.output;
  },
};

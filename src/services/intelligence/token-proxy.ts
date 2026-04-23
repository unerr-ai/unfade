// FILE: src/services/intelligence/token-proxy.ts
// Token spend proxy — incremental: maintains running date+model counters.
// No full DELETE+INSERT; counters only grow. Periodic reconciliation on initialize.

import { localDateStr, localToday } from "../../utils/date.js";
import type { DbLike } from "../cache/manager.js";
import type { AnalyzerContext } from "./analyzers/index.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "./incremental-state.js";

export interface TokenSpendEntry {
  date: string;
  model: string;
  count: number;
  estimatedCost: number;
}

export interface DailySpendSummary {
  date: string;
  totalCount: number;
  totalCost: number;
  byModel: Array<{ model: string; count: number; cost: number }>;
}

interface TokenProxyState {
  byKey: Record<string, { model: string; date: string; count: number; estimatedCost: number }>;
  pricingTable: Record<string, number>;
}

async function fullScan(db: DbLike, pricing: Record<string, number>): Promise<TokenProxyState> {
  const byKey: TokenProxyState["byKey"] = {};

  try {
    const result = await db.exec(`
      SELECT ts::DATE as date, COALESCE(model_id, ai_tool, 'unknown') as model, COUNT(*) as cnt
      FROM events WHERE source IN ('ai-session', 'mcp-active')
      GROUP BY date, model
    `);

    if (result[0]?.values.length) {
      for (const row of result[0].values) {
        const date = row[0] as string;
        const model = (row[1] as string) ?? "unknown";
        const count = row[2] as number;
        const key = `${date}::${model}`;
        const pricePerK = findPrice(model, pricing);
        byKey[key] = {
          model,
          date,
          count,
          estimatedCost: pricePerK > 0 ? Math.round(count * pricePerK * 100) / 100 : 0,
        };
      }
    }
  } catch {
    // non-fatal
  }

  return { byKey, pricingTable: pricing };
}

function syncToDb(db: DbLike, state: TokenProxyState): void {
  try {
    db.run("DELETE FROM token_proxy_spend");
    for (const entry of Object.values(state.byKey)) {
      db.run(
        "INSERT OR REPLACE INTO token_proxy_spend (date, model, project_id, count, estimated_cost) VALUES (?, ?, ?, ?, ?)",
        [entry.date, entry.model, "", entry.count, entry.estimatedCost],
      );
    }
  } catch {
    // non-fatal
  }
}

export const tokenProxyAnalyzer: IncrementalAnalyzer<TokenProxyState, TokenSpendEntry[]> = {
  name: "token-proxy",
  outputFile: "token-proxy-spend.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 1,

  async initialize(ctx): Promise<IncrementalState<TokenProxyState>> {
    const pricing = (ctx.config.pricing ?? {}) as Record<string, number>;
    const value = await fullScan(ctx.analytics, pricing);
    syncToDb(ctx.analytics, value);
    return { value, watermark: "", eventCount: 0, updatedAt: new Date().toISOString() };
  },

  async update(state, batch, ctx): Promise<UpdateResult<TokenProxyState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const byKey = { ...state.value.byKey };
    const pricing = state.value.pricingTable;
    let changed = false;

    for (const evt of batch.events) {
      const date = evt.ts.slice(0, 10);
      const model = evt.aiTool ?? "unknown";
      const key = `${date}::${model}`;
      const existing = byKey[key] ?? { model, date, count: 0, estimatedCost: 0 };
      existing.count++;
      const pricePerK = findPrice(model, pricing);
      existing.estimatedCost =
        pricePerK > 0 ? Math.round(existing.count * pricePerK * 100) / 100 : 0;
      byKey[key] = existing;
      changed = true;
    }

    if (changed) syncToDb(ctx.analytics, { byKey, pricingTable: pricing });

    return {
      state: {
        value: { byKey, pricingTable: pricing },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
    };
  },

  derive(state): TokenSpendEntry[] {
    return Object.values(state.value.byKey)
      .map((e) => ({
        date: e.date,
        model: e.model,
        count: e.count,
        estimatedCost: e.estimatedCost,
      }))
      .sort((a, b) => b.estimatedCost - a.estimatedCost);
  },
};

export async function readTodaySpend(db: DbLike): Promise<DailySpendSummary | null> {
  return readSpendForDate(db, localToday());
}

export async function readSpendForDate(
  db: DbLike,
  date: string,
): Promise<DailySpendSummary | null> {
  try {
    const result = await db.exec(
      `SELECT model, count, estimated_cost FROM token_proxy_spend WHERE date = $1::DATE ORDER BY count DESC`,
      [date],
    );
    if (!result[0]?.values.length) return null;
    const byModel = result[0].values.map((row) => ({
      model: row[0] as string,
      count: row[1] as number,
      cost: row[2] as number,
    }));
    return {
      date,
      totalCount: byModel.reduce((s, m) => s + m.count, 0),
      totalCost: Math.round(byModel.reduce((s, m) => s + m.cost, 0) * 100) / 100,
      byModel,
    };
  } catch {
    return null;
  }
}

export async function readTrailingSpend(db: DbLike, days: number): Promise<DailySpendSummary[]> {
  const summaries: DailySpendSummary[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const summary = await readSpendForDate(db, localDateStr(d));
    if (summary && summary.totalCount > 0) summaries.push(summary);
  }
  return summaries;
}

function findPrice(model: string, table: Record<string, number>): number {
  const lower = model.toLowerCase();
  if (table[lower] !== undefined) return table[lower];
  for (const [key, price] of Object.entries(table)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return price;
  }
  return 0;
}

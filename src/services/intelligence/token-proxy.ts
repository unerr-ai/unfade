// FILE: src/services/intelligence/token-proxy.ts
// UF-238: Token spend proxy — tracks model usage per day and estimates cost.
// During materialization, extracts model name from event metadata,
// counts events per model per day, applies optional pricing table.

type DbLike = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
};

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

/**
 * Compute and store token spend proxy from events table.
 * Reads AI-session events, groups by date + model, applies pricing table.
 */
export function computeTokenSpend(db: DbLike, pricingTable: Record<string, number>): void {
  try {
    const result = db.exec(`
      SELECT
        substr(ts, 1, 10) as date,
        COALESCE(json_extract(metadata, '$.model'), json_extract(metadata, '$.ai_tool'), 'unknown') as model,
        COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
      GROUP BY date, model
    `);

    if (!result[0]?.values.length) return;

    db.run("DELETE FROM token_proxy_spend");

    for (const row of result[0].values) {
      const date = row[0] as string;
      const model = (row[1] as string) ?? "unknown";
      const count = row[2] as number;

      const pricePerK = findPrice(model, pricingTable);
      const estimatedCost = pricePerK > 0 ? Math.round(count * pricePerK * 100) / 100 : 0;

      db.run(
        "INSERT OR REPLACE INTO token_proxy_spend (date, model, count, estimated_cost) VALUES (?, ?, ?, ?)",
        [date, model, count, estimatedCost],
      );
    }
  } catch {
    // non-fatal
  }
}

/**
 * Read today's spend summary.
 */
export function readTodaySpend(db: DbLike): DailySpendSummary | null {
  const today = new Date().toISOString().slice(0, 10);
  return readSpendForDate(db, today);
}

/**
 * Read spend summary for a specific date.
 */
export function readSpendForDate(db: DbLike, date: string): DailySpendSummary | null {
  try {
    const result = db.exec(
      `SELECT model, count, estimated_cost FROM token_proxy_spend WHERE date = '${date}' ORDER BY count DESC`,
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

/**
 * Read trailing N-day spend for trend computation.
 */
export function readTrailingSpend(db: DbLike, days: number): DailySpendSummary[] {
  const summaries: DailySpendSummary[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const summary = readSpendForDate(db, dateStr);
    if (summary && summary.totalCount > 0) {
      summaries.push(summary);
    }
  }

  return summaries;
}

function findPrice(model: string, table: Record<string, number>): number {
  const lower = model.toLowerCase();

  if (table[lower] !== undefined) return table[lower];

  for (const [key, price] of Object.entries(table)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return price;
    }
  }

  return 0;
}

// FILE: src/services/intelligence/value-receipt.ts
// 12C.1/12C.2: Value receipt — estimates tokens/cost/time saved from MCP context injections.
// Baseline: each MCP context/profile/decisions call saves ~2000 tokens of re-explanation.
// Conservative estimates, always prefixed with ~ in output.

import type { DbLike } from "../cache/manager.js";

const TOKENS_PER_INJECTION = 2000;
const MINUTES_PER_INJECTION = 3;
const DEFAULT_COST_PER_1K_INPUT = 0.03;

export interface ValueReceipt {
  today: ValuePeriod;
  thisWeek: ValuePeriod;
  thisMonth: ValuePeriod;
  updatedAt: string;
}

export interface ValuePeriod {
  injections: number;
  estimatedTokensSaved: number;
  estimatedCostSaved: number;
  estimatedMinutesSaved: number;
}

/**
 * Count MCP context injections in the given time window.
 */
function countInjections(db: DbLike, sinceIso: string): number {
  try {
    const result = db.exec(
      `SELECT COUNT(*) FROM events
       WHERE source = 'mcp-active'
         AND type IN ('tool-invocation', 'mcp-invocation', 'context-injection')
         AND ts >= '${sinceIso}'`,
    );
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  } catch {
    return 0;
  }
}

function computePeriod(injections: number, costPer1K: number): ValuePeriod {
  return {
    injections,
    estimatedTokensSaved: injections * TOKENS_PER_INJECTION,
    estimatedCostSaved: Math.round(injections * TOKENS_PER_INJECTION * (costPer1K / 1000) * 100) / 100,
    estimatedMinutesSaved: Math.round(injections * MINUTES_PER_INJECTION * 10) / 10,
  };
}

/**
 * Compute the value receipt from MCP invocation data.
 */
export function computeValueReceipt(
  db: DbLike,
  pricing?: Record<string, number>,
): ValueReceipt {
  const costPer1K = pricing?.default ?? DEFAULT_COST_PER_1K_INPUT;
  const now = new Date();

  const todayCutoff = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const weekCutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const monthCutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

  return {
    today: computePeriod(countInjections(db, todayCutoff), costPer1K),
    thisWeek: computePeriod(countInjections(db, weekCutoff), costPer1K),
    thisMonth: computePeriod(countInjections(db, monthCutoff), costPer1K),
    updatedAt: now.toISOString(),
  };
}

/**
 * Format value receipt as markdown section for distill output.
 */
export function formatValueReceiptSection(receipt: ValueReceipt): string {
  const t = receipt.today;
  const w = receipt.thisWeek;

  if (t.injections === 0 && w.injections === 0) return "";

  const lines: string[] = ["## Estimated Impact", ""];

  if (t.injections > 0) {
    lines.push(
      `~${t.injections} context injections today saved ~${formatTokens(t.estimatedTokensSaved)} tokens (~$${t.estimatedCostSaved.toFixed(2)}).`,
    );
  }

  if (w.injections > 0) {
    const hours = (w.estimatedMinutesSaved / 60).toFixed(1);
    lines.push(
      `This week: ~${w.injections} injections, ~${formatTokens(w.estimatedTokensSaved)} tokens (~$${w.estimatedCostSaved.toFixed(2)}), ~${hours} hours of re-explanation avoided.`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

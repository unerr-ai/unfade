// FILE: src/services/intelligence/summary-writer.ts
// UF-215: Atomic summary.json writer — the P2 heartbeat.
// After each materializer tick, queries unfade.db for rolling window stats
// and writes state/summary.json atomically (tmp+rename, < 4KB).
// This is the single file that powers the living dashboard first-paint.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStateDir } from "../../utils/paths.js";
import { computeCostPerQuality } from "./cost-quality.js";
import { topDomain } from "./domain-tagger.js";
import { loadFirstRunReport } from "./first-run-trigger.js";
import { computeTokenSpend } from "./token-proxy.js";
import { computeAndStoreWindows } from "./window-aggregator.js";

type DbLike = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
};

export interface SummaryJson {
  schemaVersion: 1;
  updatedAt: string;
  freshnessMs: number;
  directionDensity24h: number;
  eventCount24h: number;
  comprehensionScore: number | null;
  topDomain: string | null;
  toolMix: Record<string, number>;
  reasoningVelocityProxy: number | null;
  firstRunComplete: boolean;
  /** Cost per directed decision (today); null when insufficient data */
  costPerDirectedDecision?: number | null;
  /** Trailing cost-quality trend vs 7d average */
  costQualityTrend?: "improving" | "stable" | "declining" | null;
  /** Estimated spend proxy for today (same units as pricing table) */
  todaySpendProxy?: number;
  /** Count of human-directed events today (hds >= 0.5) */
  todayDirectedDecisions?: number;
}

export interface WriteSummaryOptions {
  /** Model key → price per 1K tokens (from config.pricing) */
  pricing?: Record<string, number>;
}

const SUMMARY_FILENAME = "summary.json";

/**
 * Compute and write summary.json from the materialized SQLite cache.
 * Called on every materializer tick (every ~2s when events arrive).
 */
export function writeSummary(db: DbLike, cwd?: string, opts?: WriteSummaryOptions): SummaryJson {
  const pricing = opts?.pricing ?? {};
  computeTokenSpend(db, pricing);

  const windows = computeAndStoreWindows(db);
  const computeComprehensionScoresFromDb = computeComprehensionAvg(db);
  const costQ = computeCostPerQuality(db);

  const window24h = windows.find((w) => w.windowSize === "24h");

  const directionDensity24h = window24h?.directionDensity ?? 0;
  const eventCount24h = window24h?.eventCount ?? 0;
  const toolMix = window24h?.toolMix ?? {};

  const topDomainValue = computeTopDomainFromDb(db);
  const velocityProxy = computeVelocityProxy(db);
  const firstRunReport = loadFirstRunReport(cwd);

  const summary: SummaryJson = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    freshnessMs: 0,
    directionDensity24h,
    eventCount24h,
    comprehensionScore: computeComprehensionScoresFromDb,
    topDomain: topDomainValue,
    toolMix,
    reasoningVelocityProxy: velocityProxy,
    firstRunComplete: firstRunReport?.firstRunComplete ?? false,
    costPerDirectedDecision: costQ.costPerDirectedDecision,
    costQualityTrend: costQ.trend,
    todaySpendProxy: costQ.todaySpend,
    todayDirectedDecisions: costQ.todayDirectedDecisions,
  };

  writeSummaryAtomically(summary, cwd);
  return summary;
}

/**
 * Read the current summary.json from disk.
 */
export function readSummary(cwd?: string): SummaryJson | null {
  const path = join(getStateDir(cwd), SUMMARY_FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SummaryJson;
  } catch {
    return null;
  }
}

function writeSummaryAtomically(summary: SummaryJson, cwd?: string): void {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });
  const target = join(stateDir, SUMMARY_FILENAME);
  const tmp = join(stateDir, `${SUMMARY_FILENAME}.tmp.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(summary, null, 2), "utf-8");
  renameSync(tmp, target);
}

function computeComprehensionAvg(db: DbLike): number | null {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const result = db.exec(
      `SELECT AVG(cp.score) FROM comprehension_proxy cp
       INNER JOIN events e ON cp.event_id = e.id
       WHERE e.ts >= '${cutoff}'`,
    );
    const avg = result[0]?.values[0]?.[0] as number | null;
    if (avg === null || avg === undefined) return null;
    return Math.round(avg * 100);
  } catch {
    return null;
  }
}

function computeTopDomainFromDb(db: DbLike): string | null {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const result = db.exec(
      `SELECT content_summary, content_detail FROM events
       WHERE ts >= '${cutoff}' AND source IN ('ai-session', 'mcp-active')
       ORDER BY ts DESC LIMIT 50`,
    );
    if (!result[0]?.values.length) return null;

    const domainCounts = new Map<string, number>();
    for (const row of result[0].values) {
      const text = `${row[0] ?? ""} ${row[1] ?? ""}`;
      const d = topDomain(text);
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }

    let best: string | null = null;
    let bestCount = 0;
    for (const [domain, count] of domainCounts) {
      if (domain !== "general" && count > bestCount) {
        best = domain;
        bestCount = count;
      }
    }
    return best;
  } catch {
    return null;
  }
}

function computeVelocityProxy(db: DbLike): number | null {
  try {
    const result = db.exec(`SELECT rdi FROM metric_snapshots ORDER BY date DESC LIMIT 7`);
    if (!result[0]?.values || result[0].values.length < 2) return null;

    const values = result[0].values.map((r) => r[0] as number).reverse();
    const first = values[0];
    const last = values[values.length - 1];
    if (first === 0) return null;

    return Math.round(((last - first) / first) * 100);
  } catch {
    return null;
  }
}

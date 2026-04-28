// FILE: src/services/intelligence/cross-analyzer.ts
// Dynamic cross-analyzer correlation discovery.
// After the DAG scheduler runs, any pair of analyzers that both changed in
// this cycle have their time-series re-correlated. Replaces the 4 hardcoded
// pairs with open-ended N² discovery. Maintains a correlation registry with
// confidence decay for stale pairs.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { AnalyzerContext } from "./analyzers/index.js";
import type { UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrelationPair {
  id: string;
  a: string;
  b: string;
  r: number;
  direction: "positive" | "negative";
  temporalLag: number;
  confidence: number;
  computedAt: string;
  dataPoints: number;
}

export interface CorrelationReport {
  correlations: CorrelationPair[];
  updatedAt: string;
  discoveredPairs: number;
  checkedPairs: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MIN_DATA_POINTS = 7;
const MIN_R = 0.5;
const DECAY_START_DAYS = 14;
const DECAY_FACTOR_PER_WEEK = 0.7;
const MIN_CONFIDENCE = 0.3;

/**
 * Time-series query templates for each analyzer.
 * Maps analyzer name → SQL that produces daily numeric values.
 * Each query must return rows of (day DATE, value FLOAT).
 */
const ANALYZER_SERIES: Record<string, string> = {
  efficiency: `
    SELECT ts::DATE as day, AVG(human_direction_score) as value
    FROM events WHERE source IN ('ai-session', 'mcp-active')
      AND ts >= now() - INTERVAL '30 days' AND human_direction_score IS NOT NULL
    GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day`,

  "loop-detector": `
    SELECT ts::DATE as day,
      SUM(CASE WHEN outcome IN ('failed', 'abandoned') THEN 1 ELSE 0 END)::FLOAT / GREATEST(COUNT(*), 1) as value
    FROM events WHERE source IN ('ai-session', 'mcp-active')
      AND ts >= now() - INTERVAL '30 days'
    GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day`,

  "comprehension-radar": `
    SELECT ca.timestamp::DATE as day, AVG(ca.overall_score) as value
    FROM comprehension_assessment ca
    WHERE ca.timestamp >= now() - INTERVAL '30 days'
    GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day`,

  "velocity-tracker": `
    SELECT ts::DATE as day, AVG(turn_count)::FLOAT as value
    FROM events WHERE source IN ('ai-session', 'mcp-active')
      AND ts >= now() - INTERVAL '30 days' AND turn_count IS NOT NULL
    GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day`,

  "cost-attribution": `
    SELECT ts::DATE as day, SUM(COALESCE(estimated_cost, 0)) as value
    FROM events WHERE source IN ('ai-session', 'mcp-active')
      AND ts >= now() - INTERVAL '30 days'
    GROUP BY day ORDER BY day`,

  "prompt-patterns": `
    SELECT ts::DATE as day, AVG(prompt_specificity) as value
    FROM events WHERE source IN ('ai-session', 'mcp-active')
      AND ts >= now() - INTERVAL '30 days' AND prompt_specificity IS NOT NULL
    GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day`,

  "blind-spot-detector": `
    SELECT ts::DATE as day,
      SUM(CASE WHEN human_direction_score < 0.2 THEN 1 ELSE 0 END)::FLOAT / GREATEST(COUNT(*), 1) as value
    FROM events WHERE source IN ('ai-session', 'mcp-active')
      AND ts >= now() - INTERVAL '30 days' AND human_direction_score IS NOT NULL
    GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day`,

  "decision-replay": `
    SELECT date as day, COUNT(*)::FLOAT as value
    FROM decisions WHERE date >= (now() - INTERVAL '30 days')::DATE
    GROUP BY date ORDER BY date`,

  "direction-by-file": `
    SELECT ts::DATE as day, AVG(human_direction_score) as value
    FROM events WHERE ts >= now() - INTERVAL '30 days' AND human_direction_score IS NOT NULL
    GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day`,

  "window-aggregator": `
    SELECT window_end::DATE as day, AVG(direction_density) as value
    FROM direction_windows WHERE window_end >= now() - INTERVAL '30 days'
    GROUP BY day ORDER BY day`,

  "token-proxy": `
    SELECT date as day, SUM(estimated_cost) as value
    FROM token_proxy_spend WHERE date >= (now() - INTERVAL '30 days')::DATE
    GROUP BY date ORDER BY date`,
};

// ---------------------------------------------------------------------------
// Core discovery function (called by scheduler)
// ---------------------------------------------------------------------------

export async function discoverCorrelations(
  changedAnalyzers: Map<string, UpdateResult<unknown>>,
  ctx: AnalyzerContext,
): Promise<CorrelationReport> {
  const now = new Date().toISOString();
  const existing = loadExistingCorrelations();
  const changedNames = [...changedAnalyzers.keys()].filter((n) => ANALYZER_SERIES[n]);

  if (changedNames.length < 2) {
    const decayed = applyDecay(existing.correlations, now);
    const report: CorrelationReport = {
      correlations: decayed,
      updatedAt: now,
      discoveredPairs: 0,
      checkedPairs: 0,
    };
    writeCorrelations(report);
    return report;
  }

  const seriesCache = new Map<string, Map<string, number>>();
  for (const name of changedNames) {
    const sql = ANALYZER_SERIES[name];
    if (!sql) continue;
    try {
      const result = await ctx.analytics.exec(sql);
      if (result[0]?.values.length) {
        const series = new Map<string, number>();
        for (const row of result[0].values) {
          const day = String(row[0]);
          const val = Number(row[1] ?? 0);
          series.set(day, val);
        }
        seriesCache.set(name, series);
      }
    } catch {
      // skip this analyzer
    }
  }

  const fresh: CorrelationPair[] = [];
  let checkedPairs = 0;
  const seriesNames = [...seriesCache.keys()];

  for (let i = 0; i < seriesNames.length; i++) {
    for (let j = i + 1; j < seriesNames.length; j++) {
      const nameA = seriesNames[i];
      const nameB = seriesNames[j];
      const seriesA = seriesCache.get(nameA)!;
      const seriesB = seriesCache.get(nameB)!;

      const { xs, ys } = alignSeries(seriesA, seriesB);
      if (xs.length < MIN_DATA_POINTS) continue;

      checkedPairs++;
      const r = pearson(xs, ys);
      if (Math.abs(r) < MIN_R) continue;

      const lag = computeTemporalLag(xs, ys);

      fresh.push({
        id: pairId(nameA, nameB),
        a: nameA,
        b: nameB,
        r: Math.round(r * 1000) / 1000,
        direction: r > 0 ? "positive" : "negative",
        temporalLag: lag,
        confidence: Math.min(1, xs.length / 20),
        computedAt: now,
        dataPoints: xs.length,
      });
    }
  }

  const freshIds = new Set(fresh.map((c) => c.id));
  const decayed = applyDecay(
    existing.correlations.filter((c) => !freshIds.has(c.id)),
    now,
  );

  const report: CorrelationReport = {
    correlations: [...decayed, ...fresh],
    updatedAt: now,
    discoveredPairs: fresh.length,
    checkedPairs,
  };

  writeCorrelations(report);
  return report;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function writeCorrelations(report: CorrelationReport, repoRoot?: string): void {
  const dir = getIntelligenceDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "correlation.json");
  const tmp = join(dir, `correlation.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmp, JSON.stringify(report, null, 2), "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    logger.debug("Failed to write correlation.json", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function loadExistingCorrelations(repoRoot?: string): CorrelationReport {
  try {
    const dir = getIntelligenceDir(repoRoot);
    const path = join(dir, "correlation.json");
    if (!existsSync(path))
      return { correlations: [], updatedAt: "", discoveredPairs: 0, checkedPairs: 0 };
    return JSON.parse(readFileSync(path, "utf-8")) as CorrelationReport;
  } catch {
    return { correlations: [], updatedAt: "", discoveredPairs: 0, checkedPairs: 0 };
  }
}

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < MIN_DATA_POINTS) return 0;

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

function alignSeries(
  a: Map<string, number>,
  b: Map<string, number>,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [day, valA] of a) {
    const valB = b.get(day);
    if (valB !== undefined) {
      xs.push(valA);
      ys.push(valB);
    }
  }
  return { xs, ys };
}

function computeTemporalLag(seriesA: number[], seriesB: number[]): number {
  if (seriesA.length < 3) return 0;
  const lag0 = pearson(seriesA.slice(0, -1), seriesB.slice(0, -1));
  const lag1 = pearson(seriesA.slice(0, -1), seriesB.slice(1));
  if (lag1 > lag0 + 0.1) return 1440;
  return 0;
}

function applyDecay(correlations: CorrelationPair[], now: string): CorrelationPair[] {
  const result: CorrelationPair[] = [];
  for (const c of correlations) {
    const ageDays = (new Date(now).getTime() - new Date(c.computedAt).getTime()) / (86400 * 1000);
    if (ageDays <= DECAY_START_DAYS) {
      result.push(c);
    } else {
      const weeksOver = (ageDays - DECAY_START_DAYS) / 7;
      const newConf = c.confidence * DECAY_FACTOR_PER_WEEK ** weeksOver;
      if (newConf >= MIN_CONFIDENCE) {
        result.push({ ...c, confidence: Math.round(newConf * 100) / 100 });
      }
    }
  }
  return result;
}

function pairId(a: string, b: string): string {
  return a < b ? `${a}↔${b}` : `${b}↔${a}`;
}

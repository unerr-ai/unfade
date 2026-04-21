// FILE: src/services/intelligence/cross-analyzer.ts
// 11E.1/11E.10: Cross-analyzer correlation module.
// Computes pairwise correlations between analyzer outputs. Requires Pearson r > 0.6 AND
// temporal ordering to assert causality. Confidence decays 0.7× per week after 14 days.

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import type { AnalyzerContext } from "./analyzers/index.js";

export interface CorrelationPair {
  id: string;
  a: string;
  b: string;
  r: number;
  direction: "positive" | "negative";
  temporalLag: number; // minutes: positive means A precedes B
  confidence: number;
  computedAt: string;
  dataPoints: number;
}

export interface CorrelationReport {
  correlations: CorrelationPair[];
  updatedAt: string;
}

const MIN_DATA_POINTS = 7;
const MIN_R = 0.6;
const DECAY_START_DAYS = 14;
const DECAY_FACTOR_PER_WEEK = 0.7;
const MIN_CONFIDENCE = 0.3;

/**
 * Compute cross-analyzer correlations from intelligence outputs and event data.
 * Called after all 8 analyzers have produced output.
 */
export function computeCorrelations(ctx: AnalyzerContext): CorrelationReport {
  const now = new Date().toISOString();

  // Load existing correlations for decay
  const existing = loadExistingCorrelations(ctx.repoRoot);

  // Compute fresh correlations from DB time-series
  const fresh: CorrelationPair[] = [];

  const efficiencyLoops = correlateEfficiencyAndLoops(ctx.db, now);
  if (efficiencyLoops) fresh.push(efficiencyLoops);

  const comprehensionVelocity = correlateComprehensionAndVelocity(ctx.db, now);
  if (comprehensionVelocity) fresh.push(comprehensionVelocity);

  const costOutcomes = correlateCostAndOutcomes(ctx.db, now);
  if (costOutcomes) fresh.push(costOutcomes);

  const blindSpotsLoops = correlateBlindSpotsAndLoops(ctx.db, now);
  if (blindSpotsLoops) fresh.push(blindSpotsLoops);

  // Merge: fresh correlations replace same-id existing; apply decay to stale ones
  const merged = mergeWithDecay(existing.correlations, fresh, now);

  return { correlations: merged, updatedAt: now };
}

/**
 * Write correlation report atomically.
 */
export function writeCorrelations(report: CorrelationReport, repoRoot: string): void {
  const dir = join(repoRoot, ".unfade", "intelligence");
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

function loadExistingCorrelations(repoRoot: string): CorrelationReport {
  try {
    const path = join(repoRoot, ".unfade", "intelligence", "correlation.json");
    if (!existsSync(path)) return { correlations: [], updatedAt: "" };
    return JSON.parse(readFileSync(path, "utf-8")) as CorrelationReport;
  } catch {
    return { correlations: [], updatedAt: "" };
  }
}

/**
 * 11E.10: Apply confidence decay to old correlations, merge with fresh ones.
 * Remove any below MIN_CONFIDENCE threshold.
 */
function mergeWithDecay(
  existing: CorrelationPair[],
  fresh: CorrelationPair[],
  now: string,
): CorrelationPair[] {
  const freshIds = new Set(fresh.map((c) => c.id));
  const decayed: CorrelationPair[] = [];

  for (const c of existing) {
    if (freshIds.has(c.id)) continue; // replaced by fresh
    const ageDays = (new Date(now).getTime() - new Date(c.computedAt).getTime()) / (86400 * 1000);
    if (ageDays <= DECAY_START_DAYS) {
      decayed.push(c);
    } else {
      const weeksOverThreshold = (ageDays - DECAY_START_DAYS) / 7;
      const newConfidence = c.confidence * Math.pow(DECAY_FACTOR_PER_WEEK, weeksOverThreshold);
      if (newConfidence >= MIN_CONFIDENCE) {
        decayed.push({ ...c, confidence: Math.round(newConfidence * 100) / 100 });
      }
      // else: evicted — below threshold
    }
  }

  return [...decayed, ...fresh];
}

/**
 * Pearson correlation between two numeric arrays.
 */
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

/**
 * efficiency ↔ loops: Are loops causing efficiency drops?
 * Group by day: average AES vs loop count.
 */
function correlateEfficiencyAndLoops(
  db: AnalyzerContext["db"],
  now: string,
): CorrelationPair | null {
  try {
    const result = db.exec(`
      SELECT
        date(e.ts) as day,
        AVG(CAST(json_extract(e.metadata, '$.direction_signals.human_direction_score') AS REAL)) as avg_hds,
        SUM(CASE WHEN json_extract(e.metadata, '$.outcome') = 'failed' THEN 1 ELSE 0 END) as loop_count
      FROM events e
      WHERE e.source IN ('ai-session', 'mcp-active')
        AND e.ts >= datetime('now', '-30 days')
        AND json_extract(e.metadata, '$.direction_signals.human_direction_score') IS NOT NULL
      GROUP BY day
      HAVING COUNT(*) >= 3
      ORDER BY day
    `);

    if (!result[0]?.values || result[0].values.length < MIN_DATA_POINTS) return null;

    const efficiencies = result[0].values.map((r) => (r[1] as number) ?? 0);
    const loops = result[0].values.map((r) => (r[2] as number) ?? 0);
    const r = pearson(efficiencies, loops);

    if (Math.abs(r) < MIN_R) return null;

    // Temporal check: do loop spikes precede efficiency drops?
    // Use simple lag-1 cross-correlation
    const lag = computeTemporalLag(loops, efficiencies);

    return {
      id: "efficiency-loops",
      a: "efficiency",
      b: "loop-detector",
      r: Math.round(r * 1000) / 1000,
      direction: r < 0 ? "negative" : "positive",
      temporalLag: lag,
      confidence: Math.min(1, result[0].values.length / 20),
      computedAt: now,
      dataPoints: result[0].values.length,
    };
  } catch {
    return null;
  }
}

/**
 * comprehension ↔ velocity: Does understanding correlate with speed?
 */
function correlateComprehensionAndVelocity(
  db: AnalyzerContext["db"],
  now: string,
): CorrelationPair | null {
  try {
    const result = db.exec(`
      SELECT
        date(e.ts) as day,
        AVG(CAST(json_extract(e.metadata, '$.direction_signals.human_direction_score') AS REAL)) as avg_comprehension,
        AVG(CAST(json_extract(e.metadata, '$.turn_count') AS REAL)) as avg_turns
      FROM events e
      WHERE e.source IN ('ai-session', 'mcp-active')
        AND e.ts >= datetime('now', '-30 days')
        AND json_extract(e.metadata, '$.direction_signals.human_direction_score') IS NOT NULL
        AND json_extract(e.metadata, '$.turn_count') IS NOT NULL
      GROUP BY day
      HAVING COUNT(*) >= 3
      ORDER BY day
    `);

    if (!result[0]?.values || result[0].values.length < MIN_DATA_POINTS) return null;

    const comprehension = result[0].values.map((r) => (r[1] as number) ?? 0);
    // Invert turns: fewer turns = higher velocity
    const velocity = result[0].values.map((r) => 1 / Math.max(1, (r[2] as number) ?? 1));
    const r = pearson(comprehension, velocity);

    if (Math.abs(r) < MIN_R) return null;

    return {
      id: "comprehension-velocity",
      a: "comprehension-radar",
      b: "velocity-tracker",
      r: Math.round(r * 1000) / 1000,
      direction: r > 0 ? "positive" : "negative",
      temporalLag: 0,
      confidence: Math.min(1, result[0].values.length / 20),
      computedAt: now,
      dataPoints: result[0].values.length,
    };
  } catch {
    return null;
  }
}

/**
 * cost ↔ outcomes: Does spending more produce better outcomes?
 */
function correlateCostAndOutcomes(
  db: AnalyzerContext["db"],
  now: string,
): CorrelationPair | null {
  try {
    const result = db.exec(`
      SELECT
        date(e.ts) as day,
        COUNT(*) as session_count,
        SUM(CASE WHEN json_extract(e.metadata, '$.outcome') = 'success' THEN 1 ELSE 0 END) as success_count
      FROM events e
      WHERE e.source IN ('ai-session', 'mcp-active')
        AND e.ts >= datetime('now', '-30 days')
        AND json_extract(e.metadata, '$.outcome') IS NOT NULL
      GROUP BY day
      HAVING COUNT(*) >= 2
      ORDER BY day
    `);

    if (!result[0]?.values || result[0].values.length < MIN_DATA_POINTS) return null;

    const cost = result[0].values.map((r) => (r[1] as number) ?? 0);
    const successRate = result[0].values.map((r) => {
      const total = (r[1] as number) ?? 1;
      const success = (r[2] as number) ?? 0;
      return total > 0 ? success / total : 0;
    });
    const r = pearson(cost, successRate);

    if (Math.abs(r) < MIN_R) return null;

    return {
      id: "cost-outcomes",
      a: "cost-attribution",
      b: "outcome-success-rate",
      r: Math.round(r * 1000) / 1000,
      direction: r > 0 ? "positive" : "negative",
      temporalLag: 0,
      confidence: Math.min(1, result[0].values.length / 20),
      computedAt: now,
      dataPoints: result[0].values.length,
    };
  } catch {
    return null;
  }
}

/**
 * blind-spots ↔ loops: Are you stuck where you're weakest?
 */
function correlateBlindSpotsAndLoops(
  db: AnalyzerContext["db"],
  now: string,
): CorrelationPair | null {
  try {
    // Per-module: low comprehension vs high failure rate
    const result = db.exec(`
      SELECT
        COALESCE(json_extract(e.metadata, '$.domain'), 'unknown') as domain,
        AVG(CAST(json_extract(e.metadata, '$.direction_signals.human_direction_score') AS REAL)) as avg_hds,
        SUM(CASE WHEN json_extract(e.metadata, '$.outcome') IN ('failed', 'abandoned') THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as failure_rate
      FROM events e
      WHERE e.source IN ('ai-session', 'mcp-active')
        AND e.ts >= datetime('now', '-30 days')
        AND json_extract(e.metadata, '$.direction_signals.human_direction_score') IS NOT NULL
      GROUP BY domain
      HAVING COUNT(*) >= 5
      ORDER BY domain
    `);

    if (!result[0]?.values || result[0].values.length < MIN_DATA_POINTS) return null;

    // Low comprehension (inverse HDS) should correlate with high failure rate
    const blindSpotScore = result[0].values.map((r) => 1 - ((r[1] as number) ?? 0));
    const failureRate = result[0].values.map((r) => (r[2] as number) ?? 0);
    const r = pearson(blindSpotScore, failureRate);

    if (Math.abs(r) < MIN_R) return null;

    return {
      id: "blindspots-loops",
      a: "blind-spot-detector",
      b: "loop-detector",
      r: Math.round(r * 1000) / 1000,
      direction: r > 0 ? "positive" : "negative",
      temporalLag: 0,
      confidence: Math.min(1, result[0].values.length / 15),
      computedAt: now,
      dataPoints: result[0].values.length,
    };
  } catch {
    return null;
  }
}

/**
 * Simple temporal lag estimation: check if peaks in series A
 * tend to precede peaks in series B. Returns estimated lag in minutes (positive = A leads).
 */
function computeTemporalLag(seriesA: number[], seriesB: number[]): number {
  if (seriesA.length < 3) return 0;

  // Lag-1 cross-correlation: does A[i] correlate more with B[i+1] than B[i]?
  const lag0 = pearson(seriesA.slice(0, -1), seriesB.slice(0, -1));
  const lag1 = pearson(seriesA.slice(0, -1), seriesB.slice(1));

  // Each data point = 1 day, so lag1 > lag0 means ~1 day lag
  if (lag1 > lag0 + 0.1) return 1440; // 1 day in minutes
  return 0;
}

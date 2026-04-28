// FILE: src/services/knowledge/comprehension-aggregator.ts
// Layer 2.5 KE-14.1: Daily comprehension score aggregator.
// Computes the hero metric (0–100 Comprehension Score) from per-domain FSRS
// decay state. Implements §10 weighted aggregation + Mann-Kendall trend detection.
//
// Pipeline:
//   1. Query domain_comprehension for all active domains in the project
//   2. Apply FSRS power-law decay inline (retrievability formula from §9)
//   3. Compute weighted average: domainWeight = recencyWeight × significanceWeight
//   4. Run Mann-Kendall trend detection on last 7 daily scores
//   5. Write result to DuckDB comprehension_scores table
//   6. Write intelligence/comprehension.json for the dashboard

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { DbLike } from "../cache/manager.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DailyComprehensionResult {
  score: number;
  trend: "improving" | "declining" | "stable";
  domainCount: number;
  topDomain: string;
  weakDomain: string;
}

interface DomainRow {
  domain: string;
  baseScore: number;
  stability: number;
  complexityModifier: number;
  floorValue: number;
  lastTouch: string;
  interactionCount: number;
}

interface DomainScored extends DomainRow {
  currentScore: number;
  daysSinceTouch: number;
  weight: number;
}

interface ComprehensionSnapshot {
  score: number;
  trend: "improving" | "declining" | "stable";
  domainCount: number;
  topDomain: string;
  weakDomain: string;
  date: string;
  domains: Array<{
    domain: string;
    score: number;
    stability: number;
    daysSinceTouch: number;
    weight: number;
  }>;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute the daily comprehension score for a project.
 *
 * Implements §10: weighted average of FSRS-decayed domain scores,
 * with Mann-Kendall trend detection on the last 7 daily scores.
 */
export async function computeDailyComprehensionScore(
  date: string,
  projectId: string,
  analytics: DbLike,
  homeOverride?: string,
): Promise<DailyComprehensionResult> {
  const domains = await loadDomainStates(projectId, analytics);

  if (domains.length === 0) {
    const empty: DailyComprehensionResult = {
      score: 0,
      trend: "stable",
      domainCount: 0,
      topDomain: "",
      weakDomain: "",
    };
    await writeScoreToDb(date, projectId, empty, analytics);
    return empty;
  }

  const dateMs = new Date(date).getTime();
  const scored = domains.map((d) => scoreDomain(d, dateMs));

  const { score, topDomain, weakDomain } = computeWeightedAverage(scored);
  const trend = await detectTrend(date, projectId, analytics);

  const result: DailyComprehensionResult = {
    score: Math.round(score * 10) / 10,
    trend,
    domainCount: scored.length,
    topDomain,
    weakDomain,
  };

  await writeScoreToDb(date, projectId, result, analytics);
  writeSnapshotJson(date, result, scored, homeOverride);

  return result;
}

// ─── FSRS Decay (§9) ────────────────────────────────────────────────────────

/**
 * FSRS power-law retrievability formula.
 * R(t) = (1 + t / (9 × S × C))^(-1)
 *
 * Where:
 *   t = days since last interaction
 *   S = stability (days until R drops to 90%)
 *   C = complexity modifier (0.5 – 1.5)
 */
export function computeRetrievability(
  daysSinceTouch: number,
  stability: number,
  complexityModifier: number,
): number {
  const effectiveStability = stability * complexityModifier;
  if (effectiveStability <= 0 || daysSinceTouch < 0) return 1.0;
  return Math.pow(1 + daysSinceTouch / (9 * effectiveStability), -1);
}

function scoreDomain(d: DomainRow, dateMs: number): DomainScored {
  const lastTouchMs = new Date(d.lastTouch).getTime();
  const daysSinceTouch = Math.max(0, (dateMs - lastTouchMs) / (1000 * 60 * 60 * 24));

  const retrievability = computeRetrievability(daysSinceTouch, d.stability, d.complexityModifier);
  const rawScore = d.baseScore * retrievability;
  const currentScore = Math.max(rawScore, d.floorValue);

  const recencyWeight = computeRecencyWeight(daysSinceTouch);
  const significanceWeight = Math.log2(d.interactionCount + 1);
  const weight = recencyWeight * Math.max(significanceWeight, 0.1);

  return { ...d, currentScore, daysSinceTouch, weight };
}

/**
 * §10 recency weight brackets.
 * Recent domains contribute more to the daily score.
 */
function computeRecencyWeight(daysSinceTouch: number): number {
  if (daysSinceTouch <= 7) return 1.0;
  if (daysSinceTouch <= 30) return 0.7;
  if (daysSinceTouch <= 90) return 0.3;
  return 0.1;
}

function computeWeightedAverage(
  domains: DomainScored[],
): { score: number; topDomain: string; weakDomain: string } {
  let totalWeight = 0;
  let weightedSum = 0;
  let topDomain = "";
  let topScore = -1;
  let weakDomain = "";
  let weakScore = Infinity;

  for (const d of domains) {
    weightedSum += d.currentScore * d.weight;
    totalWeight += d.weight;

    if (d.currentScore > topScore) {
      topScore = d.currentScore;
      topDomain = d.domain;
    }
    if (d.currentScore < weakScore) {
      weakScore = d.currentScore;
      weakDomain = d.domain;
    }
  }

  const score = totalWeight > 0 ? (weightedSum / totalWeight) * 10 : 0;
  return { score: Math.min(score, 100), topDomain, weakDomain };
}

// ─── Mann-Kendall Trend Detection ───────────────────────────────────────────

/**
 * Mann-Kendall nonparametric trend test on the last 7 daily scores.
 * Returns "improving" if τ > 0.3 and p < 0.05,
 * "declining" if τ < -0.3 and p < 0.05,
 * "stable" otherwise.
 *
 * Requires at least 3 data points for meaningful detection.
 */
export function mannKendallTrend(
  scores: number[],
): "improving" | "declining" | "stable" {
  const n = scores.length;
  if (n < 3) return "stable";

  let concordant = 0;
  let discordant = 0;

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (scores[j] > scores[i]) concordant++;
      else if (scores[j] < scores[i]) discordant++;
    }
  }

  const S = concordant - discordant;
  const pairs = (n * (n - 1)) / 2;
  const tau = S / pairs;

  // Variance of S under the null hypothesis (no trend)
  const variance = (n * (n - 1) * (2 * n + 5)) / 18;
  const stdDev = Math.sqrt(variance);

  // Continuity correction
  const zNumerator = S > 0 ? S - 1 : S < 0 ? S + 1 : 0;
  const Z = stdDev > 0 ? zNumerator / stdDev : 0;

  // Approximate p-value from standard normal (two-tailed)
  const p = 2 * (1 - normalCDF(Math.abs(Z)));

  if (tau > 0.3 && p < 0.05) return "improving";
  if (tau < -0.3 && p < 0.05) return "declining";
  return "stable";
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun, 1964).
 * Accurate to ±1.5×10⁻⁷ for all x.
 */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

// ─── DuckDB Queries ─────────────────────────────────────────────────────────

async function loadDomainStates(projectId: string, analytics: DbLike): Promise<DomainRow[]> {
  try {
    const result = await analytics.exec(
      `SELECT domain, base_score, stability, complexity_modifier, floor_value,
              last_touch, interaction_count
       FROM domain_comprehension
       WHERE project_id = $1`,
      [projectId],
    );

    const rows = result[0]?.values ?? [];
    return rows.map((r) => ({
      domain: (r[0] as string) ?? "",
      baseScore: (r[1] as number) ?? 0,
      stability: (r[2] as number) ?? 1,
      complexityModifier: (r[3] as number) ?? 1,
      floorValue: (r[4] as number) ?? 0,
      lastTouch: (r[5] as string) ?? new Date().toISOString(),
      interactionCount: (r[6] as number) ?? 1,
    }));
  } catch (err) {
    logger.warn("Failed to load domain states", {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function detectTrend(
  date: string,
  projectId: string,
  analytics: DbLike,
): Promise<"improving" | "declining" | "stable"> {
  try {
    const result = await analytics.exec(
      `SELECT score FROM comprehension_scores
       WHERE project_id = $1 AND date <= $2
       ORDER BY date DESC
       LIMIT 7`,
      [projectId, date],
    );

    const rows = result[0]?.values ?? [];
    if (rows.length < 3) return "stable";

    const scores = rows.map((r) => (r[0] as number) ?? 0).reverse();
    return mannKendallTrend(scores);
  } catch {
    return "stable";
  }
}

async function writeScoreToDb(
  date: string,
  projectId: string,
  result: DailyComprehensionResult,
  analytics: DbLike,
): Promise<void> {
  try {
    await analytics.exec(
      `INSERT INTO comprehension_scores
        (date, project_id, score, trend, domain_count, top_domain, weak_domain)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (date, project_id) DO UPDATE SET
        score = EXCLUDED.score,
        trend = EXCLUDED.trend,
        domain_count = EXCLUDED.domain_count,
        top_domain = EXCLUDED.top_domain,
        weak_domain = EXCLUDED.weak_domain`,
      [date, projectId, result.score, result.trend, result.domainCount, result.topDomain, result.weakDomain],
    );
  } catch (err) {
    logger.warn("Failed to write comprehension score to DuckDB", {
      date,
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function writeSnapshotJson(
  date: string,
  result: DailyComprehensionResult,
  domains: DomainScored[],
  homeOverride?: string,
): void {
  try {
    const dir = getIntelligenceDir(homeOverride);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const snapshot: ComprehensionSnapshot = {
      score: result.score,
      trend: result.trend,
      domainCount: result.domainCount,
      topDomain: result.topDomain,
      weakDomain: result.weakDomain,
      date,
      domains: domains.map((d) => ({
        domain: d.domain,
        score: Math.round(d.currentScore * 100) / 100,
        stability: Math.round(d.stability * 100) / 100,
        daysSinceTouch: Math.round(d.daysSinceTouch),
        weight: Math.round(d.weight * 1000) / 1000,
      })),
    };

    writeFileSync(
      join(dir, "comprehension.json"),
      JSON.stringify(snapshot, null, 2),
      "utf-8",
    );
  } catch (err) {
    logger.debug("Failed to write comprehension.json", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

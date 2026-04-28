// FILE: src/services/knowledge/decay-engine.ts
// Layer 2.5 KE-15.1: FSRS-adapted comprehension decay engine.
// Daily batch computation that applies the forgetting curve to all domain
// comprehension scores. Pure arithmetic on DuckDB — no LLM calls.
//
// FSRS power-law decay (§9): R(t) = (1 + t / (9 × S × C))^(-1)
// Where: t = days since last touch, S = stability, C = complexity modifier
//
// Also exports the FSRS stability update formula (KE-15.2) for use by
// comprehension-writer.ts during re-engagement events.

import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";

// ─── FSRS Constants (§9, calibrated from Ye et al. 2024) ───────────────────

/** FSRS decay factor — calibrated against 100M+ Anki reviews. */
const FSRS_DECAY_FACTOR = 9;

/** Minimum score before a domain is pruned (no longer meaningful). */
const PRUNE_THRESHOLD = 5.0;

/** Maximum stability in days (cap prevents unrealistic retention). */
export const MAX_STABILITY = 365;

/** FSRS decay multiplier — calibrated from FSRS w[17]. */
const DECAY_MULTIPLIER = 0.4;

// ─── Pure FSRS Math (exported for reuse) ────────────────────────────────────

/**
 * FSRS power-law retrievability formula.
 * R(t) = (1 + t / (9 × S × C))^(-1)
 *
 * Heavier tail than Ebbinghaus exponential — developers retain some
 * comprehension of deeply understood material even after long gaps.
 */
export function computeRetrievability(
  daysSinceTouch: number,
  stability: number,
  complexityModifier: number,
): number {
  const effectiveStability = stability * complexityModifier;
  if (effectiveStability <= 0 || daysSinceTouch < 0) return 1.0;
  return Math.pow(1 + daysSinceTouch / (FSRS_DECAY_FACTOR * effectiveStability), -1);
}

/**
 * FSRS stability update on re-engagement (§9 simplified approximation).
 * S' = S × (1 + 0.4 × log2(engagement_quality + 1))
 *
 * Stability grows sublinearly — the 5th interaction adds less stability
 * than the 2nd, matching real-world developer experience.
 *
 * @param currentStability Current stability in days
 * @param engagementQuality 1-5 scale (1=mentioned, 5=authored+understood)
 * @returns New stability in days, capped at MAX_STABILITY
 */
export function computeStabilityUpdate(
  currentStability: number,
  engagementQuality: number,
): number {
  const quality = Math.max(1, Math.min(5, engagementQuality));
  const growth = 1 + DECAY_MULTIPLIER * Math.log2(quality + 1);
  return Math.min(currentStability * growth, MAX_STABILITY);
}

/**
 * Compute the decayed comprehension score for a domain.
 * Applies FSRS retrievability then floor value.
 */
export function computeDecayedScore(
  baseScore: number,
  daysSinceTouch: number,
  stability: number,
  complexityModifier: number,
  floorValue: number,
): number {
  const retrievability = computeRetrievability(daysSinceTouch, stability, complexityModifier);
  const rawScore = baseScore * retrievability;
  return Math.max(rawScore, floorValue);
}

// ─── Daily Decay Batch (KE-15.1) ────────────────────────────────────────────

export interface DecayResult {
  domainsUpdated: number;
  domainsDecayed: number;
  domainsPruned: number;
}

/**
 * Apply FSRS decay to all domain_comprehension rows and prune dead domains.
 *
 * Runs daily as part of the distill pipeline. Pure DuckDB arithmetic.
 *
 * Steps:
 *   1. Load all domains (optionally filtered by projectId)
 *   2. Compute decayed current_score for each
 *   3. Update current_score in DuckDB
 *   4. Prune domains where current_score < PRUNE_THRESHOLD
 */
export async function computeDecay(
  analytics: DbLike,
  projectId?: string,
): Promise<DecayResult> {
  const result: DecayResult = { domainsUpdated: 0, domainsDecayed: 0, domainsPruned: 0 };

  const domains = await loadDomainsForDecay(analytics, projectId);
  if (domains.length === 0) return result;

  const now = Date.now();

  for (const domain of domains) {
    const lastTouchMs = new Date(domain.lastTouch).getTime();
    const daysSinceTouch = Math.max(0, (now - lastTouchMs) / (1000 * 60 * 60 * 24));

    const newScore = computeDecayedScore(
      domain.baseScore,
      daysSinceTouch,
      domain.stability,
      domain.complexityModifier,
      domain.floorValue,
    );

    const decayed = newScore < domain.baseScore * 0.95;

    try {
      await analytics.exec(
        `UPDATE domain_comprehension
         SET current_score = $1, updated_at = CURRENT_TIMESTAMP
         WHERE domain = $2 AND project_id = $3`,
        [newScore, domain.domain, domain.projectId],
      );

      result.domainsUpdated++;
      if (decayed) result.domainsDecayed++;
    } catch (err) {
      logger.debug("Failed to update domain decay", {
        domain: domain.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Prune near-zero domains
  result.domainsPruned = await pruneDomains(analytics, projectId);

  logger.debug("Decay computation complete", {
    ...result,
    projectId: projectId ?? "all",
  });

  return result;
}

// ─── DuckDB Helpers ─────────────────────────────────────────────────────────

interface DomainDecayRow {
  domain: string;
  projectId: string;
  baseScore: number;
  stability: number;
  complexityModifier: number;
  floorValue: number;
  lastTouch: string;
}

async function loadDomainsForDecay(
  analytics: DbLike,
  projectId?: string,
): Promise<DomainDecayRow[]> {
  try {
    const projectClause = projectId ? "WHERE project_id = $1" : "";
    const params = projectId ? [projectId] : [];

    const result = await analytics.exec(
      `SELECT domain, project_id, base_score, stability, complexity_modifier,
              floor_value, last_touch
       FROM domain_comprehension
       ${projectClause}`,
      params,
    );

    const rows = result[0]?.values ?? [];
    return rows.map((r) => ({
      domain: (r[0] as string) ?? "",
      projectId: (r[1] as string) ?? "",
      baseScore: (r[2] as number) ?? 0,
      stability: (r[3] as number) ?? 1,
      complexityModifier: (r[4] as number) ?? 1,
      floorValue: (r[5] as number) ?? 0,
      lastTouch: (r[6] as string) ?? new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn("Failed to load domains for decay", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function pruneDomains(analytics: DbLike, projectId?: string): Promise<number> {
  try {
    const projectClause = projectId ? "AND project_id = $2" : "";
    const params: unknown[] = [PRUNE_THRESHOLD];
    if (projectId) params.push(projectId);

    // Count before delete
    const countResult = await analytics.exec(
      `SELECT COUNT(*) FROM domain_comprehension
       WHERE current_score < $1 AND floor_value = 0 ${projectClause}`,
      params,
    );
    const count = ((countResult[0]?.values[0]?.[0]) as number) ?? 0;

    if (count > 0) {
      await analytics.exec(
        `DELETE FROM domain_comprehension
         WHERE current_score < $1 AND floor_value = 0 ${projectClause}`,
        params,
      );
    }

    return count;
  } catch (err) {
    logger.debug("Failed to prune domains", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// FILE: src/services/intelligence/phase-baselines.ts
// 11E.6: Phase-normalized HDS baselines.
// Computes per-execution-phase HDS baseline from 30-day rolling window.
// Deviations from phase baselines replace raw HDS in comprehension radar.
// Prevents false "brain atrophy" alerts during debugging sprints.

import { logger } from "../../utils/logger.js";

/** Default expected HDS ranges per execution phase (from spec) */
const DEFAULT_PHASE_RANGES: Record<string, { low: number; high: number }> = {
  planning: { low: 0.7, high: 1.0 },
  designing: { low: 0.6, high: 0.9 },
  implementation: { low: 0.3, high: 0.7 },
  debugging: { low: 0.1, high: 0.5 },
  investigating: { low: 0.1, high: 0.5 },
  review: { low: 0.5, high: 0.8 },
};

const MIN_EVENTS_FOR_BASELINE = 50;
const _ROLLING_WINDOW_DAYS = 30;

export interface PhaseBaseline {
  phase: string;
  meanHds: number;
  stdDev: number;
  eventCount: number;
  trusted: boolean; // true if eventCount >= MIN_EVENTS_FOR_BASELINE
}

export interface PhaseBaselineReport {
  baselines: Record<string, PhaseBaseline>;
  updatedAt: string;
}

import type { DbLike } from "../cache/manager.js";

/**
 * Compute per-execution-phase HDS baselines from 30-day rolling window.
 * Returns baselines keyed by phase name.
 */
export async function computePhaseBaselines(db: DbLike): Promise<PhaseBaselineReport> {
  const now = new Date().toISOString();
  const baselines: Record<string, PhaseBaseline> = {};

  try {
    const result = await db.exec(`
      SELECT
        e.execution_phase as phase,
        e.human_direction_score as hds
      FROM events e
      WHERE e.source IN ('ai-session', 'mcp-active')
        AND e.ts >= now() - INTERVAL '30 days'
        AND e.execution_phase IS NOT NULL
        AND e.human_direction_score IS NOT NULL
    `);

    if (!result[0]?.values?.length) return { baselines, updatedAt: now };

    // Group by phase
    const phaseData: Record<string, number[]> = {};
    for (const row of result[0].values) {
      const phase = (row[0] as string) ?? "unknown";
      const hds = row[1] as number;
      if (phase === "unknown" || hds == null) continue;
      if (!phaseData[phase]) phaseData[phase] = [];
      phaseData[phase].push(hds);
    }

    for (const [phase, scores] of Object.entries(phaseData)) {
      const n = scores.length;
      const mean = scores.reduce((s, v) => s + v, 0) / n;
      const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
      const stdDev = Math.sqrt(variance);

      baselines[phase] = {
        phase,
        meanHds: Math.round(mean * 1000) / 1000,
        stdDev: Math.round(stdDev * 1000) / 1000,
        eventCount: n,
        trusted: n >= MIN_EVENTS_FOR_BASELINE,
      };
    }
  } catch (err) {
    logger.debug("Phase baseline computation failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { baselines, updatedAt: now };
}

/**
 * Normalize a raw HDS score against its execution phase baseline.
 * Returns deviation from expected: positive = above baseline, negative = below.
 * If no trusted baseline exists, falls back to default ranges.
 *
 * Output is a z-score-like value: 0 = exactly at phase mean,
 * +1 = one stddev above, -1 = one stddev below.
 */
export function normalizeHds(
  rawHds: number,
  phase: string,
  baselines: Record<string, PhaseBaseline>,
): number {
  const baseline = baselines[phase];

  if (baseline?.trusted && baseline.stdDev > 0) {
    // Use empirical baseline
    return Math.round(((rawHds - baseline.meanHds) / baseline.stdDev) * 100) / 100;
  }

  // Fall back to default ranges
  const range = DEFAULT_PHASE_RANGES[phase];
  if (!range) {
    // Unknown phase — no normalization possible
    return 0;
  }

  const midpoint = (range.low + range.high) / 2;
  const halfSpan = (range.high - range.low) / 2;
  return halfSpan > 0 ? Math.round(((rawHds - midpoint) / halfSpan) * 100) / 100 : 0;
}

/**
 * Check if a raw HDS is concerning for its execution phase.
 * Returns true if the HDS is significantly below phase baseline (> 1.5 stddev below).
 */
export function isHdsConcerning(
  rawHds: number,
  phase: string,
  baselines: Record<string, PhaseBaseline>,
): boolean {
  const normalized = normalizeHds(rawHds, phase, baselines);
  return normalized < -1.5;
}

/**
 * Get the expected HDS range for a phase (from baselines or defaults).
 */
export function getPhaseExpectedRange(
  phase: string,
  baselines: Record<string, PhaseBaseline>,
): { low: number; high: number } {
  const baseline = baselines[phase];
  if (baseline?.trusted) {
    return {
      low: Math.max(0, Math.round((baseline.meanHds - baseline.stdDev) * 100) / 100),
      high: Math.min(1, Math.round((baseline.meanHds + baseline.stdDev) * 100) / 100),
    };
  }
  return DEFAULT_PHASE_RANGES[phase] ?? { low: 0.3, high: 0.7 };
}

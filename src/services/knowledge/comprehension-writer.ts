// FILE: src/services/knowledge/comprehension-writer.ts
// Layer 2.5 KE-13: Comprehension and metacognitive signal writers.
// Writes LLM-assessed comprehension scores and metacognitive signals to both
// CozoDB (graph queries) and DuckDB (analytics + FSRS decay state).
//
// KE-13.1: writeComprehensionAssessment
//   → CozoDB comprehension_assessment
//   → DuckDB comprehension_assessment
//   → DuckDB domain_comprehension (per-domain FSRS state with reinforcement)
//
// KE-13.2: writeMetacognitiveSignals
//   → CozoDB metacognitive_signal (per-turn)
//   → DuckDB metacognitive_signals (per-turn)
//   → Returns aggregate metrics (density, breadth)

import type { CozoDb } from "cozo-node";
import type { ComprehensionAssessment, MetacognitiveSignal } from "../../schemas/knowledge.js";
import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";

import { computeStabilityUpdate, MAX_STABILITY } from "./decay-engine.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const INITIAL_STABILITY = 1.0;
const TOTAL_METACOGNITIVE_SIGNAL_TYPES = 7;

// ─── CozoDB String Escaping ─────────────────────────────────────────────────

function escCozo(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// ─── KE-13.1: Comprehension Writer ──────────────────────────────────────────

/**
 * Write a comprehension assessment to CozoDB and DuckDB.
 *
 * Three destinations:
 *   1. CozoDB `comprehension_assessment` — for graph-based intelligence queries
 *   2. DuckDB `comprehension_assessment` — for time-series analytics
 *   3. DuckDB `domain_comprehension` — per-domain FSRS state with reinforcement
 */
export async function writeComprehensionAssessment(
  assessment: ComprehensionAssessment,
  projectId: string,
  cozo: CozoDb,
  analytics: DbLike,
): Promise<void> {
  await writeToCozoDBComprehension(assessment, cozo);
  await writeToDuckDBComprehension(assessment, projectId, analytics);
  await updateDomainComprehension(assessment, projectId, analytics);
}

async function writeToCozoDBComprehension(
  a: ComprehensionAssessment,
  cozo: CozoDb,
): Promise<void> {
  try {
    const eid = escCozo(a.episodeId);
    const ts = escCozo(a.timestamp);
    const method = escCozo(a.assessmentMethod);

    await cozo.run(
      `?[episode_id, timestamp, steering, understanding, metacognition, independence, engagement, overall_score, rubber_stamp_count, pushback_count, assessment_method] <- [
        ['${eid}', '${ts}', ${a.dimensions.steering}, ${a.dimensions.understanding}, ${a.dimensions.metacognition}, ${a.dimensions.independence}, ${a.dimensions.engagement}, ${a.overallScore}, ${a.rubberStampCount}, ${a.pushbackCount}, '${method}']
      ]
      :put comprehension_assessment {episode_id => timestamp, steering, understanding, metacognition, independence, engagement, overall_score, rubber_stamp_count, pushback_count, assessment_method}`,
    );
  } catch (err) {
    logger.warn("Failed to write comprehension to CozoDB", {
      episodeId: a.episodeId,
      error: cozoErrorMessage(err),
    });
  }
}

async function writeToDuckDBComprehension(
  a: ComprehensionAssessment,
  projectId: string,
  analytics: DbLike,
): Promise<void> {
  try {
    await analytics.exec(
      `INSERT INTO comprehension_assessment
        (episode_id, project_id, timestamp, steering, understanding, metacognition, independence, engagement, overall_score, rubber_stamp_count, pushback_count, assessment_method, domain_tags, evidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (episode_id) DO UPDATE SET
        steering = EXCLUDED.steering,
        understanding = EXCLUDED.understanding,
        metacognition = EXCLUDED.metacognition,
        independence = EXCLUDED.independence,
        engagement = EXCLUDED.engagement,
        overall_score = EXCLUDED.overall_score,
        rubber_stamp_count = EXCLUDED.rubber_stamp_count,
        pushback_count = EXCLUDED.pushback_count,
        assessment_method = EXCLUDED.assessment_method,
        domain_tags = EXCLUDED.domain_tags,
        evidence = EXCLUDED.evidence`,
      [
        a.episodeId,
        projectId,
        a.timestamp,
        a.dimensions.steering,
        a.dimensions.understanding,
        a.dimensions.metacognition,
        a.dimensions.independence,
        a.dimensions.engagement,
        a.overallScore,
        a.rubberStampCount,
        a.pushbackCount,
        a.assessmentMethod,
        JSON.stringify(a.domainTags),
        JSON.stringify(a.evidence),
      ],
    );
  } catch (err) {
    logger.warn("Failed to write comprehension to DuckDB", {
      episodeId: a.episodeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Update per-domain FSRS state in DuckDB.
 * For each domainTag in the assessment:
 *   - New domain: initialize with base_score, stability=1.0
 *   - Existing domain: reinforcement — stability *= 1.1, interaction_count++,
 *     base_score = weighted blend of old and new
 */
async function updateDomainComprehension(
  a: ComprehensionAssessment,
  projectId: string,
  analytics: DbLike,
): Promise<void> {
  const normalizedScore = a.overallScore / 10;
  const quality = deriveEngagementQuality(a);
  const now = a.timestamp;

  for (const domain of a.domainTags) {
    try {
      const existing = await analytics.exec(
        `SELECT base_score, stability, interaction_count FROM domain_comprehension
         WHERE domain = $1 AND project_id = $2`,
        [domain, projectId],
      );

      const rows = existing[0]?.values ?? [];

      if (rows.length > 0) {
        const oldScore = (rows[0][0] as number) ?? 0;
        const oldStability = (rows[0][1] as number) ?? INITIAL_STABILITY;
        const oldCount = (rows[0][2] as number) ?? 0;

        const blendWeight = 0.3;
        const blendedScore = oldScore * (1 - blendWeight) + normalizedScore * blendWeight;
        const newBaseScore = Math.min(blendedScore * (1 + 0.02 * quality), 10);
        const newStability = computeStabilityUpdate(oldStability, quality);
        const newCount = oldCount + 1;

        await analytics.exec(
          `UPDATE domain_comprehension
           SET base_score = $1, stability = $2, interaction_count = $3,
               last_touch = $4, engagement_quality = $5, current_score = $6, updated_at = $7
           WHERE domain = $8 AND project_id = $9`,
          [newBaseScore, newStability, newCount, now, quality, newBaseScore, now, domain, projectId],
        );
      } else {
        await analytics.exec(
          `INSERT INTO domain_comprehension
            (domain, project_id, base_score, stability, complexity_modifier, floor_value,
             last_touch, engagement_quality, interaction_count, current_score, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            domain, projectId, normalizedScore, INITIAL_STABILITY, 1.0, 0,
            now, quality, 1, normalizedScore, now,
          ],
        );
      }
    } catch (err) {
      logger.debug("Failed to update domain comprehension", {
        domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Derive engagement quality from comprehension dimensions.
 * 5 = high (developer demonstrated strong steering + understanding)
 * 3 = medium (default)
 * 1 = low (rubber-stamp behavior)
 */
function deriveEngagementQuality(a: ComprehensionAssessment): number {
  const steeringPlusUnderstanding = a.dimensions.steering + a.dimensions.understanding;

  if (steeringPlusUnderstanding >= 14 && a.pushbackCount > 0) return 5;
  if (steeringPlusUnderstanding >= 10) return 4;
  if (a.dimensions.steering <= 3 && a.pushbackCount === 0 && a.rubberStampCount > 2) return 1;
  if (steeringPlusUnderstanding <= 6) return 2;
  return 3;
}

// ─── KE-13.2: Metacognitive Signal Writer ───────────────────────────────────

export interface MetacognitiveAggregates {
  /** signalCount / totalUserTurns — what fraction of turns show metacognition. */
  density: number;
  /** uniqueSignalTypes / 7 — how many different types of metacognition appear. */
  breadth: number;
  /** Total number of signals detected. */
  signalCount: number;
}

/**
 * Write metacognitive signals to CozoDB and DuckDB, and compute aggregates.
 *
 * @param totalUserTurns — needed for density calculation (signals / user turns)
 * @returns Aggregate metrics for downstream intelligence analyzers
 */
export async function writeMetacognitiveSignals(
  episodeId: string,
  signals: MetacognitiveSignal[],
  projectId: string,
  totalUserTurns: number,
  cozo: CozoDb,
  analytics: DbLike,
): Promise<MetacognitiveAggregates> {
  for (const signal of signals) {
    await writeToCozoDBMetacognitive(episodeId, signal, cozo);
    await writeToDuckDBMetacognitive(episodeId, signal, projectId, analytics);
  }

  const uniqueTypes = new Set(signals.map((s) => s.signalType));
  const density = totalUserTurns > 0 ? signals.length / totalUserTurns : 0;
  const breadth = uniqueTypes.size / TOTAL_METACOGNITIVE_SIGNAL_TYPES;

  return {
    density: Math.round(density * 1000) / 1000,
    breadth: Math.round(breadth * 1000) / 1000,
    signalCount: signals.length,
  };
}

async function writeToCozoDBMetacognitive(
  episodeId: string,
  signal: MetacognitiveSignal,
  cozo: CozoDb,
): Promise<void> {
  try {
    const eid = escCozo(episodeId);
    const st = escCozo(signal.signalType);
    const quote = escCozo(signal.quote);

    await cozo.run(
      `?[episode_id, turn_index, signal_type, quote, strength] <- [
        ['${eid}', ${signal.turnIndex}, '${st}', '${quote}', ${signal.strength}]
      ]
      :put metacognitive_signal {episode_id, turn_index => signal_type, quote, strength}`,
    );
  } catch (err) {
    logger.debug("Failed to write metacognitive signal to CozoDB", {
      episodeId,
      turnIndex: signal.turnIndex,
      error: cozoErrorMessage(err),
    });
  }
}

async function writeToDuckDBMetacognitive(
  episodeId: string,
  signal: MetacognitiveSignal,
  projectId: string,
  analytics: DbLike,
): Promise<void> {
  try {
    await analytics.exec(
      `INSERT INTO metacognitive_signals
        (episode_id, project_id, turn_index, signal_type, quote, strength)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (episode_id, turn_index) DO UPDATE SET
        signal_type = EXCLUDED.signal_type,
        quote = EXCLUDED.quote,
        strength = EXCLUDED.strength`,
      [episodeId, projectId, signal.turnIndex, signal.signalType, signal.quote, signal.strength],
    );
  } catch (err) {
    logger.debug("Failed to write metacognitive signal to DuckDB", {
      episodeId,
      turnIndex: signal.turnIndex,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function cozoErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.display === "string") return obj.display;
    if (typeof obj.message === "string") return obj.message;
    return JSON.stringify(err).slice(0, 200);
  }
  return String(err);
}

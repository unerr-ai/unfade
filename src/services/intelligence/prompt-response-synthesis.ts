// FILE: src/services/intelligence/prompt-response-synthesis.ts
// Joint prompt→response analysis. Correlates prompt characteristics with
// response outcomes to build predictive models of what prompt strategies
// work best for different task types and feature areas.

import type { DbLike } from "../cache/manager.js";
import type { ChainPattern } from "./prompt-chain.js";
import type { PromptType } from "./prompt-classifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptResponseCorrelation {
  eventId: string;
  promptType: PromptType;
  featureGroup: string | null;
  structuralFeatures: string[];
  specificity: number;
  responseMetrics: {
    outcome: string | null;
    filesModified: number;
    tokensOut: number;
    turnCount: number;
    modificationAfterAccept: boolean;
    courseCorrection: boolean;
  };
  effectivenessScore: number;
}

export interface PromptStrategyProfile {
  byPromptType: Record<
    string,
    {
      bestStructure: string[];
      avgSpecificity: number;
      avgFirstAttemptSuccessRate: number;
      avgTurnsToResolution: number;
      sampleSize: number;
    }
  >;
  byFeatureGroup: Record<
    string,
    {
      dominantPromptType: PromptType;
      avgEffectiveness: number;
      bestChainPattern: ChainPattern | null;
      sampleSize: number;
    }
  >;
  globalPatterns: {
    universallyEffective: string[];
    universallyIneffective: string[];
  };
  updatedAt: string;
}

const MIN_SAMPLE_SIZE = 10;

// ---------------------------------------------------------------------------
// Correlation computation
// ---------------------------------------------------------------------------

export async function computeAndStoreCorrelations(db: DbLike, limit = 200): Promise<number> {
  try {
    const result = await db.exec(
      `SELECT
         id, prompt_type, feature_group_id,
         prompt_constraint_type, prompt_specificity_v2,
         prompt_decomposition_depth, prompt_reference_density,
         outcome, files_modified, tokens_out, turn_count,
         modification_after_accept, course_correction,
         human_direction_score, rejection_count
       FROM events
       WHERE prompt_type IS NOT NULL
         AND source IN ('ai-session', 'mcp-active')
         AND id NOT IN (SELECT event_id FROM prompt_response_correlations)
       ORDER BY ts DESC
       LIMIT $1`,
      [limit],
    );

    if (!result[0]?.values.length) return 0;

    let stored = 0;
    for (const row of result[0].values) {
      const eventId = row[0] as string;
      const promptType = (row[1] as string) ?? "discovery";
      const featureGroup = (row[2] as string) ?? null;
      const constraintType = (row[3] as string) ?? "none";
      const specificity = (row[4] as number) ?? 0;
      const decompositionDepth = (row[5] as number) ?? 1;
      const referenceDensity = (row[6] as number) ?? 0;
      const outcome = (row[7] as string) ?? null;
      const filesMod = Array.isArray(row[8]) ? (row[8] as string[]).length : 0;
      const tokensOut = (row[9] as number) ?? 0;
      const turnCount = (row[10] as number) ?? 1;
      const _modAfterAccept = (row[11] as boolean) ?? false;
      const _courseCorrection = (row[12] as boolean) ?? false;
      const hds = (row[13] as number) ?? 0;
      const rejectionCount = (row[14] as number) ?? 0;

      const features: string[] = [];
      if (constraintType !== "none") features.push(`constraint:${constraintType}`);
      if (decompositionDepth > 1) features.push(`multi-step:${decompositionDepth}`);
      if (referenceDensity > 3) features.push("high-reference-density");
      if (specificity > 0.7) features.push("high-specificity");

      const rejectionPenalty = Math.min(1, rejectionCount * 0.2);
      const specificityBonus = 1 + specificity * 0.3;
      const effectivenessScore =
        Math.round(hds * (1 - rejectionPenalty) * specificityBonus * 100) / 100;

      db.run(
        `INSERT OR REPLACE INTO prompt_response_correlations
         (event_id, prompt_type, feature_group, structural_features,
          specificity, outcome, files_modified, tokens_out,
          turn_count, effectiveness_score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [
          eventId,
          promptType,
          featureGroup,
          features.join(",") || null,
          specificity,
          outcome,
          filesMod,
          tokensOut,
          turnCount,
          effectivenessScore,
        ],
      );

      // Write back to events table
      db.run(`UPDATE events SET prompt_response_effectiveness = $1 WHERE id = $2`, [
        effectivenessScore,
        eventId,
      ]);

      stored++;
    }

    return stored;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Strategy profile materialization
// ---------------------------------------------------------------------------

export async function buildStrategyProfile(db: DbLike): Promise<PromptStrategyProfile> {
  const now = new Date().toISOString();
  const profile: PromptStrategyProfile = {
    byPromptType: {},
    byFeatureGroup: {},
    globalPatterns: { universallyEffective: [], universallyIneffective: [] },
    updatedAt: now,
  };

  try {
    const byTypeResult = await db.exec(
      `SELECT
         prompt_type,
         AVG(specificity) as avg_spec,
         AVG(CASE WHEN outcome = 'success' AND turn_count <= 1 THEN 1.0 ELSE 0.0 END) as first_attempt_rate,
         AVG(turn_count) as avg_turns,
         COUNT(*) as cnt,
         string_agg(DISTINCT structural_features, ',') as all_features
       FROM prompt_response_correlations
       GROUP BY prompt_type
       HAVING COUNT(*) >= $1`,
      [MIN_SAMPLE_SIZE],
    );

    if (byTypeResult[0]?.values) {
      for (const row of byTypeResult[0].values) {
        const pType = (row[0] as string) ?? "discovery";
        const allFeatures = ((row[5] as string) ?? "").split(",").filter(Boolean);
        profile.byPromptType[pType] = {
          bestStructure: [...new Set(allFeatures)].slice(0, 5),
          avgSpecificity: Math.round(((row[1] as number) ?? 0) * 1000) / 1000,
          avgFirstAttemptSuccessRate: Math.round(((row[2] as number) ?? 0) * 1000) / 1000,
          avgTurnsToResolution: Math.round(((row[3] as number) ?? 1) * 10) / 10,
          sampleSize: (row[4] as number) ?? 0,
        };
      }
    }

    const byFeatureResult = await db.exec(
      `SELECT
         prc.feature_group,
         MODE() WITHIN GROUP (ORDER BY prc.prompt_type) as dominant_type,
         AVG(prc.effectiveness_score) as avg_eff,
         COUNT(*) as cnt
       FROM prompt_response_correlations prc
       WHERE prc.feature_group IS NOT NULL
       GROUP BY prc.feature_group
       HAVING COUNT(*) >= $1`,
      [MIN_SAMPLE_SIZE],
    );

    if (byFeatureResult[0]?.values) {
      for (const row of byFeatureResult[0].values) {
        const fGroup = (row[0] as string) ?? "";
        profile.byFeatureGroup[fGroup] = {
          dominantPromptType: (row[1] as PromptType) ?? "discovery",
          avgEffectiveness: Math.round(((row[2] as number) ?? 0) * 1000) / 1000,
          bestChainPattern: null,
          sampleSize: (row[3] as number) ?? 0,
        };
      }
    }

    const globalResult = await db.exec(
      `SELECT
         structural_features,
         AVG(effectiveness_score) as avg_eff,
         COUNT(*) as cnt
       FROM prompt_response_correlations
       WHERE structural_features IS NOT NULL AND structural_features != ''
       GROUP BY structural_features
       HAVING COUNT(*) >= $1
       ORDER BY avg_eff DESC`,
      [MIN_SAMPLE_SIZE],
    );

    if (globalResult[0]?.values) {
      for (const row of globalResult[0].values) {
        const feature = (row[0] as string) ?? "";
        const avgEff = (row[1] as number) ?? 0;
        if (avgEff > 0.6) profile.globalPatterns.universallyEffective.push(feature);
        else if (avgEff < 0.2) profile.globalPatterns.universallyIneffective.push(feature);
      }
    }
  } catch {
    // non-fatal
  }

  return profile;
}

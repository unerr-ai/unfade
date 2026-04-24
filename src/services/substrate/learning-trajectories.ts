// FILE: src/services/substrate/learning-trajectories.ts
// Computes learning trajectories from capability entities in the graph.
// A trajectory tracks how a developer's skill in a domain evolves over time:
// data points from capability entity snapshots, trend detection, and
// cross-feature transfer detection (skill applied in new contexts).

import { logger } from "../../utils/logger.js";
import type { SubstrateEngine } from "./substrate-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LearningTrajectory {
  capabilityId: string;
  capabilityName: string;
  dataPoints: Array<{ date: string; level: number; evidence: string[] }>;
  trend: "improving" | "stable" | "declining";
  trendConfidence: number;
  currentLevel: string;
  transferredTo: string[];
}

export interface TrajectoryReport {
  trajectories: LearningTrajectory[];
  totalCapabilities: number;
  improvingCount: number;
  decliningCount: number;
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Level mapping
// ---------------------------------------------------------------------------

const LEVEL_SCORES: Record<string, number> = {
  novice: 0.25,
  developing: 0.5,
  proficient: 0.75,
  expert: 1.0,
};

const LEVEL_NAMES = ["novice", "developing", "proficient", "expert"];

function _scoreToLevel(score: number): string {
  if (score >= 0.75) return "expert";
  if (score >= 0.5) return "proficient";
  if (score >= 0.25) return "developing";
  return "novice";
}

// ---------------------------------------------------------------------------
// Trajectory computation
// ---------------------------------------------------------------------------

export async function computeTrajectories(
  engine: SubstrateEngine,
  _projectId: string,
): Promise<TrajectoryReport> {
  const trajectories: LearningTrajectory[] = [];

  try {
    const capabilityResult = await engine.query(`
      ?[id, state, confidence, created_at, last_updated] :=
        *entity{id, type: 'capability', state, confidence, created_at, last_updated, lifecycle: lc},
        lc != 'archived'
      :order last_updated
    `);

    for (const row of capabilityResult.rows) {
      const capId = row[0] as string;
      const state =
        typeof row[1] === "string" ? JSON.parse(row[1]) : (row[1] as Record<string, unknown>);
      const _confidence = row[2] as number;
      const createdAt = row[3] as number;
      const lastUpdated = row[4] as number;

      const name = (state.name as string) ?? capId;
      const levelStr = (state.level as string) ?? "novice";
      const _evidenceCount = (state.evidenceCount as number) ?? 0;

      const levelScore = LEVEL_SCORES[levelStr] ?? 0.25;

      const dataPoints = buildDataPoints(capId, state, createdAt, lastUpdated, levelScore);
      const trend = detectTrend(dataPoints);
      const transferredTo = await detectTransfers(engine, capId);

      trajectories.push({
        capabilityId: capId,
        capabilityName: name,
        dataPoints,
        trend: trend.direction,
        trendConfidence: trend.confidence,
        currentLevel: levelStr,
        transferredTo,
      });
    }
  } catch (err) {
    logger.debug("Failed to compute learning trajectories", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const improvingCount = trajectories.filter((t) => t.trend === "improving").length;
  const decliningCount = trajectories.filter((t) => t.trend === "declining").length;

  return {
    trajectories: trajectories.sort((a, b) => {
      const levelOrder = LEVEL_NAMES.indexOf(b.currentLevel) - LEVEL_NAMES.indexOf(a.currentLevel);
      if (levelOrder !== 0) return levelOrder;
      return b.dataPoints.length - a.dataPoints.length;
    }),
    totalCapabilities: trajectories.length,
    improvingCount,
    decliningCount,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Data point construction
// ---------------------------------------------------------------------------

function buildDataPoints(
  _capId: string,
  state: Record<string, unknown>,
  createdAt: number,
  lastUpdated: number,
  currentLevel: number,
): LearningTrajectory["dataPoints"] {
  const points: LearningTrajectory["dataPoints"] = [];

  const growthTrajectory = state.growthTrajectory as
    | Array<{ date: string; level: number }>
    | undefined;
  if (Array.isArray(growthTrajectory) && growthTrajectory.length > 0) {
    for (const point of growthTrajectory) {
      points.push({
        date: point.date,
        level: point.level,
        evidence: [],
      });
    }
    return points;
  }

  const createdDate = new Date(createdAt * 1000).toISOString().slice(0, 10);
  const updatedDate = new Date(lastUpdated * 1000).toISOString().slice(0, 10);

  points.push({ date: createdDate, level: 0.1, evidence: ["initial-detection"] });

  if (createdDate !== updatedDate) {
    const midTime = createdAt + (lastUpdated - createdAt) / 2;
    const midDate = new Date(midTime * 1000).toISOString().slice(0, 10);
    if (midDate !== createdDate && midDate !== updatedDate) {
      points.push({ date: midDate, level: currentLevel * 0.6, evidence: ["interpolated"] });
    }
  }

  points.push({ date: updatedDate, level: currentLevel, evidence: ["current-state"] });

  return points;
}

// ---------------------------------------------------------------------------
// Trend detection
// ---------------------------------------------------------------------------

function detectTrend(dataPoints: LearningTrajectory["dataPoints"]): {
  direction: LearningTrajectory["trend"];
  confidence: number;
} {
  if (dataPoints.length < 2) return { direction: "stable", confidence: 0.3 };

  const levels = dataPoints.map((p) => p.level);
  const n = levels.length;

  if (n === 2) {
    const delta = levels[1] - levels[0];
    if (delta > 0.1) return { direction: "improving", confidence: 0.5 };
    if (delta < -0.1) return { direction: "declining", confidence: 0.5 };
    return { direction: "stable", confidence: 0.5 };
  }

  const xMean = (n - 1) / 2;
  const yMean = levels.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (levels[i] - yMean);
    den += (i - xMean) ** 2;
  }

  const slope = den === 0 ? 0 : num / den;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = yMean + slope * (i - xMean);
    ssRes += (levels[i] - predicted) ** 2;
    ssTot += (levels[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  const confidence = Math.min(0.95, Math.max(0.3, r2));

  if (slope > 0.05) return { direction: "improving", confidence };
  if (slope < -0.05) return { direction: "declining", confidence };
  return { direction: "stable", confidence };
}

// ---------------------------------------------------------------------------
// Transfer detection
// ---------------------------------------------------------------------------

async function detectTransfers(engine: SubstrateEngine, capabilityId: string): Promise<string[]> {
  try {
    const result = await engine.query(`
      ?[feat_id, feat_name] :=
        *edge{src: '${capabilityId.replace(/'/g, "")}', dst: pat_id, type: 'learned-from'},
        *edge{src: pat_id, dst: feat_id, type: 'applies-to'},
        *entity{id: feat_id, type: 'feature', state: fs},
        feat_name = get(fs, 'name')
    `);

    return result.rows.map((row) => (row[1] as string) ?? (row[0] as string));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Semantic similarity search (uses HNSW index)
// ---------------------------------------------------------------------------

export async function findSimilarEntities(
  engine: SubstrateEngine,
  embedding: number[],
  limit = 10,
  minSimilarity = 0.5,
): Promise<Array<{ id: string; type: string; distance: number; state: Record<string, unknown> }>> {
  try {
    const embeddingStr = embedding.map((v) => v.toString()).join(", ");

    const result = await engine.query(`
      similar[id, dist] <~ KnnHnswSearch(entity:semantic_vec, q: [${embeddingStr}], k: ${limit})
      ?[id, type, dist, state] := similar[id, dist],
        dist < ${1 - minSimilarity},
        *entity{id, type, state, lifecycle: lc},
        lc != 'archived'
      :order dist
      :limit ${limit}
    `);

    return result.rows.map((row) => ({
      id: row[0] as string,
      type: row[1] as string,
      distance: row[2] as number,
      state: typeof row[3] === "string" ? JSON.parse(row[3]) : (row[3] as Record<string, unknown>),
    }));
  } catch (err) {
    logger.debug("Semantic similarity search failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Generate a lightweight structural fingerprint (not a true embedding).
 * Uses entity state keys + type as a sparse 64-dim vector.
 * Sufficient for structural similarity within the graph.
 */
export function structuralFingerprint(
  entityType: string,
  state: Record<string, unknown>,
): number[] {
  const vec = new Array(64).fill(0);

  const typeHash = simpleHash(entityType);
  vec[typeHash % 64] = 1.0;

  const keys = Object.keys(state).sort();
  for (let i = 0; i < keys.length; i++) {
    const idx = simpleHash(keys[i]) % 64;
    const val = state[keys[i]];
    if (typeof val === "number") {
      vec[idx] = Math.min(1, Math.max(-1, val / 100));
    } else if (typeof val === "string") {
      vec[(idx + 1) % 64] = Math.min(1, val.length / 200);
    } else if (typeof val === "boolean") {
      vec[(idx + 2) % 64] = val ? 0.8 : 0.2;
    } else if (Array.isArray(val)) {
      vec[(idx + 3) % 64] = Math.min(1, val.length / 10);
    }
  }

  const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < 64; i++) vec[i] /= magnitude;
  }

  return vec;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

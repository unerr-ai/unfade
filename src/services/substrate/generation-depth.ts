// FILE: src/services/substrate/generation-depth.ts
// SUB-9: Substrate Generation Depth — 8 vertical improvements that make
// the intelligence graph semantically deeper, temporally aware, and causally
// grounded. Runs as a post-propagation enrichment step.

import { logger } from "../../utils/logger.js";
import type { EntityContribution, SubstrateEngine } from "./substrate-engine.js";

// ---------------------------------------------------------------------------
// §10.1 Bayesian Confidence Fusion
// ---------------------------------------------------------------------------

interface AnalyzerReliability {
  analyzer: string;
  precision: number;
  sampleSize: number;
}

const DEFAULT_RELIABILITY: AnalyzerReliability = {
  analyzer: "default",
  precision: 0.6,
  sampleSize: 0,
};

const ANALYZER_PRECISIONS: Record<string, number> = {
  "session-materializer": 0.85,
  "feature-registry": 0.8,
  efficiency: 0.65,
  "loop-detector": 0.7,
  "comprehension-radar": 0.6,
  "decision-replay": 0.75,
  "commit-analyzer": 0.9,
  "file-churn": 0.8,
  "ai-git-linker": 0.55,
};

export function bayesianConfidence(prior: number, sources: string[]): number {
  let posterior = prior;
  for (const source of sources) {
    const precision = ANALYZER_PRECISIONS[source] ?? DEFAULT_RELIABILITY.precision;
    const falsePositiveRate = 1 - precision;
    posterior =
      (precision * posterior) / (precision * posterior + falsePositiveRate * (1 - posterior));
  }
  return Math.min(0.99, Math.max(0.05, Math.round(posterior * 1000) / 1000));
}

// ---------------------------------------------------------------------------
// §10.2 Evidence Accumulation (Time-Decayed Edge Weight)
// ---------------------------------------------------------------------------

const HALF_LIFE_DAYS = 14;
const DECAY = Math.LN2 / (HALF_LIFE_DAYS * 86400);

export interface EvidenceEntry {
  ts: number;
  delta: number;
  source: string;
}

export function evolvedWeight(evidenceLog: EvidenceEntry[], now: number): number {
  let weight = 0;
  for (const entry of evidenceLog) {
    const age = now - entry.ts;
    weight += entry.delta * Math.exp(-DECAY * Math.max(0, age));
  }
  return Math.min(1.0, Math.max(0.0, Math.round(weight * 1000) / 1000));
}

export function appendEvidence(existingEvidence: string, newEntry: EvidenceEntry): string {
  try {
    const log: EvidenceEntry[] = existingEvidence ? JSON.parse(existingEvidence) : [];
    log.push(newEntry);
    if (log.length > 50) log.splice(0, log.length - 50);
    return JSON.stringify(log);
  } catch {
    return JSON.stringify([newEntry]);
  }
}

// ---------------------------------------------------------------------------
// §10.3 Topology Analyzer (Hub/Bridge/Clique)
// ---------------------------------------------------------------------------

export interface TopologyInsight {
  hubs: Array<{ id: string; inDegree: number }>;
  bridges: Array<{ id: string; type: string; centrality: number }>;
  clusters: Array<{ community: number; members: string[] }>;
}

export async function analyzeTopology(engine: SubstrateEngine): Promise<TopologyInsight> {
  const hubs: TopologyInsight["hubs"] = [];
  const bridges: TopologyInsight["bridges"] = [];
  const clusters: TopologyInsight["clusters"] = [];

  try {
    const hubResult = await engine.query(`
      ?[feat_id, in_degree] :=
        *entity{id: feat_id, type: 'feature', lifecycle: lc},
        lc != 'archived',
        *edge{src: _, dst: feat_id},
        in_degree = count(*),
        in_degree >= 5
      :order -in_degree
      :limit 10
    `);
    for (const row of hubResult.rows) {
      hubs.push({ id: row[0] as string, inDegree: row[1] as number });
    }
  } catch {
    // non-fatal
  }

  try {
    const clusterResult = await engine.query(`
      communities[id, community] <~ CommunityDetectionLouvain(*edge[src, dst])
      ?[community, members] := communities[id, community],
        *entity{id, lifecycle: lc}, lc != 'archived',
        members = collect(id)
      :limit 20
    `);
    for (const row of clusterResult.rows) {
      const members = Array.isArray(row[1]) ? (row[1] as string[]) : [];
      if (members.length >= 3) {
        clusters.push({ community: row[0] as number, members });
      }
    }
  } catch {
    // non-fatal
  }

  return { hubs, bridges, clusters };
}

export function topologyToContributions(topology: TopologyInsight): EntityContribution[] {
  const contributions: EntityContribution[] = [];

  for (const hub of topology.hubs) {
    contributions.push({
      entityId: hub.id,
      entityType: "feature",
      projectId: "",
      analyzerName: "topology-analyzer",
      stateFragment: {
        isHub: true,
        hubInDegree: hub.inDegree,
        topologyRole: "hub",
      },
      relationships: [],
    });
  }

  for (const cluster of topology.clusters) {
    if (cluster.members.length < 3) continue;
    const clusterId = `cluster-${cluster.community}`;
    contributions.push({
      entityId: clusterId,
      entityType: "pattern",
      projectId: "",
      analyzerName: "topology-analyzer",
      stateFragment: {
        name: `Reasoning cluster #${cluster.community}`,
        memberCount: cluster.members.length,
        members: cluster.members.slice(0, 20),
        topologyRole: "clique",
      },
      relationships: cluster.members.slice(0, 10).map((memberId) => ({
        targetEntityId: memberId,
        type: "applies-to" as const,
        weight: 0.6,
        evidence: "community-detection",
      })),
    });
  }

  return contributions;
}

// ---------------------------------------------------------------------------
// §10.4 State Evolution History
// ---------------------------------------------------------------------------

export interface StateDiff {
  ts: number;
  diff: Record<string, { from: unknown; to: unknown }>;
  source: string;
}

export function mergeWithHistory(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  analyzer: string,
  now: number,
): Record<string, unknown> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "_history") continue;
    if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
      diff[key] = { from: existing[key], to: value };
    }
  }

  const merged = { ...existing, ...incoming };

  if (Object.keys(diff).length > 0) {
    const history = (Array.isArray(existing._history) ? existing._history : []) as StateDiff[];
    history.push({ ts: now, diff, source: analyzer });
    merged._history = history.slice(-20);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// §10.5 Causal Edge Inference
// ---------------------------------------------------------------------------

export async function inferCausalEdges(engine: SubstrateEngine): Promise<EntityContribution[]> {
  const contributions: EntityContribution[] = [];

  try {
    const result = await engine.query(`
      ?[pattern_id, diag_count] :=
        *entity{id: pattern_id, type: 'pattern', created_at: pat_ts, lifecycle: pat_lc},
        pat_lc != 'archived',
        *entity{id: diag_id, type: 'diagnostic', created_at: diag_ts, lifecycle: diag_lc},
        diag_lc != 'archived',
        diag_ts > pat_ts,
        diag_ts - pat_ts < 259200.0,
        *edge{src: pattern_id, dst: feat_id, type: 'applies-to'},
        *edge{src: diag_id, dst: feat_id, type: 'applies-to'},
        diag_count = count(diag_id),
        diag_count >= 3
      :limit 20
    `);

    for (const row of result.rows) {
      const patternId = row[0] as string;
      contributions.push({
        entityId: patternId,
        entityType: "pattern",
        projectId: "",
        analyzerName: "causal-inference",
        stateFragment: { hasCausalEvidence: true, causalDiagnosticCount: row[1] as number },
        relationships: [],
      });
    }
  } catch {
    // non-fatal
  }

  return contributions;
}

// ---------------------------------------------------------------------------
// §10.6 Hierarchical Entity Composition
// ---------------------------------------------------------------------------

export function inferFeatureHierarchy(
  features: Array<{ entityId: string; modulePath: string }>,
): Array<{ childId: string; parentId: string }> {
  const hierarchies: Array<{ childId: string; parentId: string }> = [];

  for (const child of features) {
    for (const parent of features) {
      if (child.entityId === parent.entityId) continue;
      if (
        child.modulePath.startsWith(`${parent.modulePath}/`) &&
        !child.modulePath.slice(parent.modulePath.length + 1).includes("/")
      ) {
        hierarchies.push({ childId: child.entityId, parentId: parent.entityId });
      }
    }
  }

  return hierarchies;
}

export function hierarchyToContributions(
  hierarchies: Array<{ childId: string; parentId: string }>,
): EntityContribution[] {
  return hierarchies.map((h) => ({
    entityId: h.childId,
    entityType: "feature" as const,
    projectId: "",
    analyzerName: "hierarchy-inference",
    stateFragment: { parentFeature: h.parentId },
    relationships: [
      {
        targetEntityId: h.parentId,
        type: "part-of" as const,
        weight: 0.9,
        evidence: "module-path-hierarchy",
      },
    ],
  }));
}

// ---------------------------------------------------------------------------
// §10.7 Decision Quality Scoring
// ---------------------------------------------------------------------------

export interface DecisionQuality {
  durability: number;
  effectiveness: number;
  revisionCount: number;
  rippleEffect: number;
  compositeScore: number;
}

export async function scoreDecisionQuality(
  engine: SubstrateEngine,
  decisionId: string,
): Promise<DecisionQuality> {
  let durability = 0.5;
  let revisionCount = 0;
  let rippleEffect = 0;

  try {
    const revResult = await engine.query(`
      ?[count] := *edge{src: _, dst: '${decisionId.replace(/'/g, "")}', type: 'revises'}, count = count(*)
    `);
    revisionCount = revResult.rows.length > 0 ? (revResult.rows[0][0] as number) : 0;

    const rippleResult = await engine.query(`
      reachable[to] := *edge{src: '${decisionId.replace(/'/g, "")}', dst: to}
      reachable[to] := reachable[mid], *edge{src: mid, dst: to}
      ?[count] := reachable[_], count = count(*)
    `);
    rippleEffect = rippleResult.rows.length > 0 ? (rippleResult.rows[0][0] as number) : 0;
  } catch {
    // non-fatal
  }

  durability = Math.max(0, 1 - revisionCount * 0.25);
  const effectiveness = Math.min(1, rippleEffect * 0.1);
  const compositeScore =
    Math.round(
      (durability * 0.4 + effectiveness * 0.3 + (1 - Math.min(1, revisionCount * 0.2)) * 0.3) *
        1000,
    ) / 1000;

  return { durability, effectiveness, revisionCount, rippleEffect, compositeScore };
}

// ---------------------------------------------------------------------------
// §10.8 Work-Unit Intelligence Enrichment
// ---------------------------------------------------------------------------

export function enrichWorkUnit(
  stateFragment: Record<string, unknown>,
  batch: {
    events: Array<{
      promptType?: string | null;
      executionPhase?: string | null;
      humanDirectionScore?: number | null;
      turnCount?: number | null;
    }>;
  },
): Record<string, unknown> {
  const enriched = { ...stateFragment };

  const promptTypes = batch.events.map((e) => e.promptType).filter(Boolean);
  if (promptTypes.length > 0) {
    const counts: Record<string, number> = {};
    for (const pt of promptTypes) counts[pt!] = (counts[pt!] ?? 0) + 1;
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    enriched.dominantPromptType = dominant?.[0] ?? null;
    enriched.promptTypeDistribution = counts;
  }

  const phases = batch.events.map((e) => e.executionPhase).filter(Boolean);
  if (phases.length > 0) {
    enriched.phaseSequence = [...new Set(phases)];
  }

  const hdsValues = batch.events
    .map((e) => e.humanDirectionScore)
    .filter((v): v is number => v != null);
  if (hdsValues.length > 0) {
    enriched.avgHds =
      Math.round((hdsValues.reduce((s, v) => s + v, 0) / hdsValues.length) * 1000) / 1000;
    enriched.hdsVariance =
      hdsValues.length >= 2
        ? Math.round(
            (hdsValues.reduce((s, v) => s + (v - (enriched.avgHds as number)) ** 2, 0) /
              hdsValues.length) *
              1000,
          ) / 1000
        : 0;
  }

  const turns = batch.events.map((e) => e.turnCount).filter((v): v is number => v != null);
  if (turns.length > 0) {
    enriched.avgTurns = Math.round((turns.reduce((s, v) => s + v, 0) / turns.length) * 10) / 10;
  }

  enriched.eventCount = batch.events.length;
  enriched.enrichedAt = new Date().toISOString();

  return enriched;
}

// ---------------------------------------------------------------------------
// Main pipeline: run all generation depth improvements
// ---------------------------------------------------------------------------

export async function runGenerationDepth(engine: SubstrateEngine): Promise<{
  topologyInsights: TopologyInsight;
  causalEdges: number;
  hierarchyEdges: number;
}> {
  let topologyInsights: TopologyInsight = { hubs: [], bridges: [], clusters: [] };
  let causalEdges = 0;
  let hierarchyEdges = 0;

  try {
    topologyInsights = await analyzeTopology(engine);
    const topoContribs = topologyToContributions(topologyInsights);
    if (topoContribs.length > 0) {
      await engine.ingest(topoContribs);
    }
  } catch (err) {
    logger.debug("Topology analysis failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const causalContribs = await inferCausalEdges(engine);
    causalEdges = causalContribs.length;
    if (causalContribs.length > 0) {
      await engine.ingest(causalContribs);
    }
  } catch (err) {
    logger.debug("Causal inference failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const features = await engine.getEntitiesByType("feature");
    const featureList = features
      .filter((f) => f.state.modulePath)
      .map((f) => ({ entityId: f.id, modulePath: f.state.modulePath as string }));
    const hierarchies = inferFeatureHierarchy(featureList);
    hierarchyEdges = hierarchies.length;
    if (hierarchies.length > 0) {
      const hierContribs = hierarchyToContributions(hierarchies);
      await engine.ingest(hierContribs);
    }
  } catch (err) {
    logger.debug("Hierarchy inference failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { topologyInsights, causalEdges, hierarchyEdges };
}

// FILE: src/services/substrate/graph-queries.ts
// Pre-built Datalog query templates for MCP and other consumers.
// SUB-6.6: All queries have :limit clauses (default 50).
// SUB-6.9: Temporal query templates for time-range filtering.
// Queries are pushed down entirely to the graph engine.

import { logger } from "../../utils/logger.js";
import type { GraphQueryResult, SubstrateEngine } from "./substrate-engine.js";

// ---------------------------------------------------------------------------
// Query templates
// ---------------------------------------------------------------------------

export const GRAPH_QUERIES = {
  sessionContext: (sessionId: string, limit = 10) => `
    ?[feature, comprehension, loop_rate, decision_count] :=
      *edge{src: 'wu-${esc(sessionId)}', dst: feat_id, type: 'targets'},
      *entity{id: feat_id, type: 'feature', state: feat_state, lifecycle: lc},
      lc != 'archived',
      feature = get(feat_state, 'name'),
      comprehension = get(feat_state, 'comprehension', 0),
      loop_rate = get(feat_state, 'loopRate', 0),
      *edge{src: dec_id, dst: feat_id, type: 'targets'},
      *entity{id: dec_id, type: 'decision'},
      decision_count = count(dec_id)
    :limit ${limit}
  `,

  featureContext: (featureId: string, limit = 50) => `
    ?[entity_type, entity_id, relationship, weight] :=
      *edge{src: entity_id, dst: '${esc(featureId)}', type: relationship, weight},
      *entity{id: entity_id, type: entity_type, lifecycle: lc},
      lc != 'archived'
    :order -weight
    :limit ${limit}
  `,

  capabilityMap: (_domain: string, limit = 50) => `
    ?[capability, level, evidence_count, trend] :=
      *entity{id: cap_id, type: 'capability', state: cap_state, lifecycle: lc},
      lc != 'archived',
      capability = get(cap_state, 'name'),
      level = get(cap_state, 'level', 'novice'),
      evidence_count = get(cap_state, 'evidenceCount', 0),
      trend = get(cap_state, 'trend', 'stable')
    :limit ${limit}
  `,

  relatedDecisions: (featureId: string, limit = 10) => `
    ?[decision_id, description, domain, hds, date] :=
      *edge{src: wu_id, dst: '${esc(featureId)}', type: 'targets'},
      *entity{id: wu_id, type: 'work-unit'},
      *edge{src: wu_id, dst: decision_id, type: 'produced-by'},
      *entity{id: decision_id, type: 'decision', state: dec_state, lifecycle: lc},
      lc != 'archived',
      description = get(dec_state, 'description', ''),
      domain = get(dec_state, 'domain', 'general'),
      hds = get(dec_state, 'hds', 0),
      date = get(dec_state, 'date', '')
    :order -date
    :limit ${limit}
  `,

  reachableFromEntity: (entityId: string, limit = 50) => `
    reachable[to] := *edge{src: '${esc(entityId)}', dst: to}
    reachable[to] := reachable[mid], *edge{src: mid, dst: to}
    ?[id, type, confidence] := reachable[id],
      *entity{id, type, confidence, lifecycle: lc},
      lc != 'archived'
    :limit ${limit}
  `,

  activePatterns: (limit = 20) => `
    ?[pattern_id, name, occurrences, severity, feature_id] :=
      *entity{id: pattern_id, type: 'pattern', state: pat_state, lifecycle: lc},
      lc != 'archived',
      name = get(pat_state, 'name', ''),
      occurrences = get(pat_state, 'occurrences', 0),
      severity = get(pat_state, 'severity', 'emerging'),
      *edge{src: pattern_id, dst: feature_id, type: 'applies-to'}
    :order -occurrences
    :limit ${limit}
  `,

  entityTimeline: (entityId: string, limit = 30) => `
    ?[related_id, related_type, edge_type, created_at] :=
      *edge{src: '${esc(entityId)}', dst: related_id, type: edge_type, created_at},
      *entity{id: related_id, type: related_type, lifecycle: lc},
      lc != 'archived'
    :order created_at
    :limit ${limit}
  `,

  influential: (limit = 20) => `
    ranked[id, rank] <~ PageRank(*edge[src, dst])
    ?[id, type, rank, name] := ranked[id, rank],
      *entity{id, type, state, lifecycle: lc},
      lc != 'archived',
      rank > 0.01,
      name = get(state, 'name', id)
    :order -rank
    :limit ${limit}
  `,

  featureClusters: () => `
    communities[id, community] <~ CommunityDetectionLouvain(*edge[src, dst])
    ?[community, member_id, member_name] := communities[id, community],
      *entity{id, type: 'feature', state: fs, lifecycle: lc},
      lc != 'archived',
      member_id = id,
      member_name = get(fs, 'name', id)
    :order community
    :limit 100
  `,

  decisionRevisions: (limit = 20) => `
    ?[newer_id, older_id, newer_desc, older_desc] :=
      *edge{src: newer_id, dst: older_id, type: 'revises'},
      *entity{id: newer_id, type: 'decision', state: newer_state},
      *entity{id: older_id, type: 'decision', state: older_state},
      newer_desc = get(newer_state, 'description', ''),
      older_desc = get(older_state, 'description', '')
    :limit ${limit}
  `,

  graphStats: () => `
    entity_counts[type, cnt] := *entity{id, type, lifecycle: lc}, lc != 'archived', cnt = count(id)
    edge_counts[type, cnt] := *edge{src, dst, type}, cnt = count(src)
    ?[kind, name, count] :=
      entity_counts[name, count], kind = 'entity'
    ?[kind, name, count] :=
      edge_counts[name, count], kind = 'edge'
    :order kind, -count
  `,

  // SUB-6.9: Temporal query templates
  temporalFeatureSnapshot: (featureId: string, beforeTimestamp: number) => `
    ?[id, type, state, confidence, last_updated] :=
      *entity{id: '${esc(featureId)}', type, state, confidence, last_updated, lifecycle: lc},
      lc != 'archived',
      last_updated <= ${beforeTimestamp}
  `,

  maturityTimeline: (limit = 30) => `
    ?[id, phase, confidence, assessed_at] :=
      *entity{id, type: 'maturity-assessment', state: s, created_at: assessed_at, lifecycle: lc},
      lc != 'archived',
      phase = get(s, 'phase', 0),
      confidence = get(s, 'confidence', 0)
    :order assessed_at
    :limit ${limit}
  `,

  decisionsInRange: (fromTimestamp: number, toTimestamp: number, limit = 50) => `
    ?[id, description, domain, date, hds] :=
      *entity{id, type: 'decision', state: s, created_at, lifecycle: lc},
      lc != 'archived',
      created_at >= ${fromTimestamp},
      created_at <= ${toTimestamp},
      description = get(s, 'description', ''),
      domain = get(s, 'domain', 'general'),
      date = get(s, 'date', ''),
      hds = get(s, 'hds', 0)
    :order -created_at
    :limit ${limit}
  `,

  entitiesInRange: (fromTimestamp: number, toTimestamp: number, entityType: string, limit = 50) => `
    ?[id, state, confidence, created_at] :=
      *entity{id, type: '${esc(entityType)}', state, confidence, created_at, lifecycle: lc},
      lc != 'archived',
      created_at >= ${fromTimestamp},
      created_at <= ${toTimestamp}
    :order -created_at
    :limit ${limit}
  `,
} as const;

// ---------------------------------------------------------------------------
// Query executor
// ---------------------------------------------------------------------------

export interface GraphContext {
  currentFeature?: { name: string; comprehension: number; loopRate: number; decisionCount: number };
  relatedDecisions?: Array<{ id: string; description: string; domain: string }>;
  activePatterns?: Array<{ name: string; occurrences: number; severity: string }>;
  capabilities?: Array<{ name: string; level: string; evidenceCount: number }>;
  maturityPhase?: number;
}

export async function getGraphContextForSession(
  engine: SubstrateEngine,
  sessionId: string,
  limit = 5,
): Promise<GraphContext | null> {
  const ctx: GraphContext = {};

  try {
    const sessionResult = await engine.query(GRAPH_QUERIES.sessionContext(sessionId, limit));
    if (sessionResult.rows.length > 0) {
      const row = sessionResult.rows[0];
      ctx.currentFeature = {
        name: (row[0] as string) ?? "unknown",
        comprehension: (row[1] as number) ?? 0,
        loopRate: (row[2] as number) ?? 0,
        decisionCount: (row[3] as number) ?? 0,
      };

      if (ctx.currentFeature.name !== "unknown") {
        const featureId = `feat-${ctx.currentFeature.name}`;
        const decisions = await engine.query(GRAPH_QUERIES.relatedDecisions(featureId, limit));
        if (decisions.rows.length > 0) {
          ctx.relatedDecisions = decisions.rows.slice(0, limit).map((r) => ({
            id: r[0] as string,
            description: (r[1] as string) ?? "",
            domain: (r[2] as string) ?? "general",
          }));
        }
      }
    }

    const patterns = await engine.query(GRAPH_QUERIES.activePatterns(limit));
    if (patterns.rows.length > 0) {
      ctx.activePatterns = patterns.rows.slice(0, limit).map((r) => ({
        name: (r[1] as string) ?? "",
        occurrences: (r[2] as number) ?? 0,
        severity: (r[3] as string) ?? "emerging",
      }));
    }

    const caps = await engine.query(GRAPH_QUERIES.capabilityMap("", limit));
    if (caps.rows.length > 0) {
      ctx.capabilities = caps.rows.slice(0, limit).map((r) => ({
        name: (r[0] as string) ?? "",
        level: (r[1] as string) ?? "novice",
        evidenceCount: (r[2] as number) ?? 0,
      }));
    }
  } catch (err) {
    logger.debug("Graph context query failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  return Object.keys(ctx).length > 0 ? ctx : null;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// FILE: src/services/substrate/query-power.ts
// SUB-10: Query Power & Compositionality — 7 vertical improvements that make
// the graph queryable at a higher level: chains, derived relations, contextual
// ranking, narrative synthesis, predictive queries, graph algorithms, and caching.

import type { GraphQueryResult, SubstrateEngine } from "./substrate-engine.js";

// ---------------------------------------------------------------------------
// §11.1 Compositional Query Chains
// ---------------------------------------------------------------------------

export interface QueryChainStep {
  query: string | ((context: Record<string, unknown>) => string);
  extract: (result: GraphQueryResult) => Record<string, unknown>;
  label: string;
}

export interface QueryChain {
  name: string;
  description: string;
  steps: QueryChainStep[];
  synthesize: (stepResults: StepResult[]) => unknown;
}

interface StepResult {
  label: string;
  result: GraphQueryResult;
  extracted: Record<string, unknown>;
}

export class QueryChainExecutor {
  constructor(private engine: SubstrateEngine) {}

  async execute(
    chain: QueryChain,
  ): Promise<{ name: string; result: unknown; steps: StepResult[] }> {
    const stepResults: StepResult[] = [];
    let context: Record<string, unknown> = {};

    for (const step of chain.steps) {
      const queryStr = typeof step.query === "function" ? step.query(context) : step.query;
      const result = await this.engine.query(queryStr);
      const extracted = step.extract(result);
      context = { ...context, ...extracted };
      stepResults.push({ label: step.label, result, extracted });
    }

    return {
      name: chain.name,
      result: chain.synthesize(stepResults),
      steps: stepResults,
    };
  }
}

export const BUILT_IN_CHAINS: QueryChain[] = [
  {
    name: "expertise-gap-diagnosis",
    description: "Where are my knowledge gaps?",
    steps: [
      {
        label: "complex-features",
        query: `?[id, name, complexity] :=
          *entity{id, type: 'feature', state: s, lifecycle: lc}, lc != 'archived',
          name = get(s, 'name', id),
          complexity = get(s, 'complexity', 'normal'),
          or(complexity = 'high', complexity = 'very-high')
          :limit 20`,
        extract: (r) => ({ complexFeatureIds: r.rows.map((row) => row[0]) }),
      },
      {
        label: "capabilities",
        query: `?[cap_id, name, level, feat_id] :=
          *entity{id: cap_id, type: 'capability', state: cs, lifecycle: cl}, cl != 'archived',
          name = get(cs, 'name', cap_id),
          level = get(cs, 'level', 'novice'),
          *edge{src: cap_id, dst: pat_id, type: 'learned-from'},
          *edge{src: pat_id, dst: feat_id, type: 'applies-to'}
          :limit 50`,
        extract: (r) => ({
          capabilities: r.rows.map((row) => ({
            capId: row[0],
            name: row[1],
            level: row[2],
            featureId: row[3],
          })),
        }),
      },
    ],
    synthesize: (steps) => {
      const complexIds = new Set((steps[0]?.extracted.complexFeatureIds as string[]) ?? []);
      const caps =
        (steps[1]?.extracted.capabilities as Array<{
          capId: string;
          name: string;
          level: string;
          featureId: string;
        }>) ?? [];
      const gaps = caps
        .filter(
          (c) => complexIds.has(c.featureId) && (c.level === "novice" || c.level === "developing"),
        )
        .map((c) => ({ feature: c.featureId, capability: c.name, level: c.level }));
      return { gaps, gapCount: gaps.length };
    },
  },
  {
    name: "session-readiness-briefing",
    description: "What should I know before starting work on a feature?",
    steps: [
      {
        label: "feature-context",
        query: (ctx) => {
          const featId = (ctx.featureId as string) ?? "";
          return `?[entity_type, entity_id, rel_type, weight] :=
            *edge{src: entity_id, dst: '${featId.replace(/'/g, "")}', type: rel_type, weight},
            *entity{id: entity_id, type: entity_type, lifecycle: lc}, lc != 'archived'
            :order -weight :limit 20`;
        },
        extract: (r) => ({ contextEntities: r.rows }),
      },
      {
        label: "recent-revisions",
        query: `?[newer_id, older_id, desc] :=
          *edge{src: newer_id, dst: older_id, type: 'revises'},
          *entity{id: newer_id, type: 'decision', state: s},
          desc = get(s, 'description', '')
          :limit 5`,
        extract: (r) => ({
          revisions: r.rows.map((row) => ({ newer: row[0], older: row[1], desc: row[2] })),
        }),
      },
    ],
    synthesize: (steps) => {
      const context = (steps[0]?.extracted.contextEntities as unknown[][]) ?? [];
      const revisions = steps[1]?.extracted.revisions ?? [];
      return {
        connectedEntities: context.length,
        recentRevisions: (revisions as unknown[]).length,
        briefing: `${context.length} connected entities, ${(revisions as unknown[]).length} recent decision revisions.`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// §11.2 Derived Relations (Inference at Query Time)
// ---------------------------------------------------------------------------

export const DERIVED_QUERIES = {
  transitiveExpertise: () => `
    transitive_expertise[domain, evidence_path] :=
      *entity{id: cap_id, type: 'capability', state: cap_state, lifecycle: cap_lc},
      cap_lc != 'archived',
      *edge{src: cap_id, dst: pat_id, type: 'learned-from'},
      *edge{src: pat_id, dst: feat_id, type: 'applies-to'},
      *entity{id: feat_id, type: 'feature', state: feat_state},
      domain = get(feat_state, 'name', get(feat_state, 'modulePath', '')),
      evidence_path = concat(cap_id, ' -> ', pat_id, ' -> ', feat_id)
    ?[domain, expertise_count] :=
      transitive_expertise[domain, _],
      expertise_count = count(*)
    :order -expertise_count
    :limit 20
  `,

  knowledgeFrontier: () => `
    ?[feat_name, comprehension, cap_level] :=
      *entity{id: feat_id, type: 'feature', state: fs, lifecycle: fl},
      fl != 'archived',
      feat_name = get(fs, 'name', feat_id),
      comprehension = get(fs, 'comprehension', 0),
      comprehension > 0.3,
      *edge{src: cap_id, dst: pat_id, type: 'learned-from'},
      *edge{src: pat_id, dst: feat_id, type: 'applies-to'},
      *entity{id: cap_id, type: 'capability', state: cs},
      cap_level = get(cs, 'level', 'novice'),
      or(cap_level = 'novice', cap_level = 'developing')
    :order -comprehension
    :limit 15
  `,

  conflictingDecisions: () => `
    ?[feat_name, dec_a, dec_b, desc_a, desc_b] :=
      *edge{src: wu_a, dst: feat_id, type: 'targets'},
      *edge{src: wu_a, dst: dec_a, type: 'produced-by'},
      *entity{id: dec_a, type: 'decision', state: sa, created_at: ts_a},
      *edge{src: wu_b, dst: feat_id, type: 'targets'},
      *edge{src: wu_b, dst: dec_b, type: 'produced-by'},
      *entity{id: dec_b, type: 'decision', state: sb, created_at: ts_b},
      *entity{id: feat_id, type: 'feature', state: fs},
      dec_a < dec_b,
      abs(ts_a - ts_b) < 604800.0,
      desc_a = get(sa, 'description', ''),
      desc_b = get(sb, 'description', ''),
      feat_name = get(fs, 'name', feat_id)
    :limit 10
  `,
} as const;

// ---------------------------------------------------------------------------
// §11.3 Contextual Relevance Scoring
// ---------------------------------------------------------------------------

export interface SessionContext {
  currentFeatureId: string | null;
  recentDomains: string[];
  activePatternIds: string[];
  currentPhase: string;
  recentEntityIds: string[];
}

export interface ScoredEntity {
  id: string;
  type: string;
  state: Record<string, unknown>;
  relevanceScore: number;
}

export function scoreRelevance(
  entity: { id: string; type: string; state: Record<string, unknown> },
  edges: Array<{ src: string; dst: string; type: string; weight: number }>,
  ctx: SessionContext,
): number {
  let score = 0;

  if (ctx.currentFeatureId) {
    const directEdge = edges.find(
      (e) =>
        (e.src === entity.id && e.dst === ctx.currentFeatureId) ||
        (e.dst === entity.id && e.src === ctx.currentFeatureId),
    );
    if (directEdge) score += 0.4 * directEdge.weight;
  }

  const entityDomain = (entity.state.domain as string) ?? "";
  if (entityDomain && ctx.recentDomains.includes(entityDomain)) score += 0.2;

  if (ctx.recentEntityIds.includes(entity.id)) score += 0.15;

  if (ctx.currentPhase === "debugging" && entity.type === "pattern") score += 0.15;
  if (ctx.currentPhase === "implementing" && entity.type === "decision") score += 0.15;
  if (ctx.currentPhase === "exploring" && entity.type === "capability") score += 0.1;

  for (const patId of ctx.activePatternIds) {
    if (edges.some((e) => e.src === patId || e.dst === patId)) {
      score += 0.1;
      break;
    }
  }

  return Math.min(1.0, Math.round(score * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// §11.4 Narrative Query Templates
// ---------------------------------------------------------------------------

export interface NarrativeResult {
  title: string;
  summary: string;
  keyFindings: string[];
  confidence: number;
  actionItems: string[];
}

export async function featureHealthNarrative(
  engine: SubstrateEngine,
  featureId: string,
): Promise<NarrativeResult> {
  try {
    const ctx = await engine.query(`
      ?[entity_type, entity_id, rel_type] :=
        *edge{src: entity_id, dst: '${featureId.replace(/'/g, "")}', type: rel_type},
        *entity{id: entity_id, type: entity_type, lifecycle: lc}, lc != 'archived'
      :limit 50
    `);

    const patterns = ctx.rows.filter((r) => r[0] === "pattern");
    const decisions = ctx.rows.filter((r) => r[0] === "decision");
    const workUnits = ctx.rows.filter((r) => r[0] === "work-unit");
    const capabilities = ctx.rows.filter((r) => r[0] === "capability");

    const findings: string[] = [
      `${patterns.length} active patterns`,
      `${decisions.length} linked decisions`,
      `${workUnits.length} work sessions`,
      `${capabilities.length} connected capabilities`,
    ];

    const actions: string[] = [];
    if (patterns.length > 3)
      actions.push("Consider addressing recurring patterns to reduce complexity");
    if (capabilities.length === 0)
      actions.push("No capabilities linked — knowledge may be shallow");

    return {
      title: `Health Report: ${featureId}`,
      summary: `Feature has ${ctx.rows.length} connected entities across ${new Set(ctx.rows.map((r) => r[0])).size} types.`,
      keyFindings: findings,
      confidence: Math.min(0.9, 0.3 + ctx.rows.length * 0.03),
      actionItems: actions,
    };
  } catch {
    return {
      title: `Health Report: ${featureId}`,
      summary: "Insufficient data for health assessment.",
      keyFindings: [],
      confidence: 0.1,
      actionItems: ["Continue using AI tools to build intelligence"],
    };
  }
}

export async function decisionRetrospectiveNarrative(
  engine: SubstrateEngine,
  dayRange = 30,
): Promise<NarrativeResult> {
  try {
    const cutoff = Date.now() / 1000 - dayRange * 86400;
    const result = await engine.query(`
      ?[id, desc, domain, durability] :=
        *entity{id, type: 'decision', state: s, created_at, lifecycle: lc},
        lc != 'archived', created_at >= ${cutoff},
        desc = get(s, 'description', ''),
        domain = get(s, 'domain', 'general'),
        durability = get(s, 'durability', 0.5)
      :limit 50
    `);

    const total = result.rows.length;
    const avgDurability =
      total > 0
        ? Math.round((result.rows.reduce((s, r) => s + ((r[3] as number) ?? 0.5), 0) / total) * 100)
        : 0;

    const domains = new Map<string, number>();
    for (const row of result.rows) {
      const d = (row[2] as string) ?? "general";
      domains.set(d, (domains.get(d) ?? 0) + 1);
    }
    const topDomain = [...domains.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      title: `Decision Retrospective (${dayRange} days)`,
      summary: `${total} decisions made. Average durability: ${avgDurability}%.${topDomain ? ` Most active domain: ${topDomain[0]} (${topDomain[1]} decisions).` : ""}`,
      keyFindings: [
        `${total} total decisions in ${dayRange} days`,
        `Average durability: ${avgDurability}%`,
        `Domains: ${[...domains.entries()].map(([d, c]) => `${d}(${c})`).join(", ")}`,
      ],
      confidence: Math.min(0.85, 0.3 + total * 0.04),
      actionItems:
        avgDurability < 50
          ? [
              "Low durability suggests premature decisions — consider exploring alternatives before committing",
            ]
          : ["Decision durability is healthy"],
    };
  } catch {
    return {
      title: `Decision Retrospective (${dayRange} days)`,
      summary: "No decision data available.",
      keyFindings: [],
      confidence: 0.1,
      actionItems: [],
    };
  }
}

// ---------------------------------------------------------------------------
// §11.5 Predictive Queries
// ---------------------------------------------------------------------------

const LEVEL_SCORES: Record<string, number> = {
  novice: 0.25,
  developing: 0.5,
  proficient: 0.75,
  expert: 1.0,
};

export function projectCapabilityLevel(
  dataPoints: Array<{ date: string; level: number }>,
  targetLevel: string,
): { estimatedDate: string; confidence: number } | null {
  if (dataPoints.length < 3) return null;

  const levels = dataPoints.map((p) => p.level);
  const dates = dataPoints.map((p) => new Date(p.date).getTime());
  const n = levels.length;
  const xMean = dates.reduce((s, v) => s + v, 0) / n;
  const yMean = levels.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (dates[i] - xMean) * (levels[i] - yMean);
    den += (dates[i] - xMean) ** 2;
  }

  const slopePerMs = den === 0 ? 0 : num / den;
  if (slopePerMs <= 0) return null;

  const targetScore = LEVEL_SCORES[targetLevel] ?? 0.75;
  const currentScore = levels[levels.length - 1];
  if (currentScore >= targetScore) return null;

  const msToTarget = (targetScore - currentScore) / slopePerMs;
  const projectedDate = new Date(dates[dates.length - 1] + msToTarget);

  return {
    estimatedDate: projectedDate.toISOString().slice(0, 10),
    confidence: Math.round(Math.min(0.7, 0.3 + n * 0.05) * 100) / 100,
  };
}

export function predictPatternEscalation(pattern: {
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  severity: string;
}): { willEscalate: boolean; estimatedDate: string | null; confidence: number } {
  if (pattern.severity === "structural") {
    return { willEscalate: false, estimatedDate: null, confidence: 0.9 };
  }

  const daySpan =
    (new Date(pattern.lastSeen).getTime() - new Date(pattern.firstSeen).getTime()) / 86400000;
  if (daySpan < 1) return { willEscalate: false, estimatedDate: null, confidence: 0.3 };

  const rate = pattern.occurrences / daySpan;
  const STRUCTURAL_THRESHOLD = 10;
  const remaining = STRUCTURAL_THRESHOLD - pattern.occurrences;

  if (remaining <= 0 || rate <= 0) {
    return { willEscalate: false, estimatedDate: null, confidence: 0.5 };
  }

  const daysToEscalation = remaining / rate;
  const estimatedDate = new Date(Date.now() + daysToEscalation * 86400000)
    .toISOString()
    .slice(0, 10);

  return {
    willEscalate: daysToEscalation < 30,
    estimatedDate,
    confidence: Math.min(0.8, 0.3 + (pattern.occurrences / STRUCTURAL_THRESHOLD) * 0.5),
  };
}

// ---------------------------------------------------------------------------
// §11.6 Graph Algorithm Templates
// ---------------------------------------------------------------------------

export const ALGORITHM_QUERIES = {
  pageRank: (limit = 20) => `
    ranked[id, rank] <~ PageRank(*edge[src, dst])
    ?[id, type, rank, name] := ranked[id, rank],
      *entity{id, type, state, lifecycle: lc}, lc != 'archived',
      rank > 0.01, name = get(state, 'name', id)
    :order -rank :limit ${limit}
  `,

  communityDetection: () => `
    communities[id, community] <~ CommunityDetectionLouvain(*edge[src, dst])
    ?[community, member_count, members] := communities[id, community],
      *entity{id, lifecycle: lc}, lc != 'archived',
      member_count = count(id),
      members = collect(id)
    :order -member_count :limit 20
  `,

  shortestPath: (fromId: string, toId: string) => `
    path[node, cost, path] <~ ShortestPathDijkstra(*edge[src, dst, weight], '${fromId.replace(/'/g, "")}', '${toId.replace(/'/g, "")}')
    ?[node, cost, path] := path[node, cost, path]
  `,

  connectedComponents: () => `
    components[id, component] <~ ConnectedComponents(*edge[src, dst])
    ?[component, size, members] := components[id, component],
      *entity{id, lifecycle: lc}, lc != 'archived',
      size = count(id), members = collect(id)
    :order -size :limit 20
  `,
} as const;

// ---------------------------------------------------------------------------
// §11.7 Entity-Aware Query Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: GraphQueryResult;
  timestamp: number;
  entityVersion: string;
}

export class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(opts: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = opts.maxSize ?? 100;
    this.ttlMs = opts.ttlMs ?? 30_000;
  }

  get(key: string, entityVersion?: string): GraphQueryResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    if (entityVersion && entry.entityVersion !== entityVersion) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  set(key: string, result: GraphQueryResult, entityVersion = ""): void {
    if (this.cache.size >= this.maxSize) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      entityVersion,
    });
  }

  invalidate(pattern?: string): number {
    if (!pattern) {
      const size = this.cache.size;
      this.cache.clear();
      return size;
    }

    let removed = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.cache.size;
  }
}

export async function cachedQuery(
  engine: SubstrateEngine,
  cache: QueryCache,
  queryKey: string,
  queryStr: string,
  entityVersion?: string,
): Promise<GraphQueryResult> {
  const cached = cache.get(queryKey, entityVersion);
  if (cached) return cached;

  const result = await engine.query(queryStr);
  cache.set(queryKey, result, entityVersion);
  return result;
}

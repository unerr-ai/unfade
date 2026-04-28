// FILE: src/services/intelligence/causality.ts
// Higher-order causality chain builder. Constructs chains from event_links
// by detecting patterns: investigation (research → implement), debugging
// (error → fix attempts → resolution), implementation (plan → build → test),
// and decision-revision (decision → time → revision).

import type { AnalyzerContext } from "./analyzers/index.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChainType = "investigation" | "implementation" | "debugging" | "decision-revision";

export interface CausalityChain {
  id: string;
  events: string[];
  chainType: ChainType;
  startedAt: string;
  lastEventAt: string;
  outcome: "resolved" | "abandoned" | "ongoing";
  decisions: string[];
  featureId: string | null;
  turnCount: number;
}

interface CausalityState {
  chains: CausalityChain[];
  updatedAt: string;
}

type CausalityOutput = {
  chains: CausalityChain[];
  byType: Record<string, number>;
  totalChains: number;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHAINS = 200;
const _CHAIN_PROXIMITY_MS = 4 * 3600 * 1000;
const MIN_CHAIN_EVENTS = 2;

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const causalityChainAnalyzer: IncrementalAnalyzer<CausalityState, CausalityOutput> = {
  name: "causality-chains",
  outputFile: "causality-chains.json",
  eventFilter: { sources: ["ai-session", "mcp-active", "git"] },
  minDataPoints: 5,

  async initialize(ctx): Promise<IncrementalState<CausalityState>> {
    const chains = await buildChainsFromDb(ctx);
    return {
      value: { chains, updatedAt: new Date().toISOString() },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<CausalityState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const chains = await buildChainsFromDb(ctx);
    await enrichWithFactChains(chains, ctx);
    const prevCount = state.value.chains.length;

    const newState: IncrementalState<CausalityState> = {
      value: { chains, updatedAt: new Date().toISOString() },
      watermark: batch.events[batch.events.length - 1].ts,
      eventCount: state.eventCount + batch.events.length,
      updatedAt: new Date().toISOString(),
    };

    const changed = chains.length !== prevCount;

    return {
      state: newState,
      changed,
      changeMagnitude: changed ? Math.abs(chains.length - prevCount) / Math.max(prevCount, 1) : 0,
    };
  },

  derive(state): CausalityOutput {
    const byType: Record<string, number> = {};
    for (const chain of state.value.chains) {
      byType[chain.chainType] = (byType[chain.chainType] ?? 0) + 1;
    }
    return {
      chains: state.value.chains,
      byType,
      totalChains: state.value.chains.length,
      updatedAt: state.value.updatedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// KGI-8.2: Fact supersession chains from knowledge graph
// ---------------------------------------------------------------------------

async function enrichWithFactChains(chains: CausalityChain[], ctx: AnalyzerContext): Promise<void> {
  if (!ctx.knowledge) return;
  try {
    const hasData = await ctx.knowledge.hasKnowledgeData();
    if (!hasData) return;

    const allFacts = await ctx.knowledge.getFacts({ activeOnly: false });
    const invalidated = allFacts.filter((f) => f.invalidAt !== "");
    const active = allFacts.filter((f) => f.invalidAt === "");

    for (const old of invalidated) {
      const replacement = active.find(
        (a) => a.subjectId === old.subjectId && a.predicate === old.predicate && a.validAt > old.validAt,
      );
      if (!replacement) continue;

      chains.push({
        id: `fact-chain-${old.id}-${replacement.id}`,
        events: [old.id, replacement.id],
        chainType: "decision-revision",
        startedAt: old.validAt,
        lastEventAt: replacement.validAt,
        outcome: "resolved",
        decisions: [old.context.slice(0, 100), replacement.context.slice(0, 100)],
        featureId: null,
        turnCount: 2,
      });
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Chain construction from DB
// ---------------------------------------------------------------------------

async function buildChainsFromDb(ctx: AnalyzerContext): Promise<CausalityChain[]> {
  const chains: CausalityChain[] = [];

  try {
    const investigationChains = await findInvestigationChains(ctx);
    chains.push(...investigationChains);

    const debuggingChains = await findDebuggingChains(ctx);
    chains.push(...debuggingChains);

    const implementationChains = await findImplementationChains(ctx);
    chains.push(...implementationChains);

    const revisionChains = await findDecisionRevisionChains(ctx);
    chains.push(...revisionChains);
  } catch {
    // non-fatal
  }

  return chains.slice(0, MAX_CHAINS);
}

async function findInvestigationChains(ctx: AnalyzerContext): Promise<CausalityChain[]> {
  const chains: CausalityChain[] = [];

  try {
    const result = await ctx.analytics.exec(`
      SELECT session_id, MIN(ts) as start_ts, MAX(ts) as end_ts,
             COUNT(*) as event_count,
             string_agg(DISTINCT execution_phase, ',') as phases,
             string_agg(DISTINCT outcome, ',') as outcomes,
             MAX(feature_group_id) as feature_id
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND session_id IS NOT NULL
        AND ts >= now() - INTERVAL '7 days'
        AND prompt_type IN ('discovery', 'building')
      GROUP BY session_id
      HAVING COUNT(DISTINCT prompt_type) >= 2
      LIMIT 50
    `);

    if (!result[0]?.values.length) return [];

    for (const row of result[0].values) {
      const sessionId = row[0] as string;
      if (!sessionId) continue;

      const phases = ((row[4] as string) ?? "").split(",").filter(Boolean);
      if (!phases.includes("exploring") && !phases.includes("implementing")) continue;

      chains.push({
        id: `inv-${sessionId.slice(0, 8)}`,
        events: [],
        chainType: "investigation",
        startedAt: (row[1] as string) ?? "",
        lastEventAt: (row[2] as string) ?? "",
        outcome: deriveOutcome((row[5] as string) ?? ""),
        decisions: [],
        featureId: (row[6] as string) ?? null,
        turnCount: Number(row[3] ?? 0),
      });
    }
  } catch {
    // non-fatal
  }

  return chains;
}

async function findDebuggingChains(ctx: AnalyzerContext): Promise<CausalityChain[]> {
  const chains: CausalityChain[] = [];

  try {
    const result = await ctx.analytics.exec(`
      SELECT session_id, MIN(ts) as start_ts, MAX(ts) as end_ts,
             COUNT(*) as event_count,
             string_agg(DISTINCT outcome, ',') as outcomes,
             MAX(feature_group_id) as feature_id
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND session_id IS NOT NULL
        AND ts >= now() - INTERVAL '7 days'
        AND (execution_phase = 'debugging' OR prompt_type = 'debugging')
      GROUP BY session_id
      HAVING COUNT(*) >= 2
      LIMIT 50
    `);

    if (!result[0]?.values.length) return [];

    for (const row of result[0].values) {
      const sessionId = row[0] as string;
      if (!sessionId) continue;

      chains.push({
        id: `dbg-${sessionId.slice(0, 8)}`,
        events: [],
        chainType: "debugging",
        startedAt: (row[1] as string) ?? "",
        lastEventAt: (row[2] as string) ?? "",
        outcome: deriveOutcome((row[4] as string) ?? ""),
        decisions: [],
        featureId: (row[5] as string) ?? null,
        turnCount: Number(row[3] ?? 0),
      });
    }
  } catch {
    // non-fatal
  }

  return chains;
}

async function findImplementationChains(ctx: AnalyzerContext): Promise<CausalityChain[]> {
  const chains: CausalityChain[] = [];

  try {
    const result = await ctx.analytics.exec(`
      SELECT session_id, MIN(ts) as start_ts, MAX(ts) as end_ts,
             COUNT(*) as event_count,
             string_agg(DISTINCT outcome, ',') as outcomes,
             MAX(feature_group_id) as feature_id
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND session_id IS NOT NULL
        AND ts >= now() - INTERVAL '7 days'
        AND (execution_phase = 'implementing' OR prompt_type = 'building')
      GROUP BY session_id
      HAVING COUNT(*) >= 3
      LIMIT 50
    `);

    if (!result[0]?.values.length) return [];

    for (const row of result[0].values) {
      const sessionId = row[0] as string;
      if (!sessionId) continue;

      chains.push({
        id: `impl-${sessionId.slice(0, 8)}`,
        events: [],
        chainType: "implementation",
        startedAt: (row[1] as string) ?? "",
        lastEventAt: (row[2] as string) ?? "",
        outcome: deriveOutcome((row[4] as string) ?? ""),
        decisions: [],
        featureId: (row[5] as string) ?? null,
        turnCount: Number(row[3] ?? 0),
      });
    }
  } catch {
    // non-fatal
  }

  return chains;
}

async function findDecisionRevisionChains(ctx: AnalyzerContext): Promise<CausalityChain[]> {
  const chains: CausalityChain[] = [];

  try {
    const result = await ctx.analytics.exec(`
      SELECT el.from_event, el.to_event, el.link_type,
             e1.ts as from_ts, e2.ts as to_ts,
             e1.session_id as from_session, e2.session_id as to_session
      FROM event_links el
      JOIN events e1 ON el.from_event = e1.id
      JOIN events e2 ON el.to_event = e2.id
      WHERE el.link_type IN ('triggered_commit', 'continues_from')
        AND e1.ts >= now() - INTERVAL '14 days'
      ORDER BY e1.ts DESC
      LIMIT 100
    `);

    if (!result[0]?.values.length) return [];

    const sessionChains = new Map<string, string[]>();

    for (const row of result[0].values) {
      const fromSession = (row[5] as string) ?? (row[0] as string);
      const _toSession = (row[6] as string) ?? (row[1] as string);

      const key = fromSession;
      const chain = sessionChains.get(key) ?? [row[0] as string];
      if (!chain.includes(row[1] as string)) chain.push(row[1] as string);
      sessionChains.set(key, chain);
    }

    for (const [sessionId, eventIds] of sessionChains) {
      if (eventIds.length < MIN_CHAIN_EVENTS) continue;
      chains.push({
        id: `rev-${sessionId.slice(0, 8)}`,
        events: eventIds,
        chainType: "decision-revision",
        startedAt: "",
        lastEventAt: "",
        outcome: "ongoing",
        decisions: [],
        featureId: null,
        turnCount: eventIds.length,
      });
    }
  } catch {
    // non-fatal
  }

  return chains;
}

function deriveOutcome(outcomes: string): CausalityChain["outcome"] {
  if (outcomes.includes("success")) return "resolved";
  if (outcomes.includes("abandoned") || outcomes.includes("failed")) return "abandoned";
  return "ongoing";
}

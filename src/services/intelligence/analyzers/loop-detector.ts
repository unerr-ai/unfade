// KGI-5 + IP-3.4: Loop Detector — entity-repetition-without-progress detection.
//
// A real loop = same entity discussed 3+ times in a week with fewer than 1 new
// fact extracted per session. The developer keeps circling the same topic without
// the AI producing actionable knowledge — that's a stuck pattern.
//
// Primary path (knowledge-grounded):
//   1. Query entity engagement for frequently discussed entities (≥ 3 occurrences)
//   2. Count new facts per entity in the same time window
//   3. Loop risk = sessions_without_progress / total_sessions
//   4. Stuck loop = risk > 0.7
//
// Fallback: DuckDB intent-repetition detection.
//
// IP-3.4 enrichment: _meta freshness, per-loop evidenceEventIds, diagnostics.
// Removed all .slice() caps — full data flows through.

import type { AnalyzerOutputMeta, DiagnosticMessage } from "../../../schemas/intelligence-presentation.js";
import type {
  RejectionEntry,
  RejectionIndex,
  StuckLoop,
} from "../../../schemas/intelligence/rejections.js";
import { logger } from "../../../utils/logger.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { AnalyzerContext } from "./index.js";

const MIN_OCCURRENCES = 3;
const STUCK_RISK_THRESHOLD = 0.7;
const LOOKBACK_DAYS = 7;

// ─── State ──────────────────────────────────────────────────────────────────

interface LoopDetectorState {
  output: RejectionIndex;
  source: "knowledge" | "hds-fallback";
}

// ─── Evidence Helpers ───────────────────────────────────────────────────────

async function collectLoopEventIds(
  ctx: AnalyzerContext,
  domain: string,
): Promise<string[]> {
  try {
    const result = await ctx.analytics.exec(
      `SELECT id FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND ts >= now() - INTERVAL '${LOOKBACK_DAYS} days'
         AND (intent_summary LIKE '%${domain.replace(/'/g, "''")}%'
              OR content_summary LIKE '%${domain.replace(/'/g, "''")}%')
       ORDER BY ts DESC`,
    );
    return (result[0]?.values ?? []).map((r) => String(r[0]));
  } catch {
    return [];
  }
}

// ─── Primary Path: Knowledge-Grounded ───────────────────────────────────────

async function detectLoopsFromKnowledge(ctx: AnalyzerContext): Promise<RejectionIndex> {
  const now = new Date().toISOString();
  const oneWeekAgo = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();

  const entities = await ctx.knowledge!.getEntityEngagement({
    minOccurrences: MIN_OCCURRENCES,
  });

  if (entities.length === 0) {
    return emptyIndex(now);
  }

  const stuckLoops: StuckLoop[] = [];
  const entries: RejectionEntry[] = [];

  for (const entity of entities) {
    const facts = await ctx.knowledge!.getFacts({
      subject: entity.entityId,
      activeOnly: true,
    });

    const recentFacts = facts.filter((f) => f.validAt >= oneWeekAgo);
    const factsPerSession = entity.mentionCount > 0
      ? recentFacts.length / entity.mentionCount
      : 0;

    const sessionsWithoutProgress = Math.max(0, entity.mentionCount - recentFacts.length);
    const riskScore = entity.mentionCount > 0
      ? sessionsWithoutProgress / entity.mentionCount
      : 0;

    if (riskScore > STUCK_RISK_THRESHOLD && entity.mentionCount >= MIN_OCCURRENCES) {
      const domain = entity.name || entity.entityId;
      const eventIds = await collectLoopEventIds(ctx, domain);

      stuckLoops.push({
        domain,
        approach: `Discussed ${entity.mentionCount} times, only ${recentFacts.length} new facts extracted`,
        occurrences: entity.mentionCount,
        firstSeen: entity.lastSeen,
        lastSeen: entity.lastSeen,
        resolution: null,
        evidenceEventIds: eventIds,
      });

      entries.push({
        eventId: entity.entityId,
        date: entity.lastSeen,
        domain,
        contentHash: entity.entityId,
        summary: `Entity "${entity.name}" discussed ${entity.mentionCount} times with ${factsPerSession.toFixed(1)} facts/session — possible stuck loop`,
        approach: entity.type,
        resolution: null,
      });
    }
  }

  const totalDataPoints = entries.length + stuckLoops.length;
  const _meta = await buildMeta(ctx, totalDataPoints, now);
  const diagnostics = buildDiagnostics(stuckLoops, entries);

  return {
    entries,
    stuckLoops,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

// ─── Fallback Path: DuckDB Intent Repetition ────────────────────────────────

async function detectLoopsFromHDS(ctx: AnalyzerContext): Promise<RejectionIndex> {
  const now = new Date().toISOString();
  const entries: RejectionEntry[] = [];
  const stuckLoops: StuckLoop[] = [];

  try {
    const result = await ctx.analytics.exec(
      `SELECT
        intent_summary as intent,
        COUNT(*) as cnt,
        MIN(ts) as first_seen,
        MAX(ts) as last_seen,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '${LOOKBACK_DAYS} days'
        AND intent_summary IS NOT NULL
        AND intent_summary != ''
      GROUP BY intent_summary
      HAVING COUNT(*) >= ${MIN_OCCURRENCES}
      ORDER BY cnt DESC`,
    );

    const rows = result[0]?.values ?? [];

    for (const row of rows) {
      const intent = (row[0] as string) ?? "";
      const count = (row[1] as number) ?? 0;
      const firstSeen = (row[2] as string) ?? now;
      const lastSeen = (row[3] as string) ?? now;
      const failures = (row[4] as number) ?? 0;

      if (!intent) continue;

      const riskScore = count > 0 ? failures / count : 0;
      const eventIds = await collectLoopEventIds(ctx, intent);

      entries.push({
        eventId: `intent-${intent.slice(0, 20)}`,
        date: String(lastSeen),
        domain: intent,
        contentHash: intent,
        summary: `Intent "${intent}" repeated ${count} times (${failures} failures)`,
        approach: "repeated-intent",
        resolution: null,
      });

      if (riskScore > 0.5 || count >= 5) {
        stuckLoops.push({
          domain: intent,
          approach: "repeated-intent",
          occurrences: count,
          firstSeen: String(firstSeen),
          lastSeen: String(lastSeen),
          resolution: null,
          evidenceEventIds: eventIds,
        });
      }
    }
  } catch {
    // Non-fatal — table/columns may not exist yet
  }

  const totalDataPoints = entries.length + stuckLoops.length;
  const _meta = await buildMeta(ctx, totalDataPoints, now);
  const diagnostics = buildDiagnostics(stuckLoops, entries);

  return {
    entries,
    stuckLoops,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

// ─── Meta + Diagnostics ─────────────────────────────────────────────────────

async function buildMeta(
  ctx: AnalyzerContext,
  totalDataPoints: number,
  updatedAt: string,
): Promise<AnalyzerOutputMeta> {
  const confidence: "high" | "medium" | "low" =
    totalDataPoints >= 10 ? "high" : totalDataPoints >= 5 ? "medium" : "low";

  let watermark = updatedAt;
  let stalenessMs = 0;

  try {
    const result = await ctx.analytics.exec(
      "SELECT MAX(ts) FROM events WHERE source IN ('ai-session', 'mcp-active')",
    );
    const maxTs = result[0]?.values[0]?.[0] as string | null;
    if (maxTs) {
      watermark = maxTs;
      stalenessMs = Math.max(0, Date.now() - new Date(maxTs).getTime());
    }
  } catch { /* non-fatal */ }

  return { updatedAt, dataPoints: totalDataPoints, confidence, watermark, stalenessMs };
}

function buildDiagnostics(
  stuckLoops: StuckLoop[],
  entries: RejectionEntry[],
): DiagnosticMessage[] {
  const diagnostics: DiagnosticMessage[] = [];

  for (const loop of stuckLoops) {
    diagnostics.push({
      severity: loop.occurrences >= 5 ? "critical" : "warning",
      message: `Stuck loop on "${loop.domain}" — ${loop.occurrences} attempts without resolution`,
      evidence: loop.approach,
      actionable: `Try a fundamentally different approach to "${loop.domain}" — the current strategy isn't producing new insights after ${loop.occurrences} attempts`,
      relatedAnalyzers: ["efficiency", "comprehension-radar", "blind-spots"],
      evidenceEventIds: loop.evidenceEventIds,
    });
  }

  if (stuckLoops.length === 0 && entries.length > 0) {
    diagnostics.push({
      severity: "info",
      message: `${entries.length} repeated intent patterns detected, none stuck yet`,
      evidence: `Monitoring ${entries.length} repeating intents across ${LOOKBACK_DAYS}-day window`,
      actionable: "Keep an eye on frequently repeated intents — they may become stuck loops",
      relatedAnalyzers: [],
      evidenceEventIds: [],
    });
  }

  if (stuckLoops.length >= 3) {
    diagnostics.push({
      severity: "critical",
      message: `${stuckLoops.length} stuck loops active — workflow friction is high`,
      evidence: `${stuckLoops.length} distinct topics show entity repetition without progress`,
      actionable: "Consider stepping back from AI-assisted work on stuck topics — manual investigation or pair programming may break the loop",
      relatedAnalyzers: ["efficiency", "comprehension-radar"],
      evidenceEventIds: stuckLoops.flatMap((l) => l.evidenceEventIds.slice(0, 5)),
    });
  }

  return diagnostics;
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function emptyIndex(now: string): RejectionIndex {
  return {
    entries: [],
    stuckLoops: [],
    updatedAt: now,
    _meta: {
      updatedAt: now,
      dataPoints: 0,
      confidence: "low",
      watermark: now,
      stalenessMs: 0,
    },
    diagnostics: [],
  };
}

async function computeLoopsWithFallback(
  ctx: AnalyzerContext,
): Promise<{ output: RejectionIndex; source: "knowledge" | "hds-fallback" }> {
  if (ctx.knowledge) {
    try {
      const hasData = await ctx.knowledge.hasKnowledgeData();
      if (hasData) {
        const output = await detectLoopsFromKnowledge(ctx);
        return { output, source: "knowledge" };
      }
    } catch {
      // Fall through
    }
  }

  const output = await detectLoopsFromHDS(ctx);
  return { output, source: "hds-fallback" };
}

// ─── IncrementalAnalyzer Export ──────────────────────────────────────────────

export const loopDetectorAnalyzer: IncrementalAnalyzer<LoopDetectorState, RejectionIndex> = {
  name: "loop-detector",
  outputFile: "rejections.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 10,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<LoopDetectorState>> {
    const { output, source } = await computeLoopsWithFallback(ctx);
    return {
      value: { output, source },
      watermark: output.updatedAt,
      eventCount: output.entries.length,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<LoopDetectorState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<LoopDetectorState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const { output, source } = await computeLoopsWithFallback(ctx);
    const oldLoopCount = state.value.output.stuckLoops.length;
    const newLoopCount = output.stuckLoops.length;
    const changed = newLoopCount !== oldLoopCount || source !== state.value.source;

    return {
      state: {
        value: { output, source },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: Math.abs(newLoopCount - oldLoopCount),
    };
  },

  derive(state: IncrementalState<LoopDetectorState>): RejectionIndex {
    return state.value.output;
  },

  contributeEntities(state) {
    const contributions: import("../../substrate/substrate-engine.js").EntityContribution[] = [];

    for (const loop of state.value.output.stuckLoops) {
      contributions.push({
        entityId: `loop-${loop.domain.replace(/\W+/g, "-").slice(0, 40)}`,
        entityType: "hotspot",
        projectId: "",
        analyzerName: "loop-detector",
        stateFragment: {
          domain: loop.domain,
          occurrences: loop.occurrences,
          approach: loop.approach,
          source: state.value.source,
        },
        relationships: [],
      });
    }

    return contributions;
  },
};

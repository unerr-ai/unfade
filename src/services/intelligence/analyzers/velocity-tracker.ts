// UF-108 + IP-4.1: Reasoning Velocity Tracker — measures turns-to-acceptance per domain over time.
// Detects statistically significant trends using the trend utility.
//
// IP-4.1 enrichment: _meta freshness, per-domain evidenceEventIds, diagnostics.

import type { AnalyzerOutputMeta, DiagnosticMessage } from "../../../schemas/intelligence-presentation.js";
import type { DomainVelocity, Velocity } from "../../../schemas/intelligence/velocity.js";
import { logger } from "../../../utils/logger.js";
import { getWorkerPool } from "../../workers/pool.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import { detectTrend } from "../utils/trend.js";
import type { AnalyzerContext } from "./index.js";

// ─── State ──────────────────────────────────────────────────────────────────

interface VelocityState {
  output: Velocity;
}

// ─── Evidence Helpers ───────────────────────────────────────────────────────

async function collectDomainEventIds(
  db: AnalyzerContext["analytics"],
  domain: string,
): Promise<string[]> {
  try {
    const result = await db.exec(
      `SELECT id FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND turn_count IS NOT NULL
         AND (content_summary LIKE '%${domain.replace(/'/g, "''")}%'
              OR intent_summary LIKE '%${domain.replace(/'/g, "''")}%')
       ORDER BY ts DESC`,
    );
    return (result[0]?.values ?? []).map((r) => String(r[0]));
  } catch {
    return [];
  }
}

// ─── Compute Helpers ────────────────────────────────────────────────────────

async function computeDomainTurns(
  db: AnalyzerContext["analytics"],
): Promise<Map<string, number[]>> {
  try {
    const result = await db.exec(`
      SELECT
        content_summary,
        turn_count as turns,
        ts::DATE as date
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND turn_count IS NOT NULL
      ORDER BY ts
    `);

    if (!result[0]?.values.length) return new Map();

    const rows = result[0].values.map((row) => ({
      contentSummary: (row[0] as string) ?? "",
      turns: Number(row[1] ?? 0),
      date: (row[2] as string) ?? "",
    }));

    const domainWeeklyAverages = await getWorkerPool().classifyVelocityRows(rows);
    const output = new Map<string, number[]>();
    for (const [domain, averages] of Object.entries(domainWeeklyAverages)) {
      output.set(domain, averages);
    }
    return output;
  } catch {
    return new Map();
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ─── Meta + Diagnostics ─────────────────────────────────────────────────────

async function buildMeta(
  db: AnalyzerContext["analytics"],
  totalDataPoints: number,
  updatedAt: string,
): Promise<AnalyzerOutputMeta> {
  const confidence: "high" | "medium" | "low" =
    totalDataPoints >= 20 ? "high" : totalDataPoints >= 10 ? "medium" : "low";

  let watermark = updatedAt;
  let stalenessMs = 0;

  try {
    const result = await db.exec(
      "SELECT MAX(ts) FROM events WHERE source IN ('ai-session', 'mcp-active') AND turn_count IS NOT NULL",
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
  overallTrend: "accelerating" | "stable" | "decelerating",
  overallMagnitude: number,
  byDomain: Record<string, DomainVelocity>,
): DiagnosticMessage[] {
  const diagnostics: DiagnosticMessage[] = [];

  if (overallTrend === "decelerating") {
    diagnostics.push({
      severity: Math.abs(overallMagnitude) > 20 ? "critical" : "warning",
      message: `Velocity decelerating — turns-to-acceptance increasing by ${Math.abs(overallMagnitude)}%`,
      evidence: `Cross-domain trend analysis shows ${Math.abs(overallMagnitude)}% increase in turns required`,
      actionable: "Review recent sessions — increasing turn counts suggest prompts need more context or tasks are growing more complex",
      relatedAnalyzers: ["efficiency", "comprehension-radar"],
      evidenceEventIds: [],
    });
  }

  if (overallTrend === "accelerating") {
    diagnostics.push({
      severity: "info",
      message: `Velocity accelerating — turns-to-acceptance decreasing by ${Math.abs(overallMagnitude)}%`,
      evidence: `Cross-domain trend shows ${Math.abs(overallMagnitude)}% fewer turns required`,
      actionable: "Your prompting efficiency is improving — document what's working for consistency",
      relatedAnalyzers: ["prompt-patterns"],
      evidenceEventIds: [],
    });
  }

  const deceleratingDomains = Object.entries(byDomain)
    .filter(([, d]) => d.trend === "decelerating" && d.velocityChange > 15);

  for (const [domain, data] of deceleratingDomains) {
    diagnostics.push({
      severity: "warning",
      message: `"${domain}" velocity dropping — ${data.velocityChange}% more turns needed`,
      evidence: `${data.dataPoints} data points: ${data.previousTurnsToAcceptance} → ${data.currentTurnsToAcceptance} turns`,
      actionable: `Consider restructuring prompts for "${domain}" — check if domain complexity increased or context is being lost`,
      relatedAnalyzers: ["comprehension-radar", "blind-spots"],
      evidenceEventIds: data.evidenceEventIds,
    });
  }

  const hollowDomains = Object.entries(byDomain)
    .filter(([, d]) => d.velocityQuality === "hollow");

  for (const [domain, data] of hollowDomains) {
    diagnostics.push({
      severity: "warning",
      message: `"${domain}" velocity is hollow — faster turns but comprehension isn't improving`,
      evidence: `Velocity accelerating in ${domain} but knowledge extraction shows no comprehension gain`,
      actionable: `You're accepting AI output faster in "${domain}" without deeper understanding — slow down and verify`,
      relatedAnalyzers: ["comprehension-radar", "efficiency"],
      evidenceEventIds: data.evidenceEventIds,
    });
  }

  return diagnostics;
}

// ─── Full Computation ───────────────────────────────────────────────────────

async function computeVelocity(db: AnalyzerContext["analytics"]): Promise<Velocity> {
  const now = new Date().toISOString();

  const domainTurns = await computeDomainTurns(db);
  const byDomain: Record<string, DomainVelocity> = {};
  const allCurrentTurns: number[] = [];
  const allPreviousTurns: number[] = [];
  let totalDataPoints = 0;

  for (const [domain, weeks] of domainTurns) {
    if (weeks.length < 2) continue;

    const mid = Math.floor(weeks.length / 2);
    const recent = weeks.slice(mid);
    const older = weeks.slice(0, mid);

    const currentAvg = mean(recent);
    const previousAvg = mean(older);
    const change =
      previousAvg > 0 ? Math.round(((currentAvg - previousAvg) / previousAvg) * 100) : 0;

    const trendResult = detectTrend(weeks);
    const eventIds = await collectDomainEventIds(db, domain);

    byDomain[domain] = {
      currentTurnsToAcceptance: Math.round(currentAvg * 10) / 10,
      previousTurnsToAcceptance: Math.round(previousAvg * 10) / 10,
      velocityChange: change,
      dataPoints: weeks.length,
      trend: trendResult?.direction ?? "stable",
      evidenceEventIds: eventIds,
    };

    allCurrentTurns.push(currentAvg);
    allPreviousTurns.push(previousAvg);
    totalDataPoints += weeks.length;
  }

  const overallCurrent = mean(allCurrentTurns);
  const overallPrevious = mean(allPreviousTurns);
  const overallChange =
    overallPrevious > 0 ? ((overallCurrent - overallPrevious) / overallPrevious) * 100 : 0;

  let overallTrend: "accelerating" | "stable" | "decelerating" = "stable";
  if (overallChange < -10) overallTrend = "accelerating";
  else if (overallChange > 10) overallTrend = "decelerating";

  const _meta = await buildMeta(db, totalDataPoints, now);
  const diagnostics = buildDiagnostics(overallTrend, Math.round(overallChange), byDomain);

  return {
    byDomain,
    overallTrend,
    overallMagnitude: Math.round(overallChange),
    dataPoints: totalDataPoints,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

// ─── KGI-8.1: Knowledge-grounded velocity quality enrichment ────────────────

async function enrichVelocityQuality(output: Velocity, ctx: AnalyzerContext): Promise<void> {
  if (!ctx.knowledge) return;
  try {
    const hasData = await ctx.knowledge.hasKnowledgeData();
    if (!hasData) return;

    const assessments = await ctx.knowledge.getComprehension({});
    if (assessments.length < 2) return;

    const sorted = [...assessments].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const globalDelta = sorted[sorted.length - 1].overallScore - sorted[0].overallScore;

    for (const [, domainData] of Object.entries(output.byDomain)) {
      if (domainData.trend === "accelerating" || domainData.currentTurnsToAcceptance < 3) {
        domainData.velocityQuality = globalDelta > 5 ? "genuine" : globalDelta <= 0 ? "hollow" : "unknown";
      } else {
        domainData.velocityQuality = "unknown";
      }
    }
  } catch {
    // Non-fatal — velocity quality is supplementary
  }
}

// ─── IncrementalAnalyzer Export ──────────────────────────────────────────────

export const velocityTrackerAnalyzer: IncrementalAnalyzer<VelocityState, Velocity> = {
  name: "velocity-tracker",
  outputFile: "velocity.json",
  eventFilter: { sources: ["ai-session", "mcp-active"], requireFields: ["turnCount"] },
  minDataPoints: 10,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<VelocityState>> {
    logger.debug("velocity-tracker: initializing");
    const output = await computeVelocity(ctx.analytics);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: output.dataPoints,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<VelocityState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<VelocityState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const output = await computeVelocity(ctx.analytics);
    await enrichVelocityQuality(output, ctx);
    const oldMagnitude = state.value.output.overallMagnitude;
    const newMagnitude = output.overallMagnitude;
    const oldTrend = state.value.output.overallTrend;
    const newTrend = output.overallTrend;
    const changed = oldTrend !== newTrend || Math.abs(newMagnitude - oldMagnitude) > 5;

    return {
      state: {
        value: { output },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: Math.abs(newMagnitude - oldMagnitude),
    };
  },

  derive(state: IncrementalState<VelocityState>): Velocity {
    return state.value.output;
  },
};

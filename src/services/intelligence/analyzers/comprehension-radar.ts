// KGI-2 + IP-3.2: Comprehension Radar — knowledge-grounded per-module comprehension
// with blind spot detection, evidence linking, and diagnostics.
//
// Primary path (when knowledge extraction data exists):
//   1. Query CozoDB comprehension assessments via KnowledgeReader
//   2. Query DuckDB domain_comprehension for FSRS decay-adjusted scores
//   3. Per-domain score = decay-adjusted current_score from FSRS engine
//   4. Blind spots = domains where decayed score < 40 AND interaction_count >= 3
//
// Fallback path (before knowledge extraction has run):
//   DuckDB domain_comprehension HDS-based scores
//
// IP-3.2 enrichment: _meta freshness, per-module evidenceEventIds + topContributors, diagnostics.

import type { AnalyzerOutputMeta, DiagnosticMessage } from "../../../schemas/intelligence-presentation.js";
import type { ComprehensionRadar } from "../../../schemas/intelligence/comprehension.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { ComprehensionEntry } from "../knowledge-reader.js";
import type { AnalyzerContext } from "./index.js";

const BLIND_SPOT_THRESHOLD = 40;
const MIN_ENTITIES_FOR_BLIND_SPOT = 3;

// ─── State ──────────────────────────────────────────────────────────────────

interface ComprehensionRadarState {
  output: ComprehensionRadar;
  source: "knowledge" | "hds-fallback";
}

// ─── Types ──────────────────────────────────────────────────────────────────

type ModuleEntry = {
  score: number;
  decisionsCount: number;
  lastUpdated: string;
  confidence: "high" | "medium" | "low";
  evidenceEventIds: string[];
  topContributors: Array<{ eventId: string; impact: number; summary: string }>;
};

interface DomainDecayRow {
  domain: string;
  baseScore: number;
  currentScore: number;
  interactionCount: number;
  lastTouch: string;
  stability: number;
}

// ─── Event Evidence Helpers ─────────────────────────────────────────────────

async function collectDomainEventIds(
  ctx: AnalyzerContext,
  domain: string,
): Promise<string[]> {
  try {
    const result = await ctx.analytics.exec(
      `SELECT id FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND (content_summary LIKE '%${domain.replace(/'/g, "''")}%'
              OR intent_summary LIKE '%${domain.replace(/'/g, "''")}%')
       ORDER BY ts DESC`,
    );
    return (result[0]?.values ?? []).map((r) => String(r[0]));
  } catch {
    return [];
  }
}

function buildTopContributors(
  assessments: ComprehensionEntry[],
  domain: string,
): Array<{ eventId: string; impact: number; summary: string }> {
  const relevant = assessments.filter(
    (a) => a.overallScore > 0,
  );

  return relevant
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 3)
    .map((a) => ({
      eventId: a.episodeId,
      impact: Math.round(a.overallScore * 100) / 100,
      summary: `Comprehension assessment: ${a.assessmentMethod} — overall ${Math.round(a.overallScore)}/100, domain: ${domain}`,
    }));
}

// ─── Primary Path: Knowledge-Grounded ───────────────────────────────────────

async function computeRadarFromKnowledge(ctx: AnalyzerContext): Promise<ComprehensionRadar> {
  const now = new Date().toISOString();

  const domainRows = await loadDomainDecayState(ctx);

  if (domainRows.length === 0) {
    return emptyRadar(now);
  }

  const assessments = await ctx.knowledge!.getComprehension({});
  const assessmentAvg = computeAverageAssessment(assessments);

  const byModule: Record<string, ModuleEntry> = {};
  const byDomain: Record<string, number> = {};

  for (const row of domainRows) {
    const score = Math.round(Math.max(0, Math.min(100, row.currentScore * 10)));
    const domainEventIds = await collectDomainEventIds(ctx, row.domain);
    const contributors = buildTopContributors(assessments, row.domain);

    byModule[row.domain] = {
      score,
      decisionsCount: row.interactionCount,
      lastUpdated: row.lastTouch || now,
      confidence: row.interactionCount >= 10 ? "high" : row.interactionCount >= 5 ? "medium" : "low",
      evidenceEventIds: domainEventIds,
      topContributors: contributors,
    };

    byDomain[row.domain] = score;
  }

  const overall = assessmentAvg > 0
    ? Math.round(assessmentAvg)
    : computeOverall(byModule);

  const { blindSpots, alerts } = await detectBlindSpots(byModule, ctx);
  const totalDataPoints = domainRows.reduce((s, d) => s + d.interactionCount, 0);
  const _meta = await buildMeta(ctx, totalDataPoints, now);
  const diagnostics = buildDiagnostics(overall, byModule, blindSpots);

  return {
    overall,
    confidence: totalDataPoints >= 20 ? "high" : totalDataPoints >= 10 ? "medium" : "low",
    byModule,
    byDomain,
    blindSpots,
    blindSpotAlerts: alerts,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

function computeAverageAssessment(
  assessments: Array<{ overallScore: number }>,
): number {
  if (assessments.length === 0) return 0;
  const sum = assessments.reduce((s, a) => s + a.overallScore, 0);
  return sum / assessments.length;
}

// ─── Fallback Path: DuckDB HDS Averages ─────────────────────────────────────

async function computeRadarFromHDS(ctx: AnalyzerContext): Promise<ComprehensionRadar> {
  const now = new Date().toISOString();

  const domainRows = await loadDomainDecayState(ctx);

  if (domainRows.length === 0) {
    return emptyRadar(now);
  }

  const byModule: Record<string, ModuleEntry> = {};
  const byDomain: Record<string, number> = {};

  for (const row of domainRows) {
    const score = Math.round(Math.max(0, Math.min(100, row.currentScore * 10)));
    const domainEventIds = await collectDomainEventIds(ctx, row.domain);

    byModule[row.domain] = {
      score,
      decisionsCount: row.interactionCount,
      lastUpdated: row.lastTouch || now,
      confidence: row.interactionCount >= 10 ? "high" : row.interactionCount >= 5 ? "medium" : "low",
      evidenceEventIds: domainEventIds,
      topContributors: [],
    };

    byDomain[row.domain] = score;
  }

  const overall = computeOverall(byModule);
  const { blindSpots, alerts } = await detectBlindSpots(byModule, ctx);
  const totalDataPoints = domainRows.reduce((s, d) => s + d.interactionCount, 0);
  const _meta = await buildMeta(ctx, totalDataPoints, now);
  const diagnostics = buildDiagnostics(overall, byModule, blindSpots);

  return {
    overall,
    confidence: totalDataPoints >= 20 ? "high" : totalDataPoints >= 10 ? "medium" : "low",
    byModule,
    byDomain,
    blindSpots,
    blindSpotAlerts: alerts,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

async function loadDomainDecayState(ctx: AnalyzerContext): Promise<DomainDecayRow[]> {
  try {
    const result = await ctx.analytics.exec(
      `SELECT domain, base_score, current_score, interaction_count, last_touch, stability
       FROM domain_comprehension
       ORDER BY interaction_count DESC`,
    );
    const rows = result[0]?.values ?? [];
    return rows.map((r) => ({
      domain: (r[0] as string) ?? "",
      baseScore: (r[1] as number) ?? 0,
      currentScore: (r[2] as number) ?? 0,
      interactionCount: (r[3] as number) ?? 0,
      lastTouch: (r[4] as string) ?? "",
      stability: (r[5] as number) ?? 1,
    }));
  } catch {
    return [];
  }
}

function computeOverall(
  byModule: Record<string, { score: number; decisionsCount: number }>,
): number {
  const entries = Object.values(byModule);
  if (entries.length === 0) return 0;

  let totalWeighted = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    const weight = Math.max(entry.decisionsCount, 1);
    totalWeighted += entry.score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 0;
}

async function detectBlindSpots(
  byModule: Record<string, ModuleEntry>,
  ctx: AnalyzerContext,
): Promise<{
  blindSpots: string[];
  alerts: Array<{
    module: string;
    score: number;
    eventCount: number;
    suggestion: string;
    evidenceEventIds: string[];
  }>;
}> {
  const blindSpots: string[] = [];
  const alerts: Array<{
    module: string;
    score: number;
    eventCount: number;
    suggestion: string;
    evidenceEventIds: string[];
  }> = [];

  for (const [module, data] of Object.entries(byModule)) {
    if (data.score < BLIND_SPOT_THRESHOLD && data.decisionsCount >= MIN_ENTITIES_FOR_BLIND_SPOT) {
      blindSpots.push(module);

      const eventIds = data.evidenceEventIds.length > 0
        ? data.evidenceEventIds
        : await collectDomainEventIds(ctx, module);

      alerts.push({
        module,
        score: data.score,
        eventCount: data.decisionsCount,
        suggestion: `Your comprehension of "${module}" is decaying (${data.score}/100) across ${data.decisionsCount} sessions. Consider reviewing this area or engaging more deeply with the code.`,
        evidenceEventIds: eventIds,
      });
    }
  }

  return { blindSpots, alerts };
}

// ─── Meta + Diagnostics ─────────────────────────────────────────────────────

async function buildMeta(
  ctx: AnalyzerContext,
  totalDataPoints: number,
  updatedAt: string,
): Promise<AnalyzerOutputMeta> {
  const confidence: "high" | "medium" | "low" =
    totalDataPoints >= 20 ? "high" : totalDataPoints >= 10 ? "medium" : "low";

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
  overall: number,
  byModule: Record<string, ModuleEntry>,
  blindSpots: string[],
): DiagnosticMessage[] {
  const diagnostics: DiagnosticMessage[] = [];

  if (blindSpots.length > 0) {
    for (const module of blindSpots) {
      const data = byModule[module];
      if (!data) continue;

      diagnostics.push({
        severity: "warning",
        message: `"${module}" is a blind spot — ${data.decisionsCount} sessions, comprehension ${data.score}/100`,
        evidence: `FSRS decay model shows ${module} comprehension falling below ${BLIND_SPOT_THRESHOLD}/100 with ${data.decisionsCount} interactions`,
        actionable: `Engage more deeply with ${module} — review recent changes, write tests, or pair on it to rebuild comprehension`,
        relatedAnalyzers: ["efficiency", "blind-spots"],
        evidenceEventIds: data.evidenceEventIds,
      });
    }
  }

  if (overall < 40) {
    diagnostics.push({
      severity: "critical",
      message: `Overall comprehension critically low at ${overall}/100`,
      evidence: `Weighted average across ${Object.keys(byModule).length} domains`,
      actionable: "Focus on one domain at a time — deep engagement raises comprehension faster than breadth",
      relatedAnalyzers: ["efficiency", "velocity-tracker"],
      evidenceEventIds: [],
    });
  }

  const highModules = Object.entries(byModule).filter(([, d]) => d.score >= 80);
  if (highModules.length > 0 && overall >= 60) {
    diagnostics.push({
      severity: "info",
      message: `Strong comprehension in ${highModules.map(([m]) => m).join(", ")} — ${highModules.length} domain(s) above 80/100`,
      evidence: `Top modules: ${highModules.map(([m, d]) => `${m} (${d.score})`).join(", ")}`,
      actionable: "Leverage strong domains as teaching opportunities or code review areas",
      relatedAnalyzers: [],
      evidenceEventIds: highModules.flatMap(([, d]) => d.evidenceEventIds.slice(0, 3)),
    });
  }

  return diagnostics;
}

function emptyRadar(now: string): ComprehensionRadar {
  return {
    overall: 0,
    confidence: "low",
    byModule: {},
    byDomain: {},
    blindSpots: [],
    blindSpotAlerts: [],
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

// ─── IncrementalAnalyzer Export ──────────────────────────────────────────────

export const comprehensionRadarAnalyzer: IncrementalAnalyzer<
  ComprehensionRadarState,
  ComprehensionRadar
> = {
  name: "comprehension-radar",
  outputFile: "comprehension.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 5,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<ComprehensionRadarState>> {
    const { output, source } = await computeRadarWithFallback(ctx);
    return {
      value: { output, source },
      watermark: output.updatedAt,
      eventCount: 0,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<ComprehensionRadarState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<ComprehensionRadarState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const { output, source } = await computeRadarWithFallback(ctx);
    const changed =
      output.overall !== state.value.output.overall ||
      output.blindSpots.length !== state.value.output.blindSpots.length ||
      source !== state.value.source;

    return {
      state: {
        value: { output, source },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: changed
        ? Math.abs(output.overall - state.value.output.overall) / 100
        : 0,
    };
  },

  derive(state: IncrementalState<ComprehensionRadarState>): ComprehensionRadar {
    return state.value.output;
  },

  contributeEntities(state) {
    const contributions: import("../../substrate/substrate-engine.js").EntityContribution[] = [];
    const output = state.value.output;
    const byModule = output.byModule ?? {};

    for (const [modulePath, data] of Object.entries(byModule)) {
      if (!data || !modulePath) continue;
      contributions.push({
        entityId: `feat-${modulePath.replace(/\//g, "-")}`,
        entityType: "feature",
        projectId: "",
        analyzerName: "comprehension-radar",
        stateFragment: {
          comprehension: (data.score ?? 0) / 100,
          source: state.value.source,
        },
        relationships: [],
      });
    }

    return contributions;
  },
};

// ─── Route to knowledge or fallback ─────────────────────────────────────────

async function computeRadarWithFallback(
  ctx: AnalyzerContext,
): Promise<{ output: ComprehensionRadar; source: "knowledge" | "hds-fallback" }> {
  if (ctx.knowledge) {
    try {
      const hasData = await ctx.knowledge.hasKnowledgeData();
      if (hasData) {
        const output = await computeRadarFromKnowledge(ctx);
        return { output, source: "knowledge" };
      }
    } catch {
      // Fall through to HDS fallback
    }
  }

  const output = await computeRadarFromHDS(ctx);
  return { output, source: "hds-fallback" };
}

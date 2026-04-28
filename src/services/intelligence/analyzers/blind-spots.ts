// KGI-3 + IP-4.3: Blind Spot Detector — knowledge-gap detection from CozoDB + DuckDB decay state.
//
// A real blind spot = domain where:
//   1. FSRS retrievability < 0.4 (comprehension is fading)
//   2. Domain was touched within the last 30 days (still active, not abandoned)
//   3. Developer shows low pushback (accepting AI output without questioning)
//   4. At least 3 interactions exist (sufficient evidence)
//
// Severity: retrievability < 0.2 = severe, < 0.3 = moderate, < 0.4 = mild
// Rate limit: max 2 new alerts per week.
//
// Fallback: when knowledge data is unavailable, uses DuckDB domain_comprehension
// scores directly (same heuristic as before KGI-3).
//
// IP-4.3 enrichment: _meta freshness, per-alert evidenceEventIds, enhanced messages, diagnostics.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzerOutputMeta, DiagnosticMessage } from "../../../schemas/intelligence-presentation.js";
import type { AlertsFile, BlindSpotAlert } from "../../../schemas/intelligence/alerts.js";
import { getIntelligenceDir } from "../../../utils/paths.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { AnalyzerContext } from "./index.js";

const MAX_ALERTS_PER_WEEK = 2;
const MIN_INTERACTIONS = 3;
const RETRIEVABILITY_THRESHOLD = 0.4;
const ACTIVE_WINDOW_DAYS = 30;
const LOW_PUSHBACK_THRESHOLD = 1.0;

// ─── State ──────────────────────────────────────────────────────────────────

interface BlindSpotState {
  output: AlertsFile;
  source: "knowledge" | "hds-fallback";
}

// ─── Domain Decay Data ──────────────────────────────────────────────────────

interface DomainDecay {
  domain: string;
  baseScore: number;
  currentScore: number;
  interactionCount: number;
  lastTouch: string;
  stability: number;
  retrievability: number;
}

// ─── Evidence Helpers ───────────────────────────────────────────────────────

async function collectBlindSpotEventIds(
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

// ─── Primary Path: Knowledge-Grounded ───────────────────────────────────────

async function detectBlindSpotsFromKnowledge(ctx: AnalyzerContext): Promise<AlertsFile> {
  const now = new Date().toISOString();
  const existing = loadExistingAlerts();

  const domains = await loadDomainDecayRows(ctx);
  if (domains.length === 0) return emptyAlerts(now, existing);

  const avgPushback = await computeAveragePushback(ctx);

  const activeCount = countAlertsThisWeek(existing);
  const newAlerts: BlindSpotAlert[] = [];

  const cutoffDate = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400 * 1000);

  for (const domain of domains) {
    if (activeCount + newAlerts.length >= MAX_ALERTS_PER_WEEK) break;

    if (domain.retrievability >= RETRIEVABILITY_THRESHOLD) continue;
    if (domain.interactionCount < MIN_INTERACTIONS) continue;

    const lastTouchDate = new Date(domain.lastTouch);
    if (lastTouchDate < cutoffDate) continue;

    const domainPushback = avgPushback.get(domain.domain) ?? avgPushback.get("_global") ?? 2;
    if (domainPushback > LOW_PUSHBACK_THRESHOLD) continue;

    const alertId = makeAlertId("low-comprehension", domain.domain);
    if (existing.alerts.some((a) => a.id === alertId && !a.acknowledged)) continue;

    const severity = classifySeverity(domain.retrievability);
    const eventIds = await collectBlindSpotEventIds(ctx, domain.domain);

    newAlerts.push({
      id: alertId,
      type: "low-comprehension",
      severity,
      domain: domain.domain,
      message: `Your comprehension of "${domain.domain}" is fading (${Math.round(domain.retrievability * 100)}% retention) — ${domain.interactionCount} sessions, all with low engagement`,
      detail: `FSRS stability: ${domain.stability.toFixed(1)} days. Last interaction: ${formatDaysAgo(domain.lastTouch)}. Consider reviewing this area or engaging more critically with AI suggestions about "${domain.domain}".`,
      metric: Math.round(domain.currentScore * 10),
      threshold: Math.round(RETRIEVABILITY_THRESHOLD * 100),
      sustainedWeeks: 2,
      createdAt: now,
      acknowledged: false,
      acknowledgedAt: null,
      evidenceEventIds: eventIds,
    });
  }

  const allAlerts = [...existing.alerts.filter((a) => !isExpired(a)), ...newAlerts];
  const totalDataPoints = domains.reduce((s, d) => s + d.interactionCount, 0);
  const _meta = await buildMeta(ctx, totalDataPoints, now);
  const diagnostics = buildDiagnostics(allAlerts, domains);

  return {
    alerts: allAlerts,
    maxPerWeek: MAX_ALERTS_PER_WEEK,
    lastGeneratedAt: now,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

function classifySeverity(retrievability: number): "info" | "warning" | "critical" {
  if (retrievability < 0.2) return "critical";
  if (retrievability < 0.3) return "warning";
  return "info";
}

async function computeAveragePushback(ctx: AnalyzerContext): Promise<Map<string, number>> {
  const pushbackMap = new Map<string, number>();

  if (!ctx.knowledge) return pushbackMap;

  try {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    const assessments = await ctx.knowledge.getComprehension({ since: twoWeeksAgo });

    if (assessments.length === 0) return pushbackMap;

    let totalPushback = 0;
    for (const a of assessments) {
      totalPushback += a.overallScore > 0 ? (a.overallScore > 50 ? 2 : 0.5) : 0;
    }
    pushbackMap.set("_global", totalPushback / assessments.length);
  } catch {
    // Non-critical
  }

  try {
    const assessments = await ctx.knowledge.getComprehension({});
    for (const a of assessments) {
      const pushback = a.overallScore > 50 ? 2 : 0.5;
      pushbackMap.set(a.episodeId, pushback);
    }
  } catch {
    // Non-critical
  }

  return pushbackMap;
}

// ─── Fallback Path: DuckDB HDS ─────────────────────────────────────────────

async function detectBlindSpotsFromHDS(ctx: AnalyzerContext): Promise<AlertsFile> {
  const now = new Date().toISOString();
  const existing = loadExistingAlerts();

  const domains = await loadDomainDecayRows(ctx);
  if (domains.length === 0) return emptyAlerts(now, existing);

  const activeCount = countAlertsThisWeek(existing);
  const newAlerts: BlindSpotAlert[] = [];

  for (const domain of domains) {
    if (activeCount + newAlerts.length >= MAX_ALERTS_PER_WEEK) break;

    if (domain.currentScore >= 4.0) continue;
    if (domain.interactionCount < MIN_INTERACTIONS) continue;

    const alertId = makeAlertId("low-comprehension", domain.domain);
    if (existing.alerts.some((a) => a.id === alertId && !a.acknowledged)) continue;

    const eventIds = await collectBlindSpotEventIds(ctx, domain.domain);

    newAlerts.push({
      id: alertId,
      type: "low-comprehension",
      severity: domain.currentScore < 2.0 ? "warning" : "info",
      domain: domain.domain,
      message: `Comprehension in "${domain.domain}" is low (${Math.round(domain.currentScore * 10)}/100) — ${domain.interactionCount} sessions with low engagement depth`,
      detail: `Over ${domain.interactionCount} interactions, engagement depth is below expected levels. Consider reviewing AI output more carefully in this area.`,
      metric: Math.round(domain.currentScore * 10),
      threshold: 40,
      sustainedWeeks: 2,
      createdAt: now,
      acknowledged: false,
      acknowledgedAt: null,
      evidenceEventIds: eventIds,
    });
  }

  const allAlerts = [...existing.alerts.filter((a) => !isExpired(a)), ...newAlerts];
  const totalDataPoints = domains.reduce((s, d) => s + d.interactionCount, 0);
  const _meta = await buildMeta(ctx, totalDataPoints, now);
  const diagnostics = buildDiagnostics(allAlerts, domains);

  return {
    alerts: allAlerts,
    maxPerWeek: MAX_ALERTS_PER_WEEK,
    lastGeneratedAt: now,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

async function loadDomainDecayRows(ctx: AnalyzerContext): Promise<DomainDecay[]> {
  try {
    const result = await ctx.analytics.exec(
      `SELECT domain, base_score, current_score, interaction_count, last_touch, stability
       FROM domain_comprehension
       ORDER BY current_score ASC`,
    );
    const rows = result[0]?.values ?? [];
    return rows.map((r) => {
      const base = (r[1] as number) ?? 0;
      const current = (r[2] as number) ?? 0;
      const retrievability = base > 0 ? current / base : 0;
      return {
        domain: (r[0] as string) ?? "",
        baseScore: base,
        currentScore: current,
        interactionCount: (r[3] as number) ?? 0,
        lastTouch: (r[4] as string) ?? "",
        stability: (r[5] as number) ?? 1,
        retrievability,
      };
    });
  } catch {
    return [];
  }
}

function loadExistingAlerts(): AlertsFile {
  try {
    const dir = getIntelligenceDir();
    const path = join(dir, "alerts.json");
    if (!existsSync(path)) return emptyAlerts(new Date().toISOString());
    return JSON.parse(readFileSync(path, "utf-8")) as AlertsFile;
  } catch {
    return emptyAlerts(new Date().toISOString());
  }
}

function emptyAlerts(now: string, existing?: AlertsFile): AlertsFile {
  return {
    alerts: existing?.alerts.filter((a) => !isExpired(a)) ?? [],
    maxPerWeek: MAX_ALERTS_PER_WEEK,
    lastGeneratedAt: now,
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

function countAlertsThisWeek(file: AlertsFile): number {
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  return file.alerts.filter((a) => a.createdAt >= weekAgo && !a.acknowledged).length;
}

function isExpired(alert: BlindSpotAlert): boolean {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  return alert.acknowledged && (alert.acknowledgedAt ?? alert.createdAt) < thirtyDaysAgo;
}

function makeAlertId(type: string, domain: string): string {
  const weekKey = getWeekKey();
  return createHash("sha256").update(`${type}:${domain}:${weekKey}`).digest("hex").slice(0, 12);
}

function getWeekKey(): string {
  const d = new Date();
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function formatDaysAgo(isoDate: string): string {
  const days = Math.round((Date.now() - new Date(isoDate).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
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
  alerts: BlindSpotAlert[],
  domains: DomainDecay[],
): DiagnosticMessage[] {
  const diagnostics: DiagnosticMessage[] = [];

  const criticalAlerts = alerts.filter((a) => a.severity === "critical" && !a.acknowledged);
  if (criticalAlerts.length > 0) {
    diagnostics.push({
      severity: "critical",
      message: `${criticalAlerts.length} critical blind spot(s): ${criticalAlerts.map((a) => a.domain).join(", ")}`,
      evidence: `Domains with FSRS retrievability below 20% while still actively worked on`,
      actionable: "Prioritize deep review of these domains — comprehension is critically low despite ongoing work",
      relatedAnalyzers: ["comprehension-radar", "efficiency", "loop-detector"],
      evidenceEventIds: criticalAlerts.flatMap((a) => a.evidenceEventIds.slice(0, 3)),
    });
  }

  const warningAlerts = alerts.filter((a) => a.severity === "warning" && !a.acknowledged);
  if (warningAlerts.length > 0) {
    diagnostics.push({
      severity: "warning",
      message: `${warningAlerts.length} blind spot warning(s): ${warningAlerts.map((a) => a.domain).join(", ")}`,
      evidence: `Domains with comprehension below threshold while still active`,
      actionable: "Consider engaging more deeply with AI suggestions in these areas — verify instead of accepting",
      relatedAnalyzers: ["comprehension-radar"],
      evidenceEventIds: warningAlerts.flatMap((a) => a.evidenceEventIds.slice(0, 3)),
    });
  }

  if (alerts.length === 0 && domains.length > 0) {
    diagnostics.push({
      severity: "info",
      message: "No blind spots detected — comprehension is healthy across all active domains",
      evidence: `${domains.length} domains analyzed, all above threshold`,
      actionable: "Maintain current engagement patterns",
      relatedAnalyzers: [],
      evidenceEventIds: [],
    });
  }

  return diagnostics;
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function computeAlertsWithFallback(
  ctx: AnalyzerContext,
): Promise<{ output: AlertsFile; source: "knowledge" | "hds-fallback" }> {
  if (ctx.knowledge) {
    try {
      const hasData = await ctx.knowledge.hasKnowledgeData();
      if (hasData) {
        const output = await detectBlindSpotsFromKnowledge(ctx);
        return { output, source: "knowledge" };
      }
    } catch {
      // Fall through
    }
  }

  const output = await detectBlindSpotsFromHDS(ctx);
  return { output, source: "hds-fallback" };
}

// ─── IncrementalAnalyzer Export ──────────────────────────────────────────────

export const blindSpotDetectorAnalyzer: IncrementalAnalyzer<BlindSpotState, AlertsFile> = {
  name: "blind-spot-detector",
  outputFile: "alerts.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 10,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<BlindSpotState>> {
    const { output, source } = await computeAlertsWithFallback(ctx);
    return {
      value: { output, source },
      watermark: output.updatedAt,
      eventCount: 0,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<BlindSpotState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<BlindSpotState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const { output, source } = await computeAlertsWithFallback(ctx);
    const oldCount = state.value.output.alerts.length;
    const newCount = output.alerts.length;
    const changed = newCount !== oldCount || source !== state.value.source;

    return {
      state: {
        value: { output, source },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: Math.abs(newCount - oldCount),
    };
  },

  derive(state: IncrementalState<BlindSpotState>): AlertsFile {
    return state.value.output;
  },
};

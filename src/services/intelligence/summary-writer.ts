// FILE: src/services/intelligence/summary-writer.ts
// Atomic summary.json writer — derives from window-aggregator and token-proxy
// states when available, falls back to DuckDB queries otherwise.
// Incremental: zero DB queries in hot path when dependencies provide state.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStateDir } from "../../utils/paths.js";
import type { DbLike } from "../cache/manager.js";
import { eventBus } from "../event-bus.js";
import { topDomain } from "./domain-classifier.js";
import { loadFirstRunReport } from "./first-run-trigger.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";
import type { WindowResult } from "./window-aggregator.js";

export interface SummaryJson {
  schemaVersion: 1;
  updatedAt: string;
  freshnessMs: number;
  directionDensity24h: number;
  eventCount24h: number;
  comprehensionScore: number | null;
  topDomain: string | null;
  toolMix: Record<string, number>;
  reasoningVelocityProxy: number | null;
  firstRunComplete: boolean;
  costPerDirectedDecision?: number | null;
  costQualityTrend?: "improving" | "stable" | "declining" | null;
  todaySpendProxy?: number;
  todayDirectedDecisions?: number;
}

interface SummaryWriterState {
  lastOutput: SummaryJson;
}

const SUMMARY_FILENAME = "summary.json";

async function computeSummaryFromDb(db: DbLike, cwd?: string): Promise<SummaryJson> {
  const comprehensionScore = await computeComprehensionAvg(db);
  const topDomainValue = await computeTopDomainFromDb(db);
  const velocityProxy = await computeVelocityProxy(db);
  const firstRunReport = loadFirstRunReport(cwd);
  const costQ = await computeCostQuality(db);

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    freshnessMs: 0,
    directionDensity24h: 0,
    eventCount24h: 0,
    comprehensionScore,
    topDomain: topDomainValue,
    toolMix: {},
    reasoningVelocityProxy: velocityProxy,
    firstRunComplete: firstRunReport?.firstRunComplete ?? false,
    costPerDirectedDecision: costQ.costPerDirectedDecision,
    costQualityTrend: costQ.trend,
    todaySpendProxy: costQ.todaySpend,
    todayDirectedDecisions: costQ.todayDirectedDecisions,
  };
}

function enrichFromWindowState(
  summary: SummaryJson,
  windowState: IncrementalState<unknown> | undefined,
): SummaryJson {
  if (!windowState) return summary;

  const windows = (windowState.value as { windows?: Record<string, WindowResult> })?.windows;
  if (!windows) return summary;

  const w24h = windows["24h"];
  if (w24h) {
    summary.directionDensity24h = w24h.directionDensity;
    summary.eventCount24h = w24h.eventCount;
    summary.toolMix = w24h.toolMix;
  }

  return summary;
}

function enrichFromTokenState(
  summary: SummaryJson,
  tokenState: IncrementalState<unknown> | undefined,
): SummaryJson {
  if (!tokenState) return summary;

  const byKey = (tokenState.value as { byKey?: Record<string, { estimatedCost: number }> })?.byKey;
  if (!byKey) return summary;

  const today = new Date().toISOString().slice(0, 10);
  let todaySpend = 0;
  for (const [key, entry] of Object.entries(byKey)) {
    if (key.startsWith(today)) todaySpend += entry.estimatedCost;
  }
  summary.todaySpendProxy = Math.round(todaySpend * 100) / 100;

  return summary;
}

export const summaryWriterAnalyzer: IncrementalAnalyzer<SummaryWriterState, SummaryJson> = {
  name: "summary-writer",
  outputFile: "summary-writer.json",
  eventFilter: { sources: ["ai-session", "mcp-active", "git"] },
  dependsOn: ["window-aggregator", "token-proxy"],
  minDataPoints: 1,

  async initialize(ctx): Promise<IncrementalState<SummaryWriterState>> {
    const summary = await computeSummaryFromDb(ctx.analytics);
    const windowState = ctx.dependencyStates?.get("window-aggregator");
    const tokenState = ctx.dependencyStates?.get("token-proxy");
    enrichFromWindowState(summary, windowState);
    enrichFromTokenState(summary, tokenState);
    writeSummaryAtomically(summary);

    return {
      value: { lastOutput: summary },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<SummaryWriterState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const summary = await computeSummaryFromDb(ctx.analytics);
    const windowState = ctx.dependencyStates?.get("window-aggregator");
    const tokenState = ctx.dependencyStates?.get("token-proxy");
    enrichFromWindowState(summary, windowState);
    enrichFromTokenState(summary, tokenState);

    const prev = state.value.lastOutput;
    const changed =
      summary.directionDensity24h !== prev.directionDensity24h ||
      summary.eventCount24h !== prev.eventCount24h ||
      summary.comprehensionScore !== prev.comprehensionScore;

    if (changed) writeSummaryAtomically(summary);

    return {
      state: {
        value: { lastOutput: summary },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
    };
  },

  derive(state): SummaryJson {
    return state.value.lastOutput;
  },
};

let _cachedSummary: SummaryJson | null = null;

// Keep in-memory cache in sync with writes (UF-474)
eventBus.onBus((event) => {
  if (event.type === "summary") _cachedSummary = event.data as SummaryJson;
});

export function readSummary(cwd?: string): SummaryJson | null {
  if (_cachedSummary && !cwd) return _cachedSummary;
  const path = join(getStateDir(cwd), SUMMARY_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const summary = JSON.parse(readFileSync(path, "utf-8")) as SummaryJson;
    if (!cwd) _cachedSummary = summary;
    return summary;
  } catch {
    return null;
  }
}

function writeSummaryAtomically(summary: SummaryJson, cwd?: string): void {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });
  const target = join(stateDir, SUMMARY_FILENAME);
  const tmp = join(stateDir, `${SUMMARY_FILENAME}.tmp.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(summary, null, 2), "utf-8");
  renameSync(tmp, target);
  eventBus.emitBus({ type: "summary", data: summary });
}

async function computeComprehensionAvg(db: DbLike): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const result = await db.exec(
      `SELECT AVG(ca.overall_score) FROM comprehension_assessment ca
       WHERE ca.timestamp >= $1::TIMESTAMP`,
      [cutoff],
    );
    const avg = result[0]?.values[0]?.[0] as number | null;
    return avg != null ? Math.round(avg) : null;
  } catch {
    return null;
  }
}

async function computeTopDomainFromDb(db: DbLike): Promise<string | null> {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const result = await db.exec(
      `SELECT content_summary, content_detail FROM events
       WHERE ts >= $1::TIMESTAMP AND source IN ('ai-session', 'mcp-active')
       ORDER BY ts DESC LIMIT 50`,
      [cutoff],
    );
    if (!result[0]?.values.length) return null;

    const counts = new Map<string, number>();
    for (const row of result[0].values) {
      const d = topDomain(`${row[0] ?? ""} ${row[1] ?? ""}`);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }

    let best: string | null = null;
    let bestCount = 0;
    for (const [domain, count] of counts) {
      if (domain !== "general" && count > bestCount) {
        best = domain;
        bestCount = count;
      }
    }
    return best;
  } catch {
    return null;
  }
}

async function computeVelocityProxy(db: DbLike): Promise<number | null> {
  try {
    const result = await db.exec("SELECT rdi FROM metric_snapshots ORDER BY date DESC LIMIT 7");
    if (!result[0]?.values || result[0].values.length < 2) return null;
    const values = result[0].values.map((r) => Number(r[0] ?? 0)).reverse();
    const first = values[0];
    const last = values[values.length - 1];
    return first === 0 ? null : Math.round(((last - first) / first) * 100);
  } catch {
    return null;
  }
}

async function computeCostQuality(db: DbLike): Promise<{
  costPerDirectedDecision: number | null;
  trend: "improving" | "stable" | "declining" | null;
  todaySpend: number;
  todayDirectedDecisions: number;
}> {
  try {
    const { computeCostPerQuality } = await import("./cost-quality.js");
    return computeCostPerQuality(db);
  } catch {
    return { costPerDirectedDecision: null, trend: null, todaySpend: 0, todayDirectedDecisions: 0 };
  }
}

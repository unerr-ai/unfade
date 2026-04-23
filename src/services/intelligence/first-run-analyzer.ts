// FILE: src/services/intelligence/first-run-analyzer.ts
// UF-205: First-run revelation analyzer.
// Reads all events from events/*.jsonl, computes heuristic insights
// without any LLM calls. Must complete in < 30s for 10K events.

import { mean } from "simple-statistics";
import type { CaptureEvent } from "../../schemas/event.js";
import { listEventDates, readEvents } from "../capture/event-store.js";
import { aggregateDomains, topDomain } from "./domain-classifier.js";

export interface DomainBreakdown {
  domain: string;
  eventCount: number;
  directionDensity: number;
}

export interface AcceptVerbatimEntry {
  domain: string;
  acceptRate: number;
  eventCount: number;
}

export interface FirstRunReport {
  generatedAt: string;
  totalInteractions: number;
  aiInteractions: number;
  gitEvents: number;
  terminalEvents: number;
  directionDensity: number;
  domains: DomainBreakdown[];
  topDomain: string;
  highestAcceptVerbatim: AcceptVerbatimEntry | null;
  toolBreakdown: Record<string, number>;
  daysAnalyzed: number;
  firstRunComplete: true;
}

interface DirectionSignals {
  human_direction_score?: number;
  confidence?: string;
  rejection_count?: number;
  prompt_specificity?: number;
  modification_after_accept?: boolean;
}

function extractDirectionScore(event: CaptureEvent): number | null {
  const meta = event.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;

  const signals = meta.direction_signals as DirectionSignals | undefined;
  if (signals?.human_direction_score !== undefined) {
    return signals.human_direction_score;
  }

  return null;
}

function extractAiTool(event: CaptureEvent): string {
  const meta = event.metadata as Record<string, unknown> | undefined;
  const tool = meta?.ai_tool as string | undefined;
  return tool ?? "unknown";
}

function isAcceptVerbatim(event: CaptureEvent): boolean {
  const score = extractDirectionScore(event);
  if (score !== null) return score < 0.2;

  const meta = event.metadata as Record<string, unknown> | undefined;
  const signals = meta?.direction_signals as DirectionSignals | undefined;
  if (!signals) return false;

  return (
    signals.rejection_count === 0 &&
    !signals.modification_after_accept &&
    (signals.prompt_specificity ?? 0) < 0.3
  );
}

/**
 * Analyze all available events and produce the FirstRunReport.
 * Pure heuristics — no LLM, no network.
 */
export function analyzeFirstRun(cwd?: string): FirstRunReport {
  const dates = listEventDates(cwd);
  const allEvents: CaptureEvent[] = [];
  for (const date of dates) {
    allEvents.push(...readEvents(date, cwd));
  }

  const aiEvents = allEvents.filter((e) => e.source === "ai-session" || e.source === "mcp-active");
  const gitEvents = allEvents.filter((e) => e.source === "git");
  const terminalEvents = allEvents.filter((e) => e.source === "terminal");

  const directionScores = aiEvents
    .map(extractDirectionScore)
    .filter((s): s is number => s !== null);

  const directionDensity = directionScores.length > 0 ? Math.round(mean(directionScores) * 100) : 0;

  const toolBreakdown: Record<string, number> = {};
  for (const e of aiEvents) {
    const tool = extractAiTool(e);
    toolBreakdown[tool] = (toolBreakdown[tool] ?? 0) + 1;
  }

  const aiTexts = aiEvents.map((e) => `${e.content.summary} ${e.content.detail ?? ""}`);
  const domainAgg = aggregateDomains(aiTexts);

  const domainDirectionMap = new Map<string, number[]>();
  for (const e of aiEvents) {
    const text = `${e.content.summary} ${e.content.detail ?? ""}`;
    const domain = topDomain(text);
    const score = extractDirectionScore(e);
    if (score !== null) {
      const arr = domainDirectionMap.get(domain) ?? [];
      arr.push(score);
      domainDirectionMap.set(domain, arr);
    }
  }

  const domains: DomainBreakdown[] = domainAgg.map((d) => {
    const scores = domainDirectionMap.get(d.domain) ?? [];
    const density = scores.length > 0 ? Math.round(mean(scores) * 100) : 0;
    return { domain: d.domain, eventCount: d.eventCount, directionDensity: density };
  });

  const domainAcceptMap = new Map<string, { total: number; accepted: number }>();
  for (const e of aiEvents) {
    const text = `${e.content.summary} ${e.content.detail ?? ""}`;
    const domain = topDomain(text);
    const entry = domainAcceptMap.get(domain) ?? { total: 0, accepted: 0 };
    entry.total++;
    if (isAcceptVerbatim(e)) entry.accepted++;
    domainAcceptMap.set(domain, entry);
  }

  let highestAcceptVerbatim: AcceptVerbatimEntry | null = null;
  let maxAcceptRate = 0;
  for (const [domain, counts] of domainAcceptMap) {
    if (counts.total < 3) continue;
    const rate = counts.accepted / counts.total;
    if (rate > maxAcceptRate) {
      maxAcceptRate = rate;
      highestAcceptVerbatim = {
        domain,
        acceptRate: Math.round(rate * 100),
        eventCount: counts.total,
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalInteractions: allEvents.length,
    aiInteractions: aiEvents.length,
    gitEvents: gitEvents.length,
    terminalEvents: terminalEvents.length,
    directionDensity,
    domains,
    topDomain: domains.length > 0 ? domains[0].domain : "general",
    highestAcceptVerbatim,
    toolBreakdown,
    daysAnalyzed: dates.length,
    firstRunComplete: true,
  };
}

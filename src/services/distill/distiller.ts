// FILE: src/services/distill/distiller.ts
// UF-035: Distiller orchestrator.
// Pipeline: read events → extractSignals → linkContext → synthesize →
//           write distill → update graph → update profile → notify.
// Idempotent — re-running for the same date overwrites the distill file.
// Backfill mode: loop over N past days, throttled 1 per 10 seconds.
// Skip days with zero events — don't generate empty distills.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config/manager.js";
import type { UnfadeConfig } from "../../schemas/config.js";
import type { DailyDistill, EnrichedDistill } from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { localDateStr } from "../../utils/date.js";
import { logger } from "../../utils/logger.js";
import { getDistillsDir, getGraphDir, getProfileDir } from "../../utils/paths.js";
import { countEvents, readEvents } from "../capture/event-store.js";
import { writeMetricSnapshot } from "../intelligence/snapshot.js";
import { notify } from "../notification/notifier.js";
import { detectBlindSpots } from "../personalization/feedback.js";
import { surfaceablePatterns } from "../personalization/pattern-detector.js";
import { updateProfileV2 } from "../personalization/profile-builder.js";
import { linkContext } from "./context-linker.js";
import { digestConversations } from "./conversation-digester.js";
import { generateDecisionRecords } from "./decision-records.js";
import { buildNarrativeSpine } from "./narrative-builder.js";
import {
  buildEnrichedDistill,
  findEvidenceEventIds,
  formatDistillMarkdown,
  linkContinuityThreads,
} from "./post-enricher.js";
import { createLLMProvider, type LLMProviderResult } from "./providers/ai.js";
import { aggregateDirectionSignals, extractSignals, triageSignals } from "./signal-extractor.js";
import { fuseSignals } from "./signal-fusion.js";
import { synthesize } from "./synthesizer.js";

const BACKFILL_THROTTLE_MS = 10_000;

export interface DistillOptions {
  /** Override LLM provider for this run. */
  provider?: LLMProviderResult | null;
  /** If true, suppress notification. */
  silent?: boolean;
  /** Working directory override. */
  cwd?: string;
}

export interface DistillResult {
  date: string;
  distill: DailyDistill;
  path: string;
  skipped: boolean;
}

/**
 * Incremental distill — zero-cost, zero-LLM path.
 * Runs the full pipeline (extract → link → fallback synthesis → profile → graph → amplification)
 * using only heuristic synthesis. Populates all downstream folders (distills/, profile/, graph/,
 * amplification/) immediately when data exists, without waiting for the scheduled LLM run.
 *
 * The scheduled LLM distill overwrites this idempotently with higher-quality synthesis.
 *
 * Returns null if zero events for the date.
 */
export async function distillIncremental(
  date: string,
  options: { cwd?: string; silent?: boolean } = {},
): Promise<DistillResult | null> {
  const cwd = options.cwd;

  const eventCount = countEvents(date, cwd);
  if (eventCount === 0) {
    logger.debug("No events for date, skipping incremental distill", { date });
    return null;
  }

  // Don't overwrite an LLM-enriched distill with a fallback one.
  // The scheduled LLM run produces higher-quality output.
  const existingDistill = join(getDistillsDir(cwd), `${date}.md`);
  if (existsSync(existingDistill)) {
    const content = readFileSync(existingDistill, "utf-8");
    if (content.includes("Synthesized by:** llm")) {
      logger.debug("LLM distill already exists, skipping incremental", { date });
      return null;
    }
  }

  // Stage 0: Read events + fuse
  const rawEvents = readEvents(date, cwd);
  const events = fuseSignals(rawEvents);

  // Stage 1: Extract + triage signals
  const signals = extractSignals(events, date);
  const triaged = triageSignals(signals, events);
  const narrativeSpine = await buildNarrativeSpine(triaged, events);

  // Stage 2: Link context
  const linked = linkContext(signals, events);

  // Stage 1.5: Digest conversations (heuristic — no LLM for incremental, which must be fast).
  // The full `distill()` command uses LLM for higher-quality enrichment.
  const conversationDigests = await digestConversations(events, null);

  // Stage 3: Fallback synthesis (zero cost, instant)
  const result = await synthesize(linked, null, { cwd, conversationDigests });

  // Stage 3.5: Direction signals
  const { averageHDS, classifications, toolBreakdown } = aggregateDirectionSignals(events);
  if (classifications.length > 0) {
    const humanDirected = classifications.filter((c) => c.classification === "human-directed");
    result.directionSummary = {
      averageHDS,
      humanDirectedCount: humanDirected.length,
      collaborativeCount: classifications.filter((c) => c.classification === "collaborative")
        .length,
      llmDirectedCount: classifications.filter((c) => c.classification === "llm-directed").length,
      topHumanDirectedDecisions: humanDirected.slice(0, 3).map((c) => c.summary),
    };

    const toolEntries = Array.from(toolBreakdown.entries()).map(([tool, data]) => ({
      tool,
      sessionCount: data.sessions,
      eventCount: data.events,
    }));

    if (toolEntries.length > 0) {
      const primary = toolEntries.sort((a, b) => b.eventCount - a.eventCount)[0];
      const directionStyle =
        averageHDS >= 0.6
          ? "Architectural Thinker — high direction on design"
          : averageHDS >= 0.3
            ? "Collaborative Builder — balanced human+AI workflow"
            : "AI Accelerator — leveraging AI for execution speed";

      result.aiCollaborationSummary = {
        toolBreakdown: toolEntries,
        directionStyle: `${directionStyle} (primary tool: ${primary.tool})`,
      };
    }
  }

  // Stages 6-12: Profile, graph, write (all zero-cost)
  const v2Profile = updateProfileV2(result, signals, cwd);
  writeMetricSnapshot(date, result, v2Profile, cwd);

  appendToDecisionsGraph(result, events, cwd);
  updateDomainsGraph(result, cwd);

  // Build enriched distill JSON + post-synthesis enrichments
  const enriched = buildEnrichedDistill(result, triaged, narrativeSpine, events);
  await linkContinuityThreads(enriched, cwd);

  const distillPath = writeDistill(date, enriched, cwd);

  generateDecisionRecords(result, cwd);

  // Incremental distills are silent — no desktop notification for background updates.
  // The scheduled LLM distill sends the notification when it enriches the result.

  logger.debug("Incremental distill complete", {
    date,
    decisions: result.decisions.length,
    synthesizedBy: result.synthesizedBy ?? "fallback",
  });

  return { date, distill: result, path: distillPath, skipped: false };
}

/**
 * Distill a single date.
 * Full pipeline: events → signals → linked → synthesized → write → graph → profile → notify.
 * Returns null if zero events for the date (skips silently).
 * Idempotent: overwrites existing distill for the same date.
 */
export async function distill(
  date: string,
  config: UnfadeConfig,
  options: DistillOptions = {},
): Promise<DistillResult | null> {
  const cwd = options.cwd;

  // Check for events first — skip zero-event days
  const eventCount = countEvents(date, cwd);
  if (eventCount === 0) {
    logger.debug("No events for date, skipping distill", { date });
    return null;
  }

  // Stage 0: Read events + fuse active/passive signals
  const rawEvents = readEvents(date, cwd);
  const events = fuseSignals(rawEvents);
  logger.debug("Read events for distillation", {
    date,
    raw: rawEvents.length,
    fused: events.length,
  });

  // Stage 1: Extract signals
  const signals = extractSignals(events, date);

  // Stage 1a: Triage signals (impact scoring, tier partitioning, day shape)
  const triaged = triageSignals(signals, events);

  // Stage 1b: Build narrative spine (temporal clustering, causal chains, acts)
  const narrativeSpine = await buildNarrativeSpine(triaged, events);

  // Stage 1.5: Digest conversations (LLM when available, fallback otherwise)
  const provider =
    options.provider !== undefined ? options.provider : await createLLMProvider(config);
  const conversationDigests = await digestConversations(events, provider);

  // Stage 2: Link context
  const linked = linkContext(signals, events);

  // Stage 3: Synthesize (LLM or fallback)
  const result = await synthesize(linked, provider, {
    cwd,
    modelLimits: config.distill.modelLimits,
    conversationDigests,
  });

  // Stage 3.5: Aggregate direction signals from AI session events
  const { averageHDS, classifications, toolBreakdown } = aggregateDirectionSignals(events);
  if (classifications.length > 0) {
    const humanDirected = classifications.filter((c) => c.classification === "human-directed");
    result.directionSummary = {
      averageHDS,
      humanDirectedCount: humanDirected.length,
      collaborativeCount: classifications.filter((c) => c.classification === "collaborative")
        .length,
      llmDirectedCount: classifications.filter((c) => c.classification === "llm-directed").length,
      topHumanDirectedDecisions: humanDirected.slice(0, 3).map((c) => c.summary),
    };

    const toolEntries = Array.from(toolBreakdown.entries()).map(([tool, data]) => ({
      tool,
      sessionCount: data.sessions,
      eventCount: data.events,
    }));

    if (toolEntries.length > 0) {
      const primary = toolEntries.sort((a, b) => b.eventCount - a.eventCount)[0];
      const directionStyle =
        averageHDS >= 0.6
          ? "Architectural Thinker — high direction on design"
          : averageHDS >= 0.3
            ? "Collaborative Builder — balanced human+AI workflow"
            : "AI Accelerator — leveraging AI for execution speed";

      result.aiCollaborationSummary = {
        toolBreakdown: toolEntries,
        directionStyle: `${directionStyle} (primary tool: ${primary.tool})`,
      };
    }
  }

  // Update personalization profile
  const v2Profile = updateProfileV2(result, signals, cwd);

  // Write daily metric snapshot (RDI + identity labels)
  writeMetricSnapshot(date, result, v2Profile, cwd);

  // Update graph files — include evidence event IDs for decision archaeology
  appendToDecisionsGraph(result, events, cwd);
  updateDomainsGraph(result, cwd);

  // Build enriched distill JSON (structured output for API + UI)
  const enriched = buildEnrichedDistill(result, triaged, narrativeSpine, events);
  await linkContinuityThreads(enriched, cwd);

  // Write distill markdown + JSON
  const distillPath = writeDistill(date, enriched, cwd);

  // Generate decision records for significant human-directed decisions
  generateDecisionRecords(result, cwd);

  // Send notification (unless silent)
  if (!options.silent) {
    notify(result, config);
  }

  logger.debug("Distillation complete", {
    date,
    decisions: result.decisions.length,
    synthesizedBy: result.synthesizedBy,
  });

  return { date, distill: result, path: distillPath, skipped: false };
}

/**
 * Backfill distillation for N past days.
 * Throttled: max 1 distill per 10 seconds to avoid overwhelming Ollama.
 * Notifications are suppressed during backfill (only final summary notified).
 */
export async function backfill(
  days: number,
  config: UnfadeConfig,
  options: DistillOptions = {},
): Promise<DistillResult[]> {
  const results: DistillResult[] = [];
  const today = new Date();

  for (let i = days; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = localDateStr(date);

    const result = await distill(dateStr, config, { ...options, silent: true });
    if (result) {
      results.push(result);
    }

    // Throttle between distills (skip for last iteration)
    if (i > 1 && results.length > 0) {
      await sleep(BACKFILL_THROTTLE_MS);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load a v2 reasoning profile from disk. Returns null if not found or not v2.
 */
function _loadReasoningProfileV2(cwd?: string): ReasoningModelV2 | null {
  const profilePath = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(profilePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
    if (parsed.version === 2) return parsed as ReasoningModelV2;
    return null;
  } catch {
    return null;
  }
}

/**
 * Format the PERSONALIZATION section for a distill.
 * Reads the v2 reasoning profile and generates markdown with:
 * - Decision style summary + comparison to personal baseline
 * - Domain depth comparison
 * - Emerging patterns (>0.7 confidence)
 * - Blind spots
 */
export function formatPersonalizationSection(
  profile: ReasoningModelV2 | null,
  distill: DailyDistill,
): string {
  // Guard against degenerate data — don't show a broken section
  if (!profile || profile.dataPoints < 5) return "";
  if (profile.decisionStyle.avgAlternativesEvaluated === 0) return "";

  const lines: string[] = ["## Your Patterns", ""];

  // Decision style summary + baseline comparison
  const todayAlts =
    distill.decisions.length > 0
      ? distill.decisions.reduce((s, d) => s + (d.alternativesConsidered ?? 0), 0) /
        distill.decisions.length
      : 0;
  const baselineAlts = profile.decisionStyle.avgAlternativesEvaluated;

  lines.push(
    `**Decision style:** You evaluate ${baselineAlts.toFixed(1)} alternatives on average.`,
  );

  if (todayAlts > 0 && baselineAlts > 0) {
    const ratio = todayAlts / baselineAlts;
    if (ratio > 1.2) {
      lines.push(
        `Today you evaluated ${todayAlts.toFixed(1)} alternatives per decision — above your baseline.`,
      );
    } else if (ratio < 0.8) {
      lines.push(
        `Today you evaluated ${todayAlts.toFixed(1)} alternatives per decision — below your baseline.`,
      );
    } else {
      lines.push(
        `Today you evaluated ${todayAlts.toFixed(1)} alternatives per decision — consistent with your baseline.`,
      );
    }
  }
  lines.push("");

  // Domain depth comparison — only show when meaningful (≥2 domains with ≥3 decisions each)
  const meaningfulDomains = profile.domainDistribution.filter((d) => d.frequency >= 3);
  if (meaningfulDomains.length >= 2) {
    lines.push("**Domain depth:**");
    const topDomains = meaningfulDomains.slice(0, 5);
    for (const d of topDomains) {
      const trendArrow =
        d.depthTrend === "deepening" ? " ↑" : d.depthTrend === "broadening" ? " →" : "";
      const avgAlts = d.avgAlternativesInDomain ?? 0;
      lines.push(
        `- **${d.domain}:** ${d.depth} (${d.frequency} decisions, ${avgAlts.toFixed(1)} avg alts)${trendArrow}`,
      );
    }
    lines.push("");
  }

  // Emerging patterns (>0.7 confidence)
  const emerging = surfaceablePatterns(profile.patterns);
  if (emerging.length > 0) {
    lines.push("**Emerging patterns** (confidence > 0.7):");
    for (const p of emerging) {
      lines.push(`- ${p.pattern} (confidence: ${p.confidence.toFixed(2)}, ${p.examples} examples)`);
    }
    lines.push("");
  }

  // Blind spots
  const blindSpots = detectBlindSpots(profile.domainDistribution);
  if (blindSpots.length > 0) {
    lines.push("**Blind spots:**");
    for (const bs of blindSpots) {
      lines.push(`- ${bs.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Write distill result as markdown to .unfade/distills/YYYY-MM-DD.md.
 * Returns the file path.
 */

/**
 * Write both markdown and structured JSON for a distill.
 */
function writeDistill(date: string, enriched: EnrichedDistill, cwd?: string): string {
  const distillsDir = getDistillsDir(cwd);
  mkdirSync(distillsDir, { recursive: true });

  // Write structured JSON (primary output for API + UI)
  const jsonPath = join(distillsDir, `${date}.json`);
  writeFileSync(jsonPath, JSON.stringify(enriched, null, 2), "utf-8");

  // Write human-readable markdown (secondary — for quick inspection / MCP)
  const mdPath = join(distillsDir, `${date}.md`);
  const markdown = formatDistillMarkdown(enriched);
  writeFileSync(mdPath, markdown, "utf-8");

  logger.debug("Wrote distill files", { json: jsonPath, md: mdPath });
  return mdPath;
}

/**
 * Append decisions to graph/decisions.jsonl (one JSON object per line).
 * Links each decision to the event IDs that contributed to it (evidence chain).
 * Each record includes projectId derived from the events that sourced it.
 */
function appendToDecisionsGraph(result: DailyDistill, events: CaptureEvent[], cwd?: string): void {
  const graphDir = getGraphDir(cwd);
  mkdirSync(graphDir, { recursive: true });
  const filePath = join(graphDir, "decisions.jsonl");

  const dominantProjectId = deriveDominantProjectId(events);

  const newLines = result.decisions.map((d) => {
    const evidenceIds = findEvidenceEventIds(d, events);
    const entry: Record<string, unknown> = {
      date: result.date,
      projectId: d.projectId || dominantProjectId,
      decision: d.decision,
      rationale: d.rationale,
      domain: d.domain,
      alternativesConsidered: d.alternativesConsidered,
      evidenceEventIds: evidenceIds,
    };
    const extended = d as Record<string, unknown>;
    if (extended.humanDirectionScore !== undefined)
      entry.humanDirectionScore = extended.humanDirectionScore;
    if (extended.directionClassification !== undefined)
      entry.directionClassification = extended.directionClassification;
    return JSON.stringify(entry);
  });

  if (newLines.length === 0) return;

  // Idempotent: remove existing entries for this date, then append new ones.
  // Prevents duplicate decisions when materializer re-runs distill for the same day.
  let existingLines: string[] = [];
  if (existsSync(filePath)) {
    existingLines = readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => {
        if (!line.trim()) return false;
        try {
          const entry = JSON.parse(line) as { date?: string };
          return entry.date !== result.date;
        } catch {
          return true; // keep malformed lines
        }
      });
  }

  const allLines = [...existingLines, ...newLines];
  writeFileSync(filePath, `${allLines.join("\n")}\n`, "utf-8");
}

/**
 * Derive the most common projectId from a set of events.
 * Used to tag decisions when individual decision-level projectId isn't set.
 */
function deriveDominantProjectId(events: CaptureEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    const pid = e.projectId || "";
    if (pid) counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  let maxPid = "";
  let maxCount = 0;
  for (const [pid, count] of counts) {
    if (count > maxCount) {
      maxPid = pid;
      maxCount = count;
    }
  }
  return maxPid;
}

/**
 * Update .unfade/graph/domains.json with domain frequency counts.
 */
function updateDomainsGraph(result: DailyDistill, cwd?: string): void {
  if (!result.domains || result.domains.length === 0) return;

  const graphDir = getGraphDir(cwd);
  mkdirSync(graphDir, { recursive: true });
  const filePath = join(graphDir, "domains.json");

  let domains: Record<string, { count: number; lastSeen: string }> = {};
  if (existsSync(filePath)) {
    try {
      domains = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // corrupted file — start fresh
    }
  }

  for (const domain of result.domains) {
    if (domains[domain]) {
      domains[domain].count += 1;
      domains[domain].lastSeen = result.date;
    } else {
      domains[domain] = { count: 1, lastSeen: result.date };
    }
  }

  writeFileSync(filePath, `${JSON.stringify(domains, null, 2)}\n`, "utf-8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

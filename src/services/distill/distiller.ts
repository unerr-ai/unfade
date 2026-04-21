// FILE: src/services/distill/distiller.ts
// UF-035: Distiller orchestrator.
// Pipeline: read events → extractSignals → linkContext → synthesize →
//           write distill → update graph → update profile → notify.
// Idempotent — re-running for the same date overwrites the distill file.
// Backfill mode: loop over N past days, throttled 1 per 10 seconds.
// Skip days with zero events — don't generate empty distills.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UnfadeConfig } from "../../schemas/config.js";
import { localDateStr } from "../../utils/date.js";
import type { DailyDistill } from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { logger } from "../../utils/logger.js";
import { getDistillsDir, getGraphDir, getProfileDir } from "../../utils/paths.js";
import { countEvents, readEvents } from "../capture/event-store.js";
import { selectNudge } from "../intelligence/nudges.js";
import { readSnapshots, writeMetricSnapshot } from "../intelligence/snapshot.js";
import { notify } from "../notification/notifier.js";
import { detectCrossSessionPatterns } from "../personalization/cross-session-detector.js";
import { detectBlindSpots } from "../personalization/feedback.js";
import { surfaceablePatterns } from "../personalization/pattern-detector.js";
import { updateProfileV2 } from "../personalization/profile-builder.js";
import { amplifyV2 } from "./amplifier.js";
import { linkContext } from "./context-linker.js";
import { generateDecisionRecords } from "./decision-records.js";
import { createLLMProvider, type LLMProviderResult } from "./providers/ai.js";
import { aggregateDirectionSignals, extractSignals } from "./signal-extractor.js";
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

  // Stage 1-2: Extract signals + link context (pure computation)
  const signals = extractSignals(events, date);
  const linked = linkContext(signals, events);

  // Stage 3: Fallback synthesis only (no LLM, zero cost)
  const result = await synthesize(linked, null, { cwd });

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

  // Stages 6-12: Profile, graph, amplification, write (all zero-cost)
  const v2Profile = updateProfileV2(result, signals, cwd);
  writeMetricSnapshot(date, result, v2Profile, cwd);

  const snapshots = readSnapshots(undefined, cwd);
  const nudge = selectNudge(result, v2Profile, snapshots);
  const insightSection = nudge ? `## Insight\n\n${nudge}\n` : "";

  appendToDecisionsGraph(result, events, cwd);
  updateDomainsGraph(result, cwd);

  const personalizationSection = formatPersonalizationSection(v2Profile, result);
  const { connectionsSection } = amplifyV2(date, cwd);
  const directionSection = formatDirectionSection(result);
  const crossPatterns = detectCrossSessionPatterns(cwd);
  const amplifiedSection = formatAmplifiedSection(crossPatterns);

  const distillPath = writeDistill(
    date,
    result,
    cwd,
    personalizationSection,
    connectionsSection,
    insightSection,
    directionSection,
    amplifiedSection,
  );

  generateDecisionRecords(result, cwd);

  // Incremental distills are silent — no desktop notification for background updates.
  // The scheduled LLM distill sends the notification when it enriches the result.

  logger.debug("Incremental distill complete (fallback)", {
    date,
    decisions: result.decisions.length,
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

  // Stage 2: Link context
  const linked = linkContext(signals, events);

  // Stage 3: Synthesize (LLM or fallback)
  const provider =
    options.provider !== undefined ? options.provider : await createLLMProvider(config);
  const result = await synthesize(linked, provider, { cwd });

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

  // Generate post-distill nudge (max 1 per distill)
  const snapshots = readSnapshots(undefined, cwd);
  const nudge = selectNudge(result, v2Profile, snapshots);
  const insightSection = nudge ? `## Insight\n\n${nudge}\n` : "";

  // Update graph files — include evidence event IDs for decision archaeology
  appendToDecisionsGraph(result, events, cwd);
  updateDomainsGraph(result, cwd);

  // Build personalization + connections sections
  const personalizationSection = formatPersonalizationSection(v2Profile, result);
  const { connectionsSection } = amplifyV2(date, cwd);

  // Build direction summary sections
  const directionSection = formatDirectionSection(result);

  // Detect cross-session amplified patterns
  const crossPatterns = detectCrossSessionPatterns(cwd);
  const amplifiedSection = formatAmplifiedSection(crossPatterns);

  // 12C.2/12C.4: Compute value receipt and debugging arcs sections
  let valueReceiptSection = "";
  let debuggingArcsSection = "";
  try {
    const { CacheManager } = await import("../cache/manager.js");
    const cache = new CacheManager(cwd);
    const db = await cache.getDb();
    if (db) {
      const { computeValueReceipt, formatValueReceiptSection } = await import(
        "../intelligence/value-receipt.js"
      );
      const receipt = computeValueReceipt(db, config.pricing as Record<string, number> | undefined);
      valueReceiptSection = formatValueReceiptSection(receipt);

      const { detectDebuggingArcs, formatDebuggingArcsSection } = await import(
        "../intelligence/debugging-arcs.js"
      );
      const arcs = detectDebuggingArcs(db);
      debuggingArcsSection = formatDebuggingArcsSection(arcs);
    }
  } catch {
    // non-fatal — value receipt and debugging arcs are additive
  }

  // Write distill markdown (with personalization + connections + insight + direction + amplified + value receipt + arcs)
  const distillPath = writeDistill(
    date,
    result,
    cwd,
    personalizationSection,
    connectionsSection,
    insightSection,
    directionSection,
    amplifiedSection,
    valueReceiptSection,
    debuggingArcsSection,
  );

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
  if (!profile || profile.dataPoints < 2) return "";

  const lines: string[] = ["## Personalization", ""];

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

  // AI interaction
  if (profile.decisionStyle.aiAcceptanceRate > 0) {
    lines.push(`AI acceptance rate: ${Math.round(profile.decisionStyle.aiAcceptanceRate * 100)}%`);
  }
  lines.push("");

  // Domain depth comparison
  if (profile.domainDistribution.length > 0) {
    lines.push("**Domain depth:**");
    const topDomains = profile.domainDistribution.slice(0, 5);
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
 * Format the Human Direction Summary + AI Collaboration Summary sections.
 */
function formatDirectionSection(distill: DailyDistill): string {
  if (!distill.directionSummary) return "";

  const ds = distill.directionSummary;
  const lines: string[] = ["## Human Direction Summary", ""];

  const classLabel =
    ds.averageHDS >= 0.6
      ? "Human-Directed"
      : ds.averageHDS >= 0.3
        ? "Collaborative"
        : "LLM-Directed";

  lines.push(`Average HDS: ${ds.averageHDS.toFixed(2)} (${classLabel})`);
  lines.push(
    `Human-Directed: ${ds.humanDirectedCount} decisions | Collaborative: ${ds.collaborativeCount} | LLM-Directed: ${ds.llmDirectedCount}`,
  );

  if (ds.topHumanDirectedDecisions.length > 0) {
    lines.push("");
    lines.push("**Top human-directed decisions:**");
    for (const d of ds.topHumanDirectedDecisions) {
      const truncated = d.length > 120 ? `${d.slice(0, 117)}...` : d;
      lines.push(`- ${truncated}`);
    }
  }
  lines.push("");

  if (distill.aiCollaborationSummary) {
    const acs = distill.aiCollaborationSummary;
    lines.push("## AI Collaboration Summary", "");

    for (const tool of acs.toolBreakdown) {
      lines.push(`- **${tool.tool}:** ${tool.eventCount} events (${tool.sessionCount} sessions)`);
    }
    lines.push(`- **Direction style:** ${acs.directionStyle}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatAmplifiedSection(
  patterns: Array<{
    pattern: string;
    occurrences: number;
    firstSeen: string;
    lastSeen: string;
    domains: string[];
    examples: string[];
  }>,
): string {
  if (patterns.length === 0) return "";

  const lines: string[] = ["## Amplified Insights", ""];
  lines.push("_Cross-session patterns detected across your reasoning history:_");
  lines.push("");

  for (const p of patterns.slice(0, 5)) {
    lines.push(`- **${p.pattern}**`);
    lines.push(`  ${p.occurrences} occurrences (${p.firstSeen} → ${p.lastSeen})`);
    if (p.domains.length > 0) {
      lines.push(`  Domains: ${p.domains.join(", ")}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function writeDistill(
  date: string,
  result: DailyDistill,
  cwd?: string,
  personalizationSection?: string,
  connectionsSection?: string,
  insightSection?: string,
  directionSection?: string,
  amplifiedSection?: string,
  valueReceiptSection?: string,
  debuggingArcsSection?: string,
): string {
  const distillsDir = getDistillsDir(cwd);
  mkdirSync(distillsDir, { recursive: true });
  const filePath = join(distillsDir, `${date}.md`);

  let markdown = formatDistillMarkdown(result);

  if (directionSection) {
    markdown = insertBeforeFooter(markdown, directionSection);
  }
  if (personalizationSection) {
    markdown = insertBeforeFooter(markdown, personalizationSection);
  }
  if (connectionsSection) {
    markdown = insertBeforeFooter(markdown, connectionsSection);
  }
  if (amplifiedSection) {
    markdown = insertBeforeFooter(markdown, amplifiedSection);
  }
  if (insightSection) {
    markdown = insertBeforeFooter(markdown, insightSection);
  }
  if (valueReceiptSection) {
    markdown = insertBeforeFooter(markdown, valueReceiptSection);
  }
  if (debuggingArcsSection) {
    markdown = insertBeforeFooter(markdown, debuggingArcsSection);
  }

  writeFileSync(filePath, markdown, "utf-8");

  logger.debug("Wrote distill file", { path: filePath });
  return filePath;
}

/**
 * Insert content before the footer (--- line) in markdown.
 */
function insertBeforeFooter(markdown: string, content: string): string {
  const footerIdx = markdown.lastIndexOf("\n---\n");
  if (footerIdx === -1) return `${markdown}\n${content}`;
  return `${markdown.slice(0, footerIdx)}\n${content}\n${markdown.slice(footerIdx)}`;
}

/**
 * Format DailyDistill as readable markdown.
 */
function formatDistillMarkdown(d: DailyDistill): string {
  const lines: string[] = [
    `# Daily Distill — ${d.date}`,
    "",
    `> ${d.summary}`,
    "",
    `- **Events processed:** ${d.eventsProcessed}`,
    `- **Synthesized by:** ${d.synthesizedBy ?? "unknown"}`,
    "",
  ];

  if (d.decisions.length > 0) {
    lines.push("## Decisions", "");
    for (const dec of d.decisions) {
      const alts = dec.alternativesConsidered
        ? ` (${dec.alternativesConsidered} alternatives considered)`
        : "";
      const domain = dec.domain ? ` [${dec.domain}]` : "";
      lines.push(`- **${dec.decision}**${domain}${alts}`);
      lines.push(`  _${dec.rationale}_`);
    }
    lines.push("");
  }

  if (d.tradeOffs && d.tradeOffs.length > 0) {
    lines.push("## Trade-offs", "");
    for (const t of d.tradeOffs) {
      lines.push(`- **${t.tradeOff}**`);
      lines.push(`  Chose: ${t.chose} · Rejected: ${t.rejected}`);
      if (t.context) lines.push(`  _${t.context}_`);
    }
    lines.push("");
  }

  if (d.deadEnds && d.deadEnds.length > 0) {
    lines.push("## Dead Ends", "");
    for (const de of d.deadEnds) {
      const time = de.timeSpentMinutes ? ` (~${de.timeSpentMinutes} min)` : "";
      lines.push(`- **${de.description}**${time}`);
      if (de.resolution) lines.push(`  _Resolution: ${de.resolution}_`);
    }
    lines.push("");
  }

  if (d.breakthroughs && d.breakthroughs.length > 0) {
    lines.push("## Breakthroughs", "");
    for (const b of d.breakthroughs) {
      lines.push(`- **${b.description}**`);
      if (b.trigger) lines.push(`  _Triggered by: ${b.trigger}_`);
    }
    lines.push("");
  }

  if (d.patterns && d.patterns.length > 0) {
    lines.push("## Patterns", "");
    for (const p of d.patterns) {
      lines.push(`- ${p}`);
    }
    lines.push("");
  }

  if (d.domains && d.domains.length > 0) {
    lines.push("## Domains", "");
    lines.push(d.domains.join(", "));
    lines.push("");
  }

  lines.push("---", "", `_Generated ${new Date().toISOString()}_`, "");
  return lines.join("\n");
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

  const lines = result.decisions.map((d) => {
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

  if (lines.length > 0) {
    appendFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
  }
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
 * Find event IDs that contributed to a decision via keyword matching.
 * Matches the decision text against event content summaries.
 */
function findEvidenceEventIds(
  decision: { decision: string; domain?: string; rationale?: string },
  events: CaptureEvent[],
): string[] {
  const keywords = extractKeywords(
    `${decision.decision} ${decision.rationale ?? ""} ${decision.domain ?? ""}`,
  );
  if (keywords.length === 0) return [];

  const scored: Array<{ id: string; score: number }> = [];

  for (const event of events) {
    const text = `${event.content.summary} ${event.content.detail ?? ""}`.toLowerCase();
    let hits = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) hits++;
    }
    if (hits >= 2) {
      scored.push({ id: event.id, score: hits });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.id);
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "was",
    "are",
    "to",
    "for",
    "of",
    "in",
    "on",
    "with",
    "and",
    "or",
    "not",
    "it",
    "this",
    "that",
    "we",
    "i",
    "you",
    "be",
    "have",
    "do",
    "will",
    "would",
    "could",
    "should",
    "but",
    "if",
    "from",
    "at",
    "by",
    "as",
    "into",
    "about",
    "than",
    "so",
    "no",
    "up",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 15);
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

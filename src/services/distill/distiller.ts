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
import type { DailyDistill } from "../../schemas/distill.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { logger } from "../../utils/logger.js";
import { getDistillsDir, getGraphDir, getProfileDir } from "../../utils/paths.js";
import { countEvents, readEvents } from "../capture/event-store.js";
import { notify } from "../notification/notifier.js";
import { detectBlindSpots } from "../personalization/feedback.js";
import { surfaceablePatterns } from "../personalization/pattern-detector.js";
import { updateProfile, updateProfileV2 } from "../personalization/profile-builder.js";
import { amplifyV2 } from "./amplifier.js";
import { linkContext } from "./context-linker.js";
import { createLLMProvider, type LLMProviderResult } from "./providers/ai.js";
import { extractSignals } from "./signal-extractor.js";
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

  // Stage 0: Read events
  const events = readEvents(date, cwd);
  logger.debug("Read events for distillation", { date, count: events.length });

  // Stage 1: Extract signals
  const signals = extractSignals(events, date);

  // Stage 2: Link context
  const linked = linkContext(signals, events);

  // Stage 3: Synthesize (LLM or fallback)
  const provider =
    options.provider !== undefined ? options.provider : await createLLMProvider(config);
  const result = await synthesize(linked, provider);

  // Update personalization profiles (v1 + v2)
  updateProfile(result, signals, cwd);
  const v2Profile = updateProfileV2(result, signals, cwd);

  // Update graph files
  appendToDecisionsGraph(result, cwd);
  updateDomainsGraph(result, cwd);

  // Build personalization + connections sections
  const personalizationSection = formatPersonalizationSection(v2Profile, result);
  const { connectionsSection } = amplifyV2(date, cwd);

  // Write distill markdown (with personalization + connections)
  const distillPath = writeDistill(date, result, cwd, personalizationSection, connectionsSection);

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
    const dateStr = date.toISOString().slice(0, 10);

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
function loadReasoningProfileV2(cwd?: string): ReasoningModelV2 | null {
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
function writeDistill(
  date: string,
  result: DailyDistill,
  cwd?: string,
  personalizationSection?: string,
  connectionsSection?: string,
): string {
  const distillsDir = getDistillsDir(cwd);
  mkdirSync(distillsDir, { recursive: true });
  const filePath = join(distillsDir, `${date}.md`);

  let markdown = formatDistillMarkdown(result);

  // Append personalization section before the footer
  if (personalizationSection) {
    markdown = insertBeforeFooter(markdown, personalizationSection);
  }
  if (connectionsSection) {
    markdown = insertBeforeFooter(markdown, connectionsSection);
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
 * Append decisions to .unfade/graph/decisions.jsonl (one JSON object per line).
 */
function appendToDecisionsGraph(result: DailyDistill, cwd?: string): void {
  const graphDir = getGraphDir(cwd);
  mkdirSync(graphDir, { recursive: true });
  const filePath = join(graphDir, "decisions.jsonl");

  const lines = result.decisions.map((d) =>
    JSON.stringify({
      date: result.date,
      decision: d.decision,
      rationale: d.rationale,
      domain: d.domain,
      alternativesConsidered: d.alternativesConsidered,
    }),
  );

  if (lines.length > 0) {
    appendFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
  }
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

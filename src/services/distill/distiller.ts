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
import { logger } from "../../utils/logger.js";
import { getDistillsDir, getGraphDir } from "../../utils/paths.js";
import { countEvents, readEvents } from "../capture/event-store.js";
import { notify } from "../notification/notifier.js";
import { updateProfile } from "../personalization/profile-builder.js";
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

  // Write distill markdown
  const distillPath = writeDistill(date, result, cwd);

  // Update graph files
  appendToDecisionsGraph(result, cwd);
  updateDomainsGraph(result, cwd);

  // Update personalization profile
  updateProfile(result, signals, cwd);

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
 * Write distill result as markdown to .unfade/distills/YYYY-MM-DD.md.
 * Returns the file path.
 */
function writeDistill(date: string, result: DailyDistill, cwd?: string): string {
  const distillsDir = getDistillsDir(cwd);
  mkdirSync(distillsDir, { recursive: true });
  const filePath = join(distillsDir, `${date}.md`);

  const markdown = formatDistillMarkdown(result);
  writeFileSync(filePath, markdown, "utf-8");

  logger.debug("Wrote distill file", { path: filePath });
  return filePath;
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

// FILE: src/services/distill/first-distill.ts
// UF-086a: Immediate first distill after backfill.
// Produces a structured signal summary WITHOUT LLM — decision count, files changed,
// domains touched, time invested. Output is valid DailyDistill markdown.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureEvent } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";
import { getDistillsDir } from "../../utils/paths.js";
import { listEventDates, readEvents } from "../capture/event-store.js";

/**
 * Extract unique domains from file extensions in events.
 */
function extractDomains(events: CaptureEvent[]): string[] {
  const domainMap: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript/React",
    ".js": "JavaScript",
    ".go": "Go",
    ".py": "Python",
    ".rs": "Rust",
    ".java": "Java",
    ".css": "Styles",
    ".html": "Markup",
    ".sql": "Database",
    ".yml": "Config",
    ".yaml": "Config",
    ".json": "Config",
    ".md": "Docs",
    ".sh": "Shell",
  };

  const domains = new Set<string>();
  for (const event of events) {
    const files = event.content.files ?? [];
    for (const file of files) {
      const ext = file.slice(file.lastIndexOf("."));
      const domain = domainMap[ext.toLowerCase()];
      if (domain) domains.add(domain);
    }
  }
  return Array.from(domains).sort();
}

/**
 * Extract decisions from commit messages (heuristic: lines with "chose", "decided", "switched to", etc).
 */
function extractDecisions(
  events: CaptureEvent[],
): Array<{ decision: string; rationale: string; domain?: string }> {
  const decisions: Array<{ decision: string; rationale: string; domain?: string }> = [];
  const commitEvents = events.filter((e) => e.type === "commit");

  for (const event of commitEvents) {
    const summary = event.content.summary;
    const branch = event.content.branch ?? event.gitContext?.branch;

    // Each commit is implicitly a decision about what to work on.
    // For the first distill, we keep it simple: each commit = one decision.
    if (summary) {
      decisions.push({
        decision: summary,
        rationale: branch ? `On branch ${branch}` : "From git history",
        domain: branch ? domainFromBranch(branch) : undefined,
      });
    }
  }

  // Cap at 20 to keep the distill readable.
  return decisions.slice(0, 20);
}

/**
 * Infer domain from branch name.
 */
function domainFromBranch(branch: string): string | undefined {
  const lower = branch.toLowerCase();
  if (lower.includes("feat")) return "feature";
  if (lower.includes("fix") || lower.includes("bug")) return "bugfix";
  if (lower.includes("refactor")) return "refactoring";
  if (lower.includes("test")) return "testing";
  if (lower.includes("doc")) return "documentation";
  if (lower.includes("ci") || lower.includes("deploy")) return "infrastructure";
  return undefined;
}

/**
 * Count unique files changed across all events.
 */
function countFilesChanged(events: CaptureEvent[]): number {
  const files = new Set<string>();
  for (const event of events) {
    for (const file of event.content.files ?? []) {
      files.add(file);
    }
  }
  return files.size;
}

/**
 * Format a structured signal summary as markdown.
 */
function formatMarkdown(
  date: string,
  events: CaptureEvent[],
  decisions: Array<{ decision: string; rationale: string; domain?: string }>,
  domains: string[],
  filesChanged: number,
): string {
  const commitCount = events.filter((e) => e.type === "commit").length;
  const branchSwitches = events.filter((e) => e.type === "branch-switch").length;
  const aiEvents = events.filter((e) => e.source === "ai-session").length;

  const lines: string[] = [
    `# Daily Distill — ${date}`,
    "",
    "> Structured signal summary (no LLM synthesis)",
    "",
    "## Overview",
    "",
    `- **Events processed:** ${events.length}`,
    `- **Commits:** ${commitCount}`,
    `- **Branch switches:** ${branchSwitches}`,
    `- **AI interactions:** ${aiEvents}`,
    `- **Files changed:** ${filesChanged}`,
    `- **Domains:** ${domains.length > 0 ? domains.join(", ") : "—"}`,
    "",
  ];

  if (decisions.length > 0) {
    lines.push("## Decisions", "");
    for (const d of decisions) {
      const domainTag = d.domain ? ` [${d.domain}]` : "";
      lines.push(`- **${d.decision}**${domainTag}`);
      lines.push(`  _${d.rationale}_`);
    }
    lines.push("");
  }

  if (domains.length > 0) {
    lines.push("## Domains Touched", "");
    for (const domain of domains) {
      lines.push(`- ${domain}`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    `_Generated ${new Date().toISOString()} — structured summary mode (no LLM configured)_`,
    "",
  );

  return lines.join("\n");
}

export interface FirstDistillResult {
  date: string;
  path: string;
  eventsProcessed: number;
  decisions: number;
  domains: string[];
}

/**
 * Generate the first distill from the most recent day with events.
 * Uses no LLM — produces structured signal summary.
 * Returns null if no events exist.
 */
export function generateFirstDistill(cwd?: string): FirstDistillResult | null {
  const dates = listEventDates(cwd);
  if (dates.length === 0) {
    logger.debug("No event dates found, skipping first distill");
    return null;
  }

  // Use the most recent date with events.
  const date = dates[dates.length - 1];
  const events = readEvents(date, cwd);

  if (events.length === 0) {
    logger.debug("No events for date, skipping first distill", { date });
    return null;
  }

  const decisions = extractDecisions(events);
  const domains = extractDomains(events);
  const filesChanged = countFilesChanged(events);
  const markdown = formatMarkdown(date, events, decisions, domains, filesChanged);

  // Write to distills directory.
  const distillsDir = getDistillsDir(cwd);
  mkdirSync(distillsDir, { recursive: true });
  const distillPath = join(distillsDir, `${date}.md`);

  if (!existsSync(distillPath)) {
    writeFileSync(distillPath, markdown, "utf-8");
    logger.debug("Wrote first distill", { path: distillPath, events: events.length });
  } else {
    logger.debug("Distill already exists for date", { date });
  }

  return {
    date,
    path: distillPath,
    eventsProcessed: events.length,
    decisions: decisions.length,
    domains,
  };
}

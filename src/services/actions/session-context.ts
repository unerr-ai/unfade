// FILE: src/services/actions/session-context.ts
// 12B.6: Session-end context writer — updates CLAUDE.md with last session context.
// Replaces (not appends) the "Recent Context" section between markers.
// Max 500 chars per field to prevent file bloat.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectDataDir } from "../../utils/paths.js";
import type { ActionContext, ActionOutcome, ActionRegistration } from "./runner.js";
import { replaceMarkerSection } from "./runner.js";

const MAX_FIELD_LENGTH = 500;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

interface SessionSummary {
  intent: string;
  decisions: string[];
  unresolved: string[];
}

/**
 * Extract session summary from the latest events.
 * Reads from the distill or summary data.
 */
function extractSessionSummary(repoRoot: string): SessionSummary | null {
  // Try reading from summary.json (has latest session info)
  const summaryPath = join(getProjectDataDir(repoRoot), "state", "summary.json");
  if (!existsSync(summaryPath)) return null;

  try {
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    const intent = summary.lastSessionIntent ?? summary.topDomain ?? "General development";
    const decisions = (summary.recentDecisions ?? []) as string[];
    const unresolved = (summary.unresolvedItems ?? []) as string[];

    if (!intent && decisions.length === 0) return null;

    return { intent, decisions, unresolved };
  } catch {
    return null;
  }
}

async function executeSessionContext(ctx: ActionContext): Promise<ActionOutcome> {
  const summary = extractSessionSummary(ctx.repoRoot);
  if (!summary) {
    return {
      action: "session_context",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "no_session_data",
    };
  }

  const claudeMdPath = join(ctx.repoRoot, "CLAUDE.md");
  const timestamp = new Date().toISOString();

  const lines = [
    `## Recent Context (auto-updated by Unfade)`,
    "",
    `**Last session intent:** ${truncate(summary.intent, MAX_FIELD_LENGTH)}`,
  ];

  if (summary.decisions.length > 0) {
    lines.push(`**Key decisions:** ${truncate(summary.decisions.join("; "), MAX_FIELD_LENGTH)}`);
  }

  if (summary.unresolved.length > 0) {
    lines.push(`**Unresolved:** ${truncate(summary.unresolved.join("; "), MAX_FIELD_LENGTH)}`);
  }

  lines.push("", `_Updated: ${timestamp}_`);

  const content = lines.join("\n");
  const hash = replaceMarkerSection(claudeMdPath, `CONTEXT (${timestamp.slice(0, 10)})`, content);

  return { action: "session_context", target: claudeMdPath, contentHash: hash };
}

export const sessionContextAction: ActionRegistration = {
  trigger: "session_end",
  name: "session_context",
  configGate: (config) => config.actions.sessionContext,
  execute: executeSessionContext,
};

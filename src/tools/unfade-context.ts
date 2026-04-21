// FILE: src/tools/unfade-context.ts
// UF-053: Context reader — recent context retrieval with scope filtering.
// Scopes: last_2h (today's events filtered by timestamp), today (all today's),
// this_week (last 7 days). Includes distill summary when available.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ContextEvent, ContextInput, ContextOutput, McpMeta } from "../schemas/mcp.js";
import { readEventRange, readEvents } from "../services/capture/event-store.js";
import { localDateStr } from "../utils/date.js";
import { getDistillsDir, getEventsDir } from "../utils/paths.js";

/**
 * Extract summary from a distill markdown file's blockquote line.
 */
function readDistillSummary(distillsDir: string, date: string): string | null {
  const mdPath = join(distillsDir, `${date}.md`);
  if (!existsSync(mdPath)) return null;

  try {
    const content = readFileSync(mdPath, "utf-8");
    const match = content.match(/^>\s*(.+)$/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get the most recent mtime across event files for the given date range.
 */
function getEventsLastUpdated(eventsDir: string, from: string, to: string): string | null {
  if (!existsSync(eventsDir)) return null;

  const current = new Date(from);
  const toDate = new Date(to);
  let latest: Date | null = null;

  while (current <= toDate) {
    const dateStr = localDateStr(current);
    const filePath = join(eventsDir, `${dateStr}.jsonl`);
    try {
      if (existsSync(filePath)) {
        const mtime = statSync(filePath).mtime;
        if (!latest || mtime > latest) latest = mtime;
      }
    } catch {
      // skip
    }
    current.setDate(current.getDate() + 1);
  }

  return latest ? latest.toISOString() : null;
}

/**
 * Retrieve recent context based on scope.
 * Returns events + optional distill summary wrapped in MCP response envelope.
 */
export function getRecentContext(input: ContextInput, cwd?: string): ContextOutput {
  const start = performance.now();
  const now = new Date();
  const today = localDateStr(now);

  let from: string;
  let to: string;
  let filterTimestamp: Date | null = null;

  switch (input.scope) {
    case "last_2h":
      from = today;
      to = today;
      filterTimestamp = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      break;
    case "this_week": {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 6);
      from = localDateStr(weekAgo);
      to = today;
      break;
    }
    default:
      from = today;
      to = today;
      break;
  }

  // Read events for the scope's date range
  let rawEvents = from === to ? readEvents(from, cwd) : readEventRange(from, to, cwd);

  // Filter by timestamp for last_2h
  if (filterTimestamp) {
    const cutoff = filterTimestamp.toISOString();
    rawEvents = rawEvents.filter((ev) => ev.timestamp >= cutoff);
  }

  // Filter by project if specified
  if (input.project) {
    const proj = input.project;
    rawEvents = rawEvents.filter((ev) => ev.content.project === proj);
  }

  // Map to ContextEvent shape
  const events: ContextEvent[] = rawEvents.map((ev) => ({
    id: ev.id,
    timestamp: ev.timestamp,
    source: ev.source,
    type: ev.type,
    summary: ev.content.summary,
    detail: ev.content.detail,
    branch: ev.content.branch ?? ev.gitContext?.branch,
  }));

  // Read distill summary for today (or most recent day in range)
  const distillsDir = getDistillsDir(cwd);
  const distillSummary = readDistillSummary(distillsDir, today);

  const eventsDir = getEventsDir(cwd);
  const lastUpdated = getEventsLastUpdated(eventsDir, from, to);

  const meta: McpMeta = {
    tool: "unfade-context",
    durationMs: Math.round(performance.now() - start),
    degraded: false,
    lastUpdated,
  };

  return {
    data: {
      scope: input.scope,
      events,
      eventCount: events.length,
      distillSummary,
    },
    _meta: meta,
  };
}

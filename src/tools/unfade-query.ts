// FILE: src/tools/unfade-query.ts
// UF-052: Query engine — keyword + date range search over JSONL events
// and Markdown distills. Returns ranked results with relevance scores.
// No database — pure file reads. Scans only files within requested date range.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CaptureEvent } from "../schemas/event.js";
import type { McpMeta, QueryInput, QueryOutput, QueryResultItem } from "../schemas/mcp.js";
import { readEventRange } from "../services/capture/event-store.js";
import { localToday } from "../utils/date.js";
import { getDistillsDir, getEventsDir } from "../utils/paths.js";

/**
 * Score a text match: keyword frequency normalized by text length, boosted by recency.
 */
function scoreMatch(text: string, keywords: string[], dateStr: string, now: number): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    let idx = lower.indexOf(kw);
    while (idx !== -1) {
      hits++;
      idx = lower.indexOf(kw, idx + kw.length);
    }
  }
  if (hits === 0) return 0;

  // Frequency component: normalize by text length (cap at 1)
  const freq = Math.min(hits / Math.max(text.length / 100, 1), 1);

  // Recency component: decay over 30 days
  const dateMs = new Date(dateStr).getTime();
  const daysSince = Math.max((now - dateMs) / (1000 * 60 * 60 * 24), 0);
  const recency = Math.max(1 - daysSince / 30, 0.1);

  return Math.min(freq * 0.6 + recency * 0.4, 1);
}

/**
 * Search events within date range for keyword matches.
 */
function searchEvents(events: CaptureEvent[], keywords: string[], now: number): QueryResultItem[] {
  const results: QueryResultItem[] = [];

  for (const ev of events) {
    const text = [ev.content.summary, ev.content.detail ?? ""].join(" ");
    const score = scoreMatch(text, keywords, ev.timestamp.slice(0, 10), now);
    if (score > 0) {
      results.push({
        source: "event",
        date: ev.timestamp.slice(0, 10),
        summary: ev.content.summary,
        detail: ev.content.detail,
        score: Math.round(score * 1000) / 1000,
      });
    }
  }

  return results;
}

/**
 * Search distill markdown files within date range for keyword matches.
 */
function searchDistills(
  distillsDir: string,
  from: string,
  to: string,
  keywords: string[],
  now: number,
): QueryResultItem[] {
  if (!existsSync(distillsDir)) return [];

  const results: QueryResultItem[] = [];
  let files: string[];

  try {
    files = readdirSync(distillsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.replace(".md", ""))
      .filter((d) => d >= from && d <= to)
      .sort();
  } catch {
    return [];
  }

  for (const date of files) {
    try {
      const content = readFileSync(join(distillsDir, `${date}.md`), "utf-8");
      const score = scoreMatch(content, keywords, date, now);
      if (score > 0) {
        // Extract summary from blockquote
        const summaryMatch = content.match(/^>\s*(.+)$/m);
        const summary = summaryMatch ? summaryMatch[1] : `Distill for ${date}`;
        results.push({
          source: "distill",
          date,
          summary,
          score: Math.round(score * 1000) / 1000,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Get the most recent file mtime across events and distills in the date range.
 */
function getLastUpdated(
  eventsDir: string,
  distillsDir: string,
  from: string,
  to: string,
): string | null {
  let latest: Date | null = null;

  for (const dir of [eventsDir, distillsDir]) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir);
      for (const f of files) {
        const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})\./);
        if (!dateMatch) continue;
        if (dateMatch[1] < from || dateMatch[1] > to) continue;
        const stat = statSync(join(dir, f));
        if (!latest || stat.mtime > latest) {
          latest = stat.mtime;
        }
      }
    } catch {
      // skip
    }
  }

  return latest ? latest.toISOString() : null;
}

/**
 * Query events and distills by keyword with optional date range.
 * Returns ranked results wrapped in the MCP response envelope.
 */
export function queryEvents(input: QueryInput, cwd?: string): QueryOutput {
  const start = performance.now();
  const now = Date.now();

  const today = localToday();
  const from = input.dateRange?.from ?? "2000-01-01";
  const to = input.dateRange?.to ?? today;
  const keywords = input.query.toLowerCase().split(/\s+/).filter(Boolean);

  if (keywords.length === 0) {
    const meta: McpMeta = {
      tool: "unfade-query",
      durationMs: Math.round(performance.now() - start),
      degraded: false,
      lastUpdated: null,
    };
    return { data: { results: [], total: 0 }, _meta: meta };
  }

  const eventsDir = getEventsDir(cwd);
  const distillsDir = getDistillsDir(cwd);

  // Search events
  const events = readEventRange(from, to, cwd);
  const eventResults = searchEvents(events, keywords, now);

  // Search distills
  const distillResults = searchDistills(distillsDir, from, to, keywords, now);

  // Merge, sort by score descending, limit
  const allResults = [...eventResults, ...distillResults]
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit);

  const totalCount = eventResults.length + distillResults.length;
  const lastUpdated = getLastUpdated(eventsDir, distillsDir, from, to);

  const meta: McpMeta = {
    tool: "unfade-query",
    durationMs: Math.round(performance.now() - start),
    degraded: false,
    lastUpdated,
  };

  return { data: { results: allResults, total: totalCount }, _meta: meta };
}

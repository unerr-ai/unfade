// FILE: src/services/capture/event-store.ts
// TypeScript read-side for CaptureEvent JSONL files.
// The Go daemon writes to .unfade/events/YYYY-MM-DD.jsonl via O_APPEND.
// This module reads, parses, and tolerates partial last lines.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CaptureEvent, CaptureEventSchema } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";
import { getEventsDir } from "../../utils/paths.js";

function eventFilePath(eventsDir: string, date: string): string {
  return join(eventsDir, `${date}.jsonl`);
}

/**
 * Parse JSONL content into validated CaptureEvents.
 * Skips blank lines and malformed lines (tolerates partial last line from daemon mid-write).
 * Never throws.
 */
function parseJsonlLines(content: string): CaptureEvent[] {
  const events: CaptureEvent[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    try {
      const parsed = JSON.parse(trimmed);
      const result = CaptureEventSchema.safeParse(parsed);
      if (result.success) {
        events.push(result.data);
      } else {
        logger.debug("Skipping event with invalid schema", { line: trimmed.slice(0, 80) });
      }
    } catch {
      // Partial line from daemon mid-write — expected, not an error
      logger.debug("Skipping malformed JSON line", { line: trimmed.slice(0, 80) });
    }
  }

  return events;
}

/**
 * Read all CaptureEvents for a given date.
 * @param date - ISO date string YYYY-MM-DD
 * @param cwd - Working directory for resolving .unfade/events/
 * @returns Array of validated CaptureEvents (empty if file doesn't exist)
 */
export function readEvents(date: string, cwd?: string): CaptureEvent[] {
  const eventsDir = getEventsDir(cwd);
  const filePath = eventFilePath(eventsDir, date);

  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    return parseJsonlLines(content);
  } catch {
    logger.warn("Failed to read events file", { path: filePath });
    return [];
  }
}

/**
 * Count events for a given date without parsing all of them.
 * Counts valid JSON lines (fast approximation).
 */
export function countEvents(date: string, cwd?: string): number {
  const eventsDir = getEventsDir(cwd);
  const filePath = eventFilePath(eventsDir, date);

  if (!existsSync(filePath)) return 0;

  try {
    const content = readFileSync(filePath, "utf-8");
    let count = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        JSON.parse(trimmed);
        count++;
      } catch {
        // partial line — skip
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Read events across a date range (inclusive).
 * @param from - Start date YYYY-MM-DD
 * @param to - End date YYYY-MM-DD
 * @returns All events in the date range, ordered by file date
 */
export function readEventRange(from: string, to: string, cwd?: string): CaptureEvent[] {
  const eventsDir = getEventsDir(cwd);

  if (!existsSync(eventsDir)) return [];

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const events: CaptureEvent[] = [];

  // Iterate through each day in range
  const current = new Date(fromDate);
  while (current <= toDate) {
    const dateStr = current.toISOString().slice(0, 10);
    const dayEvents = readEvents(dateStr, cwd);
    events.push(...dayEvents);
    current.setDate(current.getDate() + 1);
  }

  return events;
}

/**
 * Get the last-modified time of an events file.
 * Returns null if the file doesn't exist.
 */
export function getEventsLastUpdated(date: string, cwd?: string): Date | null {
  const eventsDir = getEventsDir(cwd);
  const filePath = eventFilePath(eventsDir, date);

  if (!existsSync(filePath)) return null;

  try {
    return statSync(filePath).mtime;
  } catch {
    return null;
  }
}

/**
 * List all available event dates (from filenames in the events directory).
 * Returns sorted array of YYYY-MM-DD strings.
 */
export function listEventDates(cwd?: string): string[] {
  const eventsDir = getEventsDir(cwd);

  if (!existsSync(eventsDir)) return [];

  try {
    return readdirSync(eventsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.replace(".jsonl", ""))
      .sort();
  } catch {
    return [];
  }
}

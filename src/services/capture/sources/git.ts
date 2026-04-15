// FILE: src/services/capture/sources/git.ts
// Read-only TypeScript client for git capture events.
// Thin filter layer over event-store.ts — no watching logic.
// The Go daemon handles all git watching; this just reads the results.

import type { CaptureEvent } from "../../../schemas/event.js";
import { readEventRange, readEvents } from "../event-store.js";

/** Filter predicate for git-sourced events. */
function isGitEvent(event: CaptureEvent): boolean {
  return event.source === "git";
}

/**
 * Read all git events for a given date.
 * @param date - ISO date string YYYY-MM-DD
 * @param cwd - Working directory for resolving .unfade/events/
 */
export function readGitEvents(date: string, cwd?: string): CaptureEvent[] {
  return readEvents(date, cwd).filter(isGitEvent);
}

/**
 * Read git events across a date range (inclusive).
 * @param from - Start date YYYY-MM-DD
 * @param to - End date YYYY-MM-DD
 */
export function readGitEventRange(from: string, to: string, cwd?: string): CaptureEvent[] {
  return readEventRange(from, to, cwd).filter(isGitEvent);
}

/**
 * Read only git commit events for a given date.
 */
export function readGitCommits(date: string, cwd?: string): CaptureEvent[] {
  return readGitEvents(date, cwd).filter((e) => e.type === "commit");
}

/**
 * Read only branch-switch events for a given date.
 */
export function readBranchSwitches(date: string, cwd?: string): CaptureEvent[] {
  return readGitEvents(date, cwd).filter((e) => e.type === "branch-switch");
}

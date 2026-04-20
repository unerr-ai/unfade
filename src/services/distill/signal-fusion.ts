import type { CaptureEvent } from "../../schemas/event.js";

const DEDUP_WINDOW_MS = 60_000;
const SIMILARITY_THRESHOLD = 0.5;

/**
 * Fuse active (mcp-active) and passive (ai-session) signals for the same day.
 *
 * Rules:
 * 1. Active signals (mcp-active) are ground truth — agent self-reported
 * 2. Passive signals fill gaps where no active signal exists
 * 3. Overlapping events are deduplicated by timestamp proximity + content similarity
 *
 * Returns deduplicated event list with active signals preferred.
 */
export function fuseSignals(events: CaptureEvent[]): CaptureEvent[] {
  const active = events.filter((e) => e.source === "mcp-active");
  const passive = events.filter((e) => e.source === "ai-session");
  const other = events.filter((e) => e.source !== "mcp-active" && e.source !== "ai-session");

  if (active.length === 0) return events;
  if (passive.length === 0) return events;

  const dedupedPassive = passive.filter((passiveEvent) => !hasMatchingActive(passiveEvent, active));

  return [...other, ...active, ...dedupedPassive];
}

function hasMatchingActive(passiveEvent: CaptureEvent, activeEvents: CaptureEvent[]): boolean {
  const passiveTime = new Date(passiveEvent.timestamp).getTime();

  for (const active of activeEvents) {
    const activeTime = new Date(active.timestamp).getTime();
    const timeDiff = Math.abs(activeTime - passiveTime);

    if (timeDiff > DEDUP_WINDOW_MS) continue;

    const sim = contentSimilarity(passiveEvent.content.summary, active.content.summary);

    if (sim >= SIMILARITY_THRESHOLD) return true;
  }

  return false;
}

/**
 * Simple word-overlap Jaccard similarity between two strings.
 */
function contentSimilarity(a: string, b: string): number {
  const wordsA = new Set(tokenize(a));
  const wordsB = new Set(tokenize(b));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

// FILE: src/services/intelligence/outcome-classifier.ts
// Phase 11D.8: Post-materialization outcome classification.
// Derives outcome per AI conversation event using heuristic rules from §3.3.
// Writes outcome to the DB metadata column — NEVER to source JSONL.

import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";

export type Outcome = "success" | "partial" | "failed" | "abandoned";

interface EventRow {
  id: string;
  metadata: string;
  type: string;
  source: string;
}

/**
 * Classify outcomes for newly materialized AI conversation events.
 * Called post-materialization with event IDs that need classification.
 * Updates the metadata JSON column in the events table with an "outcome" field.
 */
export function classifyOutcomes(db: DbLike, eventIds: string[]): number {
  if (eventIds.length === 0) return 0;

  let classified = 0;

  for (const eventId of eventIds) {
    const rows = db.exec(
      "SELECT id, metadata, type, source FROM events WHERE id = ? AND type = 'ai-conversation'",
      [eventId],
    );

    if (!rows[0] || rows[0].values.length === 0) continue;

    const row: EventRow = {
      id: rows[0].values[0][0] as string,
      metadata: rows[0].values[0][1] as string,
      type: rows[0].values[0][2] as string,
      source: rows[0].values[0][3] as string,
    };

    const metadata = safeParseJson(row.metadata);
    if (!metadata || metadata.outcome) continue; // Already classified

    const outcome = deriveOutcome(metadata, db, eventId);
    metadata.outcome = outcome;

    db.run("UPDATE events SET metadata = ? WHERE id = ?", [
      JSON.stringify(metadata),
      eventId,
    ]);
    classified++;
  }

  if (classified > 0) {
    logger.debug("Outcome classification complete", { classified });
  }

  return classified;
}

/**
 * Classify all unclassified AI conversation events in the database.
 * Used for backfill after initial deployment.
 */
export function classifyAllUnclassified(db: DbLike): number {
  const rows = db.exec(
    "SELECT id FROM events WHERE type = 'ai-conversation' AND json_extract(metadata, '$.outcome') IS NULL",
  );

  if (!rows[0] || rows[0].values.length === 0) return 0;

  const eventIds = rows[0].values.map((r) => r[0] as string);
  return classifyOutcomes(db, eventIds);
}

/**
 * Core outcome derivation logic. Rules from §3.3:
 * 1. files_modified present → success
 * 2. Last prompt contains abandon keywords → abandoned
 * 3. iteration_count > 5 with no file output → failed
 * 4. Context switch (next event touches different files) → partial
 * 5. conversation_complete with output → success
 */
function deriveOutcome(
  metadata: Record<string, unknown>,
  db: DbLike,
  eventId: string,
): Outcome {
  const filesModified = metadata.files_modified as string[] | undefined;
  const iterationCount = (metadata.iteration_count as number) ?? 0;
  const promptsAll = metadata.prompts_all as string[] | undefined;
  const conversationComplete = metadata.conversation_complete as boolean | undefined;

  // Rule 1: Files modified → success
  if (filesModified && filesModified.length > 0) {
    return "success";
  }

  // Rule 2: Abandon keywords in last prompt
  if (promptsAll && promptsAll.length > 0) {
    const lastPrompt = promptsAll[promptsAll.length - 1].toLowerCase();
    const abandonKeywords = ["never mind", "cancel", "skip", "forget it", "nevermind", "nvm"];
    for (const kw of abandonKeywords) {
      if (lastPrompt.includes(kw)) {
        return "abandoned";
      }
    }
  }

  // Rule 3: High iteration with no file output → failed
  if (iterationCount > 5 && (!filesModified || filesModified.length === 0)) {
    return "failed";
  }

  // Rule 4: Context switch detection (next event touches entirely different files)
  if (filesModified && filesModified.length === 0) {
    const hasContextSwitch = detectContextSwitch(db, eventId, metadata);
    if (hasContextSwitch) {
      return "partial";
    }
  }

  // Rule 5: Conversation ended naturally with no modifications → partial
  if (conversationComplete && (!filesModified || filesModified.length === 0)) {
    return "partial";
  }

  // Default: partial (no clear signal)
  return "partial";
}

/**
 * Detect context switch: the next event from the same session touches
 * entirely different files.
 */
function detectContextSwitch(
  db: DbLike,
  eventId: string,
  metadata: Record<string, unknown>,
): boolean {
  const sessionId = metadata.session_id as string | undefined;
  if (!sessionId) return false;

  const currentFiles = [
    ...((metadata.files_referenced as string[]) ?? []),
    ...((metadata.files_modified as string[]) ?? []),
  ];
  if (currentFiles.length === 0) return false;

  // Find the next event in the same session
  const nextRows = db.exec(
    `SELECT metadata FROM events
     WHERE json_extract(metadata, '$.session_id') = ?
     AND json_extract(metadata, '$.sequence_id') > ?
     ORDER BY json_extract(metadata, '$.sequence_id') ASC
     LIMIT 1`,
    [sessionId, (metadata.sequence_id as number) ?? 0],
  );

  if (!nextRows[0] || nextRows[0].values.length === 0) return false;

  const nextMeta = safeParseJson(nextRows[0].values[0][0] as string);
  if (!nextMeta) return false;

  const nextFiles = [
    ...((nextMeta.files_referenced as string[]) ?? []),
    ...((nextMeta.files_modified as string[]) ?? []),
  ];
  if (nextFiles.length === 0) return false;

  // Check if there's ANY overlap
  const currentSet = new Set(currentFiles);
  const hasOverlap = nextFiles.some((f) => currentSet.has(f));
  return !hasOverlap; // Context switch if NO overlap
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

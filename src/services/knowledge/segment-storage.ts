// FILE: src/services/knowledge/segment-storage.ts
// Persists ConversationSegment[] to both DuckDB (JSON column on events + typed event_segments table)
// and SQLite (event_segments table for relational queries).
// DuckDB is the analytics layer; SQLite is the operational layer.

import type { DbLike } from "../cache/manager.js";
import type { ConversationSegment } from "../../schemas/knowledge.js";

/**
 * Store segments for an event in both analytics (DuckDB) and operational (SQLite) databases.
 *
 * - DuckDB: writes to `event_segments` typed table + updates `events.segments` JSON column
 * - SQLite: writes to `event_segments` relational table
 *
 * Idempotent — deletes existing segments for the event before inserting.
 */
export async function storeSegments(
  eventId: string,
  segments: ConversationSegment[],
  analytics: DbLike,
  operational: DbLike,
): Promise<void> {
  if (segments.length === 0) return;

  // Write to both stores concurrently
  await Promise.all([
    storeSegmentsDuckDb(eventId, segments, analytics),
    storeSegmentsSqlite(eventId, segments, operational),
  ]);
}

/** Write segments to DuckDB event_segments table + events.segments JSON column. */
async function storeSegmentsDuckDb(
  eventId: string,
  segments: ConversationSegment[],
  db: DbLike,
): Promise<void> {
  // Clear existing segments for this event (idempotent)
  await db.exec("DELETE FROM event_segments WHERE event_id = $1", [eventId]);

  // Insert each segment as a typed row
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    await db.exec(
      `INSERT INTO event_segments (event_id, segment_index, segment_id, turn_start, turn_end, topic_label, summary, files_in_scope, modules_in_scope, segment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        eventId,
        i,
        seg.segmentId,
        seg.turnRange[0],
        seg.turnRange[1],
        seg.topicLabel,
        seg.summary,
        seg.filesInScope,
        seg.modulesInScope,
        seg.segmentMethod,
      ],
    );
  }

  // Update the events.segments JSON column for columnar access
  const segmentsJson = JSON.stringify(segments);
  await db.exec(
    "UPDATE events SET segments = $1::JSON WHERE id = $2",
    [segmentsJson, eventId],
  );
}

/** Write segments to SQLite event_segments table. */
async function storeSegmentsSqlite(
  eventId: string,
  segments: ConversationSegment[],
  db: DbLike,
): Promise<void> {
  // Clear existing (idempotent)
  db.run("DELETE FROM event_segments WHERE event_id = ?", [eventId]);

  // Insert each segment
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    db.run(
      `INSERT INTO event_segments (event_id, segment_index, segment_id, turn_start, turn_end, topic_label, summary, files_in_scope, modules_in_scope, segment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        i,
        seg.segmentId,
        seg.turnRange[0],
        seg.turnRange[1],
        seg.topicLabel,
        seg.summary,
        JSON.stringify(seg.filesInScope),
        JSON.stringify(seg.modulesInScope),
        seg.segmentMethod,
      ],
    );
  }
}

/**
 * Load segments for an event from SQLite.
 * Useful for operational lookups (e.g., "what segments does this event have?").
 */
export async function loadSegments(
  eventId: string,
  operational: DbLike,
): Promise<ConversationSegment[]> {
  const result = await operational.exec(
    `SELECT segment_id, turn_start, turn_end, topic_label, summary, files_in_scope, modules_in_scope, segment_method
     FROM event_segments WHERE event_id = ? ORDER BY segment_index`,
    [eventId],
  );

  const rows = result[0]?.values ?? [];
  return rows.map((row) => ({
    segmentId: row[0] as string,
    episodeId: eventId,
    turnRange: [row[1] as number, row[2] as number] as [number, number],
    topicLabel: (row[3] as string) || "",
    summary: (row[4] as string) || "",
    filesInScope: safeJsonArray(row[5]),
    modulesInScope: safeJsonArray(row[6]),
    segmentMethod: (row[7] as string as ConversationSegment["segmentMethod"]) || "structural",
  }));
}

/** Safely parse a JSON string array or return the value if already an array. */
function safeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

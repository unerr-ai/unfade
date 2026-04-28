// FILE: src/services/knowledge/extraction-tracker.ts
// DuckDB-backed extraction watermark — tracks which events have been processed
// by the knowledge extraction pipeline. Separate from the materializer cursor:
// events can be materialized into DuckDB but not yet extracted.

import type { DbLike } from "../cache/manager.js";

/** Status of a single event's extraction. */
export type ExtractionStatus = "pending" | "extracted" | "failed" | "deferred";

/** Shape of an unextracted event row returned by getUnextractedEvents. */
export interface UnextractedEvent {
  eventId: string;
  projectId: string;
  source: string;
  type: string;
  timestamp: string;
  retryCount: number;
}

/** Aggregate extraction pipeline stats. */
export interface ExtractionStats {
  total: number;
  extracted: number;
  pending: number;
  failed: number;
  deferred: number;
}

/** Maximum retry attempts before an event is permanently skipped. */
const MAX_RETRIES = 3;

/**
 * Get events that need extraction: either not yet tracked in extraction_status,
 * or failed with retry_count < MAX_RETRIES.
 *
 * Queries DuckDB events table LEFT JOINed against extraction_status.
 * Only returns ai-session events (source = 'ai-session') since those are
 * the conversation episodes that contain extractable knowledge.
 */
export async function getUnextractedEvents(
  analytics: DbLike,
  limit = 50,
  projectId?: string,
): Promise<UnextractedEvent[]> {
  const projectFilter = projectId ? "AND e.project_id = $2" : "";
  const params: unknown[] = [limit];
  if (projectId) params.push(projectId);

  const result = await analytics.exec(
    `
    SELECT e.id, e.project_id, e.source, e.type, e.ts,
           COALESCE(es.retry_count, 0) AS retry_count
    FROM events e
    LEFT JOIN extraction_status es ON e.id = es.event_id
    WHERE e.source = 'ai-session'
      AND (
        es.event_id IS NULL
        OR (es.status = 'failed' AND es.retry_count < ${MAX_RETRIES})
      )
      ${projectFilter}
    ORDER BY e.ts DESC
    LIMIT $1
    `,
    params,
  );

  const rows = result[0]?.values ?? [];
  return rows.map((row) => ({
    eventId: row[0] as string,
    projectId: row[1] as string,
    source: row[2] as string,
    type: row[3] as string,
    timestamp: String(row[4]),
    retryCount: (row[5] as number) ?? 0,
  }));
}

/**
 * Mark an event as successfully extracted.
 */
export async function markExtracted(analytics: DbLike, eventId: string, projectId = ""): Promise<void> {
  await analytics.exec(
    `
    INSERT INTO extraction_status (event_id, project_id, status, extracted_at, retry_count)
    VALUES ($1, $2, 'extracted', CURRENT_TIMESTAMP, 0)
    ON CONFLICT (event_id) DO UPDATE SET
      status = 'extracted',
      extracted_at = CURRENT_TIMESTAMP
    `,
    [eventId, projectId],
  );
}

/**
 * Mark an event extraction as failed, incrementing retry count.
 */
export async function markFailed(analytics: DbLike, eventId: string, error: string, projectId = ""): Promise<void> {
  await analytics.exec(
    `
    INSERT INTO extraction_status (event_id, project_id, status, retry_count, error)
    VALUES ($1, $2, 'failed', 1, $3)
    ON CONFLICT (event_id) DO UPDATE SET
      status = 'failed',
      retry_count = extraction_status.retry_count + 1,
      error = $3
    `,
    [eventId, projectId, error],
  );
}

/**
 * Mark an event as deferred — will not be retried until manually reset.
 * Used for events that can't be extracted (e.g., too short, no conversation content).
 */
export async function markDeferred(analytics: DbLike, eventId: string, projectId = ""): Promise<void> {
  await analytics.exec(
    `
    INSERT INTO extraction_status (event_id, project_id, status, retry_count)
    VALUES ($1, $2, 'deferred', 0)
    ON CONFLICT (event_id) DO UPDATE SET
      status = 'deferred'
    `,
    [eventId, projectId],
  );
}

/**
 * Get aggregate extraction pipeline statistics.
 */
export async function getExtractionStats(analytics: DbLike, projectId?: string): Promise<ExtractionStats> {
  const projectFilter = projectId ? "WHERE project_id = $1" : "";
  const params: unknown[] = projectId ? [projectId] : [];

  const result = await analytics.exec(
    `
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'extracted') AS extracted,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'deferred') AS deferred
    FROM extraction_status
    ${projectFilter}
    `,
    params,
  );

  const row = result[0]?.values[0];
  if (!row) {
    return { total: 0, extracted: 0, pending: 0, failed: 0, deferred: 0 };
  }

  return {
    total: (row[0] as number) ?? 0,
    extracted: (row[1] as number) ?? 0,
    pending: (row[2] as number) ?? 0,
    failed: (row[3] as number) ?? 0,
    deferred: (row[4] as number) ?? 0,
  };
}

/**
 * Reset failed events so they can be retried.
 * Useful after fixing a systemic extraction issue.
 */
export async function resetFailedEvents(analytics: DbLike, projectId?: string): Promise<number> {
  const projectFilter = projectId ? "AND project_id = $1" : "";
  const params: unknown[] = projectId ? [projectId] : [];

  const result = await analytics.exec(
    `
    UPDATE extraction_status
    SET status = 'pending', retry_count = 0, error = NULL
    WHERE status = 'failed'
    ${projectFilter}
    RETURNING event_id
    `,
    params,
  );

  return result[0]?.values.length ?? 0;
}

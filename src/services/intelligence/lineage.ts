// FILE: src/services/intelligence/lineage.ts
// Fix 15: Event-to-insight bidirectional index.
// Writes and reads from the event_insight_map SQLite table.

import type { DbLike } from "../cache/manager.js";

export interface InsightMapping {
  eventId: string;
  insightId: string;
  analyzer: string;
  contributionWeight: number;
  computedAt: string;
}

/**
 * Record that a set of events contributed to an insight.
 * Called by intelligence engine after each analyzer produces results.
 */
export function writeInsightMappings(
  db: DbLike,
  insightId: string,
  analyzer: string,
  eventIds: string[],
  weights?: number[],
): void {
  const now = new Date().toISOString();
  for (let i = 0; i < eventIds.length; i++) {
    const weight = weights?.[i] ?? 1.0;
    db.run(
      "INSERT OR REPLACE INTO event_insight_map (event_id, insight_id, analyzer, contribution_weight, computed_at) VALUES (?, ?, ?, ?, ?)",
      [eventIds[i], insightId, analyzer, weight, now],
    );
  }
}

/**
 * Forward query: given an event ID, find all insights it contributed to.
 */
export async function getInsightsForEvent(db: DbLike, eventId: string): Promise<InsightMapping[]> {
  const result = await db.exec(
    `SELECT event_id, insight_id, analyzer, contribution_weight, computed_at FROM event_insight_map WHERE event_id = '${eventId}'`,
  );
  if (!result[0] || result[0].values.length === 0) return [];

  return result[0].values.map((row) => ({
    eventId: row[0] as string,
    insightId: row[1] as string,
    analyzer: row[2] as string,
    contributionWeight: row[3] as number,
    computedAt: row[4] as string,
  }));
}

/**
 * Reverse query: given an insight ID, find all events that contributed to it.
 */
export async function getEventsForInsight(
  db: DbLike,
  insightId: string,
): Promise<InsightMapping[]> {
  const result = await db.exec(
    `SELECT event_id, insight_id, analyzer, contribution_weight, computed_at FROM event_insight_map WHERE insight_id = '${insightId}'`,
  );
  if (!result[0] || result[0].values.length === 0) return [];

  return result[0].values.map((row) => ({
    eventId: row[0] as string,
    insightId: row[1] as string,
    analyzer: row[2] as string,
    contributionWeight: row[3] as number,
    computedAt: row[4] as string,
  }));
}

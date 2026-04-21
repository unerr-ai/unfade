// FILE: src/services/intelligence/feature-boundary.ts
// Phase 11B.5: Streaming feature boundary detection.
// Groups events into features based on branch, file overlap, and temporal proximity.
// Runs in the materializer's onTick callback after new events are processed.

import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";

export interface Feature {
  id: string;
  name: string;
  branch: string | null;
  files: string[];
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  fileCount: number;
  sessionCount: number;
  status: "active" | "completed" | "stale";
}

interface EventForFeature {
  id: string;
  projectId: string;
  ts: string;
  metadata: Record<string, unknown>;
  gitBranch: string;
  contentSummary: string;
}

/**
 * Process new events and assign them to features.
 * Called after each materialization tick with newly added event IDs.
 */
export function assignEventsToFeatures(db: DbLike, newEventIds: string[]): void {
  if (newEventIds.length === 0) return;

  const activeFeatures = loadActiveFeatures(db);

  for (const eventId of newEventIds) {
    const event = loadEvent(db, eventId);
    if (!event) continue;

    const assignment = assignFeature(event, activeFeatures);

    if (assignment.isNew) {
      // Create new feature in DB
      const feature = createFeatureFromEvent(event, assignment.featureId);
      insertFeature(db, feature, event.projectId);
      activeFeatures.push(feature);
    } else {
      // Update existing feature
      updateFeatureWithEvent(db, assignment.featureId, event);
      const existing = activeFeatures.find((f) => f.id === assignment.featureId);
      if (existing) {
        existing.lastSeen = event.ts;
        existing.eventCount++;
      }
    }

    // Link event to feature
    db.run("INSERT OR IGNORE INTO event_features (event_id, feature_id) VALUES (?, ?)", [
      eventId,
      assignment.featureId,
    ]);
  }

  // Mark stale features (no activity in 7 days)
  markStaleFeatures(db);

  logger.debug("Feature assignment complete", {
    newEvents: newEventIds.length,
    activeFeatures: activeFeatures.length,
  });
}

/**
 * Link events that form continuations or are related.
 */
export function linkRelatedEvents(db: DbLike, newEventIds: string[]): void {
  if (newEventIds.length === 0) return;

  for (const eventId of newEventIds) {
    const event = loadEvent(db, eventId);
    if (!event) continue;

    const meta = event.metadata;
    const sessionId = meta?.session_id as string;

    // Session-based linking requires session_id
    if (sessionId) {
      // Find previous event in same session (continues_from)
      const prevResult = db.exec(
        `SELECT id FROM events WHERE json_extract(metadata, '$.session_id') = ? AND ts < ? ORDER BY ts DESC LIMIT 1`,
        [sessionId, event.ts],
      );
      if (prevResult[0]?.values.length > 0) {
        const prevId = prevResult[0].values[0][0] as string;
        if (prevId !== eventId) {
          db.run(
            "INSERT OR IGNORE INTO event_links (from_event, to_event, link_type, metadata) VALUES (?, ?, ?, ?)",
            [prevId, eventId, "continues_from", null],
          );
        }
      }
    }

    // Find git commit events within 5 minutes after this event (triggered_commit)
    const fiveMinLater = new Date(new Date(event.ts).getTime() + 5 * 60 * 1000).toISOString();
    const commitResult = db.exec(
      `SELECT id FROM events WHERE source = 'git' AND type = 'commit' AND ts > ? AND ts < ? ORDER BY ts ASC LIMIT 1`,
      [event.ts, fiveMinLater],
    );
    if (commitResult[0]?.values.length > 0) {
      const commitId = commitResult[0].values[0][0] as string;
      db.run(
        "INSERT OR IGNORE INTO event_links (from_event, to_event, link_type, metadata) VALUES (?, ?, ?, ?)",
        [eventId, commitId, "triggered_commit", null],
      );
    }

    // Find events touching same files within 1 hour (related_events)
    const eventFiles = getEventFiles(event);
    if (eventFiles.length > 0) {
      const oneHourAgo = new Date(new Date(event.ts).getTime() - 3600 * 1000).toISOString();
      const nearbyResult = db.exec(
        `SELECT id, metadata FROM events WHERE ts > ? AND ts < ? AND id != ? LIMIT 50`,
        [oneHourAgo, event.ts, eventId],
      );
      for (const row of nearbyResult[0]?.values ?? []) {
        const otherId = row[0] as string;
        const otherMeta =
          typeof row[1] === "string"
            ? JSON.parse(row[1])
            : ((row[1] as Record<string, unknown>) ?? {});
        const otherFiles = [
          ...((otherMeta?.files_referenced as string[]) ?? []),
          ...((otherMeta?.files_modified as string[]) ?? []),
        ];
        const overlap = eventFiles.filter((f) => otherFiles.includes(f)).length;
        if (overlap > 0) {
          db.run(
            "INSERT OR IGNORE INTO event_links (from_event, to_event, link_type, metadata) VALUES (?, ?, ?, ?)",
            [otherId, eventId, "related_events", JSON.stringify({ sharedFiles: overlap })],
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assignFeature(
  event: EventForFeature,
  activeFeatures: Feature[],
): { featureId: string; isNew: boolean } {
  const eventBranch =
    event.gitBranch ||
    ((event.metadata?.feature_signals as Record<string, unknown>)?.branch as string) ||
    "";
  const eventFiles = getEventFiles(event);
  const eventTime = new Date(event.ts).getTime();

  // Strategy 1: Branch match (strongest signal)
  if (
    eventBranch &&
    eventBranch !== "main" &&
    eventBranch !== "master" &&
    eventBranch !== "develop"
  ) {
    const branchFeature = activeFeatures.find(
      (f) => f.branch === eventBranch && f.status === "active",
    );
    if (branchFeature) {
      return { featureId: branchFeature.id, isNew: false };
    }
    // New feature from branch
    const featureId = `feat-${eventBranch}-${Date.now().toString(36)}`;
    return { featureId, isNew: true };
  }

  // Strategy 2: File cluster overlap (Jaccard > 0.4 AND temporal proximity < 4h)
  if (eventFiles.length > 0) {
    for (const feature of activeFeatures) {
      if (feature.status !== "active") continue;
      const featureFiles = new Set(feature.files);
      const overlap = eventFiles.filter((f) => featureFiles.has(f)).length;
      const union = new Set([...eventFiles, ...feature.files]).size;
      const jaccard = union > 0 ? overlap / union : 0;
      const timeDelta = eventTime - new Date(feature.lastSeen).getTime();

      if (jaccard > 0.4 && timeDelta < 4 * 3600 * 1000) {
        return { featureId: feature.id, isNew: false };
      }
    }
  }

  // Strategy 3: Temporal proximity to most recent active feature (< 2h)
  const recentFeature = activeFeatures
    .filter(
      (f) => f.status === "active" && eventTime - new Date(f.lastSeen).getTime() < 2 * 3600 * 1000,
    )
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())[0];

  if (recentFeature) {
    return { featureId: recentFeature.id, isNew: false };
  }

  // No match — new unnamed feature
  const featureId = `feat-unnamed-${Date.now().toString(36)}`;
  return { featureId, isNew: true };
}

function createFeatureFromEvent(event: EventForFeature, featureId: string): Feature {
  const branch =
    event.gitBranch ||
    ((event.metadata?.feature_signals as Record<string, unknown>)?.branch as string) ||
    null;

  let summaryForName = event.contentSummary;
  if (summaryForName.startsWith("This session is being continued from a previous conversation")) {
    summaryForName = summaryForName.replace(
      /^This session is being continued from a previous conversation[^.]*\.\s*/,
      "",
    );
    if (!summaryForName || summaryForName.length < 5) {
      summaryForName = "Continuation session";
    }
  }

  const name = branch
    ? branch.replace(/^(feat|fix|feature|bugfix)\//, "")
    : summaryForName.slice(0, 60) || "Unnamed feature";

  return {
    id: featureId,
    name,
    branch,
    files: getEventFiles(event),
    firstSeen: event.ts,
    lastSeen: event.ts,
    eventCount: 1,
    fileCount: getEventFiles(event).length,
    sessionCount: 1,
    status: "active",
  };
}

function getEventFiles(event: EventForFeature): string[] {
  const meta = event.metadata;
  const refs = (meta?.files_referenced as string[]) ?? [];
  const mods = (meta?.files_modified as string[]) ?? [];
  const cluster =
    ((meta?.feature_signals as Record<string, unknown>)?.file_cluster as string[]) ?? [];
  const allFiles = new Set([...refs, ...mods, ...cluster]);
  return [...allFiles];
}

function loadActiveFeatures(db: DbLike): Feature[] {
  try {
    const result = db.exec(
      "SELECT id, name, branch, first_seen, last_seen, event_count, file_count, session_count, status FROM features WHERE status = 'active' ORDER BY last_seen DESC LIMIT 50",
    );
    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      name: row[1] as string,
      branch: row[2] as string | null,
      files: loadFeatureFiles(db, row[0] as string),
      firstSeen: row[3] as string,
      lastSeen: row[4] as string,
      eventCount: row[5] as number,
      fileCount: row[6] as number,
      sessionCount: row[7] as number,
      status: row[8] as "active" | "completed" | "stale",
    }));
  } catch {
    return [];
  }
}

function loadFeatureFiles(db: DbLike, featureId: string): string[] {
  try {
    // Get files from events linked to this feature
    const result = db.exec(
      `SELECT DISTINCT json_extract(e.metadata, '$.files_modified') FROM events e JOIN event_features ef ON e.id = ef.event_id WHERE ef.feature_id = ? LIMIT 20`,
      [featureId],
    );
    const files = new Set<string>();
    for (const row of result[0]?.values ?? []) {
      try {
        const parsed = JSON.parse(row[0] as string);
        if (Array.isArray(parsed)) {
          for (const f of parsed) files.add(f);
        }
      } catch {
        // skip
      }
    }
    return [...files];
  } catch {
    return [];
  }
}

function loadEvent(db: DbLike, eventId: string): EventForFeature | null {
  try {
    const result = db.exec(
      `SELECT id, project_id, ts, metadata, git_branch, content_summary FROM events WHERE id = ?`,
      [eventId],
    );
    if (!result[0]?.values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0] as string,
      projectId: (row[1] as string) ?? "",
      ts: row[2] as string,
      metadata:
        typeof row[3] === "string"
          ? JSON.parse(row[3])
          : ((row[3] as Record<string, unknown>) ?? {}),
      gitBranch: row[4] as string,
      contentSummary: row[5] as string,
    };
  } catch {
    return null;
  }
}

function insertFeature(db: DbLike, feature: Feature, projectId: string = ""): void {
  db.run(
    `INSERT OR REPLACE INTO features (id, project_id, name, branch, first_seen, last_seen, event_count, file_count, session_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      feature.id,
      projectId,
      feature.name,
      feature.branch,
      feature.firstSeen,
      feature.lastSeen,
      feature.eventCount,
      feature.fileCount,
      feature.sessionCount,
      feature.status,
    ],
  );
}

function updateFeatureWithEvent(db: DbLike, featureId: string, event: EventForFeature): void {
  const newFiles = getEventFiles(event);
  db.run(
    `UPDATE features SET last_seen = ?, event_count = event_count + 1, file_count = MAX(file_count, ?) WHERE id = ?`,
    [event.ts, newFiles.length, featureId],
  );
}

function markStaleFeatures(db: DbLike): void {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  db.run(`UPDATE features SET status = 'stale' WHERE status = 'active' AND last_seen < ?`, [
    sevenDaysAgo,
  ]);
}

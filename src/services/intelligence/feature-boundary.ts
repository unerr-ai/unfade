// FILE: src/services/intelligence/feature-boundary.ts
// Phase 11B.5: Streaming feature boundary detection.
// Groups events into features based on branch, file overlap, and temporal proximity.
// Runs in the materializer's onTick callback after new events are processed.

import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";
import { getWorkerPool } from "../workers/pool.js";

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
 * Batch-loads events to avoid N+1 query pattern.
 */
export async function assignEventsToFeatures(db: DbLike, newEventIds: string[]): Promise<void> {
  if (newEventIds.length === 0) return;

  const startMs = Date.now();
  const startMem = process.memoryUsage();
  logger.info(`[feature-boundary] Starting feature assignment for ${newEventIds.length} events`, {
    heapUsedMB: Math.round(startMem.heapUsed / 1024 / 1024),
    rssMB: Math.round(startMem.rss / 1024 / 1024),
  });

  const activeFeatures = await loadActiveFeatures(db);
  const pool = getWorkerPool();

  // Batch-load all events in one query instead of per-event queries
  const events = await loadEventsBatch(db, newEventIds);
  logger.info(`[feature-boundary] Loaded ${events.length}/${newEventIds.length} events in batch`, {
    elapsedMs: Date.now() - startMs,
  });

  const newFeatures: Array<{
    id: string;
    projectId: string;
    name: string;
    branch: string | null;
    firstSeen: string;
    lastSeen: string;
    eventCount: number;
    fileCount: number;
    sessionCount: number;
    status: string;
  }> = [];
  const featureUpdates: Array<{ featureId: string; lastSeen: string }> = [];
  const eventFeatureLinks: Array<{ eventId: string; featureId: string }> = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    const assignment = assignFeature(event, activeFeatures);

    if (assignment.isNew) {
      const feature = createFeatureFromEvent(event, assignment.featureId);
      newFeatures.push({
        id: feature.id,
        projectId: event.projectId,
        name: feature.name,
        branch: feature.branch,
        firstSeen: feature.firstSeen,
        lastSeen: feature.lastSeen,
        eventCount: feature.eventCount,
        fileCount: feature.fileCount,
        sessionCount: feature.sessionCount,
        status: feature.status,
      });
      activeFeatures.push(feature);
    } else {
      featureUpdates.push({ featureId: assignment.featureId, lastSeen: event.ts });
      const existing = activeFeatures.find((f) => f.id === assignment.featureId);
      if (existing) {
        existing.lastSeen = event.ts;
        existing.eventCount++;
      }
    }

    eventFeatureLinks.push({ eventId: event.id, featureId: assignment.featureId });

    // Yield every 200 events to prevent event loop starvation
    if (i > 0 && i % 200 === 0) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  // Dispatch batched writes to worker thread (non-blocking)
  if (newFeatures.length > 0 || featureUpdates.length > 0) {
    await pool.upsertFeatures({ features: newFeatures, updates: featureUpdates });
  }
  if (eventFeatureLinks.length > 0) {
    await pool.insertEventFeatures(eventFeatureLinks);
  }

  // Mark stale features (no activity in 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  await pool.markStaleFeatures(sevenDaysAgo);

  const endMem = process.memoryUsage();
  logger.info(`[feature-boundary] Feature assignment complete`, {
    newEvents: newEventIds.length,
    processed: events.length,
    newFeatures: newFeatures.length,
    activeFeatures: activeFeatures.length,
    elapsedMs: Date.now() - startMs,
    heapUsedMB: Math.round(endMem.heapUsed / 1024 / 1024),
    rssMB: Math.round(endMem.rss / 1024 / 1024),
  });
}

/**
 * Link events that form continuations or are related.
 * Uses batch loading and caps per-tick work to prevent event loop starvation.
 */
export async function linkRelatedEvents(db: DbLike, newEventIds: string[]): Promise<void> {
  if (newEventIds.length === 0) return;

  const startMs = Date.now();
  const startMem = process.memoryUsage();
  logger.info(`[event-linking] Starting link analysis for ${newEventIds.length} events`, {
    heapUsedMB: Math.round(startMem.heapUsed / 1024 / 1024),
    rssMB: Math.round(startMem.rss / 1024 / 1024),
  });

  // Cap per-tick work to prevent long blocking
  const MAX_LINK_PER_TICK = 500;
  const idsToProcess = newEventIds.slice(0, MAX_LINK_PER_TICK);
  if (newEventIds.length > MAX_LINK_PER_TICK) {
    logger.info(
      `[event-linking] Capping to ${MAX_LINK_PER_TICK}/${newEventIds.length} events (will catch up on next tick)`,
    );
  }

  // Batch-load all events
  const events = await loadEventsBatch(db, idsToProcess);

  const links: Array<{
    fromEvent: string;
    toEvent: string;
    linkType: string;
    metadata: string | null;
  }> = [];

  // Build session groups in-memory to avoid per-event session queries
  const sessionGroups = new Map<string, Array<{ id: string; ts: string }>>();
  for (const event of events) {
    const sessionId = event.metadata?.session_id as string;
    if (sessionId) {
      if (!sessionGroups.has(sessionId)) sessionGroups.set(sessionId, []);
      sessionGroups.get(sessionId)!.push({ id: event.id, ts: event.ts });
    }
  }
  // Sort each session group by timestamp for continuation linking
  for (const group of sessionGroups.values()) {
    group.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  // Session continuation links (in-memory, no DB queries)
  for (const group of sessionGroups.values()) {
    for (let i = 1; i < group.length; i++) {
      links.push({
        fromEvent: group[i - 1].id,
        toEvent: group[i].id,
        linkType: "continues_from",
        metadata: null,
      });
    }
  }

  logger.info(`[event-linking] Session continuation links: ${links.length}`, {
    sessions: sessionGroups.size,
    elapsedMs: Date.now() - startMs,
  });

  // Skip expensive per-event queries (commit search, file overlap) for large batches.
  // These will be caught up incrementally on subsequent ticks with smaller batches.
  if (idsToProcess.length <= 100) {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Find git commit events within 5 minutes after this event
      const fiveMinLater = new Date(new Date(event.ts).getTime() + 5 * 60 * 1000).toISOString();
      const commitResult = await db.exec(
        `SELECT id FROM events WHERE source = 'git' AND type = 'commit' AND ts > ? AND ts < ? ORDER BY ts ASC LIMIT 1`,
        [event.ts, fiveMinLater],
      );
      if (commitResult[0]?.values.length > 0) {
        links.push({
          fromEvent: event.id,
          toEvent: commitResult[0].values[0][0] as string,
          linkType: "triggered_commit",
          metadata: null,
        });
      }

      // Find events touching same files within 1 hour
      const eventFiles = getEventFiles(event);
      if (eventFiles.length > 0) {
        const oneHourAgo = new Date(new Date(event.ts).getTime() - 3600 * 1000).toISOString();
        const nearbyResult = await db.exec(
          `SELECT id, metadata FROM events WHERE ts > ? AND ts < ? AND id != ? LIMIT 50`,
          [oneHourAgo, event.ts, event.id],
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
            links.push({
              fromEvent: otherId,
              toEvent: event.id,
              linkType: "related_events",
              metadata: JSON.stringify({ sharedFiles: overlap }),
            });
          }
        }
      }

      // Yield every 50 events
      if (i > 0 && i % 50 === 0) {
        await new Promise<void>((r) => setImmediate(r));
      }
    }
  }

  // Dispatch batched writes to worker thread
  if (links.length > 0) {
    await getWorkerPool().insertEventLinks(links);
  }

  const endMem = process.memoryUsage();
  logger.info(`[event-linking] Linking complete`, {
    eventsProcessed: idsToProcess.length,
    totalLinks: links.length,
    elapsedMs: Date.now() - startMs,
    heapUsedMB: Math.round(endMem.heapUsed / 1024 / 1024),
    rssMB: Math.round(endMem.rss / 1024 / 1024),
  });
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

async function loadActiveFeatures(db: DbLike): Promise<Feature[]> {
  try {
    const result = await db.exec(
      "SELECT id, name, branch, first_seen, last_seen, event_count, file_count, session_count, status FROM features WHERE status = 'active' ORDER BY last_seen DESC LIMIT 50",
    );
    if (!result[0]?.values.length) return [];

    return Promise.all(
      result[0].values.map(async (row) => ({
        id: row[0] as string,
        name: row[1] as string,
        branch: row[2] as string | null,
        files: await loadFeatureFiles(db, row[0] as string),
        firstSeen: row[3] as string,
        lastSeen: row[4] as string,
        eventCount: row[5] as number,
        fileCount: row[6] as number,
        sessionCount: row[7] as number,
        status: row[8] as "active" | "completed" | "stale",
      })),
    );
  } catch {
    return [];
  }
}

async function loadFeatureFiles(db: DbLike, featureId: string): Promise<string[]> {
  try {
    // Get files from events linked to this feature
    const result = await db.exec(
      `SELECT DISTINCT json_extract(e.metadata, '$.files_modified') as files_modified FROM events e JOIN event_features ef ON e.id = ef.event_id WHERE ef.feature_id = ? LIMIT 20`,
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

async function loadEvent(db: DbLike, eventId: string): Promise<EventForFeature | null> {
  try {
    const result = await db.exec(
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

/**
 * Batch-load events by ID list. Uses chunked IN queries instead of per-event lookups.
 * Reduces N queries to ceil(N/100) queries.
 */
async function loadEventsBatch(db: DbLike, eventIds: string[]): Promise<EventForFeature[]> {
  const events: EventForFeature[] = [];
  const CHUNK_SIZE = 100;

  for (let i = 0; i < eventIds.length; i += CHUNK_SIZE) {
    const chunk = eventIds.slice(i, i + CHUNK_SIZE);
    try {
      const placeholders = chunk.map(() => "?").join(",");
      const result = await db.exec(
        `SELECT id, project_id, ts, metadata, git_branch, content_summary FROM events WHERE id IN (${placeholders})`,
        chunk,
      );
      for (const row of result[0]?.values ?? []) {
        events.push({
          id: row[0] as string,
          projectId: (row[1] as string) ?? "",
          ts: row[2] as string,
          metadata:
            typeof row[3] === "string"
              ? JSON.parse(row[3])
              : ((row[3] as Record<string, unknown>) ?? {}),
          gitBranch: row[4] as string,
          contentSummary: row[5] as string,
        });
      }
    } catch {
      // Fall back to individual loads for this chunk
      for (const id of chunk) {
        const event = await loadEvent(db, id);
        if (event) events.push(event);
      }
    }

    // Yield between chunks
    if (i + CHUNK_SIZE < eventIds.length) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return events;
}

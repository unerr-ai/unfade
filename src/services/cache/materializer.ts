// FILE: src/services/cache/materializer.ts
// UF-210: Incremental + rebuild materialization for the SQLite cache.
// Incremental mode tail-reads JSONL past cursor byte_offset. Rebuild mode does full DELETE+replay.
// Both modes produce identical DB state — rebuild is the repair path.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getEventsDir, getGraphDir, getMetricsDir } from "../../utils/paths.js";
import {
  hashLine,
  isCursorValid,
  loadCursor,
  type MaterializerCursor,
  readEpochFile,
  saveCursor,
} from "./cursor.js";
import type { CacheManager } from "./manager.js";

type DbLike = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Incremental materialization: only process new lines past the cursor.
 * Returns the number of new rows upserted.
 */
export async function materializeIncremental(cache: CacheManager, cwd?: string): Promise<number> {
  const db = await cache.getDb();
  if (!db) return 0;

  const cursor = loadCursor(cwd);
  let totalNew = 0;

  totalNew += materializeEventsIncremental(db, cursor, cwd);
  totalNew += materializeDecisionsIncremental(db, cursor, cwd);
  totalNew += materializeMetricsIncremental(db, cursor, cwd);

  saveCursor(cursor, cwd);
  await cache.save();

  if (totalNew > 0) {
    logger.debug("Incremental materialization complete", { newRows: totalNew });
  }

  return totalNew;
}

/**
 * Full rebuild: DELETE all rows and replay from JSONL source of truth.
 * Resets cursor. Used for repair or first-time population.
 */
export async function rebuildAll(cache: CacheManager, cwd?: string): Promise<number> {
  const db = await cache.getDb();
  if (!db) return 0;

  let totalRows = 0;

  totalRows += rebuildEvents(db, cwd);
  totalRows += rebuildDecisions(db, cwd);
  totalRows += rebuildMetrics(db, cwd);

  const cursor: MaterializerCursor = { schemaVersion: 1, streams: {} };
  buildCursorFromCurrentState(cursor, cwd);
  saveCursor(cursor, cwd);

  await cache.save();
  logger.debug("Full rebuild materialization complete", { totalRows });
  return totalRows;
}

// ---------------------------------------------------------------------------
// Incremental event materialization
// ---------------------------------------------------------------------------

function materializeEventsIncremental(
  db: DbLike,
  cursor: MaterializerCursor,
  cwd?: string,
): number {
  const eventsDir = getEventsDir(cwd);
  if (!existsSync(eventsDir)) return 0;

  // Check for ingest lock — defer materialization while Go daemon is writing
  const lockPath = join(eventsDir, ".ingest.lock");
  if (existsSync(lockPath)) {
    logger.debug("Ingest lock present — deferring materialization");
    return 0;
  }

  const files = readdirSync(eventsDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();

  let totalNew = 0;

  for (const file of files) {
    const filePath = join(eventsDir, file);
    const streamKey = `events/${file}`;
    const streamCursor = cursor.streams[streamKey];

    let startOffset = streamCursor?.byteOffset ?? 0;

    // Per-file rebuild: if cursor is invalid, reset this file only
    if (streamCursor && !isCursorValid(streamCursor, filePath)) {
      logger.info("Cursor invalid for file, rebuilding file-only", { file });
      delete cursor.streams[streamKey];
      startOffset = 0;
    }

    // 11A.5: Staleness detection — if cursor is far behind current file size, warn and reprocess
    if (streamCursor && startOffset > 0) {
      const currentSize = statSync(filePath).size;
      if (
        streamCursor.fileSize &&
        streamCursor.fileSize > 0 &&
        currentSize > streamCursor.fileSize * 2
      ) {
        logger.info("Cursor stale — file grew significantly since last tick, reprocessing", {
          file,
          cursorSize: streamCursor.fileSize,
          currentSize,
        });
        delete cursor.streams[streamKey];
        startOffset = 0;
      }
    }

    const content = readFileSync(filePath, "utf-8");

    if (content.length <= startOffset) continue;

    const newContent = content.slice(startOffset);
    const lines = newContent.split("\n");
    let lastValidLine = "";
    let bytesProcessed = startOffset;
    const endsWithNewline = newContent.endsWith("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLastSegment = i === lines.length - 1;
      const newlineSize = isLastSegment && !endsWithNewline ? 0 : 1;
      const rawLineLength = Buffer.byteLength(line, "utf-8") + newlineSize;
      const trimmed = line.trim();
      if (!trimmed) {
        bytesProcessed += rawLineLength;
        continue;
      }

      try {
        const event = JSON.parse(trimmed);
        upsertEvent(db, event);
        lastValidLine = trimmed;
        totalNew++;
      } catch {
        // partial line — stop here, don't advance cursor past it
      }

      bytesProcessed += rawLineLength;
    }

    cursor.streams[streamKey] = {
      file: filePath,
      byteOffset: bytesProcessed,
      lastLineHash: lastValidLine ? hashLine(lastValidLine) : (streamCursor?.lastLineHash ?? ""),
      epoch: readEpochFile(filePath) ?? undefined,
      fileSize: statSync(filePath).size,
    };
  }

  if (totalNew > 0) {
    refreshFts(db);
  }

  return totalNew;
}

function materializeDecisionsIncremental(
  db: DbLike,
  cursor: MaterializerCursor,
  cwd?: string,
): number {
  const graphDir = getGraphDir(cwd);
  const filePath = join(graphDir, "decisions.jsonl");
  if (!existsSync(filePath)) return 0;

  const streamKey = "graph/decisions.jsonl";
  const streamCursor = cursor.streams[streamKey];
  const startOffset = streamCursor?.byteOffset ?? 0;
  const content = readFileSync(filePath, "utf-8");

  if (content.length <= startOffset) return 0;

  const newContent = content.slice(startOffset);
  const lines = newContent.split("\n");
  let count = 0;
  let lastValidLine = "";
  let bytesProcessed = startOffset;

  const existingCount = getDecisionCount(db);

  for (const line of lines) {
    const rawLineLength = Buffer.byteLength(line, "utf-8") + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      bytesProcessed += rawLineLength;
      continue;
    }

    try {
      const dec = JSON.parse(trimmed);
      const id = `${dec.date}-${existingCount + count}`;
      upsertDecision(db, dec, id);
      lastValidLine = trimmed;
      count++;
    } catch {
      // skip malformed
    }

    bytesProcessed += rawLineLength;
  }

  cursor.streams[streamKey] = {
    file: filePath,
    byteOffset: bytesProcessed,
    lastLineHash: lastValidLine ? hashLine(lastValidLine) : (streamCursor?.lastLineHash ?? ""),
  };

  return count;
}

function materializeMetricsIncremental(
  db: DbLike,
  cursor: MaterializerCursor,
  cwd?: string,
): number {
  const metricsDir = getMetricsDir(cwd);
  const filePath = join(metricsDir, "daily.jsonl");
  if (!existsSync(filePath)) return 0;

  const streamKey = "metrics/daily.jsonl";
  const streamCursor = cursor.streams[streamKey];
  const startOffset = streamCursor?.byteOffset ?? 0;
  const content = readFileSync(filePath, "utf-8");

  if (content.length <= startOffset) return 0;

  const newContent = content.slice(startOffset);
  const lines = newContent.split("\n");
  let count = 0;
  let lastValidLine = "";
  let bytesProcessed = startOffset;

  for (const line of lines) {
    const rawLineLength = Buffer.byteLength(line, "utf-8") + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      bytesProcessed += rawLineLength;
      continue;
    }

    try {
      const snap = JSON.parse(trimmed);
      upsertMetricSnapshot(db, snap);
      lastValidLine = trimmed;
      count++;
    } catch {
      // skip malformed
    }

    bytesProcessed += rawLineLength;
  }

  cursor.streams[streamKey] = {
    file: filePath,
    byteOffset: bytesProcessed,
    lastLineHash: lastValidLine ? hashLine(lastValidLine) : (streamCursor?.lastLineHash ?? ""),
  };

  return count;
}

// ---------------------------------------------------------------------------
// Full rebuild helpers
// ---------------------------------------------------------------------------

function rebuildEvents(db: DbLike, cwd?: string): number {
  const eventsDir = getEventsDir(cwd);
  if (!existsSync(eventsDir)) return 0;

  db.run("DELETE FROM events");
  let count = 0;
  const files = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));

  for (const file of files) {
    const content = readFileSync(join(eventsDir, file), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        upsertEvent(db, JSON.parse(trimmed));
        count++;
      } catch {
        // skip malformed
      }
    }
  }

  refreshFts(db);
  return count;
}

function rebuildDecisions(db: DbLike, cwd?: string): number {
  const graphDir = getGraphDir(cwd);
  const decisionsPath = join(graphDir, "decisions.jsonl");
  if (!existsSync(decisionsPath)) return 0;

  db.run("DELETE FROM decisions");
  let count = 0;
  const content = readFileSync(decisionsPath, "utf-8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const dec = JSON.parse(trimmed);
      upsertDecision(db, dec, `${dec.date}-${count}`);
      count++;
    } catch {
      // skip malformed
    }
  }

  return count;
}

function rebuildMetrics(db: DbLike, cwd?: string): number {
  const metricsDir = getMetricsDir(cwd);
  const snapshotPath = join(metricsDir, "daily.jsonl");
  if (!existsSync(snapshotPath)) return 0;

  db.run("DELETE FROM metric_snapshots");
  let count = 0;
  const content = readFileSync(snapshotPath, "utf-8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      upsertMetricSnapshot(db, JSON.parse(trimmed));
      count++;
    } catch {
      // skip malformed
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Shared upsert helpers
// ---------------------------------------------------------------------------

function upsertEvent(db: DbLike, event: Record<string, unknown>): void {
  db.run(
    `INSERT OR REPLACE INTO events (id, ts, source, type, content_summary, content_detail, git_repo, git_branch, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.timestamp,
      event.source,
      event.type,
      (event.content as Record<string, unknown>)?.summary ?? "",
      (event.content as Record<string, unknown>)?.detail ?? "",
      (event.gitContext as Record<string, unknown>)?.repo ?? "",
      (event.gitContext as Record<string, unknown>)?.branch ?? "",
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}

function upsertDecision(db: DbLike, dec: Record<string, unknown>, id: string): void {
  db.run(
    `INSERT OR REPLACE INTO decisions (id, date, domain, description, rationale, alternatives_count, hds, direction_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      dec.date,
      dec.domain ?? "",
      dec.decision ?? "",
      dec.rationale ?? "",
      dec.alternativesConsidered ?? 0,
      dec.humanDirectionScore ?? null,
      dec.directionClassification ?? null,
    ],
  );
}

function upsertMetricSnapshot(db: DbLike, snap: Record<string, unknown>): void {
  db.run(
    `INSERT OR REPLACE INTO metric_snapshots (date, rdi, dcs, aq, cwi, api_score, decisions_count, labels)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snap.date,
      snap.rdi,
      snap.dcs,
      snap.aq,
      snap.cwi,
      snap.apiScore,
      snap.decisionsCount ?? 0,
      JSON.stringify(snap.identityLabels ?? []),
    ],
  );
}

function refreshFts(db: DbLike): void {
  try {
    db.run("DELETE FROM events_fts");
    db.run(
      "INSERT INTO events_fts (content_summary, content_detail) SELECT content_summary, content_detail FROM events",
    );
  } catch {
    // FTS5 might not be available
  }
}

function getDecisionCount(db: DbLike): number {
  try {
    const result = db.exec("SELECT COUNT(*) FROM decisions");
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  } catch {
    return 0;
  }
}

function buildCursorFromCurrentState(cursor: MaterializerCursor, cwd?: string): void {
  const eventsDir = getEventsDir(cwd);
  if (existsSync(eventsDir)) {
    for (const file of readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"))) {
      const filePath = join(eventsDir, file);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      let lastNonEmpty = "";
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) {
          lastNonEmpty = lines[i].trim();
          break;
        }
      }
      cursor.streams[`events/${file}`] = {
        file: filePath,
        byteOffset: Buffer.byteLength(content, "utf-8"),
        lastLineHash: lastNonEmpty ? hashLine(lastNonEmpty) : "",
        epoch: readEpochFile(filePath) ?? undefined,
        fileSize: statSync(filePath).size,
      };
    }
  }

  const decisionsPath = join(getGraphDir(cwd), "decisions.jsonl");
  if (existsSync(decisionsPath)) {
    const content = readFileSync(decisionsPath, "utf-8");
    const lines = content.split("\n");
    let lastNonEmpty = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        lastNonEmpty = lines[i].trim();
        break;
      }
    }
    cursor.streams["graph/decisions.jsonl"] = {
      file: decisionsPath,
      byteOffset: Buffer.byteLength(content, "utf-8"),
      lastLineHash: lastNonEmpty ? hashLine(lastNonEmpty) : "",
      epoch: readEpochFile(decisionsPath) ?? undefined,
      fileSize: statSync(decisionsPath).size,
    };
  }

  const metricsPath = join(getMetricsDir(cwd), "daily.jsonl");
  if (existsSync(metricsPath)) {
    const content = readFileSync(metricsPath, "utf-8");
    const lines = content.split("\n");
    let lastNonEmpty = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        lastNonEmpty = lines[i].trim();
        break;
      }
    }
    cursor.streams["metrics/daily.jsonl"] = {
      file: metricsPath,
      byteOffset: Buffer.byteLength(content, "utf-8"),
      lastLineHash: lastNonEmpty ? hashLine(lastNonEmpty) : "",
      epoch: readEpochFile(metricsPath) ?? undefined,
      fileSize: statSync(metricsPath).size,
    };
  }
}

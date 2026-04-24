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
import { KNOWN_METADATA_FIELDS } from "./duckdb-schema.js";
import type { CacheManager, DbLike } from "./manager.js";

// DuckDB node-api requires DuckDBListValue for VARCHAR[] columns —
// plain JS arrays hit the ANY type fallback and silently fail.
let _listValue: ((items: readonly unknown[]) => unknown) | null = null;
async function getDuckListValue(): Promise<(items: readonly unknown[]) => unknown> {
  if (!_listValue) {
    const { listValue } = await import("@duckdb/node-api");
    _listValue = listValue as (items: readonly unknown[]) => unknown;
  }
  return _listValue;
}

/** Wrap a JS string[] into a DuckDBListValue. Returns null for empty arrays. */
function toDuckList(arr: string[]): unknown {
  if (!_listValue) return arr; // fallback — will be set before first use
  return arr.length > 0 ? _listValue(arr) : _listValue([]);
}

// ---------------------------------------------------------------------------
// JSONL byte-counting helper
// ---------------------------------------------------------------------------
//
// ISSUE: String.split("\n") on content ending with "\n" produces a trailing
// empty string element (phantom line). For example:
//
//   "line1\nline2\n".split("\n") → ["line1", "line2", ""]
//
// If the loop counts this phantom element as having a newline byte (+1),
// the cursor's byteOffset ends up 1 byte past the actual file size.
// On the next tick, isCursorValid() sees contentBytes < cursor.byteOffset,
// returns false, and triggers a full file rebuild — every tick, forever.
//
// This function clamps bytesProcessed to never exceed the actual byte length
// of the content being processed. It also logs a warning if the clamp fires,
// which means a byte-counting bug exists upstream that should be investigated.
// ---------------------------------------------------------------------------

function clampBytesProcessed(bytesProcessed: number, fullContent: string, file: string): number {
  const actualBytes = Buffer.byteLength(fullContent, "utf-8");
  if (bytesProcessed > actualBytes) {
    logger.warn("Cursor byte overshoot detected and clamped — off-by-one guard fired", {
      file,
      computed: bytesProcessed,
      actual: actualBytes,
      overshoot: bytesProcessed - actualBytes,
    });
    return actualBytes;
  }
  return bytesProcessed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Incremental materialization: only process new lines past the cursor.
 * Writes to both SQLite (operational) and DuckDB (analytical).
 * Returns the number of new rows upserted.
 */
export async function materializeIncremental(cache: CacheManager, cwd?: string): Promise<number> {
  const db = await cache.getDb();
  if (!db) return 0;

  const duckDb = cache.analytics;
  if (duckDb) await getDuckListValue(); // ensure DuckDBListValue wrapper is ready

  const cursor = loadCursor(cwd);
  let totalNew = 0;

  totalNew += await materializeEventsIncremental(db, duckDb, cursor, cwd);
  totalNew += await materializeDecisionsIncremental(db, duckDb, cursor, cwd);
  totalNew += materializeMetricsIncremental(db, duckDb, cursor, cwd);

  await cache.flushDuckDb();

  saveCursor(cursor, cwd);
  await cache.save();

  if (totalNew > 0) {
    logger.debug("Incremental materialization complete", { newRows: totalNew });
  }

  return totalNew;
}

/**
 * Full rebuild: DELETE all rows and replay from JSONL source of truth.
 * Rebuilds both SQLite and DuckDB. Resets cursor.
 */
export async function rebuildAll(cache: CacheManager, cwd?: string): Promise<number> {
  const db = await cache.getDb();
  if (!db) return 0;

  const duckDb = cache.analytics;
  if (duckDb) await getDuckListValue(); // ensure DuckDBListValue wrapper is ready

  await cache.resetDuckDbSchema();

  let totalRows = 0;

  totalRows += rebuildEvents(db, duckDb, cwd);
  totalRows += rebuildDecisions(db, duckDb, cwd);
  totalRows += rebuildMetrics(db, duckDb, cwd);

  await cache.flushDuckDb();

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

async function materializeEventsIncremental(
  db: DbLike,
  duckDb: DbLike | null,
  cursor: MaterializerCursor,
  cwd?: string,
): Promise<number> {
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
      logger.debug("Cursor invalid for file, rebuilding file-only", { file });
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
        logger.debug("Cursor stale — file grew significantly since last tick, reprocessing", {
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

      // PHANTOM TRAILING ELEMENT GUARD
      // When content ends with "\n", split("\n") produces a trailing "".
      // This phantom has no corresponding byte in the file — skip it entirely
      // to prevent byteOffset from overshooting the actual file size by 1.
      if (isLastSegment && !line && endsWithNewline) break;

      // Only the true final segment of a file NOT ending with \n lacks a trailing newline.
      // After the phantom guard above, if we reach here on the last segment the file
      // does not end with \n, so newlineSize = 0 is correct.
      const newlineSize = isLastSegment ? 0 : 1;
      const rawLineLength = Buffer.byteLength(line, "utf-8") + newlineSize;
      const trimmed = line.trim();
      if (!trimmed) {
        bytesProcessed += rawLineLength;
        continue;
      }

      try {
        const event = JSON.parse(trimmed);
        upsertEvent(db, event);
        if (duckDb) upsertEventDuck(duckDb, event);
        lastValidLine = trimmed;
        totalNew++;
      } catch {
        // partial line — stop here, don't advance cursor past it
      }

      bytesProcessed += rawLineLength;

      // Yield to the event loop every 100 inserts to prevent blocking HTTP serving
      if (totalNew > 0 && totalNew % 100 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    // Defensive clamp: ensure byteOffset never exceeds actual file bytes.
    // If this fires, a byte-counting bug exists above that needs investigation.
    bytesProcessed = clampBytesProcessed(bytesProcessed, content, file);

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

async function materializeDecisionsIncremental(
  _db: DbLike,
  duckDb: DbLike | null,
  cursor: MaterializerCursor,
  cwd?: string,
): Promise<number> {
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
  const endsWithNewline = newContent.endsWith("\n");

  const existingCount = duckDb ? await getDecisionCount(duckDb) : 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLastSegment = i === lines.length - 1;

    // PHANTOM TRAILING ELEMENT GUARD — see comment in materializeEventsIncremental
    if (isLastSegment && !line && endsWithNewline) break;

    const newlineSize = isLastSegment ? 0 : 1;
    const rawLineLength = Buffer.byteLength(line, "utf-8") + newlineSize;
    const trimmed = line.trim();
    if (!trimmed) {
      bytesProcessed += rawLineLength;
      continue;
    }

    try {
      const dec = JSON.parse(trimmed);
      const id = `${dec.date}-${existingCount + count}`;
      if (duckDb) upsertDecisionDuck(duckDb, dec, id);
      lastValidLine = trimmed;
      count++;
    } catch {
      // skip malformed
    }

    bytesProcessed += rawLineLength;
  }

  bytesProcessed = clampBytesProcessed(bytesProcessed, content, "decisions.jsonl");

  cursor.streams[streamKey] = {
    file: filePath,
    byteOffset: bytesProcessed,
    lastLineHash: lastValidLine ? hashLine(lastValidLine) : (streamCursor?.lastLineHash ?? ""),
  };

  return count;
}

function materializeMetricsIncremental(
  _db: DbLike,
  duckDb: DbLike | null,
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
  const endsWithNewline = newContent.endsWith("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLastSegment = i === lines.length - 1;

    // PHANTOM TRAILING ELEMENT GUARD — see comment in materializeEventsIncremental
    if (isLastSegment && !line && endsWithNewline) break;

    const newlineSize = isLastSegment ? 0 : 1;
    const rawLineLength = Buffer.byteLength(line, "utf-8") + newlineSize;
    const trimmed = line.trim();
    if (!trimmed) {
      bytesProcessed += rawLineLength;
      continue;
    }

    try {
      const snap = JSON.parse(trimmed);
      if (duckDb) upsertMetricSnapshotDuck(duckDb, snap);
      lastValidLine = trimmed;
      count++;
    } catch {
      // skip malformed
    }

    bytesProcessed += rawLineLength;
  }

  bytesProcessed = clampBytesProcessed(bytesProcessed, content, "daily.jsonl");

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

function rebuildEvents(db: DbLike, duckDb: DbLike | null, cwd?: string): number {
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
        const event = JSON.parse(trimmed);
        upsertEvent(db, event);
        if (duckDb) upsertEventDuck(duckDb, event);
        count++;
      } catch {
        // skip malformed
      }
    }
  }

  refreshFts(db);
  return count;
}

function rebuildDecisions(_db: DbLike, duckDb: DbLike | null, cwd?: string): number {
  const graphDir = getGraphDir(cwd);
  const decisionsPath = join(graphDir, "decisions.jsonl");
  if (!existsSync(decisionsPath)) return 0;

  let count = 0;
  const content = readFileSync(decisionsPath, "utf-8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const dec = JSON.parse(trimmed);
      const id = `${dec.date}-${count}`;
      if (duckDb) upsertDecisionDuck(duckDb, dec, id);
      count++;
    } catch {
      // skip malformed
    }
  }

  return count;
}

function rebuildMetrics(_db: DbLike, duckDb: DbLike | null, cwd?: string): number {
  const metricsDir = getMetricsDir(cwd);
  const snapshotPath = join(metricsDir, "daily.jsonl");
  if (!existsSync(snapshotPath)) return 0;

  let count = 0;
  const content = readFileSync(snapshotPath, "utf-8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const snap = JSON.parse(trimmed);
      if (duckDb) upsertMetricSnapshotDuck(duckDb, snap);
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
  const projectId =
    (event.projectId as string) || (event.content as Record<string, unknown>)?.project || "";
  db.run(
    `INSERT OR REPLACE INTO events (id, project_id, ts, source, type, content_summary, content_detail, git_repo, git_branch, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      projectId,
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

// SQLite upsertDecision and upsertMetricSnapshot removed — decisions and metrics
// are now DuckDB-only (see upsertDecisionDuck / upsertMetricSnapshotDuck below).

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

async function getDecisionCount(db: DbLike): Promise<number> {
  try {
    const result = await db.exec("SELECT COUNT(*) FROM decisions");
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// DuckDB typed column extraction + upsert
// ---------------------------------------------------------------------------

interface TypedEventColumns {
  ai_tool: string | null;
  session_id: string | null;
  conversation_id: string | null;
  conversation_title: string | null;
  turn_count: number | null;
  model_id: string | null;
  environment: string | null;
  prompt_count: number | null;
  human_direction_score: number | null;
  prompt_specificity: number | null;
  modification_after_accept: boolean | null;
  course_correction: boolean | null;
  domain_injection: boolean | null;
  alternative_evaluation: boolean | null;
  rejection_count: number | null;
  execution_phase: string | null;
  outcome: string | null;
  intent_summary: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  estimated_cost: number | null;
  files_referenced: string[];
  files_modified: string[];
  metadata_extra: string;
}

function extractTypedColumns(meta: Record<string, unknown>): TypedEventColumns {
  const signals = (meta.direction_signals ?? {}) as Record<string, unknown>;

  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    if (!KNOWN_METADATA_FIELDS.has(key)) extra[key] = meta[key];
  }

  return {
    ai_tool: (meta.ai_tool as string) ?? null,
    session_id: (meta.session_id as string) ?? null,
    conversation_id: (meta.conversation_id as string) ?? null,
    conversation_title: (meta.conversation_title as string) ?? null,
    turn_count: (meta.turn_count as number) ?? null,
    model_id: (meta.model_id as string) ?? (meta.model as string) ?? null,
    environment: (meta.environment as string) ?? null,
    prompt_count: (meta.prompt_count as number) ?? null,
    human_direction_score: (signals.human_direction_score as number) ?? null,
    prompt_specificity: (signals.prompt_specificity as number) ?? null,
    modification_after_accept: (signals.modification_after_accept as boolean) ?? null,
    course_correction: (signals.course_correction as boolean) ?? null,
    domain_injection: (signals.domain_injection as boolean) ?? null,
    alternative_evaluation: (signals.alternative_evaluation as boolean) ?? null,
    rejection_count: (signals.rejection_count as number) ?? null,
    execution_phase: (meta.execution_phase as string) ?? null,
    outcome: (meta.outcome as string) ?? null,
    intent_summary: (meta.intent_summary as string) ?? null,
    tokens_in: (meta.tokens_in as number) ?? null,
    tokens_out: (meta.tokens_out as number) ?? null,
    estimated_cost: (meta.estimated_cost as number) ?? null,
    files_referenced: Array.isArray(meta.files_referenced)
      ? (meta.files_referenced as string[])
      : [],
    files_modified: Array.isArray(meta.files_modified) ? (meta.files_modified as string[]) : [],
    metadata_extra: JSON.stringify(Object.keys(extra).length > 0 ? extra : null),
  };
}

const DUCK_EVENT_INSERT = `INSERT OR REPLACE INTO events (
  id, project_id, ts, source, type,
  content_summary, content_detail, content_branch, content_project, content_files,
  git_repo, git_branch, git_commit_hash,
  ai_tool, session_id, conversation_id, conversation_title,
  turn_count, model_id, environment, prompt_count,
  human_direction_score, prompt_specificity,
  modification_after_accept, course_correction,
  domain_injection, alternative_evaluation, rejection_count,
  execution_phase, outcome, intent_summary,
  tokens_in, tokens_out, estimated_cost,
  files_referenced, files_modified,
  metadata_extra
) VALUES (
  $1, $2, $3::TIMESTAMP, $4, $5,
  $6, $7, $8, $9, $10,
  $11, $12, $13,
  $14, $15, $16, $17,
  $18, $19, $20, $21,
  $22, $23,
  $24, $25,
  $26, $27, $28,
  $29, $30, $31,
  $32, $33, $34,
  $35, $36,
  $37
)`;

function upsertEventDuck(duckDb: DbLike, event: Record<string, unknown>): void {
  const content = (event.content ?? {}) as Record<string, unknown>;
  const git = (event.gitContext ?? {}) as Record<string, unknown>;
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  const typed = extractTypedColumns(meta);
  const projectId = (event.projectId as string) || (content.project as string) || "";

  const contentFiles = Array.isArray(content.files) ? (content.files as string[]) : [];

  duckDb.run(DUCK_EVENT_INSERT, [
    event.id,
    projectId,
    event.timestamp,
    event.source,
    event.type,
    content.summary ?? null,
    content.detail ?? null,
    content.branch ?? null,
    content.project ?? null,
    toDuckList(contentFiles),
    git.repo ?? null,
    git.branch ?? null,
    git.commitHash ?? null,
    typed.ai_tool,
    typed.session_id,
    typed.conversation_id,
    typed.conversation_title,
    typed.turn_count,
    typed.model_id,
    typed.environment,
    typed.prompt_count,
    typed.human_direction_score,
    typed.prompt_specificity,
    typed.modification_after_accept,
    typed.course_correction,
    typed.domain_injection,
    typed.alternative_evaluation,
    typed.rejection_count,
    typed.execution_phase,
    typed.outcome,
    typed.intent_summary,
    typed.tokens_in,
    typed.tokens_out,
    typed.estimated_cost,
    toDuckList(typed.files_referenced),
    toDuckList(typed.files_modified),
    typed.metadata_extra,
  ]);
}

function upsertDecisionDuck(duckDb: DbLike, dec: Record<string, unknown>, id: string): void {
  duckDb.run(
    `INSERT OR REPLACE INTO decisions (id, project_id, date, domain, description, rationale, alternatives_count, hds, direction_class)
     VALUES ($1, $2, $3::DATE, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      (dec.projectId as string) ?? "",
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

function upsertMetricSnapshotDuck(duckDb: DbLike, snap: Record<string, unknown>): void {
  duckDb.run(
    `INSERT OR REPLACE INTO metric_snapshots (date, project_id, rdi, dcs, aq, cwi, api_score, decisions_count, labels)
     VALUES ($1::DATE, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      snap.date,
      (snap.projectId as string) ?? "",
      snap.rdi ?? null,
      snap.dcs ?? null,
      snap.aq ?? null,
      snap.cwi ?? null,
      snap.apiScore ?? null,
      snap.decisionsCount ?? 0,
      JSON.stringify(snap.identityLabels ?? []),
    ],
  );
}

// ---------------------------------------------------------------------------
// Cursor state builder
// ---------------------------------------------------------------------------

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

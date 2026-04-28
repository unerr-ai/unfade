// FILE: src/services/workers/sqlite-worker.ts
// Worker thread for offloading synchronous better-sqlite3 operations.
// Each worker creates its own SQLite connection (better-sqlite3 connections
// are NOT transferable across threads). All writes are batched in transactions
// for both correctness and performance (10-50x faster than per-row auto-commit).

import Database from "better-sqlite3";

let db: InstanceType<typeof Database> | null = null;
let currentDbPath = "";

function getDb(dbPath: string): InstanceType<typeof Database> {
  if (db && currentDbPath === dbPath) return db;

  if (db) db.close();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  createSchema(db);
  currentDbPath = dbPath;
  return db;
}

function createSchema(conn: InstanceType<typeof Database>): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      ts TEXT,
      source TEXT,
      type TEXT,
      content_summary TEXT,
      content_detail TEXT,
      git_repo TEXT,
      git_branch TEXT,
      metadata JSON
    );
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
    CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events(project_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);

    CREATE TABLE IF NOT EXISTS event_insight_map (
      event_id TEXT NOT NULL,
      insight_id TEXT NOT NULL,
      analyzer TEXT NOT NULL,
      contribution_weight REAL,
      computed_at TEXT,
      PRIMARY KEY (event_id, insight_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eim_insight ON event_insight_map(insight_id);

    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      branch TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      event_count INTEGER DEFAULT 0,
      file_count INTEGER DEFAULT 0,
      session_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_features_project ON features(project_id);
    CREATE INDEX IF NOT EXISTS idx_features_branch ON features(branch);
    CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);

    CREATE TABLE IF NOT EXISTS event_features (
      event_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      PRIMARY KEY (event_id, feature_id)
    );

    CREATE TABLE IF NOT EXISTS event_links (
      from_event TEXT NOT NULL,
      to_event TEXT NOT NULL,
      link_type TEXT NOT NULL,
      metadata JSON,
      PRIMARY KEY (from_event, to_event, link_type)
    );

    CREATE TABLE IF NOT EXISTS extraction_status (
      event_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      extracted_at TEXT,
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_es_project ON extraction_status(project_id);
    CREATE INDEX IF NOT EXISTS idx_es_status ON extraction_status(status);
  `);

  try {
    conn.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
      USING fts5(content_summary, content_detail, tokenize='porter')
    `);
  } catch {
    // FTS5 not available in this SQLite build
  }
}

// ---------------------------------------------------------------------------
// Task interface
// ---------------------------------------------------------------------------

export interface WorkerTask {
  type: string;
  dbPath: string;
  payload: unknown;
}

export interface UpsertEventsPayload {
  events: Array<{
    id: unknown;
    timestamp: unknown;
    source: unknown;
    type: unknown;
    projectId?: unknown;
    content?: Record<string, unknown>;
    gitContext?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
}

export type RefreshFtsPayload = {};

export interface UpsertExtractionStatusPayload {
  statuses: Array<{
    eventId: string;
    projectId?: string;
    status: "pending" | "extracted" | "failed" | "deferred";
    extractedAt?: string;
    retryCount?: number;
    error?: string;
  }>;
}

export interface ClassifyOutcomesPayload {
  classifications: Array<{
    eventId: string;
    metadata: string; // JSON string
  }>;
}

export interface ExecQueryPayload {
  sql: string;
  params?: unknown[];
}

export interface InsertEventFeaturesPayload {
  links: Array<{ eventId: string; featureId: string }>;
}

export interface InsertEventLinksPayload {
  links: Array<{
    fromEvent: string;
    toEvent: string;
    linkType: string;
    metadata: string | null;
  }>;
}

export interface UpsertFeaturesPayload {
  features: Array<{
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
  }>;
  updates: Array<{
    featureId: string;
    lastSeen: string;
  }>;
}

export interface MarkStaleFeaturesPayload {
  cutoffTs: string;
}

// ---------------------------------------------------------------------------
// Batch handlers — all wrapped in transactions
// ---------------------------------------------------------------------------

function batchUpsertEvents(
  conn: InstanceType<typeof Database>,
  payload: UpsertEventsPayload,
): { count: number } {
  const stmt = conn.prepare(
    `INSERT OR REPLACE INTO events (id, project_id, ts, source, type, content_summary, content_detail, git_repo, git_branch, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = conn.transaction((events: UpsertEventsPayload["events"]) => {
    let count = 0;
    for (const event of events) {
      const projectId = (event.projectId as string) || (event.content?.project as string) || "";
      stmt.run(
        event.id,
        projectId,
        event.timestamp,
        event.source,
        event.type,
        event.content?.summary ?? "",
        event.content?.detail ?? "",
        event.gitContext?.repo ?? "",
        event.gitContext?.branch ?? "",
        JSON.stringify(event.metadata ?? {}),
      );
      count++;
    }
    return count;
  });

  return { count: tx(payload.events) };
}

function refreshFts(conn: InstanceType<typeof Database>): { ok: boolean } {
  try {
    conn.exec("DELETE FROM events_fts");
    conn.exec(
      "INSERT INTO events_fts (content_summary, content_detail) SELECT content_summary, content_detail FROM events",
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function batchUpsertExtractionStatus(
  conn: InstanceType<typeof Database>,
  payload: UpsertExtractionStatusPayload,
): { count: number } {
  const stmt = conn.prepare(
    `INSERT OR REPLACE INTO extraction_status (event_id, project_id, status, extracted_at, retry_count, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const tx = conn.transaction((statuses: UpsertExtractionStatusPayload["statuses"]) => {
    for (const s of statuses) {
      stmt.run(s.eventId, s.projectId ?? "", s.status, s.extractedAt ?? null, s.retryCount ?? 0, s.error ?? null);
    }
    return statuses.length;
  });

  return { count: tx(payload.statuses) };
}

function batchClassifyOutcomes(
  conn: InstanceType<typeof Database>,
  payload: ClassifyOutcomesPayload,
): { count: number } {
  const stmt = conn.prepare("UPDATE events SET metadata = ? WHERE id = ?");

  const tx = conn.transaction((items: ClassifyOutcomesPayload["classifications"]) => {
    for (const item of items) {
      stmt.run(item.metadata, item.eventId);
    }
    return items.length;
  });

  return { count: tx(payload.classifications) };
}

function batchInsertEventFeatures(
  conn: InstanceType<typeof Database>,
  payload: InsertEventFeaturesPayload,
): { count: number } {
  const stmt = conn.prepare(
    "INSERT OR IGNORE INTO event_features (event_id, feature_id) VALUES (?, ?)",
  );

  const tx = conn.transaction((links: InsertEventFeaturesPayload["links"]) => {
    for (const link of links) {
      stmt.run(link.eventId, link.featureId);
    }
    return links.length;
  });

  return { count: tx(payload.links) };
}

function batchInsertEventLinks(
  conn: InstanceType<typeof Database>,
  payload: InsertEventLinksPayload,
): { count: number } {
  const stmt = conn.prepare(
    "INSERT OR IGNORE INTO event_links (from_event, to_event, link_type, metadata) VALUES (?, ?, ?, ?)",
  );

  const tx = conn.transaction((links: InsertEventLinksPayload["links"]) => {
    for (const link of links) {
      stmt.run(link.fromEvent, link.toEvent, link.linkType, link.metadata);
    }
    return links.length;
  });

  return { count: tx(payload.links) };
}

function batchUpsertFeatures(
  conn: InstanceType<typeof Database>,
  payload: UpsertFeaturesPayload,
): { count: number } {
  const insertStmt = conn.prepare(
    `INSERT OR REPLACE INTO features (id, project_id, name, branch, first_seen, last_seen, event_count, file_count, session_count, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = conn.prepare(
    `UPDATE features SET last_seen = ?, event_count = event_count + 1 WHERE id = ?`,
  );

  const tx = conn.transaction(() => {
    for (const f of payload.features) {
      insertStmt.run(
        f.id,
        f.projectId,
        f.name,
        f.branch,
        f.firstSeen,
        f.lastSeen,
        f.eventCount,
        f.fileCount,
        f.sessionCount,
        f.status,
      );
    }
    for (const u of payload.updates) {
      updateStmt.run(u.lastSeen, u.featureId);
    }
    return payload.features.length + payload.updates.length;
  });

  return { count: tx() };
}

function markStaleFeatures(
  conn: InstanceType<typeof Database>,
  payload: MarkStaleFeaturesPayload,
): { count: number } {
  const result = conn
    .prepare("UPDATE features SET status = 'stale' WHERE status = 'active' AND last_seen < ?")
    .run(payload.cutoffTs);
  return { count: result.changes };
}

function execQuery(
  conn: InstanceType<typeof Database>,
  payload: ExecQueryPayload,
): Array<{ columns: string[]; values: unknown[][] }> {
  try {
    const stmt = conn.prepare(payload.sql);
    const rows = (
      payload.params && payload.params.length > 0 ? stmt.all(...payload.params) : stmt.all()
    ) as Record<string, unknown>[];

    if (rows.length === 0) {
      const columns = stmt.columns().map((c) => c.name);
      return [{ columns, values: [] }];
    }
    const columns = Object.keys(rows[0]);
    const values = rows.map((row) => columns.map((col) => row[col]));
    return [{ columns, values }];
  } catch {
    conn.exec(payload.sql);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main handler — dispatches by task type
// ---------------------------------------------------------------------------

export default function handler(task: WorkerTask): unknown {
  const conn = getDb(task.dbPath);
  switch (task.type) {
    case "upsertEvents":
      return batchUpsertEvents(conn, task.payload as UpsertEventsPayload);
    case "refreshFts":
      return refreshFts(conn);
    case "upsertExtractionStatus":
      return batchUpsertExtractionStatus(conn, task.payload as UpsertExtractionStatusPayload);
    case "classifyOutcomes":
      return batchClassifyOutcomes(conn, task.payload as ClassifyOutcomesPayload);
    case "insertEventFeatures":
      return batchInsertEventFeatures(conn, task.payload as InsertEventFeaturesPayload);
    case "insertEventLinks":
      return batchInsertEventLinks(conn, task.payload as InsertEventLinksPayload);
    case "upsertFeatures":
      return batchUpsertFeatures(conn, task.payload as UpsertFeaturesPayload);
    case "markStaleFeatures":
      return markStaleFeatures(conn, task.payload as MarkStaleFeaturesPayload);
    case "execQuery":
      return execQuery(conn, task.payload as ExecQueryPayload);
    default:
      throw new Error(`Unknown worker task type: ${task.type}`);
  }
}

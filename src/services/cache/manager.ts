// FILE: src/services/cache/manager.ts
// SQLite cache backed by better-sqlite3 (native).
// The cache is a materialized read-only view over the JSONL source of truth.
// Exposes a compatible db interface: { run, exec } for all existing consumers.

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getCacheDir } from "../../utils/paths.js";

const DB_FILENAME = "unfade.db";

export interface DbLike {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
}

/**
 * CacheManager provides a lazy-initialized SQLite cache backed by better-sqlite3.
 * The cache is a materialized read-only view over the JSONL source of truth.
 * Failures are graceful — all methods return null/empty instead of throwing.
 */
export class CacheManager {
  private db: DbLike | null = null;
  private rawDb: InstanceType<typeof Database> | null = null;
  private initPromise: Promise<DbLike | null> | null = null;
  private cwd?: string;

  constructor(cwd?: string) {
    this.cwd = cwd;
  }

  async getDb(): Promise<DbLike | null> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    this.db = await this.initPromise;
    this.initPromise = null;
    return this.db;
  }

  private async initialize(): Promise<DbLike | null> {
    try {
      const cacheDir = getCacheDir(this.cwd);
      mkdirSync(cacheDir, { recursive: true });

      const dbPath = join(cacheDir, DB_FILENAME);
      const raw = new Database(dbPath);

      // Enable WAL mode for better concurrent read performance
      raw.pragma("journal_mode = WAL");
      raw.pragma("synchronous = NORMAL");

      this.rawDb = raw;
      this.createSchema(raw);

      // Wrap better-sqlite3 in the DbLike interface for backward compat
      const wrapper: DbLike = {
        run(sql: string, params?: unknown[]): void {
          if (params && params.length > 0) {
            raw.prepare(sql).run(...params);
          } else {
            raw.exec(sql);
          }
        },
        exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> {
          try {
            const stmt = raw.prepare(sql);
            const rows = (params && params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];
            if (rows.length === 0) {
              // Return columns from the statement
              const columns = stmt.columns().map((c) => c.name);
              return [{ columns, values: [] }];
            }
            const columns = Object.keys(rows[0]);
            const values = rows.map((row) => columns.map((col) => row[col]));
            return [{ columns, values }];
          } catch {
            // For statements that don't return rows (CREATE, INSERT, etc.)
            raw.exec(sql);
            return [];
          }
        },
      };

      logger.debug("SQLite cache initialized (better-sqlite3)", { path: dbPath });
      return wrapper;
    } catch (err) {
      logger.warn("SQLite cache unavailable", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private createSchema(db: InstanceType<typeof Database>): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        ts TEXT,
        source TEXT,
        type TEXT,
        content_summary TEXT,
        content_detail TEXT,
        git_repo TEXT,
        git_branch TEXT,
        metadata JSON
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        date TEXT,
        domain TEXT,
        description TEXT,
        rationale TEXT,
        alternatives_count INTEGER,
        hds REAL,
        direction_class TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions(domain);
      CREATE INDEX IF NOT EXISTS idx_decisions_date ON decisions(date);

      CREATE TABLE IF NOT EXISTS decision_edges (
        from_id TEXT,
        to_id TEXT,
        relation TEXT,
        weight REAL,
        match_type TEXT
      );

      CREATE TABLE IF NOT EXISTS metric_snapshots (
        date TEXT PRIMARY KEY,
        rdi REAL,
        dcs REAL,
        aq REAL,
        cwi REAL,
        api_score REAL,
        decisions_count INTEGER,
        labels JSON
      );

      CREATE TABLE IF NOT EXISTS direction_windows (
        window_size TEXT NOT NULL,
        window_end TEXT NOT NULL,
        direction_density REAL,
        event_count INTEGER,
        tool_mix JSON,
        PRIMARY KEY (window_size, window_end)
      );

      CREATE TABLE IF NOT EXISTS comprehension_proxy (
        event_id TEXT PRIMARY KEY,
        mod_depth REAL,
        specificity REAL,
        rejection REAL,
        score REAL
      );

      CREATE TABLE IF NOT EXISTS comprehension_by_module (
        module TEXT PRIMARY KEY,
        score REAL,
        event_count INTEGER,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS direction_by_file (
        path TEXT PRIMARY KEY,
        direction_density REAL,
        event_count INTEGER
      );

      CREATE TABLE IF NOT EXISTS token_proxy_spend (
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        PRIMARY KEY (date, model)
      );

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
        name TEXT NOT NULL,
        branch TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        event_count INTEGER DEFAULT 0,
        file_count INTEGER DEFAULT 0,
        session_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active'
      );
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
    `);

    // FTS5 for full-text search
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
        USING fts5(content_summary, content_detail, tokenize='porter')
      `);
    } catch {
      logger.debug("FTS5 not available in this SQLite build");
    }
  }

  /**
   * Check if the cache is stale by comparing source file mtimes
   * against a stored version timestamp.
   */
  isStale(sourceDir: string): boolean {
    if (!this.rawDb) return true;

    const cacheDir = getCacheDir(this.cwd);
    const dbPath = join(cacheDir, DB_FILENAME);
    if (!existsSync(dbPath)) return true;

    const dbMtime = statSync(dbPath).mtimeMs;

    if (!existsSync(sourceDir)) return false;
    const files = readdirSync(sourceDir).filter(
      (f: string) => f.endsWith(".jsonl") || f.endsWith(".md"),
    );

    for (const file of files) {
      const fileMtime = statSync(join(sourceDir, file)).mtimeMs;
      if (fileMtime > dbMtime) return true;
    }

    return false;
  }

  /**
   * Persist changes (no-op for better-sqlite3 — it's already on disk via WAL).
   */
  async save(): Promise<void> {
    // better-sqlite3 writes are already persisted via WAL mode.
    // Checkpoint WAL for durability on explicit save.
    if (this.rawDb) {
      try {
        this.rawDb.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // non-fatal
      }
    }
  }

  async close(): Promise<void> {
    if (this.rawDb) {
      try {
        this.rawDb.pragma("wal_checkpoint(TRUNCATE)");
        this.rawDb.close();
      } catch {
        // already closed
      }
      this.rawDb = null;
      this.db = null;
    }
  }
}

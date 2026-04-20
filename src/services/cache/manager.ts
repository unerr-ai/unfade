import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getCacheDir } from "../../utils/paths.js";

const DB_FILENAME = "unfade.db";

interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

/**
 * CacheManager provides a lazy-initialized SQLite cache backed by sql.js WASM.
 * The cache is a materialized read-only view over the JSONL source of truth.
 * Failures are graceful — all methods return null/empty instead of throwing.
 */
export class CacheManager {
  private db: SqlJsDatabase | null = null;
  private initPromise: Promise<SqlJsDatabase | null> | null = null;
  private cwd?: string;

  constructor(cwd?: string) {
    this.cwd = cwd;
  }

  async getDb(): Promise<SqlJsDatabase | null> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    this.db = await this.initPromise;
    this.initPromise = null;
    return this.db;
  }

  private async initialize(): Promise<SqlJsDatabase | null> {
    try {
      const initSqlJs: (config?: Record<string, unknown>) => Promise<SqlJsStatic> = (
        await import("sql.js")
      ).default;

      const SQL = await initSqlJs();

      const cacheDir = getCacheDir(this.cwd);
      mkdirSync(cacheDir, { recursive: true });

      const dbPath = join(cacheDir, DB_FILENAME);
      let db: SqlJsDatabase;

      if (existsSync(dbPath)) {
        const { readFileSync } = await import("node:fs");
        const buffer = readFileSync(dbPath);
        db = new SQL.Database(buffer);
      } else {
        db = new SQL.Database();
      }

      this.createSchema(db);
      logger.debug("SQLite cache initialized", { path: dbPath });
      return db;
    } catch (err) {
      logger.warn("SQLite cache unavailable — falling back to JSONL reads", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private createSchema(db: SqlJsDatabase): void {
    db.run(`
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
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)");
    db.run("CREATE INDEX IF NOT EXISTS idx_events_source ON events(source)");

    db.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        date TEXT,
        domain TEXT,
        description TEXT,
        rationale TEXT,
        alternatives_count INTEGER,
        hds REAL,
        direction_class TEXT
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions(domain)");
    db.run("CREATE INDEX IF NOT EXISTS idx_decisions_date ON decisions(date)");

    db.run(`
      CREATE TABLE IF NOT EXISTS decision_edges (
        from_id TEXT,
        to_id TEXT,
        relation TEXT,
        weight REAL,
        match_type TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        date TEXT PRIMARY KEY,
        rdi REAL,
        dcs REAL,
        aq REAL,
        cwi REAL,
        api_score REAL,
        decisions_count INTEGER,
        labels JSON
      )
    `);

    // Phase 5.6: Rolling direction windows for continuous intelligence
    db.run(`
      CREATE TABLE IF NOT EXISTS direction_windows (
        window_size TEXT NOT NULL,
        window_end TEXT NOT NULL,
        direction_density REAL,
        event_count INTEGER,
        tool_mix JSON,
        PRIMARY KEY (window_size, window_end)
      )
    `);

    // Phase 5.6: Per-event comprehension proxy scores
    db.run(`
      CREATE TABLE IF NOT EXISTS comprehension_proxy (
        event_id TEXT PRIMARY KEY,
        mod_depth REAL,
        specificity REAL,
        rejection REAL,
        score REAL
      )
    `);

    // Phase 5.6H: Per-module comprehension aggregation
    db.run(`
      CREATE TABLE IF NOT EXISTS comprehension_by_module (
        module TEXT PRIMARY KEY,
        score REAL,
        event_count INTEGER,
        updated_at TEXT
      )
    `);

    // Phase 5.6H: Per-file/directory direction density
    db.run(`
      CREATE TABLE IF NOT EXISTS direction_by_file (
        path TEXT PRIMARY KEY,
        direction_density REAL,
        event_count INTEGER
      )
    `);

    // Phase 5.6: Token spend proxy per model per day
    db.run(`
      CREATE TABLE IF NOT EXISTS token_proxy_spend (
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        PRIMARY KEY (date, model)
      )
    `);

    try {
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
        USING fts5(content_summary, content_detail, tokenize='porter')
      `);
    } catch {
      logger.debug("FTS5 not available in this sql.js build");
    }
  }

  /**
   * Check if the cache is stale by comparing source file mtimes
   * against a stored version timestamp.
   */
  isStale(sourceDir: string): boolean {
    if (!this.db) return true;

    const cacheDir = getCacheDir(this.cwd);
    const dbPath = join(cacheDir, DB_FILENAME);
    if (!existsSync(dbPath)) return true;

    const dbMtime = statSync(dbPath).mtimeMs;

    if (!existsSync(sourceDir)) return false;
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
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
   * Persist the in-memory database to disk.
   */
  async save(): Promise<void> {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const { writeFileSync } = await import("node:fs");
      const cacheDir = getCacheDir(this.cwd);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, DB_FILENAME), Buffer.from(data));
    } catch (err) {
      logger.warn("Failed to save SQLite cache", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.save();
      this.db.close();
      this.db = null;
    }
  }
}

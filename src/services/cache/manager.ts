// FILE: src/services/cache/manager.ts
// Dual-database cache: SQLite (operational/FTS) + DuckDB (analytical/columnar).
// The materializer writes to both. Intelligence reads DuckDB. MCP/FTS reads SQLite.
// Both are materialized views over the JSONL source of truth.

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { logger } from "../../utils/logger.js";
import { getCacheDir } from "../../utils/paths.js";
import { ALL_DUCKDB_DDL, ALL_DUCKDB_TABLES } from "./duckdb-schema.js";

const SQLITE_FILENAME = "unfade.db";
const DUCKDB_FILENAME = "unfade.duckdb";

export interface DbLike {
  run(sql: string, params?: unknown[]): void;
  exec(
    sql: string,
    params?: unknown[],
  ):
    | Array<{ columns: string[]; values: unknown[][] }>
    | Promise<Array<{ columns: string[]; values: unknown[][] }>>;
}

type DuckDBInstance = {
  connect(): Promise<DuckDBConnection>;
  closeSync(): void;
};

type DuckDBConnection = {
  run(sql: string, values?: unknown[]): Promise<unknown>;
  runAndReadAll(sql: string, values?: unknown[]): Promise<DuckDBResultReader>;
  closeSync(): void;
};

type DuckDBResultReader = {
  columnCount: number;
  currentRowCount: number;
  columnName(i: number): string;
  columnNames(): string[];
  value(col: number, row: number): unknown;
  getRowObjectsJson(): Array<Record<string, unknown>>;
};

/**
 * CacheManager provides dual-database access:
 * - SQLite (better-sqlite3) for FTS, point lookups, lineage
 * - DuckDB for columnar analytics, time-series, intelligence queries
 *
 * Both are lazy-initialized. The materializer writes to both.
 */
export class CacheManager {
  private sqliteDb: DbLike | null = null;
  private rawSqlite: InstanceType<typeof Database> | null = null;
  private duckInstance: DuckDBInstance | null = null;
  private duckConn: DuckDBConnection | null = null;
  private analyticsDb: DbLike | null = null;
  private initPromise: Promise<DbLike | null> | null = null;
  private cwd?: string;

  constructor(cwd?: string) {
    this.cwd = cwd;
  }

  /** Get the SQLite operational handle (backward compat — same as .operational). */
  async getDb(): Promise<DbLike | null> {
    if (this.sqliteDb) return this.sqliteDb;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize();
    this.sqliteDb = await this.initPromise;
    this.initPromise = null;
    return this.sqliteDb;
  }

  /** SQLite handle for FTS, point lookups, lineage writes. */
  get operational(): DbLike | null {
    return this.sqliteDb;
  }

  /** DuckDB handle for analytics, time-series, intelligence queries. */
  get analytics(): DbLike | null {
    return this.analyticsDb;
  }

  private async initialize(): Promise<DbLike | null> {
    try {
      const cacheDir = getCacheDir(this.cwd);
      mkdirSync(cacheDir, { recursive: true });

      const sqliteWrapper = this.initSqlite(cacheDir);
      await this.initDuckDb(cacheDir);

      return sqliteWrapper;
    } catch (err) {
      logger.warn("Cache initialization failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private initSqlite(cacheDir: string): DbLike {
    const dbPath = join(cacheDir, SQLITE_FILENAME);
    const raw = new Database(dbPath);
    raw.pragma("journal_mode = WAL");
    raw.pragma("synchronous = NORMAL");
    this.rawSqlite = raw;
    this.createSqliteSchema(raw);

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
          const rows = (params && params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<
            string,
            unknown
          >[];
          if (rows.length === 0) {
            const columns = stmt.columns().map((c) => c.name);
            return [{ columns, values: [] }];
          }
          const columns = Object.keys(rows[0]);
          const values = rows.map((row) => columns.map((col) => row[col]));
          return [{ columns, values }];
        } catch {
          raw.exec(sql);
          return [];
        }
      },
    };

    this.sqliteDb = wrapper;
    logger.debug("SQLite cache initialized", { path: dbPath });
    return wrapper;
  }

  private async initDuckDb(cacheDir: string): Promise<void> {
    const { DuckDBInstance: DI } = await import("@duckdb/node-api");
    const dbPath = join(cacheDir, DUCKDB_FILENAME);

    const tryOpen = async () => {
      const instance = await DI.create(dbPath);
      const conn = await instance.connect();
      this.duckInstance = instance as unknown as DuckDBInstance;
      this.duckConn = conn as unknown as DuckDBConnection;
      await this.createDuckDbSchema(conn as unknown as DuckDBConnection);
      this.analyticsDb = this.wrapDuckDbAsDbLike(conn as unknown as DuckDBConnection);
      logger.debug("DuckDB analytics initialized", { path: dbPath });
    };

    try {
      await tryOpen();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Stale DuckDB lock — always clean up and retry.
      // We hold the proper-lockfile server lock (acquired before anything else in
      // unfade-server.ts), so we are guaranteed to be the only unfade instance.
      // Any DuckDB "Conflicting lock" is therefore stale by definition — the PID
      // may appear alive due to OS PID recycling, but it's not another unfade.
      if (msg.includes("Conflicting lock")) {
        const stalePid = msg.match(/\(PID (\d+)\)/)?.[1] ?? "unknown";
        logger.info("DuckDB stale lock detected — clearing and retrying", { stalePid });
        this.clearDuckDbLockFiles(dbPath);
        try {
          await tryOpen();
          return;
        } catch (retryErr) {
          logger.warn("DuckDB unavailable after stale lock cleanup", {
            error: retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
          this.analyticsDb = null;
          return;
        }
      }
      logger.warn("DuckDB unavailable — analytics will degrade gracefully", { error: msg });
      this.analyticsDb = null;
    }
  }

  /** Remove DuckDB WAL and lock files so a fresh open can succeed. */
  private clearDuckDbLockFiles(dbPath: string): void {
    for (const suffix of [".wal", ".wal.lock", ".lock"]) {
      const lockFile = dbPath + suffix;
      try {
        if (existsSync(lockFile)) {
          unlinkSync(lockFile);
          logger.debug("Removed stale DuckDB file", { file: lockFile });
        }
      } catch {
        // best effort
      }
    }
  }

  private async createDuckDbSchema(conn: DuckDBConnection): Promise<void> {
    for (const ddl of ALL_DUCKDB_DDL) {
      await conn.run(ddl);
    }
    // Migrate existing tables: add any columns that are in the DDL but missing from the table
    await this.migrateDuckDbColumns(conn);
  }

  /**
   * Detect and add missing columns to existing DuckDB tables.
   * CREATE TABLE IF NOT EXISTS doesn't add columns added after initial creation.
   */
  private async migrateDuckDbColumns(conn: DuckDBConnection): Promise<void> {
    for (const ddl of ALL_DUCKDB_DDL) {
      const tableMatch = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (!tableMatch) continue;
      const tableName = tableMatch[1];

      // Get existing columns from DuckDB
      let existingCols: Set<string>;
      try {
        const result = await conn.runAndReadAll(
          `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}'`,
        );
        existingCols = new Set<string>();
        for (let r = 0; r < result.currentRowCount; r++) {
          existingCols.add(String(result.value(0, r)).toLowerCase());
        }
      } catch {
        continue; // table doesn't exist yet — CREATE TABLE will handle it
      }

      if (existingCols.size === 0) continue;

      // Parse expected columns from DDL (lines like "    column_name TYPE,")
      const columnDefs = ddl.matchAll(
        /^\s{2,}(\w+)\s+(VARCHAR(?:\[\])?|TIMESTAMP|INTEGER|FLOAT|BOOLEAN|JSON|DATE)(?:\s+.*?)?,?\s*$/gm,
      );

      for (const match of columnDefs) {
        const colName = match[1].toLowerCase();
        const colType = match[2];
        if (colName === "primary" || existingCols.has(colName)) continue;

        try {
          await conn.run(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colType}`);
          logger.debug("DuckDB migration: added column", {
            table: tableName,
            column: colName,
            type: colType,
          });
        } catch {
          // Column might already exist or ALTER failed — non-fatal
        }
      }
    }
  }

  /** Drop and recreate all DuckDB analytical tables (for rebuild). */
  async resetDuckDbSchema(): Promise<void> {
    if (!this.duckConn) return;
    for (const table of ALL_DUCKDB_TABLES) {
      await this.duckConn.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await this.createDuckDbSchema(this.duckConn);
  }

  private pendingDuckOps: Array<Promise<void>> = [];

  private wrapDuckDbAsDbLike(conn: DuckDBConnection): DbLike {
    const pending = this.pendingDuckOps;

    const wrapper: DbLike = {
      run(sql: string, params?: unknown[]): void {
        const p = (async () => {
          try {
            if (params && params.length > 0) {
              await conn.run(sql, params);
            } else {
              await conn.run(sql);
            }
          } catch (err) {
            logger.debug("DuckDB run failed", {
              sql: sql.slice(0, 120),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        pending.push(p);
      },
      async exec(
        sql: string,
        params?: unknown[],
      ): Promise<Array<{ columns: string[]; values: unknown[][] }>> {
        try {
          const reader = await conn.runAndReadAll(sql, params ?? undefined);
          const colNames = reader.columnNames();
          const rowCount = reader.currentRowCount;
          const values: unknown[][] = [];
          for (let r = 0; r < rowCount; r++) {
            const row: unknown[] = [];
            for (let c = 0; c < reader.columnCount; c++) {
              row.push(reader.value(c, r));
            }
            values.push(row);
          }
          return [{ columns: colNames, values }];
        } catch (err) {
          logger.debug("DuckDB exec failed", {
            sql: sql.slice(0, 120),
            error: err instanceof Error ? err.message : String(err),
          });
          return [];
        }
      },
    };

    return wrapper;
  }

  /** Flush all pending DuckDB async operations. Call after a batch of writes. */
  async flushDuckDb(): Promise<void> {
    while (this.pendingDuckOps.length > 0) {
      await Promise.all(this.pendingDuckOps.splice(0));
    }
  }

  /** Direct async DuckDB connection for operations that need real results. */
  getDuckDbConnection(): DuckDBConnection | null {
    return this.duckConn;
  }

  private createSqliteSchema(db: InstanceType<typeof Database>): void {
    // SQLite keeps operational tables: events (+ FTS), lineage, features, extraction_status.
    // Analytical tables (sessions, direction_windows, comprehension, token_proxy_spend,
    // metric_snapshots, decisions, decision_edges) live in DuckDB.
    db.exec(`
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

      CREATE TABLE IF NOT EXISTS event_segments (
        event_id TEXT NOT NULL,
        segment_index INTEGER NOT NULL,
        segment_id TEXT NOT NULL,
        turn_start INTEGER NOT NULL,
        turn_end INTEGER NOT NULL,
        topic_label TEXT,
        summary TEXT,
        files_in_scope TEXT,
        modules_in_scope TEXT,
        segment_method TEXT NOT NULL DEFAULT 'structural',
        PRIMARY KEY (event_id, segment_index)
      );
      CREATE INDEX IF NOT EXISTS idx_es_event ON event_segments(event_id);
    `);

    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
        USING fts5(content_summary, content_detail, tokenize='porter')
      `);
    } catch {
      logger.debug("FTS5 not available in this SQLite build");
    }
  }

  isStale(sourceDir: string): boolean {
    if (!this.rawSqlite) return true;
    const cacheDir = getCacheDir(this.cwd);
    const dbPath = join(cacheDir, SQLITE_FILENAME);
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

  async save(): Promise<void> {
    if (this.rawSqlite) {
      try {
        this.rawSqlite.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // non-fatal
      }
    }
  }

  async close(): Promise<void> {
    if (this.rawSqlite) {
      try {
        this.rawSqlite.pragma("wal_checkpoint(TRUNCATE)");
        this.rawSqlite.close();
      } catch {
        // already closed
      }
      this.rawSqlite = null;
      this.sqliteDb = null;
    }
    if (this.duckConn) {
      try {
        this.duckConn.closeSync();
      } catch {
        // already closed
      }
      this.duckConn = null;
      this.analyticsDb = null;
    }
    if (this.duckInstance) {
      try {
        this.duckInstance.closeSync();
      } catch {
        // already closed
      }
      this.duckInstance = null;
    }
  }
}

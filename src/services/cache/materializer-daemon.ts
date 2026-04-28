// FILE: src/services/cache/materializer-daemon.ts
// UF-211: Background materializer with chokidar file watching + heartbeat fallback.
// On each tick: incremental materialization → summary.json update.
// Runs inside the standalone server process so it survives CLI exit.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { logger } from "../../utils/logger.js";
import { getEventsDir, getStateDir } from "../../utils/paths.js";
import { logBuffer } from "../logs/ring-buffer.js";
import { destroyWorkerPool } from "../workers/pool.js";
import { CacheManager } from "./manager.js";
import { type MaterializeProgressInfo, materializeIncremental } from "./materializer.js";

export interface KnowledgeExtractionHook {
  /** Called after materialization when new rows exist. Returns number of events processed. */
  run: (analytics: import("./manager.js").DbLike, limit?: number) => Promise<number>;
}

export interface MaterializerDaemonConfig {
  intervalMs: number;
  cwd?: string;
  onTick?: (newRows: number, cache: CacheManager) => void | Promise<void>;
  onClose?: () => void | Promise<void>;
  onMaterializeProgress?: (info: MaterializeProgressInfo) => void;
  /** Knowledge extraction hook — runs after materialization, before onTick. */
  knowledgeExtraction?: KnowledgeExtractionHook;
}

const HEARTBEAT_INTERVAL_MS = 30_000; // 30s fallback heartbeat
const DEBOUNCE_MS = 500; // 500ms debounce — batches rapid writes into single ticks

/**
 * Background materializer that watches .unfade/events/ for changes via chokidar.
 * Falls back to a 30s heartbeat interval for missed watcher events.
 */
export class MaterializerDaemon {
  private watcher: FSWatcher | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy = false;
  private cache: CacheManager;
  private config: MaterializerDaemonConfig;
  private initialBuildDone = false;
  private lastTickMs = 0;
  private lastProgressCheckMs = 0;

  constructor(config: MaterializerDaemonConfig) {
    this.config = config;
    this.cache = new CacheManager(config.cwd);
  }

  /**
   * Start the background materializer.
   * Sets up chokidar watcher on events dir + heartbeat fallback.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.writeResumeState();

    // Kick off initial build without blocking — yields to event loop so
    // the HTTP server can respond to health/progress requests immediately.
    void this.initialBuild().catch((err) => {
      logger.debug("Initial build failed (non-blocking)", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Set up file watcher on events directory
    const eventsDir = getEventsDir(this.config.cwd);
    if (existsSync(eventsDir)) {
      this.watcher = watch(eventsDir, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 200 },
      });

      this.watcher.on("change", () => this.debouncedTick());
      this.watcher.on("add", () => this.debouncedTick());
    }

    // Heartbeat fallback for missed events + health/freshness
    this.heartbeatTimer = setInterval(() => {
      void this.tick();
    }, HEARTBEAT_INTERVAL_MS);

    logger.debug("MaterializerDaemon started", {
      intervalMs: this.config.intervalMs,
      mode: this.watcher ? "chokidar+heartbeat" : "heartbeat-only",
    });
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.running = false;
    logger.debug("MaterializerDaemon stopped");
  }

  async triggerNow(): Promise<number> {
    return this.tick();
  }

  getCache(): CacheManager {
    return this.cache;
  }

  getLagMs(): number {
    if (this.lastTickMs === 0) return -1;
    return Date.now() - this.lastTickMs;
  }

  /**
   * Graceful close: stop watcher → final tick → save cursor → close DB.
   */
  async close(): Promise<void> {
    this.stop();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    try {
      await this.tick();
    } catch {
      // best effort final tick
    }

    try {
      const { saveCursor, loadCursor } = await import("./cursor.js");
      const cursor = loadCursor(this.config.cwd);
      saveCursor(cursor, this.config.cwd);
      logger.debug("Materializer cursor saved on close", { cwd: this.config.cwd });
    } catch {
      // cursor save is best-effort
    }

    await destroyWorkerPool();
    await this.cache.close();

    if (this.config.onClose) {
      try {
        await this.config.onClose();
      } catch {
        // best effort cleanup
      }
    }
  }

  /**
   * Get the current cursor state for shutdown reporting.
   */
  async getCursorState(): Promise<{ totalByteOffset: number; streamCount: number }> {
    try {
      const { loadCursor } = await import("./cursor.js");
      const cursor = loadCursor(this.config.cwd);
      let totalBytes = 0;
      const streamCount = Object.keys(cursor.streams).length;
      for (const stream of Object.values(cursor.streams)) {
        totalBytes += stream.byteOffset;
      }
      return { totalByteOffset: totalBytes, streamCount };
    } catch {
      return { totalByteOffset: 0, streamCount: 0 };
    }
  }

  private debouncedTick(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.tick();
    }, DEBOUNCE_MS);
  }

  private async writeResumeState(): Promise<void> {
    try {
      const { loadCursor } = await import("./cursor.js");
      const cursor = loadCursor(this.config.cwd);
      let totalBytes = 0;
      const streamCount = Object.keys(cursor.streams).length;
      for (const stream of Object.values(cursor.streams)) {
        totalBytes += stream.byteOffset;
      }

      if (totalBytes > 0) {
        const stateDir = getStateDir(this.config.cwd);
        mkdirSync(stateDir, { recursive: true });
        const resumeData = {
          resumedAt: new Date().toISOString(),
          fromBytes: totalBytes,
          estimatedEvents: Math.floor(totalBytes / 200),
          streamCount,
        };
        const targetPath = join(stateDir, "resume.json");
        const tmpPath = join(stateDir, `resume.json.tmp.${process.pid}`);
        writeFileSync(tmpPath, JSON.stringify(resumeData, null, 2), "utf-8");
        renameSync(tmpPath, targetPath);
        logger.debug("Materializer resuming from checkpoint", resumeData);
      }
    } catch {
      // non-fatal — resume state is informational only
    }
  }

  private async initialBuild(): Promise<void> {
    if (this.initialBuildDone) return;

    try {
      const db = await this.cache.getDb();
      if (!db) return;

      const result = await db.exec("SELECT COUNT(*) FROM events");
      const count = (result[0]?.values[0]?.[0] as number) ?? 0;

      if (count === 0) {
        const buildStartMs = Date.now();
        logger.info("[materializer] Starting initial build (empty DB)");

        // Reset cursor so materializeIncremental processes everything from byte 0.
        const { resetCursor } = await import("./cursor.js");
        resetCursor(this.config.cwd);

        // Reset DuckDB schema for clean start
        await this.cache.resetDuckDbSchema();

        const rows = await materializeIncremental(
          this.cache,
          this.config.cwd,
          this.config.onMaterializeProgress,
        );
        logger.info(`[materializer] Initial build complete: ${rows} rows`, {
          elapsedMs: Date.now() - buildStartMs,
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        });

        // Run onTick so intelligence pipeline processes the initial data
        if (rows > 0 && this.config.onTick) {
          logger.info(`[materializer] Starting pipeline onTick for ${rows} initial rows`);
          await this.config.onTick(rows, this.cache);
          logger.info(`[materializer] Pipeline onTick complete`, {
            elapsedMs: Date.now() - buildStartMs,
          });
        }
      }

      this.initialBuildDone = true;
    } catch (err) {
      logger.debug("Initial build failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;

    try {
      const newRows = await materializeIncremental(
        this.cache,
        this.config.cwd,
        this.config.onMaterializeProgress,
      );
      this.lastTickMs = Date.now();

      if (newRows > 0) {
        logBuffer.append("materializer", "debug", `Materialized ${newRows} new rows`);
      }

      // Knowledge extraction: runs AFTER materialization, BEFORE intelligence analyzers.
      // Layer 3 analyzers see extraction results on the NEXT tick (acceptable 1-tick lag).
      if (newRows > 0 && this.config.knowledgeExtraction) {
        try {
          const db = this.cache.analytics ?? this.cache.getDb();
          const extracted = await this.config.knowledgeExtraction.run(db, 50);
          if (extracted > 0) {
            logBuffer.append("materializer", "debug", `Extracted knowledge from ${extracted} events`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.debug("Knowledge extraction failed (non-fatal)", { error: msg });
        }
      }

      // Only call onTick when there's actual work — intelligence processing is expensive.
      // Synthesis progress is checked separately on a 5s throttle via the heartbeat path.
      if (newRows > 0 && this.config.onTick) {
        await this.config.onTick(newRows, this.cache);
      } else if (this.config.onTick) {
        // Throttled progress-only check: at most every 5 seconds
        const now = Date.now();
        if (now - this.lastProgressCheckMs >= 5_000) {
          this.lastProgressCheckMs = now;
          await this.config.onTick(0, this.cache);
        }
      }

      return newRows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug("Materializer tick failed", { error: msg });
      logBuffer.append("materializer", "error", `Tick failed: ${msg}`);
      return 0;
    } finally {
      this.busy = false;
    }
  }
}

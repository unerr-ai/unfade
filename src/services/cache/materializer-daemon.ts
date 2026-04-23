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
import { CacheManager } from "./manager.js";
import { materializeIncremental, rebuildAll } from "./materializer.js";

export interface MaterializerDaemonConfig {
  intervalMs: number;
  cwd?: string;
  onTick?: (newRows: number) => void | Promise<void>;
}

const HEARTBEAT_INTERVAL_MS = 30_000; // 30s fallback heartbeat
const DEBOUNCE_MS = 100; // 100ms debounce for rapid writes

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
    await this.initialBuild();

    // Set up file watcher on events directory
    const eventsDir = getEventsDir(this.config.cwd);
    if (existsSync(eventsDir)) {
      this.watcher = watch(eventsDir, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
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

    await this.cache.close();
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
        const rows = await rebuildAll(this.cache, this.config.cwd);
        logger.debug("Initial full rebuild", { rows });
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
      const newRows = await materializeIncremental(this.cache, this.config.cwd);
      this.lastTickMs = Date.now();

      if (newRows > 0) {
        logBuffer.append("materializer", "debug", `Materialized ${newRows} new rows`);
        if (this.config.onTick) {
          await this.config.onTick(newRows);
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

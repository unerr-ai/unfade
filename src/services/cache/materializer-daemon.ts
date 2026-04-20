// FILE: src/services/cache/materializer-daemon.ts
// UF-211: Background materializer that runs on a debounced timer.
// On each tick: incremental materialization → summary.json update.
// Runs inside the standalone server process so it survives CLI exit.

import { logger } from "../../utils/logger.js";
import { CacheManager } from "./manager.js";
import { materializeIncremental, rebuildAll } from "./materializer.js";

export interface MaterializerDaemonConfig {
  intervalMs: number;
  cwd?: string;
  onTick?: (newRows: number) => void | Promise<void>;
}

/**
 * Background materializer that periodically tail-reads JSONL and upserts into SQLite.
 * Uses setInterval for testability (compatible with fake timers).
 */
export class MaterializerDaemon {
  private timer: ReturnType<typeof setInterval> | null = null;
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
   * Start the background materializer loop.
   * Performs an initial rebuild if the DB is empty, then switches to incremental.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.initialBuild();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);

    logger.debug("MaterializerDaemon started", { intervalMs: this.config.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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
   * Graceful close: final tick → save cursor → close DB.
   * Call this on server shutdown to persist resume state.
   */
  async close(): Promise<void> {
    this.stop();

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

  private async initialBuild(): Promise<void> {
    if (this.initialBuildDone) return;

    try {
      const db = await this.cache.getDb();
      if (!db) return;

      const result = db.exec("SELECT COUNT(*) FROM events");
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

      if (newRows > 0 && this.config.onTick) {
        await this.config.onTick(newRows);
      }

      return newRows;
    } catch (err) {
      logger.debug("Materializer tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    } finally {
      this.busy = false;
    }
  }
}

// FILE: src/services/workers/pool.ts
// Singleton worker pool manager wrapping Piscina.
// Provides typed task dispatch for SQLite write operations and CPU-heavy analyzers.
// Main thread stays responsive — all blocking work runs in worker threads.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Piscina } from "piscina";
import { logger } from "../../utils/logger.js";
import { getCacheDir } from "../../utils/paths.js";
import type {
  ClassifyOutcomesPayload,
  ExecQueryPayload,
  InsertEventFeaturesPayload,
  InsertEventLinksPayload,
  MarkStaleFeaturesPayload,
  UpsertExtractionStatusPayload,
  UpsertEventsPayload,
  UpsertFeaturesPayload,
} from "./sqlite-worker.js";

// ---------------------------------------------------------------------------
// Worker file resolution
// ---------------------------------------------------------------------------

// Workers are compiled as separate entry points by tsdown.
// In dev (tsx), they're .ts; in production, they're .mjs alongside cli.mjs.
function resolveWorkerPath(workerName: string): string {
  const thisDir = fileURLToPath(new URL(".", import.meta.url));

  // Try compiled .mjs first (production build)
  const mjsPath = join(thisDir, `${workerName}.mjs`);
  // Fall back to .js (tsdown output) or .ts (dev mode via tsx)
  const jsPath = join(thisDir, `${workerName}.js`);
  const tsPath = join(thisDir, `${workerName}.ts`);

  // Piscina resolves the file at construction time, so we just provide the best guess.
  // In production (tsdown), the worker sits next to pool.mjs as workerName.mjs.
  // In dev (tsx), it's the .ts source.
  try {
    const { existsSync } = await_free_existsSync();
    if (existsSync(mjsPath)) return mjsPath;
    if (existsSync(jsPath)) return jsPath;
    return tsPath;
  } catch {
    return jsPath;
  }
}

// Avoid top-level await for existsSync — use sync require
function await_free_existsSync(): { existsSync: (p: string) => boolean } {
  // biome-ignore lint: dynamic require for sync check
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  return { existsSync };
}

// ---------------------------------------------------------------------------
// WorkerPool class
// ---------------------------------------------------------------------------

class WorkerPool {
  private sqlitePool: Piscina | null = null;
  private cpuPool: Piscina | null = null;
  private dbPath: string;

  constructor(cwd?: string) {
    this.dbPath = join(getCacheDir(cwd), "unfade.db");
  }

  private getSqlitePool(): Piscina {
    if (!this.sqlitePool) {
      const workerPath = resolveWorkerPath("sqlite-worker");
      this.sqlitePool = new Piscina({
        filename: workerPath,
        minThreads: 1,
        maxThreads: 2,
        idleTimeout: 30_000,
      });
      logger.debug("SQLite worker pool initialized", { path: workerPath, maxThreads: 2 });
    }
    return this.sqlitePool;
  }

  private getCpuPool(): Piscina {
    if (!this.cpuPool) {
      const workerPath = resolveWorkerPath("cpu-worker");
      this.cpuPool = new Piscina({
        filename: workerPath,
        minThreads: 0,
        maxThreads: 2,
        idleTimeout: 60_000,
      });
      logger.debug("CPU worker pool initialized", { path: workerPath, maxThreads: 2 });
    }
    return this.cpuPool;
  }

  // ---------------------------------------------------------------------------
  // SQLite write operations
  // ---------------------------------------------------------------------------

  async upsertEvents(
    events: UpsertEventsPayload["events"] | Record<string, unknown>[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    const result = (await this.getSqlitePool().run({
      type: "upsertEvents",
      dbPath: this.dbPath,
      payload: { events },
    })) as { count: number };
    return result.count;
  }

  async refreshFts(): Promise<boolean> {
    const result = (await this.getSqlitePool().run({
      type: "refreshFts",
      dbPath: this.dbPath,
      payload: {},
    })) as { ok: boolean };
    return result.ok;
  }

  async upsertExtractionStatus(statuses: UpsertExtractionStatusPayload["statuses"]): Promise<number> {
    if (statuses.length === 0) return 0;
    const result = (await this.getSqlitePool().run({
      type: "upsertExtractionStatus",
      dbPath: this.dbPath,
      payload: { statuses },
    })) as { count: number };
    return result.count;
  }

  async classifyOutcomes(
    classifications: ClassifyOutcomesPayload["classifications"],
  ): Promise<number> {
    if (classifications.length === 0) return 0;
    const result = (await this.getSqlitePool().run({
      type: "classifyOutcomes",
      dbPath: this.dbPath,
      payload: { classifications },
    })) as { count: number };
    return result.count;
  }

  async insertEventFeatures(links: InsertEventFeaturesPayload["links"]): Promise<number> {
    if (links.length === 0) return 0;
    const result = (await this.getSqlitePool().run({
      type: "insertEventFeatures",
      dbPath: this.dbPath,
      payload: { links },
    })) as { count: number };
    return result.count;
  }

  async insertEventLinks(links: InsertEventLinksPayload["links"]): Promise<number> {
    if (links.length === 0) return 0;
    const result = (await this.getSqlitePool().run({
      type: "insertEventLinks",
      dbPath: this.dbPath,
      payload: { links },
    })) as { count: number };
    return result.count;
  }

  async upsertFeatures(payload: UpsertFeaturesPayload): Promise<number> {
    const result = (await this.getSqlitePool().run({
      type: "upsertFeatures",
      dbPath: this.dbPath,
      payload,
    })) as { count: number };
    return result.count;
  }

  async markStaleFeatures(cutoffTs: string): Promise<number> {
    const result = (await this.getSqlitePool().run({
      type: "markStaleFeatures",
      dbPath: this.dbPath,
      payload: { cutoffTs } satisfies MarkStaleFeaturesPayload,
    })) as { count: number };
    return result.count;
  }

  async execQuery(
    sql: string,
    params?: unknown[],
  ): Promise<Array<{ columns: string[]; values: unknown[][] }>> {
    return (await this.getSqlitePool().run({
      type: "execQuery",
      dbPath: this.dbPath,
      payload: { sql, params } satisfies ExecQueryPayload,
    })) as Array<{ columns: string[]; values: unknown[][] }>;
  }

  // ---------------------------------------------------------------------------
  // CPU-heavy operations
  // ---------------------------------------------------------------------------

  async computeCosineClusters(payload: {
    entries: Array<{
      summary: string;
      domain: string;
      approach: string;
      eventId: string;
      date: string;
      contentHash: string;
      resolution: string | null;
    }>;
    threshold: number;
    minClusterSize: number;
  }): Promise<
    Array<{
      domain: string;
      approach: string;
      occurrences: number;
      firstSeen: string;
      lastSeen: string;
      resolution: string | null;
    }>
  > {
    return (await this.getCpuPool().run({
      type: "cosineSimilarity",
      payload,
    })) as Array<{
      domain: string;
      approach: string;
      occurrences: number;
      firstSeen: string;
      lastSeen: string;
      resolution: string | null;
    }>;
  }

  async classifyVelocityRows(
    rows: Array<{
      contentSummary: string;
      turns: number;
      date: string;
    }>,
  ): Promise<Record<string, number[]>> {
    const result = (await this.getCpuPool().run({
      type: "velocityClassify",
      payload: { rows },
    })) as { domainWeeklyAverages: Record<string, number[]> };
    return result.domainWeeklyAverages;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async destroy(): Promise<void> {
    const promises: Promise<void>[] = [];
    if (this.sqlitePool) {
      promises.push(this.sqlitePool.destroy());
      this.sqlitePool = null;
    }
    if (this.cpuPool) {
      promises.push(this.cpuPool.destroy());
      this.cpuPool = null;
    }
    if (promises.length > 0) {
      await Promise.all(promises);
      logger.debug("Worker pools destroyed");
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: WorkerPool | null = null;

export function getWorkerPool(cwd?: string): WorkerPool {
  if (!instance) instance = new WorkerPool(cwd);
  return instance;
}

export async function destroyWorkerPool(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}

export type { WorkerPool };

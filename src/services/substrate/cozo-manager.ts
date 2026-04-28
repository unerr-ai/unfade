// FILE: src/services/substrate/cozo-manager.ts
// CozoDB connection manager — singleton with health check + idempotent schema init.
// SQLite backend at ~/.unfade/intelligence/graph.db. In-memory fallback.
// Schema v3: unified knowledge graph (entities, facts, comprehension, metacognition).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CozoDb } from "cozo-node";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import { ALL_COZO_INDEXES, ALL_COZO_SCHEMA, META_SCHEMA, SCHEMA_VERSION } from "./schema.js";

export class CozoManager {
  private static instance: CozoDb | null = null;

  static async getInstance(cwd?: string): Promise<CozoDb> {
    if (CozoManager.instance) {
      const healthy = await CozoManager.healthCheck(CozoManager.instance);
      if (healthy) return CozoManager.instance;
      logger.debug("CozoDB health check failed — reconnecting");
      try {
        CozoManager.instance.close();
      } catch {
        // already closed or corrupt
      }
      CozoManager.instance = null;
    }

    const dir = getIntelligenceDir(cwd);
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "graph.db");

    try {
      CozoManager.instance = new CozoDb("sqlite", dbPath);
      await CozoManager.ensureSchema(CozoManager.instance);
      logger.debug("CozoDB graph database initialized", { path: dbPath });
    } catch (err) {
      logger.debug("CozoDB initialization failed — falling back to in-memory", {
        error: err instanceof Error ? err.message : String(err),
      });
      CozoManager.instance = new CozoDb("mem", "");
      await CozoManager.ensureSchema(CozoManager.instance);
    }

    return CozoManager.instance;
  }

  static async close(): Promise<void> {
    if (CozoManager.instance) {
      CozoManager.instance.close();
      CozoManager.instance = null;
    }
  }

  static async createTestInstance(): Promise<CozoDb> {
    const db = new CozoDb("mem", "");
    await CozoManager.ensureSchema(db);
    return db;
  }

  static async healthCheck(db: CozoDb): Promise<boolean> {
    try {
      const result = await db.run("?[x] := x = 1");
      const rows = (result as { rows?: unknown[][] }).rows ?? [];
      return rows.length === 1;
    } catch {
      return false;
    }
  }

  /**
   * Idempotent schema initialization — creates all relations and indexes.
   * CozoDB's `:create` is a no-op if the relation already exists, so this
   * is safe to call on every startup.
   */
  private static async ensureSchema(db: CozoDb): Promise<void> {
    // Meta relation (stores schema version)
    try {
      await db.run(META_SCHEMA);
    } catch {
      // already exists
    }

    // All stored relations
    for (const stmt of ALL_COZO_SCHEMA) {
      try {
        await db.run(stmt);
      } catch {
        // relation already exists
      }
    }

    // All HNSW indexes
    for (const stmt of ALL_COZO_INDEXES) {
      try {
        await db.run(stmt);
      } catch {
        // index already exists
      }
    }

    // Stamp schema version
    try {
      await db.run(
        `?[key, value] <- [['schema_version', '${SCHEMA_VERSION}']]
        :put meta {key => value}`,
      );
    } catch {
      // non-fatal — meta write failure doesn't block operation
    }
  }
}

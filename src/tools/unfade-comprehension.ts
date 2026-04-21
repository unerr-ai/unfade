// FILE: src/tools/unfade-comprehension.ts
// UF-237: MCP tool — returns per-module comprehension scores + overall score.
// Useful for AI agents to understand which parts of the codebase
// the developer knows well vs is AI-dependent in.

import type { McpMeta } from "../schemas/mcp.js";
import { CacheManager } from "../services/cache/manager.js";
import {
  aggregateComprehensionByModule,
  type ModuleComprehension,
  readModuleComprehension,
} from "../services/intelligence/comprehension.js";

export interface ComprehensionResult {
  data: {
    overall: number | null;
    modules: ModuleComprehension[];
    totalModules: number;
  };
  _meta: McpMeta;
}

export async function getComprehension(cwd?: string): Promise<ComprehensionResult> {
  const start = Date.now();

  const cache = new CacheManager(cwd);
  const db = await cache.getDb();

  if (!db) {
    return {
      data: { overall: null, modules: [], totalModules: 0 },
      _meta: {
        tool: "unfade-comprehension",
        durationMs: Date.now() - start,
        degraded: true,
        degradedReason: "SQLite cache unavailable",
        lastUpdated: null,
      },
    };
  }

  let modules = readModuleComprehension(db);
  if (modules.length === 0) {
    modules = aggregateComprehensionByModule(db);
  }

  const overall =
    modules.length > 0
      ? Math.round(
          modules.reduce((sum, m) => sum + m.score * m.eventCount, 0) /
            modules.reduce((sum, m) => sum + m.eventCount, 0),
        )
      : null;

  await cache.close();

  return {
    data: {
      overall,
      modules: modules.slice(0, 20),
      totalModules: modules.length,
    },
    _meta: {
      tool: "unfade-comprehension",
      durationMs: Date.now() - start,
      degraded: false,
      lastUpdated: new Date().toISOString(),
      provenance: {
        sourceEventIds: [],
        lineageUrl: "/api/lineage/",
      },
    },
  };
}

// FILE: src/tools/unfade-comprehension.ts
// MCP tool — returns per-domain comprehension scores from the knowledge extraction pipeline.
// Reads from domain_comprehension + comprehension_assessment (DuckDB analytics).

import type { McpMeta } from "../schemas/mcp.js";
import { CacheManager } from "../services/cache/manager.js";
import {
  type ModuleComprehension,
  readComprehensionOverview,
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
  const analyticsDb = cache.analytics;

  if (!analyticsDb) {
    return {
      data: { overall: null, modules: [], totalModules: 0 },
      _meta: {
        tool: "unfade-comprehension",
        durationMs: Date.now() - start,
        degraded: true,
        degradedReason: "DuckDB analytics unavailable",
        lastUpdated: null,
      },
    };
  }

  const overview = await readComprehensionOverview(analyticsDb);
  const modules = await readModuleComprehension(analyticsDb);

  await cache.close();

  return {
    data: {
      overall: overview.overallScore,
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

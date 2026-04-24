// FILE: src/tools/unfade-costs.ts
// UF-105: MCP tool — returns cost attribution data (estimates, not invoices).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta } from "../schemas/mcp.js";
import { getProjectDataDir } from "../utils/paths.js";

export interface CostsToolResult {
  data: Record<string, unknown> | null;
  _meta: McpMeta;
}

export function getCosts(
  _opts?: { period?: string; groupBy?: string },
  cwd?: string,
): CostsToolResult {
  const start = Date.now();
  const path = join(getProjectDataDir(cwd), "intelligence", "costs.json");

  if (!existsSync(path)) {
    return {
      data: null,
      _meta: {
        tool: "unfade-costs",
        durationMs: Date.now() - start,
        degraded: true,
        degradedReason: "No cost data yet — configure pricing in settings for estimates",
        lastUpdated: null,
      },
    };
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return {
      data,
      _meta: {
        tool: "unfade-costs",
        durationMs: Date.now() - start,
        degraded: false,
        lastUpdated: data.updatedAt ?? null,
        provenance: {
          sourceEventIds: Array.isArray(data.sourceEventIds) ? data.sourceEventIds : [],
          lineageUrl: "/api/lineage/",
        },
      },
    };
  } catch {
    return {
      data: null,
      _meta: {
        tool: "unfade-costs",
        durationMs: Date.now() - start,
        degraded: true,
        degradedReason: "Failed to read cost data",
        lastUpdated: null,
      },
    };
  }
}

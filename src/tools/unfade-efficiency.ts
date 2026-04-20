// FILE: src/tools/unfade-efficiency.ts
// UF-105: MCP tool — returns AI Efficiency Score + sub-metrics + insight.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta } from "../schemas/mcp.js";
import { getProjectDataDir } from "../utils/paths.js";

export interface EfficiencyToolResult {
  data: Record<string, unknown> | null;
  _meta: McpMeta;
}

export function getEfficiency(opts?: { period?: string }, cwd?: string): EfficiencyToolResult {
  const start = Date.now();
  const path = join(getProjectDataDir(cwd), "intelligence", "efficiency.json");

  if (!existsSync(path)) {
    return {
      data: null,
      _meta: {
        tool: "unfade-efficiency",
        durationMs: Date.now() - start,
        degraded: true,
        degradedReason: "No efficiency data yet — keep working with AI tools",
        lastUpdated: null,
      },
    };
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return {
      data,
      _meta: {
        tool: "unfade-efficiency",
        durationMs: Date.now() - start,
        degraded: false,
        lastUpdated: data.updatedAt ?? null,
      },
    };
  } catch {
    return {
      data: null,
      _meta: {
        tool: "unfade-efficiency",
        durationMs: Date.now() - start,
        degraded: true,
        degradedReason: "Failed to read efficiency data",
        lastUpdated: null,
      },
    };
  }
}

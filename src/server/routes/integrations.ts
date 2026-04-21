// FILE: src/server/routes/integrations.ts
// Phase 9.4: One-click MCP integration API.
// POST /api/integrations/install — writes unfade MCP config into IDE config files.
// GET /api/integrations/status — checks which tools have unfade configured.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { logger } from "../../utils/logger.js";

export const integrationsRoutes = new Hono();

const MCP_ENTRY = {
  command: "npx",
  args: ["unfade", "mcp"],
};

interface ToolConfig {
  name: string;
  label: string;
  getPath: () => string;
  wrapEntry: (entry: typeof MCP_ENTRY) => Record<string, unknown>;
  checkConnected: (parsed: Record<string, unknown>) => boolean;
}

const TOOLS: Record<string, ToolConfig> = {
  "claude-code": {
    name: "claude-code",
    label: "Claude Code",
    getPath: () => join(homedir(), ".claude", "settings.json"),
    wrapEntry: (entry) => ({ mcpServers: { unfade: entry } }),
    checkConnected: (parsed) =>
      !!(parsed as { mcpServers?: { unfade?: unknown } }).mcpServers?.unfade,
  },
  cursor: {
    name: "cursor",
    label: "Cursor",
    getPath: () => join(homedir(), ".cursor", "mcp.json"),
    wrapEntry: (entry) => ({ mcpServers: { unfade: entry } }),
    checkConnected: (parsed) =>
      !!(parsed as { mcpServers?: { unfade?: unknown } }).mcpServers?.unfade,
  },
  windsurf: {
    name: "windsurf",
    label: "Windsurf",
    getPath: () => join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    wrapEntry: (entry) => ({ mcpServers: { unfade: entry } }),
    checkConnected: (parsed) =>
      !!(parsed as { mcpServers?: { unfade?: unknown } }).mcpServers?.unfade,
  },
};

/**
 * POST /api/integrations/install
 * Body: { tool: "claude-code" | "cursor" | "windsurf" }
 * Reads target config, merges unfade MCP server entry, writes atomically.
 */
integrationsRoutes.post("/api/integrations/install", async (c) => {
  const reqId = (c as unknown as { reqId?: string }).reqId;
  const body = await c.req.json<{ tool: string }>();
  const toolKey = body?.tool;

  if (!toolKey || !TOOLS[toolKey]) {
    logger.warn("integrations.install: unknown tool", { reqId, tool: toolKey });
    return c.json(
      {
        success: false,
        error: `Unknown tool: ${toolKey}. Supported: ${Object.keys(TOOLS).join(", ")}`,
      },
      400,
    );
  }

  const tool = TOOLS[toolKey];
  const configPath = tool.getPath();
  logger.info("integrations.install: received", { reqId, tool: toolKey, path: configPath });

  try {
    // Read existing config or start fresh
    let existing: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8").trim();
      if (raw) {
        existing = JSON.parse(raw);
      }
    } else {
      // Ensure parent directory exists
      mkdirSync(dirname(configPath), { recursive: true });
    }

    // Deep merge: preserve other MCP servers, add/overwrite unfade entry
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers.unfade = MCP_ENTRY;
    existing.mcpServers = mcpServers;

    // Atomic write
    const tmpPath = `${configPath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, configPath);

    logger.info("integrations.install: done", { reqId, tool: toolKey, path: configPath });

    return c.json({
      success: true,
      path: configPath,
      action: existsSync(configPath) ? "updated" : "created",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("integrations.install: failed", { reqId, tool: toolKey, error: message });
    return c.json({ success: false, error: message }, 500);
  }
});

/**
 * GET /api/integrations/status
 * Returns which tools currently have unfade configured.
 */
integrationsRoutes.get("/api/integrations/status", (c) => {
  const tools = Object.values(TOOLS).map((tool) => {
    let connected = false;
    let path = "";
    try {
      path = tool.getPath();
      if (existsSync(path)) {
        const raw = readFileSync(path, "utf-8").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          connected = tool.checkConnected(parsed);
        }
      }
    } catch {
      // Non-fatal — treat as not connected
    }
    return { tool: tool.name, label: tool.label, connected, path };
  });

  return c.json({ tools });
});

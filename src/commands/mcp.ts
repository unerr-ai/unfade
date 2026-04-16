// FILE: src/commands/mcp.ts
// UF-086d: `unfade mcp` hidden command — starts MCP stdio server for IDE integration.
// NOT listed in --help. Called by IDE configs:
//   { "command": "npx", "args": ["unfade", "mcp"] }
// Writes ONLY MCP JSON-RPC to stdout. All diagnostics to stderr.
// Exits when stdin closes (IDE disconnects).

import { logger } from "../utils/logger.js";

/**
 * MCP command handler: starts the MCP server with stdio transport.
 * This is the entry point for IDE integration (Claude Code, Cursor, Windsurf).
 */
export async function mcpCommand(): Promise<void> {
  // Suppress non-error logging in MCP mode — stdout is sacred
  logger.configure({ quiet: true });

  try {
    const { createMcpServer, connectStdio } = await import("../services/mcp/server.js");

    const server = createMcpServer();
    await connectStdio(server);

    logger.debug("MCP stdio server started");

    // Exit when stdin closes (IDE disconnects)
    process.stdin.on("end", () => {
      process.exit(0);
    });

    // Handle SIGINT/SIGTERM gracefully
    process.on("SIGINT", () => {
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      process.exit(0);
    });
  } catch (err) {
    // Log to stderr only — never pollute stdout
    logger.error("MCP server failed to start", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

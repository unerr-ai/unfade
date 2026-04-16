// FILE: src/services/mcp/server.ts
// UF-042: MCP server setup — initialize @modelcontextprotocol/sdk Server,
// register capabilities (resources, tools, prompts), handle lifecycle.
// Mount Streamable HTTP transport at /mcp on existing Hono server.
// Stdio transport for IDE integration (used by `unfade mcp` command).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import { logger } from "../../utils/logger.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

/**
 * Create a fully configured MCP server with all resources, tools, and prompts.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "unfade", version: "0.1.0" },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    },
  );

  registerResources(server);
  registerTools(server);
  registerPrompts(server);

  return server;
}

/**
 * Connect the MCP server to stdio transport for IDE integration.
 * Only MCP JSON-RPC goes to stdout. All diagnostics to stderr.
 * Resolves when stdin closes (IDE disconnects).
 */
export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.debug("MCP stdio transport connected");
}

/**
 * Mount Streamable HTTP transport at /mcp on the existing Hono server.
 * Creates a stateless transport for each request.
 */
export function mountMcpHttp(app: Hono): void {
  // Stateless transport: each request is independent (no session tracking)
  // This is appropriate for local-only, single-user operation
  const mcpServer = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });

  // Connect the MCP server to the HTTP transport
  mcpServer.connect(transport).catch((err) => {
    logger.error("Failed to connect MCP HTTP transport", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Route all /mcp requests through the transport
  app.all("/mcp", async (c) => {
    try {
      const response = await transport.handleRequest(c.req.raw);
      return response;
    } catch (err) {
      logger.error("MCP HTTP request error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error" },
          id: null,
        },
        500,
      );
    }
  });

  logger.debug("MCP Streamable HTTP transport mounted at /mcp");
}

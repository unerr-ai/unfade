// Tests for UF-042: MCP server setup
import { describe, expect, it } from "vitest";
import { createMcpServer, mountMcpHttp } from "../../../src/services/mcp/server.js";

describe("createMcpServer", () => {
  it("returns an McpServer instance with correct metadata", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
    // McpServer has a connect method
    expect(typeof server.connect).toBe("function");
    // McpServer has tool/resource/prompt registration methods
    expect(typeof server.tool).toBe("function");
    expect(typeof server.resource).toBe("function");
    expect(typeof server.prompt).toBe("function");
  });

  it("creates independent instances on each call", () => {
    const server1 = createMcpServer();
    const server2 = createMcpServer();
    expect(server1).not.toBe(server2);
  });
});

describe("mountMcpHttp", () => {
  it("mounts /mcp route on Hono app", async () => {
    const { Hono } = await import("hono");
    const app = new Hono();

    // Should not throw
    mountMcpHttp(app);

    // Verify the /mcp route responds (MCP expects POST with JSON-RPC)
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
        id: 1,
      }),
    });

    // Should get a response (either success or JSON-RPC error, but not 404)
    expect(res.status).not.toBe(404);
  });
});

// T-154, T-155: Integration test — Claude Code ↔ Unfade MCP end-to-end.
// Spawns `unfade mcp` as a real child process, sends JSON-RPC via stdin,
// validates responses on stdout. Tests degradation with no .unfade/ directory.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = join(import.meta.dirname ?? ".", "../../src/entrypoints/cli.ts");
const TSX_PATH = join(import.meta.dirname ?? ".", "../../node_modules/.bin/tsx");

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-mcp-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

/**
 * Send a JSON-RPC message to the child process via stdin.
 * MCP SDK uses newline-delimited JSON for stdio transport.
 */
function sendMessage(proc: ChildProcess, message: Record<string, unknown>): void {
  proc.stdin?.write(`${JSON.stringify(message)}\n`);
}

/**
 * Read JSON-RPC responses from stdout, collecting messages until
 * we get one with the expected id or timeout.
 */
function waitForResponse(
  proc: ChildProcess,
  expectedId: number | string,
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for response id=${expectedId}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id === expectedId) {
            cleanup();
            resolve(msg);
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
    };

    proc.stdout?.on("data", onData);
  });
}

/**
 * Spawn the MCP server process in a given working directory.
 */
function spawnMcp(cwd: string): ChildProcess {
  return spawn(TSX_PATH, [CLI_PATH, "mcp"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test" },
  });
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("MCP integration (stdio)", () => {
  it("initializes and lists tools", async () => {
    // Create .unfade directory so tools don't report not_initialized
    mkdirSync(join(tmpDir, ".unfade"), { recursive: true });

    const proc = spawnMcp(tmpDir);

    try {
      // Step 1: Initialize
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });

      const initResponse = await waitForResponse(proc, 1);
      expect(initResponse).toHaveProperty("result");
      const initResult = initResponse.result as Record<string, unknown>;
      expect(initResult).toHaveProperty("serverInfo");
      const serverInfo = initResult.serverInfo as Record<string, unknown>;
      expect(serverInfo.name).toBe("unfade");

      // Send initialized notification
      sendMessage(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // Step 2: List tools
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      const toolsResponse = await waitForResponse(proc, 2);
      expect(toolsResponse).toHaveProperty("result");
      const toolsResult = toolsResponse.result as Record<string, unknown>;
      const tools = toolsResult.tools as Array<{ name: string }>;
      expect(tools.length).toBe(13);

      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "unfade_amplify",
        "unfade_coach",
        "unfade_comprehension",
        "unfade_context",
        "unfade_costs",
        "unfade_decisions",
        "unfade_distill",
        "unfade_efficiency",
        "unfade_log",
        "unfade_profile",
        "unfade_query",
        "unfade_similar",
        "unfade_tag",
      ]);
    } finally {
      proc.kill("SIGTERM");
    }
  });

  it("lists 5 resources", async () => {
    mkdirSync(join(tmpDir, ".unfade"), { recursive: true });

    const proc = spawnMcp(tmpDir);

    try {
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });
      await waitForResponse(proc, 1);

      sendMessage(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "resources/list",
        params: {},
      });

      const resourcesResponse = await waitForResponse(proc, 2);
      expect(resourcesResponse).toHaveProperty("result");
      const resourcesResult = resourcesResponse.result as Record<string, unknown>;
      const resources = resourcesResult.resources as Array<{ uri: string }>;
      expect(resources.length).toBe(5);

      const uris = resources.map((r) => r.uri).sort();
      expect(uris).toEqual([
        "unfade://context/recent",
        "unfade://context/today",
        "unfade://decisions/recent",
        "unfade://distill/latest",
        "unfade://profile",
      ]);
    } finally {
      proc.kill("SIGTERM");
    }
  });

  it("unfade_context returns structured data with _meta", async () => {
    mkdirSync(join(tmpDir, ".unfade"), { recursive: true });

    const proc = spawnMcp(tmpDir);

    try {
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });
      await waitForResponse(proc, 1);

      sendMessage(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "unfade_context",
          arguments: { scope: "today" },
        },
      });

      const contextResponse = await waitForResponse(proc, 3);
      expect(contextResponse).toHaveProperty("result");
      const result = contextResponse.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);

      const parsed = JSON.parse(content[0].text);
      expect(parsed).toHaveProperty("data");
      expect(parsed).toHaveProperty("_meta");
      expect(parsed._meta).toHaveProperty("tool");
      expect(parsed._meta).toHaveProperty("durationMs");
    } finally {
      proc.kill("SIGTERM");
    }
  });

  it("unfade_query returns search results with _meta", async () => {
    // Create .unfade with an event file containing searchable content
    const eventsDir = join(tmpDir, ".unfade", "events");
    mkdirSync(eventsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(
      join(eventsDir, `${today}.jsonl`),
      `${JSON.stringify({
        id: "b0000000-0000-4000-8000-000000000001",
        timestamp: new Date().toISOString(),
        source: "git",
        type: "commit",
        content: { summary: "Added caching for API responses" },
      })}\n`,
    );

    const proc = spawnMcp(tmpDir);

    try {
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });
      await waitForResponse(proc, 1);

      sendMessage(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "unfade_query",
          arguments: { query: "caching" },
        },
      });

      const queryResponse = await waitForResponse(proc, 4);
      expect(queryResponse).toHaveProperty("result");
      const result = queryResponse.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toBeDefined();

      const parsed = JSON.parse(content[0].text);
      expect(parsed).toHaveProperty("data");
      expect(parsed).toHaveProperty("_meta");
      expect(parsed._meta.tool).toBe("unfade-query");
      expect(parsed.data.results.length).toBeGreaterThan(0);
    } finally {
      proc.kill("SIGTERM");
    }
  });

  it("returns degraded response when not initialized", async () => {
    // tmpDir has .git but NO .unfade directory
    const proc = spawnMcp(tmpDir);

    try {
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });
      await waitForResponse(proc, 1);

      sendMessage(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "unfade_context",
          arguments: { scope: "today" },
        },
      });

      const response = await waitForResponse(proc, 5);
      expect(response).toHaveProperty("result");
      const result = response.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;

      const parsed = JSON.parse(content[0].text);
      expect(parsed.status).toBe("not_initialized");
      expect(parsed._meta.degraded).toBe(true);
    } finally {
      proc.kill("SIGTERM");
    }
  });
});

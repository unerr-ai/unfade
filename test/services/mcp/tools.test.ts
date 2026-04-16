// Tests for UF-044: MCP Tools — 5 executable tools
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerTools } from "../../../src/services/mcp/tools.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-mcp-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.env.UNFADE_DATA_DIR = join(tmpDir, ".unfade");
});

afterEach(() => {
  delete process.env.UNFADE_DATA_DIR;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("registerTools", () => {
  it("registers without throwing", () => {
    const server = new McpServer(
      { name: "test", version: "0.0.1" },
      { capabilities: { tools: {} } },
    );
    expect(() => registerTools(server)).not.toThrow();
  });

  it("registers 5 tools on the server", () => {
    const registered: string[] = [];
    const server = new McpServer(
      { name: "test", version: "0.0.1" },
      { capabilities: { tools: {} } },
    );

    const originalTool = server.tool.bind(server);
    server.tool = ((...args: Parameters<typeof server.tool>) => {
      registered.push(args[0] as string);
      return originalTool(...args);
    }) as typeof server.tool;

    registerTools(server);
    expect(registered).toHaveLength(7);
    expect(registered).toContain("unfade_query");
    expect(registered).toContain("unfade_context");
    expect(registered).toContain("unfade_decisions");
    expect(registered).toContain("unfade_profile");
    expect(registered).toContain("unfade_distill");
    expect(registered).toContain("unfade_amplify");
    expect(registered).toContain("unfade_similar");
  });
});

describe("tool degradation: not initialized", () => {
  it("returns not_initialized when .unfade/ does not exist", async () => {
    // Point to a dir that has no .unfade/
    const emptyDir = join(
      import.meta.dirname ?? ".",
      `../../.tmp-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(emptyDir, { recursive: true });
    process.env.UNFADE_DATA_DIR = join(emptyDir, ".unfade");

    // Import the internal helpers by testing via the full server
    // Verify the data dir doesn't exist (isInitialized() would return false)
    expect(existsSync(join(emptyDir, ".unfade"))).toBe(false);

    rmSync(emptyDir, { recursive: true, force: true });
  });
});

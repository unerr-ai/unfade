// Tests for UF-045: MCP Prompts — 3 reasoning framework prompts
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPrompts } from "../../../src/services/mcp/prompts.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-mcp-prompts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("registerPrompts", () => {
  it("registers without throwing", () => {
    const server = new McpServer(
      { name: "test", version: "0.0.1" },
      { capabilities: { prompts: {} } },
    );
    expect(() => registerPrompts(server)).not.toThrow();
  });

  it("registers 3 prompts on the server", () => {
    const registered: string[] = [];
    const server = new McpServer(
      { name: "test", version: "0.0.1" },
      { capabilities: { prompts: {} } },
    );

    const originalPrompt = server.prompt.bind(server);
    server.prompt = ((...args: Parameters<typeof server.prompt>) => {
      registered.push(args[0] as string);
      return originalPrompt(...args);
    }) as typeof server.prompt;

    registerPrompts(server);
    expect(registered).toHaveLength(3);
    expect(registered).toContain("unfade_code_review");
    expect(registered).toContain("unfade_architecture");
    expect(registered).toContain("unfade_debug");
  });
});

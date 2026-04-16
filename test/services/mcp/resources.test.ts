// Tests for UF-043: MCP Resources — 5 read-only resources
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerResources } from "../../../src/services/mcp/resources.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-mcp-res-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("registerResources", () => {
  it("registers without throwing", () => {
    const server = new McpServer(
      { name: "test", version: "0.0.1" },
      { capabilities: { resources: {} } },
    );
    expect(() => registerResources(server)).not.toThrow();
  });

  it("registers 5 resources on the server", () => {
    const registered: string[] = [];
    const server = new McpServer(
      { name: "test", version: "0.0.1" },
      { capabilities: { resources: {} } },
    );

    // Spy on resource registration by wrapping
    const originalResource = server.resource.bind(server);
    server.resource = ((...args: Parameters<typeof server.resource>) => {
      registered.push(args[0] as string);
      return originalResource(...args);
    }) as typeof server.resource;

    registerResources(server);
    expect(registered).toHaveLength(5);
    expect(registered).toContain("recent-context");
    expect(registered).toContain("today-context");
    expect(registered).toContain("reasoning-profile");
    expect(registered).toContain("recent-decisions");
    expect(registered).toContain("latest-distill");
  });
});

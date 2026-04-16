// T-149: Web UI — GET /settings returns settings page with "Connect AI Tools" MCP snippets
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-settings-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("Settings page (GET /settings)", () => {
  it("returns HTML page with settings title", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Settings");
  });

  it("includes Connect AI Tools section with mcpServers config", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Connect AI Tools");
    expect(html).toContain("mcpServers");
  });

  it("includes Claude Code config snippet", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Claude Code");
    expect(html).toContain("~/.claude/settings.json");
    expect(html).toContain("unfade");
  });

  it("includes Cursor config snippet", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Cursor");
    expect(html).toContain(".cursor/mcp.json");
  });

  it("includes Windsurf config snippet", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Windsurf");
  });

  it("includes generic MCP client config", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Generic MCP Client");
    expect(html).toContain("stdio");
  });

  it("shows capture engine status", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("capture engine");
    expect(html).toContain("Status");
  });

  it("uses npx unfade mcp in all config snippets", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    // The config shows "npx" and "unfade", "mcp" as command/args
    expect(html).toContain("npx");
    // At least 4 config blocks (Claude, Cursor, Windsurf, Generic)
    const matches = html.match(/unfade.*mcp/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBeGreaterThanOrEqual(4);
  });
});

// T-149: Web UI — GET /settings returns settings page with LLM config and integrations link
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/setup-state.js", () => ({
  isSetupComplete: () => true,
  invalidateSetupCache: () => {},
}));

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

  it("includes Connect AI Tools section with integrations link", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Connect AI Tools");
    expect(html).toContain("/integrations");
    expect(html).toContain("Manage Integrations");
  });

  it("includes LLM provider form", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("LLM Provider");
    expect(html).toContain("provider");
    expect(html).toContain("ollama");
  });

  it("shows capture engine status", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("capture engine");
    expect(html).toContain("Status");
  });

  it("shows capture sources section", async () => {
    const app = createApp();
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Capture Sources");
    expect(html).toContain("Git commits");
    expect(html).toContain("AI sessions");
  });
});

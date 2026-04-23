// T-146: Web UI — GET / returns Home page with new shell (Phase 7 rewrite)
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
    `../../.tmp-dash-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("Home page (GET /)", () => {
  it("returns HTML with new shell structure", async () => {
    const app = createApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Home");
    expect(html).toContain("sidebar");
  });

  it("includes shared client for SSE (local bundle)", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("/public/js/unfade-core.js");
    expect(html).toContain('id="live-dot"');
  });

  it("includes htmx script tag", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("/public/js/htmx.min.js");
  });

  it("includes sidebar nav links", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('href="/intelligence"');
    expect(html).toContain('href="/decisions"');
    expect(html).toContain('href="/settings"');
  });

  it("includes home activation and dashboard structure", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('id="home-root"');
    expect(html).toContain('data-session-id="');
    expect(html).toContain("Event stream");
    expect(html).toContain("System health");
  });
});

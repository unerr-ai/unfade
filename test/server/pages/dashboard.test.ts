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

  it("includes SSE connection in layout", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("EventSource");
    expect(html).toContain("/api/stream");
  });

  it("includes htmx script tag", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("htmx.org");
  });

  it("includes sidebar nav links", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('href="/intelligence"');
    expect(html).toContain('href="/coach"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('href="/portfolio"');
  });

  it("shows loading state before summary is available", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("intelligence layer");
  });
});

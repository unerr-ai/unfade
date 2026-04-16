// T-146: Web UI — GET / returns dashboard HTML page with status and distill summary
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("Dashboard page (GET /)", () => {
  it("returns HTML with status and stat grid", async () => {
    const app = createApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Dashboard");
    expect(html).toContain("stat-grid");
  });

  it("includes reasoning signals count", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("reasoning signals");
  });

  it("includes htmx script tag", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("htmx.org");
  });

  it("includes nav bar links", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('href="/distill"');
    expect(html).toContain('href="/profile"');
    expect(html).toContain('href="/settings"');
  });

  it("shows distill empty state when no distills exist", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("No distill for today yet");
  });
});

// Tests for UF-069: Search web UI page
// T-185
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/setup-state.js", () => ({
  isSetupComplete: () => true,
  invalidateSetupCache: () => {},
}));

import { createApp } from "../../../src/server/http.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-search-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeAll(() => {
  originalCwd = process.cwd();
});

afterAll(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Decisions page (GET /decisions — replaces Search)", () => {
  it("T-185: renders decisions interface", async () => {
    const app = createApp();
    const res = await app.request("/decisions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Decisions");
    expect(html).toContain("placeholder");
  });

  it("/search redirects to /decisions", async () => {
    const app = createApp();
    const res = await app.request("/search", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/decisions");
  });

  it("nav bar includes Decisions link", async () => {
    const app = createApp();
    const res = await app.request("/decisions");
    const html = await res.text();
    expect(html).toContain('href="/decisions"');
  });

  it("includes htmx script", async () => {
    const app = createApp();
    const res = await app.request("/decisions");
    const html = await res.text();
    expect(html).toContain("htmx.min.js");
  });
});

describe("Similar API (GET /unfade/similar)", () => {
  it("returns JSON results for problem query", async () => {
    // Set up distill data
    const distillsDir = join(tmpDir, ".unfade", "distills");
    mkdirSync(distillsDir, { recursive: true });
    writeFileSync(
      join(distillsDir, "2026-04-15.md"),
      [
        "# Daily Distill",
        "",
        "## Decisions",
        "",
        "- **Chose Redis for cache** [infrastructure]",
        "  _Fast lookups needed_",
      ].join("\n"),
    );

    const app = createApp();
    const res = await app.request("/unfade/similar?problem=cache+backend+selection");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.results).toBeDefined();
    expect(json._meta.tool).toBe("unfade-similar");
  });

  it("returns 400 when problem is missing", async () => {
    const app = createApp();
    const res = await app.request("/unfade/similar");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json._meta.degraded).toBe(true);
  });
});

describe("Amplify API (GET /unfade/amplify)", () => {
  it("returns JSON results for date query", async () => {
    const app = createApp();
    const res = await app.request("/unfade/amplify?date=2026-04-15");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.date).toBe("2026-04-15");
    expect(json.data.connections).toBeDefined();
    expect(json._meta.tool).toBe("unfade-amplify");
  });

  it("returns 400 when date is missing", async () => {
    const app = createApp();
    const res = await app.request("/unfade/amplify");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json._meta.degraded).toBe(true);
  });

  it("returns 400 for invalid date format", async () => {
    const app = createApp();
    const res = await app.request("/unfade/amplify?date=not-a-date");
    expect(res.status).toBe(400);
  });
});

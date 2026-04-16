// T-147: Web UI — GET /distill returns distill viewer with hx-post re-generate button
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-distill-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Distill page (GET /distill)", () => {
  it("returns HTML page with re-generate button using hx-post", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/distill");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("hx-post");
    expect(html).toContain("/unfade/distill");
  });

  it("shows empty state when no distills exist", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/distill");
    const html = await res.text();
    expect(html).toContain("No Daily Distill for");
  });

  it("renders distill content when file exists", async () => {
    const distillsDir = join(tmpDir, ".unfade", "distills");
    mkdirSync(distillsDir, { recursive: true });
    writeFileSync(
      join(distillsDir, "2026-04-16.md"),
      "# Test Distill\n\n> Summary of the day\n\n## Decisions\n\n- **Chose Hono** for HTTP\n",
    );

    // Mock paths to point to tmp dir
    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getDistillsDir: () => distillsDir,
      };
    });

    // Clear module cache so the mock is picked up
    vi.resetModules();
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/distill?date=2026-04-16");
    const html = await res.text();
    expect(html).toContain("Test Distill");
    expect(html).toContain("distill-content");
  });

  it("includes date navigation", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/distill?date=2026-04-16");
    const html = await res.text();
    expect(html).toContain("date-nav");
    expect(html).toContain("2026-04-16");
  });

  it("includes htmx re-generate button targeting #distill-status", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/distill");
    const html = await res.text();
    expect(html).toContain('hx-target="#distill-status"');
    expect(html).toContain('hx-swap="innerHTML"');
    expect(html).toContain("Re-generate");
  });
});

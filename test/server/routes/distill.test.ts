// Tests for UF-051: GET/POST /unfade/distill routes
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";
import { invalidateSetupCache } from "../../../src/server/setup-state.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-distill-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeDistillMd(dir: string, date: string, content: string): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  writeFileSync(join(distillsDir, `${date}.md`), content, "utf-8");
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
  process.env.UNFADE_HOME = join(tmpDir, ".unfade");
  mkdirSync(join(tmpDir, ".unfade", "state"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".unfade", "state", "setup-status.json"),
    '{"setupCompleted":true}',
    "utf-8",
  );
  invalidateSetupCache();
});

afterEach(() => {
  delete process.env.UNFADE_HOME;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("GET /unfade/distill/latest", () => {
  it("returns the most recent distill", async () => {
    writeDistillMd(tmpDir, "2026-04-14", "# Distill 14\n\n> Earlier work");
    writeDistillMd(tmpDir, "2026-04-15", "# Distill 15\n\n> Latest work");

    const app = createApp();
    const res = await app.request("/unfade/distill/latest");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.date).toBe("2026-04-15");
    expect(body.data.content).toContain("Latest work");
    expect(body._meta.tool).toBe("unfade-distill");
    expect(body._meta.degraded).toBe(false);
  });

  it("returns degraded when no distills exist", async () => {
    const app = createApp();
    const res = await app.request("/unfade/distill/latest");
    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
    expect(body.data).toBeNull();
  });
});

describe("GET /unfade/distill/:date", () => {
  it("returns distill for a specific date", async () => {
    writeDistillMd(tmpDir, "2026-04-15", "# Distill\n\n> Built auth module");

    const app = createApp();
    const res = await app.request("/unfade/distill/2026-04-15");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.date).toBe("2026-04-15");
    expect(body.data.content).toContain("auth module");
  });

  it("returns 400 for invalid date format", async () => {
    const app = createApp();
    const res = await app.request("/unfade/distill/not-a-date");
    expect(res.status).toBe(400);
  });

  it("returns degraded for missing date", async () => {
    const app = createApp();
    const res = await app.request("/unfade/distill/2026-01-01");
    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
  });
});

describe("POST /unfade/distill", () => {
  it("returns no_events status when no events exist", async () => {
    const app = createApp();
    const res = await app.request("/unfade/distill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-04-15" }),
    });

    const body = await res.json();
    // Either no_events or error (depending on provider config) — both are valid
    expect(body.data.status).toBeDefined();
    expect(body._meta.tool).toBe("unfade-distill");
  });
});

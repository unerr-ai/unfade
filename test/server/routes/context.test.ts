// Tests for UF-051: GET /unfade/context route
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-ctx-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeEvent(dir: string, date: string, event: Record<string, unknown>): void {
  const eventsDir = join(dir, ".unfade", "events");
  mkdirSync(eventsDir, { recursive: true });
  writeFileSync(join(eventsDir, `${date}.jsonl`), `${JSON.stringify(event)}\n`, { flag: "a" });
}

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: "git",
    type: "commit",
    content: { summary: "Added auth module", project: "unfade" },
    ...overrides,
  };
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

describe("GET /unfade/context", () => {
  it("returns context with default scope (today)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    writeEvent(tmpDir, today, makeEvent());

    const app = createApp();
    const res = await app.request("/unfade/context");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.scope).toBe("today");
    expect(body.data.eventCount).toBe(1);
    expect(body._meta.tool).toBe("unfade-context");
    expect(body._meta.degraded).toBe(false);
  });

  it("accepts scope query parameter", async () => {
    const app = createApp();
    const res = await app.request("/unfade/context?scope=this_week");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.scope).toBe("this_week");
  });

  it("returns 400 for invalid scope", async () => {
    const app = createApp();
    const res = await app.request("/unfade/context?scope=invalid");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
  });

  it("all JSON responses include _meta envelope", async () => {
    const app = createApp();
    const res = await app.request("/unfade/context");
    const body = await res.json();
    expect(body._meta).toBeDefined();
    expect(body._meta.tool).toBeDefined();
    expect(typeof body._meta.durationMs).toBe("number");
    expect(typeof body._meta.degraded).toBe("boolean");
  });
});

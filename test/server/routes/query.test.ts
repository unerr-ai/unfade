// Tests for UF-051: GET /unfade/query route
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-query-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    timestamp: "2026-04-15T10:00:00Z",
    source: "git",
    type: "commit",
    content: { summary: "Added caching layer for API responses" },
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

describe("GET /unfade/query", () => {
  it("returns search results for matching events", async () => {
    writeEvent(tmpDir, "2026-04-15", makeEvent());

    const app = createApp();
    const res = await app.request("/unfade/query?q=caching");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.results.length).toBeGreaterThan(0);
    expect(body._meta.tool).toBe("unfade-query");
  });

  it("returns 400 for missing query", async () => {
    const app = createApp();
    const res = await app.request("/unfade/query?q=");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      writeEvent(tmpDir, "2026-04-15", makeEvent({ id: crypto.randomUUID() }));
    }

    const app = createApp();
    const res = await app.request("/unfade/query?q=caching&limit=2");
    const body = await res.json();
    expect(body.data.results.length).toBe(2);
    expect(body.data.total).toBe(5);
  });

  it("supports date range parameters", async () => {
    writeEvent(
      tmpDir,
      "2026-04-10",
      makeEvent({ id: crypto.randomUUID(), timestamp: "2026-04-10T10:00:00Z" }),
    );
    writeEvent(
      tmpDir,
      "2026-04-15",
      makeEvent({ id: crypto.randomUUID(), timestamp: "2026-04-15T10:00:00Z" }),
    );

    const app = createApp();
    const res = await app.request("/unfade/query?q=caching&from=2026-04-14&to=2026-04-16");
    const body = await res.json();
    expect(body.data.results.length).toBe(1);
    expect(body.data.results[0].date).toBe("2026-04-15");
  });
});

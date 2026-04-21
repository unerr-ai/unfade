// Tests for UF-052: Query engine
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queryEvents } from "../../src/tools/unfade-query.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../.tmp-query-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeEvent(dir: string, date: string, event: Record<string, unknown>): void {
  const eventsDir = join(dir, ".unfade", "events");
  mkdirSync(eventsDir, { recursive: true });
  const filePath = join(eventsDir, `${date}.jsonl`);
  writeFileSync(filePath, `${JSON.stringify(event)}\n`, { flag: "a" });
}

function writeDistillMd(dir: string, date: string, content: string): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  writeFileSync(join(distillsDir, `${date}.md`), content, "utf-8");
}

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    projectId: "test-project-id",
    timestamp: "2026-04-15T10:00:00Z",
    source: "git",
    type: "commit",
    content: { summary: "Added caching layer for API responses", detail: "Redis integration" },
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("queryEvents", () => {
  it("returns empty results when no data exists", () => {
    const result = queryEvents({ query: "caching", limit: 10 }, tmpDir);
    expect(result.data.results).toEqual([]);
    expect(result.data.total).toBe(0);
    expect(result._meta.tool).toBe("unfade-query");
    expect(result._meta.degraded).toBe(false);
  });

  it("finds matching events by keyword", () => {
    writeEvent(tmpDir, "2026-04-15", makeEvent());
    writeEvent(
      tmpDir,
      "2026-04-15",
      makeEvent({
        id: crypto.randomUUID(),
        content: { summary: "Fixed login bug" },
      }),
    );

    const result = queryEvents({ query: "caching", limit: 10 }, tmpDir);
    expect(result.data.results.length).toBe(1);
    expect(result.data.results[0].source).toBe("event");
    expect(result.data.results[0].summary).toContain("caching");
  });

  it("finds matching distills by keyword", () => {
    writeDistillMd(
      tmpDir,
      "2026-04-15",
      [
        "# Daily Distill — 2026-04-15",
        "",
        "> Built caching layer and integrated Redis",
        "",
        "## Decisions",
        "",
        "- **Added Redis caching** [backend]",
        "  _Performance requirement_",
      ].join("\n"),
    );

    const result = queryEvents({ query: "caching", limit: 10 }, tmpDir);
    expect(result.data.results.length).toBeGreaterThan(0);
    const distillResult = result.data.results.find((r) => r.source === "distill");
    expect(distillResult).toBeDefined();
  });

  it("respects date range filter", () => {
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

    const result = queryEvents(
      { query: "caching", dateRange: { from: "2026-04-14", to: "2026-04-16" }, limit: 10 },
      tmpDir,
    );
    expect(result.data.results.length).toBe(1);
    expect(result.data.results[0].date).toBe("2026-04-15");
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      writeEvent(tmpDir, "2026-04-15", makeEvent({ id: crypto.randomUUID() }));
    }

    const result = queryEvents({ query: "caching", limit: 2 }, tmpDir);
    expect(result.data.results.length).toBe(2);
    expect(result.data.total).toBe(5);
  });

  it("returns results sorted by score descending", () => {
    writeEvent(
      tmpDir,
      "2026-04-15",
      makeEvent({
        id: crypto.randomUUID(),
        content: { summary: "caching caching caching everywhere" },
      }),
    );
    writeEvent(
      tmpDir,
      "2026-04-15",
      makeEvent({
        id: crypto.randomUUID(),
        content: { summary: "minor caching fix" },
      }),
    );

    const result = queryEvents({ query: "caching", limit: 10 }, tmpDir);
    expect(result.data.results.length).toBe(2);
    expect(result.data.results[0].score).toBeGreaterThanOrEqual(result.data.results[1].score);
  });

  it("returns empty for whitespace-only query", () => {
    writeEvent(tmpDir, "2026-04-15", makeEvent());
    const result = queryEvents({ query: "   ", limit: 10 }, tmpDir);
    expect(result.data.results).toEqual([]);
  });

  it("includes durationMs in _meta", () => {
    const result = queryEvents({ query: "test", limit: 10 }, tmpDir);
    expect(result._meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes lastUpdated from file mtimes", () => {
    writeEvent(tmpDir, "2026-04-15", makeEvent());
    const result = queryEvents({ query: "caching", limit: 10 }, tmpDir);
    expect(result._meta.lastUpdated).not.toBeNull();
  });
});

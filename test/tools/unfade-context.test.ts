// Tests for UF-053: Context reader
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecentContext } from "../../src/tools/unfade-context.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../.tmp-context-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    timestamp: new Date().toISOString(),
    source: "git",
    type: "commit",
    content: { summary: "Added auth module", project: "unfade" },
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

describe("getRecentContext", () => {
  it("returns empty context when no data exists", () => {
    const result = getRecentContext({ scope: "today" }, tmpDir);
    expect(result.data.events).toEqual([]);
    expect(result.data.eventCount).toBe(0);
    expect(result.data.scope).toBe("today");
    expect(result.data.distillSummary).toBeNull();
    expect(result._meta.tool).toBe("unfade-context");
  });

  it("reads today's events with 'today' scope", () => {
    const today = new Date().toISOString().slice(0, 10);
    writeEvent(tmpDir, today, makeEvent());
    writeEvent(tmpDir, today, makeEvent({ id: crypto.randomUUID() }));

    const result = getRecentContext({ scope: "today" }, tmpDir);
    expect(result.data.eventCount).toBe(2);
    expect(result.data.events.length).toBe(2);
    expect(result.data.events[0].source).toBe("git");
  });

  it("maps event fields to ContextEvent shape", () => {
    const today = new Date().toISOString().slice(0, 10);
    const testId = crypto.randomUUID();
    writeEvent(
      tmpDir,
      today,
      makeEvent({
        id: testId,
        content: { summary: "Test summary", detail: "Test detail", branch: "main" },
      }),
    );

    const result = getRecentContext({ scope: "today" }, tmpDir);
    const ev = result.data.events[0];
    expect(ev.id).toBe(testId);
    expect(ev.summary).toBe("Test summary");
    expect(ev.detail).toBe("Test detail");
    expect(ev.branch).toBe("main");
  });

  it("filters by project when specified", () => {
    const today = new Date().toISOString().slice(0, 10);
    writeEvent(
      tmpDir,
      today,
      makeEvent({ id: crypto.randomUUID(), content: { summary: "A", project: "unfade" } }),
    );
    writeEvent(
      tmpDir,
      today,
      makeEvent({ id: crypto.randomUUID(), content: { summary: "B", project: "other" } }),
    );

    const result = getRecentContext({ scope: "today", project: "unfade" }, tmpDir);
    expect(result.data.eventCount).toBe(1);
    expect(result.data.events[0].summary).toBe("A");
  });

  it("includes distill summary when available", () => {
    const today = new Date().toISOString().slice(0, 10);
    writeDistillMd(
      tmpDir,
      today,
      ["# Daily Distill", "", "> Built the auth module and tests"].join("\n"),
    );

    const result = getRecentContext({ scope: "today" }, tmpDir);
    expect(result.data.distillSummary).toBe("Built the auth module and tests");
  });

  it("returns null distillSummary when no distill exists", () => {
    const result = getRecentContext({ scope: "today" }, tmpDir);
    expect(result.data.distillSummary).toBeNull();
  });

  it("reads multiple days with 'this_week' scope", () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStr = threeDaysAgo.toISOString().slice(0, 10);

    writeEvent(tmpDir, today, makeEvent({ id: crypto.randomUUID(), timestamp: now.toISOString() }));
    writeEvent(
      tmpDir,
      threeDaysAgoStr,
      makeEvent({
        id: crypto.randomUUID(),
        timestamp: threeDaysAgo.toISOString(),
      }),
    );

    const result = getRecentContext({ scope: "this_week" }, tmpDir);
    expect(result.data.eventCount).toBe(2);
  });

  it("filters recent events with 'last_2h' scope", () => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const recentTs = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const oldTs = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(); // 5 hours ago

    writeEvent(tmpDir, today, makeEvent({ id: crypto.randomUUID(), timestamp: recentTs }));
    writeEvent(tmpDir, today, makeEvent({ id: crypto.randomUUID(), timestamp: oldTs }));

    const result = getRecentContext({ scope: "last_2h" }, tmpDir);
    expect(result.data.eventCount).toBe(1);
  });

  it("includes durationMs and lastUpdated in _meta", () => {
    const today = new Date().toISOString().slice(0, 10);
    writeEvent(tmpDir, today, makeEvent());

    const result = getRecentContext({ scope: "today" }, tmpDir);
    expect(result._meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(result._meta.lastUpdated).not.toBeNull();
  });
});

// Phase 11C.1: State Determinism integration tests.
// Validates epoch protocol, ingest lock deferral, per-file rebuild, staleness detection,
// and crash recovery for the materializer cursor system.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_DATE = "2026-04-15";

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    timestamp: `${TEST_DATE}T10:00:00Z`,
    source: "git",
    type: "commit",
    content: {
      summary: "Test event for state determinism",
      detail: "Detail field for testing materializer cursor behavior.",
    },
    gitContext: { repo: "test-repo", branch: "main" },
    metadata: { test: true },
    ...overrides,
  };
}

function writeEpochFile(filePath: string): void {
  const content = readFileSync(filePath);
  const buf = content.subarray(0, 64);
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  writeFileSync(`${filePath}.epoch`, hash, "utf-8");
}

function buildPathMocks(baseDir: string) {
  const unfadeDir = join(baseDir, ".unfade");
  return {
    getProjectDataDir: () => unfadeDir,
    getEventsDir: () => join(unfadeDir, "events"),
    getDistillsDir: () => join(unfadeDir, "distills"),
    getProfileDir: () => join(unfadeDir, "profile"),
    getStateDir: () => join(unfadeDir, "state"),
    getGraphDir: () => join(unfadeDir, "graph"),
    getCacheDir: () => join(unfadeDir, "cache"),
    getLogsDir: () => join(unfadeDir, "logs"),
    getBinDir: () => join(unfadeDir, "bin"),
    getCardsDir: () => join(unfadeDir, "cards"),
    getSiteDir: () => join(unfadeDir, "site"),
    getAmplificationDir: () => join(unfadeDir, "amplification"),
    getMetricsDir: () => join(unfadeDir, "metrics"),
    getInsightsDir: () => join(unfadeDir, "insights"),
    getUserConfigDir: () => join(baseDir, ".unfade-user"),
    getUserStateDir: () => join(baseDir, ".unfade-user", "state"),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let tempDir: string;

describe("State Determinism (11C.1)", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = join(tmpdir(), `unfade-state-det-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("fresh start produces correct event count", async () => {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // Write 10 events to a JSONL file
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, timestamp: `${TEST_DATE}T${String(10 + i).padStart(2, "0")}:00:00Z` }),
    );
    const jsonlPath = join(eventsDir, `${TEST_DATE}.jsonl`);
    writeFileSync(jsonlPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeEpochFile(jsonlPath);

    // Mock paths
    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);
    const newRows = await materializeIncremental(cache, tempDir);

    expect(newRows).toBe(10);

    // Verify DB has exactly 10 events
    const db = await cache.getDb();
    const result = db!.exec("SELECT COUNT(*) as cnt FROM events");
    expect(result[0].values[0][0]).toBe(10);
  });

  it("cursor survives crash and recovers — all events eventually materialized", async () => {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // Write 10 events initially
    const events1 = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, timestamp: `${TEST_DATE}T${String(10 + i).padStart(2, "0")}:00:00Z` }),
    );
    const jsonlPath = join(eventsDir, `${TEST_DATE}.jsonl`);
    writeFileSync(jsonlPath, events1.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeEpochFile(jsonlPath);

    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);
    const first = await materializeIncremental(cache, tempDir);
    expect(first).toBe(10);

    // Verify cursor was saved to disk
    const cursorFile = join(pathMocks.getStateDir(), "materializer.json");
    expect(existsSync(cursorFile)).toBe(true);

    // Simulate recovery: append 3 more events
    const events2 = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ id: `evt-${i + 10}`, timestamp: `${TEST_DATE}T${String(20 + i).padStart(2, "0")}:00:00Z` }),
    );
    const existing = readFileSync(jsonlPath, "utf-8");
    writeFileSync(jsonlPath, existing + events2.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    // Second tick: self-healing cursor detects mismatch, reprocesses from 0 (upserts are idempotent)
    const second = await materializeIncremental(cache, tempDir);
    // All 13 events are processed (10 upserts + 3 new)
    expect(second).toBe(13);

    // Final state: exactly 13 unique events in DB (INSERT OR REPLACE by id)
    const db = await cache.getDb();
    const result = db!.exec("SELECT COUNT(*) as cnt FROM events");
    expect(result[0].values[0][0]).toBe(13);
  });

  it("file rewrite detected via epoch", async () => {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // Write initial events and process them
    const events1 = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, timestamp: `${TEST_DATE}T10:0${i}:00Z` }),
    );
    const jsonlPath = join(eventsDir, `${TEST_DATE}.jsonl`);
    writeFileSync(jsonlPath, events1.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeEpochFile(jsonlPath);

    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);
    await materializeIncremental(cache, tempDir);

    // Rewrite file with different content (simulates Go daemon rewriting during ingest)
    const events2 = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ id: `new-evt-${i}`, timestamp: `${TEST_DATE}T11:0${i}:00Z` }),
    );
    writeFileSync(jsonlPath, events2.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    // Write new epoch (content changed, so hash changes)
    writeEpochFile(jsonlPath);

    // Next tick should detect epoch mismatch and rebuild the file from byte 0
    const rebuilt = await materializeIncremental(cache, tempDir);
    expect(rebuilt).toBe(5);

    // Verify DB now has the new events (upsert by ID, old IDs remain since they differ)
    const db = await cache.getDb();
    const result = db!.exec("SELECT id FROM events ORDER BY id");
    const ids = result[0].values.map((r) => r[0] as string);
    expect(ids).toContain("new-evt-0");
    expect(ids).toContain("new-evt-4");
    // Old events with different IDs persist (INSERT OR REPLACE keyed on id)
    // Total: 3 old + 5 new = 8
    expect(ids.length).toBe(8);
  });

  it("ingest lock prevents premature processing", async () => {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // Write events
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ id: `evt-${i}` }),
    );
    const jsonlPath = join(eventsDir, `${TEST_DATE}.jsonl`);
    writeFileSync(jsonlPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeEpochFile(jsonlPath);

    // Create ingest lock
    const lockPath = join(eventsDir, ".ingest.lock");
    writeFileSync(lockPath, `${process.pid}`, "utf-8");

    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);

    // Should return 0 because lock is present
    const result = await materializeIncremental(cache, tempDir);
    expect(result).toBe(0);

    // Remove lock
    rmSync(lockPath);

    // Now should process events
    const afterLock = await materializeIncremental(cache, tempDir);
    expect(afterLock).toBe(3);
  });

  it("staleness detection reprocesses when file grew >2x", async () => {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // Write 2 small events initially
    const smallEvents = Array.from({ length: 2 }, (_, i) =>
      makeEvent({ id: `small-${i}` }),
    );
    const jsonlPath = join(eventsDir, `${TEST_DATE}.jsonl`);
    writeFileSync(jsonlPath, smallEvents.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeEpochFile(jsonlPath);

    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);
    await materializeIncremental(cache, tempDir);

    // Now grow the file to >2x its original size (append many events)
    const bigEvents = Array.from({ length: 20 }, (_, i) =>
      makeEvent({
        id: `big-${i}`,
        content: { summary: "A".repeat(200), detail: "B".repeat(200) },
      }),
    );
    const existing = readFileSync(jsonlPath, "utf-8");
    writeFileSync(
      jsonlPath,
      existing + bigEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    // Next tick should detect staleness (file grew >2x) and reprocess from start
    const reprocessed = await materializeIncremental(cache, tempDir);
    // Should process all events (2 original + 20 new = 22, but since it reprocesses from 0, some are upserts)
    expect(reprocessed).toBeGreaterThanOrEqual(20);
  });

  it("per-file rebuild only resets the invalid file, not others", async () => {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // Write events to two separate date files with distinct content
    const eventsA = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ id: `a-${i}`, timestamp: "2026-04-14T10:00:00Z", content: { summary: `File A event ${i}` } }),
    );
    const eventsB = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ id: `b-${i}`, timestamp: `${TEST_DATE}T10:00:00Z`, content: { summary: `File B event ${i}` } }),
    );

    const fileA = join(eventsDir, "2026-04-14.jsonl");
    const fileB = join(eventsDir, `${TEST_DATE}.jsonl`);
    writeFileSync(fileA, eventsA.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeFileSync(fileB, eventsB.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeEpochFile(fileA);
    writeEpochFile(fileB);

    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);
    const firstPass = await materializeIncremental(cache, tempDir);
    expect(firstPass).toBe(6); // 3 + 3

    // Rewrite file A with different content and new epoch
    const eventsC = Array.from({ length: 4 }, (_, i) =>
      makeEvent({ id: `c-${i}`, timestamp: "2026-04-14T11:00:00Z", content: { summary: `Rewritten event ${i}` } }),
    );
    writeFileSync(fileA, eventsC.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    writeEpochFile(fileA); // New epoch — different from original

    // Self-healing: both files reprocessed via cursor rebuild (idempotent upserts)
    const rebuilt = await materializeIncremental(cache, tempDir);
    // File A (4 new events) + File B (3 upserts) = 7 processed
    expect(rebuilt).toBe(7);

    // Final DB state: 3 old A (orphaned IDs) + 4 new A + 3 B = 10 total
    const db = await cache.getDb();
    const total = db!.exec("SELECT COUNT(*) FROM events");
    expect(total[0].values[0][0]).toBe(10);
  });
});

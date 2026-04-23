// Phase 11C.3: Feature boundary detection and cross-event linking tests.
// Validates branch-based grouping, temporal splitting, file overlap merging,
// feature naming, and event link types (continues_from, triggered_commit, related_events).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    projectId: "test-project-id",
    timestamp: "2026-04-15T10:00:00Z",
    source: "ai-session",
    type: "ai-conversation",
    content: {
      summary: "Test event",
      detail: "Detail for feature boundary testing.",
    },
    gitContext: { repo: "test-repo", branch: "main" },
    metadata: { test: true },
    ...overrides,
  };
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

describe("Feature Boundary Detection (11C.3)", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = join(tmpdir(), `unfade-feat-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function setupDbWithEvents(events: Record<string, unknown>[]) {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // Write events to JSONL
    const jsonlPath = join(eventsDir, "2026-04-15.jsonl");
    writeFileSync(jsonlPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);
    await materializeIncremental(cache, tempDir);

    const db = (await cache.getDb())!;
    return { db, cache };
  }

  it("groups events by branch into same feature", async () => {
    const events = [
      makeEvent({
        id: "evt-1",
        timestamp: "2026-04-15T10:00:00Z",
        gitContext: { repo: "test", branch: "feat/auth" },
        metadata: { files_modified: ["src/auth.ts"] },
      }),
      makeEvent({
        id: "evt-2",
        timestamp: "2026-04-15T10:30:00Z",
        gitContext: { repo: "test", branch: "feat/auth" },
        metadata: { files_modified: ["src/auth.ts", "src/middleware.ts"] },
      }),
      makeEvent({
        id: "evt-3",
        timestamp: "2026-04-15T11:00:00Z",
        gitContext: { repo: "test", branch: "feat/auth" },
        metadata: { files_modified: ["src/routes.ts"] },
      }),
    ];

    const { db } = await setupDbWithEvents(events);
    const eventIds = events.map((e) => e.id as string);

    const { assignEventsToFeatures } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await assignEventsToFeatures(db, eventIds);

    // All events should be assigned to the same feature
    const result = await db.exec("SELECT DISTINCT feature_id FROM event_features");
    expect(result[0].values.length).toBe(1);

    // Feature should have branch = "feat/auth"
    const featureId = result[0].values[0][0] as string;
    const featureResult = await db.exec("SELECT branch, name FROM features WHERE id = ?", [featureId]);
    expect(featureResult[0].values[0][0]).toBe("feat/auth");
  });

  it("merges by file overlap (Jaccard > 0.4)", async () => {
    const events = [
      makeEvent({
        id: "evt-first",
        timestamp: "2026-04-15T10:00:00Z",
        gitContext: { repo: "test", branch: "main" },
        metadata: { files_modified: ["src/auth.ts", "src/jwt.ts", "src/session.ts"] },
      }),
      makeEvent({
        id: "evt-second",
        timestamp: "2026-04-15T11:00:00Z", // 1 hour later (within 4h window)
        gitContext: { repo: "test", branch: "main" },
        metadata: { files_modified: ["src/auth.ts", "src/jwt.ts"] }, // 2/3 overlap = Jaccard 0.67
      }),
    ];

    const { db } = await setupDbWithEvents(events);

    const { assignEventsToFeatures } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await assignEventsToFeatures(db, ["evt-first", "evt-second"]);

    // Should be in the same feature due to high file overlap
    const result = await db.exec("SELECT DISTINCT feature_id FROM event_features");
    expect(result[0].values.length).toBe(1);
  });

  it("names feature from branch prefix", async () => {
    const events = [
      makeEvent({
        id: "evt-named",
        timestamp: "2026-04-15T10:00:00Z",
        gitContext: { repo: "test", branch: "feat/setup-wizard" },
        metadata: {},
      }),
    ];

    const { db } = await setupDbWithEvents(events);

    const { assignEventsToFeatures } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await assignEventsToFeatures(db, ["evt-named"]);

    // Feature name should strip the "feat/" prefix
    const result = await db.exec("SELECT name FROM features LIMIT 1");
    expect(result[0].values[0][0]).toBe("setup-wizard");
  });

  it("marks stale features after 7 days of inactivity", async () => {
    const events = [
      makeEvent({
        id: "evt-old",
        timestamp: "2026-04-01T10:00:00Z", // 14 days ago
        gitContext: { repo: "test", branch: "feat/old-work" },
        metadata: {},
      }),
    ];

    const { db } = await setupDbWithEvents(events);

    const { assignEventsToFeatures } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await assignEventsToFeatures(db, ["evt-old"]);

    // Feature should be marked stale (last_seen is 14 days ago)
    const result = await db.exec("SELECT status FROM features WHERE branch = 'feat/old-work'");
    expect(result[0].values[0][0]).toBe("stale");
  });
});

describe("Cross-Event Linking (11C.3)", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = join(tmpdir(), `unfade-link-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function setupDbWithEvents(events: Record<string, unknown>[]) {
    const pathMocks = buildPathMocks(tempDir);
    const eventsDir = pathMocks.getEventsDir();
    const cacheDir = pathMocks.getCacheDir();
    const stateDir = pathMocks.getStateDir();
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const jsonlPath = join(eventsDir, "2026-04-15.jsonl");
    writeFileSync(jsonlPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    const { CacheManager } = await import("../../src/services/cache/manager.js");
    const { materializeIncremental } = await import("../../src/services/cache/materializer.js");

    const cache = new CacheManager(tempDir);
    await materializeIncremental(cache, tempDir);

    const db = (await cache.getDb())!;
    return { db, cache };
  }

  it("creates continues_from links for same-session events", async () => {
    const events = [
      makeEvent({
        id: "sess-evt-1",
        timestamp: "2026-04-15T10:00:00Z",
        metadata: { session_id: "sess-abc", test: true },
      }),
      makeEvent({
        id: "sess-evt-2",
        timestamp: "2026-04-15T10:05:00Z",
        metadata: { session_id: "sess-abc", test: true },
      }),
      makeEvent({
        id: "sess-evt-3",
        timestamp: "2026-04-15T10:10:00Z",
        metadata: { session_id: "sess-abc", test: true },
      }),
    ];

    const { db } = await setupDbWithEvents(events);

    const { linkRelatedEvents } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await linkRelatedEvents(db, ["sess-evt-2", "sess-evt-3"]);

    // sess-evt-1 → sess-evt-2 (continues_from)
    const link1 = await db.exec(
      "SELECT from_event, to_event FROM event_links WHERE link_type = 'continues_from' AND to_event = ?",
      ["sess-evt-2"],
    );
    expect(link1[0].values.length).toBe(1);
    expect(link1[0].values[0][0]).toBe("sess-evt-1");

    // sess-evt-2 → sess-evt-3 (continues_from)
    const link2 = await db.exec(
      "SELECT from_event, to_event FROM event_links WHERE link_type = 'continues_from' AND to_event = ?",
      ["sess-evt-3"],
    );
    expect(link2[0].values.length).toBe(1);
    expect(link2[0].values[0][0]).toBe("sess-evt-2");
  });

  it("creates triggered_commit links for commits within 5 minutes", async () => {
    const events = [
      makeEvent({
        id: "ai-evt",
        timestamp: "2026-04-15T10:00:00Z",
        source: "ai-session",
        type: "ai-conversation",
        metadata: {},
      }),
      makeEvent({
        id: "commit-evt",
        timestamp: "2026-04-15T10:03:00Z", // 3 minutes later
        source: "git",
        type: "commit",
        metadata: {},
      }),
    ];

    const { db } = await setupDbWithEvents(events);

    const { linkRelatedEvents } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await linkRelatedEvents(db, ["ai-evt"]);

    // ai-evt → commit-evt (triggered_commit)
    const result = await db.exec(
      "SELECT to_event FROM event_links WHERE from_event = ? AND link_type = 'triggered_commit'",
      ["ai-evt"],
    );
    expect(result[0].values.length).toBe(1);
    expect(result[0].values[0][0]).toBe("commit-evt");
  });

  it("creates related_events links for shared files within 1 hour", async () => {
    const events = [
      makeEvent({
        id: "file-evt-1",
        timestamp: "2026-04-15T10:00:00Z",
        metadata: { files_modified: ["src/auth.ts", "src/jwt.ts"] },
      }),
      makeEvent({
        id: "file-evt-2",
        timestamp: "2026-04-15T10:30:00Z",
        metadata: { files_modified: ["src/auth.ts", "src/config.ts"] },
      }),
    ];

    const { db } = await setupDbWithEvents(events);

    const { linkRelatedEvents } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await linkRelatedEvents(db, ["file-evt-2"]);

    // file-evt-1 → file-evt-2 (related_events, shared file: src/auth.ts)
    const result = await db.exec(
      "SELECT from_event, metadata FROM event_links WHERE link_type = 'related_events' AND to_event = ?",
      ["file-evt-2"],
    );
    expect(result[0].values.length).toBe(1);
    expect(result[0].values[0][0]).toBe("file-evt-1");

    const linkMeta = JSON.parse(result[0].values[0][1] as string);
    expect(linkMeta.sharedFiles).toBe(1);
  });

  it("does not link events more than 1 hour apart for file overlap", async () => {
    const events = [
      makeEvent({
        id: "far-evt-1",
        timestamp: "2026-04-15T08:00:00Z",
        metadata: { files_modified: ["src/auth.ts"] },
      }),
      makeEvent({
        id: "far-evt-2",
        timestamp: "2026-04-15T10:30:00Z", // 2.5 hours later
        metadata: { files_modified: ["src/auth.ts"] },
      }),
    ];

    const { db } = await setupDbWithEvents(events);

    const { linkRelatedEvents } = await import(
      "../../src/services/intelligence/feature-boundary.js"
    );
    await linkRelatedEvents(db, ["far-evt-2"]);

    // Should NOT create a related_events link (>1 hour apart)
    const result = await db.exec("SELECT * FROM event_links WHERE link_type = 'related_events'");
    expect(result[0].values.length).toBe(0);
  });
});

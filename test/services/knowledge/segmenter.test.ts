import { describe, expect, it } from "vitest";
import { segmentConversation } from "../../../src/services/knowledge/segmenter.js";
import type { Turn } from "../../../src/services/knowledge/turn-parser.js";

/** Helper to create a minimal Turn. */
function makeTurn(overrides: Partial<Turn> & { index: number; role: Turn["role"]; content: string }): Turn {
  return { ...overrides };
}

/** Shorthand for a user turn. */
function userTurn(index: number, content: string, extras: Partial<Turn> = {}): Turn {
  return makeTurn({ index, role: "user", content, ...extras });
}

/** Shorthand for an assistant turn. */
function assistantTurn(index: number, content: string, extras: Partial<Turn> = {}): Turn {
  return makeTurn({ index, role: "assistant", content, ...extras });
}

const EPISODE_ID = "evt-test-001";

describe("segmenter (KE-6.1)", () => {
  // ── Basic segmentation ─────────────────────────────────────────────────────

  it("returns empty array for empty turns", () => {
    expect(segmentConversation([], EPISODE_ID)).toHaveLength(0);
  });

  it("returns single segment for short conversation (< 3 turns)", () => {
    const turns = [
      userTurn(0, "Fix the login bug"),
      assistantTurn(1, "Looking at auth.ts"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(1);
    expect(segments[0].turnRange).toEqual([0, 1]);
    expect(segments[0].segmentMethod).toBe("structural");
    expect(segments[0].episodeId).toBe(EPISODE_ID);
  });

  it("returns single segment when no boundaries detected", () => {
    const turns = [
      userTurn(0, "Fix the login bug in auth"),
      assistantTurn(1, "I'll look at auth.ts"),
      userTurn(2, "What about the session handling?"),
      assistantTurn(3, "The session manager is related"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(1);
    expect(segments[0].turnRange).toEqual([0, 3]);
  });

  // ── Signal 1: File-path discontinuity ──────────────────────────────────────

  it("splits on file-path discontinuity (different modules)", () => {
    const turns = [
      userTurn(0, "Fix auth", { filesModified: ["src/auth/login.ts"] }),
      assistantTurn(1, "Done with auth", { filesModified: ["src/auth/session.ts"] }),
      assistantTurn(2, "Also fixed auth config", { filesModified: ["src/auth/config.ts"] }),
      userTurn(3, "Now fix the database", { filesModified: ["lib/database/pool.ts"] }),
      assistantTurn(4, "Looking at DB", { filesModified: ["lib/database/query.ts"] }),
      userTurn(5, "Add an index", { filesModified: ["lib/database/migrations.ts"] }),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(2);
    expect(segments[0].turnRange).toEqual([0, 2]);
    expect(segments[1].turnRange).toEqual([3, 5]);
    expect(segments[0].filesInScope).toContain("src/auth/login.ts");
    expect(segments[1].filesInScope).toContain("lib/database/pool.ts");
  });

  it("does not split when files share parent module", () => {
    const turns = [
      userTurn(0, "Fix auth login", { filesModified: ["src/auth/login.ts"] }),
      assistantTurn(1, "Done", { filesModified: ["src/auth/session.ts"] }),
      userTurn(2, "Also fix auth config", { filesModified: ["src/auth/config.ts"] }),
      assistantTurn(3, "Done", { filesModified: ["src/auth/types.ts"] }),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(1);
  });

  // ── Signal 2: Discourse markers ────────────────────────────────────────────

  it("splits on explicit discourse marker 'now let's'", () => {
    const turns = [
      userTurn(0, "Fix the login form validation"),
      assistantTurn(1, "I'll update the form"),
      userTurn(2, "Looks good"),
      userTurn(3, "Now let's work on the API endpoints"),
      assistantTurn(4, "Sure, looking at the routes"),
      userTurn(5, "Add rate limiting too"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(2);
    expect(segments[0].turnRange).toEqual([0, 2]);
    expect(segments[1].turnRange).toEqual([3, 5]);
  });

  it("splits on 'switching to'", () => {
    const turns = [
      userTurn(0, "Debug the cache miss"),
      assistantTurn(1, "Found the issue"),
      userTurn(2, "Great, thanks"),
      userTurn(3, "Switching to the frontend build issue"),
      assistantTurn(4, "Checking webpack config"),
      userTurn(5, "Yes, focus on that"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(2);
    expect(segments[1].turnRange[0]).toBe(3);
  });

  it("splits on 'different topic'", () => {
    const turns = [
      userTurn(0, "Review the PR changes"),
      assistantTurn(1, "Reviewing now"),
      userTurn(2, "Done with that"),
      userTurn(3, "On a different topic, can you help with tests?"),
      assistantTurn(4, "Sure, which tests?"),
      userTurn(5, "The integration tests"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(2);
  });

  it("splits on 'moving on to'", () => {
    const turns = [
      userTurn(0, "The auth system looks fine"),
      assistantTurn(1, "Agreed"),
      userTurn(2, "Confirmed"),
      userTurn(3, "Moving on to the deployment pipeline"),
      assistantTurn(4, "Let me check the CI config"),
      userTurn(5, "Right"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(2);
  });

  // ── Signal 3: Tool-use cluster gaps ────────────────────────────────────────

  it("splits on tool-use cluster gap with file target shift", () => {
    const turns = [
      // First tool cluster (config module) — 4 turns to survive merge threshold
      userTurn(0, "Read the config", { filesReferenced: ["src/config.ts"] }),
      assistantTurn(1, "Reading", { toolUse: [{ name: "Read", input: "src/config.ts" }], filesModified: ["src/config.ts"] }),
      userTurn(2, "Update the timeout value", { filesReferenced: ["src/config.ts"] }),
      assistantTurn(3, "Updated", { toolUse: [{ name: "Edit", input: "src/config.ts" }], filesModified: ["src/config.ts"] }),
      // 4 pure text turns (gap > 3)
      userTurn(4, "That's interesting"),
      assistantTurn(5, "Yes it is"),
      userTurn(6, "What do you think?"),
      assistantTurn(7, "I think we should change it"),
      // New tool use targeting different module
      userTurn(8, "Edit the database", { filesReferenced: ["lib/db/pool.ts"] }),
      assistantTurn(9, "Editing", { toolUse: [{ name: "Edit", input: "lib/db/pool.ts" }], filesModified: ["lib/db/pool.ts"] }),
      userTurn(10, "Done"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    // Should detect a boundary between the two tool-use clusters
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  // ── Signal 4: Temporal gaps ────────────────────────────────────────────────

  it("splits on temporal gap > 5 minutes", () => {
    const turns = [
      userTurn(0, "Fix the bug", { timestamp: "2026-04-28T10:00:00Z" }),
      assistantTurn(1, "Working on it", { timestamp: "2026-04-28T10:01:00Z" }),
      userTurn(2, "How's it going", { timestamp: "2026-04-28T10:02:00Z" }),
      // 10 minute gap
      userTurn(3, "Ok I'm back", { timestamp: "2026-04-28T10:12:00Z" }),
      assistantTurn(4, "Welcome back", { timestamp: "2026-04-28T10:12:30Z" }),
      userTurn(5, "Let's continue", { timestamp: "2026-04-28T10:13:00Z" }),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(2);
    expect(segments[0].turnRange).toEqual([0, 2]);
    expect(segments[1].turnRange).toEqual([3, 5]);
  });

  it("does not split on temporal gap < 5 minutes", () => {
    const turns = [
      userTurn(0, "Fix the bug", { timestamp: "2026-04-28T10:00:00Z" }),
      assistantTurn(1, "Working on it", { timestamp: "2026-04-28T10:01:00Z" }),
      userTurn(2, "How's it going", { timestamp: "2026-04-28T10:04:00Z" }),
      assistantTurn(3, "Almost done", { timestamp: "2026-04-28T10:04:30Z" }),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(1);
  });

  // ── Merge small segments ───────────────────────────────────────────────────

  it("merges segments with < 3 turns into preceding neighbor", () => {
    const turns = [
      userTurn(0, "Fix auth", { filesModified: ["src/auth/login.ts"] }),
      assistantTurn(1, "Done", { filesModified: ["src/auth/login.ts"] }),
      userTurn(2, "Confirmed", { filesModified: ["src/auth/login.ts"] }),
      // Discourse marker creates a boundary, but only 2 turns follow before next boundary
      userTurn(3, "Now let's fix the db"),
      assistantTurn(4, "Ok"),
      // Another boundary but only 2 turns
      userTurn(5, "Switching to tests"),
      assistantTurn(6, "Sure"),
      userTurn(7, "Run them all"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    // Small segments should be merged — exact count depends on merge logic,
    // but all turns should be covered and no segment < 3 turns except possibly the last
    const totalTurns = segments.reduce((sum, s) => sum + (s.turnRange[1] - s.turnRange[0] + 1), 0);
    expect(totalTurns).toBe(8);
  });

  // ── Git commit events (single segment) ─────────────────────────────────────

  it("produces single segment for a 1-turn event (git commit)", () => {
    const turns = [
      userTurn(0, "fix: resolve auth race condition", {
        filesModified: ["src/auth.ts", "src/session.ts"],
      }),
    ];

    const segments = segmentConversation(turns, "evt-git-001");
    expect(segments).toHaveLength(1);
    expect(segments[0].turnRange).toEqual([0, 0]);
    expect(segments[0].filesInScope).toContain("src/auth.ts");
    expect(segments[0].segmentId).toBe("evt-git-001:seg-0");
  });

  // ── Segment metadata ──────────────────────────────────────────────────────

  it("populates filesInScope from all turns in segment", () => {
    const turns = [
      userTurn(0, "Fix auth", { filesReferenced: ["src/auth/login.ts"] }),
      assistantTurn(1, "Editing", { filesModified: ["src/auth/login.ts", "src/auth/types.ts"] }),
      userTurn(2, "Also check session"),
      assistantTurn(3, "Done", { filesModified: ["src/auth/session.ts"] }),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments[0].filesInScope).toContain("src/auth/login.ts");
    expect(segments[0].filesInScope).toContain("src/auth/types.ts");
    expect(segments[0].filesInScope).toContain("src/auth/session.ts");
  });

  it("populates modulesInScope from file paths", () => {
    const turns = [
      userTurn(0, "Fix things", { filesModified: ["src/auth/login.ts", "src/auth/config.ts"] }),
      assistantTurn(1, "Done"),
      userTurn(2, "Thanks"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments[0].modulesInScope).toContain("src/auth");
  });

  it("generates topicLabel from modules when available", () => {
    const turns = [
      userTurn(0, "Fix auth", { filesModified: ["src/auth/login.ts"] }),
      assistantTurn(1, "Done", { filesModified: ["src/auth/session.ts"] }),
      userTurn(2, "Thanks"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments[0].topicLabel).toContain("src/auth");
  });

  it("generates topicLabel from first user turn when no files", () => {
    const turns = [
      userTurn(0, "Explain how React hooks work"),
      assistantTurn(1, "React hooks are..."),
      userTurn(2, "And what about useEffect?"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments[0].topicLabel).toContain("Explain how React hooks work");
  });

  it("generates summary with user intent and file scope", () => {
    const turns = [
      userTurn(0, "Fix the login validation", { filesModified: ["src/auth/login.ts"] }),
      assistantTurn(1, "Looking at it"),
      userTurn(2, "Great"),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments[0].summary).toContain("Fix the login validation");
    expect(segments[0].summary).toContain("src/auth/login.ts");
  });

  // ── Multiple signals ──────────────────────────────────────────────────────

  it("combines multiple signals for accurate segmentation", () => {
    const turns = [
      // Segment 1: Auth work
      userTurn(0, "Fix the auth middleware", {
        filesModified: ["src/auth/middleware.ts"],
        timestamp: "2026-04-28T10:00:00Z",
      }),
      assistantTurn(1, "I see the issue in middleware", {
        filesModified: ["src/auth/middleware.ts"],
        timestamp: "2026-04-28T10:00:30Z",
      }),
      userTurn(2, "Good, apply the fix", {
        timestamp: "2026-04-28T10:01:00Z",
      }),
      // Segment 2: Different module + discourse marker + temporal gap
      userTurn(3, "Now let's work on the database pool", {
        filesModified: ["lib/database/pool.ts"],
        timestamp: "2026-04-28T10:15:00Z",
      }),
      assistantTurn(4, "Looking at the pool config", {
        filesModified: ["lib/database/pool.ts"],
        timestamp: "2026-04-28T10:15:30Z",
      }),
      userTurn(5, "Increase max connections", {
        filesModified: ["lib/database/config.ts"],
        timestamp: "2026-04-28T10:16:00Z",
      }),
    ];

    const segments = segmentConversation(turns, EPISODE_ID);
    expect(segments).toHaveLength(2);
    expect(segments[0].turnRange).toEqual([0, 2]);
    expect(segments[1].turnRange).toEqual([3, 5]);
    expect(segments[0].modulesInScope).toContain("src/auth");
    expect(segments[1].modulesInScope).toContain("lib/database");
  });

  // ── Large conversation ─────────────────────────────────────────────────────

  it("handles a 50+ turn conversation with multiple boundaries", () => {
    const turns: Turn[] = [];
    for (let i = 0; i < 60; i++) {
      const module = i < 20 ? "src/auth" : i < 40 ? "lib/db" : "src/ui";
      turns.push(makeTurn({
        index: i,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i} about ${module}`,
        filesModified: [`${module}/file-${i}.ts`],
      }));
    }

    const segments = segmentConversation(turns, EPISODE_ID);
    // Should have at least 3 segments (one per module)
    expect(segments.length).toBeGreaterThanOrEqual(3);
    // All turns covered
    const totalTurns = segments.reduce((sum, s) => sum + (s.turnRange[1] - s.turnRange[0] + 1), 0);
    expect(totalTurns).toBe(60);
  });

  // ── segmentId format ───────────────────────────────────────────────────────

  it("generates segmentId in episodeId:seg-N format", () => {
    const turns = [
      userTurn(0, "Hello"),
      assistantTurn(1, "Hi"),
      userTurn(2, "Thanks"),
    ];

    const segments = segmentConversation(turns, "evt-abc-123");
    expect(segments[0].segmentId).toBe("evt-abc-123:seg-0");
  });
});

import { describe, expect, it } from "vitest";
import {
  parseConversationTurns,
  extractUserTurns,
  extractAssistantTurns,
  estimateTokenCount,
} from "../../../src/services/knowledge/turn-parser.js";
import type { CaptureEvent } from "../../../src/schemas/event.js";

/** Create a minimal CaptureEvent for testing. */
function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: "evt-test-001",
    projectId: "proj-test",
    timestamp: "2026-04-28T10:00:00Z",
    source: "ai-session",
    type: "ai-conversation",
    content: {
      summary: "Test conversation",
      detail: "",
    },
    ...overrides,
  };
}

describe("turn-parser (KE-5.1)", () => {
  // ── metadata.turns parsing (preferred path) ─────────────────────────────

  describe("parseFromMetadataTurns", () => {
    it("parses structured turns from metadata.turns", () => {
      const event = makeEvent({
        metadata: {
          ai_tool: "claude-code",
          turns: [
            { role: "user", content: "Fix the login bug", turn_index: 0, timestamp: "2026-04-28T10:00:00Z" },
            { role: "assistant", content: "I'll look at the auth module.", turn_index: 1, timestamp: "2026-04-28T10:00:05Z" },
            { role: "user", content: "Also check the session timeout", turn_index: 2 },
          ],
          files_referenced: ["src/auth.ts"],
          files_modified: ["src/auth.ts", "src/session.ts"],
        },
      });

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(3);

      expect(turns[0].role).toBe("user");
      expect(turns[0].content).toBe("Fix the login bug");
      expect(turns[0].index).toBe(0);
      expect(turns[0].timestamp).toBe("2026-04-28T10:00:00Z");
      expect(turns[0].filesReferenced).toEqual(["src/auth.ts"]);

      expect(turns[1].role).toBe("assistant");
      expect(turns[1].content).toBe("I'll look at the auth module.");
      expect(turns[1].filesModified).toEqual(["src/auth.ts", "src/session.ts"]);

      expect(turns[2].role).toBe("user");
      expect(turns[2].index).toBe(2);
      expect(turns[2].timestamp).toBeUndefined();
    });

    it("preserves tool_use from assistant turns", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { role: "user", content: "Read the config file", turn_index: 0 },
            {
              role: "assistant",
              content: "Let me read that.",
              turn_index: 1,
              tool_use: [
                { name: "Read", input: "/src/config.ts" },
                { name: "Edit", input: "/src/config.ts" },
              ],
            },
          ],
        },
      });

      const turns = parseConversationTurns(event);
      expect(turns[1].toolUse).toHaveLength(2);
      expect(turns[1].toolUse![0].name).toBe("Read");
      expect(turns[1].toolUse![1].name).toBe("Edit");
    });

    it("skips empty content turns", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { role: "user", content: "Hello", turn_index: 0 },
            { role: "assistant", content: "", turn_index: 1 },
            { role: "assistant", content: "   ", turn_index: 2 },
            { role: "user", content: "World", turn_index: 3 },
          ],
        },
      });

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(2);
      expect(turns[0].content).toBe("Hello");
      expect(turns[1].content).toBe("World");
    });

    it("normalizes role aliases (human → user, ai → assistant)", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { role: "human", content: "Hi", turn_index: 0 },
            { role: "ai", content: "Hello!", turn_index: 1 },
            { role: "summary", content: "Conversation about greetings", turn_index: 2 },
          ],
        },
      });

      const turns = parseConversationTurns(event);
      expect(turns[0].role).toBe("user");
      expect(turns[1].role).toBe("assistant");
      expect(turns[2].role).toBe("system");
    });

    it("assigns sequential indices when turn_index is missing", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { role: "user", content: "First" },
            { role: "assistant", content: "Second" },
            { role: "user", content: "Third" },
          ],
        },
      });

      const turns = parseConversationTurns(event);
      expect(turns[0].index).toBe(0);
      expect(turns[1].index).toBe(1);
      expect(turns[2].index).toBe(2);
    });
  });

  // ── content.detail pipe-separated fallback ──────────────────────────────

  describe("parseFromDetail (pipe-separated)", () => {
    it("parses pipe-separated format", () => {
      const event = makeEvent({
        content: {
          summary: "AI conversation",
          detail: "user: Fix the bug | assistant: Looking at it now | user: Thanks",
        },
        metadata: {}, // no turns in metadata
      });

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(3);
      expect(turns[0]).toMatchObject({ role: "user", content: "Fix the bug" });
      expect(turns[1]).toMatchObject({ role: "assistant", content: "Looking at it now" });
      expect(turns[2]).toMatchObject({ role: "user", content: "Thanks" });
    });

    it("parses JSON array in detail field", () => {
      const turnsJson = JSON.stringify([
        { role: "user", content: "Hello", turn_index: 0 },
        { role: "assistant", content: "Hi there", turn_index: 1 },
      ]);
      const event = makeEvent({
        content: { summary: "Chat", detail: turnsJson },
        metadata: {},
      });

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe("user");
      expect(turns[1].content).toBe("Hi there");
    });

    it("handles segments without role prefix", () => {
      const event = makeEvent({
        content: {
          summary: "AI conversation",
          detail: "some content without role prefix | user: hello",
        },
        metadata: {},
      });

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe("user"); // default
      expect(turns[0].content).toBe("some content without role prefix");
    });
  });

  // ── Non-conversation event synthesis ────────────────────────────────────

  describe("synthesizeSingleTurn", () => {
    it("git commit → single user turn with files", () => {
      const event: CaptureEvent = {
        id: "evt-git-001",
        projectId: "proj-test",
        timestamp: "2026-04-28T09:00:00Z",
        source: "git",
        type: "commit",
        content: {
          summary: "fix: resolve auth race condition",
          detail: "Fixed a timing issue in the session validation middleware that caused intermittent 401s",
          files: ["src/middleware/auth.ts", "src/session.ts"],
        },
        gitContext: { repo: "unfade-cli", branch: "main", commitHash: "abc123" },
      };

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe("user");
      expect(turns[0].content).toContain("timing issue");
      expect(turns[0].filesModified).toEqual(["src/middleware/auth.ts", "src/session.ts"]);
      expect(turns[0].timestamp).toBe("2026-04-28T09:00:00Z");
    });

    it("uses summary when detail is empty", () => {
      const event: CaptureEvent = {
        id: "evt-git-002",
        projectId: "proj-test",
        timestamp: "2026-04-28T09:00:00Z",
        source: "git",
        type: "commit",
        content: { summary: "chore: update dependencies" },
      };

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(1);
      expect(turns[0].content).toBe("chore: update dependencies");
    });

    it("returns empty for event with no content", () => {
      const event = makeEvent({
        source: "manual",
        type: "bookmark",
        content: { summary: "" },
        metadata: {},
      });

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(0);
    });
  });

  // ── Preference: metadata.turns over content.detail ──────────────────────

  it("prefers metadata.turns over content.detail", () => {
    const event = makeEvent({
      content: {
        summary: "AI conversation",
        detail: "user: stale data | assistant: stale response",
      },
      metadata: {
        turns: [
          { role: "user", content: "fresh data", turn_index: 0 },
          { role: "assistant", content: "fresh response", turn_index: 1 },
        ],
      },
    });

    const turns = parseConversationTurns(event);
    expect(turns[0].content).toBe("fresh data");
    expect(turns[1].content).toBe("fresh response");
  });

  // ── Utility functions ──────────────────────────────────────────────────

  describe("extractUserTurns", () => {
    it("filters to user turns only", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { role: "user", content: "Q1", turn_index: 0 },
            { role: "assistant", content: "A1", turn_index: 1 },
            { role: "user", content: "Q2", turn_index: 2 },
            { role: "assistant", content: "A2", turn_index: 3 },
          ],
        },
      });

      const userTurns = extractUserTurns(parseConversationTurns(event));
      expect(userTurns).toHaveLength(2);
      expect(userTurns[0].content).toBe("Q1");
      expect(userTurns[1].content).toBe("Q2");
    });
  });

  describe("extractAssistantTurns", () => {
    it("filters to assistant turns only", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { role: "user", content: "Q1", turn_index: 0 },
            { role: "assistant", content: "A1", turn_index: 1 },
          ],
        },
      });

      const aiTurns = extractAssistantTurns(parseConversationTurns(event));
      expect(aiTurns).toHaveLength(1);
      expect(aiTurns[0].content).toBe("A1");
    });
  });

  describe("estimateTokenCount", () => {
    it("estimates ~1 token per 4 characters", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { role: "user", content: "a".repeat(400), turn_index: 0 },
            { role: "assistant", content: "b".repeat(600), turn_index: 1 },
          ],
        },
      });

      const tokens = estimateTokenCount(parseConversationTurns(event));
      expect(tokens).toBe(250); // 1000 chars / 4
    });

    it("returns 0 for empty turns", () => {
      expect(estimateTokenCount([])).toBe(0);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles metadata.turns that is not an array", () => {
      const event = makeEvent({
        metadata: { turns: "not an array" },
        content: { summary: "fallback", detail: "" },
      });

      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(1);
      expect(turns[0].content).toBe("fallback");
    });

    it("handles very long conversations (100+ turns)", () => {
      const rawTurns = Array.from({ length: 120 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i} content here`,
        turn_index: i,
      }));

      const event = makeEvent({ metadata: { turns: rawTurns } });
      const turns = parseConversationTurns(event);
      expect(turns).toHaveLength(120);
      expect(turns[0].index).toBe(0);
      expect(turns[119].index).toBe(119);
    });

    it("handles turns with missing role (defaults to user)", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            { content: "No role specified", turn_index: 0 },
            { role: "assistant", content: "I have a role", turn_index: 1 },
          ],
        },
      });

      const turns = parseConversationTurns(event);
      expect(turns[0].role).toBe("user");
      expect(turns[1].role).toBe("assistant");
    });

    it("handles content with special characters and newlines", () => {
      const event = makeEvent({
        metadata: {
          turns: [
            {
              role: "user",
              content: "Here's my code:\n```ts\nconst x = 1;\n```\nPlease review",
              turn_index: 0,
            },
          ],
        },
      });

      const turns = parseConversationTurns(event);
      expect(turns[0].content).toContain("```ts");
      expect(turns[0].content).toContain("const x = 1;");
    });
  });
});

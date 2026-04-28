import { describe, expect, it } from "vitest";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import { computeOverallScore } from "../../../src/schemas/knowledge.js";
import type { Turn } from "../../../src/services/knowledge/turn-parser.js";
import { extractHeuristicComprehension } from "../../../src/services/knowledge/heuristic-extractor.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: "evt-test-001",
    projectId: "proj-test",
    timestamp: "2026-04-28T10:00:00Z",
    source: "ai-session",
    type: "ai-conversation",
    content: { summary: "Test conversation" },
    ...overrides,
  };
}

function makeTurns(overrides?: Partial<Turn>[]): Turn[] {
  const defaults: Turn[] = [
    { index: 0, role: "user", content: "Fix the login bug in the auth module" },
    { index: 1, role: "assistant", content: "I'll look at src/auth.ts and fix the session handling." },
    { index: 2, role: "user", content: "Why did you choose to modify the middleware instead of the handler?" },
    { index: 3, role: "assistant", content: "Because the middleware handles all session validation centrally." },
    { index: 4, role: "user", content: "What about using Redis for session storage instead of in-memory?" },
    { index: 5, role: "assistant", content: "Redis would persist sessions across restarts, good idea." },
  ];

  if (overrides) {
    return overrides.map((o, i) => ({ ...defaults[i % defaults.length], ...o, index: i }));
  }
  return defaults;
}

// ─── Core Tests ─────────────────────────────────────────────────────────────

describe("heuristic-extractor (KE-8.2)", () => {
  describe("extractHeuristicComprehension", () => {
    it("returns null for non-conversation events", () => {
      const gitEvent = makeEvent({ source: "git", type: "commit" });
      const result = extractHeuristicComprehension(gitEvent, []);
      expect(result).toBeNull();
    });

    it("returns null for terminal events", () => {
      const termEvent = makeEvent({ source: "terminal", type: "command" });
      const result = extractHeuristicComprehension(termEvent, []);
      expect(result).toBeNull();
    });

    it("returns null for empty turns", () => {
      const result = extractHeuristicComprehension(makeEvent(), []);
      expect(result).toBeNull();
    });

    it("returns null when only assistant turns exist (no user turns)", () => {
      const turns: Turn[] = [
        { index: 0, role: "assistant", content: "Here's the solution." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result).toBeNull();
    });

    it("produces valid ComprehensionAssessment for AI conversations", () => {
      const result = extractHeuristicComprehension(makeEvent(), makeTurns());

      expect(result).not.toBeNull();
      expect(result!.episodeId).toBe("evt-test-001");
      expect(result!.timestamp).toBe("2026-04-28T10:00:00Z");
      expect(result!.assessmentMethod).toBe("heuristic-proxy");

      expect(result!.dimensions.steering).toBeGreaterThanOrEqual(0);
      expect(result!.dimensions.steering).toBeLessThanOrEqual(10);
      expect(result!.dimensions.understanding).toBeGreaterThanOrEqual(0);
      expect(result!.dimensions.understanding).toBeLessThanOrEqual(10);
      expect(result!.dimensions.metacognition).toBeGreaterThanOrEqual(0);
      expect(result!.dimensions.metacognition).toBeLessThanOrEqual(10);
      expect(result!.dimensions.independence).toBeGreaterThanOrEqual(0);
      expect(result!.dimensions.independence).toBeLessThanOrEqual(10);
      expect(result!.dimensions.engagement).toBeGreaterThanOrEqual(0);
      expect(result!.dimensions.engagement).toBeLessThanOrEqual(10);

      expect(result!.overallScore).toBeGreaterThanOrEqual(0);
      expect(result!.overallScore).toBeLessThanOrEqual(100);
      expect(result!.evidence.length).toBeGreaterThan(0);
      expect(result!.domainTags).toBeInstanceOf(Array);
    });

    it("assessmentMethod is always heuristic-proxy", () => {
      const result = extractHeuristicComprehension(makeEvent(), makeTurns());
      expect(result!.assessmentMethod).toBe("heuristic-proxy");
    });

    it("overallScore matches deterministic weighted computation", () => {
      const result = extractHeuristicComprehension(makeEvent(), makeTurns());
      const expected = computeOverallScore(result!.dimensions);
      expect(result!.overallScore).toBe(expected);
    });
  });

  // ── Steering Proxy ──────────────────────────────────────────────────────

  describe("steering proxy", () => {
    it("uses HDS from metadata when available", () => {
      const event = makeEvent({ metadata: { human_direction_score: 8 } });
      const turns: Turn[] = [
        { index: 0, role: "user", content: "hello" },
        { index: 1, role: "assistant", content: "hi" },
      ];
      const result = extractHeuristicComprehension(event, turns);
      expect(result!.dimensions.steering).toBe(8);
    });

    it("scores high steering for directive language", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "Please fix the login bug" },
        { index: 1, role: "assistant", content: "Done." },
        { index: 2, role: "user", content: "Can you also update the tests?" },
        { index: 3, role: "assistant", content: "Updated." },
        { index: 4, role: "user", content: "Now create a new endpoint for user profiles" },
        { index: 5, role: "assistant", content: "Created." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.steering).toBeGreaterThanOrEqual(7);
    });

    it("scores low steering for minimal interaction", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "ok" },
        { index: 1, role: "assistant", content: "Here's the full implementation." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.steering).toBeLessThanOrEqual(3);
    });
  });

  // ── Understanding Proxy ─────────────────────────────────────────────────

  describe("understanding proxy", () => {
    it("scores higher when modification patterns are detected", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "Build the auth flow" },
        { index: 1, role: "assistant", content: "Here's the implementation..." },
        { index: 2, role: "user", content: "Actually I want to change this to use JWT instead" },
        { index: 3, role: "assistant", content: "Updated to JWT." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.understanding).toBeGreaterThanOrEqual(5);
    });

    it("scores low when no modification signals", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "Build something" },
        { index: 1, role: "assistant", content: "Done." },
        { index: 2, role: "user", content: "ok thanks" },
        { index: 3, role: "assistant", content: "You're welcome." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.understanding).toBeLessThanOrEqual(3);
    });
  });

  // ── Metacognition Proxy ─────────────────────────────────────────────────

  describe("metacognition proxy", () => {
    it("detects alternative evaluation", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "What about using WebSockets instead of SSE?" },
        { index: 1, role: "assistant", content: "WebSockets would give bidirectional..." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.metacognition).toBeGreaterThanOrEqual(4);
    });

    it("detects course correction", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "Build the API endpoint" },
        { index: 1, role: "assistant", content: "Here it is..." },
        { index: 2, role: "user", content: "Wait, let me rethink this approach" },
        { index: 3, role: "assistant", content: "Sure, what would you like?" },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.metacognition).toBeGreaterThanOrEqual(3);
    });

    it("scores zero when no metacognitive patterns", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "build something" },
        { index: 1, role: "assistant", content: "done" },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.metacognition).toBe(0);
    });

    it("capped at 7 (heuristic ceiling)", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "Wait, let me rethink. What about using Redis vs Memcached?" },
        { index: 1, role: "assistant", content: "Redis offers persistence while Memcached is simpler." },
        { index: 2, role: "user", content: "Actually let's go back to our original approach and compare" },
        { index: 3, role: "assistant", content: "Sure." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.dimensions.metacognition).toBeLessThanOrEqual(7);
    });
  });

  // ── Engagement Proxy ────────────────────────────────────────────────────

  describe("engagement proxy", () => {
    it("scores higher for longer conversations", () => {
      const shortTurns: Turn[] = [
        { index: 0, role: "user", content: "fix bug" },
        { index: 1, role: "assistant", content: "fixed" },
      ];
      const longTurns: Turn[] = Array.from({ length: 20 }, (_, i) => ({
        index: i,
        role: (i % 2 === 0 ? "user" : "assistant") as Turn["role"],
        content: `Turn ${i} content`,
      }));

      const shortResult = extractHeuristicComprehension(makeEvent(), shortTurns);
      const longResult = extractHeuristicComprehension(makeEvent(), longTurns);

      expect(longResult!.dimensions.engagement).toBeGreaterThan(shortResult!.dimensions.engagement);
    });
  });

  // ── Rubber Stamp & Pushback Counting ──────────────────────────────────

  describe("rubber stamp detection", () => {
    it("counts affirmative-only user turns as rubber stamps", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "build auth" },
        { index: 1, role: "assistant", content: "Here's the auth implementation..." },
        { index: 2, role: "user", content: "ok" },
        { index: 3, role: "assistant", content: "Anything else?" },
        { index: 4, role: "user", content: "looks good" },
        { index: 5, role: "assistant", content: "Great!" },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.rubberStampCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("pushback detection", () => {
    it("counts modification and rejection patterns as pushbacks", () => {
      const turns: Turn[] = [
        { index: 0, role: "user", content: "Build the auth" },
        { index: 1, role: "assistant", content: "Using sessions..." },
        { index: 2, role: "user", content: "No, that's wrong — we need JWT" },
        { index: 3, role: "assistant", content: "Updated to JWT." },
        { index: 4, role: "user", content: "Actually I want to modify the token expiry" },
        { index: 5, role: "assistant", content: "Done." },
      ];
      const result = extractHeuristicComprehension(makeEvent(), turns);
      expect(result!.pushbackCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Domain Tags ───────────────────────────────────────────────────────

  describe("domain tag extraction", () => {
    it("detects domains from file extensions and keywords", () => {
      const event = makeEvent({
        content: {
          summary: "Working on React auth with Redis session storage",
          files: ["src/auth.tsx", "src/db/session.sql"],
        },
      });
      const result = extractHeuristicComprehension(event, makeTurns());

      expect(result!.domainTags).toContain("frontend");
      expect(result!.domainTags).toContain("authentication");
      expect(result!.domainTags).toContain("database");
    });
  });
});

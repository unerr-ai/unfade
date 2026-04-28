import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  buildContradictionClassificationPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT_GIT,
  CONTRADICTION_SYSTEM_PROMPT,
  EXTRACTION_PROMPT_VERSION,
  getSystemPromptForEvent,
  eventSupportsComprehension,
} from "../../../src/services/knowledge/prompts.js";
import type { Turn } from "../../../src/services/knowledge/turn-parser.js";
import type { ConversationSegment, AtomicFact, PersistedFact } from "../../../src/schemas/knowledge.js";

function makeTurn(overrides: Partial<Turn> & { index: number; role: Turn["role"]; content: string }): Turn {
  return overrides;
}

function makeSegment(overrides: Partial<ConversationSegment> & { segmentId: string }): ConversationSegment {
  return {
    episodeId: "evt-001",
    turnRange: [0, 2],
    topicLabel: "test topic",
    summary: "test summary",
    filesInScope: [],
    modulesInScope: [],
    segmentMethod: "structural",
    ...overrides,
  };
}

describe("prompts (KE-7.1)", () => {
  // ── Prompt version ───────────────────────────────────────────────────────

  it("exports prompt version as a positive integer", () => {
    expect(EXTRACTION_PROMPT_VERSION).toBe(1);
    expect(Number.isInteger(EXTRACTION_PROMPT_VERSION)).toBe(true);
  });

  // ── System prompts ──────────────────────────────────────────────────────

  describe("system prompts", () => {
    it("EXTRACTION_SYSTEM_PROMPT includes all extraction dimensions", () => {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"entities"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"facts"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"comprehension"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"metacognitiveSignals"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"agencyClassification"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"sustainabilitySignal"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"reasoningChains"');
    });

    it("EXTRACTION_SYSTEM_PROMPT contains comprehension rubric", () => {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("steering");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("understanding");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("metacognition");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("independence");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("engagement");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("0–3:");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("4–6:");
      expect(EXTRACTION_SYSTEM_PROMPT).toContain("7–10:");
    });

    it("EXTRACTION_SYSTEM_PROMPT embeds all controlled vocabulary values", () => {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"technology"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"pattern"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"module"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"USES"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"DECIDED"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"REPLACED_BY"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"why-question"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"pushback"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"developer-directed"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"builds-capability"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"ongoing"');
      expect(EXTRACTION_SYSTEM_PROMPT).toContain('"supersedes_previous"');
    });

    it("EXTRACTION_SYSTEM_PROMPT_GIT omits comprehension and metacognition", () => {
      expect(EXTRACTION_SYSTEM_PROMPT_GIT).toContain('"entities"');
      expect(EXTRACTION_SYSTEM_PROMPT_GIT).toContain('"facts"');
      expect(EXTRACTION_SYSTEM_PROMPT_GIT).toContain('"reasoningChains"');
      expect(EXTRACTION_SYSTEM_PROMPT_GIT).not.toContain('"comprehension"');
      expect(EXTRACTION_SYSTEM_PROMPT_GIT).not.toContain('"metacognitiveSignals"');
      expect(EXTRACTION_SYSTEM_PROMPT_GIT).not.toContain('"agencyClassification"');
      expect(EXTRACTION_SYSTEM_PROMPT_GIT).not.toContain('"sustainabilitySignal"');
    });

    it("getSystemPromptForEvent returns correct prompt per source", () => {
      expect(getSystemPromptForEvent("ai-session")).toBe(EXTRACTION_SYSTEM_PROMPT);
      expect(getSystemPromptForEvent("git")).toBe(EXTRACTION_SYSTEM_PROMPT_GIT);
      expect(getSystemPromptForEvent("terminal")).toBe(EXTRACTION_SYSTEM_PROMPT_GIT);
    });
  });

  // ── buildExtractionPrompt ─────────────────────────────────────────────

  describe("buildExtractionPrompt", () => {
    const conversationTurns: Turn[] = [
      makeTurn({ index: 0, role: "user", content: "I want to add Redis caching to the auth module" }),
      makeTurn({ index: 1, role: "assistant", content: "Let me set up Redis with ioredis...", filesModified: ["src/cache.ts"] }),
      makeTurn({ index: 2, role: "user", content: "Why not use the built-in Map? What's the trade-off?" }),
      makeTurn({ index: 3, role: "assistant", content: "Map doesn't persist across restarts. Redis gives you TTL..." }),
      makeTurn({ index: 4, role: "user", content: "Now let's work on the database migration", filesReferenced: ["src/db/schema.ts"] }),
      makeTurn({ index: 5, role: "assistant", content: "I'll create the migration file...", filesModified: ["src/db/migrate.ts"] }),
    ];

    const singleSegment: ConversationSegment[] = [
      makeSegment({ segmentId: "evt-001:seg-0", turnRange: [0, 5] }),
    ];

    const multiSegments: ConversationSegment[] = [
      makeSegment({
        segmentId: "evt-001:seg-0",
        turnRange: [0, 3],
        topicLabel: "Redis caching",
        filesInScope: ["src/cache.ts"],
      }),
      makeSegment({
        segmentId: "evt-001:seg-4",
        turnRange: [4, 5],
        topicLabel: "Database migration",
        filesInScope: ["src/db/schema.ts", "src/db/migrate.ts"],
      }),
    ];

    it("includes all extraction dimensions for AI conversation", () => {
      const prompt = buildExtractionPrompt(conversationTurns, singleSegment, "ai-conversation", "ai-session");

      expect(prompt).toContain("ai-session");
      expect(prompt).toContain("ai-conversation");
      expect(prompt).toContain("[0] USER: I want to add Redis caching");
      expect(prompt).toContain("[1] ASSISTANT: Let me set up Redis");
      expect(prompt).toContain("Extract the structured JSON now.");
    });

    it("includes segment boundaries when multiple segments exist", () => {
      const prompt = buildExtractionPrompt(conversationTurns, multiSegments, "ai-conversation", "ai-session");

      expect(prompt).toContain('--- Segment "Redis caching" (evt-001:seg-0, turns 0–3) ---');
      expect(prompt).toContain('--- Segment "Database migration" (evt-001:seg-4, turns 4–5) ---');
      expect(prompt).toContain("[0] USER:");
      expect(prompt).toContain("[4] USER:");
    });

    it("includes existing entity names for resolution hints", () => {
      const prompt = buildExtractionPrompt(
        conversationTurns, singleSegment,
        "ai-conversation", "ai-session",
        ["Redis", "PostgreSQL", "auth-module"],
      );

      expect(prompt).toContain("Known entities from prior conversations");
      expect(prompt).toContain("Redis, PostgreSQL, auth-module");
    });

    it("omits entity hints when none provided", () => {
      const prompt = buildExtractionPrompt(conversationTurns, singleSegment, "ai-conversation", "ai-session");
      expect(prompt).not.toContain("Known entities");
    });

    it("formats file annotations on turns", () => {
      const prompt = buildExtractionPrompt(conversationTurns, singleSegment, "ai-conversation", "ai-session");

      expect(prompt).toContain("files_mod: src/cache.ts");
      expect(prompt).toContain("files_ref: src/db/schema.ts");
    });

    it("formats tool use annotations", () => {
      const turns: Turn[] = [
        makeTurn({ index: 0, role: "user", content: "Fix the bug" }),
        makeTurn({ index: 1, role: "assistant", content: "Looking at the code...", toolUse: [{ name: "read_file" }, { name: "edit_file" }] }),
      ];
      const segments = [makeSegment({ segmentId: "evt-002:seg-0", turnRange: [0, 1] })];
      const prompt = buildExtractionPrompt(turns, segments, "ai-conversation", "ai-session");

      expect(prompt).toContain("tools: read_file, edit_file");
    });

    it("truncates very long turn content", () => {
      const longContent = "x".repeat(3000);
      const turns: Turn[] = [
        makeTurn({ index: 0, role: "user", content: longContent }),
      ];
      const segments = [makeSegment({ segmentId: "evt-003:seg-0", turnRange: [0, 0] })];
      const prompt = buildExtractionPrompt(turns, segments, "ai-conversation", "ai-session");

      expect(prompt.length).toBeLessThan(longContent.length);
      expect(prompt).toContain("...");
    });
  });

  // ── Git commit prompt variant ──────────────────────────────────────────

  describe("buildExtractionPrompt (git commit)", () => {
    it("produces git commit variant for non-ai-session events", () => {
      const turns: Turn[] = [
        makeTurn({
          index: 0, role: "user",
          content: "feat: add Redis caching layer for session storage",
          filesModified: ["src/cache.ts", "src/config.ts"],
        }),
      ];

      const prompt = buildExtractionPrompt(turns, [], "git-commit", "git");

      expect(prompt).toContain("git commit");
      expect(prompt).toContain("feat: add Redis caching layer");
      expect(prompt).toContain("src/cache.ts, src/config.ts");
      expect(prompt).toContain("Extract entities, facts, and reasoning chains as JSON now.");
      expect(prompt).not.toContain("Segment");
    });

    it("includes entity hints for git commits", () => {
      const turns: Turn[] = [
        makeTurn({ index: 0, role: "user", content: "refactor: switch from Express to Fastify" }),
      ];

      const prompt = buildExtractionPrompt(turns, [], "git-commit", "git", ["Express", "Fastify"]);
      expect(prompt).toContain("Known entities");
      expect(prompt).toContain("Express, Fastify");
    });
  });

  // ── buildContradictionClassificationPrompt ─────────────────────────────

  describe("buildContradictionClassificationPrompt", () => {
    const existingFact: AtomicFact = {
      subject: "project",
      predicate: "USES",
      object: "Redux",
      confidence: 0.9,
      explicit: true,
      temporalHint: "ongoing",
      context: "We're using Redux for state management",
    };

    const newFact: AtomicFact = {
      subject: "project",
      predicate: "USES",
      object: "Zustand",
      confidence: 0.85,
      explicit: true,
      temporalHint: "supersedes_previous",
      context: "Switched to Zustand for simpler state management",
    };

    it("includes both facts with all fields", () => {
      const prompt = buildContradictionClassificationPrompt(existingFact, newFact);

      expect(prompt).toContain("EXISTING FACT:");
      expect(prompt).toContain("NEW FACT:");
      expect(prompt).toContain("Subject: project");
      expect(prompt).toContain("Predicate: USES");
      expect(prompt).toContain("Object: Redux");
      expect(prompt).toContain("Object: Zustand");
      expect(prompt).toContain("Confidence: 0.9");
      expect(prompt).toContain("Confidence: 0.85");
      expect(prompt).toContain("Temporal hint: ongoing");
      expect(prompt).toContain("Temporal hint: supersedes_previous");
    });

    it("includes temporal validity for PersistedFacts", () => {
      const persisted: PersistedFact = {
        id: "fact-001",
        subject: "project",
        subjectId: "entity-001",
        predicate: "USES",
        object: "Redux",
        objectId: "entity-002",
        objectText: null,
        confidence: 0.9,
        explicit: true,
        temporalHint: "ongoing",
        context: "Using Redux",
        validAt: "2026-04-01T00:00:00Z",
        invalidAt: null,
        createdAt: "2026-04-01T12:00:00Z",
        expiredAt: null,
        sourceEpisode: "evt-001",
        sourceSegment: null,
        extractionMethod: "llm",
      };

      const prompt = buildContradictionClassificationPrompt(persisted, newFact);
      expect(prompt).toContain("Valid since: 2026-04-01T00:00:00Z");
    });

    it("asks for classification as JSON", () => {
      const prompt = buildContradictionClassificationPrompt(existingFact, newFact);
      expect(prompt).toContain("Classify their relationship as JSON now.");
    });
  });

  // ── Utility functions ──────────────────────────────────────────────────

  describe("utility functions", () => {
    it("eventSupportsComprehension returns true only for ai-session", () => {
      expect(eventSupportsComprehension("ai-session")).toBe(true);
      expect(eventSupportsComprehension("git")).toBe(false);
      expect(eventSupportsComprehension("terminal")).toBe(false);
    });
  });

  // ── Contradiction system prompt ────────────────────────────────────────

  describe("CONTRADICTION_SYSTEM_PROMPT", () => {
    it("includes all 5 classification types with definitions", () => {
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("CONSISTENT");
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("MORE_SPECIFIC");
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("CONTRADICTORY");
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("SUPERSEDES");
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("UNRELATED");
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("classification");
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("confidence");
      expect(CONTRADICTION_SYSTEM_PROMPT).toContain("reasoning");
    });
  });
});

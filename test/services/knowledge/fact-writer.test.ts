import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFact,
  appendFacts,
  readAllFacts,
  countFacts,
} from "../../../src/services/knowledge/fact-writer.js";
import type { PersistedFact } from "../../../src/schemas/knowledge.js";

/** Create a minimal valid PersistedFact for testing. */
function makeFact(overrides: Partial<PersistedFact> = {}): PersistedFact {
  return {
    id: randomUUID(),
    subject: "React",
    predicate: "USES",
    object: "Virtual DOM",
    confidence: 0.9,
    explicit: true,
    temporalHint: "ongoing",
    context: "Developer discussed React's virtual DOM rendering",
    subjectId: "ent-react",
    objectId: "ent-vdom",
    objectText: null,
    validAt: "2026-04-28T10:00:00.000Z",
    invalidAt: null,
    createdAt: "2026-04-28T10:00:00.000Z",
    expiredAt: null,
    sourceEpisode: "evt-001",
    sourceSegment: "seg-001",
    extractionMethod: "llm",
    ...overrides,
  };
}

describe("fact-writer (KE-4.1)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `unfade-fact-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // ── appendFact ──────────────────────────────────────────────────────────

  it("creates facts.jsonl and writes a single fact", () => {
    const fact = makeFact();
    appendFact(fact, testDir);

    const path = join(testDir, ".unfade", "graph", "facts.jsonl");
    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(fact.id);
    expect(parsed.subject).toBe("React");
    expect(parsed.predicate).toBe("USES");
  });

  it("appends multiple facts sequentially", () => {
    const fact1 = makeFact({ subject: "TypeScript" });
    const fact2 = makeFact({ subject: "Rust" });

    appendFact(fact1, testDir);
    appendFact(fact2, testDir);

    const path = join(testDir, ".unfade", "graph", "facts.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).subject).toBe("TypeScript");
    expect(JSON.parse(lines[1]).subject).toBe("Rust");
  });

  // ── appendFacts (batch) ─────────────────────────────────────────────────

  it("writes a batch of facts in a single call", () => {
    const facts = [
      makeFact({ subject: "Go" }),
      makeFact({ subject: "Python" }),
      makeFact({ subject: "Java" }),
    ];
    appendFacts(facts, testDir);

    const path = join(testDir, ".unfade", "graph", "facts.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).subject).toBe("Go");
    expect(JSON.parse(lines[1]).subject).toBe("Python");
    expect(JSON.parse(lines[2]).subject).toBe("Java");
  });

  it("no-ops on empty array", () => {
    appendFacts([], testDir);
    const path = join(testDir, ".unfade", "graph", "facts.jsonl");
    expect(existsSync(path)).toBe(false);
  });

  it("batch append adds to existing file", () => {
    appendFact(makeFact({ subject: "First" }), testDir);
    appendFacts(
      [makeFact({ subject: "Second" }), makeFact({ subject: "Third" })],
      testDir,
    );

    const path = join(testDir, ".unfade", "graph", "facts.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).subject).toBe("First");
    expect(JSON.parse(lines[2]).subject).toBe("Third");
  });

  // ── readAllFacts ────────────────────────────────────────────────────────

  it("reads all facts from JSONL", () => {
    const originals = [makeFact({ subject: "A" }), makeFact({ subject: "B" })];
    appendFacts(originals, testDir);

    const facts = readAllFacts(testDir);
    expect(facts).toHaveLength(2);
    expect(facts[0].subject).toBe("A");
    expect(facts[1].subject).toBe("B");
  });

  it("returns empty array when file doesn't exist", () => {
    const facts = readAllFacts(testDir);
    expect(facts).toHaveLength(0);
  });

  it("skips malformed lines gracefully", () => {
    const path = join(testDir, ".unfade", "graph");
    mkdirSync(path, { recursive: true });
    const { writeFileSync } = require("node:fs");
    writeFileSync(
      join(path, "facts.jsonl"),
      `${JSON.stringify(makeFact({ subject: "Good" }))}\n{BROKEN JSON\n${JSON.stringify(makeFact({ subject: "Also Good" }))}\n`,
    );

    const facts = readAllFacts(testDir);
    expect(facts).toHaveLength(2);
    expect(facts[0].subject).toBe("Good");
    expect(facts[1].subject).toBe("Also Good");
  });

  // ── countFacts ──────────────────────────────────────────────────────────

  it("counts facts without parsing", () => {
    appendFacts(
      [makeFact(), makeFact(), makeFact(), makeFact(), makeFact()],
      testDir,
    );
    expect(countFacts(testDir)).toBe(5);
  });

  it("returns 0 for nonexistent file", () => {
    expect(countFacts(testDir)).toBe(0);
  });

  // ── Bi-temporal fields preserved ────────────────────────────────────────

  it("preserves full bi-temporal model through write/read cycle", () => {
    const fact = makeFact({
      validAt: "2026-01-01T00:00:00.000Z",
      invalidAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-04-28T12:00:00.000Z",
      expiredAt: "2026-04-29T12:00:00.000Z",
    });

    appendFact(fact, testDir);
    const [read] = readAllFacts(testDir);

    expect(read.validAt).toBe("2026-01-01T00:00:00.000Z");
    expect(read.invalidAt).toBe("2026-06-01T00:00:00.000Z");
    expect(read.createdAt).toBe("2026-04-28T12:00:00.000Z");
    expect(read.expiredAt).toBe("2026-04-29T12:00:00.000Z");
    expect(read.sourceEpisode).toBe(fact.sourceEpisode);
    expect(read.extractionMethod).toBe("llm");
  });
});

// FILE: src/services/knowledge/fact-writer.ts
// Append-only writer for facts.jsonl — the source-of-truth for extracted knowledge.
// CozoDB is a derived cache; this JSONL file is the durable log.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getGraphDir } from "../../utils/paths.js";
import type { PersistedFact } from "../../schemas/knowledge.js";

const FACTS_FILENAME = "facts.jsonl";

/**
 * Resolves the full path to the facts.jsonl file.
 * Ensures the parent directory exists.
 */
function resolveFactsPath(homeOverride?: string): string {
  const dir = getGraphDir(homeOverride);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, FACTS_FILENAME);
}

/**
 * Append a single persisted fact to `~/.unfade/graph/facts.jsonl`.
 * Uses a single `appendFileSync` call for atomicity on POSIX.
 */
export function appendFact(fact: PersistedFact, homeOverride?: string): void {
  const path = resolveFactsPath(homeOverride);
  appendFileSync(path, `${JSON.stringify(fact)}\n`, "utf-8");
}

/**
 * Append multiple persisted facts in a single atomic write.
 * Concatenates all lines first, then writes once to minimize partial-write risk.
 */
export function appendFacts(facts: PersistedFact[], homeOverride?: string): void {
  if (facts.length === 0) return;
  const path = resolveFactsPath(homeOverride);
  const lines = facts.map((f) => JSON.stringify(f)).join("\n");
  appendFileSync(path, `${lines}\n`, "utf-8");
}

/**
 * Read all persisted facts from the JSONL file.
 * Used for cache rebuilds and contradiction detection.
 * Returns parsed facts, silently skipping malformed lines.
 */
export function readAllFacts(homeOverride?: string): PersistedFact[] {
  const path = resolveFactsPath(homeOverride);
  if (!existsSync(path)) return [];

  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];

  const facts: PersistedFact[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      facts.push(JSON.parse(line) as PersistedFact);
    } catch {
      // Skip malformed lines — log in production, silent here
    }
  }
  return facts;
}

/**
 * Count the number of facts in the JSONL file without fully parsing.
 * Useful for stats and progress tracking.
 */
export function countFacts(homeOverride?: string): number {
  const path = resolveFactsPath(homeOverride);
  if (!existsSync(path)) return 0;

  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const content = readFileSync(path, "utf-8");
  if (!content.trim()) return 0;

  return content.trim().split("\n").filter((l: string) => l.trim().length > 0).length;
}

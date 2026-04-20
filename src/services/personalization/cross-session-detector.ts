import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAmplificationDir, getGraphDir } from "../../utils/paths.js";

const MIN_OCCURRENCES = 3;
const CROSS_SESSION_FILE = "cross-session.json";

export interface CrossSessionPattern {
  pattern: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  domains: string[];
  examples: string[];
}

interface DecisionRecord {
  date: string;
  decision: string;
  rationale: string;
  domain?: string;
}

/**
 * Scan decisions.jsonl for recurring reasoning patterns across sessions.
 * A pattern is a cluster of decisions sharing key terms that appears 3+ times.
 * Returns patterns sorted by occurrence count (descending).
 */
export function detectCrossSessionPatterns(cwd?: string): CrossSessionPattern[] {
  const decisions = loadDecisions(cwd);
  if (decisions.length < MIN_OCCURRENCES) return [];

  const termClusters = buildTermClusters(decisions);
  const patterns = extractPatterns(termClusters);

  if (patterns.length > 0) {
    persistPatterns(patterns, cwd);
  }

  return patterns;
}

/**
 * Load persisted cross-session patterns from disk.
 */
export function loadCrossSessionPatterns(cwd?: string): CrossSessionPattern[] {
  const path = join(getAmplificationDir(cwd), CROSS_SESSION_FILE);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

function loadDecisions(cwd?: string): DecisionRecord[] {
  const path = join(getGraphDir(cwd), "decisions.jsonl");
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];

  const records: DecisionRecord[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {}
  }
  return records;
}

function buildTermClusters(decisions: DecisionRecord[]): Map<string, DecisionRecord[]> {
  const clusters = new Map<string, DecisionRecord[]>();

  for (const dec of decisions) {
    const terms = extractSignificantTerms(`${dec.decision} ${dec.rationale}`);
    for (const term of terms) {
      const existing = clusters.get(term) ?? [];
      existing.push(dec);
      clusters.set(term, existing);
    }
  }

  return clusters;
}

function extractPatterns(clusters: Map<string, DecisionRecord[]>): CrossSessionPattern[] {
  const patterns: CrossSessionPattern[] = [];
  const seen = new Set<string>();

  const sorted = Array.from(clusters.entries())
    .filter(([_, decs]) => decs.length >= MIN_OCCURRENCES)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [term, decs] of sorted) {
    if (seen.has(term)) continue;

    const dates = decs.map((d) => d.date).sort();
    const domains = [...new Set(decs.map((d) => d.domain).filter(Boolean))] as string[];
    const uniqueDates = new Set(dates);

    if (uniqueDates.size < 2) continue;

    const description = describePattern(term, decs);

    patterns.push({
      pattern: description,
      occurrences: decs.length,
      firstSeen: dates[0],
      lastSeen: dates[dates.length - 1],
      domains,
      examples: decs.slice(0, 3).map((d) => d.decision),
    });

    seen.add(term);
  }

  return patterns.slice(0, 10);
}

function describePattern(term: string, decs: DecisionRecord[]): string {
  const domains = [...new Set(decs.map((d) => d.domain).filter(Boolean))];
  const domainStr = domains.length > 0 ? ` in ${domains.join(", ")}` : "";
  return `Recurring: "${term}"${domainStr} (${decs.length} times across ${new Set(decs.map((d) => d.date)).size} days)`;
}

function extractSignificantTerms(text: string): string[] {
  const stop = new Set([
    "the",
    "a",
    "an",
    "is",
    "was",
    "are",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "shall",
    "should",
    "may",
    "might",
    "must",
    "can",
    "could",
    "and",
    "or",
    "but",
    "if",
    "then",
    "so",
    "as",
    "at",
    "by",
    "for",
    "in",
    "of",
    "on",
    "to",
    "with",
    "from",
    "up",
    "not",
    "no",
    "this",
    "that",
    "it",
    "its",
    "use",
    "used",
    "using",
    "new",
    "add",
    "added",
    "change",
    "changed",
  ]);

  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !stop.has(w));

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }

  return [...words, ...bigrams];
}

function persistPatterns(patterns: CrossSessionPattern[], cwd?: string): void {
  const dir = getAmplificationDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CROSS_SESSION_FILE), `${JSON.stringify(patterns, null, 2)}\n`, "utf-8");
}

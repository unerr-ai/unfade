// FILE: src/tools/unfade-decisions.ts
// UF-054: Decisions reader — list recent decisions with domain filter.
// Phase 1 does not create graph/decisions.jsonl, so we extract decisions
// from distill markdown files as the primary source. Handles missing
// data gracefully with degraded: true.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DecisionItem, DecisionsInput, DecisionsOutput, McpMeta } from "../schemas/mcp.js";
import { loadRegistry } from "../services/registry/registry.js";
import { getDistillsDir, getGraphDir } from "../utils/paths.js";

interface GraphDecision {
  date: string;
  decision: string;
  rationale: string;
  domain?: string;
  alternativesConsidered?: number;
  projectId?: string;
  evidenceEventIds?: string[];
  humanDirectionScore?: number;
  directionClassification?: string;
}

/**
 * Try to read decisions from graph/decisions.jsonl (future format).
 * Returns null if the file doesn't exist.
 */
function readGraphDecisions(cwd?: string): GraphDecision[] | null {
  const graphDir = getGraphDir(cwd);
  const filePath = join(graphDir, "decisions.jsonl");

  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, "utf-8");
    const decisions: GraphDecision[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as GraphDecision;
        if (parsed.decision) decisions.push(parsed);
      } catch {
        // skip malformed lines
      }
    }
    return decisions;
  } catch {
    return null;
  }
}

/**
 * Extract decisions from distill markdown files.
 * Parses the "## Decisions" section from each file.
 */
function extractDecisionsFromDistills(distillsDir: string): DecisionItem[] {
  if (!existsSync(distillsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(distillsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  const decisions: DecisionItem[] = [];

  for (const file of files) {
    const date = file.replace(".md", "");
    try {
      const content = readFileSync(join(distillsDir, file), "utf-8");
      const lines = content.split("\n");
      let inDecisions = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith("## ")) {
          inDecisions = line.slice(3).trim().toLowerCase() === "decisions";
          continue;
        }

        if (inDecisions && line.startsWith("- **")) {
          const match = line.match(/^- \*\*(.+?)\*\*(?:\s*\[(.+?)\])?/);
          if (match) {
            let rationale = "";
            // Check next line for rationale (indented italic)
            if (i + 1 < lines.length) {
              const rMatch = lines[i + 1].match(/^\s+_(.+)_$/);
              if (rMatch) rationale = rMatch[1];
            }
            decisions.push({
              date,
              decision: match[1],
              rationale,
              domain: match[2] || undefined,
            });
          }
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return decisions;
}

/**
 * Get the most recent mtime from decisions source files.
 */
function getLastUpdated(distillsDir: string, graphDir: string): string | null {
  const graphPath = join(graphDir, "decisions.jsonl");
  let latest: Date | null = null;

  // Check graph file
  if (existsSync(graphPath)) {
    try {
      latest = statSync(graphPath).mtime;
    } catch {
      // skip
    }
  }

  // Check distills dir for most recent file
  if (existsSync(distillsDir)) {
    try {
      const files = readdirSync(distillsDir).filter((f) => f.endsWith(".md"));
      for (const f of files) {
        const mtime = statSync(join(distillsDir, f)).mtime;
        if (!latest || mtime > latest) latest = mtime;
      }
    } catch {
      // skip
    }
  }

  return latest ? latest.toISOString() : null;
}

function startDateForPeriod(period: "7d" | "30d" | "90d"): Date {
  const d = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDecisionDate(dateStr: string): Date | null {
  const t = Date.parse(`${dateStr}T12:00:00`);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/**
 * Retrieve recent decisions with optional domain filter.
 * Reads from graph/decisions.jsonl if available, falls back to
 * extracting from distill markdown files.
 */
export function getDecisions(input: DecisionsInput, cwd?: string): DecisionsOutput {
  const start = performance.now();

  const distillsDir = getDistillsDir(cwd);
  const graphDir = getGraphDir(cwd);

  // Try graph file first, fall back to distill extraction
  const graphDecisions = readGraphDecisions(cwd);
  let decisions: DecisionItem[];
  let degraded = false;
  let degradedReason: string | undefined;

  if (graphDecisions !== null) {
    decisions = graphDecisions.map((d) => ({
      date: d.date,
      decision: d.decision,
      rationale: d.rationale,
      domain: d.domain,
      alternativesConsidered: d.alternativesConsidered,
      projectId: d.projectId,
      projectName: undefined, // resolved below by resolveProjectNames()
      evidenceEventIds: d.evidenceEventIds,
      humanDirectionScore: d.humanDirectionScore,
      directionClassification: d.directionClassification,
    }));
  } else {
    decisions = extractDecisionsFromDistills(distillsDir);
    if (decisions.length === 0 && !existsSync(distillsDir)) {
      degraded = true;
      degradedReason = "No distills or graph data found";
    }
  }

  // Resolve projectId UUIDs to human-readable names from registry.
  decisions = resolveProjectNames(decisions);

  // Deduplicate: merge semantically equivalent decisions into one canonical entry.
  // Two decisions are considered duplicates if their normalized text matches.
  decisions = deduplicateDecisions(decisions);

  // Filter by domain if specified
  if (input.domain) {
    const domain = input.domain.toLowerCase();
    decisions = decisions.filter((d) => d.domain?.toLowerCase() === domain);
  }

  if (input.period) {
    const start = startDateForPeriod(input.period);
    decisions = decisions.filter((d) => {
      const parsed = parseDecisionDate(d.date);
      return parsed != null && parsed >= start;
    });
  }

  if (input.q?.trim()) {
    const needle = input.q.trim().toLowerCase();
    decisions = decisions.filter(
      (d) =>
        d.decision.toLowerCase().includes(needle) || d.rationale.toLowerCase().includes(needle),
    );
  }

  // Filter by project if specified
  if (input.project) {
    const pid = input.project.toLowerCase();
    decisions = decisions.filter((d) => d.projectId?.toLowerCase().includes(pid));
  }

  // Sort recent-first (most recent date at top)
  decisions.sort((a, b) => b.date.localeCompare(a.date));

  const total = decisions.length;
  const offset = input.offset ?? 0;
  decisions = decisions.slice(offset, offset + input.limit);

  const lastUpdated = getLastUpdated(distillsDir, graphDir);

  const meta: McpMeta = {
    tool: "unfade-decisions",
    durationMs: Math.round(performance.now() - start),
    degraded,
    degradedReason,
    lastUpdated,
  };

  return { data: { decisions, total }, _meta: meta };
}

// ---------------------------------------------------------------------------
// Project name resolution
// ---------------------------------------------------------------------------

/**
 * Build a projectId → label lookup from the global registry.
 * Cached per call (registry is small, read is fast).
 */
function buildProjectNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const registry = loadRegistry();
    for (const repo of registry.repos) {
      map.set(repo.id, repo.label);
    }
  } catch {
    // Registry unavailable — return empty map, decisions will show without names.
  }
  return map;
}

/**
 * Enrich decisions with human-readable projectName from registry.
 */
function resolveProjectNames(decisions: DecisionItem[]): DecisionItem[] {
  const nameMap = buildProjectNameMap();
  if (nameMap.size === 0) return decisions;

  for (const d of decisions) {
    if (d.projectId && !d.projectName) {
      d.projectName = nameMap.get(d.projectId);
    }
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Normalize decision text for comparison: lowercase, collapse whitespace,
 * strip punctuation, remove common filler words.
 */
function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize normalized text into a set of words for similarity comparison.
 */
function tokenize(text: string): Set<string> {
  return new Set(normalizeForDedup(text).split(" ").filter(Boolean));
}

/**
 * Jaccard similarity between two token sets (0..1).
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.7;

/**
 * Merge decisions with identical or near-identical text.
 * Uses exact normalized match first, then Jaccard token similarity (≥0.7)
 * to catch near-duplicates across different dates/contexts.
 * Keeps the most recent entry, merges evidence IDs.
 */
function deduplicateDecisions(decisions: DecisionItem[]): DecisionItem[] {
  const canonical: Array<{ item: DecisionItem; tokens: Set<string> }> = [];

  for (const d of decisions) {
    const key = normalizeForDedup(d.decision);
    if (!key) continue;

    const tokens = tokenize(d.decision);

    // Find existing canonical entry by exact match or similarity
    let match: (typeof canonical)[number] | undefined;
    for (const c of canonical) {
      if (normalizeForDedup(c.item.decision) === key) {
        match = c;
        break;
      }
      if (jaccardSimilarity(tokens, c.tokens) >= SIMILARITY_THRESHOLD) {
        match = c;
        break;
      }
    }

    if (!match) {
      canonical.push({ item: { ...d }, tokens });
      continue;
    }

    // Merge into existing canonical entry
    const existing = match.item;

    if (d.date > existing.date) {
      existing.date = d.date;
    }

    if (d.evidenceEventIds?.length) {
      const merged = new Set([...(existing.evidenceEventIds ?? []), ...d.evidenceEventIds]);
      existing.evidenceEventIds = [...merged];
    }

    if (d.humanDirectionScore != null) {
      existing.humanDirectionScore = Math.max(
        existing.humanDirectionScore ?? 0,
        d.humanDirectionScore,
      );
    }
    if (d.alternativesConsidered != null) {
      existing.alternativesConsidered = Math.max(
        existing.alternativesConsidered ?? 0,
        d.alternativesConsidered,
      );
    }

    if (d.domain && !existing.domain) existing.domain = d.domain;
    if (d.rationale && !existing.rationale) existing.rationale = d.rationale;
    if (d.projectName && !existing.projectName) existing.projectName = d.projectName;
  }

  return canonical.map((c) => c.item);
}

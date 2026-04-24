// FILE: src/tools/unfade-decisions.ts
// UF-054: Decisions reader — list recent decisions with domain filter.
// Phase 1 does not create graph/decisions.jsonl, so we extract decisions
// from distill markdown files as the primary source. Handles missing
// data gracefully with degraded: true.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DecisionItem, DecisionsInput, DecisionsOutput, McpMeta } from "../schemas/mcp.js";
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

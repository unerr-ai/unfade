// FILE: src/services/intelligence/debugging-arcs.ts
// 12C.3/12C.4: Debugging arc detector — groups debugging-phase events by file overlap
// and temporal proximity into coherent arcs with hypothesis→test→result narratives.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { DbLike } from "../cache/manager.js";

export interface DebuggingArc {
  id: string;
  errorDescription: string;
  hypothesesTested: number;
  events: ArcEvent[];
  resolution: "resolved" | "abandoned" | "ongoing";
  resolutionSummary: string | null;
  files: string[];
  branch: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

interface ArcEvent {
  eventId: string;
  ts: string;
  summary: string;
  files: string[];
  branch: string | null;
}

interface RawEvent {
  id: string;
  ts: string;
  contentSummary: string;
  contentDetail: string;
  gitBranch: string;
  metadata: Record<string, unknown>;
}

const PROXIMITY_MS = 2 * 3600 * 1000; // 2 hours
const FILE_OVERLAP_THRESHOLD = 0.6;
const MIN_ARC_EVENTS = 2;

/**
 * Detect debugging arcs from recent events.
 * Groups debugging-phase events by file overlap + temporal proximity.
 */
export function detectDebuggingArcs(db: DbLike): DebuggingArc[] {
  const events = loadDebuggingEvents(db);
  if (events.length < MIN_ARC_EVENTS) return [];

  const arcEvents = events.map(toArcEvent);
  const groups = groupByProximityAndOverlap(arcEvents);

  return groups.filter((g) => g.length >= MIN_ARC_EVENTS).map((group, idx) => buildArc(group, idx));
}

/**
 * Write debugging arcs to intelligence directory.
 */
export function writeDebuggingArcs(arcs: DebuggingArc[], repoRoot?: string): void {
  const dir = getIntelligenceDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "debugging-arcs.json");
  const tmp = `${target}.tmp.${process.pid}`;
  writeFileSync(
    tmp,
    JSON.stringify({ arcs, updatedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
  renameSync(tmp, target);
}

/**
 * Format debugging arcs as markdown section for distill.
 */
export function formatDebuggingArcsSection(arcs: DebuggingArc[]): string {
  if (arcs.length === 0) return "";

  const lines: string[] = ["## Debugging Arcs", ""];

  for (const arc of arcs.slice(0, 5)) {
    const status =
      arc.resolution === "resolved"
        ? "Resolved"
        : arc.resolution === "abandoned"
          ? "Abandoned"
          : "Ongoing";
    lines.push(`- **${arc.errorDescription}** (${status}, ~${arc.durationMinutes} min)`);
    lines.push(`  ${arc.hypothesesTested} approaches tested across ${arc.files.length} files`);
    if (arc.resolutionSummary) {
      lines.push(`  _${arc.resolutionSummary}_`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function loadDebuggingEvents(db: DbLike): RawEvent[] {
  try {
    const result = db.exec(`
      SELECT id, ts, content_summary, content_detail, git_branch, metadata
      FROM events
      WHERE (
        json_extract(metadata, '$.execution_phase') = 'debugging'
        OR json_extract(metadata, '$.execution_phase') = 'investigating'
        OR content_summary LIKE '%error%'
        OR content_summary LIKE '%bug%'
        OR content_summary LIKE '%fix%'
        OR content_summary LIKE '%debug%'
      )
      AND ts >= datetime('now', '-7 days')
      ORDER BY ts ASC
      LIMIT 500
    `);
    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      ts: row[1] as string,
      contentSummary: (row[2] as string) ?? "",
      contentDetail: (row[3] as string) ?? "",
      gitBranch: (row[4] as string) ?? "",
      metadata: parseJson(row[5]),
    }));
  } catch {
    return [];
  }
}

function parseJson(val: unknown): Record<string, unknown> {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return {};
    }
  }
  if (typeof val === "object" && val !== null) return val as Record<string, unknown>;
  return {};
}

function toArcEvent(raw: RawEvent): ArcEvent {
  const files = extractFiles(raw);
  return {
    eventId: raw.id,
    ts: raw.ts,
    summary: raw.contentSummary.slice(0, 200),
    files,
    branch: raw.gitBranch || null,
  };
}

function extractFiles(raw: RawEvent): string[] {
  const meta = raw.metadata;
  if (Array.isArray(meta.files_changed)) return meta.files_changed as string[];
  const text = `${raw.contentSummary} ${raw.contentDetail}`;
  const fileMatches = text.match(/[\w/.-]+\.\w{1,6}/g) ?? [];
  return [...new Set(fileMatches)].slice(0, 20);
}

function groupByProximityAndOverlap(events: ArcEvent[]): ArcEvent[][] {
  const groups: ArcEvent[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    if (assigned.has(i)) continue;
    const group = [events[i]];
    assigned.add(i);

    for (let j = i + 1; j < events.length; j++) {
      if (assigned.has(j)) continue;

      const lastInGroup = group[group.length - 1];
      const timeDiff = new Date(events[j].ts).getTime() - new Date(lastInGroup.ts).getTime();
      if (timeDiff > PROXIMITY_MS) continue;

      const overlap = fileOverlap(lastInGroup.files, events[j].files);
      const sameBranch = lastInGroup.branch === events[j].branch;

      if (overlap >= FILE_OVERLAP_THRESHOLD || (sameBranch && lastInGroup.branch)) {
        group.push(events[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

function fileOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const intersection = b.filter((f) => setA.has(f)).length;
  return intersection / Math.min(a.length, b.length);
}

function buildArc(group: ArcEvent[], idx: number): DebuggingArc {
  const first = group[0];
  const last = group[group.length - 1];
  const startMs = new Date(first.ts).getTime();
  const endMs = new Date(last.ts).getTime();

  const allFiles = [...new Set(group.flatMap((e) => e.files))];

  // Determine resolution from last event
  const lastSummary = last.summary.toLowerCase();
  const resolution: DebuggingArc["resolution"] = /fix|resolv|solved|work/i.test(lastSummary)
    ? "resolved"
    : /abandon|gave up|revert|skip/i.test(lastSummary)
      ? "abandoned"
      : "ongoing";

  const resolutionSummary =
    resolution === "resolved"
      ? `Resolved by: ${last.summary}`
      : resolution === "abandoned"
        ? `Abandoned after ${group.length} iterations`
        : null;

  return {
    id: `arc-${idx}-${first.ts.slice(0, 10)}`,
    errorDescription: first.summary,
    hypothesesTested: Math.max(1, group.length - 1),
    events: group,
    resolution,
    resolutionSummary,
    files: allFiles,
    branch: first.branch,
    startTime: first.ts,
    endTime: last.ts,
    durationMinutes: Math.round((endMs - startMs) / 60_000),
  };
}

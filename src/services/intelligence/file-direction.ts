// FILE: src/services/intelligence/file-direction.ts
// Direction density per file/directory. Incremental: maintains running
// per-directory HDS averages, only processes events past watermark.
// Full reconciliation every ~150 events.

import type { DbLike } from "../cache/manager.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

export interface FileDirectionEntry {
  path: string;
  directionDensity: number;
  eventCount: number;
}

interface DirectionByFileState {
  byDir: Record<string, { totalHds: number; count: number; avgHds: number }>;
}

const FILE_PATTERN =
  /(?:^|\s|['"`(])([a-zA-Z0-9_./-]+\/[a-zA-Z0-9_./-]+\.(?:ts|js|tsx|jsx|go|py|rs|rb|java|kt|swift|c|cpp|h|css|scss|html|vue|svelte|md))/g;
const RECONCILIATION_INTERVAL = 150;

function extractFileDirs(text: string): string[] {
  const dirs = new Set<string>();
  const pattern = new RegExp(FILE_PATTERN.source, FILE_PATTERN.flags);
  for (const match of text.matchAll(pattern)) {
    const parts = match[1].split("/");
    if (parts.length >= 2) {
      dirs.add(parts.slice(0, Math.min(parts.length - 1, 3)).join("/"));
    }
  }
  return [...dirs];
}

async function fullScan(db: DbLike): Promise<DirectionByFileState> {
  const byDir: DirectionByFileState["byDir"] = {};

  try {
    const result = await db.exec(`
      SELECT content_summary, content_detail, human_direction_score as hds
      FROM events
      WHERE source IN ('ai-session', 'mcp-active', 'git')
        AND (content_detail IS NOT NULL OR content_summary IS NOT NULL)
    `);

    if (!result[0]?.values.length) return { byDir };

    for (const row of result[0].values) {
      const text = `${(row[0] as string) ?? ""} ${(row[1] as string) ?? ""}`;
      const hds = (row[2] as number) ?? 0.5;
      for (const dir of extractFileDirs(text)) {
        const entry = byDir[dir] ?? { totalHds: 0, count: 0, avgHds: 0 };
        entry.totalHds += hds;
        entry.count++;
        entry.avgHds = entry.totalHds / entry.count;
        byDir[dir] = entry;
      }
    }
  } catch {
    // non-fatal
  }

  return { byDir };
}

function syncToDb(db: DbLike, state: DirectionByFileState): void {
  try {
    db.run("DELETE FROM direction_by_file");
    for (const [path, data] of Object.entries(state.byDir)) {
      if (data.count < 2) continue;
      const density = Math.round(data.avgHds * 100);
      db.run(
        "INSERT INTO direction_by_file (path, project_id, direction_density, event_count) VALUES (?, ?, ?, ?)",
        [path, "", density, data.count],
      );
    }
  } catch {
    // non-fatal
  }
}

export const directionByFileAnalyzer: IncrementalAnalyzer<
  DirectionByFileState,
  FileDirectionEntry[]
> = {
  name: "direction-by-file",
  outputFile: "direction_by_file.json",
  eventFilter: { sources: ["ai-session", "mcp-active", "git"] },
  minDataPoints: 5,

  async initialize(ctx): Promise<IncrementalState<DirectionByFileState>> {
    const value = await fullScan(ctx.analytics);
    syncToDb(ctx.analytics, value);
    return { value, watermark: "", eventCount: 0, updatedAt: new Date().toISOString() };
  },

  async update(state, batch, ctx): Promise<UpdateResult<DirectionByFileState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const needsReconciliation =
      state.eventCount % RECONCILIATION_INTERVAL === 0 && state.eventCount > 0;

    if (needsReconciliation) {
      const value = await fullScan(ctx.analytics);
      syncToDb(ctx.analytics, value);
      const newState: IncrementalState<DirectionByFileState> = {
        value,
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      };
      return { state: newState, changed: true };
    }

    const byDir = { ...state.value.byDir };
    let changed = false;

    for (const evt of batch.events) {
      const text = `${evt.contentSummary ?? ""} ${evt.contentSummary ?? ""}`;
      const hds = evt.humanDirectionScore ?? 0.5;
      for (const dir of extractFileDirs(text)) {
        const entry = byDir[dir] ?? { totalHds: 0, count: 0, avgHds: 0 };
        entry.totalHds += hds;
        entry.count++;
        entry.avgHds = entry.totalHds / entry.count;
        byDir[dir] = entry;
        changed = true;
      }
    }

    if (changed) syncToDb(ctx.analytics, { byDir });

    return {
      state: {
        value: { byDir },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
    };
  },

  derive(state): FileDirectionEntry[] {
    return Object.entries(state.value.byDir)
      .filter(([, d]) => d.count >= 2)
      .map(([path, d]) => ({
        path,
        directionDensity: Math.round(d.avgHds * 100),
        eventCount: d.count,
      }))
      .sort((a, b) => b.eventCount - a.eventCount);
  },
};

export async function readDirectionByFile(db: DbLike): Promise<FileDirectionEntry[]> {
  try {
    const result = await db.exec(
      "SELECT path, direction_density, event_count FROM direction_by_file ORDER BY event_count DESC",
    );
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => ({
      path: row[0] as string,
      directionDensity: row[1] as number,
      eventCount: row[2] as number,
    }));
  } catch {
    return [];
  }
}

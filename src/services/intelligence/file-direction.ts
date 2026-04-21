// FILE: src/services/intelligence/file-direction.ts
// UF-234: Direction density per file/directory.
// Extracts file paths from event content, groups by directory, averages HDS.
// Stored in direction_by_file table. Used by heatmap API.

type DbLike = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
};

export interface FileDirectionEntry {
  path: string;
  directionDensity: number;
  eventCount: number;
}

const FILE_PATTERN =
  /(?:^|\s|['"`(])([a-zA-Z0-9_./-]+\/[a-zA-Z0-9_./-]+\.(?:ts|js|tsx|jsx|go|py|rs|rb|java|kt|swift|c|cpp|h|css|scss|html|vue|svelte|md))/g;

/**
 * Extract file paths mentioned in text, return unique directory prefixes (top-2 levels).
 */
function extractFileDirs(text: string): string[] {
  const dirs = new Set<string>();
  const pattern = new RegExp(FILE_PATTERN.source, FILE_PATTERN.flags);

  for (const match of text.matchAll(pattern)) {
    const filePath = match[1];
    const parts = filePath.split("/");
    if (parts.length >= 2) {
      dirs.add(parts.slice(0, Math.min(parts.length - 1, 3)).join("/"));
    }
  }

  return Array.from(dirs);
}

/**
 * Compute and store per-directory direction density from the events table.
 * Joins events with their direction_signals metadata.
 */
export function computeDirectionByFile(db: DbLike): FileDirectionEntry[] {
  try {
    const result = db.exec(`
      SELECT
        content_summary,
        content_detail,
        json_extract(metadata, '$.direction_signals.human_direction_score') as hds
      FROM events
      WHERE source IN ('ai-session', 'mcp-active', 'git')
        AND (content_detail IS NOT NULL OR content_summary IS NOT NULL)
    `);

    if (!result[0]?.values.length) return [];

    const dirScores = new Map<string, { totalHds: number; count: number }>();

    for (const row of result[0].values) {
      const summary = (row[0] as string) ?? "";
      const detail = (row[1] as string) ?? "";
      const hds = row[2] as number | null;

      const dirs = extractFileDirs(`${summary} ${detail}`);
      if (dirs.length === 0) continue;

      const score = hds ?? 0.5;

      for (const dir of dirs) {
        const entry = dirScores.get(dir) ?? { totalHds: 0, count: 0 };
        entry.totalHds += score;
        entry.count++;
        dirScores.set(dir, entry);
      }
    }

    db.run("DELETE FROM direction_by_file");

    const entries: FileDirectionEntry[] = [];
    for (const [path, data] of dirScores) {
      if (data.count < 2) continue;

      const density = Math.round((data.totalHds / data.count) * 100);
      db.run(
        "INSERT INTO direction_by_file (path, project_id, direction_density, event_count) VALUES (?, ?, ?, ?)",
        [path, "", density, data.count],
      );
      entries.push({ path, directionDensity: density, eventCount: data.count });
    }

    return entries.sort((a, b) => b.eventCount - a.eventCount);
  } catch {
    return [];
  }
}

/**
 * Read direction-by-file from DB (fast path for API).
 */
export function readDirectionByFile(db: DbLike): FileDirectionEntry[] {
  try {
    const result = db.exec(
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

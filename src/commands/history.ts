// FILE: src/commands/history.ts
// 12C.5/12C.15: `unfade history` command — query events by domain, feature, time range.
// Supports --domain, --feature, --last, --format flags.

import { handleCliError } from "../utils/cli-error.js";
import { logger } from "../utils/logger.js";

interface HistoryOptions {
  domain?: string;
  feature?: string;
  last?: string;
  format?: string;
  json?: boolean;
}

interface HistoryEntry {
  id: string;
  ts: string;
  source: string;
  summary: string;
  domain: string | null;
  branch: string | null;
  featureId: string | null;
  featureName: string | null;
}

/**
 * Execute the `unfade history` command.
 */
export async function historyCommand(options: HistoryOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const { CacheManager } = await import("../services/cache/manager.js");
    const cache = new CacheManager(cwd);
    const db = await cache.getDb();

    if (!db) {
      logger.info("No data available. Run `unfade` to start capturing.");
      return;
    }

    const entries = queryHistory(db, options);

    if (options.json || options.format === "json") {
      process.stdout.write(`${JSON.stringify({ entries, count: entries.length }, null, 2)}\n`);
    } else {
      formatHistoryOutput(entries, options);
    }
  } catch (err) {
    handleCliError(err, "history");
  }
}

function queryHistory(
  db: { exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> },
  options: HistoryOptions,
): HistoryEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Time range from --last flag (e.g., "7d", "2w", "30d")
  if (options.last) {
    const days = parseDuration(options.last);
    if (days > 0) {
      conditions.push(`e.ts >= datetime('now', '-${days} days')`);
    }
  }

  // Domain filter
  if (options.domain) {
    conditions.push(`(json_extract(e.metadata, '$.domain') = ? OR e.content_summary LIKE ?)`);
    params.push(options.domain, `%${options.domain}%`);
  }

  // Feature filter (12C.15)
  if (options.feature) {
    conditions.push(`ef.feature_id IN (SELECT id FROM features WHERE name LIKE ?)`);
    params.push(`%${options.feature}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const featureJoin = options.feature
    ? "JOIN event_features ef ON ef.event_id = e.id"
    : "LEFT JOIN event_features ef ON ef.event_id = e.id";

  try {
    const result = db.exec(
      `SELECT e.id, e.ts, e.source, e.content_summary,
              json_extract(e.metadata, '$.domain') as domain,
              e.git_branch,
              ef.feature_id,
              f.name as feature_name
       FROM events e
       ${featureJoin}
       LEFT JOIN features f ON f.id = ef.feature_id
       ${whereClause}
       ORDER BY e.ts DESC
       LIMIT 50`,
      params,
    );

    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => ({
      id: (row[0] as string) ?? "",
      ts: (row[1] as string) ?? "",
      source: (row[2] as string) ?? "",
      summary: (row[3] as string) ?? "",
      domain: (row[4] as string) ?? null,
      branch: (row[5] as string) ?? null,
      featureId: (row[6] as string) ?? null,
      featureName: (row[7] as string) ?? null,
    }));
  } catch {
    return [];
  }
}

function formatHistoryOutput(entries: HistoryEntry[], options: HistoryOptions): void {
  if (entries.length === 0) {
    logger.info("No events found matching the criteria.");
    return;
  }

  const isMd = options.format === "md";

  if (isMd) {
    logger.info(`# Event History\n`);
    for (const e of entries) {
      const tags = [e.source, e.domain, e.featureName].filter(Boolean).join(", ");
      logger.info(`## ${e.ts.slice(0, 16)}`);
      logger.info(`- **${e.summary}**`);
      if (tags) logger.info(`  _${tags}_`);
      if (e.branch) logger.info(`  Branch: \`${e.branch}\``);
      logger.info("");
    }
  } else {
    logger.info(`Found ${entries.length} events:\n`);
    for (const e of entries) {
      const date = e.ts.slice(0, 16);
      const src = `[${e.source}]`;
      const domain = e.domain ? ` (${e.domain})` : "";
      const feature = e.featureName ? ` [${e.featureName}]` : "";
      logger.info(`  ${date}  ${src}${domain}${feature}`);
      logger.info(`    ${e.summary}`);
      logger.info("");
    }
  }
}

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([dwm])$/);
  if (!match) return 7;
  const n = Number.parseInt(match[1], 10);
  switch (match[2]) {
    case "d":
      return n;
    case "w":
      return n * 7;
    case "m":
      return n * 30;
    default:
      return 7;
  }
}

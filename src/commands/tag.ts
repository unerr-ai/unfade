// FILE: src/commands/tag.ts
// Phase 11D.9: `unfade tag <feature-name>` — explicitly bind a feature tag
// to recent events. Escape valve when heuristic feature detection fails.
// Stores in event_features table with source = 'user'.

import { CacheManager } from "../services/cache/manager.js";
import { handleCliError } from "../utils/cli-error.js";
import { logger } from "../utils/logger.js";

interface TagCommandOptions {
  last?: string; // Number of recent events to tag (default: 5)
  session?: string; // Tag all events in a specific session
  json?: boolean;
}

/**
 * Tag recent events with a feature name.
 * This provides an explicit override when automatic feature detection fails.
 */
export async function tagCommand(featureName: string, options: TagCommandOptions): Promise<void> {
  try {
    if (!featureName || featureName.trim().length === 0) {
      logger.error("Feature name is required. Usage: unfade tag <feature-name>");
      process.exitCode = 1;
      return;
    }

    const cache = new CacheManager();
    const db = await cache.getDb();
    if (!db) {
      logger.error("Cache not available. Run `unfade` first to initialize.");
      process.exitCode = 1;
      return;
    }

    const eventIds = resolveTargetEvents(db, options);
    if (eventIds.length === 0) {
      logger.error("No events found to tag.");
      process.exitCode = 1;
      return;
    }

    const tagged = applyFeatureTag(db, featureName.trim(), eventIds);
    await cache.save();

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          data: { featureName: featureName.trim(), eventsTagged: tagged },
          _meta: { tool: "unfade-tag", durationMs: 0, degraded: false },
        }) + "\n",
      );
    } else {
      logger.info(`Tagged ${tagged} events with feature "${featureName.trim()}"`);
    }
  } catch (err) {
    handleCliError(err, "tag");
  }
}

function resolveTargetEvents(
  db: { exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> },
  options: TagCommandOptions,
): string[] {
  if (options.session) {
    const rows = db.exec(
      "SELECT id FROM events WHERE json_extract(metadata, '$.session_id') = ? ORDER BY ts DESC",
      [options.session],
    );
    if (!rows[0]) return [];
    return rows[0].values.map((r) => r[0] as string);
  }

  const limit = Number.parseInt(options.last ?? "5", 10);
  const rows = db.exec(
    "SELECT id FROM events WHERE type = 'ai-conversation' ORDER BY ts DESC LIMIT ?",
    [limit],
  );
  if (!rows[0]) return [];
  return rows[0].values.map((r) => r[0] as string);
}

/**
 * Insert feature tag bindings into event_features table with source = 'user'.
 * Creates a feature entry if it doesn't exist yet.
 */
export function applyFeatureTag(
  db: {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  },
  featureName: string,
  eventIds: string[],
): number {
  // Ensure feature exists
  const featureId = `user-${featureName.replace(/\s+/g, "-").toLowerCase()}`;

  const existing = db.exec("SELECT id FROM features WHERE id = ?", [featureId]);
  if (!existing[0] || existing[0].values.length === 0) {
    db.run(
      `INSERT INTO features (id, project_id, name, branch, first_seen, last_seen, event_count, file_count, session_count, status)
       VALUES (?, ?, ?, NULL, datetime('now'), datetime('now'), 0, 0, 0, 'active')`,
      [featureId, "", featureName],
    );
  }

  let tagged = 0;
  for (const eventId of eventIds) {
    try {
      db.run(
        "INSERT OR IGNORE INTO event_features (event_id, feature_id, source) VALUES (?, ?, 'user')",
        [eventId, featureId],
      );
      tagged++;
    } catch {
      // Skip duplicates
    }
  }

  // Update feature event count
  db.run(
    "UPDATE features SET event_count = event_count + ?, last_seen = datetime('now') WHERE id = ?",
    [tagged, featureId],
  );

  return tagged;
}

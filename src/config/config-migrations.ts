// FILE: src/config/config-migrations.ts
// UF-088: Config migration infrastructure — versioned migrations for config.json.
// Each migration is a pure function (oldConfig) → newConfig.
// Runner detects current version, applies migrations sequentially,
// writes backup before mutation. Non-destructive.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigMigration {
  from: number;
  to: number;
  up: (config: Record<string, unknown>) => Record<string, unknown>;
}

export interface MigrationResult {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
}

// ---------------------------------------------------------------------------
// Migration registry
// ---------------------------------------------------------------------------

export const CONFIG_MIGRATIONS: ConfigMigration[] = [
  {
    from: 1,
    to: 2,
    up: (config) => ({
      ...config,
      version: 2,
      site: config.site ?? { outputDir: ".unfade/site" },
    }),
  },
];

export const LATEST_CONFIG_VERSION = 2;

// ---------------------------------------------------------------------------
// Core: apply migration chain
// ---------------------------------------------------------------------------

/**
 * Apply all applicable migrations to a config object.
 * Returns the migrated config and the final version.
 */
export function applyMigrations(
  config: Record<string, unknown>,
  migrations: ConfigMigration[] = CONFIG_MIGRATIONS,
): { config: Record<string, unknown>; fromVersion: number; toVersion: number } {
  const fromVersion = typeof config.version === "number" ? config.version : 1;
  let current = { ...config };
  let currentVersion = fromVersion;

  for (const migration of migrations) {
    if (migration.from === currentVersion) {
      current = migration.up(current);
      currentVersion = migration.to;
    }
  }

  return { config: current, fromVersion, toVersion: currentVersion };
}

// ---------------------------------------------------------------------------
// Disk operations
// ---------------------------------------------------------------------------

/**
 * Migrate a config.json file on disk.
 * 1. Reads the file
 * 2. Detects version (defaults to 1 if missing)
 * 3. Applies sequential migrations
 * 4. Writes backup as config.backup.json
 * 5. Writes migrated config
 *
 * Returns migration result, or null if no migration needed.
 */
export function migrateConfigOnDisk(configDir: string): MigrationResult | null {
  const configPath = join(configDir, "config.json");

  if (!existsSync(configPath)) {
    logger.debug("No config.json to migrate");
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    logger.warn("Could not read config.json for migration");
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.warn("config.json is not a JSON object — skipping migration");
      return null;
    }
  } catch {
    logger.warn("config.json is not valid JSON — skipping migration");
    return null;
  }

  const currentVersion = typeof parsed.version === "number" ? parsed.version : 1;

  if (currentVersion >= LATEST_CONFIG_VERSION) {
    logger.debug("Config is already at latest version", { version: currentVersion });
    return null;
  }

  const { config: migrated, fromVersion, toVersion } = applyMigrations(parsed);

  // Write backup before mutation
  const backupPath = join(configDir, "config.backup.json");
  writeFileSync(backupPath, `${raw}\n`, "utf-8");
  logger.info("Backed up config", { path: backupPath });

  // Write migrated config
  writeFileSync(configPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf-8");
  logger.info("Migrated config", { from: fromVersion, to: toVersion });

  return { migrated: true, fromVersion, toVersion, backupPath };
}

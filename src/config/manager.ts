// FILE: src/config/manager.ts
// Config loading: env vars → global config (~/.unfade/config.json) → project overrides
// → deep merge → Zod validate. Global-first: ~/.unfade/config.json is the base.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type UnfadeConfig, UnfadeConfigSchema } from "../schemas/config.js";
import { logger } from "../utils/logger.js";
import { getProjectDataDir, getUserConfigDir } from "../utils/paths.js";

const CONFIG_FILENAME = "config.json";

/** Environment variable prefix. UNFADE_CAPTURE__SOURCES__GIT=false → capture.sources.git = false */
const ENV_PREFIX = "UNFADE_";

/**
 * Read and parse a JSON config file. Returns empty object if file doesn't exist
 * or is malformed (logs a warning on parse failure).
 */
function readConfigFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.warn("Config file is not a JSON object, ignoring", { path: filePath });
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    logger.warn("Failed to parse config file, ignoring", { path: filePath });
    return {};
  }
}

/**
 * Parse environment variables with UNFADE_ prefix into a nested config object.
 * Uses double underscore as nesting separator.
 * Example: UNFADE_CAPTURE__SOURCES__GIT=false → { capture: { sources: { git: false } } }
 */
function readEnvConfig(): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(ENV_PREFIX) || value === undefined) continue;

    const path = key.slice(ENV_PREFIX.length).toLowerCase().split("__");

    let current = result;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = camelCase(path[i]);
      if (typeof current[segment] !== "object" || current[segment] === null) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }

    const lastSegment = camelCase(path[path.length - 1]);
    current[lastSegment] = coerceValue(value);
  }

  return result;
}

function camelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function coerceValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== "") return num;
  return value;
}

/**
 * Deep merge two plain objects. Source values override target values.
 * Arrays are replaced, not concatenated.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      typeof srcVal === "object" &&
      srcVal !== null &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === "object" &&
      tgtVal !== null &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

export interface LoadConfigOptions {
  /** Override user config dir (for testing). */
  userConfigDir?: string;
  /** Override project data dir (for testing). */
  projectDataDir?: string;
  /** Override env vars (for testing). */
  env?: Record<string, string | undefined>;
}

/**
 * Load config with precedence: env vars → project overrides → global config → defaults.
 * Global config (~/.unfade/config.json) is the base. Project config selectively overrides.
 * Always returns a valid UnfadeConfig (Zod-validated with defaults filled in).
 * Throws on invalid config values that cannot be coerced.
 */
export function loadConfig(options: LoadConfigOptions = {}): UnfadeConfig {
  const userDir = options.userConfigDir ?? getUserConfigDir();
  const projectDir = options.projectDataDir ?? getProjectDataDir();

  const globalConfig = readConfigFile(join(userDir, CONFIG_FILENAME));
  const projectConfig = readConfigFile(join(projectDir, CONFIG_FILENAME));

  // Global-first: global config is the base, project config selectively overrides
  let merged = deepMerge(globalConfig, projectConfig);

  // Env overrides everything
  const savedEnv = process.env;
  if (options.env) {
    // Temporarily set env for readEnvConfig
    process.env = { ...process.env, ...options.env };
  }
  const envConfig = readEnvConfig();
  if (options.env) {
    process.env = savedEnv;
  }

  merged = deepMerge(merged, envConfig);

  // Zod parse fills in defaults and validates
  return UnfadeConfigSchema.parse(merged);
}

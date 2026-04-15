// FILE: src/services/init/scaffold.ts
// Step 1 of init: scaffold .unfade/ directory tree, config.json, and gitignore.
// This is the only fatal step — all other init steps tolerate failure.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UnfadeConfigSchema } from "../../schemas/config.js";
import { logger } from "../../utils/logger.js";
import {
  getBinDir,
  getCacheDir,
  getDistillsDir,
  getEventsDir,
  getGraphDir,
  getLogsDir,
  getProfileDir,
  getProjectDataDir,
  getStateDir,
} from "../../utils/paths.js";

const CONFIG_FILENAME = "config.json";
const GITIGNORE_MARKER = "# unfade-hook";

/**
 * Subdirectories to create inside .unfade/.
 * Each function returns the absolute path for a given cwd.
 */
const SUBDIRS = [
  getEventsDir,
  getDistillsDir,
  getProfileDir,
  getStateDir,
  getGraphDir,
  getCacheDir,
  getLogsDir,
  getBinDir,
];

/**
 * Create the full .unfade/ directory tree with all required subdirectories.
 * Idempotent — skips directories that already exist.
 */
function createDirectoryTree(cwd: string): void {
  const projectDir = getProjectDataDir(cwd);
  mkdirSync(projectDir, { recursive: true });

  for (const getDirFn of SUBDIRS) {
    const dir = getDirFn(cwd);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.debug("Created directory", { path: dir });
    }
  }
}

/**
 * Write config.json with Zod defaults if it doesn't exist.
 * Never overwrites an existing config.
 */
function writeDefaultConfig(cwd: string): void {
  const configPath = join(getProjectDataDir(cwd), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    logger.debug("Config already exists, skipping", { path: configPath });
    return;
  }

  const defaults = UnfadeConfigSchema.parse({});
  writeFileSync(configPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf-8");
  logger.debug("Wrote default config", { path: configPath });
}

/**
 * Add .unfade/ to .git/info/exclude so it's ignored without touching .gitignore.
 * Idempotent — checks for existing marker before appending.
 */
function addGitExclude(cwd: string): void {
  const gitInfoDir = join(cwd, ".git", "info");
  const excludePath = join(gitInfoDir, "exclude");

  if (!existsSync(join(cwd, ".git"))) {
    logger.debug("Not a git repo, skipping git exclude");
    return;
  }

  // Ensure .git/info/ directory exists (it should, but be safe).
  if (!existsSync(gitInfoDir)) {
    mkdirSync(gitInfoDir, { recursive: true });
  }

  // Check if already present.
  if (existsSync(excludePath)) {
    const content = readFileSync(excludePath, "utf-8");
    if (content.includes(GITIGNORE_MARKER)) {
      logger.debug("Git exclude already configured");
      return;
    }
  }

  const entry = `\n${GITIGNORE_MARKER}\n.unfade/\n`;
  writeFileSync(excludePath, entry, { flag: "a", encoding: "utf-8" });
  logger.debug("Added .unfade/ to git exclude");
}

export interface ScaffoldResult {
  projectDir: string;
  created: boolean;
}

/**
 * Execute the scaffold step: create directory tree, write config, configure git exclude.
 * Idempotent — safe to call multiple times. Throws on failure (fatal step).
 */
export function scaffold(cwd: string): ScaffoldResult {
  const projectDir = getProjectDataDir(cwd);
  const alreadyExisted = existsSync(projectDir);

  createDirectoryTree(cwd);
  writeDefaultConfig(cwd);
  addGitExclude(cwd);

  return {
    projectDir,
    created: !alreadyExisted,
  };
}

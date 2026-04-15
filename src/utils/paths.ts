// FILE: src/utils/paths.ts
// Path resolution for ~/.unfade/ (user config) and .unfade/ (project data).
// All paths use node:path join — no string concatenation with '/'.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const UNFADE_DIR = ".unfade";

/**
 * Walk up from `startDir` to find the nearest directory containing `.git`.
 * Returns the directory path, or null if not found.
 */
function findGitRoot(startDir: string): string | null {
  let current = resolve(startDir);
  const root = resolve("/");

  while (current !== root) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  return null;
}

// --- User-level config directory ---

/** Returns `~/.unfade/` — user-level configuration and global state. */
export function getUserConfigDir(): string {
  return join(homedir(), UNFADE_DIR);
}

// --- Project-level data directory ---

/**
 * Returns `.unfade/` relative to the nearest git root.
 * Falls back to `.unfade/` relative to cwd if no git repo is found.
 */
export function getProjectDataDir(cwd: string = process.cwd()): string {
  const gitRoot = findGitRoot(cwd);
  const base = gitRoot ?? cwd;
  return join(base, UNFADE_DIR);
}

// --- Subdirectories of project data ---

/** `.unfade/events/` — daily JSONL event files written by the Go daemon. */
export function getEventsDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "events");
}

/** `.unfade/distills/` — daily reasoning summaries. */
export function getDistillsDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "distills");
}

/** `.unfade/profile/` — reasoning model and preferences. */
export function getProfileDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "profile");
}

/** `.unfade/state/` — daemon PID, socket, runtime state. */
export function getStateDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "state");
}

/** `.unfade/graph/` — decisions and domain graph. */
export function getGraphDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "graph");
}

/** `.unfade/cache/` — temporary computation cache. */
export function getCacheDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "cache");
}

/** `.unfade/logs/` — daemon and service logs. */
export function getLogsDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "logs");
}

/** `.unfade/bin/` — daemon binaries (unfaded, unfade-send). */
export function getBinDir(cwd?: string): string {
  return join(getProjectDataDir(cwd), "bin");
}

/** `~/.unfade/state/` — user-level global state (repos.json, etc). */
export function getUserStateDir(): string {
  return join(getUserConfigDir(), "state");
}

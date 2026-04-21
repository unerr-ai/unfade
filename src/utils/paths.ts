// FILE: src/utils/paths.ts
// Global-first path resolution for ~/.unfade/ (Phase 14).
// All data lives under ~/.unfade/. Per-project artifacts live under ~/.unfade/projects/<id>/.
// The optional override parameter routes to a test directory for isolation.

import { homedir } from "node:os";
import { join } from "node:path";

const UNFADE_DIR = ".unfade";

// ---------------------------------------------------------------------------
// Global Unfade home
// ---------------------------------------------------------------------------

/**
 * Returns the Unfade home directory.
 * Resolution order:
 * 1. Explicit override parameter → `join(override, '.unfade')`
 * 2. UNFADE_HOME env var → used as-is (test isolation, like DOCKER_CONFIG)
 * 3. Default → `~/.unfade/`
 */
export function getUnfadeHome(override?: string): string {
  if (override) return join(override, UNFADE_DIR);
  if (process.env.UNFADE_HOME) return process.env.UNFADE_HOME;
  return join(homedir(), UNFADE_DIR);
}

/** Alias used by config loader — `~/.unfade/`. */
export function getUserConfigDir(): string {
  return getUnfadeHome();
}

// ---------------------------------------------------------------------------
// Global data directories (all under ~/.unfade/)
// ---------------------------------------------------------------------------

/** `~/.unfade/events/` — ALL events, ALL projects, date-partitioned JSONL. */
export function getEventsDir(override?: string): string {
  return join(getUnfadeHome(override), "events");
}

/** `~/.unfade/cache/` — single global SQLite materialized view. */
export function getCacheDir(override?: string): string {
  return join(getUnfadeHome(override), "cache");
}

/** `~/.unfade/state/` — global runtime state (registry, materializer cursor, server). */
export function getStateDir(override?: string): string {
  return join(getUnfadeHome(override), "state");
}

/** `~/.unfade/profile/` — global reasoning model. */
export function getProfileDir(override?: string): string {
  return join(getUnfadeHome(override), "profile");
}

/** `~/.unfade/graph/` — global decisions and domain graph. */
export function getGraphDir(override?: string): string {
  return join(getUnfadeHome(override), "graph");
}

/** `~/.unfade/amplification/` — cross-project connections. */
export function getAmplificationDir(override?: string): string {
  return join(getUnfadeHome(override), "amplification");
}

/** `~/.unfade/metrics/` — global metric snapshots. */
export function getMetricsDir(override?: string): string {
  return join(getUnfadeHome(override), "metrics");
}

/** `~/.unfade/insights/` — ring-buffered LiveInsight lines. */
export function getInsightsDir(override?: string): string {
  return join(getUnfadeHome(override), "insights");
}

/** `~/.unfade/logs/` — server and global logs. */
export function getLogsDir(override?: string): string {
  return join(getUnfadeHome(override), "logs");
}

/** `~/.unfade/bin/` — shared daemon binaries (one copy for all projects). */
export function getBinDir(override?: string): string {
  return join(getUnfadeHome(override), "bin");
}

/** `~/.unfade/cards/` — generated Unfade Card PNG images. */
export function getCardsDir(override?: string): string {
  return join(getUnfadeHome(override), "cards");
}

/** `~/.unfade/site/` — generated Thinking Graph static site. */
export function getSiteDir(override?: string): string {
  return join(getUnfadeHome(override), "site");
}

/** `~/.unfade/distills/` — daily reasoning summaries. */
export function getDistillsDir(override?: string): string {
  return join(getUnfadeHome(override), "distills");
}

/** `~/.unfade/intelligence/` — global analyzer outputs. */
export function getIntelligenceDir(override?: string): string {
  return join(getUnfadeHome(override), "intelligence");
}

// ---------------------------------------------------------------------------
// User-level state (convenience alias)
// ---------------------------------------------------------------------------

/** `~/.unfade/state/` — global state directory. */
export function getUserStateDir(): string {
  return getStateDir();
}

// ---------------------------------------------------------------------------
// Per-project directories (under ~/.unfade/projects/<projectId>/)
// ---------------------------------------------------------------------------

/** `~/.unfade/projects/<projectId>/` — per-project derived artifacts root. */
export function getProjectDir(projectId: string, override?: string): string {
  return join(getUnfadeHome(override), "projects", projectId);
}

/** `~/.unfade/state/daemons/<projectId>/` — per-project daemon runtime state. */
export function getDaemonStateDir(projectId: string, override?: string): string {
  return join(getStateDir(override), "daemons", projectId);
}

/**
 * Legacy shim — routes to getUnfadeHome(). Kept for callers not yet migrated.
 */
export function getProjectDataDir(cwd?: string): string {
  return getUnfadeHome(cwd);
}

/**
 * Legacy shim — returns cwd as-is. The repo root comes from the registry.
 */
export function getDaemonProjectRoot(cwd: string = process.cwd()): string {
  return cwd;
}

// FILE: src/services/registry/resolver.ts
// UF-221: Longest-prefix match repo resolution from registry.
// Used by IPC routing, CLI context detection, and multi-repo dashboard.

import { join, resolve } from "node:path";
import { loadRegistry, type RepoEntry } from "./registry.js";

/**
 * Find the repo whose root is the longest prefix match for `cwd`.
 * Returns null if no registered repo matches.
 * Algorithm: sort by descending path length, first startsWith match wins.
 * O(N) where N = registered repos (typically < 20).
 */
export function resolveRepoByPath(cwd: string): RepoEntry | null {
  const registry = loadRegistry();
  if (registry.repos.length === 0) return null;

  const resolvedCwd = resolve(cwd);

  const sorted = [...registry.repos].sort((a, b) => b.root.length - a.root.length);

  for (const repo of sorted) {
    const resolvedRoot = resolve(repo.root);
    if (resolvedCwd === resolvedRoot || resolvedCwd.startsWith(`${resolvedRoot}/`)) {
      return repo;
    }
  }

  return null;
}

/**
 * Resolve the daemon socket path for a given cwd using registry lookup.
 * Falls back to global ~/.unfade/state/daemon.sock if no match.
 */
export function resolveSocketPathFromRegistry(cwd: string): string {
  const repo = resolveRepoByPath(cwd);
  if (repo) {
    return join(repo.root, ".unfade", "state", "daemon.sock");
  }

  const { getUserStateDir } =
    require("../../utils/paths.js") as typeof import("../../utils/paths.js");
  return join(getUserStateDir(), "daemon.sock");
}

/**
 * List all registered repos with their resolved data paths.
 */
export function listRepos(): RepoEntry[] {
  return loadRegistry().repos;
}

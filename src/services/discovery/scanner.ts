// Phase 10-PD: Project discovery scanner
// Scans configured directories for git repos not yet registered.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { loadRegistry } from "../registry/registry.js";

export interface DiscoveredProject {
  path: string;
  label: string;
  hasGit: boolean;
  hasUnfadeMarker: boolean;
  alreadyRegistered: boolean;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "Library",
  ".Trash",
  ".cache",
  ".npm",
  ".nvm",
  ".cargo",
  ".rustup",
  "vendor",
  "dist",
  "build",
  ".next",
]);

const DEFAULT_SCAN_DIRS = [
  "IdeaProjects",
  "Developer",
  "Projects",
  "repos",
  "src",
  "Code",
  "workspace",
];

/**
 * Discover git repositories in configured scan directories.
 * Returns projects NOT already registered in the global registry.
 * Max depth: 2 levels from each scan root.
 */
export function discoverProjects(scanDirs?: string[], maxDepth = 2): DiscoveredProject[] {
  const home = homedir();
  const roots = (scanDirs ?? DEFAULT_SCAN_DIRS).map((d) =>
    d.startsWith("/") || d.startsWith("~") ? d.replace("~", home) : join(home, d),
  );

  const registry = loadRegistry();
  const registeredRoots = new Set(registry.repos.map((r) => r.root));

  const results: DiscoveredProject[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    scanDir(root, 0, maxDepth, registeredRoots, results);
  }

  return results;
}

function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  registeredRoots: Set<string>,
  results: DiscoveredProject[],
): void {
  if (depth > maxDepth) return;

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, {
      withFileTypes: true,
      encoding: "utf-8",
    }) as import("node:fs").Dirent[];
  } catch {
    return;
  }

  const hasGit = entries.some((e) => String(e.name) === ".git");

  if (hasGit) {
    const hasMarker = entries.some(
      (e) => String(e.name) === ".unfade" && (e.isDirectory() || e.isFile()),
    );
    results.push({
      path: dir,
      label: basename(dir),
      hasGit: true,
      hasUnfadeMarker: hasMarker,
      alreadyRegistered: registeredRoots.has(dir),
    });
  }

  if (depth < maxDepth) {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = String(entry.name);
      if (SKIP_DIRS.has(name)) continue;
      if (name.startsWith(".") && name !== ".git") continue;

      const childPath = join(dir, name);
      try {
        statSync(childPath);
        scanDir(childPath, depth + 1, maxDepth, registeredRoots, results);
      } catch {
        // permission denied or broken symlink
      }
    }
  }
}

// In-memory cache (60s TTL)
let cachedResults: DiscoveredProject[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export function discoverProjectsCached(scanDirs?: string[]): DiscoveredProject[] {
  const now = Date.now();
  if (cachedResults && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedResults;
  }
  cachedResults = discoverProjects(scanDirs);
  cacheTimestamp = now;
  return cachedResults;
}

export function clearDiscoveryCache(): void {
  cachedResults = null;
  cacheTimestamp = 0;
}

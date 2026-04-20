// FILE: src/services/registry/registry.ts
// UF-220: Registry v1 — canonical project registry at ~/.unfade/state/registry.v1.json.
// Auto-migrates from legacy repos.json on first read.
// All paths stored as canonical git roots (not .unfade dirs).

import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getUserStateDir } from "../../utils/paths.js";

const REGISTRY_FILENAME = "registry.v1.json";
const LEGACY_FILENAME = "repos.json";
const LEGACY_BACKUP = "repos.json.bak";

export interface RepoEntry {
  id: string;
  root: string;
  label: string;
  lastSeenAt: string;
  capabilities: { daemon: boolean; git: boolean };
  paths: { data: string };
}

export interface RegistryV1 {
  schemaVersion: 1;
  repos: RepoEntry[];
}

function registryPath(): string {
  return join(getUserStateDir(), REGISTRY_FILENAME);
}

function legacyPath(): string {
  return join(getUserStateDir(), LEGACY_FILENAME);
}

/**
 * Load the registry, auto-migrating from legacy repos.json if needed.
 */
export function loadRegistry(): RegistryV1 {
  const regPath = registryPath();

  if (existsSync(regPath)) {
    try {
      const data = JSON.parse(readFileSync(regPath, "utf-8")) as RegistryV1;
      if (data.schemaVersion === 1 && Array.isArray(data.repos)) {
        return data;
      }
    } catch {
      // corrupted — try migration from legacy
    }
  }

  const legacy = legacyPath();
  if (existsSync(legacy)) {
    return migrateFromLegacy();
  }

  return { schemaVersion: 1, repos: [] };
}

/**
 * Save registry atomically (tmp + rename).
 */
export function saveRegistry(registry: RegistryV1): void {
  const stateDir = getUserStateDir();
  mkdirSync(stateDir, { recursive: true });
  const target = registryPath();
  const tmp = join(stateDir, `${REGISTRY_FILENAME}.tmp.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf-8");
  renameSync(tmp, target);
}

/**
 * Register a repo by its root path. Deduplicates by root.
 */
export function registerRepo(repoRoot: string): void {
  const registry = loadRegistry();

  if (registry.repos.some((r) => r.root === repoRoot)) {
    const idx = registry.repos.findIndex((r) => r.root === repoRoot);
    registry.repos[idx].lastSeenAt = new Date().toISOString();
    saveRegistry(registry);
    return;
  }

  const entry: RepoEntry = {
    id: randomUUID(),
    root: repoRoot,
    label: basename(repoRoot),
    lastSeenAt: new Date().toISOString(),
    capabilities: { daemon: true, git: true },
    paths: { data: join(repoRoot, ".unfade") },
  };

  registry.repos.push(entry);
  saveRegistry(registry);
  logger.debug("Registered repo in registry.v1", { root: repoRoot, id: entry.id });
}

/**
 * Unregister a repo by its root path. Resolves both paths for symlink safety.
 */
export function unregisterRepo(repoRoot: string): void {
  const { resolve } = require("node:path") as typeof import("node:path");
  const { realpathSync } = require("node:fs") as typeof import("node:fs");
  const registry = loadRegistry();
  const before = registry.repos.length;

  let normalizedTarget: string;
  try {
    normalizedTarget = realpathSync(resolve(repoRoot));
  } catch {
    normalizedTarget = resolve(repoRoot);
  }

  registry.repos = registry.repos.filter((r) => {
    let normalizedRoot: string;
    try {
      normalizedRoot = realpathSync(resolve(r.root));
    } catch {
      normalizedRoot = resolve(r.root);
    }
    return normalizedRoot !== normalizedTarget;
  });

  if (registry.repos.length < before) {
    saveRegistry(registry);
    logger.debug("Unregistered repo from registry.v1", { root: repoRoot });
  }
}

/**
 * Find a repo entry by its ID.
 */
export function findRepoById(id: string): RepoEntry | null {
  const registry = loadRegistry();
  return registry.repos.find((r) => r.id === id) ?? null;
}

function migrateFromLegacy(): RegistryV1 {
  const legacy = legacyPath();
  const stateDir = getUserStateDir();
  mkdirSync(stateDir, { recursive: true });

  try {
    copyFileSync(legacy, join(stateDir, LEGACY_BACKUP));
  } catch {
    logger.debug("Could not backup legacy repos.json");
  }

  let legacyEntries: Array<{ path: string; addedAt: string }> = [];
  try {
    legacyEntries = JSON.parse(readFileSync(legacy, "utf-8"));
    if (!Array.isArray(legacyEntries)) legacyEntries = [];
  } catch {
    legacyEntries = [];
  }

  const repos: RepoEntry[] = legacyEntries.map((entry) => {
    const entryPath = entry.path;
    const root = entryPath.endsWith(".unfade") ? dirname(entryPath) : entryPath;

    return {
      id: randomUUID(),
      root,
      label: basename(root),
      lastSeenAt: entry.addedAt ?? new Date().toISOString(),
      capabilities: { daemon: true, git: true },
      paths: { data: join(root, ".unfade") },
    };
  });

  const registry: RegistryV1 = { schemaVersion: 1, repos };
  saveRegistry(registry);

  logger.debug("Migrated repos.json → registry.v1.json", { count: repos.length });
  return registry;
}

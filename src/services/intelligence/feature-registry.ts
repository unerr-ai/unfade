// FILE: src/services/intelligence/feature-registry.ts
// Dynamic, unbounded feature registry learned from repository structure.
// Features are discovered from directory structure, git commit frequency,
// branch naming conventions, and prompt content. No hardcoded feature list.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeatureGroup {
  id: string;
  name: string;
  modulePath: string;
  aliases: string[];
  source: "directory" | "git-frequency" | "branch" | "prompt-content";
  eventCount: number;
  lastSeen: string;
  children: string[];
  parentId: string | null;
}

export interface FeatureRegistry {
  features: Map<string, FeatureGroup>;
  pathIndex: PathTrie;
  lastRebuilt: string;
  projectId: string;
}

// ---------------------------------------------------------------------------
// PathTrie — O(log n) prefix matching of file paths to features
// ---------------------------------------------------------------------------

interface TrieNode {
  children: Map<string, TrieNode>;
  featureId: string | null;
}

export class PathTrie {
  private root: TrieNode = { children: new Map(), featureId: null };

  insert(path: string, featureId: string): void {
    const segments = normalizePath(path).split("/").filter(Boolean);
    let node = this.root;
    for (const seg of segments) {
      if (!node.children.has(seg)) {
        node.children.set(seg, { children: new Map(), featureId: null });
      }
      node = node.children.get(seg)!;
    }
    node.featureId = featureId;
  }

  /**
   * Longest-prefix match: walk down the trie, return the deepest matching feature.
   */
  resolve(filePath: string): string | null {
    const segments = normalizePath(filePath).split("/").filter(Boolean);
    let node = this.root;
    let lastMatch: string | null = null;

    for (const seg of segments) {
      const child = node.children.get(seg);
      if (!child) break;
      node = child;
      if (node.featureId) lastMatch = node.featureId;
    }

    return lastMatch;
  }

  toJSON(): Array<{ path: string; featureId: string }> {
    const entries: Array<{ path: string; featureId: string }> = [];
    const walk = (node: TrieNode, prefix: string) => {
      if (node.featureId) entries.push({ path: prefix, featureId: node.featureId });
      for (const [seg, child] of node.children) {
        walk(child, prefix ? `${prefix}/${seg}` : seg);
      }
    };
    walk(this.root, "");
    return entries;
  }

  static fromJSON(entries: Array<{ path: string; featureId: string }>): PathTrie {
    const trie = new PathTrie();
    for (const { path, featureId } of entries) {
      trie.insert(path, featureId);
    }
    return trie;
  }
}

// ---------------------------------------------------------------------------
// Registry construction
// ---------------------------------------------------------------------------

const MAX_DEPTH = 4;
const MIN_SOURCE_FILES = 3;
const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".sql",
]);

/**
 * Build or update the feature registry for a project.
 * Cold start: scan directory structure. Incremental: merge new discoveries.
 */
export async function buildFeatureRegistry(
  projectRoot: string,
  projectId: string,
  existingRegistry?: FeatureRegistry,
): Promise<FeatureRegistry> {
  const features = existingRegistry
    ? new Map(existingRegistry.features)
    : new Map<string, FeatureGroup>();
  const trie = new PathTrie();

  if (existsSync(projectRoot)) {
    discoverFromDirectoryStructure(projectRoot, projectRoot, features, 0);
  }

  for (const [, feature] of features) {
    trie.insert(feature.modulePath, feature.id);
    for (const alias of feature.aliases) {
      trie.insert(alias, feature.id);
    }
  }

  return {
    features,
    pathIndex: trie,
    lastRebuilt: new Date().toISOString(),
    projectId,
  };
}

function discoverFromDirectoryStructure(
  root: string,
  dir: string,
  features: Map<string, FeatureGroup>,
  depth: number,
): void {
  if (depth >= MAX_DEPTH) return;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const subDirs = entries.filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        e.name !== "node_modules" &&
        e.name !== "dist" &&
        e.name !== "build" &&
        e.name !== "__pycache__",
    );

    for (const sub of subDirs) {
      const fullPath = join(dir, sub.name);
      const relativePath = fullPath.slice(root.length + 1);
      const sourceFileCount = countSourceFiles(fullPath);

      if (sourceFileCount >= MIN_SOURCE_FILES) {
        const id = makeFeatureId(relativePath);
        if (!features.has(id)) {
          features.set(id, {
            id,
            name: deriveFeatureName(relativePath),
            modulePath: relativePath,
            aliases: [],
            source: "directory",
            eventCount: 0,
            lastSeen: new Date().toISOString(),
            children: [],
            parentId: findParentId(relativePath, features),
          });
        }
      }

      discoverFromDirectoryStructure(root, fullPath, features, depth + 1);
    }
  } catch {
    // permission errors, symlink loops, etc.
  }
}

function countSourceFiles(dir: string): number {
  try {
    let count = 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (SOURCE_EXTS.has(ext)) count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Incremental discovery from events
// ---------------------------------------------------------------------------

/**
 * Discover features from a branch name (e.g., "feat/auth-oauth" → "auth-oauth").
 */
export function discoverFromBranch(branch: string, registry: FeatureRegistry): FeatureGroup | null {
  if (!branch) return null;

  const prefixes = ["feat/", "feature/", "fix/", "bugfix/", "refactor/"];
  let featureName: string | null = null;

  for (const prefix of prefixes) {
    if (branch.toLowerCase().startsWith(prefix)) {
      featureName = branch.slice(prefix.length).replace(/[-_]/g, " ").trim();
      break;
    }
  }

  if (!featureName) return null;

  const id = makeFeatureId(`branch:${featureName}`);
  if (registry.features.has(id)) {
    const existing = registry.features.get(id)!;
    existing.lastSeen = new Date().toISOString();
    return existing;
  }

  const feature: FeatureGroup = {
    id,
    name: featureName,
    modulePath: "",
    aliases: [],
    source: "branch",
    eventCount: 0,
    lastSeen: new Date().toISOString(),
    children: [],
    parentId: null,
  };

  registry.features.set(id, feature);
  return feature;
}

/**
 * Resolve file paths from an event to feature groups.
 * Uses the PathTrie for O(log n) prefix matching.
 */
export function resolveFeatures(registry: FeatureRegistry, filePaths: string[]): FeatureGroup[] {
  const matched = new Map<string, FeatureGroup>();

  for (const fp of filePaths) {
    const featureId = registry.pathIndex.resolve(fp);
    if (featureId && registry.features.has(featureId)) {
      matched.set(featureId, registry.features.get(featureId)!);
    }
  }

  return [...matched.values()];
}

/**
 * Extract file paths and identifiers from prompt text.
 */
export function extractPathsFromPrompt(promptText: string): string[] {
  if (!promptText) return [];

  const paths = new Set<string>();
  const patterns = [
    /(?:^|\s)((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.\w+)/gm,
    /(?:^|\s)(src\/\S+)/gm,
    /(?:^|\s)(lib\/\S+)/gm,
    /(?:^|\s)(app\/\S+)/gm,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(promptText); m !== null; m = pattern.exec(promptText)) {
      const p = m[1].trim();
      if (p.includes("/") && !p.startsWith("http")) {
        paths.add(p);
      }
    }
  }

  return [...paths];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface SerializedRegistry {
  features: Array<[string, FeatureGroup]>;
  trieEntries: Array<{ path: string; featureId: string }>;
  lastRebuilt: string;
  projectId: string;
}

export function saveRegistry(registry: FeatureRegistry, repoRoot?: string): void {
  try {
    const dir = join(getIntelligenceDir(repoRoot), "feature-registry");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${registry.projectId}.json`);
    const tmp = `${target}.tmp.${process.pid}`;
    const serialized: SerializedRegistry = {
      features: [...registry.features.entries()],
      trieEntries: registry.pathIndex.toJSON(),
      lastRebuilt: registry.lastRebuilt,
      projectId: registry.projectId,
    };
    writeFileSync(tmp, JSON.stringify(serialized, null, 2), "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    logger.debug("Failed to save feature registry", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function loadRegistry(projectId: string, repoRoot?: string): FeatureRegistry | null {
  try {
    const dir = join(getIntelligenceDir(repoRoot), "feature-registry");
    const path = join(dir, `${projectId}.json`);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf-8")) as SerializedRegistry;
    return {
      features: new Map(raw.features),
      pathIndex: PathTrie.fromJSON(raw.trieEntries),
      lastRebuilt: raw.lastRebuilt,
      projectId: raw.projectId,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeatureId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

function deriveFeatureName(modulePath: string): string {
  const segments = modulePath.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? modulePath;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function findParentId(modulePath: string, features: Map<string, FeatureGroup>): string | null {
  const parts = modulePath.split("/");
  for (let i = parts.length - 1; i > 0; i--) {
    const parentPath = parts.slice(0, i).join("/");
    const parentId = makeFeatureId(parentPath);
    if (features.has(parentId)) return parentId;
  }
  return null;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

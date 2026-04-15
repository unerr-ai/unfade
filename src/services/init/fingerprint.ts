// FILE: src/services/init/fingerprint.ts
// Step 2 of init: fingerprint project via git log.
// Computes domain distribution and initial reasoning model seed.
// Writes to .unfade/profile/reasoning_model.json.

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getProfileDir } from "../../utils/paths.js";

const REASONING_MODEL_FILE = "reasoning_model.json";

interface DomainEntry {
  domain: string;
  fileCount: number;
}

/**
 * Map file extensions to high-level domains.
 */
function extensionToDomain(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".go": "go",
    ".py": "python",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rb": "ruby",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "cpp",
    ".cs": "csharp",
    ".css": "styles",
    ".scss": "styles",
    ".html": "markup",
    ".vue": "vue",
    ".svelte": "svelte",
    ".sql": "database",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".yml": "config",
    ".yaml": "config",
    ".json": "config",
    ".toml": "config",
    ".md": "docs",
    ".mdx": "docs",
    ".proto": "api",
    ".graphql": "api",
    ".dockerfile": "infra",
    ".tf": "infra",
  };
  return map[ext.toLowerCase()] ?? "other";
}

/**
 * Extract file extension from a path, handling Dockerfile and similar.
 */
function getExtension(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith("dockerfile") || lower.includes("dockerfile.")) return ".dockerfile";
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filePath.slice(lastDot);
}

/**
 * Run git log to get files touched in the last N days.
 * Returns a map of domain → file count.
 */
function computeDomains(cwd: string, days: number): DomainEntry[] {
  const since = `${days}.days.ago`;
  let output: string;

  try {
    output = execSync(`git log --since="${since}" --name-only --pretty=format:""`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });
  } catch {
    logger.debug("git log failed for fingerprint, returning empty domains");
    return [];
  }

  const domainCounts = new Map<string, number>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const ext = getExtension(trimmed);
    if (ext === "") continue;

    const domain = extensionToDomain(ext);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  return Array.from(domainCounts.entries())
    .map(([domain, fileCount]) => ({ domain, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount);
}

/**
 * Compute commit count in the last N days.
 */
function commitCount(cwd: string, days: number): number {
  try {
    const output = execSync(`git rev-list --count --since="${days}.days.ago" HEAD`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return Number.parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Compute branch count.
 */
function branchCount(cwd: string): number {
  try {
    const output = execSync("git branch --list", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return output.split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    return 1;
  }
}

export interface ProjectFingerprint {
  generatedAt: string;
  commitCount30d: number;
  branchCount: number;
  domains: DomainEntry[];
  primaryDomain: string | null;
  reasoningModelSeed: {
    decisionStyle: string;
    domainDepth: Record<string, string>;
    explorationHabits: {
      triesToAlternatives: number;
      revertFrequency: number;
      prototypeBeforeCommit: boolean;
    };
  };
}

/**
 * Infer initial decision style from commit patterns.
 */
function inferDecisionStyle(commits: number, branches: number): string {
  if (branches > 5) return "deliberate";
  if (commits > 100) return "intuitive";
  return "mixed";
}

/**
 * Map domain entries to initial depth levels.
 * High file count → intermediate, low → novice.
 */
function inferDomainDepth(domains: DomainEntry[]): Record<string, string> {
  const depth: Record<string, string> = {};
  for (const { domain, fileCount } of domains) {
    if (domain === "other" || domain === "config" || domain === "docs") continue;
    if (fileCount >= 50) depth[domain] = "intermediate";
    else if (fileCount >= 10) depth[domain] = "novice";
  }
  return depth;
}

/**
 * Execute the fingerprint step: analyze git history and write initial reasoning model.
 * Idempotent — skips if profile already exists with fingerprint data.
 */
export function fingerprint(cwd: string): ProjectFingerprint {
  const profileDir = getProfileDir(cwd);
  const modelPath = join(profileDir, REASONING_MODEL_FILE);

  const domains = computeDomains(cwd, 90);
  const commits = commitCount(cwd, 30);
  const branches = branchCount(cwd);
  const primaryDomain = domains.length > 0 ? domains[0].domain : null;
  const domainDepth = inferDomainDepth(domains);

  const fp: ProjectFingerprint = {
    generatedAt: new Date().toISOString(),
    commitCount30d: commits,
    branchCount: branches,
    domains,
    primaryDomain,
    reasoningModelSeed: {
      decisionStyle: inferDecisionStyle(commits, branches),
      domainDepth,
      explorationHabits: {
        triesToAlternatives: branches > 3 ? branches : 0,
        revertFrequency: 0,
        prototypeBeforeCommit: branches > 5,
      },
    },
  };

  if (!existsSync(modelPath)) {
    writeFileSync(modelPath, `${JSON.stringify(fp, null, 2)}\n`, "utf-8");
    logger.debug("Wrote project fingerprint", { path: modelPath });
  } else {
    logger.debug("Fingerprint already exists, skipping write");
  }

  return fp;
}

// FILE: src/services/daemon/binary.ts
// Daemon binary management: locate, build (dev mode), and start unfaded + unfade-send.
// In dev mode, builds from local Go source in daemon/. In production, copies from
// @unfade/daemon-{platform}-{npm-arch} optional dependency (npm uses x64, not amd64).

import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { logger } from "../../utils/logger.js";
import { getBinDir, getStateDir } from "../../utils/paths.js";

const require = createRequire(import.meta.url);

const DAEMON_BINARY = process.platform === "win32" ? "unfaded.exe" : "unfaded";
const SEND_BINARY = process.platform === "win32" ? "unfade-send.exe" : "unfade-send";

/**
 * Find the daemon source directory by walking up from the CLI package root.
 * Returns null if not in a dev environment with Go source.
 */
function findDaemonSourceDir(): string | null {
  // Walk up from this file's location to find daemon/go.mod
  let current = resolve(dirname(new URL(import.meta.url).pathname));
  const root = resolve("/");

  while (current !== root) {
    const candidate = join(current, "daemon", "go.mod");
    if (existsSync(candidate)) {
      return join(current, "daemon");
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Build daemon binaries from Go source (dev mode).
 * Compiles unfaded and unfade-send into the target bin directory.
 */
function buildFromSource(daemonSrcDir: string, binDir: string): void {
  mkdirSync(binDir, { recursive: true });

  const targets = [
    { cmd: `go build -o ${join(binDir, DAEMON_BINARY)} ./cmd/unfaded`, name: DAEMON_BINARY },
    { cmd: `go build -o ${join(binDir, SEND_BINARY)} ./cmd/unfade-send`, name: SEND_BINARY },
  ];

  for (const { cmd, name } of targets) {
    logger.debug("Building daemon binary", { name, cwd: daemonSrcDir });
    try {
      execSync(cmd, {
        cwd: daemonSrcDir,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60000,
        encoding: "utf-8",
      });
      logger.debug("Built binary", { name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to build ${name}: ${message}`);
    }
  }

  // Ensure executable permissions on Unix.
  if (process.platform !== "win32") {
    chmodSync(join(binDir, DAEMON_BINARY), 0o755);
    chmodSync(join(binDir, SEND_BINARY), 0o755);
  }
}

/**
 * Try to locate pre-built binaries from optional npm dependency.
 * Returns the directory containing the binaries, or null.
 */
function findPrebuiltBinaries(): string | null {
  const platform =
    process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  if (!platform) return null;

  const npmArch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!npmArch) return null;

  const pkgName = `@unfade/daemon-${platform}-${npmArch}`;
  try {
    const resolved = require.resolve(`${pkgName}/package.json`);
    const pkgDir = dirname(resolved);
    const binDir = join(pkgDir, "bin");
    if (existsSync(join(binDir, DAEMON_BINARY))) {
      return binDir;
    }
  } catch {
    // Optional dep not installed — expected in dev
  }

  return null;
}

export interface BinaryPaths {
  daemon: string;
  send: string;
  source: "built" | "prebuilt" | "existing";
}

/**
 * Ensure daemon binaries are available in .unfade/bin/.
 * Strategy: existing → prebuilt npm package → build from Go source.
 * Throws if no strategy succeeds.
 */
export function ensureBinaries(cwd?: string): BinaryPaths {
  const binDir = getBinDir(cwd);
  const daemonPath = join(binDir, DAEMON_BINARY);
  const sendPath = join(binDir, SEND_BINARY);

  // Already present?
  if (existsSync(daemonPath) && existsSync(sendPath)) {
    logger.debug("Binaries already present", { binDir });
    return { daemon: daemonPath, send: sendPath, source: "existing" };
  }

  // Try prebuilt from npm optional dep.
  const prebuiltDir = findPrebuiltBinaries();
  if (prebuiltDir) {
    mkdirSync(binDir, { recursive: true });
    copyFileSync(join(prebuiltDir, DAEMON_BINARY), daemonPath);
    copyFileSync(join(prebuiltDir, SEND_BINARY), sendPath);
    if (process.platform !== "win32") {
      chmodSync(daemonPath, 0o755);
      chmodSync(sendPath, 0o755);
    }
    logger.debug("Copied prebuilt binaries", { from: prebuiltDir });
    return { daemon: daemonPath, send: sendPath, source: "prebuilt" };
  }

  // Build from source (dev mode).
  const daemonSrcDir = findDaemonSourceDir();
  if (daemonSrcDir) {
    buildFromSource(daemonSrcDir, binDir);
    saveSourceHash(cwd, hashGoSource(daemonSrcDir));
    return { daemon: daemonPath, send: sendPath, source: "built" };
  }

  throw new Error(
    "Capture engine binary not available for your platform. Install via npm/npx (not a manual git clone without Go), or install Go and build from the daemon/ source.",
  );
}

/**
 * Start the daemon process. Returns the PID.
 * The daemon writes its own PID file, but we also write it from here as a backup.
 * @param projectDir — Repository root (parent of `.unfade/`); see `getDaemonProjectRoot`.
 */
export function startDaemon(cwd: string, projectDir: string): number {
  const binDir = getBinDir(cwd);
  const daemonPath = join(binDir, DAEMON_BINARY);
  const stateDir = getStateDir(cwd);
  if (!existsSync(daemonPath)) {
    throw new Error("Daemon binary not found. Run init first.");
  }

  mkdirSync(stateDir, { recursive: true });

  const child = spawn(daemonPath, ["--project-dir", projectDir], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });

  child.unref();

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error("Failed to start daemon — no PID returned");
  }

  // Write PID file as backup (daemon also writes its own).
  writeFileSync(join(stateDir, "daemon.pid"), String(pid), "utf-8");
  logger.debug("Started daemon", { pid, projectDir });

  return pid;
}

/**
 * Check if the daemon is running by reading the PID file and sending signal 0.
 */
export function isDaemonRunning(cwd: string): boolean {
  const pidFile = join(getStateDir(cwd), "daemon.pid");
  if (!existsSync(pidFile)) return false;

  try {
    const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (Number.isNaN(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Daemon freshness / update detection ---

const HASH_FILE = "daemon.hash";

/**
 * Compute a SHA256 hash of all Go source files in the daemon directory.
 * This lets us detect source changes without rebuilding.
 */
function hashGoSource(daemonSrcDir: string): string {
  const hash = createHash("sha256");
  const goFiles = collectGoFiles(daemonSrcDir);
  for (const file of goFiles.sort()) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/**
 * Recursively collect all .go, go.mod, and go.sum files in a directory.
 */
function collectGoFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "vendor" && !entry.name.startsWith(".")) {
      results.push(...collectGoFiles(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".go") || entry.name === "go.mod" || entry.name === "go.sum")
    ) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Compute SHA256 of the installed daemon binary.
 */
function hashBinaryFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Save the current source hash to .unfade/state/daemon.hash.
 */
function saveSourceHash(cwd: string | undefined, hash: string): void {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, HASH_FILE), hash, "utf-8");
}

/**
 * Read the stored source hash, or null if not present.
 */
function loadSourceHash(cwd: string): string | null {
  const hashFile = join(getStateDir(cwd), HASH_FILE);
  if (!existsSync(hashFile)) return null;
  try {
    return readFileSync(hashFile, "utf-8").trim();
  } catch {
    return null;
  }
}

/**
 * Check if the daemon binary is outdated compared to source/prebuilt.
 * Returns true if the binary needs to be rebuilt/updated.
 */
export function isDaemonOutdated(cwd: string): boolean {
  const binDir = getBinDir(cwd);
  const daemonPath = join(binDir, DAEMON_BINARY);

  if (!existsSync(daemonPath)) return true;

  // Dev mode: compare Go source hash
  const daemonSrcDir = findDaemonSourceDir();
  if (daemonSrcDir) {
    const currentHash = hashGoSource(daemonSrcDir);
    const storedHash = loadSourceHash(cwd);
    if (!storedHash || storedHash !== currentHash) {
      logger.debug("Daemon source has changed", {
        stored: storedHash?.slice(0, 8),
        current: currentHash.slice(0, 8),
      });
      return true;
    }
    return false;
  }

  // Prebuilt: compare binary hash against installed package
  const prebuiltDir = findPrebuiltBinaries();
  if (prebuiltDir) {
    const installedHash = hashBinaryFile(daemonPath);
    const prebuiltHash = hashBinaryFile(join(prebuiltDir, DAEMON_BINARY));
    return installedHash !== prebuiltHash;
  }

  return false;
}

/**
 * Rebuild/update the daemon binary from source or prebuilt package.
 * Returns the new binary paths, or null if no update source is available.
 */
export function updateDaemonBinary(cwd: string): BinaryPaths | null {
  const binDir = getBinDir(cwd);
  const daemonPath = join(binDir, DAEMON_BINARY);
  const sendPath = join(binDir, SEND_BINARY);

  // Dev mode: rebuild from source
  const daemonSrcDir = findDaemonSourceDir();
  if (daemonSrcDir) {
    logger.debug("Rebuilding daemon from source");
    buildFromSource(daemonSrcDir, binDir);
    const newHash = hashGoSource(daemonSrcDir);
    saveSourceHash(cwd, newHash);
    return { daemon: daemonPath, send: sendPath, source: "built" };
  }

  // Prebuilt: re-copy from npm package
  const prebuiltDir = findPrebuiltBinaries();
  if (prebuiltDir) {
    mkdirSync(binDir, { recursive: true });
    copyFileSync(join(prebuiltDir, DAEMON_BINARY), daemonPath);
    copyFileSync(join(prebuiltDir, SEND_BINARY), sendPath);
    if (process.platform !== "win32") {
      chmodSync(daemonPath, 0o755);
      chmodSync(sendPath, 0o755);
    }
    logger.debug("Updated prebuilt binaries", { from: prebuiltDir });
    return { daemon: daemonPath, send: sendPath, source: "prebuilt" };
  }

  return null;
}

/**
 * Register this project in the global repos list (~/.unfade/state/repos.json).
 */
export function registerRepo(projectDir: string): void {
  const globalStateDir = join(
    process.env.HOME ?? process.env.USERPROFILE ?? "",
    ".unfade",
    "state",
  );
  mkdirSync(globalStateDir, { recursive: true });
  const reposFile = join(globalStateDir, "repos.json");

  let repos: Array<{ path: string; addedAt: string }> = [];
  if (existsSync(reposFile)) {
    try {
      repos = JSON.parse(readFileSync(reposFile, "utf-8"));
    } catch {
      repos = [];
    }
  }

  // Don't duplicate.
  if (repos.some((r) => r.path === projectDir)) return;

  repos.push({ path: projectDir, addedAt: new Date().toISOString() });
  writeFileSync(reposFile, `${JSON.stringify(repos, null, 2)}\n`, "utf-8");
  logger.debug("Registered repo", { projectDir });
}

/**
 * Remove this project's `.unfade/` path from ~/.unfade/state/repos.json.
 */
export function unregisterRepo(projectDataDir: string): void {
  const globalStateDir = join(
    process.env.HOME ?? process.env.USERPROFILE ?? "",
    ".unfade",
    "state",
  );
  const reposFile = join(globalStateDir, "repos.json");
  if (!existsSync(reposFile)) return;

  try {
    const raw = JSON.parse(readFileSync(reposFile, "utf-8"));
    if (!Array.isArray(raw)) return;
    const repos = raw as Array<{ path: string; addedAt: string }>;
    const next = repos.filter((r) => r.path !== projectDataDir);
    if (next.length === repos.length) return;
    writeFileSync(reposFile, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    logger.debug("Unregistered repo", { projectDataDir });
  } catch {
    logger.debug("Failed to update repos.json during unregister");
  }
}

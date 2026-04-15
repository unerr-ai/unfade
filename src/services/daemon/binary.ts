// FILE: src/services/daemon/binary.ts
// Daemon binary management: locate, build (dev mode), and start unfaded + unfade-send.
// In dev mode, builds from local Go source in daemon/. In production, copies from
// @unfade/daemon-{platform}-{arch} optional dependency.

import { execSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { logger } from "../../utils/logger.js";
import { getBinDir, getStateDir } from "../../utils/paths.js";

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

  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
  if (!arch) return null;

  const pkgName = `@unfade/daemon-${platform}-${arch}`;
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
export function ensureBinaries(cwd: string): BinaryPaths {
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
    return { daemon: daemonPath, send: sendPath, source: "built" };
  }

  throw new Error(
    "Could not find daemon binaries. Install @unfade/daemon-* package or ensure Go is available for building from source.",
  );
}

/**
 * Start the daemon process. Returns the PID.
 * The daemon writes its own PID file, but we also write it from here as a backup.
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
    env: { ...process.env, UNFADE_STATE_DIR: stateDir },
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

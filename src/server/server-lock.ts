// FILE: src/server/server-lock.ts
// Single-instance enforcement using proper-lockfile.
//
// Uses OS-level advisory locking on a PID file. The lock is automatically
// released when the process exits — even on SIGKILL, OOM kill, or crash.
// This eliminates stale lock problems that plague PID-file-only or
// port-check approaches.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { logger } from "../utils/logger.js";
import { getStateDir } from "../utils/paths.js";

const PID_FILENAME = "server.pid";

let releaseLock: (() => Promise<void>) | null = null;

/**
 * Acquire an exclusive server lock. If another unfade instance is running,
 * this throws with a clear message. The lock auto-releases on process exit.
 *
 * Must be called BEFORE starting the HTTP server or opening DuckDB.
 */
export async function acquireServerLock(cwd?: string): Promise<void> {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });

  const pidPath = join(stateDir, PID_FILENAME);

  // Ensure the PID file exists (lockfile needs it)
  if (!existsSync(pidPath)) {
    writeFileSync(pidPath, "", "utf-8");
  }

  try {
    releaseLock = await lockfile.lock(pidPath, {
      stale: 10_000, // Consider locks from dead processes stale after 10s
      update: 5_000, // Refresh lock mtime every 5s to prove liveness
      realpath: false,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ELOCKED") {
      // Another instance holds the lock — read its PID for a helpful message
      let existingPid = "unknown";
      try {
        existingPid = readFileSync(pidPath, "utf-8").trim();
      } catch {
        // best effort
      }
      const msg =
        `Another unfade server is already running (PID ${existingPid}). ` +
        `Stop it first with: unfade reset --force`;
      logger.error(msg);
      throw new Error(msg);
    }
    throw err;
  }

  // Write our PID so other tools can identify us
  writeFileSync(pidPath, String(process.pid), "utf-8");
  logger.debug("Server lock acquired", { pid: process.pid, pidFile: pidPath });
}

/**
 * Release the server lock. Called during graceful shutdown.
 * Safe to call multiple times or if lock was never acquired.
 */
export async function releaseServerLock(): Promise<void> {
  if (releaseLock) {
    try {
      await releaseLock();
      releaseLock = null;
      logger.debug("Server lock released");
    } catch {
      // Lock may already be released (process exiting)
    }
  }
}

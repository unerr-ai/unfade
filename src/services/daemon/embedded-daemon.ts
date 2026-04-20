// FILE: src/services/daemon/embedded-daemon.ts
// UF-305 + UF-306: Managed Go daemon child process with crash recovery.
// Non-detached — lifecycle tied to parent Node process.
// Crash recovery: exponential backoff (1s → 2s → 4s → ... → 30s max).
// Stderr piped to Node logger with [capture:<label>] prefix.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getBinDir } from "../../utils/paths.js";

const DAEMON_BINARY = process.platform === "win32" ? "unfaded.exe" : "unfaded";
const MAX_BACKOFF_MS = 30_000;
const STABLE_THRESHOLD_MS = 60_000;

export class EmbeddedDaemon {
  private child: ChildProcess | null = null;
  private repoRoot: string;
  private label: string;
  private restartCount = 0;
  private shuttingDown = false;
  private startedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.label = basename(repoRoot);
  }

  /**
   * Spawn the Go daemon as a managed child process.
   * Returns the PID, or null if the binary doesn't exist.
   */
  start(): number | null {
    if (this.child) return this.child.pid ?? null;

    const daemonPath = join(getBinDir(this.repoRoot), DAEMON_BINARY);
    if (!existsSync(daemonPath)) {
      logger.debug(`[capture:${this.label}] binary not found at ${daemonPath}`);
      return null;
    }

    this.shuttingDown = false;
    return this.spawn(daemonPath);
  }

  /**
   * Gracefully stop the daemon. Sends SIGTERM, waits, then SIGKILL.
   */
  async stop(): Promise<void> {
    this.shuttingDown = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const pid = this.child?.pid;
    if (!pid) return;

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }

    await this.waitForExit(5000);

    if (this.isRunning()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already dead
      }
    }

    this.child = null;
  }

  isRunning(): boolean {
    if (!this.child?.pid) return false;
    try {
      process.kill(this.child.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getPid(): number | null {
    return this.child?.pid ?? null;
  }

  getRepoRoot(): string {
    return this.repoRoot;
  }

  getLabel(): string {
    return this.label;
  }

  getRestartCount(): number {
    return this.restartCount;
  }

  getUptimeMs(): number {
    if (this.startedAt === 0) return 0;
    return Date.now() - this.startedAt;
  }

  private spawn(daemonPath: string): number | null {
    const child = spawn(daemonPath, ["--project-dir", this.repoRoot], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    this.child = child;
    this.startedAt = Date.now();

    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split("\n")) {
        if (line) logger.debug(`[capture:${this.label}] ${line}`);
      }
    });

    child.on("exit", (code, signal) => {
      if (this.shuttingDown) return;

      this.restartCount++;
      const backoffMs = Math.min(1000 * 2 ** (this.restartCount - 1), MAX_BACKOFF_MS);

      logger.warn(
        `[capture:${this.label}] exited (code=${code}, signal=${signal}), restart in ${backoffMs}ms (attempt ${this.restartCount})`,
      );

      this.restartTimer = setTimeout(() => {
        if (this.shuttingDown) return;
        this.spawn(daemonPath);
      }, backoffMs);
    });

    child.on("spawn", () => {
      setTimeout(() => {
        if (this.child === child && !this.shuttingDown) {
          this.restartCount = 0;
        }
      }, STABLE_THRESHOLD_MS);
    });

    logger.debug(`[capture:${this.label}] started pid ${child.pid}`);
    return child.pid ?? null;
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.child?.pid) {
        resolve();
        return;
      }

      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (!this.isRunning() || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }
}

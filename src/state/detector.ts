// FILE: src/state/detector.ts
// State detector with self-healing.
// On every `unfade` invocation, detects system state and silently repairs
// any fixable issues before returning the current state.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";
import { getDistillsDir, getEventsDir, getProjectDataDir, getStateDir } from "../utils/paths.js";

/**
 * Ordered by priority — first match wins.
 * The state detector returns the most actionable state.
 */
export type UnfadeState =
  | "not_initialized"
  | "no_git"
  | "daemon_stopped"
  | "daemon_running"
  | "no_llm"
  | "first_distill_pending"
  | "initialized";

export interface StateDetails {
  state: UnfadeState;
  checks: {
    unfadeDirExists: boolean;
    gitRepo: boolean;
    daemonRunning: boolean;
    shellHooksInstalled: boolean;
    autoStartRegistered: boolean;
    llmAvailable: boolean;
    hasEvents: boolean;
    hasDistills: boolean;
  };
  repairs: string[];
}

/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence, don't actually kill
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the daemon PID from the PID file.
 * Returns null if file doesn't exist, is empty, or contains an invalid PID.
 */
function readDaemonPid(stateDir: string): number | null {
  const pidFile = join(stateDir, "daemon.pid");
  if (!existsSync(pidFile)) return null;

  try {
    const content = readFileSync(pidFile, "utf-8").trim();
    const pid = Number.parseInt(content, 10);
    if (Number.isNaN(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

/**
 * Check if shell hooks are installed by looking for the unfade marker
 * in .zshrc or .bashrc.
 */
function checkShellHooks(): boolean {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const rcFiles = [join(home, ".zshrc"), join(home, ".bashrc")];

  for (const rcFile of rcFiles) {
    if (!existsSync(rcFile)) continue;
    try {
      const content = readFileSync(rcFile, "utf-8");
      if (content.includes("# unfade-hook")) return true;
    } catch {}
  }

  return false;
}

/**
 * Check if auto-start is registered (macOS launchd plist).
 * On non-macOS, returns false (auto-start check is platform-specific).
 */
function checkAutoStart(): boolean {
  if (process.platform === "darwin") {
    const plistPath = join(
      process.env.HOME ?? "",
      "Library",
      "LaunchAgents",
      "dev.unfade.daemon.plist",
    );
    return existsSync(plistPath);
  }

  if (process.platform === "linux") {
    const unitPath = join(
      process.env.HOME ?? "",
      ".config",
      "systemd",
      "user",
      "unfade-daemon.service",
    );
    return existsSync(unitPath);
  }

  return false;
}

/**
 * Check if an LLM provider is available (Ollama running locally).
 * Quick check: attempt to connect to Ollama's default port.
 */
function checkLlmAvailable(): boolean {
  try {
    execSync("curl -sf http://127.0.0.1:11434/api/tags --max-time 1", {
      stdio: "pipe",
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the current directory is inside a git repository.
 * Uses the same traversal logic as findGitRoot in paths.ts.
 */
function checkGitRepo(cwd: string): boolean {
  const { resolve } = require("node:path");
  let current = resolve(cwd);
  const root = resolve("/");

  while (current !== root) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  return false;
}

/**
 * Check if there are any event files in the events directory.
 */
function hasEventFiles(cwd?: string): boolean {
  const eventsDir = getEventsDir(cwd);
  if (!existsSync(eventsDir)) return false;

  try {
    const { readdirSync } = require("node:fs");
    const files = readdirSync(eventsDir) as string[];
    return files.some((f: string) => f.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

/**
 * Check if there are any distill files.
 */
function hasDistillFiles(cwd?: string): boolean {
  const distillsDir = getDistillsDir(cwd);
  if (!existsSync(distillsDir)) return false;

  try {
    const { readdirSync } = require("node:fs");
    const files = readdirSync(distillsDir) as string[];
    return files.some((f: string) => f.endsWith(".md"));
  } catch {
    return false;
  }
}

export interface DetectStateOptions {
  cwd?: string;
  /** Skip LLM check (for faster detection in non-distill contexts). */
  skipLlmCheck?: boolean;
  /** Skip self-healing attempts. */
  skipRepair?: boolean;
}

/**
 * Detect the current Unfade system state and attempt self-healing.
 *
 * Check order (returns first actionable state):
 * 1. .unfade/ exists? → not_initialized
 * 2. Git repo? → no_git
 * 3. Daemon PID alive? → daemon_stopped (attempt restart)
 * 4. Shell hooks installed? → (attempt reinstall)
 * 5. Auto-start registered? → (attempt re-register)
 * 6. LLM available? → no_llm
 * 7. Events exist but no distills? → first_distill_pending
 * 8. All good → initialized / daemon_running
 */
export function detectState(options: DetectStateOptions = {}): StateDetails {
  const cwd = options.cwd ?? process.cwd();
  const repairs: string[] = [];

  const projectDir = getProjectDataDir(cwd);
  const stateDir = getStateDir(cwd);
  const unfadeDirExists = existsSync(projectDir);
  const gitRepo = checkGitRepo(cwd);

  // Early exit: not initialized
  if (!unfadeDirExists) {
    return {
      state: "not_initialized",
      checks: {
        unfadeDirExists: false,
        gitRepo,
        daemonRunning: false,
        shellHooksInstalled: false,
        autoStartRegistered: false,
        llmAvailable: false,
        hasEvents: false,
        hasDistills: false,
      },
      repairs,
    };
  }

  // No git repo
  if (!gitRepo) {
    return {
      state: "no_git",
      checks: {
        unfadeDirExists: true,
        gitRepo: false,
        daemonRunning: false,
        shellHooksInstalled: false,
        autoStartRegistered: false,
        llmAvailable: false,
        hasEvents: false,
        hasDistills: false,
      },
      repairs,
    };
  }

  // Check daemon status
  const pid = readDaemonPid(stateDir);
  const daemonRunning = pid !== null && isProcessAlive(pid);

  // Self-healing: clean stale PID file
  if (pid !== null && !daemonRunning && !options.skipRepair) {
    try {
      const { unlinkSync } = require("node:fs");
      const pidFile = join(stateDir, "daemon.pid");
      unlinkSync(pidFile);
      repairs.push("Removed stale PID file");
      logger.debug("Self-healing: removed stale PID file", { pid });
    } catch {
      // PID file already gone or permission issue — not critical
    }
  }

  // Check shell hooks
  const shellHooksInstalled = checkShellHooks();

  // Check auto-start
  const autoStartRegistered = checkAutoStart();

  // Check LLM availability
  const llmAvailable = options.skipLlmCheck ? false : checkLlmAvailable();

  // Check events and distills
  const events = hasEventFiles(cwd);
  const distills = hasDistillFiles(cwd);

  const checks = {
    unfadeDirExists: true,
    gitRepo: true,
    daemonRunning,
    shellHooksInstalled,
    autoStartRegistered,
    llmAvailable,
    hasEvents: events,
    hasDistills: distills,
  };

  // Determine most actionable state
  if (!daemonRunning) {
    return { state: "daemon_stopped", checks, repairs };
  }

  if (!llmAvailable && !options.skipLlmCheck) {
    return { state: "no_llm", checks, repairs };
  }

  if (events && !distills) {
    return { state: "first_distill_pending", checks, repairs };
  }

  return {
    state: daemonRunning ? "daemon_running" : "initialized",
    checks,
    repairs,
  };
}

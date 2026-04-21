// FILE: src/services/init/lightweight-init.ts
// UF-310: Lightweight init check that runs inline when `unfade` starts.
// Idempotent, fast (< 200ms), no interactive prompts.
// Steps: scaffold → binary → shell hooks → config existence check.
// Returns { firstRun: true } if this was the first initialization.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import {
  getBinDir,
  getDaemonProjectRoot,
  getProjectDataDir,
  getStateDir,
} from "../../utils/paths.js";
import { registerRepo } from "../registry/registry.js";

export interface EnsureInitResult {
  firstRun: boolean;
  repoRoot: string;
  dataDir: string;
}

/**
 * Ensure the current repo is initialized and registered.
 * Non-interactive — scaffold + binary + hooks only. No LLM wizard.
 * LLM config is deferred to the web dashboard setup page.
 * Idempotent — safe to call every startup.
 */
export function ensureInit(cwd: string): EnsureInitResult {
  const dataDir = getProjectDataDir(cwd);
  const repoRoot = getDaemonProjectRoot(cwd);
  const firstRun = !existsSync(dataDir);

  if (firstRun) {
    scaffoldMinimal(dataDir);
    ensureBinaryQuiet(cwd);
    installHooksQuiet(cwd);
    writeInitialSetupStatus(cwd);
  }

  registerRepo(repoRoot);

  return { firstRun, repoRoot, dataDir };
}

function scaffoldMinimal(dataDir: string): void {
  const dirs = [
    "state",
    "events",
    "logs",
    "distills",
    "profile",
    "graph",
    "metrics",
    "cache",
    "cards",
    "bin",
    "amplification",
  ];
  for (const dir of dirs) {
    mkdirSync(join(dataDir, dir), { recursive: true });
  }
  logger.debug("Scaffolded .unfade/", { path: dataDir });
}

function ensureBinaryQuiet(cwd: string): void {
  try {
    const { ensureBinaries } =
      require("../daemon/binary.js") as typeof import("../daemon/binary.js");
    ensureBinaries(cwd);
  } catch (err) {
    logger.debug("Binary ensure failed (non-fatal, will retry)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function installHooksQuiet(cwd: string): void {
  try {
    const { installShellHooks } =
      require("../shell/installer.js") as typeof import("../shell/installer.js");
    const sendBin = join(
      getBinDir(cwd),
      process.platform === "win32" ? "unfade-send.exe" : "unfade-send",
    );
    installShellHooks(sendBin);
  } catch {
    logger.debug("Shell hook install failed (non-fatal)");
  }
}

/**
 * Write initial setup-status.json for the web UI to detect onboarding state.
 * This file is the single source of truth for "has this repo been configured?"
 */
function writeInitialSetupStatus(cwd: string): void {
  try {
    const stateDir = getStateDir(cwd);
    mkdirSync(stateDir, { recursive: true });
    const statusPath = join(stateDir, "setup-status.json");
    const status = {
      initializedAt: new Date().toISOString(),
      configuredAt: null,
      llmProvider: null,
      llmValidated: false,
      ingestTriggered: false,
    };
    const tmpPath = join(stateDir, `setup-status.json.tmp.${process.pid}`);
    writeFileSync(tmpPath, JSON.stringify(status, null, 2), "utf-8");
    renameSync(tmpPath, statusPath);
    logger.debug("Wrote initial setup-status.json");
  } catch (err) {
    logger.debug("Failed to write setup-status.json (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

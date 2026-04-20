// FILE: src/services/init/launchd.ts
// UF-224: Multi-autostart launchd — parameterized labels per repo root.
// Each repo gets its own plist: io.unfade.daemon.<sha256(root)[0:12]>.plist
// init in repo B does NOT overwrite repo A's plist.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../../../utils/logger.js";

const LABEL_PREFIX = "io.unfade.daemon";

export interface LaunchdResult {
  installed: boolean;
  updated: boolean;
  path: string;
  running: boolean;
}

function repoHash(projectDir: string): string {
  return createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
}

function labelForProject(projectDir: string): string {
  return `${LABEL_PREFIX}.${repoHash(projectDir)}`;
}

function plistPathForProject(projectDir: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${labelForProject(projectDir)}.plist`);
}

/** Path to the LaunchAgents plist for a specific project (for reset / diagnostics). */
export function getLaunchdPlistPath(projectDir?: string): string {
  if (projectDir) return plistPathForProject(projectDir);
  return join(homedir(), "Library", "LaunchAgents", `${LABEL_PREFIX}.plist`);
}

function generatePlist(
  label: string,
  daemonBin: string,
  projectDir: string,
  logsDir: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${daemonBin}</string>
    <string>--project-dir</string>
    <string>${projectDir}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(logsDir, "daemon.stdout.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(logsDir, "daemon.stderr.log")}</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityBackgroundIO</key>
  <true/>
</dict>
</plist>
`;
}

/**
 * Install the Unfade daemon as a macOS launchd agent for a specific project.
 * Creates a new plist per repo — does not overwrite other repos' plists.
 */
export function installLaunchd(
  daemonBin: string,
  projectDir: string,
  logsDir: string,
): LaunchdResult {
  const label = labelForProject(projectDir);
  const path = plistPathForProject(projectDir);
  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const newPlist = generatePlist(label, daemonBin, projectDir, logsDir);
  let updated = false;

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    if (existing === newPlist) {
      const running = isLaunchdRunning(label);
      if (!running) {
        launchctlLoad(path);
      }
      return { installed: true, updated: false, path, running: isLaunchdRunning(label) };
    }
    launchctlUnload(path);
    updated = true;
  }

  writeFileSync(path, newPlist, "utf-8");
  launchctlLoad(path);

  return { installed: true, updated, path, running: isLaunchdRunning(label) };
}

/**
 * Unload the launchd agent for a specific project.
 */
export function unloadLaunchd(projectDir?: string): boolean {
  if (projectDir) {
    const path = plistPathForProject(projectDir);
    if (!existsSync(path)) return false;
    return launchctlUnload(path);
  }

  const legacyPath = join(homedir(), "Library", "LaunchAgents", `${LABEL_PREFIX}.plist`);
  if (existsSync(legacyPath)) {
    return launchctlUnload(legacyPath);
  }
  return false;
}

/**
 * Remove all Unfade launchd plists (used for global reset).
 */
export function removeAllUnfadePlists(): number {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) return 0;

  let removed = 0;
  const files = readdirSync(dir).filter((f) => f.startsWith(LABEL_PREFIX) && f.endsWith(".plist"));

  for (const file of files) {
    const path = join(dir, file);
    launchctlUnload(path);
    rmSync(path, { force: true });
    removed++;
  }

  logger.debug("Removed all Unfade launchd plists", { count: removed });
  return removed;
}

function launchctlLoad(path: string): void {
  try {
    execSync(`launchctl load -w "${path}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
  } catch (err) {
    logger.debug("launchctl load failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function launchctlUnload(path: string): boolean {
  try {
    execSync(`launchctl unload "${path}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function isLaunchdRunning(label: string): boolean {
  try {
    const output = execSync(`launchctl list "${label}" 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 3000,
    });
    return !output.includes("Could not find");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Coordinator mode (UF-251)
// ---------------------------------------------------------------------------

const COORDINATOR_LABEL = "io.unfade.coordinator";

function coordinatorPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${COORDINATOR_LABEL}.plist`);
}

function generateCoordinatorPlist(daemonBin: string, logsDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${COORDINATOR_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${daemonBin}</string>
    <string>--coordinator</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(logsDir, "coordinator.stdout.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(logsDir, "coordinator.stderr.log")}</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityBackgroundIO</key>
  <true/>
</dict>
</plist>
`;
}

/**
 * Install coordinator mode: single plist with --coordinator flag.
 * Migrates from per-repo plists: unloads all existing per-repo plists first.
 */
export function installCoordinatorLaunchd(daemonBin: string, logsDir: string): LaunchdResult {
  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  removeAllUnfadePlists();

  const path = coordinatorPlistPath();
  const newPlist = generateCoordinatorPlist(daemonBin, logsDir);
  let updated = false;

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    if (existing === newPlist) {
      if (!isLaunchdRunning(COORDINATOR_LABEL)) launchctlLoad(path);
      return {
        installed: true,
        updated: false,
        path,
        running: isLaunchdRunning(COORDINATOR_LABEL),
      };
    }
    launchctlUnload(path);
    updated = true;
  }

  writeFileSync(path, newPlist, "utf-8");
  launchctlLoad(path);

  logger.debug("Installed coordinator launchd plist", { path });
  return { installed: true, updated, path, running: isLaunchdRunning(COORDINATOR_LABEL) };
}

/**
 * Unload coordinator plist.
 */
export function unloadCoordinatorLaunchd(): boolean {
  const path = coordinatorPlistPath();
  if (!existsSync(path)) return false;
  const result = launchctlUnload(path);
  rmSync(path, { force: true });
  return result;
}

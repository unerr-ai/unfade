// FILE: src/services/init/systemd.ts
// UF-224: Multi-autostart systemd — parameterized unit names per repo root.
// Each repo gets its own unit: unfade-daemon-<sha256(root)[0:12]>.service
// init in repo B does NOT overwrite repo A's unit.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../../../utils/logger.js";

const UNIT_PREFIX = "unfade-daemon";

export interface SystemdResult {
  installed: boolean;
  updated: boolean;
  path: string;
  running: boolean;
}

function repoHash(projectDir: string): string {
  return createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
}

function unitNameForProject(projectDir: string): string {
  return `${UNIT_PREFIX}-${repoHash(projectDir)}.service`;
}

function unitPathForProject(projectDir: string): string {
  return join(homedir(), ".config", "systemd", "user", unitNameForProject(projectDir));
}

/** Path to the systemd unit for a specific project. */
export function getSystemdUnitPath(projectDir?: string): string {
  if (projectDir) return unitPathForProject(projectDir);
  return join(homedir(), ".config", "systemd", "user", `${UNIT_PREFIX}.service`);
}

function generateUnit(daemonBin: string, projectDir: string): string {
  return `[Unit]
Description=Unfade Capture Engine (${projectDir})
After=default.target

[Service]
Type=simple
ExecStart=${daemonBin} --project-dir ${projectDir}
Restart=on-failure
RestartSec=5
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;
}

/**
 * Install the Unfade daemon as a systemd user service for a specific project.
 * Creates a new unit per repo — does not overwrite other repos' units.
 */
export function installSystemd(daemonBin: string, projectDir: string): SystemdResult {
  const unitName = unitNameForProject(projectDir);
  const path = unitPathForProject(projectDir);
  const unitDir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });

  const newUnit = generateUnit(daemonBin, projectDir);
  let updated = false;

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    if (existing === newUnit) {
      ensureEnabled(unitName);
      return { installed: true, updated: false, path, running: isSystemdRunning(unitName) };
    }
    updated = true;
  }

  writeFileSync(path, newUnit, "utf-8");
  daemonReload();
  enableAndStart(unitName);
  enableLinger();

  return { installed: true, updated, path, running: isSystemdRunning(unitName) };
}

/**
 * Disable and stop the systemd service for a specific project.
 */
export function disableSystemd(projectDir?: string): boolean {
  if (projectDir) {
    const unitName = unitNameForProject(projectDir);
    return disableUnit(unitName);
  }

  const legacyUnit = `${UNIT_PREFIX}.service`;
  return disableUnit(legacyUnit);
}

/**
 * Remove all Unfade systemd units (used for global reset).
 */
export function removeAllUnfadeUnits(): number {
  const dir = join(homedir(), ".config", "systemd", "user");
  if (!existsSync(dir)) return 0;

  let removed = 0;
  const files = readdirSync(dir).filter((f) => f.startsWith(UNIT_PREFIX) && f.endsWith(".service"));

  for (const file of files) {
    const path = join(dir, file);
    disableUnit(file);
    rmSync(path, { force: true });
    removed++;
  }

  if (removed > 0) daemonReload();
  logger.debug("Removed all Unfade systemd units", { count: removed });
  return removed;
}

function disableUnit(unitName: string): boolean {
  try {
    execSync(`systemctl --user disable --now ${unitName}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

function daemonReload(): void {
  try {
    execSync("systemctl --user daemon-reload", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
  } catch (err) {
    logger.debug("systemctl daemon-reload failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function enableAndStart(unitName: string): void {
  try {
    execSync(`systemctl --user enable --now ${unitName}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
  } catch (err) {
    logger.debug("systemctl enable --now failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function ensureEnabled(unitName: string): void {
  try {
    execSync(`systemctl --user enable ${unitName}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    if (!isSystemdRunning(unitName)) {
      execSync(`systemctl --user start ${unitName}`, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      });
    }
  } catch {
    logger.debug("systemctl ensure-enabled failed");
  }
}

function enableLinger(): void {
  try {
    execSync("loginctl enable-linger", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
  } catch {
    logger.debug("loginctl enable-linger failed — service may not auto-start after reboot");
  }
}

function isSystemdRunning(unitName: string): boolean {
  try {
    const output = execSync(`systemctl --user is-active ${unitName} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 3000,
    });
    return output.trim() === "active";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Coordinator mode (UF-251)
// ---------------------------------------------------------------------------

const COORDINATOR_UNIT = "unfade-coordinator.service";

function coordinatorUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", COORDINATOR_UNIT);
}

function generateCoordinatorUnit(daemonBin: string): string {
  return `[Unit]
Description=Unfade Coordinator (multi-repo)
After=default.target

[Service]
Type=simple
ExecStart=${daemonBin} --coordinator
Restart=on-failure
RestartSec=5
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;
}

/**
 * Install coordinator mode: single systemd unit with --coordinator flag.
 * Migrates from per-repo units: removes all existing per-repo units first.
 */
export function installCoordinatorSystemd(daemonBin: string): SystemdResult {
  const unitDir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });

  removeAllUnfadeUnits();

  const path = coordinatorUnitPath();
  const newUnit = generateCoordinatorUnit(daemonBin);
  let updated = false;

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    if (existing === newUnit) {
      ensureEnabled(COORDINATOR_UNIT);
      return { installed: true, updated: false, path, running: isSystemdRunning(COORDINATOR_UNIT) };
    }
    updated = true;
  }

  writeFileSync(path, newUnit, "utf-8");
  daemonReload();
  enableAndStart(COORDINATOR_UNIT);
  enableLinger();

  logger.debug("Installed coordinator systemd unit", { path });
  return { installed: true, updated, path, running: isSystemdRunning(COORDINATOR_UNIT) };
}

/**
 * Disable coordinator systemd unit.
 */
export function disableCoordinatorSystemd(): boolean {
  const path = coordinatorUnitPath();
  if (!existsSync(path)) return false;
  disableUnit(COORDINATOR_UNIT);
  rmSync(path, { force: true });
  daemonReload();
  return true;
}

// FILE: src/services/init/autostart.ts
// UF-224: Multi-autostart orchestrator.
// Routes to parameterized launchd/systemd per repo root.

import { existsSync, rmSync } from "node:fs";
import { logger } from "../../../utils/logger.js";
import { getDaemonProjectRoot, getLogsDir } from "../../../utils/paths.js";
import {
  getLaunchdPlistPath,
  installCoordinatorLaunchd,
  installLaunchd,
  removeAllUnfadePlists,
  unloadCoordinatorLaunchd,
  unloadLaunchd,
} from "./launchd.js";
import {
  disableCoordinatorSystemd,
  disableSystemd,
  getSystemdUnitPath,
  installCoordinatorSystemd,
  installSystemd,
  removeAllUnfadeUnits,
} from "./systemd.js";

export interface AutostartResult {
  platform: string;
  path: string;
  installed: boolean;
  alreadyPresent: boolean;
}

/**
 * Install platform auto-start for the daemon.
 * macOS → launchd plist, Linux → systemd user unit.
 * Each repo gets its own service entry — multi-project safe.
 */
export function installAutostart(
  daemonBin: string,
  projectDir: string,
  _stateDir: string,
): AutostartResult {
  if (process.platform === "darwin") {
    const logsDir = getLogsDir();
    const result = installLaunchd(daemonBin, projectDir, logsDir);
    return {
      platform: "darwin",
      path: result.path,
      installed: result.installed,
      alreadyPresent: !result.updated && result.installed,
    };
  }

  if (process.platform === "linux") {
    const result = installSystemd(daemonBin, projectDir);
    return {
      platform: "linux",
      path: result.path,
      installed: result.installed,
      alreadyPresent: !result.updated && result.installed,
    };
  }

  logger.debug("Auto-start not supported on this platform", { platform: process.platform });
  return {
    platform: process.platform,
    path: "",
    installed: false,
    alreadyPresent: false,
  };
}

/**
 * Stop the daemon autostart for a specific project root.
 */
export function stopAutostart(projectDir?: string): boolean {
  if (process.platform === "darwin") {
    return unloadLaunchd(projectDir);
  }
  if (process.platform === "linux") {
    return disableSystemd(projectDir);
  }
  return false;
}

/**
 * If autostart is configured for this repo, unload and delete the unit.
 */
export function removeAutostartIfOwnedByProject(cwd: string): boolean {
  const projectRoot = getDaemonProjectRoot(cwd);

  if (process.platform === "darwin") {
    const p = getLaunchdPlistPath(projectRoot);
    if (!existsSync(p)) return false;
    unloadLaunchd(projectRoot);
    rmSync(p, { force: true });
    logger.debug("Removed launchd plist for project reset", { path: p });
    return true;
  }

  if (process.platform === "linux") {
    const p = getSystemdUnitPath(projectRoot);
    if (!existsSync(p)) return false;
    disableSystemd(projectRoot);
    rmSync(p, { force: true });
    logger.debug("Removed systemd unit for project reset", { path: p });
    return true;
  }

  return false;
}

/**
 * Remove all Unfade autostart entries (used for global reset).
 */
export function removeAutostartEntirely(): boolean {
  if (process.platform === "darwin") {
    unloadCoordinatorLaunchd();
    return removeAllUnfadePlists() > 0;
  }
  if (process.platform === "linux") {
    disableCoordinatorSystemd();
    return removeAllUnfadeUnits() > 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Coordinator autostart (UF-251)
// ---------------------------------------------------------------------------

/**
 * Install coordinator mode autostart. Migrates from per-repo entries:
 * removes all per-repo plists/units, installs single coordinator entry.
 */
export function installCoordinatorAutostart(daemonBin: string): AutostartResult {
  if (process.platform === "darwin") {
    const home = require("node:os").homedir();
    const logsDir = require("node:path").join(home, ".unfade", "logs");
    const result = installCoordinatorLaunchd(daemonBin, logsDir);
    return {
      platform: "darwin",
      path: result.path,
      installed: result.installed,
      alreadyPresent: !result.updated && result.installed,
    };
  }

  if (process.platform === "linux") {
    const result = installCoordinatorSystemd(daemonBin);
    return {
      platform: "linux",
      path: result.path,
      installed: result.installed,
      alreadyPresent: !result.updated && result.installed,
    };
  }

  logger.debug("Coordinator auto-start not supported", { platform: process.platform });
  return { platform: process.platform, path: "", installed: false, alreadyPresent: false };
}

/**
 * Stop the coordinator autostart.
 */
export function stopCoordinatorAutostart(): boolean {
  if (process.platform === "darwin") return unloadCoordinatorLaunchd();
  if (process.platform === "linux") return disableCoordinatorSystemd();
  return false;
}

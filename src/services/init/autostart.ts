// FILE: src/services/init/autostart.ts
// Step 5 of init: install platform auto-start for the daemon.
// macOS: launchd plist, Linux: systemd user unit.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";

const PLIST_LABEL = "dev.unfade.daemon";
const SYSTEMD_UNIT = "unfade-daemon.service";

/**
 * Generate launchd plist XML for macOS.
 */
function launchdPlist(daemonBin: string, projectDir: string, stateDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
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
  <key>StandardErrorPath</key>
  <string>${join(stateDir, "daemon.stderr.log")}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>UNFADE_STATE_DIR</key>
    <string>${stateDir}</string>
  </dict>
</dict>
</plist>
`;
}

/**
 * Generate systemd user unit for Linux.
 */
function systemdUnit(daemonBin: string, projectDir: string, stateDir: string): string {
  return `[Unit]
Description=Unfade Capture Engine
After=default.target

[Service]
Type=simple
ExecStart=${daemonBin} --project-dir ${projectDir}
Restart=on-failure
RestartSec=5
Environment=UNFADE_STATE_DIR=${stateDir}

[Install]
WantedBy=default.target
`;
}

export interface AutostartResult {
  platform: string;
  path: string;
  installed: boolean;
  alreadyPresent: boolean;
}

/**
 * Install platform auto-start for the daemon.
 * Idempotent — skips if already installed.
 */
export function installAutostart(
  daemonBin: string,
  projectDir: string,
  stateDir: string,
): AutostartResult {
  if (process.platform === "darwin") {
    return installLaunchd(daemonBin, projectDir, stateDir);
  }

  if (process.platform === "linux") {
    return installSystemd(daemonBin, projectDir, stateDir);
  }

  logger.debug("Auto-start not supported on this platform", { platform: process.platform });
  return {
    platform: process.platform,
    path: "",
    installed: false,
    alreadyPresent: false,
  };
}

function installLaunchd(daemonBin: string, projectDir: string, stateDir: string): AutostartResult {
  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(launchAgentsDir, `${PLIST_LABEL}.plist`);

  if (existsSync(plistPath)) {
    logger.debug("Launchd plist already exists", { path: plistPath });
    return { platform: "darwin", path: plistPath, installed: false, alreadyPresent: true };
  }

  mkdirSync(launchAgentsDir, { recursive: true });
  writeFileSync(plistPath, launchdPlist(daemonBin, projectDir, stateDir), "utf-8");

  // Load the plist (don't fail init if this errors).
  try {
    execSync(`launchctl load -w ${plistPath}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
  } catch {
    logger.debug("launchctl load failed — daemon will start manually");
  }

  logger.debug("Installed launchd plist", { path: plistPath });
  return { platform: "darwin", path: plistPath, installed: true, alreadyPresent: false };
}

function installSystemd(daemonBin: string, projectDir: string, stateDir: string): AutostartResult {
  const unitDir = join(homedir(), ".config", "systemd", "user");
  const unitPath = join(unitDir, SYSTEMD_UNIT);

  if (existsSync(unitPath)) {
    logger.debug("Systemd unit already exists", { path: unitPath });
    return { platform: "linux", path: unitPath, installed: false, alreadyPresent: true };
  }

  mkdirSync(unitDir, { recursive: true });
  writeFileSync(unitPath, systemdUnit(daemonBin, projectDir, stateDir), "utf-8");

  // Enable and start (don't fail init if this errors).
  try {
    execSync(`systemctl --user daemon-reload && systemctl --user enable ${SYSTEMD_UNIT}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
  } catch {
    logger.debug("systemctl enable failed — daemon will start manually");
  }

  logger.debug("Installed systemd user unit", { path: unitPath });
  return { platform: "linux", path: unitPath, installed: true, alreadyPresent: false };
}

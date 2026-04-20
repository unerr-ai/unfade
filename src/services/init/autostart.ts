// FILE: src/services/init/autostart.ts
// Phase 5.7: Enterprise gate — autostart is an enterprise feature.
// Open source: all functions return no-ops.
// Enterprise (UNFADE_ENTERPRISE=true): delegates to enterprise/ implementations.

import { logger } from "../../utils/logger.js";

const isEnterprise = process.env.UNFADE_ENTERPRISE === "true";

export interface AutostartResult {
  platform: string;
  path: string;
  installed: boolean;
  alreadyPresent: boolean;
}

export function installAutostart(
  _daemonBin: string,
  _projectDir: string,
  _stateDir: string,
): AutostartResult {
  if (!isEnterprise) {
    logger.debug("Autostart is an enterprise feature — skipping");
    return { platform: process.platform, path: "", installed: false, alreadyPresent: false };
  }

  const enterprise =
    require("./enterprise/autostart.js") as typeof import("./enterprise/autostart.js");
  return enterprise.installAutostart(_daemonBin, _projectDir, _stateDir);
}

export function stopAutostart(projectDir?: string): boolean {
  if (!isEnterprise) return false;
  const enterprise =
    require("./enterprise/autostart.js") as typeof import("./enterprise/autostart.js");
  return enterprise.stopAutostart(projectDir);
}

export function removeAutostartIfOwnedByProject(cwd: string): boolean {
  if (!isEnterprise) return false;
  const enterprise =
    require("./enterprise/autostart.js") as typeof import("./enterprise/autostart.js");
  return enterprise.removeAutostartIfOwnedByProject(cwd);
}

export function removeAutostartEntirely(): boolean {
  if (!isEnterprise) return false;
  const enterprise =
    require("./enterprise/autostart.js") as typeof import("./enterprise/autostart.js");
  return enterprise.removeAutostartEntirely();
}

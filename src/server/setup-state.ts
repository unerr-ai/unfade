// FILE: src/server/setup-state.ts
// Cached check for onboarding setup completion state.
// Used by middleware (http.ts) and route handlers (settings.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getStateDir } from "../utils/paths.js";

let _setupComplete: boolean | null = null;

/**
 * Check whether onboarding setup is complete.
 * Reads setup-status.json once and caches the result until invalidated.
 */
export function isSetupComplete(): boolean {
  if (_setupComplete !== null) return _setupComplete;
  try {
    const stateDir = getStateDir();
    const statusPath = join(stateDir, "setup-status.json");
    const status = JSON.parse(readFileSync(statusPath, "utf-8"));
    _setupComplete = status.setupCompleted === true;
  } catch {
    _setupComplete = false;
  }
  return _setupComplete;
}

/**
 * Invalidate the cached setup state. Call after writing setup-status.json.
 */
export function invalidateSetupCache(): void {
  _setupComplete = null;
}

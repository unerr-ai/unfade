// FILE: src/server/setup-state.ts
// Cached check for onboarding setup completion state.
// Used by middleware (http.ts) and route handlers (settings.ts).
// Also tracks materialization progress for the synthesis banner.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getStateDir } from "../utils/paths.js";

let _setupComplete: boolean | null = null;

export interface SynthesisProgress {
  percent: number;
  totalEvents: number;
  processedEvents: number;
  phase: "pending" | "materializing" | "complete";
  synthesisCompletedAt: string | null;
}

// In-memory progress state — updated by materializer onTick, read by progress endpoint and banner
let _synthesisProgress: SynthesisProgress = {
  percent: 0,
  totalEvents: 0,
  processedEvents: 0,
  phase: "pending",
  synthesisCompletedAt: null,
};

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

export function getSynthesisProgress(): SynthesisProgress {
  return { ..._synthesisProgress };
}

export function updateSynthesisProgress(update: Partial<SynthesisProgress>): void {
  _synthesisProgress = { ..._synthesisProgress, ...update };
  if (_synthesisProgress.percent >= 100 && !_synthesisProgress.synthesisCompletedAt) {
    _synthesisProgress.phase = "complete";
    _synthesisProgress.synthesisCompletedAt = new Date().toISOString();
  }
}

/**
 * Check if the synthesis banner should still be shown.
 * Returns false if synthesis completed more than 5 minutes ago.
 */
export function shouldShowSynthesisBanner(): boolean {
  if (_synthesisProgress.phase === "pending") return false;
  if (_synthesisProgress.phase === "materializing") return true;
  if (_synthesisProgress.synthesisCompletedAt) {
    const completedAt = new Date(_synthesisProgress.synthesisCompletedAt).getTime();
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() - completedAt < fiveMinutes;
  }
  return false;
}

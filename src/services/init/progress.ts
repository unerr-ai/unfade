// FILE: src/services/init/progress.ts
// Persistence for init_progress.json — read, write, and step-level updates.
// Stored at .unfade/state/init_progress.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createInitProgress,
  type InitProgress,
  InitProgressSchema,
  type InitStepName,
} from "../../schemas/init-progress.js";
import { logger } from "../../utils/logger.js";
import { getStateDir } from "../../utils/paths.js";

const PROGRESS_FILENAME = "init_progress.json";

function progressPath(cwd: string): string {
  return join(getStateDir(cwd), PROGRESS_FILENAME);
}

/**
 * Load existing init progress or create a fresh one.
 * Returns the parsed progress and whether it was loaded from disk.
 */
export function loadProgress(cwd: string): { progress: InitProgress; resumed: boolean } {
  const path = progressPath(cwd);

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw);
      const progress = InitProgressSchema.parse(parsed);
      return { progress, resumed: true };
    } catch {
      logger.debug("Corrupt init_progress.json, starting fresh");
    }
  }

  return { progress: createInitProgress(), resumed: false };
}

/**
 * Persist current progress to disk.
 */
export function saveProgress(cwd: string, progress: InitProgress): void {
  const path = progressPath(cwd);
  writeFileSync(path, `${JSON.stringify(progress, null, 2)}\n`, "utf-8");
}

/**
 * Mark a step as completed and persist.
 */
export function markStepCompleted(cwd: string, progress: InitProgress, step: InitStepName): void {
  progress.steps[step] = {
    completed: true,
    completedAt: new Date().toISOString(),
  };
  saveProgress(cwd, progress);
}

/**
 * Mark a step as failed (non-fatal) and persist.
 */
export function markStepFailed(
  cwd: string,
  progress: InitProgress,
  step: InitStepName,
  error: string,
): void {
  progress.steps[step] = {
    completed: false,
    error,
  };
  saveProgress(cwd, progress);
}

/**
 * Mark a step as skipped and persist.
 */
export function markStepSkipped(cwd: string, progress: InitProgress, step: InitStepName): void {
  progress.steps[step] = {
    completed: true,
    completedAt: new Date().toISOString(),
    skipped: true,
  };
  saveProgress(cwd, progress);
}

/**
 * Check if a step is already completed (for idempotent re-runs).
 */
export function isStepCompleted(progress: InitProgress, step: InitStepName): boolean {
  return progress.steps[step].completed;
}

/**
 * Mark the entire init as completed and persist.
 */
export function markInitCompleted(cwd: string, progress: InitProgress): void {
  progress.completedAt = new Date().toISOString();
  saveProgress(cwd, progress);
}

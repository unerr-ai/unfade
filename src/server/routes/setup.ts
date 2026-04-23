// FILE: src/server/routes/setup.ts
// Setup/onboarding lifecycle API routes. Mounted at root ("").
// POST /api/setup/complete — marks onboarding as done.

import { renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { logger } from "../../utils/logger.js";
import { getStateDir } from "../../utils/paths.js";
import { invalidateSetupCache } from "../setup-state.js";

export const setupRoutes = new Hono();

/**
 * POST /api/setup/complete — marks onboarding as done.
 * Called when user clicks "Start Exploring" on the setup page.
 */
setupRoutes.post("/api/setup/complete", async (c) => {
  const reqId = (c as unknown as { reqId?: string }).reqId;
  logger.info("setup.complete: marking done", { reqId });
  try {
    await updateSetupStatus({ configuredAt: new Date().toISOString(), setupCompleted: true });
    invalidateSetupCache();
    logger.info("setup.complete: success", { reqId });
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("setup.complete: failed", { reqId, error: msg });
    return c.json({ success: false, error: msg }, 500);
  }
});

/**
 * Update setup-status.json in state dir. Merges with existing data.
 */
export async function updateSetupStatus(update: Record<string, unknown>): Promise<void> {
  const stateDir = getStateDir();
  const statusPath = join(stateDir, "setup-status.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(statusPath, "utf-8"));
  } catch {
    // Start fresh
  }
  const merged = { ...existing, ...update };
  const tmpPath = join(stateDir, `setup-status.json.tmp.${process.pid}`);
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
  renameSync(tmpPath, statusPath);
}

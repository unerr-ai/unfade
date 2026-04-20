// FILE: src/commands/init.ts
// Phase 5.7: Init is setup-only — does NOT start the server.

import { logger } from "../utils/logger.js";

/**
 * Execute the init command.
 * Scaffolds .unfade/, downloads binary, installs hooks, configures LLM.
 * Does NOT start any server or daemon — user runs `unfade` for that.
 */
export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  try {
    const { runInit } = await import("../services/init/runner.js");
    await runInit(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Init failed: ${message}`);
    process.exitCode = 1;
  }
}

// FILE: src/commands/init.ts
// `unfade init` command — zero-knowledge, 8-step initialization.
// Delegates to runner.ts for the actual work.

import { runInit } from "../services/init/runner.js";
import { logger } from "../utils/logger.js";

/**
 * Execute the init command.
 * Scaffolds .unfade/, downloads daemon, installs hooks, starts capture.
 */
export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  try {
    await runInit(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Init failed: ${message}`);
    process.exitCode = 1;
  }
}

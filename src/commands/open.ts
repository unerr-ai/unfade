// FILE: src/commands/open.ts
// UF-019b: `unfade open` — open web UI in default browser.
// Platform-aware: open (macOS), xdg-open (Linux), start (Windows).

import { exec } from "node:child_process";
import { platform } from "node:os";
import { loadConfig } from "../config/manager.js";
import { logger } from "../utils/logger.js";

/**
 * Open a URL in the default browser.
 * Returns a promise that resolves when the command completes.
 */
export function openInBrowser(url: string): Promise<void> {
  const os = platform();

  let cmd: string;
  if (os === "darwin") {
    cmd = `open "${url}"`;
  } else if (os === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  return new Promise((resolve) => {
    exec(cmd, (err) => {
      if (err) {
        logger.warn("Could not open browser", { url, error: err.message });
      }
      resolve();
    });
  });
}

/**
 * Execute the `unfade open` command.
 * Opens web UI at localhost:{httpPort}.
 */
export async function openCommand(): Promise<void> {
  const config = loadConfig();
  const url = `http://localhost:${config.mcp.httpPort}`;
  logger.info(`Opening ${url} in browser...`);
  await openInBrowser(url);
}

// FILE: src/services/daemon/server-bootstrap.ts
// UF-048: Server auto-start — called from init flow.
// Starts HTTP server, writes server.json. Server lifecycle tied to daemon.

import { loadConfig } from "../../config/manager.js";
import type { RunningServer } from "../../server/http.js";
import { startServer } from "../../server/http.js";
import { logger } from "../../utils/logger.js";

let serverInstance: RunningServer | null = null;

/**
 * Bootstrap the HTTP server. Called during `unfade init` flow.
 * Loads config, starts server, writes server.json.
 * Returns the running server instance.
 */
export async function bootstrapServer(cwd?: string): Promise<RunningServer> {
  if (serverInstance) {
    logger.debug("Server already running, skipping bootstrap");
    return serverInstance;
  }

  const config = loadConfig();
  serverInstance = await startServer({ config, cwd });
  return serverInstance;
}

/**
 * Stop the running server if one exists.
 */
export function shutdownServer(): void {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
    logger.debug("Server shut down");
  }
}

/**
 * Get the current running server info, or null if not started.
 */
export function getServerInstance(): RunningServer | null {
  return serverInstance;
}

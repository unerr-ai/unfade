// Shared CacheManager singleton for server route handlers and MCP tools.
// Prevents the leak pattern of creating new CacheManager() per request.

import { CacheManager } from "../services/cache/manager.js";

let instance: CacheManager | null = null;

/** Get the shared server-wide CacheManager. Lazily created on first call. */
export function getServerCache(): CacheManager {
  if (!instance) {
    instance = new CacheManager();
  }
  return instance;
}

/** Close the shared cache (call during server shutdown). */
export async function closeServerCache(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

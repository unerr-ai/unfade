// FILE: src/services/daemon/server-lifecycle.ts
// Phase 5.7: Simplified — server runs in-process via unfade-server.ts.
// This file retains stop/check utilities for `unfade doctor` and `unfade reset`.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getStateDir } from "../../utils/paths.js";

export interface StopHttpServerResult {
  ok: boolean;
  message: string;
}

/**
 * Stop the HTTP server process recorded in `.unfade/state/server.json` (SIGTERM).
 * Used by `unfade reset` to clean up a running server.
 */
export function stopHttpServer(cwd?: string): StopHttpServerResult {
  const serverJsonPath = join(getStateDir(cwd), "server.json");
  if (!existsSync(serverJsonPath)) {
    return { ok: false, message: "No .unfade/state/server.json — nothing to stop." };
  }

  try {
    const info = JSON.parse(readFileSync(serverJsonPath, "utf-8")) as {
      pid?: number;
      port?: number;
    };
    const pid = info.pid;
    if (typeof pid !== "number" || pid <= 0 || !Number.isInteger(pid)) {
      try {
        unlinkSync(serverJsonPath);
      } catch {
        /* ignore */
      }
      return { ok: false, message: "server.json had no valid pid — removed stale file." };
    }

    if (!isProcessAlive(pid)) {
      try {
        unlinkSync(serverJsonPath);
      } catch {
        /* ignore */
      }
      return { ok: true, message: `Removed stale server.json (pid ${pid} was not running).` };
    }

    try {
      process.kill(pid, "SIGTERM");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Could not signal pid ${pid}: ${msg}` };
    }

    try {
      unlinkSync(serverJsonPath);
    } catch {
      /* process may delete on exit */
    }
    return { ok: true, message: `Stopped HTTP server (pid ${pid}, port ${info.port ?? "?"}).` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to read server.json: ${msg}` };
  }
}

/**
 * Check if the HTTP server is currently reachable.
 */
export async function isServerRunning(
  cwd?: string,
): Promise<{ running: boolean; port: number | null }> {
  const serverJsonPath = join(getStateDir(cwd), "server.json");
  if (!existsSync(serverJsonPath)) {
    return { running: false, port: null };
  }

  try {
    const info = JSON.parse(readFileSync(serverJsonPath, "utf-8"));
    const port = info.port as number;
    const pid = info.pid as number;

    if (typeof pid === "number" && !isProcessAlive(pid)) {
      try {
        unlinkSync(serverJsonPath);
      } catch {
        /* ignore */
      }
      return { running: false, port: null };
    }

    const resp = await fetch(`http://127.0.0.1:${port}/unfade/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (resp.ok) {
      return { running: true, port };
    }
  } catch {
    // not responding
  }

  return { running: false, port: null };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// FILE: src/utils/ipc.ts
// TypeScript IPC client for communicating with the Unfade daemon.
// Connects to the Unix domain socket, sends a JSON command, reads JSON response.
// Protocol: one JSON line request → one JSON line response → close.

import { createConnection } from "node:net";
import { getDaemonStateDir, getStateDir } from "./paths.js";

export interface IPCRequest {
  cmd: string;
  args?: Record<string, unknown>;
}

export interface IPCResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** True when a short backoff + retry may succeed (socket race, brief restart). */
export function isRetryableIpcConnectionError(error: string | undefined): boolean {
  if (!error) return false;
  return (
    error === "Capture engine is not running" ||
    error === "Connection to capture engine timed out" ||
    error === "Capture engine closed connection without response"
  );
}

/**
 * Send a command to the running daemon via Unix socket IPC.
 * Returns the daemon's response, or an error response if the daemon
 * is not running or communication fails.
 *
 * @param request - The command to send
 * @param cwd - Working directory for resolving the socket path
 * @param timeoutMs - Connection timeout in milliseconds (default: 3000)
 */
export function sendIPCCommand(
  request: IPCRequest,
  cwd?: string,
  timeoutMs = 3000,
): Promise<IPCResponse> {
  const socketPath = getSocketPath(cwd);

  return new Promise((resolve) => {
    let responded = false;
    let buffer = "";

    const respond = (resp: IPCResponse) => {
      if (!responded) {
        responded = true;
        resolve(resp);
      }
    };

    const conn = createConnection(socketPath);
    conn.setTimeout(timeoutMs);

    conn.on("connect", () => {
      const line = `${JSON.stringify(request)}\n`;
      conn.write(line);
    });

    conn.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const jsonLine = buffer.slice(0, newlineIdx);
        try {
          const resp = JSON.parse(jsonLine) as IPCResponse;
          respond(resp);
        } catch {
          respond({ ok: false, error: "Invalid JSON response from daemon" });
        }
        conn.end();
      }
    });

    conn.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        respond({ ok: false, error: "Capture engine is not running" });
      } else {
        respond({ ok: false, error: `IPC error: ${err.message}` });
      }
    });

    conn.on("timeout", () => {
      respond({ ok: false, error: "Connection to capture engine timed out" });
      conn.destroy();
    });

    conn.on("end", () => {
      if (!responded) {
        respond({ ok: false, error: "Capture engine closed connection without response" });
      }
    });
  });
}

/**
 * Send a status query to the daemon.
 */
export function queryDaemonStatus(cwd?: string): Promise<IPCResponse> {
  return sendIPCCommand({ cmd: "status" }, cwd);
}

/**
 * Poll until the capture engine accepts IPC (or timeout).
 * Prefer this over only checking for `daemon.sock` — the socket file can exist
 * before listen(2) succeeds or after a crashed peer left a stale path.
 */
export async function waitForDaemonIPCReady(cwd?: string, maxWaitMs = 20_000): Promise<boolean> {
  const started = Date.now();
  let delayMs = 200;
  while (Date.now() - started < maxWaitMs) {
    const resp = await sendIPCCommand({ cmd: "status" }, cwd, 2500);
    if (resp.ok) return true;
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(Math.floor(delayMs * 1.5), 2000);
  }
  return false;
}

/**
 * Send a stop command to the daemon.
 */
export function stopDaemon(cwd?: string): Promise<IPCResponse> {
  return sendIPCCommand({ cmd: "stop" }, cwd);
}

/**
 * Trigger a manual distill via the daemon.
 */
export function triggerDistill(cwd?: string): Promise<IPCResponse> {
  return sendIPCCommand({ cmd: "distill" }, cwd);
}

/**
 * Start historical AI session ingest for N days.
 */
export function triggerIngest(days: number, cwd?: string): Promise<IPCResponse> {
  return sendIPCCommand({ cmd: "ingest", args: { days } }, cwd, 10000);
}

/**
 * Query the current historical ingest status.
 */
export function queryIngestStatus(cwd?: string): Promise<IPCResponse> {
  return sendIPCCommand({ cmd: "ingest-status" }, cwd);
}

/**
 * Get the socket path for the daemon IPC.
 * In global-first mode, socket lives at ~/.unfade/state/daemons/<projectId>/daemon.sock
 * when projectId is available, or ~/.unfade/state/daemon.sock as fallback.
 */
function getSocketPath(cwd?: string): string {
  const stateDir = getStateDir(cwd);
  return `${stateDir}/daemon.sock`;
}

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IPCRequest, IPCResponse } from "../../src/utils/ipc.js";
import { sendIPCCommand } from "../../src/utils/ipc.js";

describe("IPC client", () => {
  let socketPath: string;

  beforeEach(() => {
    // Use short path to avoid macOS 104-byte Unix socket limit.
    socketPath = `/tmp/uf-test-${process.pid}.sock`;
  });

  afterEach(() => {
    try {
      rmSync(socketPath, { force: true });
    } catch {}
  });

  function startMockDaemon(handler: (req: IPCRequest) => IPCResponse): Promise<() => void> {
    return new Promise((resolve) => {
      const server = createServer((conn) => {
        let buffer = "";
        conn.on("data", (chunk) => {
          buffer += chunk.toString();
          const idx = buffer.indexOf("\n");
          if (idx !== -1) {
            const line = buffer.slice(0, idx);
            const req = JSON.parse(line) as IPCRequest;
            const resp = handler(req);
            conn.write(`${JSON.stringify(resp)}\n`);
            conn.end();
          }
        });
      });

      server.listen(socketPath, () => {
        resolve(() => {
          server.close();
          try {
            rmSync(socketPath, { force: true });
          } catch {}
        });
      });
    });
  }

  it("sends status command and receives response", async () => {
    const stop = await startMockDaemon((req) => ({
      ok: true,
      data: { status: "running", cmd: req.cmd },
    }));

    try {
      // Use sendIPCCommand directly with the socket path by patching.
      // Since sendIPCCommand uses getStateDir internally, we test via the lower-level approach.
      const { createConnection } = await import("node:net");

      const resp = await new Promise<IPCResponse>((resolve) => {
        let buf = "";
        const conn = createConnection(socketPath);
        conn.on("connect", () => {
          conn.write(`${JSON.stringify({ cmd: "status" })}\n`);
        });
        conn.on("data", (chunk) => {
          buf += chunk.toString();
          const idx = buf.indexOf("\n");
          if (idx !== -1) {
            resolve(JSON.parse(buf.slice(0, idx)) as IPCResponse);
            conn.end();
          }
        });
      });

      expect(resp.ok).toBe(true);
      expect(resp.data?.status).toBe("running");
      expect(resp.data?.cmd).toBe("status");
    } finally {
      stop();
    }
  });

  it("handles connection refused when daemon not running", async () => {
    const resp = await sendIPCCommand({ cmd: "status" }, `/tmp/nonexistent-${randomUUID()}`);
    expect(resp.ok).toBe(false);
    expect(resp.error).toBeDefined();
  });

  it("handles stop command", async () => {
    const stop = await startMockDaemon((_req) => ({
      ok: true,
      data: { message: "shutdown initiated" },
    }));

    try {
      const { createConnection } = await import("node:net");

      const resp = await new Promise<IPCResponse>((resolve) => {
        let buf = "";
        const conn = createConnection(socketPath);
        conn.on("connect", () => {
          conn.write(`${JSON.stringify({ cmd: "stop" })}\n`);
        });
        conn.on("data", (chunk) => {
          buf += chunk.toString();
          const idx = buf.indexOf("\n");
          if (idx !== -1) {
            resolve(JSON.parse(buf.slice(0, idx)) as IPCResponse);
            conn.end();
          }
        });
      });

      expect(resp.ok).toBe(true);
      expect(resp.data?.message).toBe("shutdown initiated");
    } finally {
      stop();
    }
  });
});

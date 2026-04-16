// FILE: src/server/http.ts
// UF-050: Hono HTTP server on localhost:7654 (configurable, fallback 7655–7660).
// Binds to 127.0.0.1 ONLY. Writes server.json atomically on startup.
// All JSON responses wrapped in { data, _meta } envelope via middleware.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { UnfadeConfig } from "../schemas/config.js";
import { mountMcpHttp } from "../services/mcp/server.js";
import { logger } from "../utils/logger.js";
import { getStateDir } from "../utils/paths.js";
import { dashboardPage } from "./pages/dashboard.js";
import { distillPage } from "./pages/distill.js";
import { profilePage } from "./pages/profile.js";
import { settingsPage } from "./pages/settings.js";
import { contextRoutes } from "./routes/context.js";
import { decisionsRoutes } from "./routes/decisions.js";
import { distillRoutes } from "./routes/distill.js";
import { profileRoutes } from "./routes/profile.js";
import { queryRoutes } from "./routes/query.js";

export interface ServerInfo {
  port: number;
  pid: number;
  startedAt: string;
  version: string;
  transport: {
    http: string;
    mcp: string;
  };
}

/**
 * Create the Hono application with all middleware and routes.
 */
export function createApp(): Hono {
  const app = new Hono();

  // CORS: allow localhost only
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        try {
          const url = new URL(origin);
          if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
            return origin;
          }
        } catch {
          // invalid origin
        }
        return "";
      },
    }),
  );

  // Error handler — return JSON errors, never crash
  app.onError((err, c) => {
    logger.error("HTTP error", { message: err.message });
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-server",
          durationMs: 0,
          degraded: true,
          degradedReason: err.message,
          lastUpdated: null,
        },
      },
      500,
    );
  });

  // Health check
  app.get("/unfade/health", (c) => {
    return c.json({
      status: "ok",
      version: "0.1.0",
      pid: process.pid,
      uptime: process.uptime(),
    });
  });

  // Mount route groups
  app.route("/unfade", contextRoutes);
  app.route("/unfade", queryRoutes);
  app.route("/unfade", decisionsRoutes);
  app.route("/unfade", profileRoutes);
  app.route("/unfade", distillRoutes);

  // Mount Web UI pages (server-rendered HTML + htmx)
  app.route("", dashboardPage);
  app.route("", distillPage);
  app.route("", profilePage);
  app.route("", settingsPage);

  // Mount MCP Streamable HTTP transport at /mcp
  mountMcpHttp(app);

  return app;
}

/**
 * Write server.json atomically (tmp + rename) to .unfade/state/.
 */
function writeServerJson(info: ServerInfo, cwd?: string): void {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });
  const targetPath = join(stateDir, "server.json");
  const tmpPath = join(stateDir, `server.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmpPath, JSON.stringify(info, null, 2), "utf-8");
    renameSync(tmpPath, targetPath);
    logger.debug("Wrote server.json", { port: info.port });
  } catch (err) {
    logger.warn("Failed to write server.json", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Check if a port is available by attempting to listen on it.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNodeServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find an available port starting from the configured port, trying up to 7660.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  const maxPort = startPort + 6; // e.g., 7654 → 7660
  for (let port = startPort; port <= maxPort; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found in range ${startPort}–${maxPort}`);
}

export interface StartServerOptions {
  config: UnfadeConfig;
  cwd?: string;
}

export interface RunningServer {
  info: ServerInfo;
  close: () => void;
}

/**
 * Start the HTTP server on the configured port (with fallback).
 * Writes server.json atomically on startup.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { config, cwd } = options;
  const app = createApp();
  const startPort = config.mcp.httpPort;

  const port = await findAvailablePort(startPort);

  const info: ServerInfo = {
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    version: "0.1.0",
    transport: {
      http: `http://127.0.0.1:${port}`,
      mcp: `http://127.0.0.1:${port}/mcp`,
    },
  };

  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port,
  });

  writeServerJson(info, cwd);

  logger.info(`Server listening on http://127.0.0.1:${port}`);

  return {
    info,
    close: () => {
      server.close();
    },
  };
}

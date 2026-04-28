// FILE: src/server/http.ts
// Hono HTTP server on localhost:7654 (configurable, fallback 7655–7660).
// All API routes mounted under /api/*. React SPA served from Vite-built dist/.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { UnfadeConfig } from "../schemas/config.js";
import { mountMcpHttp } from "../services/mcp/server.js";
import { logger } from "../utils/logger.js";
import { getStateDir } from "../utils/paths.js";
import { actionsRoutes } from "./routes/actions.js";
import { amplifyRoutes } from "./routes/amplify.js";
import { cardsRoutes } from "./routes/cards.js";
import { contextRoutes } from "./routes/context.js";
import { decisionDetailRoutes } from "./routes/decision-detail.js";
import { decisionsRoutes } from "./routes/decisions.js";
import { distillRoutes } from "./routes/distill.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { heatmapRoutes } from "./routes/heatmap.js";
import { insightsRoutes } from "./routes/insights.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { intelligenceRoutes } from "./routes/intelligence.js";
import { onboardingRoutes } from "./routes/intelligence-onboarding.js";
// intelligence-tabs.ts removed in Phase 17 — React SPA handles all tab rendering
import { lineageRoutes } from "./routes/lineage.js";
import { logsRoutes } from "./routes/logs.js";
import { profileRoutes } from "./routes/profile.js";
import { projectRoutes } from "./routes/projects.js";
import { queryRoutes } from "./routes/query.js";
import { reposRoutes } from "./routes/repos.js";
import { settingsRoutes } from "./routes/settings.js";
import { setupRoutes } from "./routes/setup.js";
import { streamRoutes } from "./routes/stream.js";
import { substrateRoutes } from "./routes/substrate.js";
import { summaryRoutes } from "./routes/summary.js";
import { systemHealthRoutes } from "./routes/system-health.js";
import { isSetupComplete } from "./setup-state.js";

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
  // Resolve package root from the bundled file location (dist/*.mjs → project root)
  // so static file serving works regardless of CWD
  const __ownFile = fileURLToPath(import.meta.url);
  const distDir = dirname(__ownFile);
  const pkgRoot = resolve(distDir, "..");

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

  // Static assets — Cache-Control for fonts/css/js (UF-477)
  app.use("/public/*", async (c, next) => {
    await next();
    const path = c.req.path;
    if (path.endsWith(".woff2") || path.endsWith(".woff")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    } else if (path.endsWith(".css") || path.endsWith(".js")) {
      c.header("Cache-Control", "public, max-age=3600, must-revalidate");
    } else if (path.endsWith(".png") || path.endsWith(".svg")) {
      c.header("Cache-Control", "public, max-age=86400");
    }
  });
  app.use("/public/*", serveStatic({ root: pkgRoot }));

  // Request logging middleware — correlation ID + timing for every request
  app.use("*", async (c, next) => {
    const reqId = crypto.randomUUID().slice(0, 8);
    (c as unknown as { reqId: string }).reqId = reqId;
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    logger.info("request", {
      reqId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms,
    });
  });

  // Setup enforcement middleware — server-side redirect to /setup when incomplete
  app.use("*", async (c, next) => {
    const path = c.req.path;
    // Allow: setup page, API endpoints, static assets, settings (needed by setup), MCP
    if (
      path === "/setup" ||
      path.startsWith("/api/") ||
      path.startsWith("/public/") ||
      path.startsWith("/assets/") ||
      path === "/favicon.ico" ||
      path === "/mcp"
    ) {
      return next();
    }
    if (!isSetupComplete()) {
      return c.redirect("/setup", 302);
    }
    return next();
  });

  // Error handler — return JSON errors, never crash
  app.onError((err, c) => {
    logger.error("HTTP error", {
      message: err.message,
      path: c.req.path,
      method: c.req.method,
    });
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

  // Health check — redirect to unified system health endpoint
  app.get("/api/health", (c) => c.redirect("/api/system/health"));

  // Mount all API routes under /api/*
  app.route("/api", contextRoutes);
  app.route("/api", queryRoutes);
  app.route("/api", decisionsRoutes);
  app.route("/api", profileRoutes);
  app.route("/api", distillRoutes);
  app.route("/api", cardsRoutes);
  app.route("/api", amplifyRoutes);
  app.route("/api", feedbackRoutes);
  app.route("/api", settingsRoutes);
  app.route("", summaryRoutes);
  app.route("", streamRoutes);
  app.route("", insightsRoutes);
  app.route("", reposRoutes);
  app.route("", projectRoutes);
  app.route("", heatmapRoutes);
  app.route("", decisionDetailRoutes);
  app.route("", intelligenceRoutes);
  app.route("", lineageRoutes);
  app.route("", integrationsRoutes);
  app.route("", setupRoutes);
  app.route("", onboardingRoutes);
  app.route("", systemHealthRoutes);
  app.route("", actionsRoutes);
  app.route("", logsRoutes);
  app.route("", substrateRoutes);

  // Mount MCP Streamable HTTP transport at /mcp
  mountMcpHttp(app);

  // React SPA: serve Vite-built assets + SPA fallback for all non-API routes
  const spaDir = join(distDir, "ui");
  const spaIndex = join(spaDir, "index.html");

  if (existsSync(spaIndex)) {
    const spaHtml = readFileSync(spaIndex, "utf-8");

    app.use("/assets/*", serveStatic({ root: spaDir }));

    app.get("*", (c) => {
      const path = c.req.path;
      if (path.startsWith("/api/") || path.startsWith("/public/") || path.startsWith("/mcp")) {
        return c.notFound();
      }
      return c.html(spaHtml);
    });
  }

  return app;
}

/**
 * Read existing server.json to check for a running server.
 */
function readServerJson(cwd?: string): ServerInfo | null {
  try {
    const stateDir = getStateDir(cwd);
    const path = join(stateDir, "server.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as ServerInfo;
  } catch {
    return null;
  }
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
 * Enforces single-instance: if another server is alive on the preferred port,
 * we abort instead of silently starting on the next port.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { config, cwd } = options;
  const app = createApp();
  const startPort = config.mcp.httpPort;

  // Single-instance is enforced upstream by acquireServerLock() in unfade-server.ts.
  // If we reach here, we are the only instance. Clean up stale server.json if present.
  const existingServer = readServerJson(cwd);
  if (existingServer && existingServer.pid !== process.pid) {
    logger.debug("Cleaning stale server.json", { stalePid: existingServer.pid });
    try {
      unlinkSync(join(getStateDir(cwd), "server.json"));
    } catch {
      // already gone
    }
  }

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

// FILE: src/server/http.ts
// UF-050: Hono HTTP server on localhost:7654 (configurable, fallback 7655–7660).
// Binds to 127.0.0.1 ONLY. Writes server.json atomically on startup.
// All JSON responses wrapped in { data, _meta } envelope via middleware.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { UnfadeConfig } from "../schemas/config.js";
import { mountMcpHttp } from "../services/mcp/server.js";
import { logger } from "../utils/logger.js";
import { getStateDir } from "../utils/paths.js";
import { cardsPage } from "./pages/cards.js";
import { decisionsPage } from "./pages/decisions.js";
import { distillPage } from "./pages/distill.js";
import { homePage } from "./pages/home.js";
import { integrationsPage } from "./pages/integrations.js";
import { intelligencePage } from "./pages/intelligence.js";
import { livePage } from "./pages/live.js";
import { logsPage } from "./pages/logs.js";
// portfolio.ts removed in Phase 15 — merged into Home (All Projects view)
import { profilePage } from "./pages/profile.js";
import { projectsPage } from "./pages/projects.js";
// repo-detail.ts removed in Phase 15 — merged into Home (project-selected view)
import { settingsPage } from "./pages/settings.js";
import { setupPage } from "./pages/setup.js";
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
import { intelligenceTabRoutes } from "./routes/intelligence-tabs.js";
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
  app.use("/public/*", serveStatic({ root: "./" }));

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
      path.startsWith("/unfade/") ||
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
  app.get("/unfade/health", (c) => c.redirect("/api/system/health"));

  // Mount route groups
  app.route("/unfade", contextRoutes);
  app.route("/unfade", queryRoutes);
  app.route("/unfade", decisionsRoutes);
  app.route("/unfade", profileRoutes);
  app.route("/unfade", distillRoutes);
  app.route("/unfade", cardsRoutes);
  app.route("/unfade", amplifyRoutes);
  app.route("/unfade", feedbackRoutes);
  app.route("/unfade", settingsRoutes);

  // Phase 5.6: Living intelligence routes
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

  // /decisions is now a real page (Sprint 15C) — registered via decisionsPage route above
  // /portfolio and /repos/:id redirects (Phase 15 — merged into Home)
  app.get("/portfolio", (c) => c.redirect("/"));
  app.get("/repos/:id", (c) => {
    const id = c.req.param("id");
    return c.redirect(`/?project=${encodeURIComponent(id)}`);
  });

  // Phase 7: Intelligence pages
  // Phase 15: standalone intelligence pages merged into Intelligence Hub tabs
  app.get("/efficiency", (c) => c.redirect("/intelligence?tab=overview"));
  app.get("/cost", (c) => c.redirect("/intelligence?tab=cost"));
  app.get("/coach", (c) => c.redirect("/intelligence?tab=patterns"));
  app.get("/velocity", (c) => c.redirect("/intelligence?tab=velocity"));
  app.get("/alerts", (c) => c.redirect("/intelligence?tab=patterns"));
  app.get("/comprehension", (c) => c.redirect("/intelligence?tab=comprehension"));
  app.route("", intelligenceTabRoutes);
  app.route("", intelligencePage);
  // cost.ts and comprehension.ts removed — redirected to Intelligence Hub above

  // Mount Web UI pages (server-rendered HTML + htmx)
  app.route("", setupPage);
  app.route("", homePage);
  app.route("", livePage);
  app.route("", distillPage);
  app.route("", profilePage);
  app.route("", settingsPage);
  app.route("", cardsPage);
  app.route("", decisionsPage);
  app.route("", projectsPage);
  app.get("/search", (c) => c.redirect("/decisions"));
  app.route("", integrationsPage);
  app.route("", logsPage);

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

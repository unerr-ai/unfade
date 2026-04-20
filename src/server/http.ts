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
import { alertsPage } from "./pages/alerts.js";
import { cardsPage } from "./pages/cards.js";
import { coachPage } from "./pages/coach.js";
import { comprehensionPage } from "./pages/comprehension.js";
import { costPage } from "./pages/cost.js";
import { costsPage } from "./pages/costs.js";
import { distillPage } from "./pages/distill.js";
import { efficiencyPage } from "./pages/efficiency.js";
import { homePage } from "./pages/home.js";
import { intelligencePage } from "./pages/intelligence.js";
import { livePage } from "./pages/live.js";
import { portfolioPage } from "./pages/portfolio.js";
import { profilePage } from "./pages/profile.js";
import { repoDetailPage } from "./pages/repo-detail.js";
import { searchPage } from "./pages/search.js";
import { settingsPage } from "./pages/settings.js";
import { velocityPage } from "./pages/velocity-page.js";
import { amplifyRoutes } from "./routes/amplify.js";
import { cardsRoutes } from "./routes/cards.js";
import { contextRoutes } from "./routes/context.js";
import { decisionDetailRoutes } from "./routes/decision-detail.js";
import { decisionsRoutes } from "./routes/decisions.js";
import { distillRoutes } from "./routes/distill.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { heatmapRoutes } from "./routes/heatmap.js";
import { insightsRoutes } from "./routes/insights.js";
import { intelligenceRoutes } from "./routes/intelligence.js";
import { onboardingRoutes } from "./routes/intelligence-onboarding.js";
import { profileRoutes } from "./routes/profile.js";
import { queryRoutes } from "./routes/query.js";
import { reposRoutes } from "./routes/repos.js";
import { settingsRoutes } from "./routes/settings.js";
import { streamRoutes } from "./routes/stream.js";
import { summaryRoutes } from "./routes/summary.js";

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

  // Static assets (brand icons, fonts, manifest)
  app.use("/public/*", serveStatic({ root: "./" }));

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

  // Health check — includes per-repo daemon + materializer status
  app.get("/unfade/health", (c) => {
    const repoManager = (globalThis as Record<string, unknown>).__unfade_repo_manager as
      | { getHealthStatus(): Array<Record<string, unknown>>; size: number }
      | undefined;

    return c.json({
      status: "ok",
      version: "0.1.0",
      pid: process.pid,
      uptime: process.uptime(),
      repoCount: repoManager?.size ?? 0,
      repos: repoManager?.getHealthStatus() ?? [],
    });
  });

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
  app.route("", heatmapRoutes);
  app.route("", decisionDetailRoutes);
  app.route("", intelligenceRoutes);
  app.route("", onboardingRoutes);

  // Phase 5.6: Multi-repo pages
  app.route("", portfolioPage);
  app.route("", repoDetailPage);

  // Phase 7: Intelligence pages
  app.route("", efficiencyPage);
  app.route("", costsPage);
  app.route("", coachPage);
  app.route("", velocityPage);
  app.route("", alertsPage);
  app.route("", intelligencePage);
  app.route("", costPage);
  app.route("", comprehensionPage);

  // Mount Web UI pages (server-rendered HTML + htmx)
  app.route("", homePage);
  app.route("", livePage);
  app.route("", distillPage);
  app.route("", profilePage);
  app.route("", settingsPage);
  app.route("", cardsPage);
  app.route("", searchPage);

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

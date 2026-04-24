// FILE: src/server/routes/setup.ts
// Setup/onboarding lifecycle API routes. Mounted at root ("").
// Handles project discovery, LLM verification, skills installation, daemon launch, and progress tracking.

import { execSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { UnfadeConfigSchema } from "../../schemas/config.js";
import { discoverProjects } from "../../services/discovery/scanner.js";
import {
  checkOllamaReady,
  normalizeOpenAICompatibleApiBase,
} from "../../services/distill/providers/ai.js";
import { eventBus } from "../../services/event-bus.js";
import { detectInstalledAgents, installSkills } from "../../services/integrations/skills-writer.js";
import { loadRegistry, registerRepo } from "../../services/registry/registry.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir, getStateDir } from "../../utils/paths.js";
import {
  getSynthesisProgress,
  invalidateSetupCache,
  updateSynthesisProgress,
} from "../setup-state.js";

export const setupRoutes = new Hono();

/**
 * POST /api/setup/complete — marks onboarding as done and starts capture pipeline.
 */
setupRoutes.post("/api/setup/complete", async (c) => {
  const reqId = (c as unknown as { reqId?: string }).reqId;
  logger.info("setup.complete: marking done", { reqId });
  try {
    await updateSetupStatus({ configuredAt: new Date().toISOString(), setupCompleted: true });
    invalidateSetupCache();

    // Start capture pipeline (daemons were deferred until now)
    const repoManager = (globalThis as Record<string, unknown>).__unfade_repo_manager;
    if (repoManager) {
      const { startCapturePipeline } = await import("../unfade-server.js");
      const { resetCursor } = await import("../../services/cache/cursor.js");
      const registry = loadRegistry();

      // Fresh setup: wipe any stale materializer cursor so we start from byte 0
      resetCursor();

      // Update synthesis progress to materializing
      updateSynthesisProgress({ phase: "materializing", percent: 0 });

      // Fire-and-forget — pipeline runs in background
      startCapturePipeline(
        repoManager as import("../../services/daemon/repo-manager.js").RepoManager,
        registry.repos,
      );
    }

    logger.info("setup.complete: success", { reqId });
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("setup.complete: failed", { reqId, error: msg });
    return c.json({ success: false, error: msg }, 500);
  }
});

/**
 * GET /api/setup/discover-projects — scan local directories for git repos.
 */
setupRoutes.get("/api/setup/discover-projects", (c) => {
  try {
    const projects = discoverProjects();
    return c.json({ projects, cwd: process.cwd() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("setup.discover-projects failed", { error: msg });
    return c.json({ projects: [], cwd: process.cwd(), error: msg });
  }
});

/**
 * POST /api/setup/add-project — register a project for tracking.
 */
setupRoutes.post("/api/setup/add-project", async (c) => {
  const body = await c.req.json<{ path: string }>();
  const projectPath = body?.path?.trim();

  if (!projectPath) {
    return c.json({ success: false, error: "Path is required" }, 400);
  }

  try {
    const entry = registerRepo(projectPath);

    // Get commit count for the project
    let commitCount = 0;
    try {
      const output = execSync("git rev-list --count HEAD", {
        cwd: projectPath,
        timeout: 5000,
        encoding: "utf-8",
      }).trim();
      commitCount = parseInt(output, 10) || 0;
    } catch {
      // Not a git repo or git not available
    }

    return c.json({ success: true, entry, commitCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

/**
 * POST /api/setup/verify-llm — save LLM config and verify credentials in one shot.
 * Returns JSON (not HTML) for the setup wizard.
 */
setupRoutes.post("/api/setup/verify-llm", async (c) => {
  const body = await c.req.json<{
    provider: string;
    model: string;
    apiKey: string;
    apiBase: string;
  }>();

  const provider = (body.provider ?? "").trim();
  const model = (body.model ?? "").trim();
  const apiKey = (body.apiKey ?? "").trim();
  const apiBase = (body.apiBase ?? "").trim();

  const VALID_PROVIDERS = ["none", "ollama", "openai", "anthropic", "custom"];
  if (!VALID_PROVIDERS.includes(provider)) {
    return c.json({ success: false, error: `Invalid provider: ${provider}` }, 400);
  }

  // Save config
  const projectDir = getProjectDataDir();
  const configPath = join(projectDir, "config.json");
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    // fresh config
  }

  const distill = (rawConfig.distill ?? {}) as Record<string, unknown>;
  distill.provider = provider;
  if (model) distill.model = model;
  if (provider === "none") {
    delete distill.apiKey;
    delete distill.apiBase;
    delete distill.model;
  } else if (provider === "ollama") {
    delete distill.apiKey;
    if (apiBase) distill.apiBase = apiBase;
    else delete distill.apiBase;
  } else {
    if (apiKey) distill.apiKey = apiKey;
    if (apiBase) {
      distill.apiBase =
        provider === "anthropic" ? apiBase : (normalizeOpenAICompatibleApiBase(apiBase) ?? apiBase);
    }
  }
  rawConfig.distill = distill;

  try {
    UnfadeConfigSchema.parse(rawConfig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: `Invalid configuration: ${msg}` }, 400);
  }

  const tmpPath = join(projectDir, `config.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmpPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, configPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: `Failed to save: ${msg}` }, 500);
  }

  await updateSetupStatus({ configuredAt: new Date().toISOString(), llmProvider: provider });

  // Verify connectivity
  if (provider === "none") {
    return c.json({
      success: true,
      verified: true,
      message: "Structured summaries enabled (no AI). Distills will use heuristic extraction.",
    });
  }

  if (provider === "ollama") {
    const result = await checkOllamaReady(apiBase || "http://localhost:11434", model || "llama3.2");
    if (result.ready) {
      return c.json({
        success: true,
        verified: true,
        message: `Connected to Ollama — model ${model || "llama3.2"} is available.`,
      });
    }
    return c.json({
      success: true,
      verified: false,
      error: result.reason ?? "Ollama not reachable at localhost:11434",
    });
  }

  // openai, anthropic, custom — test real completion
  if (!apiKey) {
    return c.json({
      success: true,
      verified: false,
      error: "No API key provided — please enter your API key.",
    });
  }

  const testResult = await testLlmCompletion(provider, apiKey, model, apiBase);
  if (testResult.success) {
    return c.json({
      success: true,
      verified: true,
      message: `Verified — ${provider} API key is valid and model responds.`,
    });
  }
  return c.json({
    success: true,
    verified: false,
    error: testResult.reason,
  });
});

/**
 * GET /api/setup/detect-agents — check which coding agents are installed.
 */
setupRoutes.get("/api/setup/detect-agents", (c) => {
  const agents = detectInstalledAgents();
  return c.json({ agents });
});

/**
 * POST /api/setup/install-skills — write skill/rules files for selected agents.
 */
setupRoutes.post("/api/setup/install-skills", async (c) => {
  const body = await c.req.json<{ agents?: string[]; agent?: string }>();

  // Support both { agents: [...] } (UI sends this) and { agent: "..." } (legacy)
  const agentIds = body?.agents ?? (body?.agent ? [body.agent.trim()] : []);

  if (agentIds.length === 0) {
    return c.json({ success: false, error: "At least one agent ID is required" }, 400);
  }

  const results = agentIds.map((id) => installSkills(id.trim()));
  const allSuccess = results.every((r) => r.success);
  return c.json({ success: allSuccess, results });
});

/**
 * GET /api/setup/progress — materialization progress for synthesis banner.
 */
setupRoutes.get("/api/setup/progress", (c) => {
  return c.json(getSynthesisProgress());
});

/**
 * GET /api/setup/launch-stream — SSE stream of daemon startup + materialization progress.
 */
setupRoutes.get("/api/setup/launch-stream", (c) => {
  return streamSSE(c, async (stream) => {
    let id = 0;

    const sendEvent = async (type: string, message: string, data?: Record<string, unknown>) => {
      await stream.writeSSE({
        id: String(++id),
        event: type,
        data: JSON.stringify({ message, ...data }),
      });
    };

    // Listen for bus events related to setup/launch progress
    const listener = (event: import("../../services/event-bus.js").BusEvent) => {
      if (event.type === "event" || event.type === "summary") {
        const progress = getSynthesisProgress();
        sendEvent(
          "progress",
          `Processing events... ${progress.processedEvents}/${progress.totalEvents} (${progress.percent}%)`,
          {
            percent: progress.percent,
            phase: progress.phase,
          },
        );
      }
    };

    eventBus.onBus(listener);

    // Send initial status
    await sendEvent("status", "Launch stream connected");

    // Send progress updates every 2 seconds until complete or disconnected
    const progressInterval = setInterval(async () => {
      const progress = getSynthesisProgress();
      try {
        await sendEvent("progress", `Processing... ${progress.percent}%`, {
          percent: progress.percent,
          processedEvents: progress.processedEvents,
          totalEvents: progress.totalEvents,
          phase: progress.phase,
        });
        if (progress.phase === "complete") {
          await sendEvent("complete", "Intelligence synthesis complete");
          clearInterval(progressInterval);
        }
      } catch {
        clearInterval(progressInterval);
      }
    }, 2000);

    // Keep alive until client disconnects
    try {
      while (true) {
        await stream.sleep(10000);
        const progress = getSynthesisProgress();
        if (progress.phase === "complete") break;
      }
    } finally {
      clearInterval(progressInterval);
      eventBus.offBus(listener);
    }
  });
});

/**
 * Update setup-status.json in state dir. Merges with existing data.
 */
export async function updateSetupStatus(update: Record<string, unknown>): Promise<void> {
  const stateDir = getStateDir();
  const statusPath = join(stateDir, "setup-status.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(statusPath, "utf-8"));
  } catch {
    // Start fresh
  }
  const merged = { ...existing, ...update };
  const tmpPath = join(stateDir, `setup-status.json.tmp.${process.pid}`);
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
  renameSync(tmpPath, statusPath);
}

/**
 * Test LLM completion with a simple prompt to verify API key + model.
 */
async function testLlmCompletion(
  provider: string,
  apiKey: string,
  model: string,
  apiBase: string,
): Promise<{ success: boolean; reason: string }> {
  try {
    let url: string;
    let headers: Record<string, string>;
    let body: string;

    if (provider === "anthropic") {
      url = apiBase || "https://api.anthropic.com";
      url = `${url.replace(/\/$/, "")}/v1/messages`;
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      body = JSON.stringify({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say hello" }],
      });
    } else {
      // openai or custom (OpenAI-compatible)
      // User pastes the base URL including any version prefix — we only append /chat/completions
      url = apiBase || "https://api.openai.com/v1";
      url = url.replace(/\/+$/, "");
      if (!url.endsWith("/chat/completions")) {
        url += "/chat/completions";
      }
      headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model: model || "gpt-4o",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say hello" }],
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return { success: true, reason: "" };
    }

    const errText = await response.text().catch(() => "");
    if (response.status === 401) {
      return { success: false, reason: "Invalid API key — authentication failed." };
    }
    if (response.status === 404) {
      return {
        success: false,
        reason: `Model not found: ${model || "(default)"}. Check the model name.`,
      };
    }
    return {
      success: false,
      reason: `API returned ${response.status}: ${errText.slice(0, 200)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { success: false, reason: "Connection timed out after 15s." };
    }
    return { success: false, reason: `Connection error: ${msg}` };
  }
}

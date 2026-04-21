// FILE: src/server/routes/settings.ts
// POST /settings/llm — update LLM provider config.
// GET /settings/status — config completeness and connectivity check.
// Reads current config, merges LLM fields, writes atomically.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { UnfadeConfigSchema } from "../../schemas/config.js";
import {
  checkOllamaReady,
  normalizeOllamaOriginForChecks,
  normalizeOpenAICompatibleApiBase,
} from "../../services/distill/providers/ai.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir } from "../../utils/paths.js";
import { updateSetupStatus } from "./setup.js";

export const settingsRoutes = new Hono();

const VALID_PROVIDERS = ["ollama", "openai", "anthropic", "custom", "none"] as const;

export interface SettingsStatus {
  configured: boolean;
  provider: string;
  model: string;
  validated: boolean;
  reason?: string;
}

/**
 * GET /settings/status — reports whether LLM is configured and reachable.
 * Used by home page to decide whether to show setup-required state.
 * Accessible at /unfade/settings/status (via mount prefix).
 */
settingsRoutes.get("/settings/status", async (c) => {
  const projectDir = getProjectDataDir();
  const configPath = join(projectDir, "config.json");

  let provider = "none";
  let model = "llama3.2";
  let apiKey = "";
  let apiBase = "";
  let actions: Record<string, unknown> = {};

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const distill = raw?.distill ?? {};
    provider = distill.provider ?? "none";
    model = distill.model ?? "llama3.2";
    apiKey = distill.apiKey ?? "";
    apiBase = distill.apiBase ?? "";
    actions = raw?.actions ?? {};
  } catch {
    // No config file — unconfigured
  }

  // If provider is "none", it's explicitly unconfigured
  if (provider === "none") {
    const status: SettingsStatus = {
      configured: false,
      provider: "none",
      model,
      validated: false,
      reason: "No LLM provider configured",
    };
    return c.json({ data: status, actions, _meta: { tool: "settings-status", durationMs: 0 } });
  }

  // Validate connectivity based on provider type
  let validated = false;
  let reason: string | undefined;

  if (provider === "ollama") {
    const result = await checkOllamaReady(apiBase || "http://localhost:11434", model);
    validated = result.ready;
    reason = result.ready ? undefined : result.reason;
  } else if (provider === "openai" || provider === "anthropic" || provider === "custom") {
    if (!apiKey) {
      validated = false;
      reason = "API key not set";
    } else {
      // Real test: send a minimal completion to verify key + model work
      const result = await testLlmCompletion(provider, apiKey, model, apiBase);
      validated = result.success;
      reason = result.success ? undefined : result.reason;
    }
  }

  const status: SettingsStatus = {
    configured: true,
    provider,
    model,
    validated,
    reason,
  };

  return c.json({ data: status, actions, _meta: { tool: "settings-status", durationMs: 0 } });
});

/**
 * POST /settings/llm — update distill.provider, distill.model, distill.apiKey, distill.apiBase.
 * Accepts form-encoded body (from htmx) or JSON.
 * Writes config atomically (tmp + rename), returns HTML fragment for htmx swap.
 */
settingsRoutes.post("/settings/llm", async (c) => {
  const reqId = (c as unknown as { reqId?: string }).reqId;
  const contentType = c.req.header("content-type") ?? "";
  let provider: string;
  let model: string;
  let apiKey: string;
  let apiBase: string;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.parseBody();
    provider = String(form.provider ?? "").trim();
    model = String(form.model ?? "").trim();
    apiKey = String(form.apiKey ?? "").trim();
    apiBase = String(form.apiBase ?? "").trim();
  } else {
    const body = await c.req.json();
    provider = String(body.provider ?? "").trim();
    model = String(body.model ?? "").trim();
    apiKey = String(body.apiKey ?? "").trim();
    apiBase = String(body.apiBase ?? "").trim();
  }

  logger.info("settings.llm: received", { reqId, provider, model: model || "(default)" });

  // Validate provider
  if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
    return c.html(
      `<div class="alert alert-error">Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(", ")}</div>`,
      400,
    );
  }

  // Read current config
  const projectDir = getProjectDataDir();
  const configPath = join(projectDir, "config.json");
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    logger.debug("No existing config.json — creating fresh");
  }

  // Merge LLM fields into distill section
  const distill = (rawConfig.distill ?? {}) as Record<string, unknown>;
  distill.provider = provider;
  if (model) distill.model = model;
  if (provider === "none") {
    // Clear LLM-specific fields when disabling
    delete distill.apiKey;
    delete distill.apiBase;
    delete distill.model;
  } else if (provider === "ollama") {
    // Ollama doesn't need apiKey; apiBase is optional
    delete distill.apiKey;
    if (apiBase) {
      distill.apiBase = apiBase;
    } else {
      delete distill.apiBase;
    }
  } else {
    // openai, anthropic, custom — need apiKey and possibly apiBase
    if (apiKey) distill.apiKey = apiKey;
    if (apiBase) {
      distill.apiBase =
        provider === "anthropic" ? apiBase : (normalizeOpenAICompatibleApiBase(apiBase) ?? apiBase);
    }
  }
  rawConfig.distill = distill;

  // Validate through Zod (fills defaults, catches bad values)
  try {
    UnfadeConfigSchema.parse(rawConfig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.html(`<div class="alert alert-error">Invalid configuration: ${msg}</div>`, 400);
  }

  // Write atomically
  const tmpPath = join(projectDir, `config.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmpPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, configPath);
    logger.info("LLM config updated", { provider, model: model || "(default)" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to write config", { error: msg });
    return c.html(`<div class="alert alert-error">Failed to save: ${msg}</div>`, 500);
  }

  // Update setup-status.json to reflect config change
  try {
    updateSetupStatus({ configuredAt: new Date().toISOString(), llmProvider: provider });
  } catch (err) {
    logger.warn("settings.llm: failed to update setup-status", {
      reqId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const providerLabel =
    provider === "none"
      ? "Structured summaries (no AI)"
      : `${provider}${model ? ` / ${model}` : ""}`;

  // Run connectivity check for non-"none" providers — sends a real test message
  if (provider !== "none") {
    let connectivityHtml = "";
    if (provider === "ollama") {
      const result = await checkOllamaReady(
        apiBase || "http://localhost:11434",
        model || "llama3.2",
      );
      logger.info("settings.llm: connectivity test", {
        reqId,
        provider: "ollama",
        model,
        ready: result.ready,
        reason: result.reason || undefined,
      });
      connectivityHtml = result.ready
        ? `<div class="mt-2 text-sm text-success">✓ Connected — Ollama is running and model is available.</div>`
        : `<div class="mt-2 text-sm text-warning">⚠ ${escapeHtmlAttr(result.reason ?? "Ollama not reachable")} — distills will fall back to structured summaries until resolved.</div>`;
    } else if (apiKey) {
      // Send a real test completion to validate the API key and model work
      const testResult = await testLlmCompletion(provider, apiKey, model, apiBase);
      logger.info("settings.llm: connectivity test", {
        reqId,
        provider,
        model,
        success: testResult.success,
        reason: testResult.reason || undefined,
      });
      connectivityHtml = testResult.success
        ? `<div class="mt-2 text-sm text-success">✓ Verified — sent a test message and received a valid response.</div>`
        : `<div class="mt-2 text-sm text-warning">⚠ ${escapeHtmlAttr(testResult.reason)} — distills will fall back to structured summaries until resolved.</div>`;
    } else if (!apiKey && provider !== "ollama") {
      connectivityHtml = `<div class="mt-2 text-sm text-warning">⚠ No API key provided — distills will fail until a key is set.</div>`;
    }

    return c.html(
      `<div class="alert alert-ok">LLM updated to <strong>${escapeHtmlAttr(providerLabel)}</strong>. Configuration saved.${connectivityHtml}</div>`,
    );
  }

  return c.html(
    `<div class="alert alert-ok">LLM updated to <strong>${escapeHtmlAttr(providerLabel)}</strong>. Distills will use structured summaries (no AI).</div>`,
  );
});

/**
 * POST /settings/actions — update config.actions section.
 */
settingsRoutes.post("/settings/actions", async (c) => {
  const body = await c.req.json<{
    enabled?: boolean;
    autoRules?: boolean;
    ruleTarget?: string | null;
    sessionContext?: boolean;
    weeklyDigest?: boolean;
    digestDay?: string;
  }>();

  const projectDir = getProjectDataDir();
  const configPath = join(projectDir, "config.json");
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // fresh config
  }

  rawConfig.actions = {
    enabled: body.enabled ?? false,
    autoRules: body.autoRules ?? false,
    ruleTarget: body.ruleTarget || null,
    sessionContext: body.sessionContext ?? false,
    weeklyDigest: body.weeklyDigest ?? false,
    digestDay: body.digestDay ?? "monday",
  };

  const tmpPath = join(projectDir, `config.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmpPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, configPath);
    return c.json({ saved: true });
  } catch (err) {
    return c.json({ saved: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/**
 * Escape HTML special characters for use in attribute values and text content.
 */
function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send a real test completion to validate API key, model, and endpoint.
 * Uses minimal tokens (max_tokens=5) to keep cost negligible.
 */
async function testLlmCompletion(
  provider: string,
  apiKey: string,
  model: string,
  apiBase: string,
): Promise<{ success: boolean; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    if (provider === "anthropic") {
      const baseUrl = apiBase || "https://api.anthropic.com";
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model || "claude-sonnet-4-20250514",
          max_tokens: 5,
          messages: [{ role: "user", content: "Say OK" }],
        }),
        signal: controller.signal,
      });
      if (res.ok) return { success: true, reason: "" };
      const body = await res.text().catch(() => "");
      if (res.status === 401) return { success: false, reason: "Invalid API key" };
      if (res.status === 404) return { success: false, reason: `Model "${model}" not found` };
      if (res.status === 429) return { success: true, reason: "" }; // Rate limited = key works
      return { success: false, reason: `API error (${res.status}): ${body.slice(0, 100)}` };
    }

    // OpenAI / custom (OpenAI-compatible)
    const baseUrl = normalizeOpenAICompatibleApiBase(apiBase) || "https://api.openai.com/v1";
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        max_tokens: 5,
        messages: [{ role: "user", content: "Say OK" }],
      }),
      signal: controller.signal,
    });
    if (res.ok) return { success: true, reason: "" };
    if (res.status === 401) return { success: false, reason: "Invalid API key" };
    if (res.status === 404)
      return { success: false, reason: `Model "${model}" not found or not accessible` };
    if (res.status === 429) return { success: true, reason: "" }; // Rate limited = key works
    const body = await res.text().catch(() => "");
    return { success: false, reason: `API error (${res.status}): ${body.slice(0, 100)}` };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, reason: "Request timed out (10s) — check your endpoint URL" };
    }
    return {
      success: false,
      reason: `Could not reach provider: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

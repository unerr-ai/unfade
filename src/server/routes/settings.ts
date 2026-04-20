// FILE: src/server/routes/settings.ts
// POST /settings/llm — update LLM provider config.
// Reads current config, merges LLM fields, writes atomically.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { UnfadeConfigSchema } from "../../schemas/config.js";
import { normalizeOpenAICompatibleApiBase } from "../../services/distill/providers/ai.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir } from "../../utils/paths.js";

export const settingsRoutes = new Hono();

const VALID_PROVIDERS = ["ollama", "openai", "anthropic", "custom", "none"] as const;

/**
 * POST /settings/llm — update distill.provider, distill.model, distill.apiKey, distill.apiBase.
 * Accepts form-encoded body (from htmx) or JSON.
 * Writes config atomically (tmp + rename), returns HTML fragment for htmx swap.
 */
settingsRoutes.post("/settings/llm", async (c) => {
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
    logger.warn("Could not read existing config, starting fresh");
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

  const providerLabel =
    provider === "none"
      ? "Structured summaries (no AI)"
      : `${provider}${model ? ` / ${model}` : ""}`;
  return c.html(
    `<div class="alert alert-ok">LLM updated to <strong>${providerLabel}</strong>. Next distill will use this provider.</div>`,
  );
});

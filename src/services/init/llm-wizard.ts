// FILE: src/services/init/llm-wizard.ts
// Interactive BYO-LLM onboarding (init step 6), aligned with unerr local setup patterns:
// explicit provider choice, then provider-specific prompts (URL, keys, models).
// Non-TTY falls back to detectLlm() + env keys without prompts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as clack from "@clack/prompts";
import { writeBlank } from "../../cli/ui.js";
import type { UnfadeConfig } from "../../schemas/config.js";
import { UnfadeConfigSchema } from "../../schemas/config.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir } from "../../utils/paths.js";
import { normalizeOpenAICompatibleApiBase } from "../distill/providers/ai.js";
import { detectLlm, pickDefaultModel } from "./llm-detect.js";

export type WizardLlmProvider = UnfadeConfig["distill"]["provider"];

export interface WizardLlmSelection {
  provider: WizardLlmProvider;
  model: string | null;
  apiKey?: string;
  apiBase?: string;
}

const DEFAULT_OLLAMA_ORIGIN = "http://localhost:11434";

function ollamaApiBaseFromOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/$/, "");
  if (trimmed.endsWith("/api")) return trimmed;
  return `${trimmed}/api`;
}

async function fetchOllamaModelNames(origin: string): Promise<string[]> {
  const base = ollamaApiBaseFromOrigin(origin).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    const models = body.models ?? [];
    return models.map((m) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

async function configureOllamaInteractive(): Promise<WizardLlmSelection | null> {
  const spin = clack.spinner();
  spin.start("Checking Ollama…");
  let origin = DEFAULT_OLLAMA_ORIGIN;
  let models = await fetchOllamaModelNames(origin);
  spin.stop(
    models.length > 0 ? `Found ${models.length} model(s) at ${origin}` : "No models at default URL",
  );

  if (models.length === 0) {
    const urlInput = await clack.text({
      message: "Ollama server URL",
      placeholder: DEFAULT_OLLAMA_ORIGIN,
      defaultValue: DEFAULT_OLLAMA_ORIGIN,
    });
    if (clack.isCancel(urlInput)) return null;
    origin = (urlInput as string).trim() || DEFAULT_OLLAMA_ORIGIN;
    const spin2 = clack.spinner();
    spin2.start("Fetching models…");
    models = await fetchOllamaModelNames(origin);
    spin2.stop(
      models.length > 0
        ? `Found ${models.length} model(s)`
        : "No models listed (you can still type a model name)",
    );
  }

  let model: string | null = null;
  if (models.length > 1) {
    const def = pickDefaultModel(models);
    const choice = await clack.select({
      message: "Model for distills",
      options: models.map((m) => ({
        value: m,
        label: m,
        hint: m === def ? "recommended" : undefined,
      })),
      initialValue: def ?? models[0],
    });
    if (clack.isCancel(choice)) return null;
    model = choice as string;
  } else if (models.length === 1) {
    model = models[0] ?? null;
    clack.log.info(`Using model ${model}`);
  } else {
    const manual = await clack.text({
      message: "Model name (as shown in `ollama list`)",
      placeholder: "llama3.2",
      defaultValue: "llama3.2",
    });
    if (clack.isCancel(manual)) return null;
    model = (manual as string).trim() || "llama3.2";
  }

  return {
    provider: "ollama",
    model,
    apiBase: ollamaApiBaseFromOrigin(origin),
  };
}

async function configureOpenAiCompatibleInteractive(): Promise<WizardLlmSelection | null> {
  const baseUrl = await clack.text({
    message: "OpenAI-compatible API base URL",
    placeholder: "https://api.fireworks.ai/inference/v1",
  });
  if (clack.isCancel(baseUrl)) return null;
  const trimmed = (baseUrl as string).trim();
  if (!trimmed) {
    clack.log.warn("Base URL required for this provider.");
    return null;
  }

  const apiKey = await clack.password({
    message: "API key (leave empty if the server does not require one)",
  });
  if (clack.isCancel(apiKey)) return null;

  const model = await clack.text({
    message: "Model name for distills",
    placeholder: "llama3",
    defaultValue: "llama3",
  });
  if (clack.isCancel(model)) return null;

  const normalized = normalizeOpenAICompatibleApiBase(trimmed) ?? trimmed;
  if (normalized !== trimmed) {
    clack.log.info(
      `Normalized base URL to ${normalized} (SDK needs the /v1 root, not …/chat/completions).`,
    );
  }

  return {
    provider: "custom",
    model: ((model as string) || "llama3").trim(),
    apiBase: normalized,
    apiKey: (apiKey as string)?.trim() || undefined,
  };
}

async function configureOpenAiInteractive(): Promise<WizardLlmSelection | null> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  const apiKeyInput = await clack.password({
    message: envKey
      ? "OpenAI API key (leave empty to use OPENAI_API_KEY from the environment)"
      : "OpenAI API key",
  });
  if (clack.isCancel(apiKeyInput)) return null;
  const apiKey = ((apiKeyInput as string) || "").trim() || envKey;
  if (!apiKey) {
    clack.log.warn("OpenAI requires an API key. Set OPENAI_API_KEY or paste a key.");
    return null;
  }

  const model = await clack.select({
    message: "Model for distills",
    options: [
      { value: "gpt-4o-mini", label: "gpt-4o-mini", hint: "fast, economical" },
      { value: "gpt-4o", label: "gpt-4o", hint: "stronger" },
      { value: "gpt-4.1-mini", label: "gpt-4.1-mini", hint: "newer mini" },
    ],
    initialValue: "gpt-4o-mini",
  });
  if (clack.isCancel(model)) return null;

  return {
    provider: "openai",
    model: model as string,
    apiKey,
    apiBase: "https://api.openai.com/v1",
  };
}

async function configureAnthropicInteractive(): Promise<WizardLlmSelection | null> {
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  const apiKeyInput = await clack.password({
    message: envKey
      ? "Anthropic API key (leave empty to use ANTHROPIC_API_KEY from the environment)"
      : "Anthropic API key",
  });
  if (clack.isCancel(apiKeyInput)) return null;
  const apiKey = ((apiKeyInput as string) || "").trim() || envKey;
  if (!apiKey) {
    clack.log.warn("Anthropic requires an API key. Set ANTHROPIC_API_KEY or paste a key.");
    return null;
  }

  const model = await clack.select({
    message: "Model for distills",
    options: [
      {
        value: "claude-haiku-4-5-20251001",
        label: "Claude Haiku 4.5",
        hint: "fast",
      },
      {
        value: "claude-sonnet-4-20250514",
        label: "Claude Sonnet 4",
        hint: "balanced",
      },
    ],
    initialValue: "claude-haiku-4-5-20251001",
  });
  if (clack.isCancel(model)) return null;

  return {
    provider: "anthropic",
    model: model as string,
    apiKey,
  };
}

function selectionFromDetection(): WizardLlmSelection {
  const d = detectLlm();
  if (d.provider === "openai") {
    return {
      provider: "openai",
      model: d.model,
      apiKey: process.env.OPENAI_API_KEY,
      apiBase: "https://api.openai.com/v1",
    };
  }
  if (d.provider === "anthropic") {
    return {
      provider: "anthropic",
      model: d.model,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (d.provider === "ollama") {
    return {
      provider: "ollama",
      model: d.model,
      apiBase: ollamaApiBaseFromOrigin(DEFAULT_OLLAMA_ORIGIN),
    };
  }
  return { provider: "none", model: null };
}

/**
 * Full interactive LLM onboarding (TTY). Always lists all provider types like unerr local setup.
 */
export async function runInteractiveLlmOnboarding(_cwd: string): Promise<WizardLlmSelection> {
  if (!process.stderr.isTTY) {
    return selectionFromDetection();
  }

  writeBlank();
  clack.log.step("LLM for distills");

  const providerResult = await clack.select({
    message: "How should Unfade run AI distills?",
    options: [
      { value: "ollama" as const, label: "Ollama (local)", hint: "Free, on your machine" },
      {
        value: "custom" as const,
        label: "OpenAI-compatible API",
        hint: "LM Studio, vLLM, LiteLLM, Groq /v1, …",
      },
      { value: "openai" as const, label: "OpenAI", hint: "Hosted OpenAI API" },
      { value: "anthropic" as const, label: "Anthropic", hint: "Claude API" },
      {
        value: "none" as const,
        label: "Skip for now",
        hint: "Structured summaries only — add an LLM later in Settings",
      },
    ],
  });

  if (clack.isCancel(providerResult)) {
    clack.log.warn("Using automatic detection from your environment.");
    return selectionFromDetection();
  }

  const provider = providerResult as WizardLlmProvider;

  if (provider === "none") {
    return { provider: "none", model: null };
  }

  let detail: WizardLlmSelection | null = null;
  if (provider === "ollama") detail = await configureOllamaInteractive();
  else if (provider === "custom") detail = await configureOpenAiCompatibleInteractive();
  else if (provider === "openai") detail = await configureOpenAiInteractive();
  else if (provider === "anthropic") detail = await configureAnthropicInteractive();

  if (detail === null) {
    clack.log.warn(
      "Setup incomplete — using structured summaries until you configure an LLM in Settings.",
    );
    return { provider: "none", model: null };
  }

  return detail;
}

/**
 * Merge LLM fields into `.unfade/config.json` and validate with Zod.
 */
export function applyWizardSelectionToConfig(cwd: string, sel: WizardLlmSelection): void {
  const configPath = join(getProjectDataDir(cwd), "config.json");
  const defaults = UnfadeConfigSchema.parse({});
  let base = defaults;
  if (existsSync(configPath)) {
    try {
      base = UnfadeConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf-8")));
    } catch {
      logger.debug("Could not parse config, applying defaults + LLM selection");
    }
  }

  const distill = { ...base.distill };
  distill.provider = sel.provider;

  if (sel.provider === "none") {
    distill.model = defaults.distill.model;
    delete distill.apiKey;
    delete distill.apiBase;
  } else {
    if (sel.model) distill.model = sel.model;
    if (sel.provider === "ollama") {
      delete distill.apiKey;
      if (sel.apiBase) distill.apiBase = sel.apiBase;
      else delete distill.apiBase;
    } else if (
      sel.provider === "openai" ||
      sel.provider === "anthropic" ||
      sel.provider === "custom"
    ) {
      if (sel.apiKey) distill.apiKey = sel.apiKey;
      else delete distill.apiKey;
      if (sel.apiBase) distill.apiBase = sel.apiBase;
      else delete distill.apiBase;
    }
  }

  const next = { ...base, distill };
  UnfadeConfigSchema.parse(next);
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

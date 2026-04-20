// FILE: src/services/init/llm-detect.ts
// Step 6 of init: detect available LLM providers.
// Tries Ollama first, checks for API keys in env, falls back to "none".

import { execSync } from "node:child_process";
import { logger } from "../../utils/logger.js";

export type LlmProvider = "ollama" | "openai" | "anthropic" | "none";

export interface LlmDetectResult {
  provider: LlmProvider;
  model: string | null;
  ollamaModels: string[];
  availableProviders: LlmProvider[];
}

/**
 * Try to detect Ollama by running `ollama list`.
 * Returns available model names, or empty array if Ollama isn't available.
 */
function tryOllamaList(): string[] {
  try {
    const output = execSync("ollama list", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });

    const lines = output.trim().split("\n").slice(1);
    const models: string[] = [];

    for (const line of lines) {
      const name = line.trim().split(/\s+/)[0];
      if (name) models.push(name);
    }

    return models;
  } catch {
    return [];
  }
}

/**
 * Pick the best default model from available Ollama models.
 * Prefers llama3.2, then llama3.1, then any llama, then first available.
 */
export function pickDefaultModel(models: string[]): string | null {
  if (models.length === 0) return null;

  const preferences = ["llama3.2", "llama3.1", "llama3", "llama2", "mistral", "gemma"];

  for (const pref of preferences) {
    const match = models.find((m) => m.startsWith(pref));
    if (match) return match;
  }

  return models[0];
}

/**
 * Detect all available LLM providers and pick the best default.
 */
export function detectLlm(): LlmDetectResult {
  const ollamaModels = tryOllamaList();
  const availableProviders: LlmProvider[] = [];

  if (ollamaModels.length > 0) {
    availableProviders.push("ollama");
  }
  if (process.env.OPENAI_API_KEY) {
    availableProviders.push("openai");
  }
  if (process.env.ANTHROPIC_API_KEY) {
    availableProviders.push("anthropic");
  }

  // Pick best default: ollama > openai > anthropic > none
  if (ollamaModels.length > 0) {
    const model = pickDefaultModel(ollamaModels);
    logger.debug("Detected Ollama", { models: ollamaModels.length, selected: model });
    return { provider: "ollama", model, ollamaModels, availableProviders };
  }

  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", model: "gpt-4o-mini", ollamaModels, availableProviders };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      ollamaModels,
      availableProviders,
    };
  }

  logger.debug("No LLM detected, using structured summaries mode");
  return { provider: "none", model: null, ollamaModels, availableProviders };
}

// FILE: src/services/init/llm-detect.ts
// Step 6 of init: silently detect available LLM provider.
// Tries Ollama first (ollama list), falls back to "none" (structured summaries).
// NEVER prompts for API keys.

import { execSync } from "node:child_process";
import { logger } from "../../utils/logger.js";

export interface LlmDetectResult {
  provider: "ollama" | "none";
  model: string | null;
  ollamaModels: string[];
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

    // Parse output: first line is headers, remaining lines are models.
    // Format: NAME ID SIZE MODIFIED
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
function pickDefaultModel(models: string[]): string | null {
  if (models.length === 0) return null;

  const preferences = ["llama3.2", "llama3.1", "llama3", "llama2", "mistral", "gemma"];

  for (const pref of preferences) {
    const match = models.find((m) => m.startsWith(pref));
    if (match) return match;
  }

  return models[0];
}

/**
 * Silently detect the best available LLM provider.
 * Returns "ollama" with model name if available, "none" otherwise.
 * NEVER prompts for API keys or configuration.
 */
export function detectLlm(): LlmDetectResult {
  const ollamaModels = tryOllamaList();

  if (ollamaModels.length > 0) {
    const model = pickDefaultModel(ollamaModels);
    logger.debug("Detected Ollama", { models: ollamaModels.length, selected: model });
    return { provider: "ollama", model, ollamaModels };
  }

  logger.debug("No LLM detected, using structured summaries mode");
  return { provider: "none", model: null, ollamaModels: [] };
}

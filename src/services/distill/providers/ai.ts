// FILE: src/services/distill/providers/ai.ts
// UF-029: LLM integration via Vercel AI SDK.
// Provider adapters for ollama (default), openai, anthropic.
// Ollama readiness check: 3-step (version API → model list → test prompt with 5s timeout).

import type { LanguageModel } from "ai";
import type { UnfadeConfig } from "../../../schemas/config.js";
import { logger } from "../../../utils/logger.js";

export interface LLMProviderResult {
  model: LanguageModel;
  provider: string;
  modelName: string;
}

export interface OllamaReadyResult {
  ready: boolean;
  reason?: string;
}

/**
 * `checkOllamaReady` expects a host origin (no `/api` suffix); config often stores `…/api` for the SDK.
 */
export function normalizeOllamaOriginForChecks(apiBase?: string): string {
  const raw = (apiBase ?? "").trim() || "http://localhost:11434";
  let u = raw.replace(/\/$/, "");
  if (u.endsWith("/api")) {
    u = u.slice(0, -4).replace(/\/$/, "");
  }
  return u || "http://localhost:11434";
}

/**
 * Normalize user-entered OpenAI-compatible `baseURL` for `@ai-sdk/openai`.
 * People often paste the full chat-completions URL; the SDK appends route segments
 * itself, so a trailing `/v1/chat/completions` becomes invalid nested paths
 * (e.g. `.../chat/completions/responses`).
 */
export function normalizeOpenAICompatibleApiBase(raw?: string): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  let u = s.replace(/\/+$/, "");
  u = u.replace(/\/v1\/chat\/completions\/?$/i, "/v1");
  u = u.replace(/\/chat\/completions\/?$/i, "");
  u = u.replace(/\/+$/, "");
  return u || undefined;
}

/**
 * Create an LLM provider from config.
 * Returns null if provider is "none".
 */
export async function createLLMProvider(config: UnfadeConfig): Promise<LLMProviderResult | null> {
  const providerName = config.distill.provider;
  const modelName = config.distill.model;

  if (providerName === "none") return null;

  switch (providerName) {
    case "ollama": {
      const { createOllama } = await import("ollama-ai-provider");
      const ollama = createOllama({
        baseURL: config.distill.apiBase ?? "http://localhost:11434/api",
      });
      // ollama-ai-provider returns LanguageModelV1; ai@6 generateText()
      // accepts V1 at runtime via backward-compat shim.
      return {
        model: ollama(modelName) as unknown as LanguageModel,
        provider: "ollama",
        modelName,
      };
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const baseURL =
        normalizeOpenAICompatibleApiBase(config.distill.apiBase) ?? config.distill.apiBase;
      const openai = createOpenAI({
        apiKey: config.distill.apiKey,
        baseURL,
      });
      return {
        model: openai(modelName),
        provider: "openai",
        modelName,
      };
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({
        apiKey: config.distill.apiKey,
        baseURL: config.distill.apiBase,
      });
      return {
        model: anthropic(modelName),
        provider: "anthropic",
        modelName,
      };
    }
    case "custom": {
      // Custom provider uses OpenAI-compatible API with custom base URL
      const { createOpenAI } = await import("@ai-sdk/openai");
      const baseURL =
        normalizeOpenAICompatibleApiBase(config.distill.apiBase) ?? config.distill.apiBase;
      const custom = createOpenAI({
        apiKey: config.distill.apiKey,
        baseURL,
      });
      return {
        model: custom(modelName),
        provider: "custom",
        modelName,
      };
    }
    default:
      logger.warn("Unknown LLM provider", { provider: providerName });
      return null;
  }
}

/**
 * 3-step Ollama readiness check.
 * 1. GET /api/version — is Ollama running?
 * 2. GET /api/tags — is a model available?
 * 3. POST /api/generate with trivial prompt + 5s timeout — is it responsive?
 *
 * All failures return { ready: false, reason: '...' }.
 */
export async function checkOllamaReady(
  baseUrlOrApiBase = "http://localhost:11434",
  modelName = "llama3.2",
): Promise<OllamaReadyResult> {
  const baseUrl = normalizeOllamaOriginForChecks(baseUrlOrApiBase);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    // Step 1: Version check
    const versionRes = await fetch(`${baseUrl}/api/version`, {
      signal: controller.signal,
    });
    if (!versionRes.ok) {
      return { ready: false, reason: `Ollama not responding (HTTP ${versionRes.status})` };
    }

    // Step 2: Model list check
    const tagsRes = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    if (!tagsRes.ok) {
      return { ready: false, reason: "Failed to list Ollama models" };
    }
    const tags = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    const models = tags.models ?? [];
    const hasModel = models.some((m) => m.name === modelName || m.name.startsWith(`${modelName}:`));
    if (!hasModel) {
      return {
        ready: false,
        reason: `Model "${modelName}" not found. Available: ${models.map((m) => m.name).join(", ") || "none"}`,
      };
    }

    // Step 3: Test prompt
    const genRes = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        prompt: "Say OK",
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!genRes.ok) {
      return { ready: false, reason: `Model test failed (HTTP ${genRes.status})` };
    }

    return { ready: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ready: false, reason: "Ollama check timed out (5s)" };
    }
    return {
      ready: false,
      reason: `Ollama not reachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

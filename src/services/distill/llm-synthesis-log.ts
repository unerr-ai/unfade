// FILE: src/services/distill/llm-synthesis-log.ts
// Append-only NDJSON log under `.unfade/logs/llm-synthesis.jsonl` for debugging
// LLM distill failures. Never stores API keys or full prompts (size + privacy).

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getLogsDir } from "../../utils/paths.js";

const LOG_FILE = "llm-synthesis.jsonl";
const SNIPPET_CHARS = 1800;

export type LlmSynthLogPhase = "start" | "success" | "error";

export interface LlmSynthLogEntry {
  ts: string;
  phase: LlmSynthLogPhase;
  /** Distill calendar date (YYYY-MM-DD). */
  date: string;
  provider?: string;
  modelName?: string;
  promptChars?: number;
  errorName?: string;
  errorMessage?: string;
  causeName?: string;
  causeMessage?: string;
  finishReason?: string;
  textLength?: number;
  textHead?: string;
  textTail?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  warnings?: string[];
  /** When the HTTP layer failed (e.g. APICallError — "Invalid JSON response"). */
  httpStatus?: number;
  httpUrl?: string;
  responseBodyHead?: string;
  /** Always `portable_json`: text completion + local JSON extract + Zod (provider-agnostic). */
  synthesisMode?: "portable_json";
  retryReason?: string;
  zodSummary?: string;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated, len=${s.length}]`;
}

/**
 * Append one JSON line to `.unfade/logs/llm-synthesis.jsonl`. Best-effort only.
 */
export function appendLlmSynthLog(entry: LlmSynthLogEntry, cwd?: string): void {
  try {
    const dir = getLogsDir(cwd);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, LOG_FILE), `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // ignore logging failures
  }
}

/** Safe excerpts of model text for logs (middle dropped when very long). */
export function textSnippetsForLog(text: string | undefined): {
  textLength?: number;
  textHead?: string;
  textTail?: string;
} {
  if (text == null || text.length === 0) return {};
  const n = text.length;
  if (n <= SNIPPET_CHARS * 2) {
    return { textLength: n, textHead: clip(text, SNIPPET_CHARS * 2) };
  }
  return {
    textLength: n,
    textHead: clip(text.slice(0, SNIPPET_CHARS), SNIPPET_CHARS),
    textTail: clip(text.slice(-SNIPPET_CHARS), SNIPPET_CHARS),
  };
}

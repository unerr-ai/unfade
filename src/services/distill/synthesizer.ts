// FILE: src/services/distill/synthesizer.ts
// UF-034 + UF-039: Stage 3 — Synthesizer.
//
// LLM path (all providers): plain `generateText` — no provider-specific response_format.
// We rely on the lowest common denominator (assistant text), then extract JSON + validate
// with `DailyDistillSchema`. Same contract for OpenAI, Anthropic, Ollama, and OpenAI-compatible
// gateways (Fireworks, LM Studio, vLLM, etc.). API-native structured outputs vary too much
// across hosts; Zod is the single source of truth for shape.
//
// Diagnostics: `.unfade/logs/llm-synthesis.jsonl` (NDJSON, no secrets).

import { APICallError, generateText, RetryError } from "ai";
import {
  type DailyDistill,
  DailyDistillSchema,
  type LinkedSignals,
} from "../../schemas/distill.js";
import { logger } from "../../utils/logger.js";
import {
  appendLlmSynthLog,
  type LlmSynthLogEntry,
  textSnippetsForLog,
} from "./llm-synthesis-log.js";
import type { LLMProviderResult } from "./providers/ai.js";

export interface SynthesizeOptions {
  /** Git / project cwd — used to resolve `.unfade/logs/llm-synthesis.jsonl`. */
  cwd?: string;
}

const SYNTHESIS_MODE = "portable_json" as const;

/** Thrown when the model reply is not extractable/parseable JSON (includes raw text for logs). */
export class DistillAssistantParseError extends Error {
  readonly assistantText: string;
  constructor(message: string, assistantText: string) {
    super(message);
    this.name = "DistillAssistantParseError";
    this.assistantText = assistantText;
  }
}

/** Thrown when JSON parses but fails `DailyDistillSchema` (includes raw text for logs). */
export class DistillAssistantSchemaError extends Error {
  readonly assistantText: string;
  constructor(message: string, assistantText: string) {
    super(message);
    this.name = "DistillAssistantSchemaError";
    this.assistantText = assistantText;
  }
}

/**
 * Strip markdown fences and isolate the outermost `{ ... }` for JSON.parse.
 * Exported for unit tests.
 */
export function extractFirstJsonObjectFromModelText(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/im;
  const m = s.match(fence);
  if (m) {
    s = m[1].trim();
  }
  const start = s.indexOf("{");
  if (start === -1) {
    throw new SyntaxError("No JSON object start '{' found in model output");
  }
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  throw new SyntaxError("Unbalanced braces in model JSON");
}

function distillSystemPromptPortable(): string {
  return [
    "You are Unfade's distillation engine.",
    "Reply with exactly one JSON object and nothing else — no markdown code fences, no preamble or postscript.",
    "The object must be valid JSON (double-quoted keys and strings).",
    "Required keys: date (string YYYY-MM-DD), summary (string), decisions (array of { decision: string, rationale: string, optional domain string, optional alternativesConsidered integer }), eventsProcessed (integer).",
    "Optional keys: tradeOffs, deadEnds, breakthroughs, patterns (string[]), themes (string[]), domains (string[]), synthesizedBy (string; use llm if you set it).",
    "Use only the user message for factual content; do not invent events that are not supported by those signals.",
  ].join(" ");
}

function synthesizeErrorFields(err: unknown): Partial<LlmSynthLogEntry> {
  if (RetryError.isInstance(err)) {
    const nested = synthesizeErrorFields(err.lastError);
    return {
      errorName: err.name,
      errorMessage: err.message,
      retryReason: err.reason,
      ...nested,
    };
  }
  if (APICallError.isInstance(err)) {
    const snip = textSnippetsForLog(err.responseBody);
    return {
      errorName: err.name,
      errorMessage: err.message,
      httpStatus: err.statusCode,
      httpUrl: err.url,
      responseBodyHead: snip.textHead,
      textLength: snip.textLength,
      causeName: err.cause instanceof Error ? err.cause.name : undefined,
      causeMessage: err.cause instanceof Error ? err.cause.message : undefined,
    };
  }
  if (err instanceof DistillAssistantParseError || err instanceof DistillAssistantSchemaError) {
    return {
      errorName: err.name,
      errorMessage: err.message,
      ...textSnippetsForLog(err.assistantText),
    };
  }
  if (err instanceof Error) {
    const base = {
      errorName: err.name,
      errorMessage: err.message,
      causeName: err.cause instanceof Error ? err.cause.name : undefined,
      causeMessage: err.cause instanceof Error ? err.cause.message : undefined,
    };
    if (err.message.startsWith("Distill schema validation")) {
      return { ...base, zodSummary: err.message.slice(0, 800) };
    }
    return base;
  }
  return { errorMessage: String(err) };
}

/**
 * Synthesize linked signals into a DailyDistill.
 * Uses LLM if provider is given, otherwise falls back to structured summary.
 */
export async function synthesize(
  linked: LinkedSignals,
  provider?: LLMProviderResult | null,
  options?: SynthesizeOptions,
): Promise<DailyDistill> {
  if (provider) {
    const promptChars = buildLLMPrompt(linked).length;
    try {
      return await synthesizeWithLLM(linked, provider, options?.cwd);
    } catch (err) {
      appendLlmSynthLog(
        {
          ts: new Date().toISOString(),
          phase: "error",
          date: linked.date,
          provider: provider.provider,
          modelName: provider.modelName,
          promptChars,
          synthesisMode: SYNTHESIS_MODE,
          ...synthesizeErrorFields(err),
        },
        options?.cwd,
      );
      logger.warn("LLM synthesis failed, falling back to structured summary", {
        error: err instanceof Error ? err.message : String(err),
      });
      return synthesizeFallback(linked);
    }
  }
  return synthesizeFallback(linked);
}

/**
 * One code path for every LLM provider: text completion → extract JSON → Zod.
 */
async function synthesizeWithLLM(
  linked: LinkedSignals,
  provider: LLMProviderResult,
  cwd?: string,
): Promise<DailyDistill> {
  const prompt = buildLLMPrompt(linked);

  appendLlmSynthLog(
    {
      ts: new Date().toISOString(),
      phase: "start",
      date: linked.date,
      provider: provider.provider,
      modelName: provider.modelName,
      promptChars: prompt.length,
      synthesisMode: SYNTHESIS_MODE,
    },
    cwd,
  );

  const result = await generateText({
    model: provider.model,
    system: distillSystemPromptPortable(),
    prompt,
    temperature: 0,
    maxOutputTokens: 16_384,
    maxRetries: 2,
  });

  let raw: unknown;
  try {
    const jsonSlice = extractFirstJsonObjectFromModelText(result.text);
    raw = JSON.parse(jsonSlice) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new DistillAssistantParseError(
      `Could not parse model output as JSON: ${msg}`,
      result.text,
    );
  }

  const parsed = DailyDistillSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DistillAssistantSchemaError(
      `Distill schema validation failed: ${parsed.error.message.slice(0, 1200)}`,
      result.text,
    );
  }

  appendLlmSynthLog(
    {
      ts: new Date().toISOString(),
      phase: "success",
      date: linked.date,
      provider: provider.provider,
      modelName: provider.modelName,
      promptChars: prompt.length,
      synthesisMode: SYNTHESIS_MODE,
      finishReason: result.finishReason,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          }
        : undefined,
      warnings: result.warnings?.map((w) => JSON.stringify(w)),
    },
    cwd,
  );

  return {
    ...parsed.data,
    date: linked.date,
    eventsProcessed: linked.stats.totalEvents,
    synthesizedBy: "llm",
  };
}

/**
 * Build the LLM prompt from linked signals.
 */
function buildLLMPrompt(linked: LinkedSignals): string {
  const sections: string[] = [
    `You are analyzing a developer's engineering activity for ${linked.date}.`,
    `Generate a Daily Distill — a concise reasoning summary that captures decisions, trade-offs, dead ends, breakthroughs, and patterns.`,
    "",
    `## Raw Signals`,
    "",
    `### Commits (${linked.decisions.length})`,
  ];

  for (const d of linked.decisions) {
    const files = d.files?.join(", ") ?? "no files";
    const alts = d.alternativesCount > 0 ? ` (${d.alternativesCount} alternative branches)` : "";
    sections.push(`- ${d.summary} [${d.branch ?? "unknown branch"}] files: ${files}${alts}`);
  }

  if (linked.tradeOffs.length > 0) {
    sections.push("", `### AI Rejections / Trade-offs (${linked.tradeOffs.length})`);
    for (const t of linked.tradeOffs) {
      sections.push(`- ${t.summary} files: ${t.relatedFiles?.join(", ") ?? "none"}`);
    }
  }

  if (linked.deadEnds.length > 0) {
    sections.push("", `### Reverts / Dead Ends (${linked.deadEnds.length})`);
    for (const d of linked.deadEnds) {
      const time = d.timeSpentMinutes ? ` (~${d.timeSpentMinutes} min spent)` : "";
      sections.push(`- ${d.summary}${time}`);
    }
  }

  if (linked.temporalChains.length > 0) {
    sections.push("", `### Temporal Chains`);
    for (const c of linked.temporalChains) {
      sections.push(`- ${c.module}: ${c.summary}`);
    }
  }

  sections.push(
    "",
    `### Stats`,
    `- Total events: ${linked.stats.totalEvents}`,
    `- Commits: ${linked.stats.commitCount}`,
    `- AI completions: ${linked.stats.aiCompletions}`,
    `- AI rejections: ${linked.stats.aiRejections}`,
    `- Branch switches: ${linked.stats.branchSwitches}`,
    `- Files changed: ${linked.stats.filesChanged.length}`,
    `- Domains: ${linked.stats.domains.join(", ") || "none"}`,
  );

  if (linked.stats.aiAcceptanceRate !== undefined) {
    sections.push(`- AI acceptance rate: ${(linked.stats.aiAcceptanceRate * 100).toFixed(0)}%`);
  }

  sections.push(
    "",
    `## Instructions`,
    `- Write a concise summary (2-3 sentences) of the day's engineering work`,
    `- Extract key decisions with rationale (why this approach, not just what)`,
    `- Identify trade-offs where the developer chose one approach over another`,
    `- Flag dead ends — work that was reverted or abandoned, with estimated time spent`,
    `- Note breakthroughs — moments of significant progress`,
    `- Identify recurring patterns across the day's work`,
    `- Use the developer's own words from commit messages where possible`,
    `- Be specific — reference actual files and branches, not generic summaries`,
  );

  return sections.join("\n");
}

/**
 * Fallback synthesizer — UF-039.
 * Produces valid DailyDistill without LLM.
 * Structured signal summary: decision count, file list, domain tags,
 * time estimates, AI acceptance rate.
 */
export function synthesizeFallback(linked: LinkedSignals): DailyDistill {
  const { stats } = linked;

  // Build summary from stats
  const summaryParts: string[] = [];
  if (stats.commitCount > 0) {
    summaryParts.push(`${stats.commitCount} commit${stats.commitCount !== 1 ? "s" : ""}`);
  }
  if (stats.branchSwitches > 0) {
    summaryParts.push(
      `${stats.branchSwitches} branch switch${stats.branchSwitches !== 1 ? "es" : ""}`,
    );
  }
  if (stats.aiCompletions + stats.aiRejections > 0) {
    summaryParts.push(
      `${stats.aiCompletions + stats.aiRejections} AI interaction${stats.aiCompletions + stats.aiRejections !== 1 ? "s" : ""}`,
    );
  }
  if (stats.domains.length > 0) {
    summaryParts.push(`across ${stats.domains.join(", ")}`);
  }

  const summary =
    summaryParts.length > 0
      ? `Engineering activity on ${linked.date}: ${summaryParts.join(", ")}.`
      : `No significant activity on ${linked.date}.`;

  // Map linked decisions → DailyDistill decisions
  const decisions = linked.decisions.map((d) => ({
    decision: d.summary,
    rationale: d.branch ? `On branch ${d.branch}` : "From git history",
    domain: d.branch ? domainFromBranch(d.branch) : undefined,
    alternativesConsidered: d.alternativesCount > 0 ? d.alternativesCount : undefined,
  }));

  // Map trade-offs
  const tradeOffs =
    linked.tradeOffs.length > 0
      ? linked.tradeOffs.map((t) => ({
          tradeOff: t.summary,
          chose: "Developer's approach",
          rejected: "AI suggestion",
          context: t.relatedFiles?.join(", "),
        }))
      : undefined;

  // Map dead ends
  const deadEnds =
    linked.deadEnds.length > 0
      ? linked.deadEnds.map((d) => ({
          description: d.summary,
          timeSpentMinutes: d.timeSpentMinutes,
          resolution: "Reverted",
        }))
      : undefined;

  // Map breakthroughs
  const breakthroughs =
    linked.breakthroughs.length > 0
      ? linked.breakthroughs.map((b) => ({
          description: b.summary,
          trigger: b.triggeredBy,
        }))
      : undefined;

  // Patterns from temporal chains
  const patterns =
    linked.temporalChains.length > 0
      ? linked.temporalChains.map(
          (c) => `Focused work on ${c.module} (${c.eventIds.length} commits)`,
        )
      : undefined;

  // Acceptance rate as a pattern
  if (stats.aiAcceptanceRate !== undefined) {
    const rate = `AI acceptance rate: ${(stats.aiAcceptanceRate * 100).toFixed(0)}%`;
    if (patterns) {
      patterns.push(rate);
    }
  }

  return {
    date: linked.date,
    summary,
    decisions,
    tradeOffs,
    deadEnds,
    breakthroughs,
    patterns,
    eventsProcessed: stats.totalEvents,
    themes: stats.domains.length > 0 ? stats.domains : undefined,
    domains: stats.domains.length > 0 ? stats.domains : undefined,
    synthesizedBy: "fallback",
  };
}

function domainFromBranch(branch: string): string | undefined {
  const lower = branch.toLowerCase();
  if (lower.includes("feat")) return "feature";
  if (lower.includes("fix") || lower.includes("bug")) return "bugfix";
  if (lower.includes("refactor")) return "refactoring";
  if (lower.includes("test")) return "testing";
  if (lower.includes("doc")) return "documentation";
  if (lower.includes("ci") || lower.includes("deploy")) return "infrastructure";
  return undefined;
}

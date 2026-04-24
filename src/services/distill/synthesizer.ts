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
import { KNOWN_MODEL_DEFAULTS, MIN_CONTEXT_WINDOW } from "../../schemas/config.js";
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

export interface ModelLimits {
  contextWindow?: number;
  maxOutputTokens?: number;
  maxPromptChars?: number;
  rpm?: number;
  tpm?: number;
}

export interface SynthesizeOptions {
  /** Git / project cwd — used to resolve `.unfade/logs/llm-synthesis.jsonl`. */
  cwd?: string;
  /** Model-specific limits. Auto-detected if not provided. */
  modelLimits?: ModelLimits;
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
      return await synthesizeWithLLM(linked, provider, options?.cwd, options);
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
  options?: SynthesizeOptions,
): Promise<DailyDistill> {
  const limits = resolveModelLimits(provider.modelName, options?.modelLimits);
  const maxOutput = limits.maxOutputTokens ?? 16_384;
  const prompt = buildLLMPrompt(linked, limits);

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

  logger.debug("LLM synthesis prompt built", {
    promptChars: prompt.length,
    maxPromptChars: resolveMaxPromptChars(limits),
    modelName: provider.modelName,
    maxOutputTokens: maxOutput,
  });

  const result = await generateText({
    model: provider.model,
    system: distillSystemPromptPortable(),
    prompt,
    temperature: 0,
    maxOutputTokens: maxOutput,
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
 * Default maximum prompt size in characters, derived from MIN_CONTEXT_WINDOW.
 * All LLM operations assume at least 128K context — this lets us batch aggressively
 * and avoid per-model prompt splitting logic.
 */
const DEFAULT_MAX_PROMPT_CHARS = MIN_CONTEXT_WINDOW * 4 - 16_384 * 4 - 2000; // ~446K chars

/**
 * Resolve effective prompt char limit from model limits config.
 * Priority: explicit maxPromptChars > derived from contextWindow > default (128K-floor).
 * Context window is floored at MIN_CONTEXT_WINDOW — models below 128K are not supported.
 */
function resolveMaxPromptChars(limits?: ModelLimits): number {
  if (limits?.maxPromptChars) return limits.maxPromptChars;
  const contextWindow = Math.max(limits?.contextWindow ?? MIN_CONTEXT_WINDOW, MIN_CONTEXT_WINDOW);
  const outputReserve = (limits?.maxOutputTokens ?? 4096) * 4;
  const systemOverhead = 2000; // system prompt chars
  return Math.max(5000, contextWindow * 4 - outputReserve - systemOverhead);
}

/**
 * Resolve model limits: explicit config > known model defaults > empty.
 */
function resolveModelLimits(modelName: string, explicit?: ModelLimits): ModelLimits {
  const known = KNOWN_MODEL_DEFAULTS[modelName] ?? {};
  return { ...known, ...explicit };
}

/**
 * Truncate a file list to fit within a character budget.
 */
function truncateFiles(files: string[] | undefined, maxFiles: number): string {
  if (!files || files.length === 0) return "no files";
  if (files.length <= maxFiles) return files.join(", ");
  return `${files.slice(0, maxFiles).join(", ")} (+${files.length - maxFiles} more)`;
}

/**
 * Build the LLM prompt from linked signals, with truncation to stay within model limits.
 * Prioritizes: recent commits > trade-offs > dead ends > temporal chains.
 * Signals are trimmed proportionally when total exceeds the model's prompt char limit.
 */
function buildLLMPrompt(linked: LinkedSignals, limits?: ModelLimits): string {
  const MAX_PROMPT_CHARS = resolveMaxPromptChars(limits);
  const header = [
    `You are analyzing a developer's engineering activity for ${linked.date}.`,
    `Generate a Daily Distill — a concise reasoning summary that captures decisions, trade-offs, dead ends, breakthroughs, and patterns.`,
    "",
    `## Raw Signals`,
  ].join("\n");

  const instructions = [
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
  ].join("\n");

  const stats = [
    "",
    `### Stats`,
    `- Total events: ${linked.stats.totalEvents}`,
    `- Commits: ${linked.stats.commitCount}`,
    `- AI completions: ${linked.stats.aiCompletions}`,
    `- AI rejections: ${linked.stats.aiRejections}`,
    `- Branch switches: ${linked.stats.branchSwitches}`,
    `- Files changed: ${linked.stats.filesChanged.length}`,
    `- Domains: ${linked.stats.domains.join(", ") || "none"}`,
    ...(linked.stats.aiAcceptanceRate !== undefined
      ? [`- AI acceptance rate: ${(linked.stats.aiAcceptanceRate * 100).toFixed(0)}%`]
      : []),
  ].join("\n");

  // Fixed overhead: header + stats + instructions
  const fixedLen = header.length + stats.length + instructions.length + 20; // padding
  const budget = MAX_PROMPT_CHARS - fixedLen;

  // Build signal sections with budget allocation:
  // commits 50%, trade-offs 25%, dead ends 15%, temporal chains 10%
  const commitBudget = Math.floor(budget * 0.5);
  const tradeOffBudget = Math.floor(budget * 0.25);
  const deadEndBudget = Math.floor(budget * 0.15);
  const chainBudget = Math.floor(budget * 0.1);

  const commitLines = buildCommitSection(linked.decisions, commitBudget);
  const tradeOffLines = buildTradeOffSection(linked.tradeOffs, tradeOffBudget);
  const deadEndLines = buildDeadEndSection(linked.deadEnds, deadEndBudget);
  const chainLines = buildChainSection(linked.temporalChains, chainBudget);

  const sections = [
    header,
    commitLines,
    tradeOffLines,
    deadEndLines,
    chainLines,
    stats,
    instructions,
  ]
    .filter(Boolean)
    .join("\n");

  if (sections.length > MAX_PROMPT_CHARS) {
    logger.debug("Prompt still over budget after truncation, hard-trimming", {
      length: sections.length,
      max: MAX_PROMPT_CHARS,
    });
    return sections.slice(0, MAX_PROMPT_CHARS);
  }

  return sections;
}

function buildCommitSection(decisions: LinkedSignals["decisions"], budget: number): string {
  if (decisions.length === 0) return `\n### Commits (0)\n(none)`;

  const lines: string[] = [``, `### Commits (${decisions.length})`];
  let used = lines.join("\n").length;

  for (const d of decisions) {
    const files = truncateFiles(d.files, 5);
    const alts = d.alternativesCount > 0 ? ` (${d.alternativesCount} alternatives)` : "";
    const line = `- ${d.summary} [${d.branch ?? "unknown"}] files: ${files}${alts}`;
    if (used + line.length + 1 > budget) {
      const remaining = decisions.length - lines.length + 2;
      if (remaining > 0) lines.push(`  ... and ${remaining} more commits (truncated for size)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function buildTradeOffSection(tradeOffs: LinkedSignals["tradeOffs"], budget: number): string {
  if (tradeOffs.length === 0) return "";

  const lines: string[] = [``, `### AI Rejections / Trade-offs (${tradeOffs.length})`];
  let used = lines.join("\n").length;

  for (const t of tradeOffs) {
    const line = `- ${t.summary} files: ${truncateFiles(t.relatedFiles, 3)}`;
    if (used + line.length + 1 > budget) {
      lines.push(`  ... and ${tradeOffs.length - lines.length + 2} more (truncated)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function buildDeadEndSection(deadEnds: LinkedSignals["deadEnds"], budget: number): string {
  if (deadEnds.length === 0) return "";

  const lines: string[] = [``, `### Reverts / Dead Ends (${deadEnds.length})`];
  let used = lines.join("\n").length;

  for (const d of deadEnds) {
    const time = d.timeSpentMinutes ? ` (~${d.timeSpentMinutes} min)` : "";
    const line = `- ${d.summary}${time}`;
    if (used + line.length + 1 > budget) {
      lines.push(`  ... and ${deadEnds.length - lines.length + 2} more (truncated)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function buildChainSection(chains: LinkedSignals["temporalChains"], budget: number): string {
  if (chains.length === 0) return "";

  const lines: string[] = [``, `### Temporal Chains`];
  let used = lines.join("\n").length;

  for (const c of chains) {
    const line = `- ${c.module}: ${c.summary}`;
    if (used + line.length + 1 > budget) {
      lines.push(`  ... and ${chains.length - lines.length + 2} more (truncated)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
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

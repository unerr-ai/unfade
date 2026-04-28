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
  type ConversationDigest,
  type DailyDistill,
  DailyDistillSchema,
  type LinkedSignals,
} from "../../schemas/distill.js";
import { logger } from "../../utils/logger.js";
import { deduplicateFinalDecisions, looksLikeDecision } from "./conversation-digester.js";
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
  /** Pre-digested conversation extracts (Stage 1.5 output). */
  conversationDigests?: Map<string, ConversationDigest>;
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
  return `You are Unfade's reasoning distillation engine. Your job is to transform a day's raw engineering signals into a high-fidelity narrative that captures WHAT MATTERED AND WHY — not a list of what happened.

## Output Format

Reply with exactly one JSON object and nothing else — no markdown code fences, no preamble or postscript.
The object must be valid JSON (double-quoted keys and strings).

Required keys: date (string YYYY-MM-DD), summary (string), decisions (array), eventsProcessed (integer).
Optional keys: tradeOffs, deadEnds, breakthroughs, patterns (string[]), themes (string[]), domains (string[]), synthesizedBy (string; use "llm").

Each decision object: { decision: string, rationale: string, domain?: string, alternativesConsidered?: integer }.
Each tradeOff object: { tradeOff: string, chose: string, rejected: string, context?: string }.
Each deadEnd object: { description: string, timeSpentMinutes?: integer, resolution?: string }.
Each breakthrough object: { description: string, trigger?: string }.

## Quality Requirements

1. NARRATIVE SUMMARY: Write the summary as a 2-3 sentence narrative that a developer would want to read the next morning. Lead with the most impactful decision. Connect events causally ("After discovering X, pivoted to Y because Z"). Never write stat-counting summaries like "12 commits and 8 AI interactions."

2. DECISIONS: Each decision MUST have:
   - A specific "decision" statement (what was chosen — not a generic description of work done)
   - A specific "rationale" (WHY it was chosen — not "for better results" but the actual engineering reasoning)
   - A "domain" if identifiable from the signals

3. TRADE-OFFS: Each trade-off MUST name specific alternatives:
   - "chose": What was actually selected (e.g., "Server-side sessions with Redis")
   - "rejected": What was considered and rejected (e.g., "JWT with refresh token rotation")
   - NEVER use generic placeholders like "Developer's approach" or "AI suggestion"

4. DEDUPLICATION: The input contains signals from multiple sources (AI conversations, git commits, terminal). The SAME decision often appears in multiple sources with different wording. You MUST consolidate duplicates — keep the richest version with the best rationale. Never output two decisions that describe the same underlying choice.

5. DEAD ENDS: Describe what was attempted and WHY it was abandoned. Include the pivot decision if one followed.

6. Use only the user message for factual content; do not invent events that are not supported by those signals.`;
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
  const digests = options?.conversationDigests;
  if (provider) {
    const limits = resolveModelLimits(provider.modelName, options?.modelLimits);
    const promptChars = buildLLMPrompt(linked, limits, digests).length;
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
      return synthesizeFallback(linked, digests);
    }
  }
  return synthesizeFallback(linked, digests);
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
  const prompt = buildLLMPrompt(linked, limits, options?.conversationDigests);

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

  // Many OpenAI-compatible providers (Fireworks, vLLM) cap non-streaming at 4096 tokens.
  // Use 4096 as the safe max to avoid "must have stream=true" errors.
  const safeMaxOutput = Math.min(maxOutput, 4096);

  const result = await generateText({
    model: provider.model,
    system: distillSystemPromptPortable(),
    prompt,
    temperature: 0,
    maxOutputTokens: safeMaxOutput,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(90_000), // 90s timeout — fail fast, fall back to heuristic
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
const _DEFAULT_MAX_PROMPT_CHARS = MIN_CONTEXT_WINDOW * 4 - 16_384 * 4 - 2000; // ~446K chars

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
 * Budget allocation by priority tier (not source type):
 *   Primary signals 40% | Conversation digests 20% | Supporting signals 15% |
 *   Corroboration groups 15% | Background git activity 10%
 */
function buildLLMPrompt(
  linked: LinkedSignals,
  limits?: ModelLimits,
  digests?: Map<string, ConversationDigest>,
): string {
  const MAX_PROMPT_CHARS = resolveMaxPromptChars(limits);
  const header = [
    `Analyze this developer's engineering activity for ${linked.date}.`,
    `Generate a Daily Distill — a narrative reasoning summary that captures what mattered and why.`,
    "",
  ].join("\n");

  const stats = [
    "",
    `## Day Overview`,
    `- Total events: ${linked.stats.totalEvents}`,
    `- Commits: ${linked.stats.commitCount}`,
    `- AI sessions: ${linked.stats.aiCompletions + linked.stats.aiRejections}`,
    `- Domains: ${linked.stats.domains.join(", ") || "none"}`,
    `- Files changed: ${linked.stats.filesChanged.length}`,
  ].join("\n");

  // Fixed overhead
  const fixedLen = header.length + stats.length + 50;
  const budget = MAX_PROMPT_CHARS - fixedLen;

  // Priority-based budget allocation
  const primaryBudget = Math.floor(budget * 0.4);
  const digestBudget = Math.floor(budget * 0.2);
  const supportingBudget = Math.floor(budget * 0.15);
  const corroborationBudget = Math.floor(budget * 0.15);
  const backgroundBudget = Math.floor(budget * 0.1);

  // Build primary signals section (high-impact decisions, trade-offs, dead ends)
  const primarySection = buildPrimarySection(linked, primaryBudget);

  // Conversation digests
  const digestSection =
    digests && digests.size > 0 ? buildDigestSection(digests, digestBudget) : "";

  // Supporting signals (lower-impact commits, routine decisions)
  const supportingSection = buildSupportingSection(linked, supportingBudget);

  // Dead ends + temporal chains as corroboration context
  const corroborationSection = buildCorroborationSection(linked, corroborationBudget);

  // Background: aggregate git activity
  const backgroundSection = buildBackgroundSection(linked, backgroundBudget);

  const sections = [
    header,
    primarySection,
    digestSection,
    supportingSection,
    corroborationSection,
    backgroundSection,
    stats,
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

/**
 * Primary signals — high-value decisions with full context.
 * These are commits with decision-indicating language, AI rejections, and dead ends.
 */
function buildPrimarySection(linked: LinkedSignals, budget: number): string {
  const lines: string[] = [``, `## Primary Signals (highest impact)`];
  let used = lines.join("\n").length;

  // Decisions with alternatives or multi-file scope first
  const sorted = [...linked.decisions].sort((a, b) => {
    const scoreA = (a.alternativesCount || 0) * 10 + (a.files?.length || 0);
    const scoreB = (b.alternativesCount || 0) * 10 + (b.files?.length || 0);
    return scoreB - scoreA;
  });

  for (const d of sorted) {
    const files = truncateFiles(d.files, 5);
    const alts = d.alternativesCount > 0 ? ` (${d.alternativesCount} alternatives evaluated)` : "";
    const line = `- ${d.summary} [${d.branch ?? "unknown"}] files: ${files}${alts}`;
    if (used + line.length + 1 > budget) break;
    lines.push(line);
    used += line.length + 1;
  }

  // Trade-offs with full detail
  if (linked.tradeOffs.length > 0) {
    const tHeader = `\n### Trade-offs (${linked.tradeOffs.length})`;
    if (used + tHeader.length < budget) {
      lines.push(tHeader);
      used += tHeader.length;
      for (const t of linked.tradeOffs) {
        const line = `- ${t.summary} files: ${truncateFiles(t.relatedFiles, 3)}`;
        if (used + line.length + 1 > budget) break;
        lines.push(line);
        used += line.length + 1;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Supporting signals — lower-impact decisions, summarized.
 */
function buildSupportingSection(linked: LinkedSignals, budget: number): string {
  // Breakthroughs and temporal chains as supporting context
  const lines: string[] = [];
  let used = 0;

  if (linked.breakthroughs && linked.breakthroughs.length > 0) {
    lines.push(``, `## Breakthroughs (${linked.breakthroughs.length})`);
    used = lines.join("\n").length;
    for (const b of linked.breakthroughs) {
      const line = `- ${b.summary}${b.triggeredBy ? ` (triggered by: ${b.triggeredBy})` : ""}`;
      if (used + line.length + 1 > budget) break;
      lines.push(line);
      used += line.length + 1;
    }
  }

  return lines.join("\n");
}

/**
 * Corroboration context — dead ends and temporal chains that reveal the story.
 */
function buildCorroborationSection(linked: LinkedSignals, budget: number): string {
  const lines: string[] = [];
  let used = 0;

  if (linked.deadEnds.length > 0) {
    lines.push(``, `## Dead Ends / Reverts (${linked.deadEnds.length})`);
    used = lines.join("\n").length;
    for (const d of linked.deadEnds) {
      const time = d.timeSpentMinutes ? ` (~${d.timeSpentMinutes} min)` : "";
      const line = `- ${d.summary}${time}`;
      if (used + line.length + 1 > budget) break;
      lines.push(line);
      used += line.length + 1;
    }
  }

  if (linked.temporalChains.length > 0) {
    const tHeader = `\n## Temporal Chains (${linked.temporalChains.length})`;
    if (used + tHeader.length < budget) {
      lines.push(tHeader);
      used += tHeader.length;
      for (const c of linked.temporalChains) {
        const line = `- ${c.module}: ${c.summary}`;
        if (used + line.length + 1 > budget) break;
        lines.push(line);
        used += line.length + 1;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Background — aggregate stats only, no individual events.
 */
function buildBackgroundSection(linked: LinkedSignals, budget: number): string {
  const branchSet = new Set(linked.decisions.map((d) => d.branch).filter(Boolean));
  const domainList = linked.stats.domains.join(", ") || "none";
  const lines = [
    ``,
    `## Background Activity`,
    `- ${linked.stats.commitCount} commits across ${branchSet.size} branches`,
    `- Domains: ${domainList}`,
    `- ${linked.stats.aiCompletions} AI completions, ${linked.stats.aiRejections} rejections`,
  ];

  if (linked.stats.aiAcceptanceRate !== undefined) {
    lines.push(`- AI acceptance rate: ${(linked.stats.aiAcceptanceRate * 100).toFixed(0)}%`);
  }

  const text = lines.join("\n");
  return text.length <= budget ? text : text.slice(0, budget);
}

/**
 * Build a section from pre-digested conversation extracts for the LLM prompt.
 */
function buildDigestSection(digests: Map<string, ConversationDigest>, budget: number): string {
  if (digests.size === 0) return "";

  const lines: string[] = [``, `### AI Conversation Digests (${digests.size})`];
  let used = lines.join("\n").length;

  for (const [, digest] of digests) {
    const summaryLine = `- Session: ${digest.conversationSummary}`;
    if (used + summaryLine.length + 1 > budget) {
      lines.push(`  ... (${digests.size} total sessions, truncated)`);
      break;
    }
    lines.push(summaryLine);
    used += summaryLine.length + 1;

    for (const d of digest.decisions) {
      const decLine = `  Decision: ${d.decision}${d.rationale ? ` — ${d.rationale}` : ""}${d.domain ? ` [${d.domain}]` : ""}`;
      if (used + decLine.length + 1 > budget) break;
      lines.push(decLine);
      used += decLine.length + 1;
    }

    if (digest.tradeOffs) {
      for (const t of digest.tradeOffs) {
        const tLine = `  Trade-off: ${t}`;
        if (used + tLine.length + 1 > budget) break;
        lines.push(tLine);
        used += tLine.length + 1;
      }
    }

    if (digest.filesActedOn && digest.filesActedOn.length > 0) {
      const fLine = `  Files: ${truncateFiles(digest.filesActedOn, 5)}`;
      if (used + fLine.length + 1 <= budget) {
        lines.push(fLine);
        used += fLine.length + 1;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Fallback synthesizer — UF-039 (redesigned).
 * Produces narrative-driven DailyDistill without LLM.
 * Filters noise, extracts real decisions from structured data,
 * and builds a meaningful daily summary that answers:
 * "What did I actually accomplish or change today?"
 */
export function synthesizeFallback(
  linked: LinkedSignals,
  digests?: Map<string, ConversationDigest>,
): DailyDistill {
  const { stats } = linked;

  // --- 1. Extract real decisions (strict quality filter) ---
  const decisions = extractQualityDecisions(linked, digests);
  const deduped = deduplicateFinalDecisions(decisions);

  // --- 2. Extract meaningful trade-offs with real content ---
  const tradeOffs = extractTradeOffs(linked, digests);

  // --- 3. Map dead ends and breakthroughs ---
  const deadEnds =
    linked.deadEnds.length > 0
      ? linked.deadEnds.map((d) => ({
          description: d.summary,
          timeSpentMinutes: d.timeSpentMinutes,
          resolution: d.revertedFiles
            ? `Reverted changes to ${d.revertedFiles.slice(0, 3).join(", ")}`
            : "Reverted",
        }))
      : undefined;

  const breakthroughs =
    linked.breakthroughs.length > 0
      ? linked.breakthroughs.map((b) => ({
          description: b.summary,
          trigger: b.triggeredBy,
        }))
      : undefined;

  // --- 4. Build narrative summary ---
  // The summary answers: "What did I accomplish today?" — not "how many events were there"
  const summary = buildNarrativeSummary(linked, deduped, deadEnds, stats);

  // --- 5. Extract meaningful patterns from temporal chains ---
  const patterns = extractPatterns(linked, stats);

  return {
    date: linked.date,
    summary,
    decisions: deduped,
    tradeOffs: tradeOffs.length > 0 ? tradeOffs : undefined,
    deadEnds,
    breakthroughs,
    patterns: patterns.length > 0 ? patterns : undefined,
    eventsProcessed: stats.totalEvents,
    themes: stats.domains.length > 0 ? stats.domains : undefined,
    domains: stats.domains.length > 0 ? stats.domains : undefined,
    synthesizedBy: "fallback",
  };
}

// Regex for DELIBERATE CHOICE language — not mere activity.
// "implementing" and "adding" are activity, not decisions. Decisions involve choosing between alternatives.
const DECISION_RE =
  /\b(chose|decided|switch(?:ed|ing)\s+(?:to|from)|replac(?:ed|ing)\s+\w+\s+with|migrat(?:ed|ing)|revert(?:ed|ing)|trade.?off|instead of|rather than|opt(?:ed|ing)\s+(?:for|to)|picked|selected|redesign(?:ed|ing)|rewrit(?:e|ten)|adopt(?:ed|ing)|deprecat(?:ed|ing))\b/i;

// Regex to detect raw prompts/instructions to AI (not real decisions).
// Covers imperative verbs, question words, research directives, and polite requests.
const RAW_PROMPT_RE =
  /^(I need|I want|please|can you|hey|go through|check|verify|look at|read|show me|help me|fix|do |make |let'?s |tell me|explain|what |how |why |donot|don't|do not|research|thoroughly|explore|analyze|audit|identify|find|search|investigate|list|review|compare|ensure|update|create|build|write|add |remove|delete|set up|configure|implement|refactor|clean|optimize|improve|test |debug|deploy|run |install|generate|prepare|design|plan |move |copy |rename)\b/i;

// Additional noise: file paths, codebase descriptions, continuation messages, AI preambles
const EXTENDED_NOISE_RE =
  /^The (codebase|project|repo|code|system|file|directory|folder)\b|^(Based on|According to|Looking at|After reading|From the|In the|As per)\b|^(Now |OK |Sure |Yes |No |Alright |So |Well |Right |Let me |I'll |I will |Here'?s )|^\//i;

// File path dumps in the first 60 chars indicate raw context, not a decision
const PATH_NOISE_RE = /\/Users\/|\/home\/|\/var\/|C:\\|[A-Z]:\\|\.git\//;

/**
 * Extract only quality decisions — filters out raw AI prompts,
 * non-engineering conversations, and noise.
 */
function extractQualityDecisions(
  linked: LinkedSignals,
  digests?: Map<string, ConversationDigest>,
): DailyDistill["decisions"] {
  const decisions: DailyDistill["decisions"] = [];

  // 1. Conversation digests — from turn-level pattern matching.
  //    Still apply noise filters: the digester can extract raw prompts as "decisions".
  if (digests && digests.size > 0) {
    for (const [, digest] of digests) {
      for (const d of digest.decisions) {
        const text = d.decision.trim();
        if (RAW_PROMPT_RE.test(text)) continue;
        if (EXTENDED_NOISE_RE.test(text)) continue;
        if (PATH_NOISE_RE.test(text.slice(0, 60))) continue;
        if (!looksLikeDecision(text)) continue;
        decisions.push({
          decision: text,
          rationale: d.rationale || "From AI conversation analysis",
          domain: d.domain,
          alternativesConsidered: d.alternativesConsidered,
          humanDirectionScore: 0.7,
          directionClassification: "collaborative",
        } as DailyDistill["decisions"][number]);
      }
    }
  }

  // 2. Git commits — human wrote the commit message → high HDS
  for (const d of linked.decisions) {
    if (d.source !== "commit") continue;
    const summary = d.summary.trim();
    if (summary.length < 10) continue;
    decisions.push({
      decision: summary,
      rationale: buildCommitRationale(d),
      domain: domainFromFiles(d.files) ?? domainFromBranch(d.branch),
      alternativesConsidered: d.alternativesCount > 0 ? d.alternativesCount : undefined,
      humanDirectionScore: 0.85,
      directionClassification: "human-directed",
    } as DailyDistill["decisions"][number]);
  }

  // 3. AI conversations WITHOUT a digest — prefer structured metadata over raw prompt text
  for (const d of linked.decisions) {
    if (d.source !== "ai-conversation") continue;
    if (digests?.has(d.eventId)) continue;

    const meta = d.conversationMeta;
    const summary = d.summary.trim();

    // Hard filter: skip file path dumps, raw prompts, codebase descriptions
    if (RAW_PROMPT_RE.test(summary)) continue;
    if (EXTENDED_NOISE_RE.test(summary)) continue;
    if (PATH_NOISE_RE.test(summary.slice(0, 60))) continue;

    // Prefer conversation title — it's almost always cleaner than the summary
    const title = meta?.conversationTitle;
    let decisionText: string | null = null;

    if (title && title.length > 10 && title.length < 200) {
      if (
        !RAW_PROMPT_RE.test(title) &&
        !EXTENDED_NOISE_RE.test(title) &&
        !PATH_NOISE_RE.test(title.slice(0, 60))
      ) {
        decisionText = title;
      }
    }

    // Fall back to cleaned summary only if it has real engineering signals
    if (!decisionText) {
      const hasFiles = meta?.filesModified && meta.filesModified.length > 0;
      const isMultiTurn = meta?.turnCount && meta.turnCount >= 3;
      const hasDecisionLanguage = DECISION_RE.test(summary);

      if (!hasFiles && !isMultiTurn && !hasDecisionLanguage) continue;

      decisionText = cleanDecisionText(summary, title);
      if (!decisionText) continue;
    }

    // HDS heuristic for AI conversations: title-derived decisions are human-initiated (0.65),
    // file-modification-derived are collaborative (0.5), summary-based are lower (0.4).
    const hds = decisionText === title ? 0.65 : meta?.filesModified?.length ? 0.5 : 0.4;
    const dirClass =
      hds >= 0.6 ? "human-directed" : hds >= 0.35 ? "collaborative" : ("ai-suggested" as const);

    decisions.push({
      decision: decisionText,
      rationale: buildAiRationale(d),
      domain: domainFromFiles(meta?.filesModified) ?? domainFromBranch(d.branch),
      alternativesConsidered: d.alternativesCount > 0 ? d.alternativesCount : undefined,
      humanDirectionScore: hds,
      directionClassification: dirClass,
    } as DailyDistill["decisions"][number]);
  }

  return decisions;
}

/**
 * Clean and normalize decision text from AI conversation summary.
 * Returns null if the text is too noisy to be a useful decision.
 */
function cleanDecisionText(summary: string, title?: string): string | null {
  // Prefer a short, meaningful title over the full prompt
  if (
    title &&
    title.length > 10 &&
    title.length < 150 &&
    !RAW_PROMPT_RE.test(title) &&
    !EXTENDED_NOISE_RE.test(title)
  ) {
    return title;
  }

  // Extract the first meaningful sentence if summary is long
  const trimmed = summary.trim();
  if (trimmed.length > 150) {
    const firstSentence = trimmed.match(/^[^.!?\n]+[.!?]?/)?.[0];
    if (firstSentence && firstSentence.length > 10 && !RAW_PROMPT_RE.test(firstSentence)) {
      return firstSentence.length > 150 ? `${firstSentence.slice(0, 147)}...` : firstSentence;
    }
    return null; // Long raw text with no clean sentence → skip
  }

  if (RAW_PROMPT_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Build rationale for a commit decision using available context.
 */
function buildCommitRationale(d: LinkedSignals["decisions"][number]): string {
  const parts: string[] = [];
  if (d.branch && d.branch !== "main" && d.branch !== "master") {
    parts.push(`On branch ${d.branch}`);
  }
  if (d.files && d.files.length > 0) {
    const fileList = d.files
      .slice(0, 3)
      .map((f) => f.split("/").pop())
      .join(", ");
    parts.push(`touching ${fileList}${d.files.length > 3 ? ` +${d.files.length - 3} more` : ""}`);
  }
  return parts.length > 0 ? parts.join("; ") : "From git history";
}

/**
 * Build rationale for an AI conversation decision.
 */
function buildAiRationale(d: LinkedSignals["decisions"][number]): string {
  const parts: string[] = [];
  const meta = d.conversationMeta;
  if (meta?.filesModified && meta.filesModified.length > 0) {
    const fileList = meta.filesModified
      .slice(0, 3)
      .map((f) => f.split("/").pop())
      .join(", ");
    parts.push(
      `Modified ${fileList}${meta.filesModified.length > 3 ? ` +${meta.filesModified.length - 3} more` : ""}`,
    );
  }
  if (meta?.turnCount && meta.turnCount > 3) {
    parts.push(`${meta.turnCount}-turn conversation`);
  }
  if (d.branch && d.branch !== "main" && d.branch !== "master") {
    parts.push(`on ${d.branch}`);
  }
  return parts.length > 0 ? parts.join("; ") : "From AI-assisted session";
}

/**
 * Extract trade-offs with real content instead of generic placeholders.
 * Attempts to extract specific chose/rejected from conversation detail.
 */
function extractTradeOffs(
  linked: LinkedSignals,
  digests?: Map<string, ConversationDigest>,
): NonNullable<DailyDistill["tradeOffs"]> {
  const tradeOffs: NonNullable<DailyDistill["tradeOffs"]> = [];

  // From linked trade-offs (AI rejections) — try to extract real content
  for (const t of linked.tradeOffs) {
    const { chose, rejected } = extractTradeOffContent(t);
    tradeOffs.push({
      tradeOff: t.summary.length > 150 ? `${t.summary.slice(0, 147)}...` : t.summary,
      chose,
      rejected,
      context: t.relatedFiles?.slice(0, 5).join(", "),
    });
  }

  // From conversation digests
  if (digests) {
    for (const [, digest] of digests) {
      if (digest.tradeOffs) {
        for (const t of digest.tradeOffs) {
          tradeOffs.push({
            tradeOff: t,
            chose: "Selected approach",
            rejected: "Alternative considered",
          });
        }
      }
    }
  }

  return tradeOffs;
}

/**
 * Attempt to extract specific chose/rejected content from a trade-off signal.
 * Falls back to descriptive placeholders based on file context if raw content unavailable.
 */
function extractTradeOffContent(t: LinkedSignals["tradeOffs"][number]): {
  chose: string;
  rejected: string;
} {
  // Build descriptive fallback from available context
  if (t.relatedFiles && t.relatedFiles.length > 0) {
    const fileContext = t.relatedFiles
      .slice(0, 2)
      .map((f) => f.split("/").pop())
      .join(", ");
    return {
      chose: `Developer's approach for ${fileContext}`,
      rejected: `AI-suggested alternative for ${fileContext}`,
    };
  }
  return {
    chose: "Developer's manual approach",
    rejected: "AI-generated suggestion",
  };
}

/**
 * Build a narrative summary that answers "What did I accomplish today?"
 * Leads with accomplishments, not event counts. Works for both
 * commit-heavy and AI-conversation-only days.
 */
function buildNarrativeSummary(
  linked: LinkedSignals,
  decisions: DailyDistill["decisions"],
  deadEnds: DailyDistill["deadEnds"],
  stats: LinkedSignals["stats"],
): string {
  const parts: string[] = [];

  // Lead with the top decision — what was actually done
  if (decisions.length > 0) {
    const top = decisions[0].decision;
    const truncated = top.length > 100 ? `${top.slice(0, 97)}...` : top;
    parts.push(truncated);

    if (decisions.length > 1) {
      const others = decisions
        .slice(1, 3)
        .map((d) => d.decision.slice(0, 60))
        .join("; ");
      parts.push(`Also: ${others}.`);
    }
  }

  // Add domain context
  if (stats.domains.length > 0) {
    const domainStr = stats.domains.slice(0, 3).join(", ");
    parts.push(`Active in ${domainStr}.`);
  }

  // Mention code output
  if (stats.commitCount > 0) {
    parts.push(`${stats.commitCount} commit${stats.commitCount !== 1 ? "s" : ""} shipped.`);
  }

  // Mention friction — dead ends are high-signal
  if (deadEnds && deadEnds.length > 0) {
    parts.push(`Hit ${deadEnds.length} dead end${deadEnds.length !== 1 ? "s" : ""}.`);
  }

  // Session depth indicator — count unique conversation titles as session proxy
  const sessionTitles = new Set<string>();
  for (const d of linked.decisions) {
    const title = d.conversationMeta?.conversationTitle;
    if (title) sessionTitles.add(title);
  }
  if (sessionTitles.size > 0) {
    parts.push(`Across ${sessionTitles.size} AI session${sessionTitles.size !== 1 ? "s" : ""}.`);
  }

  // Mention focused work chains
  if (linked.temporalChains.length > 0) {
    const topChain = linked.temporalChains.reduce((a, b) =>
      a.eventIds.length > b.eventIds.length ? a : b,
    );
    if (topChain.eventIds.length >= 3) {
      parts.push(`Focused work on ${topChain.module}.`);
    }
  }

  if (parts.length === 0) {
    return "Light activity day.";
  }

  return parts.join(" ");
}

/**
 * Extract meaningful patterns from temporal chains — skip noise.
 */
function extractPatterns(linked: LinkedSignals, _stats: LinkedSignals["stats"]): string[] {
  const patterns: string[] = [];

  // Only include chains with 3+ commits (real focused work, not coincidence)
  for (const c of linked.temporalChains) {
    if (c.eventIds.length >= 3) {
      patterns.push(`Focused work on ${c.module} (${c.eventIds.length} commits)`);
    }
  }

  return patterns;
}

/**
 * Derive domain from file paths (e.g., "auth", "database", "UI").
 */
function domainFromFiles(files?: string[]): string | undefined {
  if (!files || files.length === 0) return undefined;
  // Use the most common directory as domain indicator
  const dirs = new Map<string, number>();
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length >= 2) {
      const dir = parts.slice(0, 2).join("/");
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
    }
  }
  if (dirs.size === 0) return undefined;
  const topDir = [...dirs.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return topDir;
}

function domainFromBranch(branch?: string): string | undefined {
  if (!branch) return undefined;
  const lower = branch.toLowerCase();
  if (lower.includes("feat")) return "feature";
  if (lower.includes("fix") || lower.includes("bug")) return "bugfix";
  if (lower.includes("refactor")) return "refactoring";
  if (lower.includes("test")) return "testing";
  if (lower.includes("doc")) return "documentation";
  if (lower.includes("ci") || lower.includes("deploy")) return "infrastructure";
  return undefined;
}

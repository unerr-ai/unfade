// FILE: src/services/knowledge/llm-extractor.ts
// Layer 2.5 KE-8.1: LLM extraction caller.
// Sends segmented conversation data to the LLM via Vercel AI SDK, validates the
// structured JSON response with Zod, and transforms it into ExtractionResult.
//
// Two paths:
//   - AI conversations → full 7-dimension extraction (entities, facts, comprehension,
//     metacognition, agency, sustainability, reasoning chains)
//   - Git commits / non-conversation → lighter extraction (entities, facts, reasoning chains)
//
// Retry strategy: on JSON parse or Zod validation failure, retry once with an explicit
// "respond in valid JSON" suffix. On timeout or second failure, throw.
//
// Batch extraction: worker-pool concurrency (N workers process items as they complete).

import type { LanguageModel } from "ai";
import { generateText } from "ai";
import { z } from "zod";

import type { CaptureEvent } from "../../schemas/event.js";
import {
  type ComprehensionAssessment,
  ComprehensionDimensionsSchema,
  type ConversationSegment,
  type ExtractionResult,
  ExtractedEntitySchema,
  AtomicFactSchema,
  MetacognitiveSignalSchema,
  SegmentAgencySchema,
  SustainabilitySignalSchema,
  ReasoningChainSchema,
  computeOverallScore,
} from "../../schemas/knowledge.js";
import { logger } from "../../utils/logger.js";
import { extractFirstJsonObjectFromModelText } from "../distill/synthesizer.js";
import {
  buildExtractionPrompt,
  getSystemPromptForEvent,
  eventSupportsComprehension,
  EXTRACTION_PROMPT_VERSION,
} from "./prompts.js";
import type { Turn } from "./turn-parser.js";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface ExtractionConfig {
  model: LanguageModel;
  provider: string;
  modelName: string;
  /** Max concurrent LLM calls for batch extraction. */
  concurrency: number;
  /** Per-call timeout in milliseconds. */
  timeoutMs: number;
}

export const DEFAULT_EXTRACTION_CONFIG = {
  concurrency: 5,
  timeoutMs: 60_000,
} as const;

// ─── Error Types ────────────────────────────────────────────────────────────

export class ExtractionParseError extends Error {
  readonly rawText: string;
  constructor(message: string, rawText: string) {
    super(message);
    this.name = "ExtractionParseError";
    this.rawText = rawText;
  }
}

export class ExtractionTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`LLM extraction timed out after ${timeoutMs}ms`);
    this.name = "ExtractionTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ─── Raw LLM Output Schemas ────────────────────────────────────────────────
// These are lenient versions of the extraction schemas with .default([]) so
// that partial LLM output (missing optional arrays) still parses successfully.
// Strict enum validation is preserved — hallucinated values are caught.

const LlmComprehensionRawSchema = z.object({
  dimensions: ComprehensionDimensionsSchema,
  evidence: z.array(z.string()).default([]),
  rubberStampCount: z.number().int().min(0).default(0),
  pushbackCount: z.number().int().min(0).default(0),
  domainTags: z.array(z.string()).default([]),
});

/** Schema for full conversation extraction output from the LLM. */
export const LlmConversationOutputSchema = z.object({
  entities: z.array(ExtractedEntitySchema).default([]),
  facts: z.array(AtomicFactSchema).default([]),
  comprehension: LlmComprehensionRawSchema.nullable().default(null),
  metacognitiveSignals: z.array(MetacognitiveSignalSchema).default([]),
  agencyClassification: z.array(SegmentAgencySchema).default([]),
  sustainabilitySignal: SustainabilitySignalSchema.nullable().default(null),
  reasoningChains: z.array(ReasoningChainSchema).default([]),
});
export type LlmConversationOutput = z.infer<typeof LlmConversationOutputSchema>;

/** Schema for git commit / non-conversation extraction output from the LLM. */
export const LlmGitOutputSchema = z.object({
  entities: z.array(ExtractedEntitySchema).default([]),
  facts: z.array(AtomicFactSchema).default([]),
  reasoningChains: z.array(ReasoningChainSchema).default([]),
});
export type LlmGitOutput = z.infer<typeof LlmGitOutputSchema>;

// ─── Single Event Extraction ────────────────────────────────────────────────

/**
 * Extract knowledge from a single event using the LLM.
 *
 * Flow: build prompt → call LLM → parse JSON → validate with Zod → transform
 * to ExtractionResult. On parse/validation failure, retries once with a
 * corrective suffix. On timeout, throws ExtractionTimeoutError.
 */
export async function extractFromEvent(
  event: CaptureEvent,
  turns: Turn[],
  segments: ConversationSegment[],
  config: ExtractionConfig,
  existingEntities?: string[],
): Promise<ExtractionResult> {
  if (turns.length === 0) {
    return emptyExtractionResult(event.id, segments, event.source);
  }

  const systemPrompt = getSystemPromptForEvent(event.source);
  const userPrompt = buildExtractionPrompt(
    turns, segments, event.type, event.source, existingEntities,
  );
  const isConversation = eventSupportsComprehension(event.source);

  let rawText: string;
  try {
    rawText = await callLlm(config, systemPrompt, userPrompt);
  } catch (err) {
    if (isAbortError(err)) {
      throw new ExtractionTimeoutError(config.timeoutMs);
    }
    throw err;
  }

  // Attempt 1: parse + validate
  const firstAttempt = parseAndValidate(rawText, isConversation);
  if (firstAttempt.success) {
    return toExtractionResult(firstAttempt.data, event, segments, isConversation);
  }

  logger.warn("Extraction parse failed, retrying with corrective prompt", {
    eventId: event.id,
    error: firstAttempt.error,
    promptVersion: EXTRACTION_PROMPT_VERSION,
  });

  // Attempt 2: retry with explicit JSON correction suffix
  const retryPrompt = `${userPrompt}\n\nIMPORTANT: Your previous response was not valid JSON or contained invalid field values. Respond with ONLY a valid JSON object matching the schema. No markdown fences, no explanation.`;
  let retryText: string;
  try {
    retryText = await callLlm(config, systemPrompt, retryPrompt);
  } catch (err) {
    if (isAbortError(err)) {
      throw new ExtractionTimeoutError(config.timeoutMs);
    }
    throw err;
  }

  const secondAttempt = parseAndValidate(retryText, isConversation);
  if (secondAttempt.success) {
    return toExtractionResult(secondAttempt.data, event, segments, isConversation);
  }

  throw new ExtractionParseError(
    `Failed to parse LLM extraction after retry: ${secondAttempt.error}`,
    retryText,
  );
}

// ─── Batch Extraction ───────────────────────────────────────────────────────

export interface BatchEventInput {
  event: CaptureEvent;
  turns: Turn[];
  segments: ConversationSegment[];
}

/**
 * Extract knowledge from multiple events with bounded concurrency.
 *
 * Uses a worker-pool pattern: N workers pull from a shared queue and process
 * items as they complete. Failed extractions are logged but don't halt the batch.
 * Returns results for successfully extracted events only.
 */
export async function extractBatch(
  events: BatchEventInput[],
  config: ExtractionConfig,
  existingEntities?: string[],
): Promise<Map<string, ExtractionResult>> {
  const results = new Map<string, ExtractionResult>();
  if (events.length === 0) return results;

  let index = 0;

  async function worker(): Promise<void> {
    while (index < events.length) {
      const i = index++;
      const { event, turns, segments } = events[i];
      try {
        const result = await extractFromEvent(
          event, turns, segments, config, existingEntities,
        );
        results.set(event.id, result);
      } catch (err) {
        logger.warn("Batch extraction failed for event", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workerCount = Math.min(config.concurrency, events.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  return results;
}

// ─── LLM Call ───────────────────────────────────────────────────────────────

async function callLlm(
  config: ExtractionConfig,
  system: string,
  prompt: string,
): Promise<string> {
  const result = await generateText({
    model: config.model,
    system,
    prompt,
    temperature: 0,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(config.timeoutMs),
  });
  return result.text;
}

// ─── Parse + Validate ───────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: LlmConversationOutput }
  | { success: false; error: string };

function parseAndValidate(
  rawText: string,
  isConversation: boolean,
): ParseResult {
  let jsonStr: string;
  try {
    jsonStr = extractFirstJsonObjectFromModelText(rawText);
  } catch (err) {
    return { success: false, error: `JSON extraction: ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    return { success: false, error: `JSON.parse: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (isConversation) {
    const result = LlmConversationOutputSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.slice(0, 3).map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ).join("; ");
      return { success: false, error: `Zod validation: ${issues}` };
    }
    return { success: true, data: result.data };
  }

  // Git/terminal events → parse with git schema, then upcast to conversation shape
  const result = LlmGitOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 3).map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    ).join("; ");
    return { success: false, error: `Zod validation: ${issues}` };
  }

  return {
    success: true,
    data: {
      entities: result.data.entities,
      facts: result.data.facts,
      comprehension: null,
      metacognitiveSignals: [],
      agencyClassification: [],
      sustainabilitySignal: null,
      reasoningChains: result.data.reasoningChains,
    },
  };
}

// ─── Transform ──────────────────────────────────────────────────────────────

function toExtractionResult(
  raw: LlmConversationOutput,
  event: CaptureEvent,
  segments: ConversationSegment[],
  isConversation: boolean,
): ExtractionResult {
  let comprehension: ComprehensionAssessment | null = null;

  if (isConversation && raw.comprehension) {
    comprehension = {
      episodeId: event.id,
      timestamp: event.timestamp,
      dimensions: raw.comprehension.dimensions,
      overallScore: computeOverallScore(raw.comprehension.dimensions),
      evidence: raw.comprehension.evidence,
      rubberStampCount: raw.comprehension.rubberStampCount,
      pushbackCount: raw.comprehension.pushbackCount,
      domainTags: raw.comprehension.domainTags,
      assessmentMethod: "llm",
    };
  }

  return {
    episodeId: event.id,
    segments,
    entities: raw.entities,
    facts: raw.facts,
    comprehension,
    metacognitiveSignals: raw.metacognitiveSignals,
    agencyClassification: raw.agencyClassification,
    sustainabilitySignal: raw.sustainabilitySignal,
    reasoningChains: raw.reasoningChains,
  };
}

function emptyExtractionResult(
  episodeId: string,
  segments: ConversationSegment[],
  eventSource: string,
): ExtractionResult {
  return {
    episodeId,
    segments,
    entities: [],
    facts: [],
    comprehension: null,
    metacognitiveSignals: [],
    agencyClassification: [],
    sustainabilitySignal: null,
    reasoningChains: [],
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    if ("cause" in err && err.cause instanceof Error) {
      return err.cause.name === "AbortError" || err.cause.name === "TimeoutError";
    }
  }
  return false;
}

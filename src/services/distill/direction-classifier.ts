import { generateObject } from "ai";
import { z } from "zod";
import type { DirectionClassification } from "../../schemas/distill.js";
import { logger } from "../../utils/logger.js";
import type { LLMProviderResult } from "./providers/ai.js";

interface AmbiguousDecision {
  eventId: string;
  summary: string;
  hds: number;
}

interface ClassificationResult {
  eventId: string;
  classification: DirectionClassification;
}

const BatchClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      index: z.number().int().min(0),
      classification: z.enum(["human-directed", "collaborative", "llm-directed"]),
    }),
  ),
});

/**
 * Batch-classify ambiguous decisions (confidence: "low") with a single LLM call.
 * If no ambiguous decisions exist, returns immediately (zero tokens consumed).
 */
export async function classifyAmbiguous(
  decisions: AmbiguousDecision[],
  provider: LLMProviderResult | null,
): Promise<ClassificationResult[]> {
  if (decisions.length === 0 || !provider) {
    return decisions.map((d) => ({
      eventId: d.eventId,
      classification: hdsToClassification(d.hds),
    }));
  }

  try {
    const prompt = buildClassificationPrompt(decisions);

    const { object } = await generateObject({
      model: provider.model,
      schema: BatchClassificationSchema,
      prompt,
    });

    return decisions.map((d, i) => {
      const match = object.classifications.find((c) => c.index === i);
      return {
        eventId: d.eventId,
        classification: match?.classification ?? hdsToClassification(d.hds),
      };
    });
  } catch (err) {
    logger.warn("LLM direction classification failed, using heuristic fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return decisions.map((d) => ({
      eventId: d.eventId,
      classification: hdsToClassification(d.hds),
    }));
  }
}

function buildClassificationPrompt(decisions: AmbiguousDecision[]): string {
  const items = decisions
    .map((d, i) => `[${i}] HDS: ${d.hds.toFixed(2)} — "${d.summary}"`)
    .join("\n");

  return `Classify each of these developer decision excerpts from an AI coding session.

For each entry, determine whether the developer was:
- "human-directed": Developer provided domain knowledge, rejected AI suggestion, steered the approach, or modified output with judgment
- "collaborative": Developer and AI iteratively refined together with substantive input from both
- "llm-directed": Developer accepted AI suggestion without modification or evaluation

Entries:
${items}

Return the classification for each by index.`;
}

function hdsToClassification(hds: number): DirectionClassification {
  if (hds >= 0.6) return "human-directed";
  if (hds >= 0.3) return "collaborative";
  return "llm-directed";
}

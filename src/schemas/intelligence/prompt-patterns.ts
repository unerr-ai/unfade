// FILE: src/schemas/intelligence/prompt-patterns.ts

import { z } from "zod";

export const EffectivePatternSchema = z.object({
  domain: z.string(),
  pattern: z.string(),
  acceptanceRate: z.number().min(0).max(1),
  sampleSize: z.number().int().min(0),
});

export const AntiPatternSchema = z.object({
  domain: z.string(),
  pattern: z.string(),
  rejectionRate: z.number().min(0).max(1),
  suggestion: z.string(),
});

export const PromptPatternsSchema = z.object({
  effectivePatterns: z.array(EffectivePatternSchema),
  antiPatterns: z.array(AntiPatternSchema),
  updatedAt: z.string(),
  totalPromptsAnalyzed: z.number().int(),
});

export type PromptPatterns = z.infer<typeof PromptPatternsSchema>;

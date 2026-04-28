import { z } from "zod";
import { AnalyzerOutputMetaSchema, DiagnosticMessageSchema } from "../intelligence-presentation.js";

export const EffectivePatternSchema = z.object({
  domain: z.string(),
  pattern: z.string(),
  acceptanceRate: z.number().min(0).max(1),
  sampleSize: z.number().int().min(0),
  entities: z.array(z.string()).optional(),
  exampleSessionIds: z.array(z.string()).default([]),
});

export const AntiPatternSchema = z.object({
  domain: z.string(),
  pattern: z.string(),
  rejectionRate: z.number().min(0).max(1),
  suggestion: z.string(),
  exampleSessionIds: z.array(z.string()).default([]),
});

export const PromptPatternsSchema = z.object({
  effectivePatterns: z.array(EffectivePatternSchema),
  antiPatterns: z.array(AntiPatternSchema),
  updatedAt: z.string(),
  totalPromptsAnalyzed: z.number().int(),
  _meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
});

export type PromptPatterns = z.infer<typeof PromptPatternsSchema>;

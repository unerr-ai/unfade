import { z } from "zod";
import { AnalyzerOutputMetaSchema, DiagnosticMessageSchema } from "../intelligence-presentation.js";

export const EfficiencySubMetricSchema = z.object({
  value: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  confidence: z.enum(["high", "medium", "low"]),
  dataPoints: z.number().int().min(0),
  evidenceEventIds: z.array(z.string()).default([]),
});

export const EfficiencySchema = z.object({
  aes: z.number().min(0).max(100),
  confidence: z.enum(["high", "medium", "low"]),
  subMetrics: z.object({
    directionDensity: EfficiencySubMetricSchema,
    tokenEfficiency: EfficiencySubMetricSchema,
    iterationRatio: EfficiencySubMetricSchema,
    contextLeverage: EfficiencySubMetricSchema,
    modificationDepth: EfficiencySubMetricSchema,
    comprehensionEfficiency: EfficiencySubMetricSchema.optional(),
  }),
  trend: z.enum(["improving", "stable", "declining"]).nullable(),
  history: z.array(
    z.object({
      date: z.string(),
      aes: z.number(),
    }),
  ),
  topInsight: z.string().nullable(),
  updatedAt: z.string(),
  period: z.string(),
  _meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
});

export type Efficiency = z.infer<typeof EfficiencySchema>;
export type EfficiencySubMetric = z.infer<typeof EfficiencySubMetricSchema>;

// FILE: src/schemas/intelligence/efficiency.ts
// UF-101: Zod schema for efficiency.json — the AI Efficiency Score (AES).

import { z } from "zod";

export const EfficiencySubMetricSchema = z.object({
  value: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  confidence: z.enum(["high", "medium", "low"]),
  dataPoints: z.number().int().min(0),
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
});

export type Efficiency = z.infer<typeof EfficiencySchema>;
export type EfficiencySubMetric = z.infer<typeof EfficiencySubMetricSchema>;

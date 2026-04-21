// FILE: src/schemas/intelligence/costs.ts
// UF-102: Zod schema for costs.json — Cost Attribution Engine output.

import { z } from "zod";

export const CostDimensionSchema = z.object({
  key: z.string(),
  eventCount: z.number().int(),
  estimatedCost: z.number(),
  percentage: z.number(),
});

export const CostAttributionSchema = z.object({
  totalEstimatedCost: z.number(),
  period: z.string(),
  isProxy: z.literal(true),
  byModel: z.array(CostDimensionSchema),
  byDomain: z.array(CostDimensionSchema),
  byBranch: z.array(CostDimensionSchema),
  byFeature: z.array(CostDimensionSchema).optional(),
  abandonedWaste: z
    .object({
      eventCount: z.number().int(),
      estimatedCost: z.number(),
    })
    .optional(),
  wasteRatio: z.number().min(0).max(1).nullable(),
  contextOverhead: z.number().min(0).max(1).nullable(),
  projectedMonthlyCost: z.number().nullable(),
  costPerDirectedDecision: z.number().nullable(),
  updatedAt: z.string(),
  disclaimer: z.string(),
});

export type CostAttribution = z.infer<typeof CostAttributionSchema>;
export type CostDimension = z.infer<typeof CostDimensionSchema>;

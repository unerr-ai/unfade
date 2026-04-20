// FILE: src/schemas/intelligence/comprehension.ts
// UF-103: Zod schema for intelligence/comprehension.json — the Comprehension Radar.

import { z } from "zod";

export const ModuleComprehensionDetailSchema = z.object({
  score: z.number().min(0).max(100),
  decisionsCount: z.number().int().min(0),
  lastUpdated: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ComprehensionRadarSchema = z.object({
  overall: z.number().min(0).max(100),
  confidence: z.enum(["high", "medium", "low"]),
  byModule: z.record(z.string(), ModuleComprehensionDetailSchema),
  byDomain: z.record(z.string(), z.number()),
  blindSpots: z.array(z.string()),
  blindSpotAlerts: z.array(
    z.object({
      module: z.string(),
      score: z.number(),
      eventCount: z.number(),
      suggestion: z.string(),
    }),
  ),
  updatedAt: z.string(),
});

export type ComprehensionRadar = z.infer<typeof ComprehensionRadarSchema>;

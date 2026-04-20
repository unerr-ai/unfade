// FILE: src/schemas/intelligence/velocity.ts

import { z } from "zod";

export const DomainVelocitySchema = z.object({
  currentTurnsToAcceptance: z.number(),
  previousTurnsToAcceptance: z.number(),
  velocityChange: z.number(),
  dataPoints: z.number().int(),
  trend: z.enum(["accelerating", "stable", "decelerating"]),
});

export const VelocitySchema = z.object({
  byDomain: z.record(z.string(), DomainVelocitySchema),
  overallTrend: z.enum(["accelerating", "stable", "decelerating"]),
  overallMagnitude: z.number(),
  dataPoints: z.number().int(),
  updatedAt: z.string(),
});

export type Velocity = z.infer<typeof VelocitySchema>;
export type DomainVelocity = z.infer<typeof DomainVelocitySchema>;

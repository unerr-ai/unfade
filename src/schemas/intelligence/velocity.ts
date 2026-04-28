import { z } from "zod";
import { AnalyzerOutputMetaSchema, DiagnosticMessageSchema } from "../intelligence-presentation.js";

export const DomainVelocitySchema = z.object({
  currentTurnsToAcceptance: z.number(),
  previousTurnsToAcceptance: z.number(),
  velocityChange: z.number(),
  dataPoints: z.number().int(),
  trend: z.enum(["accelerating", "stable", "decelerating"]),
  velocityQuality: z.enum(["genuine", "hollow", "unknown"]).optional(),
  evidenceEventIds: z.array(z.string()).default([]),
});

export const VelocitySchema = z.object({
  byDomain: z.record(z.string(), DomainVelocitySchema),
  overallTrend: z.enum(["accelerating", "stable", "decelerating"]),
  overallMagnitude: z.number(),
  dataPoints: z.number().int(),
  updatedAt: z.string(),
  _meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
});

export type Velocity = z.infer<typeof VelocitySchema>;
export type DomainVelocity = z.infer<typeof DomainVelocitySchema>;

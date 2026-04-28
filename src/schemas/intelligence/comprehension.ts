import { z } from "zod";
import { AnalyzerOutputMetaSchema, DiagnosticMessageSchema } from "../intelligence-presentation.js";

export const TopContributorSchema = z.object({
  eventId: z.string(),
  impact: z.number(),
  summary: z.string(),
});

export const ModuleComprehensionDetailSchema = z.object({
  score: z.number().min(0).max(100),
  decisionsCount: z.number().int().min(0),
  lastUpdated: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceEventIds: z.array(z.string()).default([]),
  topContributors: z.array(TopContributorSchema).default([]),
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
      evidenceEventIds: z.array(z.string()).default([]),
    }),
  ),
  updatedAt: z.string(),
  _meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
});

export type ComprehensionRadar = z.infer<typeof ComprehensionRadarSchema>;

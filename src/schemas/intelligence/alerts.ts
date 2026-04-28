import { z } from "zod";
import { AnalyzerOutputMetaSchema, DiagnosticMessageSchema } from "../intelligence-presentation.js";

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const BlindSpotAlertSchema = z.object({
  id: z.string(),
  type: z.enum(["high-acceptance", "low-comprehension", "declining-direction"]),
  severity: AlertSeveritySchema,
  domain: z.string(),
  message: z.string(),
  detail: z.string(),
  metric: z.number(),
  threshold: z.number(),
  sustainedWeeks: z.number().int(),
  createdAt: z.string(),
  acknowledged: z.boolean(),
  acknowledgedAt: z.string().nullable(),
  evidenceEventIds: z.array(z.string()).default([]),
});

export const AlertsFileSchema = z.object({
  alerts: z.array(BlindSpotAlertSchema),
  maxPerWeek: z.number().int().default(2),
  lastGeneratedAt: z.string(),
  updatedAt: z.string(),
  _meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
});

export type BlindSpotAlert = z.infer<typeof BlindSpotAlertSchema>;
export type AlertsFile = z.infer<typeof AlertsFileSchema>;

// FILE: src/schemas/intelligence/alerts.ts
// UF-111: Schema for intelligence/alerts.json — Blind Spot Alerts.

import { z } from "zod";

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
});

export const AlertsFileSchema = z.object({
  alerts: z.array(BlindSpotAlertSchema),
  maxPerWeek: z.number().int().default(2),
  lastGeneratedAt: z.string(),
  updatedAt: z.string(),
});

export type BlindSpotAlert = z.infer<typeof BlindSpotAlertSchema>;
export type AlertsFile = z.infer<typeof AlertsFileSchema>;

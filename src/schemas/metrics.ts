import { z } from "zod";

export const MetricPresentationSchema = z.object({
  score: z.number(),
  label: z.string(),
  framing: z.string(),
  improvement: z.string().optional(),
  trend: z.enum(["up", "down", "stable"]).nullable(),
  trendMagnitude: z.number().optional(),
});

export type MetricPresentation = z.infer<typeof MetricPresentationSchema>;

export const DailyMetricSnapshotSchema = z.object({
  date: z.string(),
  rdi: z.number().min(0).max(100),
  dcs: z.number().min(0).max(100).nullable(),
  aq: z.number().min(0).max(100).nullable(),
  cwi: z.number().min(-10).max(10).nullable(),
  apiScore: z.number().min(0).max(100).nullable(),
  identityLabels: z.array(z.string()),
  topDomain: z.string().nullable(),
  decisionsCount: z.number().int().min(0),
  eventsProcessed: z.number().int().min(0),
  partial: z.boolean().optional(),
  directionDensity: z.number().min(0).max(100).optional(),
  comprehensionScore: z.number().min(0).max(100).nullable().optional(),
});

export type DailyMetricSnapshot = z.infer<typeof DailyMetricSnapshotSchema>;

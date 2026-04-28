import { z } from "zod";
import { AnalyzerOutputMetaSchema, DiagnosticMessageSchema } from "../intelligence-presentation.js";

export const RejectionEntrySchema = z.object({
  eventId: z.string(),
  date: z.string(),
  domain: z.string(),
  contentHash: z.string(),
  summary: z.string(),
  approach: z.string(),
  resolution: z.string().nullable(),
});

export const StuckLoopSchema = z.object({
  domain: z.string(),
  approach: z.string(),
  occurrences: z.number().int(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  resolution: z.string().nullable(),
  evidenceEventIds: z.array(z.string()).default([]),
});

export const RejectionIndexSchema = z.object({
  entries: z.array(RejectionEntrySchema),
  stuckLoops: z.array(StuckLoopSchema),
  updatedAt: z.string(),
  _meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
});

export type RejectionIndex = z.infer<typeof RejectionIndexSchema>;
export type RejectionEntry = z.infer<typeof RejectionEntrySchema>;
export type StuckLoop = z.infer<typeof StuckLoopSchema>;

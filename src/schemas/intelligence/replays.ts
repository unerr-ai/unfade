import { z } from "zod";
import { AnalyzerOutputMetaSchema, DiagnosticMessageSchema } from "../intelligence-presentation.js";

export const DecisionReplaySchema = z.object({
  id: z.string(),
  originalDecision: z.object({
    date: z.string(),
    decision: z.string(),
    domain: z.string(),
    rationale: z.string().nullable(),
  }),
  triggerReason: z.enum([
    "domain-drift",
    "alternative-validated",
    "echoed-dead-end",
    "contradiction",
    "supersession",
  ]),
  triggerDetail: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
  dismissed: z.boolean(),
  dismissedReason: z.string().nullable(),
  evidenceEventIds: z.array(z.string()).default([]),
});

export const ReplaysFileSchema = z.object({
  replays: z.array(DecisionReplaySchema),
  maxPerWeek: z.number().int().default(2),
  updatedAt: z.string(),
  _meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
});

export type DecisionReplay = z.infer<typeof DecisionReplaySchema>;
export type ReplaysFile = z.infer<typeof ReplaysFileSchema>;

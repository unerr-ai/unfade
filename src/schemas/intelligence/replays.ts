// FILE: src/schemas/intelligence/replays.ts
// UF-112: Schema for intelligence/replays.json — Decision Replay suggestions.

import { z } from "zod";

export const DecisionReplaySchema = z.object({
  id: z.string(),
  originalDecision: z.object({
    date: z.string(),
    decision: z.string(),
    domain: z.string(),
    rationale: z.string().nullable(),
  }),
  triggerReason: z.enum(["domain-drift", "alternative-validated", "echoed-dead-end"]),
  triggerDetail: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
  dismissed: z.boolean(),
  dismissedReason: z.string().nullable(),
});

export const ReplaysFileSchema = z.object({
  replays: z.array(DecisionReplaySchema),
  maxPerWeek: z.number().int().default(2),
  updatedAt: z.string(),
});

export type DecisionReplay = z.infer<typeof DecisionReplaySchema>;
export type ReplaysFile = z.infer<typeof ReplaysFileSchema>;

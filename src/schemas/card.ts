// FILE: src/schemas/card.ts
// UF-058: CardData schema — extracted from DailyDistill for card rendering.

import { z } from "zod";

export const CardDataSchema = z.object({
  date: z.string(),
  decisions: z.array(z.string()).max(3),
  domains: z.array(z.string()).max(3),
  reasoningDepth: z.number().min(0),
  deadEnds: z.number().int().min(0),
  decisionCount: z.number().int().min(0),
  aiModifiedPct: z.number().min(0).max(100),
});

export type CardData = z.infer<typeof CardDataSchema>;

export const CardGenerateInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type CardGenerateInput = z.infer<typeof CardGenerateInputSchema>;

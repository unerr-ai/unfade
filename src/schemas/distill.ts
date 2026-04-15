// FILE: src/schemas/distill.ts
// DailyDistill — auto-generated daily reasoning summary.

import { z } from "zod";

export const DailyDistillSchema = z.object({
  date: z.string().date(),
  summary: z.string(),
  decisions: z.array(
    z.object({
      decision: z.string(),
      rationale: z.string(),
      domain: z.string().optional(),
    }),
  ),
  eventsProcessed: z.number().int().min(0),
  themes: z.array(z.string()).optional(),
  deadEnds: z.array(z.string()).optional(),
});

export type DailyDistill = z.infer<typeof DailyDistillSchema>;

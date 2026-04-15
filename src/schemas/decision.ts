// FILE: src/schemas/decision.ts
// Decision — a single engineering decision captured from reasoning history.

import { z } from "zod";

export const DecisionSchema = z.object({
  date: z.string().date(),
  decision: z.string(),
  rationale: z.string(),
  alternativesEvaluated: z.array(z.string()),
  domain: z.string(),
  deadEnd: z.boolean().default(false),
  aiModified: z.boolean().default(false),
  sources: z.array(z.string()),
});

export type Decision = z.infer<typeof DecisionSchema>;

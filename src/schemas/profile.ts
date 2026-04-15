// FILE: src/schemas/profile.ts
// ReasoningModel — the developer's reasoning identity profile.
// Built up over time from captured decisions, trade-offs, and patterns.

import { z } from "zod";

export const ReasoningModelSchema = z.object({
  decisionStyle: z.enum(["deliberate", "intuitive", "data-driven", "consensus", "mixed"]),
  tradeOffWeights: z.record(z.string(), z.number().min(0).max(1)),
  domainDepth: z.record(z.string(), z.enum(["novice", "intermediate", "advanced", "expert"])),
  explorationHabits: z.object({
    triesToAlternatives: z.number().min(0),
    revertFrequency: z.number().min(0),
    prototypeBeforeCommit: z.boolean(),
  }),
  blindSpots: z.array(z.string()),
  failurePatterns: z.array(
    z.object({
      pattern: z.string(),
      frequency: z.number().min(0),
      lastOccurred: z.string().datetime(),
    }),
  ),
});

export type ReasoningModel = z.infer<typeof ReasoningModelSchema>;

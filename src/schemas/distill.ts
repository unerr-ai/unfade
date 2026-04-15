// FILE: src/schemas/distill.ts
// DailyDistill — auto-generated daily reasoning summary.
// ExtractedSignals / LinkedSignals — intermediate pipeline types for the
// three-stage distillation pipeline (extract → link → synthesize).

import { z } from "zod";

// ---------------------------------------------------------------------------
// DailyDistill — final output of the distillation pipeline
// ---------------------------------------------------------------------------

export const DecisionSchema = z.object({
  decision: z.string(),
  rationale: z.string(),
  domain: z.string().optional(),
  alternativesConsidered: z.number().int().min(0).optional(),
});

export const TradeOffSchema = z.object({
  tradeOff: z.string(),
  chose: z.string(),
  rejected: z.string(),
  context: z.string().optional(),
});

export const DeadEndSchema = z.object({
  description: z.string(),
  timeSpentMinutes: z.number().min(0).optional(),
  resolution: z.string().optional(),
});

export const BreakthroughSchema = z.object({
  description: z.string(),
  trigger: z.string().optional(),
});

export const DailyDistillSchema = z.object({
  date: z.string().date(),
  summary: z.string(),
  decisions: z.array(DecisionSchema),
  tradeOffs: z.array(TradeOffSchema).optional(),
  deadEnds: z.array(DeadEndSchema).optional(),
  breakthroughs: z.array(BreakthroughSchema).optional(),
  patterns: z.array(z.string()).optional(),
  eventsProcessed: z.number().int().min(0),
  themes: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(),
  synthesizedBy: z.enum(["llm", "fallback"]).optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;
export type TradeOff = z.infer<typeof TradeOffSchema>;
export type DeadEnd = z.infer<typeof DeadEndSchema>;
export type Breakthrough = z.infer<typeof BreakthroughSchema>;
export type DailyDistill = z.infer<typeof DailyDistillSchema>;

// ---------------------------------------------------------------------------
// ExtractedSignals — output of Stage 1 (signal extractor, no LLM)
// ---------------------------------------------------------------------------

export const ExtractedSignalsSchema = z.object({
  date: z.string().date(),
  decisions: z.array(
    z.object({
      eventId: z.string(),
      summary: z.string(),
      branch: z.string().optional(),
      alternativesCount: z.number().int().min(0).default(0),
    }),
  ),
  tradeOffs: z.array(
    z.object({
      eventId: z.string(),
      summary: z.string(),
      relatedFiles: z.array(z.string()).optional(),
    }),
  ),
  deadEnds: z.array(
    z.object({
      revertEventId: z.string(),
      summary: z.string(),
      timeSpentMinutes: z.number().min(0).optional(),
    }),
  ),
  breakthroughs: z.array(
    z.object({
      eventId: z.string(),
      summary: z.string(),
    }),
  ),
  debuggingSessions: z.array(
    z.object({
      eventIds: z.array(z.string()),
      summary: z.string(),
      fixCount: z.number().int().min(0),
    }),
  ),
  stats: z.object({
    totalEvents: z.number().int().min(0),
    commitCount: z.number().int().min(0),
    aiCompletions: z.number().int().min(0),
    aiRejections: z.number().int().min(0),
    branchSwitches: z.number().int().min(0),
    reverts: z.number().int().min(0),
    filesChanged: z.array(z.string()),
    domains: z.array(z.string()),
  }),
});

export type ExtractedSignals = z.infer<typeof ExtractedSignalsSchema>;

// ---------------------------------------------------------------------------
// LinkedSignals — output of Stage 2 (context linker, no LLM)
// ---------------------------------------------------------------------------

export const LinkedSignalsSchema = z.object({
  date: z.string().date(),
  decisions: z.array(
    z.object({
      eventId: z.string(),
      summary: z.string(),
      branch: z.string().optional(),
      alternativesCount: z.number().int().min(0),
      files: z.array(z.string()).optional(),
      repo: z.string().optional(),
      relatedAiConversations: z.array(z.string()).optional(),
    }),
  ),
  tradeOffs: z.array(
    z.object({
      eventId: z.string(),
      summary: z.string(),
      relatedFiles: z.array(z.string()).optional(),
      relatedCommits: z.array(z.string()).optional(),
    }),
  ),
  deadEnds: z.array(
    z.object({
      revertEventId: z.string(),
      summary: z.string(),
      timeSpentMinutes: z.number().min(0).optional(),
      revertedFiles: z.array(z.string()).optional(),
    }),
  ),
  breakthroughs: z.array(
    z.object({
      eventId: z.string(),
      summary: z.string(),
      triggeredBy: z.string().optional(),
    }),
  ),
  temporalChains: z.array(
    z.object({
      module: z.string(),
      eventIds: z.array(z.string()),
      summary: z.string(),
    }),
  ),
  stats: z.object({
    totalEvents: z.number().int().min(0),
    commitCount: z.number().int().min(0),
    aiCompletions: z.number().int().min(0),
    aiRejections: z.number().int().min(0),
    branchSwitches: z.number().int().min(0),
    reverts: z.number().int().min(0),
    filesChanged: z.array(z.string()),
    domains: z.array(z.string()),
    aiAcceptanceRate: z.number().min(0).max(1).optional(),
  }),
});

export type LinkedSignals = z.infer<typeof LinkedSignalsSchema>;

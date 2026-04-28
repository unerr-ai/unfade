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
  projectId: z.string().optional(),
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

export const DirectionClassificationSchema = z.enum([
  "human-directed",
  "collaborative",
  "llm-directed",
]);
export type DirectionClassification = z.infer<typeof DirectionClassificationSchema>;

export const DirectionSummarySchema = z.object({
  averageHDS: z.number().min(0).max(1),
  humanDirectedCount: z.number().int().min(0),
  collaborativeCount: z.number().int().min(0),
  llmDirectedCount: z.number().int().min(0),
  topHumanDirectedDecisions: z.array(z.string()),
});
export type DirectionSummary = z.infer<typeof DirectionSummarySchema>;

export const AICollaborationSummarySchema = z.object({
  toolBreakdown: z.array(
    z.object({
      tool: z.string(),
      sessionCount: z.number().int().min(0),
      eventCount: z.number().int().min(0),
    }),
  ),
  directionStyle: z.string(),
});
export type AICollaborationSummary = z.infer<typeof AICollaborationSummarySchema>;

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
  directionSummary: DirectionSummarySchema.optional(),
  aiCollaborationSummary: AICollaborationSummarySchema.optional(),
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
      /** Source type: "ai-conversation" or "commit" — helps downstream weighting */
      source: z.enum(["ai-conversation", "commit"]).optional(),
      /** Rich metadata from AI conversations (conversation title, turn count, files, tools) */
      conversationMeta: z
        .object({
          conversationTitle: z.string().optional(),
          turnCount: z.number().int().min(0).optional(),
          filesModified: z.array(z.string()).optional(),
          toolsUsed: z.array(z.string()).optional(),
        })
        .optional(),
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
    executionPhaseBreakdown: z
      .record(z.string(), z.number().int().min(0))
      .optional()
      .describe("Count of events per execution phase (exploring, implementing, debugging, etc.)"),
    outcomeBreakdown: z
      .record(z.string(), z.number().int().min(0))
      .optional()
      .describe("Count of events per outcome (success, partial, failed, abandoned)"),
  }),
});

export type ExtractedSignals = z.infer<typeof ExtractedSignalsSchema>;

// ---------------------------------------------------------------------------
// ConversationDigest — output of Stage 1.5 (conversation digester)
// Per-conversation structured extraction of decisions from AI chat threads.
// ---------------------------------------------------------------------------

export const DigestedDecisionSchema = z.object({
  decision: z.string().describe("Concise decision statement: 'Chose X over Y'"),
  rationale: z.string().describe("Why the decision was made"),
  domain: z.string().optional().describe("Technical domain: auth, database, UI, etc."),
  alternativesConsidered: z.number().int().min(0).optional(),
});

export type DigestedDecision = z.infer<typeof DigestedDecisionSchema>;

export const ConversationDigestSchema = z.object({
  eventId: z.string(),
  decisions: z.array(DigestedDecisionSchema),
  tradeOffs: z.array(z.string()).optional(),
  keyInsights: z.array(z.string()).optional(),
  filesActedOn: z.array(z.string()).optional(),
  conversationSummary: z
    .string()
    .describe("What the conversation accomplished, not the raw prompt"),
});

export type ConversationDigest = z.infer<typeof ConversationDigestSchema>;

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
      source: z.enum(["ai-conversation", "commit"]).optional(),
      conversationMeta: z
        .object({
          conversationTitle: z.string().optional(),
          turnCount: z.number().int().min(0).optional(),
          filesModified: z.array(z.string()).optional(),
          toolsUsed: z.array(z.string()).optional(),
        })
        .optional(),
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

// ---------------------------------------------------------------------------
// Enriched Distill v2 — Narrative-driven distillation output (Layer 6)
// ---------------------------------------------------------------------------

export const ArcTypeSchema = z.enum([
  "exploration",
  "convergence",
  "deep-dive",
  "scattered",
  "routine",
]);
export type ArcType = z.infer<typeof ArcTypeSchema>;

export const SignalTierSchema = z.enum(["primary", "supporting", "background"]);
export type SignalTier = z.infer<typeof SignalTierSchema>;

/** Impact score breakdown — weighted 5-factor model */
export const ImpactScoreSchema = z.object({
  total: z.number().min(0).max(100),
  factors: z.object({
    scope: z.number().min(0).max(100),
    alternatives: z.number().min(0).max(100),
    corroboration: z.number().min(0).max(100),
    temporalInvestment: z.number().min(0).max(100),
    directionStrength: z.number().min(0).max(100),
  }),
});
export type ImpactScore = z.infer<typeof ImpactScoreSchema>;

/** A signal scored and assigned to a priority tier */
export const ScoredSignalSchema = z.object({
  type: z.enum(["decision", "tradeOff", "deadEnd", "breakthrough"]),
  index: z.number().int().min(0),
  impactScore: ImpactScoreSchema,
  tier: SignalTierSchema,
  corroborationGroup: z.string().optional(),
});
export type ScoredSignal = z.infer<typeof ScoredSignalSchema>;

/** Cross-source corroboration group */
export const CorroborationGroupSchema = z.object({
  id: z.string(),
  signalIndices: z.array(
    z.object({
      type: z.enum(["decision", "tradeOff", "deadEnd", "breakthrough"]),
      index: z.number().int().min(0),
    }),
  ),
  sources: z.array(z.string()),
  similarity: z.number().min(0).max(1),
});
export type CorroborationGroup = z.infer<typeof CorroborationGroupSchema>;

/** Day shape classification */
export const DayShapeSchema = z.object({
  dominantDomain: z.string(),
  peakActivityHour: z.number().int().min(0).max(23),
  arcType: ArcTypeSchema,
});
export type DayShape = z.infer<typeof DayShapeSchema>;

/** Triaged signals — ExtractedSignals with prioritization overlay */
export const TriagedSignalsSchema = ExtractedSignalsSchema.extend({
  prioritized: z.object({
    primary: z.array(ScoredSignalSchema),
    supporting: z.array(ScoredSignalSchema),
    background: z.array(ScoredSignalSchema),
  }),
  corroborations: z.array(CorroborationGroupSchema),
  dayShape: DayShapeSchema,
});
export type TriagedSignals = z.infer<typeof TriagedSignalsSchema>;

/** Evidence chain — ordered sequence of events contributing to a decision */
export const EvidenceChainSchema = z.object({
  eventIds: z.array(z.string()),
  roles: z.record(
    z.string(),
    z.enum(["trigger", "exploration", "decision", "implementation", "verification"]),
  ),
  chainSummary: z.string(),
});
export type EvidenceChain = z.infer<typeof EvidenceChainSchema>;

/** Continuity thread — cross-day unresolved question */
export const ContinuityThreadSchema = z.object({
  question: z.string(),
  evidenceEventIds: z.array(z.string()).default([]),
  domain: z.string(),
  continuedFrom: z.string().optional(),
  resolved: z.boolean().default(false),
  resolvingDecisionIndex: z.number().int().optional(),
});
export type ContinuityThread = z.infer<typeof ContinuityThreadSchema>;

/** Narrative act — a temporal window of related activity */
export const NarrativeActSchema = z.object({
  timeWindow: z.object({ start: z.string(), end: z.string() }),
  trigger: z.string(),
  decisionIndices: z.array(z.number().int()),
  tradeOffIndices: z.array(z.number().int()),
  deadEndIndices: z.array(z.number().int()),
  causedBy: z.number().int().optional(),
  ledTo: z.number().int().optional(),
});
export type NarrativeAct = z.infer<typeof NarrativeActSchema>;

/** Narrative spine — temporal causal structure of the day */
export const NarrativeSpineSchema = z.object({
  arc: z.object({
    type: ArcTypeSchema,
    headline: z.string(),
    openingContext: z.string(),
    closingState: z.string(),
  }),
  acts: z.array(NarrativeActSchema),
  continuityThreads: z.array(ContinuityThreadSchema),
});
export type NarrativeSpine = z.infer<typeof NarrativeSpineSchema>;

/** Enriched decision — with impact scoring, evidence chain, causal links */
export const EnrichedDecisionSchema = z.object({
  decision: z.string(),
  rationale: z.string(),
  domain: z.string().optional(),
  alternativesConsidered: z.number().int().min(0).default(0),
  impactScore: z.number().min(0).max(100),
  tier: SignalTierSchema,
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  evidenceEventIds: z.array(z.string()).default([]),
  causalTrigger: z.string().optional(),
  outcome: z.string().optional(),
  relatedTradeOffIndices: z.array(z.number().int()).default([]),
  relatedDeadEndIndices: z.array(z.number().int()).default([]),
  humanDirectionScore: z.number().min(0).max(1).optional(),
  directionClassification: z.enum(["human-directed", "collaborative", "ai-suggested"]).optional(),
  actIndex: z.number().int().optional(),
});
export type EnrichedDecision = z.infer<typeof EnrichedDecisionSchema>;

/** Enriched trade-off — with specific chose/rejected content */
export const EnrichedTradeOffSchema = z.object({
  tradeOff: z.string(),
  chose: z.string(),
  rejected: z.string(),
  context: z.string().optional(),
  parentDecisionIndex: z.number().int().optional(),
  evidenceEventIds: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
});
export type EnrichedTradeOff = z.infer<typeof EnrichedTradeOffSchema>;

/** Enriched dead end — with attempt summary and pivot link */
export const EnrichedDeadEndSchema = z.object({
  description: z.string(),
  attemptSummary: z.string(),
  timeSpentMinutes: z.number().min(0).optional(),
  resolution: z.string().optional(),
  pivotDecisionIndex: z.number().int().optional(),
  detectionMethod: z.enum(["revert", "branch-abandon", "explicit", "timeout"]),
  evidenceEventIds: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
});
export type EnrichedDeadEnd = z.infer<typeof EnrichedDeadEndSchema>;

/** Enriched breakthrough — with trigger context */
export const EnrichedBreakthroughSchema = z.object({
  description: z.string(),
  trigger: z.string().optional(),
  evidenceEventIds: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
});
export type EnrichedBreakthrough = z.infer<typeof EnrichedBreakthroughSchema>;

/** EnrichedDistill v2 — the full narrative-driven distill output */
export const EnrichedDistillSchema = z.object({
  date: z.string(),
  version: z.literal(2),
  narrative: NarrativeSpineSchema,
  decisions: z.array(EnrichedDecisionSchema),
  tradeOffs: z.array(EnrichedTradeOffSchema).default([]),
  deadEnds: z.array(EnrichedDeadEndSchema).default([]),
  breakthroughs: z.array(EnrichedBreakthroughSchema).default([]),
  patterns: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  continuityThreads: z.array(ContinuityThreadSchema).default([]),
  meta: z.object({
    eventsProcessed: z.number().int().min(0),
    synthesizedBy: z.enum(["llm", "fallback"]),
    synthesizedAt: z.string(),
    signalCounts: z.object({
      primary: z.number().int().min(0),
      supporting: z.number().int().min(0),
      background: z.number().int().min(0),
    }),
    dayShape: DayShapeSchema,
  }),
  directionSummary: DirectionSummarySchema.optional(),
  aiCollaborationSummary: AICollaborationSummarySchema.optional(),
});
export type EnrichedDistill = z.infer<typeof EnrichedDistillSchema>;

/** Convert enriched v2 distill to v1 DailyDistill for backward compat */
export function enrichedToV1(enriched: EnrichedDistill): DailyDistill {
  return {
    date: enriched.date,
    summary: enriched.narrative.arc.headline,
    decisions: enriched.decisions.map((d) => ({
      decision: d.decision,
      rationale: d.rationale,
      domain: d.domain,
      alternativesConsidered: d.alternativesConsidered,
      projectId: d.projectId,
    })),
    tradeOffs: enriched.tradeOffs.map((t) => ({
      tradeOff: t.tradeOff,
      chose: t.chose,
      rejected: t.rejected,
      context: t.context,
    })),
    deadEnds: enriched.deadEnds.map((d) => ({
      description: d.description,
      timeSpentMinutes: d.timeSpentMinutes,
      resolution: d.resolution,
    })),
    breakthroughs: enriched.breakthroughs.map((b) => ({
      description: b.description,
      trigger: b.trigger,
    })),
    eventsProcessed: enriched.meta.eventsProcessed,
    synthesizedBy: enriched.meta.synthesizedBy,
    domains: enriched.domains,
    patterns: enriched.patterns,
    directionSummary: enriched.directionSummary,
    aiCollaborationSummary: enriched.aiCollaborationSummary,
  };
}

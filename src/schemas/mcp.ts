// FILE: src/schemas/mcp.ts
// UF-046: MCP Zod schemas — input/output contracts for all MCP tools.
// Every schema exports BOTH the Zod schema AND the inferred TypeScript type.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared _meta envelope for MCP tool responses
// ---------------------------------------------------------------------------

export const McpMetaSchema = z.object({
  tool: z.string(),
  durationMs: z.number(),
  degraded: z.boolean().default(false),
  degradedReason: z.string().optional(),
  lastUpdated: z.string().nullable(),
  personalizationLevel: z.string().optional(),
  provenance: z
    .object({
      sourceEventIds: z.array(z.string()).default([]),
      lineageUrl: z.string().optional(),
    })
    .optional(),
});

export type McpMeta = z.infer<typeof McpMetaSchema>;

// ---------------------------------------------------------------------------
// unfade-query
// ---------------------------------------------------------------------------

export const QueryInputSchema = z.object({
  query: z.string().min(1),
  project: z.string().optional(),
  dateRange: z
    .object({
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type QueryInput = z.infer<typeof QueryInputSchema>;

export const QueryResultItemSchema = z.object({
  source: z.enum(["event", "distill"]),
  date: z.string(),
  summary: z.string(),
  detail: z.string().optional(),
  score: z.number().min(0).max(1),
});

export type QueryResultItem = z.infer<typeof QueryResultItemSchema>;

export const QueryOutputSchema = z.object({
  data: z.object({
    results: z.array(QueryResultItemSchema),
    total: z.number().int().min(0),
  }),
  _meta: McpMetaSchema,
});

export type QueryOutput = z.infer<typeof QueryOutputSchema>;

// ---------------------------------------------------------------------------
// unfade-context
// ---------------------------------------------------------------------------

export const ContextInputSchema = z.object({
  scope: z.enum(["last_2h", "today", "this_week"]).default("today"),
  project: z.string().optional(),
});

export type ContextInput = z.infer<typeof ContextInputSchema>;

export const ContextEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  source: z.string(),
  type: z.string(),
  summary: z.string(),
  detail: z.string().optional(),
  branch: z.string().optional(),
});

export type ContextEvent = z.infer<typeof ContextEventSchema>;

export const ContextOutputSchema = z.object({
  data: z.object({
    scope: z.string(),
    events: z.array(ContextEventSchema),
    eventCount: z.number().int().min(0),
    distillSummary: z.string().nullable(),
  }),
  _meta: McpMetaSchema,
});

export type ContextOutput = z.infer<typeof ContextOutputSchema>;

// ---------------------------------------------------------------------------
// unfade-decisions
// ---------------------------------------------------------------------------

export const DecisionsInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  domain: z.string().optional(),
  /** Substring match on decision + rationale (distill-backed list). */
  q: z.string().optional(),
  /** Filter decisions to those on or after (today − N days), by distill file date. */
  period: z.enum(["7d", "30d", "90d"]).optional(),
  project: z.string().optional(),
});

export type DecisionsInput = z.infer<typeof DecisionsInputSchema>;

export const DecisionItemSchema = z.object({
  date: z.string(),
  decision: z.string(),
  rationale: z.string(),
  domain: z.string().optional(),
  alternativesConsidered: z.number().int().min(0).optional(),
});

export type DecisionItem = z.infer<typeof DecisionItemSchema>;

export const DecisionsOutputSchema = z.object({
  data: z.object({
    decisions: z.array(DecisionItemSchema),
    total: z.number().int().min(0),
  }),
  _meta: McpMetaSchema,
});

export type DecisionsOutput = z.infer<typeof DecisionsOutputSchema>;

// ---------------------------------------------------------------------------
// unfade-profile
// ---------------------------------------------------------------------------

export const DomainEntrySchema = z.object({
  domain: z.string(),
  frequency: z.number().min(0),
  lastSeen: z.string(),
});

export type DomainEntryOutput = z.infer<typeof DomainEntrySchema>;

export const ProfileOutputSchema = z.object({
  data: z.object({
    version: z.number(),
    updatedAt: z.string(),
    distillCount: z.number().int().min(0),
    avgAlternativesEvaluated: z.number().min(0),
    aiAcceptanceRate: z.number().min(0).max(1),
    aiModificationRate: z.number().min(0).max(1),
    avgDecisionsPerDay: z.number().min(0),
    avgDeadEndsPerDay: z.number().min(0),
    domainDistribution: z.array(DomainEntrySchema),
    patterns: z.array(z.string()),
  }),
  _meta: McpMetaSchema,
});

export type ProfileOutput = z.infer<typeof ProfileOutputSchema>;

// ---------------------------------------------------------------------------
// unfade-amplify
// ---------------------------------------------------------------------------

export const AmplifyInputSchema = z.object({
  date: z.string().date(),
  project: z.string().optional(),
});

export type AmplifyInput = z.infer<typeof AmplifyInputSchema>;

export const AmplificationConnectionSchema = z.object({
  today: z.string(),
  past: z.object({
    date: z.string(),
    decision: z.string(),
  }),
  relevance: z.number().min(0).max(1),
});

export type AmplificationConnection = z.infer<typeof AmplificationConnectionSchema>;

export const AmplifyOutputSchema = z.object({
  data: z.object({
    connections: z.array(AmplificationConnectionSchema),
    date: z.string(),
  }),
  _meta: McpMetaSchema,
});

export type AmplifyOutput = z.infer<typeof AmplifyOutputSchema>;

// ---------------------------------------------------------------------------
// unfade-similar
// ---------------------------------------------------------------------------

export const SimilarInputSchema = z.object({
  problem: z.string().min(1),
  project: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type SimilarInput = z.infer<typeof SimilarInputSchema>;

export const SimilarResultItemSchema = z.object({
  date: z.string(),
  decision: z.string(),
  rationale: z.string(),
  domain: z.string().optional(),
  alternativesConsidered: z.number().int().min(0).optional(),
  relevance: z.number().min(0).max(1),
});

export type SimilarResultItem = z.infer<typeof SimilarResultItemSchema>;

export const SimilarOutputSchema = z.object({
  data: z.object({
    results: z.array(SimilarResultItemSchema),
    total: z.number().int().min(0),
  }),
  _meta: McpMetaSchema,
});

export type SimilarOutput = z.infer<typeof SimilarOutputSchema>;

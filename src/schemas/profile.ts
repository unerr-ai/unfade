// FILE: src/schemas/profile.ts
// ReasoningModel — the developer's reasoning identity profile.
// Built up over time from captured decisions, trade-offs, and patterns.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Pattern — detected reasoning pattern with confidence
// ---------------------------------------------------------------------------

export const PatternCategorySchema = z.enum([
  "decision_style",
  "trade_off",
  "domain",
  "ai_interaction",
  "exploration",
]);

export type PatternCategory = z.infer<typeof PatternCategorySchema>;

export const PatternV2Schema = z.object({
  pattern: z.string(),
  confidence: z.number().min(0).max(1),
  observedSince: z.string(),
  lastObserved: z.string(),
  examples: z.number().int().min(0),
  category: PatternCategorySchema,
});

export type PatternV2 = z.infer<typeof PatternV2Schema>;

// ---------------------------------------------------------------------------
// DomainDistributionV2 — domain tracking with depth and trend
// ---------------------------------------------------------------------------

export const DepthLevelSchema = z.enum(["shallow", "moderate", "deep"]);
export type DepthLevel = z.infer<typeof DepthLevelSchema>;

export const DepthTrendSchema = z.enum(["stable", "deepening", "broadening"]);
export type DepthTrend = z.infer<typeof DepthTrendSchema>;

export const DomainDistributionV2Schema = z.object({
  domain: z.string(),
  frequency: z.number().int().min(0),
  percentageOfTotal: z.number().min(0).max(1),
  lastSeen: z.string(),
  depth: DepthLevelSchema,
  depthTrend: DepthTrendSchema,
  avgAlternativesInDomain: z.number().min(0),
});

export type DomainDistributionV2 = z.infer<typeof DomainDistributionV2Schema>;

// ---------------------------------------------------------------------------
// TradeOffPreference — consistent trade-off pattern
// ---------------------------------------------------------------------------

export const TradeOffPreferenceSchema = z.object({
  preference: z.string(),
  confidence: z.number().min(0).max(1),
  supportingDecisions: z.number().int().min(0),
  contradictingDecisions: z.number().int().min(0),
  firstObserved: z.string(),
  lastObserved: z.string(),
});

export type TradeOffPreference = z.infer<typeof TradeOffPreferenceSchema>;

// ---------------------------------------------------------------------------
// Identity Labels — behavioral patterns surfaced as named identity traits
// ---------------------------------------------------------------------------

export const IdentityLabelSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  since: z.string(),
  category: PatternCategorySchema,
});

export type IdentityLabel = z.infer<typeof IdentityLabelSchema>;

// ---------------------------------------------------------------------------
// UIF Metrics — Unfade Intelligence Framework scores
// ---------------------------------------------------------------------------

export const UifMetricsSchema = z.object({
  rdi: z.number().min(0).max(100).nullable().optional(),
  dcs: z.number().min(0).max(100).nullable().optional(),
  aq: z.number().min(0).max(100).nullable().optional(),
  cwi: z.number().min(-10).max(10).nullable().optional(),
  apiScore: z.number().min(0).max(100).nullable().optional(),
});

export type UifMetrics = z.infer<typeof UifMetricsSchema>;

// ---------------------------------------------------------------------------
// ReasoningModelV2 — full personalization profile (on-disk format)
// ---------------------------------------------------------------------------

export const ReasoningModelV2Schema = z.object({
  version: z.literal(2),
  lastUpdated: z.string(),
  dataPoints: z.number().int().min(0),

  decisionStyle: z.object({
    avgAlternativesEvaluated: z.number().min(0),
    medianAlternativesEvaluated: z.number().min(0),
    explorationDepthMinutes: z.object({
      overall: z.number().min(0),
      byDomain: z.record(z.string(), z.number().min(0)),
    }),
    aiAcceptanceRate: z.number().min(0).max(1),
    aiModificationRate: z.number().min(0).max(1),
    aiModificationByDomain: z.record(z.string(), z.number().min(0).max(1)),
  }),

  tradeOffPreferences: z.array(TradeOffPreferenceSchema),

  domainDistribution: z.array(DomainDistributionV2Schema),

  patterns: z.array(PatternV2Schema),

  temporalPatterns: z.object({
    mostProductiveHours: z.array(z.number().int().min(0).max(23)),
    avgDecisionsPerDay: z.number().min(0),
    peakDecisionDays: z.array(z.string()),
  }),

  uifMetrics: UifMetricsSchema.optional(),
  identityLabels: z.array(IdentityLabelSchema).optional(),

  directionPatterns: z
    .object({
      runningAverageHDS: z.number().min(0).max(1),
      trend: z.enum(["improving", "stable", "declining"]),
      commonSignals: z.array(z.string()),
      byDomain: z.record(
        z.string(),
        z.object({
          avgHDS: z.number().min(0).max(1),
          decisionCount: z.number().int().min(0),
        }),
      ),
      dataPoints: z.number().int().min(0),
    })
    .optional(),
});

export type ReasoningModelV2 = z.infer<typeof ReasoningModelV2Schema>;

// FILE: src/schemas/intelligence-presentation.ts
// Layer 4 IP-1.1: Shared schemas for the Intelligence Presentation layer.
// Single source of truth for types used across evidence linker, correlation engine,
// API endpoints, and React UI components.
//
// Three pillars:
//   1. AnalyzerOutputMeta — freshness, confidence, and data quality per analyzer
//   2. EvidenceChain — per-metric drill-through linking metrics to source events
//   3. Correlation — cross-analyzer insights linking patterns across multiple analyzers

import { z } from "zod";

// ─── Analyzer Output Meta ───────────────────────────────────────────────────
// Added to every analyzer output for freshness badges and confidence indicators.

export const AnalyzerOutputMetaSchema = z.object({
  updatedAt: z.string(),
  dataPoints: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  watermark: z.string(),
  stalenessMs: z.number(),
});
export type AnalyzerOutputMeta = z.infer<typeof AnalyzerOutputMetaSchema>;

// ─── Diagnostic Message ─────────────────────────────────────────────────────
// Per-analyzer actionable insights with evidence backing and cross-analyzer links.

export const DiagnosticMessageSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string(),
  evidence: z.string(),
  actionable: z.string(),
  relatedAnalyzers: z.array(z.string()).default([]),
  evidenceEventIds: z.array(z.string()).default([]),
});
export type DiagnosticMessage = z.infer<typeof DiagnosticMessageSchema>;

// ─── Evidence Chain ─────────────────────────────────────────────────────────
// Per-metric drill-through: links a metric to the source events that produced it.

export const EvidenceEntrySchema = z.object({
  eventId: z.string(),
  timestamp: z.string(),
  source: z.string(),
  type: z.string(),
  summary: z.string(),
  contribution: z.number(),
  role: z.enum(["primary", "corroborating", "context"]),
});
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;

export const EvidenceChainSchema = z.object({
  metric: z.string(),
  scope: z.string().optional(),
  events: z.array(EvidenceEntrySchema),
  analyzers: z.array(z.string()),
  confidence: z.number(),
});
export type EvidenceChain = z.infer<typeof EvidenceChainSchema>;

// ─── Correlation ────────────────────────────────────────────────────────────
// Cross-analyzer insight: a pattern detected across 2+ analyzers in the same domain.

export const CorrelationSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  explanation: z.string(),
  analyzers: z.array(z.string()),
  domain: z.string().optional(),
  evidenceEventIds: z.array(z.string()).default([]),
  actionable: z.string(),
  detectedAt: z.string(),
});
export type Correlation = z.infer<typeof CorrelationSchema>;

// ─── Metric Decomposition ───────────────────────────────────────────────────
// Transparent formula breakdown for composite metrics (AES, autonomy, etc.).

export const MetricComponentSchema = z.object({
  name: z.string(),
  value: z.number(),
  weight: z.number(),
  contribution: z.number(),
  trend: z.enum(["improving", "stable", "declining"]).optional(),
});
export type MetricComponent = z.infer<typeof MetricComponentSchema>;

export const MetricDecompositionSchema = z.object({
  compositeValue: z.number(),
  components: z.array(MetricComponentSchema),
  formula: z.string().optional(),
});
export type MetricDecomposition = z.infer<typeof MetricDecompositionSchema>;

// ─── Enriched Analyzer Output (wraps any analyzer output with meta + evidence) ──

export const EnrichedAnalyzerOutputSchema = z.object({
  analyzerName: z.string(),
  meta: AnalyzerOutputMetaSchema,
  diagnostics: z.array(DiagnosticMessageSchema).default([]),
  evidenceChains: z.array(EvidenceChainSchema).default([]),
  decomposition: MetricDecompositionSchema.optional(),
});
export type EnrichedAnalyzerOutput = z.infer<typeof EnrichedAnalyzerOutputSchema>;

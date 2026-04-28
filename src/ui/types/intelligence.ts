// UI type definitions for intelligence API responses.
// Matches the Zod schemas in src/schemas/intelligence-presentation.ts
// and the enriched analyzer outputs from IP-3/IP-4.

// ─── Layer 4 Presentation Types ─────────────────────────────────────────────

export interface AnalyzerOutputMeta {
  updatedAt: string;
  dataPoints: number;
  confidence: "high" | "medium" | "low";
  watermark: string;
  stalenessMs: number;
}

export interface DiagnosticMessage {
  severity: "info" | "warning" | "critical";
  message: string;
  evidence: string;
  actionable: string;
  relatedAnalyzers: string[];
  evidenceEventIds: string[];
}

export interface EvidenceEntry {
  eventId: string;
  timestamp: string;
  source: string;
  type: string;
  summary: string;
  contribution: number;
  role: "primary" | "corroborating" | "context";
}

export interface EvidenceChain {
  metric: string;
  scope?: string;
  events: EvidenceEntry[];
  analyzers: string[];
  confidence: number;
}

export interface Correlation {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  explanation: string;
  analyzers: string[];
  domain?: string;
  evidenceEventIds: string[];
  actionable: string;
  detectedAt: string;
}

export interface MetricComponent {
  name: string;
  value: number;
  weight: number;
  contribution: number;
  trend?: "improving" | "stable" | "declining";
}

export interface MetricDecomposition {
  compositeValue: number;
  components: MetricComponent[];
  formula?: string;
}

// ─── Enriched Response Wrapper ──────────────────────────────────────────────

export interface IntelligenceResponseMeta {
  tool: string;
  durationMs?: number;
  freshness?: {
    updatedAt: string;
    dataPoints: number;
    confidence: string;
  } | null;
  evidenceAvailable?: boolean;
  correlations?: Correlation[];
  degraded?: boolean;
  degradedReason?: string;
}

export interface IntelligenceResponse<T> {
  data: T;
  _meta: IntelligenceResponseMeta;
}

// ─── Analyzer Output Types ──────────────────────────────────────────────────

export interface EfficiencySubMetric {
  value: number;
  weight: number;
  confidence: "high" | "medium" | "low";
  dataPoints: number;
  evidenceEventIds: string[];
}

export interface Efficiency {
  aes: number;
  confidence: "high" | "medium" | "low";
  subMetrics: Record<string, EfficiencySubMetric>;
  trend: "improving" | "stable" | "declining" | null;
  history: Array<{ date: string; aes: number }>;
  topInsight: string | null;
  period: string;
  updatedAt: string;
  _meta: AnalyzerOutputMeta;
  diagnostics: DiagnosticMessage[];
}

export interface Comprehension {
  overall: number;
  confidence: "high" | "medium" | "low";
  byModule: Record<string, {
    score: number;
    decisionsCount: number;
    lastUpdated: string;
    confidence: "high" | "medium" | "low";
    evidenceEventIds: string[];
    topContributors: Array<{ eventId: string; impact: number; summary: string }>;
  }>;
  byDomain: Record<string, number>;
  blindSpots: string[];
  blindSpotAlerts: Array<{
    module: string;
    score: number;
    eventCount: number;
    suggestion: string;
    evidenceEventIds: string[];
  }>;
  updatedAt: string;
  _meta: AnalyzerOutputMeta;
  diagnostics: DiagnosticMessage[];
}

export interface Velocity {
  byDomain: Record<string, {
    currentTurnsToAcceptance: number;
    previousTurnsToAcceptance: number;
    velocityChange: number;
    dataPoints: number;
    trend: "accelerating" | "stable" | "decelerating";
    velocityQuality?: "genuine" | "hollow" | "unknown";
    evidenceEventIds: string[];
  }>;
  overallTrend: "accelerating" | "stable" | "decelerating";
  overallMagnitude: number;
  dataPoints: number;
  updatedAt: string;
  _meta: AnalyzerOutputMeta;
  diagnostics: DiagnosticMessage[];
}

export interface CostDimension {
  key: string;
  eventCount: number;
  estimatedCost: number;
  percentage: number;
  evidenceEventIds: string[];
}

export interface Costs {
  totalEstimatedCost: number;
  period: string;
  isProxy: true;
  byModel: CostDimension[];
  byDomain: CostDimension[];
  byBranch: CostDimension[];
  byFeature?: CostDimension[];
  abandonedWaste?: { eventCount: number; estimatedCost: number };
  wasteRatio: number | null;
  contextOverhead: number | null;
  projectedMonthlyCost: number | null;
  costPerDirectedDecision: number | null;
  updatedAt: string;
  disclaimer: string;
  _meta: AnalyzerOutputMeta;
  diagnostics: DiagnosticMessage[];
}

export interface PromptPatterns {
  effectivePatterns: Array<{
    domain: string;
    pattern: string;
    acceptanceRate: number;
    sampleSize: number;
    entities?: string[];
    exampleSessionIds: string[];
  }>;
  antiPatterns: Array<{
    domain: string;
    pattern: string;
    rejectionRate: number;
    suggestion: string;
    exampleSessionIds: string[];
  }>;
  updatedAt: string;
  totalPromptsAnalyzed: number;
  _meta: AnalyzerOutputMeta;
  diagnostics: DiagnosticMessage[];
}

export interface Alerts {
  alerts: Array<{
    id: string;
    type: string;
    severity: "info" | "warning" | "critical";
    domain: string;
    message: string;
    detail: string;
    metric: number;
    threshold: number;
    sustainedWeeks: number;
    createdAt: string;
    acknowledged: boolean;
    acknowledgedAt: string | null;
    evidenceEventIds: string[];
  }>;
  maxPerWeek: number;
  lastGeneratedAt: string;
  updatedAt: string;
  _meta: AnalyzerOutputMeta;
  diagnostics: DiagnosticMessage[];
}

export interface Replays {
  replays: Array<{
    id: string;
    originalDecision: { date: string; decision: string; domain: string; rationale: string | null };
    triggerReason: string;
    triggerDetail: string;
    confidence: number;
    createdAt: string;
    dismissed: boolean;
    dismissedReason: string | null;
    evidenceEventIds: string[];
  }>;
  maxPerWeek: number;
  updatedAt: string;
  _meta: AnalyzerOutputMeta;
  diagnostics: DiagnosticMessage[];
}

export interface Autonomy {
  independenceIndex: number;
  breakdown: {
    hds: number;
    modificationRate: number;
    alternativesEval: number;
    comprehensionTrend: number;
  };
  trend: "improving" | "stable" | "declining";
  hdsHistory: Array<{ date: string; value: number }>;
  dependencyMap: Array<{ domain: string; acceptanceRate: number; comprehension: number }>;
}

export interface MaturityAssessment {
  phase: number;
  phaseLabel: string;
  overallScore: number;
  dimensions: Record<string, number>;
  bottleneck?: { dimension: string; score: number };
  trajectory?: Array<{ date: string; score: number }>;
  nextPhaseRequirements?: Array<{ description: string; met: boolean }>;
}

export interface EntityExploreResult {
  entityId: string;
  entity: {
    id: string;
    type: string;
    name: string;
    domain: string;
    confidence: number;
    state: Record<string, unknown>;
  } | null;
  neighbors: Array<{ id: string; type: string; weight: number }>;
  evidenceEventIds: string[];
}

export interface WarmingUp {
  status: "warming_up";
  message: string;
}

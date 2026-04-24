export interface EfficiencySubMetric {
  value: number;
  weight: number;
  confidence: "high" | "medium" | "low";
  dataPoints: number;
}

export interface Efficiency {
  aes: number;
  confidence: "high" | "medium" | "low";
  subMetrics: Record<string, EfficiencySubMetric>;
  trend: "improving" | "stable" | "declining";
  history: Array<{ date: string; aes: number }>;
  topInsight?: string;
  period?: string;
  updatedAt?: string;
}

export interface Comprehension {
  overall: number | null;
  confidence?: "high" | "medium" | "low";
  byModule?: Record<string, { score: number; sessions: number; trend?: string }>;
  byDomain?: Record<string, { score: number; sessions: number }>;
  blindSpots?: Array<{ module: string; reason?: string; severity?: string }>;
  blindSpotAlerts?: Array<{ module: string; sustained_weeks?: number }>;
}

export interface Velocity {
  byDomain?: Record<
    string,
    {
      turnsToAcceptance: { current: number; previous: number; trend: string };
      sessionsCount: number;
    }
  >;
  overallTrend?: string;
  overallMagnitude?: number;
  dataPoints?: number;
}

export interface Costs {
  totalEstimatedCost: number;
  period?: string;
  isProxy: boolean;
  byModel?: Record<string, { cost: number; sessions: number; percentage: number }>;
  byDomain?: Record<string, { cost: number; sessions: number }>;
  abandonedWaste?: number;
  wasteRatio?: number;
  costPerDirectedDecision?: number;
  projectedMonthlyCost?: number;
  disclaimer?: string;
}

export interface PromptPatterns {
  effectivePatterns: Array<{
    pattern: string;
    description: string;
    avgDirectionScore: number;
    occurrences: number;
    example?: string;
  }>;
  antiPatterns: Array<{
    pattern: string;
    description: string;
    avgDirectionScore: number;
    occurrences: number;
    suggestion?: string;
  }>;
  totalPromptsAnalyzed: number;
}

export interface Alerts {
  alerts: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    severity: string;
    sustainedWeeks?: number;
    detectedAt?: string;
  }>;
  maxPerWeek?: number;
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

export interface WarmingUp {
  status: "warming_up";
  message: string;
}

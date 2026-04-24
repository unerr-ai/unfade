export interface SummaryJson {
  schemaVersion: 1;
  updatedAt: string;
  freshnessMs: number;
  directionDensity24h: number;
  eventCount24h: number;
  comprehensionScore: number | null;
  topDomain: string | null;
  toolMix: Record<string, number>;
  reasoningVelocityProxy: number | null;
  firstRunComplete: boolean;
  costPerDirectedDecision?: number | null;
  costQualityTrend?: "improving" | "stable" | "declining" | null;
  todaySpendProxy?: number;
  todayDirectedDecisions?: number;
}

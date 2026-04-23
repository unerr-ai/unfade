// FILE: src/services/intelligence/analyzers/all.ts
// Barrel export of all IncrementalAnalyzer instances for engine registration.

import { profileAccumulatorAnalyzer } from "../../personalization/profile-accumulator.js";
import { causalityChainAnalyzer } from "../causality.js";
import { dualVelocityAnalyzer } from "../cross-dual-velocity.js";
import { efficiencySurvivalAnalyzer } from "../cross-efficiency-survival.js";
import { maturityOwnershipAnalyzer } from "../cross-maturity-ownership.js";
import { directionByFileAnalyzer } from "../file-direction.js";
import { aiGitLinkerAnalyzer } from "../git-ai-linker.js";
import { commitAnalyzer } from "../git-commit-analyzer.js";
import { expertiseMapAnalyzer } from "../git-expertise-map.js";
import { fileChurnAnalyzer } from "../git-file-churn.js";
import type { IncrementalAnalyzer } from "../incremental-state.js";
import { intelligenceSnapshotAnalyzer } from "../intelligence-snapshots.js";
import { maturityModelAnalyzer } from "../maturity-model.js";
import { narrativeEngineAnalyzer } from "../narrative-engine.js";
import { sessionIntelligenceAnalyzer } from "../session-intelligence.js";
import { summaryWriterAnalyzer } from "../summary-writer.js";
import { tokenProxyAnalyzer } from "../token-proxy.js";
import { windowAggregatorAnalyzer } from "../window-aggregator.js";
import { blindSpotDetectorAnalyzer } from "./blind-spots.js";
import { comprehensionRadarAnalyzer } from "./comprehension-radar.js";
import { costAttributionAnalyzer } from "./cost-attribution.js";
import { decisionReplayAnalyzer } from "./decision-replay.js";
import { efficiencyAnalyzer } from "./efficiency.js";
import { loopDetectorAnalyzer } from "./loop-detector.js";
import { promptPatternsAnalyzer } from "./prompt-patterns.js";
import { velocityTrackerAnalyzer } from "./velocity-tracker.js";

/**
 * All incremental analyzers in recommended execution order.
 * Leaf nodes first (no dependencies), dependent nodes last.
 * The IntelligenceScheduler processes them in topological order.
 */
export const allAnalyzers: IncrementalAnalyzer<unknown, unknown>[] = [
  // Leaf nodes (no dependencies)
  directionByFileAnalyzer,
  tokenProxyAnalyzer,
  windowAggregatorAnalyzer,
  efficiencyAnalyzer,
  comprehensionRadarAnalyzer,
  costAttributionAnalyzer,
  loopDetectorAnalyzer,
  velocityTrackerAnalyzer,
  promptPatternsAnalyzer,
  blindSpotDetectorAnalyzer,
  decisionReplayAnalyzer,
  sessionIntelligenceAnalyzer,
  causalityChainAnalyzer,
  // Git intelligence (leaf nodes)
  commitAnalyzer,
  fileChurnAnalyzer,
  aiGitLinkerAnalyzer,
  expertiseMapAnalyzer,
  // Dependent: summary depends on window + token
  summaryWriterAnalyzer,
  // Dependent: snapshots depends on window + efficiency + session
  intelligenceSnapshotAnalyzer,
  // Dependent: profile accumulator depends on efficiency + window
  profileAccumulatorAnalyzer,
  // Cross-source integration (depends on AI + git analyzers)
  efficiencySurvivalAnalyzer,
  dualVelocityAnalyzer,
  // Dependent: maturity depends on most analyzers
  maturityModelAnalyzer,
  // Cross-source: maturity + ownership (depends on maturity + expertise)
  maturityOwnershipAnalyzer,
  // Terminal: narrative depends on maturity
  narrativeEngineAnalyzer,
];

// FILE: src/services/intelligence/analyzers/all.ts
// 12A.1: Barrel export of all analyzer instances for engine registration.

import { blindSpotDetectorAnalyzer } from "./blind-spots.js";
import { comprehensionRadarAnalyzer } from "./comprehension-radar.js";
import { costAttributionAnalyzer } from "./cost-attribution.js";
import { decisionReplayAnalyzer } from "./decision-replay.js";
import { efficiencyAnalyzer } from "./efficiency.js";
import type { Analyzer } from "./index.js";
import { loopDetectorAnalyzer } from "./loop-detector.js";
import { promptPatternsAnalyzer } from "./prompt-patterns.js";
import { velocityTrackerAnalyzer } from "./velocity-tracker.js";

/** All 8 analyzers in recommended execution order (cheapest first). */
export const allAnalyzers: Analyzer[] = [
  efficiencyAnalyzer,
  comprehensionRadarAnalyzer,
  costAttributionAnalyzer,
  loopDetectorAnalyzer,
  velocityTrackerAnalyzer,
  promptPatternsAnalyzer,
  blindSpotDetectorAnalyzer,
  decisionReplayAnalyzer,
];

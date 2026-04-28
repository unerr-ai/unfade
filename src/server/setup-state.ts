// FILE: src/server/setup-state.ts
// Cached check for onboarding setup completion state.
// Used by middleware (http.ts) and route handlers (settings.ts).
// Also tracks materialization progress for the synthesis banner.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getIntelligenceDir, getStateDir } from "../utils/paths.js";

let _setupComplete: boolean | null = null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Discovery {
  ts: string;
  message: string;
  icon: string;
}

export interface InsightPreview {
  ts: string;
  analyzer: string;
  title: string;
  headline: string;
  icon: string;
}

export interface SynthesisProgress {
  percent: number;
  totalEvents: number;
  processedEvents: number;
  phase: "pending" | "materializing" | "analyzing" | "complete";
  synthesisCompletedAt: string | null;
  materializationPercent: number;
  intelligencePercent: number;
  coreFilesTotal: number;
  coreFilesComplete: number;
  currentStage: string | null;
  stageDetail: string | null;
  discoveries: Discovery[];
  insights: InsightPreview[];
}

// ---------------------------------------------------------------------------
// Core intelligence files — must all exist before onboarding completes
// ---------------------------------------------------------------------------

const CORE_INTELLIGENCE_FILES = [
  "efficiency.json",
  "comprehension.json",
  "velocity.json",
  "prompt-patterns.json",
  "cost-attribution.json",
  "decision-replay.json",
  "rejections.json",
] as const;

const MAX_DISCOVERIES = 30;
const MAX_INSIGHTS = 30;

// Explicit zero-event confirmation — prevents false short-circuit on default zeros
let _zeroEventsConfirmed = false;

// In-memory progress state — updated by materializer onTick, read by progress endpoint and banner
let _synthesisProgress: SynthesisProgress = {
  percent: 0,
  totalEvents: 0,
  processedEvents: 0,
  phase: "pending",
  synthesisCompletedAt: null,
  materializationPercent: 0,
  intelligencePercent: 0,
  coreFilesTotal: CORE_INTELLIGENCE_FILES.length,
  coreFilesComplete: 0,
  currentStage: null,
  stageDetail: null,
  discoveries: [],
  insights: [],
};

/**
 * Check whether onboarding setup is complete.
 * Reads setup-status.json once and caches the result until invalidated.
 */
export function isSetupComplete(): boolean {
  if (_setupComplete !== null) return _setupComplete;
  try {
    const stateDir = getStateDir();
    const statusPath = join(stateDir, "setup-status.json");
    const status = JSON.parse(readFileSync(statusPath, "utf-8"));
    _setupComplete = status.setupCompleted === true;
  } catch {
    _setupComplete = false;
  }
  return _setupComplete;
}

/**
 * Invalidate the cached setup state. Call after writing setup-status.json.
 */
export function invalidateSetupCache(): void {
  _setupComplete = null;
}

export function getSynthesisProgress(): SynthesisProgress {
  return {
    ..._synthesisProgress,
    discoveries: [..._synthesisProgress.discoveries],
    insights: [..._synthesisProgress.insights],
  };
}

export function updateSynthesisProgress(update: Partial<SynthesisProgress>): void {
  // Don't overwrite arrays via spread — use addDiscovery/addInsight instead
  const { discoveries: _d, insights: _i, ...safeUpdate } = update;
  _synthesisProgress = { ..._synthesisProgress, ...safeUpdate };

  // Recompute weighted overall percent: materialization 50%, intelligence 50%
  _synthesisProgress.percent = Math.round(
    _synthesisProgress.materializationPercent * 0.5 + _synthesisProgress.intelligencePercent * 0.5,
  );

  // Phase transitions
  if (
    _synthesisProgress.phase === "materializing" &&
    _synthesisProgress.materializationPercent >= 100
  ) {
    // Only skip intelligence if we've explicitly confirmed there are no events.
    // The `_zeroEventsConfirmed` flag is set by confirmZeroEvents() — defaults
    // to false so we never short-circuit on the initial default zeros.
    if (_zeroEventsConfirmed) {
      _synthesisProgress.phase = "complete";
      _synthesisProgress.percent = 100;
      _synthesisProgress.intelligencePercent = 100;
    } else {
      _synthesisProgress.phase = "analyzing";
    }
  }

  if (_synthesisProgress.phase === "analyzing" && _synthesisProgress.intelligencePercent >= 100) {
    _synthesisProgress.phase = "complete";
  }

  if (_synthesisProgress.phase === "complete" && !_synthesisProgress.synthesisCompletedAt) {
    _synthesisProgress.synthesisCompletedAt = new Date().toISOString();
    _synthesisProgress.currentStage = null;
    _synthesisProgress.stageDetail = null;
    // Write setupCompleted now that everything is truly done
    markSetupComplete();
  }
}

// ---------------------------------------------------------------------------
// Setup completion — deferred until synthesis actually finishes
// ---------------------------------------------------------------------------

export function markSetupComplete(): void {
  try {
    const stateDir = getStateDir();
    mkdirSync(stateDir, { recursive: true });
    const statusPath = join(stateDir, "setup-status.json");
    // Merge with existing data so we don't clobber configuredAt etc.
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(statusPath, "utf-8"));
    } catch {
      // start fresh
    }
    const merged = { ...existing, setupCompleted: true };
    writeFileSync(statusPath, JSON.stringify(merged, null, 2));
    _setupComplete = true;
  } catch {
    // non-fatal — will retry on next phase transition
  }
}

export function updateStage(stage: string, detail?: string): void {
  _synthesisProgress.currentStage = stage;
  _synthesisProgress.stageDetail = detail ?? null;
}

/**
 * Explicitly confirm that there are genuinely zero events in the events directory.
 * Must be called after actually scanning the events dir — never assume from default zeros.
 */
export function confirmZeroEvents(): void {
  _zeroEventsConfirmed = true;
}

// ---------------------------------------------------------------------------
// Intelligence completion check
// ---------------------------------------------------------------------------

let _intelligenceCacheComplete = false;

export function checkIntelligenceCompletion(): {
  total: number;
  complete: number;
  percent: number;
} {
  if (_intelligenceCacheComplete) {
    return {
      total: CORE_INTELLIGENCE_FILES.length,
      complete: CORE_INTELLIGENCE_FILES.length,
      percent: 100,
    };
  }

  const dir = getIntelligenceDir();
  let complete = 0;
  for (const file of CORE_INTELLIGENCE_FILES) {
    if (existsSync(join(dir, file))) complete++;
  }

  if (complete === CORE_INTELLIGENCE_FILES.length) {
    _intelligenceCacheComplete = true;
  }

  return {
    total: CORE_INTELLIGENCE_FILES.length,
    complete,
    percent: Math.round((complete / CORE_INTELLIGENCE_FILES.length) * 100),
  };
}

// ---------------------------------------------------------------------------
// Discovery / Insight helpers
// ---------------------------------------------------------------------------

export function addDiscovery(d: Discovery): void {
  if (_synthesisProgress.discoveries.length >= MAX_DISCOVERIES) {
    _synthesisProgress.discoveries.shift();
  }
  _synthesisProgress.discoveries.push(d);
}

export function addInsight(i: InsightPreview): void {
  // Deduplicate by analyzer name — keep latest
  _synthesisProgress.insights = _synthesisProgress.insights.filter(
    (existing) => existing.analyzer !== i.analyzer,
  );
  if (_synthesisProgress.insights.length >= MAX_INSIGHTS) {
    _synthesisProgress.insights.shift();
  }
  _synthesisProgress.insights.push(i);
}

/**
 * Check if the synthesis banner should still be shown.
 * Returns false if synthesis completed more than 5 minutes ago.
 */
export function shouldShowSynthesisBanner(): boolean {
  if (_synthesisProgress.phase === "pending") return false;
  if (_synthesisProgress.phase === "materializing" || _synthesisProgress.phase === "analyzing")
    return true;
  if (_synthesisProgress.synthesisCompletedAt) {
    const completedAt = new Date(_synthesisProgress.synthesisCompletedAt).getTime();
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() - completedAt < fiveMinutes;
  }
  return false;
}

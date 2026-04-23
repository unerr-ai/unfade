// FILE: src/services/intelligence/analyzers/comprehension-radar.ts
// UF-103 + 11E.7: Comprehension Radar — per-module comprehension with blind spot detection.
// Uses phase-normalized HDS baselines (11E.6) so debugging sessions aren't flagged as blind spots.

import type { ComprehensionRadar } from "../../../schemas/intelligence/comprehension.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import { computePhaseBaselines, isHdsConcerning, type PhaseBaseline } from "../phase-baselines.js";
import type { AnalyzerContext } from "./index.js";

const BLIND_SPOT_THRESHOLD = 40;
const MIN_EVENTS_FOR_BLIND_SPOT = 5;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ComprehensionRadarState {
  output: ComprehensionRadar;
}

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

type ModuleEntry = {
  score: number;
  decisionsCount: number;
  lastUpdated: string;
  confidence: "high" | "medium" | "low";
};

async function computeByModule(
  db: AnalyzerContext["analytics"],
  now: string,
  baselines: Record<string, PhaseBaseline>,
): Promise<Record<string, ModuleEntry>> {
  const modules: Record<string, ModuleEntry> = {};

  try {
    const result = await db.exec(
      `SELECT module, score, event_count, updated_at
       FROM comprehension_by_module
       ORDER BY event_count DESC`,
    );
    if (!result[0]?.values.length) return modules;

    const modulePhases = await getModuleDominantPhases(db);

    for (const row of result[0].values) {
      const module = row[0] as string;
      const rawScore = row[1] as number;
      const count = row[2] as number;
      const updated = (row[3] as string) ?? now;

      const dominantPhase = modulePhases[module];
      const score = adjustScoreForPhase(rawScore, dominantPhase, baselines);

      modules[module] = {
        score,
        decisionsCount: count,
        lastUpdated: updated,
        confidence: count >= 10 ? "high" : count >= 5 ? "medium" : "low",
      };
    }
  } catch {
    // table may not exist yet
  }

  return modules;
}

async function getModuleDominantPhases(
  db: AnalyzerContext["analytics"],
): Promise<Record<string, string>> {
  const phases: Record<string, string> = {};
  try {
    const result = await db.exec(
      `SELECT
        COALESCE(content_project, 'unknown') as module,
        execution_phase as phase,
        COUNT(*) as cnt
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '30 days'
        AND execution_phase IS NOT NULL
      GROUP BY module, phase
      ORDER BY module, cnt DESC`,
    );
    if (!result[0]?.values.length) return phases;

    const seen = new Set<string>();
    for (const row of result[0].values) {
      const module = row[0] as string;
      const phase = row[1] as string;
      if (!seen.has(module)) {
        phases[module] = phase;
        seen.add(module);
      }
    }
  } catch {
    // non-fatal
  }
  return phases;
}

/**
 * Adjust comprehension score based on execution phase.
 * A debugging session with HDS 0.3 is NORMAL — don't penalize it.
 */
function adjustScoreForPhase(
  rawScore: number,
  dominantPhase: string | undefined,
  baselines: Record<string, PhaseBaseline>,
): number {
  if (!dominantPhase) return rawScore;

  const rawHds = rawScore / 100;
  if (!isHdsConcerning(rawHds, dominantPhase, baselines)) {
    return Math.max(rawScore, 50);
  }

  return rawScore;
}

async function computeByDomain(db: AnalyzerContext["analytics"]): Promise<Record<string, number>> {
  const domains: Record<string, number> = {};

  try {
    const result = await db.exec(
      `SELECT domain, AVG(hds) as avg_hds
       FROM decisions
       WHERE domain IS NOT NULL AND domain != ''
       GROUP BY domain`,
    );
    if (!result[0]?.values.length) return domains;

    for (const row of result[0].values) {
      domains[row[0] as string] = Math.round((row[1] as number) * 100);
    }
  } catch {
    // table may not exist
  }

  return domains;
}

function computeOverall(
  byModule: Record<string, { score: number; decisionsCount: number }>,
): number {
  const entries = Object.values(byModule);
  if (entries.length === 0) return 0;

  let totalWeighted = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    totalWeighted += entry.score * entry.decisionsCount;
    totalWeight += entry.decisionsCount;
  }

  return totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 0;
}

function detectBlindSpots(byModule: Record<string, { score: number; decisionsCount: number }>): {
  blindSpots: string[];
  alerts: Array<{ module: string; score: number; eventCount: number; suggestion: string }>;
} {
  const blindSpots: string[] = [];
  const alerts: Array<{ module: string; score: number; eventCount: number; suggestion: string }> =
    [];

  for (const [module, data] of Object.entries(byModule)) {
    if (data.score < BLIND_SPOT_THRESHOLD && data.decisionsCount >= MIN_EVENTS_FOR_BLIND_SPOT) {
      blindSpots.push(module);
      alerts.push({
        module,
        score: data.score,
        eventCount: data.decisionsCount,
        suggestion: `Your comprehension in ${module} is ${data.score}. Consider reviewing AI-generated code more carefully in this area, or pair-program on the next change.`,
      });
    }
  }

  return { blindSpots, alerts };
}

// ---------------------------------------------------------------------------
// Full computation — assembles a ComprehensionRadar output
// ---------------------------------------------------------------------------

async function computeRadar(db: AnalyzerContext["analytics"]): Promise<ComprehensionRadar> {
  const now = new Date().toISOString();

  const { baselines } = await computePhaseBaselines(db);

  const byModule = await computeByModule(db, now, baselines);
  const byDomain = await computeByDomain(db);
  const overall = computeOverall(byModule);
  const { blindSpots, alerts } = detectBlindSpots(byModule);

  const totalDataPoints = Object.values(byModule).reduce((s, m) => s + m.decisionsCount, 0);

  return {
    overall,
    confidence: totalDataPoints >= 20 ? "high" : totalDataPoints >= 10 ? "medium" : "low",
    byModule,
    byDomain,
    blindSpots,
    blindSpotAlerts: alerts,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const comprehensionRadarAnalyzer: IncrementalAnalyzer<
  ComprehensionRadarState,
  ComprehensionRadar
> = {
  name: "comprehension-radar",
  outputFile: "comprehension-radar.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 10,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<ComprehensionRadarState>> {
    const output = await computeRadar(ctx.analytics);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: 0,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<ComprehensionRadarState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<ComprehensionRadarState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const output = await computeRadar(ctx.analytics);
    const changed =
      output.overall !== state.value.output.overall ||
      output.blindSpots.length !== state.value.output.blindSpots.length;

    return {
      state: {
        value: { output },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: changed ? Math.abs(output.overall - state.value.output.overall) : 0,
    };
  },

  derive(state: IncrementalState<ComprehensionRadarState>): ComprehensionRadar {
    return state.value.output;
  },

  contributeEntities(state, _batch) {
    const contributions: import("../../substrate/substrate-engine.js").EntityContribution[] = [];
    const output = state.value.output;
    const byModule = output.byModule ?? {};

    for (const [modulePath, data] of Object.entries(byModule)) {
      if (!data || !modulePath) continue;
      contributions.push({
        entityId: `feat-${modulePath.replace(/\//g, "-")}`,
        entityType: "feature",
        projectId: "",
        analyzerName: "comprehension-radar",
        stateFragment: {
          comprehension: (data.score ?? 0) / 100,
        },
        relationships: [],
      });
    }

    return contributions;
  },
};

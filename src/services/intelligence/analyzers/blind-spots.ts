// FILE: src/services/intelligence/analyzers/blind-spots.ts
// UF-111 + 11E.7: Blind Spot Detector — monitors acceptance rate, comprehension, direction trends.
// Uses phase-normalized HDS baselines (11E.6) to avoid false alerts during debugging sprints.
// Generates alerts when thresholds exceeded for 2+ weeks. Max 2 alerts per week.
// §7c: never surface based on <5 data points or <2 weeks sustained.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AlertsFile, BlindSpotAlert } from "../../../schemas/intelligence/alerts.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import { computePhaseBaselines, isHdsConcerning } from "../phase-baselines.js";
import { detectTrend } from "../utils/trend.js";
import type { AnalyzerContext } from "./index.js";

const MAX_ALERTS_PER_WEEK = 2;
const MIN_DATA_POINTS = 5;
const MIN_SUSTAINED_WEEKS = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface BlindSpotState {
  output: AlertsFile;
}

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

async function detectHighAcceptance(
  db: AnalyzerContext["analytics"],
  existing: AlertsFile,
  baselines: Record<string, import("../phase-baselines.js").PhaseBaseline>,
): Promise<BlindSpotAlert | null> {
  try {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    const result = await db.exec(
      `SELECT
        human_direction_score as hds,
        execution_phase as phase
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= $1::TIMESTAMP
        AND human_direction_score IS NOT NULL`,
      [twoWeeksAgo],
    );

    if (!result[0]?.values?.length) return null;
    const total = result[0].values.length;
    if (total < MIN_DATA_POINTS) return null;

    let lowDir = 0;
    for (const row of result[0].values) {
      const hds = row[0] as number;
      const phase = row[1] as string | null;
      if (hds < 0.2) {
        if (phase && !isHdsConcerning(hds, phase, baselines)) {
          continue;
        }
        lowDir++;
      }
    }

    const acceptRate = lowDir / total;
    if (acceptRate < 0.9) return null;

    const alertId = makeAlertId("high-acceptance", "overall");
    if (existing.alerts.some((a) => a.id === alertId && !a.acknowledged)) return null;

    return {
      id: alertId,
      type: "high-acceptance",
      severity: "warning",
      domain: "overall",
      message: `${Math.round(acceptRate * 100)}% of your AI sessions had very low human direction over the past 2 weeks`,
      detail:
        "This means you're accepting most AI suggestions without modification. Consider engaging more deeply — modifying, questioning, or redirecting AI output.",
      metric: Math.round(acceptRate * 100),
      threshold: 90,
      sustainedWeeks: MIN_SUSTAINED_WEEKS,
      createdAt: new Date().toISOString(),
      acknowledged: false,
      acknowledgedAt: null,
    };
  } catch {
    return null;
  }
}

async function detectLowComprehension(
  db: AnalyzerContext["analytics"],
  existing: AlertsFile,
): Promise<BlindSpotAlert | null> {
  try {
    const result = await db.exec(
      `SELECT module, score, event_count FROM comprehension_by_module
       WHERE score < 40 AND event_count >= 5
       ORDER BY score ASC
       LIMIT 1`,
    );

    if (!result[0]?.values.length) return null;

    const module = result[0].values[0][0] as string;
    const score = result[0].values[0][1] as number;
    const count = result[0].values[0][2] as number;

    const alertId = makeAlertId("low-comprehension", module);
    if (existing.alerts.some((a) => a.id === alertId && !a.acknowledged)) return null;

    return {
      id: alertId,
      type: "low-comprehension",
      severity: "warning",
      domain: module,
      message: `Comprehension in ${module} is ${score} — you've accepted most AI output without deep engagement`,
      detail: `Over ${count} events in this module, your modification depth and prompt specificity are low. This area may have comprehension debt.`,
      metric: score,
      threshold: 40,
      sustainedWeeks: MIN_SUSTAINED_WEEKS,
      createdAt: new Date().toISOString(),
      acknowledged: false,
      acknowledgedAt: null,
    };
  } catch {
    return null;
  }
}

async function detectDecliningDirection(
  db: AnalyzerContext["analytics"],
  existing: AlertsFile,
): Promise<BlindSpotAlert | null> {
  try {
    const result = await db.exec(`SELECT rdi FROM metric_snapshots ORDER BY date DESC LIMIT 28`);

    if (!result[0]?.values || result[0].values.length < 14) return null;

    const values = result[0].values.map((r) => r[0] as number).reverse();
    const trend = detectTrend(values);

    if (!trend || trend.direction !== "decelerating" || trend.confidence === "low") return null;

    const alertId = makeAlertId("declining-direction", "overall");
    if (existing.alerts.some((a) => a.id === alertId && !a.acknowledged)) return null;

    return {
      id: alertId,
      type: "declining-direction",
      severity: "info",
      domain: "overall",
      message: "Your reasoning depth has been declining over the past 4 weeks",
      detail: `RDI trend is statistically significant (${trend.confidence} confidence). This may indicate increasing AI dependency or reduced engagement. Consider reviewing your AI interaction patterns.`,
      metric: Math.round(trend.magnitude * 100),
      threshold: 0,
      sustainedWeeks: 4,
      createdAt: new Date().toISOString(),
      acknowledged: false,
      acknowledgedAt: null,
    };
  } catch {
    return null;
  }
}

function loadExistingAlerts(repoRoot: string): AlertsFile {
  try {
    const path = join(repoRoot, ".unfade", "intelligence", "alerts.json");
    if (!existsSync(path))
      return { alerts: [], maxPerWeek: MAX_ALERTS_PER_WEEK, lastGeneratedAt: "", updatedAt: "" };
    return JSON.parse(readFileSync(path, "utf-8")) as AlertsFile;
  } catch {
    return { alerts: [], maxPerWeek: MAX_ALERTS_PER_WEEK, lastGeneratedAt: "", updatedAt: "" };
  }
}

function countAlertsThisWeek(file: AlertsFile): number {
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  return file.alerts.filter((a) => a.createdAt >= weekAgo && !a.acknowledged).length;
}

function isExpired(alert: BlindSpotAlert): boolean {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  return alert.acknowledged && (alert.acknowledgedAt ?? alert.createdAt) < thirtyDaysAgo;
}

function makeAlertId(type: string, domain: string): string {
  const weekKey = getWeekKey();
  return createHash("sha256").update(`${type}:${domain}:${weekKey}`).digest("hex").slice(0, 12);
}

function getWeekKey(): string {
  const d = new Date();
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Full computation — assembles alerts into an AlertsFile output
// ---------------------------------------------------------------------------

async function computeAlerts(
  db: AnalyzerContext["analytics"],
  repoRoot: string,
): Promise<AlertsFile> {
  const now = new Date().toISOString();

  const existing = loadExistingAlerts(repoRoot);
  const activeCount = countAlertsThisWeek(existing);

  const { baselines } = await computePhaseBaselines(db);

  const newAlerts: BlindSpotAlert[] = [];

  if (activeCount < MAX_ALERTS_PER_WEEK) {
    const highAcceptance = await detectHighAcceptance(db, existing, baselines);
    if (highAcceptance && activeCount + newAlerts.length < MAX_ALERTS_PER_WEEK) {
      newAlerts.push(highAcceptance);
    }

    const lowComprehension = await detectLowComprehension(db, existing);
    if (lowComprehension && activeCount + newAlerts.length < MAX_ALERTS_PER_WEEK) {
      newAlerts.push(lowComprehension);
    }

    const decliningDirection = await detectDecliningDirection(db, existing);
    if (decliningDirection && activeCount + newAlerts.length < MAX_ALERTS_PER_WEEK) {
      newAlerts.push(decliningDirection);
    }
  }

  const allAlerts = [...existing.alerts.filter((a) => !isExpired(a)), ...newAlerts];

  return {
    alerts: allAlerts.slice(-20),
    maxPerWeek: MAX_ALERTS_PER_WEEK,
    lastGeneratedAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const blindSpotDetectorAnalyzer: IncrementalAnalyzer<BlindSpotState, AlertsFile> = {
  name: "blind-spot-detector",
  outputFile: "alerts.json",
  eventFilter: { sources: ["ai-session", "mcp-active"], requireFields: ["humanDirectionScore"] },
  minDataPoints: 20,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<BlindSpotState>> {
    const output = await computeAlerts(ctx.analytics, ctx.repoRoot);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: 0,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<BlindSpotState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<BlindSpotState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const output = await computeAlerts(ctx.analytics, ctx.repoRoot);
    const oldCount = state.value.output.alerts.length;
    const newCount = output.alerts.length;
    const changed = newCount !== oldCount;

    return {
      state: {
        value: { output },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: Math.abs(newCount - oldCount),
    };
  },

  derive(state: IncrementalState<BlindSpotState>): AlertsFile {
    return state.value.output;
  },
};

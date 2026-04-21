// FILE: src/services/intelligence/analyzers/blind-spots.ts
// UF-111 + 11E.7: Blind Spot Detector — monitors acceptance rate, comprehension, direction trends.
// Uses phase-normalized HDS baselines (11E.6) to avoid false alerts during debugging sprints.
// Generates alerts when thresholds exceeded for 2+ weeks. Max 2 alerts per week.
// §7c: never surface based on <5 data points or <2 weeks sustained.

import { createHash } from "node:crypto";
import type { AlertsFile, BlindSpotAlert } from "../../../schemas/intelligence/alerts.js";
import { computePhaseBaselines, isHdsConcerning } from "../phase-baselines.js";
import { detectTrend } from "../utils/trend.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./index.js";

const MAX_ALERTS_PER_WEEK = 2;
const MIN_DATA_POINTS = 5;
const MIN_SUSTAINED_WEEKS = 2;

export const blindSpotDetectorAnalyzer: Analyzer = {
  name: "blind-spot-detector",
  outputFile: "alerts.json",
  minDataPoints: 20,

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const db = ctx.db;
    const now = new Date().toISOString();

    const existing = loadExistingAlerts(ctx.repoRoot);
    const activeCount = countAlertsThisWeek(existing);

    // 11E.7: Compute phase baselines for phase-aware detection
    const { baselines } = computePhaseBaselines(db);

    const newAlerts: BlindSpotAlert[] = [];

    if (activeCount < MAX_ALERTS_PER_WEEK) {
      const highAcceptance = detectHighAcceptance(db, existing, baselines);
      if (highAcceptance && activeCount + newAlerts.length < MAX_ALERTS_PER_WEEK) {
        newAlerts.push(highAcceptance);
      }

      const lowComprehension = detectLowComprehension(db, existing);
      if (lowComprehension && activeCount + newAlerts.length < MAX_ALERTS_PER_WEEK) {
        newAlerts.push(lowComprehension);
      }

      const decliningDirection = detectDecliningDirection(db, existing);
      if (decliningDirection && activeCount + newAlerts.length < MAX_ALERTS_PER_WEEK) {
        newAlerts.push(decliningDirection);
      }
    }

    const allAlerts = [...existing.alerts.filter((a) => !isExpired(a)), ...newAlerts];

    const alertsFile: AlertsFile = {
      alerts: allAlerts.slice(-20),
      maxPerWeek: MAX_ALERTS_PER_WEEK,
      lastGeneratedAt: now,
      updatedAt: now,
    };

    const sourceEventIds = collectSourceEventIds(db);

    return {
      analyzer: "blind-spot-detector",
      updatedAt: now,
      data: alertsFile as unknown as Record<string, unknown>,
      insightCount: newAlerts.length,
      sourceEventIds,
    };
  },
};

function collectSourceEventIds(db: AnalyzerContext["db"]): string[] {
  try {
    const result = db.exec(`
      SELECT id FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.direction_signals.human_direction_score') IS NOT NULL
      ORDER BY ts DESC
      LIMIT 20
    `);
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => row[0] as string);
  } catch {
    return [];
  }
}

function detectHighAcceptance(
  db: AnalyzerContext["db"],
  existing: AlertsFile,
  baselines: Record<string, import("../phase-baselines.js").PhaseBaseline>,
): BlindSpotAlert | null {
  try {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    // 11E.7: Include execution_phase so we can filter out phase-expected low HDS
    const result = db.exec(`
      SELECT
        CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL) as hds,
        json_extract(metadata, '$.execution_phase') as phase
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= '${twoWeeksAgo}'
        AND json_extract(metadata, '$.direction_signals.human_direction_score') IS NOT NULL
    `);

    if (!result[0]?.values?.length) return null;
    const total = result[0].values.length;
    if (total < MIN_DATA_POINTS) return null;

    // 11E.7: Only count as "low direction" if the HDS is concerning FOR its phase.
    // A debugging session with HDS 0.15 is NORMAL — don't count it.
    let lowDir = 0;
    for (const row of result[0].values) {
      const hds = row[0] as number;
      const phase = row[1] as string | null;
      if (hds < 0.2) {
        if (phase && !isHdsConcerning(hds, phase, baselines)) {
          // Low HDS is expected for this phase — skip
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

function detectLowComprehension(
  db: AnalyzerContext["db"],
  existing: AlertsFile,
): BlindSpotAlert | null {
  try {
    const result = db.exec(`
      SELECT module, score, event_count FROM comprehension_by_module
      WHERE score < 40 AND event_count >= ${MIN_DATA_POINTS}
      ORDER BY score ASC
      LIMIT 1
    `);

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

function detectDecliningDirection(
  db: AnalyzerContext["db"],
  existing: AlertsFile,
): BlindSpotAlert | null {
  try {
    const result = db.exec(`
      SELECT rdi FROM metric_snapshots ORDER BY date DESC LIMIT 28
    `);

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
    const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
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

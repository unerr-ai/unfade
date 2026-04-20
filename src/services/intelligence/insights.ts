import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mean, standardDeviation, zScore } from "simple-statistics";
import type { DailyMetricSnapshot } from "../../schemas/metrics.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getStateDir } from "../../utils/paths.js";

const HISTORY_FILE = "insight_history.json";
const MAX_HISTORY = 5;

type InsightType = "cross_domain" | "temporal" | "milestone" | "anomaly" | "skill" | "trend";

interface InsightHistory {
  lastShown: Array<{ type: InsightType; date: string }>;
}

type InsightGenerator = (
  profile: ReasoningModelV2 | null,
  snapshots: DailyMetricSnapshot[],
) => string | null;

const generators: Array<{ type: InsightType; fn: InsightGenerator }> = [
  { type: "cross_domain", fn: crossDomainInsight },
  { type: "temporal", fn: temporalInsight },
  { type: "milestone", fn: milestoneInsight },
  { type: "anomaly", fn: anomalyInsight },
  { type: "skill", fn: skillInsight },
  { type: "trend", fn: trendInsight },
];

/**
 * Generate one rotating "Did You Know" insight. Tracks the last 5 shown
 * in `.unfade/state/insight_history.json` and weights selection toward
 * novelty — never repeats the same type consecutively.
 */
export function generateInsight(
  profile: ReasoningModelV2 | null,
  snapshots: DailyMetricSnapshot[],
  cwd?: string,
): string | null {
  const history = loadHistory(cwd);
  const lastType = history.lastShown.length > 0 ? history.lastShown[0].type : null;

  const recentTypes = new Set(history.lastShown.map((h) => h.type));

  const candidates: Array<{ type: InsightType; text: string; weight: number }> = [];

  for (const gen of generators) {
    if (gen.type === lastType) continue;

    const text = gen.fn(profile, snapshots);
    if (!text) continue;

    const weight = recentTypes.has(gen.type) ? 1 : 3;
    candidates.push({ type: gen.type, text, weight });
  }

  if (candidates.length === 0) return null;

  const selected = weightedPick(candidates);

  history.lastShown.unshift({ type: selected.type, date: new Date().toISOString().slice(0, 10) });
  if (history.lastShown.length > MAX_HISTORY) {
    history.lastShown = history.lastShown.slice(0, MAX_HISTORY);
  }
  saveHistory(history, cwd);

  return selected.text;
}

// --- Insight generators ---

function crossDomainInsight(
  profile: ReasoningModelV2 | null,
  _snapshots: DailyMetricSnapshot[],
): string | null {
  if (!profile || profile.domainDistribution.length < 2) return null;

  const sorted = [...profile.domainDistribution].sort(
    (a, b) => b.avgAlternativesInDomain - a.avgAlternativesInDomain,
  );
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];

  if (top.avgAlternativesInDomain <= 0 || bottom.avgAlternativesInDomain <= 0) return null;

  const ratio = top.avgAlternativesInDomain / Math.max(bottom.avgAlternativesInDomain, 0.1);
  if (ratio < 1.5) return null;

  return `You explore ${ratio.toFixed(1)}x more alternatives in ${top.domain} than ${bottom.domain}.`;
}

function temporalInsight(
  profile: ReasoningModelV2 | null,
  _snapshots: DailyMetricSnapshot[],
): string | null {
  if (!profile || profile.temporalPatterns.peakDecisionDays.length === 0) return null;

  const hours = profile.temporalPatterns.mostProductiveHours;
  if (hours.length === 0) return null;

  const peakHour = hours[0];
  const period = peakHour < 12 ? "morning" : peakHour < 17 ? "afternoon" : "evening";

  return `Your deepest reasoning tends to happen in the ${period} (around ${peakHour}:00).`;
}

function milestoneInsight(
  _profile: ReasoningModelV2 | null,
  snapshots: DailyMetricSnapshot[],
): string | null {
  const totalDecisions = snapshots.reduce((s, snap) => s + snap.decisionsCount, 0);

  const milestones = [10, 25, 50, 100, 250, 500, 1000];
  for (const m of milestones) {
    if (totalDecisions >= m && totalDecisions < m + 5) {
      return `Milestone: ${m}+ distilled decisions captured. Your reasoning history is compounding.`;
    }
  }

  if (snapshots.length >= 7 && snapshots.length < 10) {
    return `One week of continuous reasoning capture — your identity profile is taking shape.`;
  }
  if (snapshots.length >= 30 && snapshots.length < 33) {
    return `One month of reasoning data. Your trends and patterns are now statistically meaningful.`;
  }

  return null;
}

function anomalyInsight(
  _profile: ReasoningModelV2 | null,
  snapshots: DailyMetricSnapshot[],
): string | null {
  if (snapshots.length < 7) return null;

  const rdiValues = snapshots.map((s) => s.rdi);
  const latest = rdiValues[rdiValues.length - 1];

  try {
    const avg = mean(rdiValues);
    const sd = standardDeviation(rdiValues);
    if (sd === 0) return null;
    const z = zScore(latest, avg, sd);
    if (z > 2.0) {
      return `Today was statistically exceptional — RDI of ${latest} is ${z.toFixed(1)}σ above your baseline.`;
    }
    if (z < -2.0) {
      return `Today was unusually fast-paced — RDI of ${latest} is ${Math.abs(z).toFixed(1)}σ below your usual depth. Sometimes speed is the right call.`;
    }
  } catch {
    return null;
  }

  return null;
}

function skillInsight(
  profile: ReasoningModelV2 | null,
  _snapshots: DailyMetricSnapshot[],
): string | null {
  if (!profile) return null;

  const strong = profile.patterns.filter((p) => p.confidence > 0.8 && p.examples >= 5);
  if (strong.length === 0) return null;

  const pick = strong[Math.floor(Math.random() * strong.length)];
  return `Signature pattern: "${pick.pattern}" — observed ${pick.examples} times with ${(pick.confidence * 100).toFixed(0)}% confidence.`;
}

function trendInsight(
  _profile: ReasoningModelV2 | null,
  snapshots: DailyMetricSnapshot[],
): string | null {
  if (snapshots.length < 14) return null;

  const recent7 = snapshots.slice(-7);
  const prev7 = snapshots.slice(-14, -7);

  const recentAvg = recent7.reduce((s, snap) => s + snap.rdi, 0) / recent7.length;
  const prevAvg = prev7.reduce((s, snap) => s + snap.rdi, 0) / prev7.length;

  const delta = recentAvg - prevAvg;
  if (Math.abs(delta) < 3) return null;

  if (delta > 0) {
    return `Your RDI improved ${delta.toFixed(0)} points this week vs last week. Upward trajectory.`;
  }
  return `Your RDI dipped ${Math.abs(delta).toFixed(0)} points this week. You might be in execution mode — that's fine.`;
}

// --- Weighted selection ---

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * totalWeight;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

// --- History persistence ---

function loadHistory(cwd?: string): InsightHistory {
  const path = historyPath(cwd);
  if (!existsSync(path)) return { lastShown: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { lastShown: [] };
  }
}

function saveHistory(history: InsightHistory, cwd?: string): void {
  const path = historyPath(cwd);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(history, null, 2), "utf-8");
}

function historyPath(cwd?: string): string {
  return join(getStateDir(cwd), HISTORY_FILE);
}

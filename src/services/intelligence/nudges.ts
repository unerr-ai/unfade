import type { DailyDistill } from "../../schemas/distill.js";
import type { DailyMetricSnapshot } from "../../schemas/metrics.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";

/**
 * Select at most ONE post-distill nudge based on rule-based triggers.
 * Rules are evaluated in priority order; first match wins.
 * Returns null if no nudge is applicable.
 */
export function selectNudge(
  distill: DailyDistill,
  profile: ReasoningModelV2 | null,
  snapshots: DailyMetricSnapshot[],
): string | null {
  return (
    checkReflexMode(snapshots) ??
    checkNewShallowDomain(profile) ??
    checkCwiCelebration(snapshots) ??
    checkDeadEndWithoutRecovery(distill) ??
    null
  );
}

function checkReflexMode(snapshots: DailyMetricSnapshot[]): string | null {
  if (snapshots.length < 4) return null;

  const recent3 = snapshots.slice(-4, -1);
  const today = snapshots[snapshots.length - 1];
  if (!today) return null;

  const rollingAvg = recent3.reduce((s, snap) => s + snap.rdi, 0) / recent3.length;

  if (today.rdi < rollingAvg * 0.8 && today.rdi < 40) {
    return `You've been in reflex mode (RDI: ${today.rdi}). Try exploring one more alternative on your next decision.`;
  }
  return null;
}

function checkNewShallowDomain(profile: ReasoningModelV2 | null): string | null {
  if (!profile) return null;

  const shallow = profile.domainDistribution.filter(
    (d) => d.depth === "shallow" && d.frequency <= 3,
  );
  if (shallow.length === 0) return null;

  const newest = shallow.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
  const deep = profile.domainDistribution.find((d) => d.depth === "deep");

  if (deep) {
    return `New territory: ${newest.domain}. Your fastest ramp-up was in ${deep.domain} — apply the same exploration depth here.`;
  }
  return `New territory: ${newest.domain}. Exploring alternatives early accelerates learning in new domains.`;
}

function checkCwiCelebration(snapshots: DailyMetricSnapshot[]): string | null {
  if (snapshots.length < 21) return null;

  const last21 = snapshots.slice(-21);
  const weeks = [last21.slice(0, 7), last21.slice(7, 14), last21.slice(14, 21)];

  const avgPerWeek = weeks.map((w) => w.reduce((s, snap) => s + snap.rdi, 0) / w.length);

  const allImproving = avgPerWeek[1] > avgPerWeek[0] && avgPerWeek[2] > avgPerWeek[1];

  if (allImproving) {
    return `Your reasoning quality is on an uptrend — 3 weeks of consistent improvement. Keep going.`;
  }
  return null;
}

function checkDeadEndWithoutRecovery(distill: DailyDistill): string | null {
  const deadEnds = distill.deadEnds ?? [];
  const unrecovered = deadEnds.filter((de) => !de.resolution || de.resolution === "");

  if (unrecovered.length === 0) return null;

  return `You hit a dead end today (${unrecovered[0].description.slice(0, 60)}). Noting what you tried makes future dead ends recoverable.`;
}

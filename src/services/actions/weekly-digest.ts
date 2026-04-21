// FILE: src/services/actions/weekly-digest.ts
// 12B.7 + 12B.8: Weekly digest card generation — comparison card from 7d data.
// Generates on configured day, max 1 per ISO week.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getCardsDir, getProjectDataDir } from "../../utils/paths.js";
import type { ActionContext, ActionOutcome, ActionRegistration } from "./runner.js";

type DayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

const DAY_MAP: Record<DayName, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

function getISOWeek(date: Date): string {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum =
    1 +
    Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function isTodayDigestDay(digestDay: DayName): boolean {
  const today = new Date().getDay();
  return today === DAY_MAP[digestDay];
}

interface WeeklyStats {
  direction: number;
  comprehension: number;
  eventCount: number;
  topDomain: string;
  costEstimate: number;
}

function readWeeklyStats(repoRoot: string): WeeklyStats | null {
  const summaryPath = join(getProjectDataDir(repoRoot), "state", "summary.json");
  if (!existsSync(summaryPath)) return null;

  try {
    const data = JSON.parse(readFileSync(summaryPath, "utf-8"));
    return {
      direction: data.directionDensity24h ?? 0,
      comprehension: data.comprehensionScore ?? 0,
      eventCount: data.eventCount24h ?? 0,
      topDomain: data.topDomain ?? "unknown",
      costEstimate: data.costPerDirectedDecision ?? 0,
    };
  } catch {
    return null;
  }
}

async function executeWeeklyDigest(ctx: ActionContext): Promise<ActionOutcome> {
  const digestDay = ctx.config.actions.digestDay as DayName;

  if (!isTodayDigestDay(digestDay)) {
    return {
      action: "weekly_digest",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "not_digest_day",
    };
  }

  const isoWeek = getISOWeek(new Date());
  const cardsDir = getCardsDir(ctx.repoRoot);
  const cardPath = join(cardsDir, `weekly-${isoWeek}.json`);

  // Check if card already exists for this week
  if (existsSync(cardPath)) {
    return {
      action: "weekly_digest",
      target: cardPath,
      contentHash: null,
      skipped: true,
      reason: "already_generated",
    };
  }

  const stats = readWeeklyStats(ctx.repoRoot);
  if (!stats) {
    return {
      action: "weekly_digest",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "no_stats",
    };
  }

  // Generate digest data (JSON for now — PNG rendering uses card infrastructure separately)
  const digest = {
    week: isoWeek,
    generatedAt: new Date().toISOString(),
    metrics: {
      directionDensity: stats.direction,
      comprehensionScore: stats.comprehension,
      eventCount: stats.eventCount,
      topDomain: stats.topDomain,
      costEstimate: stats.costEstimate,
    },
  };

  // Write digest JSON (card infrastructure can pick this up for PNG rendering)
  const { atomicWriteFile } = await import("./runner.js");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(cardsDir, { recursive: true });
  atomicWriteFile(cardPath, JSON.stringify(digest, null, 2));

  logger.debug("Weekly digest generated", { week: isoWeek });

  return { action: "weekly_digest", target: cardPath, contentHash: isoWeek };
}

export const weeklyDigestAction: ActionRegistration = {
  trigger: "schedule_weekly",
  name: "weekly_digest",
  configGate: (config) => config.actions.weeklyDigest,
  execute: executeWeeklyDigest,
};

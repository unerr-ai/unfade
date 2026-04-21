// FILE: src/services/intelligence/global-index.ts
// UF-242: Global index materializer — aggregates per-repo summaries into ~/.unfade/cache/global_index.db.
// Reads registry + per-repo summary.json (fast O(repos) path). Disposable — rebuildable anytime.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localToday } from "../../utils/date.js";
import { logger } from "../../utils/logger.js";
import { getUserConfigDir } from "../../utils/paths.js";
import { loadRegistry } from "../registry/registry.js";
import type { SummaryJson } from "./summary-writer.js";

const GLOBAL_CACHE_DIR = "cache";
const GLOBAL_DB_NAME = "global_index.json";

export interface RepoRollup {
  repoId: string;
  root: string;
  label: string;
  lastSummaryAt: string | null;
  directionDensity: number;
  eventCount: number;
  comprehensionScore: number | null;
  tokenSpendProxy: number;
  topDomain: string | null;
}

export interface DailyTeamRollup {
  date: string;
  totalEvents: number;
  avgDirection: number;
  avgComprehension: number | null;
  totalSpend: number;
  repoCount: number;
}

export interface GlobalIndex {
  schemaVersion: 1;
  updatedAt: string;
  repos: RepoRollup[];
  dailyRollups: DailyTeamRollup[];
}

function globalCacheDir(): string {
  return join(getUserConfigDir(), GLOBAL_CACHE_DIR);
}

function globalIndexPath(): string {
  return join(globalCacheDir(), GLOBAL_DB_NAME);
}

/**
 * Rebuild the global index from per-repo summary.json files.
 * Fast: reads only summary.json per repo (not events or DB).
 */
export function rebuildGlobalIndex(): GlobalIndex {
  const registry = loadRegistry();

  const repos: RepoRollup[] = [];
  const dailyMap = new Map<
    string,
    { events: number; direction: number[]; comprehension: number[]; spend: number; count: number }
  >();

  for (const repo of registry.repos) {
    const summaryPath = join(repo.root, ".unfade", "state", "summary.json");
    let summary: SummaryJson | null = null;

    if (existsSync(summaryPath)) {
      try {
        summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as SummaryJson;
      } catch {
        // skip unreadable
      }
    }

    const rollup: RepoRollup = {
      repoId: repo.id,
      root: repo.root,
      label: repo.label,
      lastSummaryAt: summary?.updatedAt ?? null,
      directionDensity: summary?.directionDensity24h ?? 0,
      eventCount: summary?.eventCount24h ?? 0,
      comprehensionScore: summary?.comprehensionScore ?? null,
      tokenSpendProxy: 0,
      topDomain: summary?.topDomain ?? null,
    };

    repos.push(rollup);

    const today = localToday();
    const entry = dailyMap.get(today) ?? {
      events: 0,
      direction: [],
      comprehension: [],
      spend: 0,
      count: 0,
    };
    entry.events += rollup.eventCount;
    if (rollup.directionDensity > 0) entry.direction.push(rollup.directionDensity);
    if (rollup.comprehensionScore !== null) entry.comprehension.push(rollup.comprehensionScore);
    entry.spend += rollup.tokenSpendProxy;
    entry.count++;
    dailyMap.set(today, entry);
  }

  const dailyRollups: DailyTeamRollup[] = [];
  for (const [date, data] of dailyMap) {
    dailyRollups.push({
      date,
      totalEvents: data.events,
      avgDirection:
        data.direction.length > 0
          ? Math.round(data.direction.reduce((a, b) => a + b, 0) / data.direction.length)
          : 0,
      avgComprehension:
        data.comprehension.length > 0
          ? Math.round(data.comprehension.reduce((a, b) => a + b, 0) / data.comprehension.length)
          : null,
      totalSpend: Math.round(data.spend * 100) / 100,
      repoCount: data.count,
    });
  }

  const index: GlobalIndex = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    repos,
    dailyRollups,
  };

  persistGlobalIndex(index);
  return index;
}

/**
 * Load the global index from disk. Returns null if not yet built.
 */
export function loadGlobalIndex(): GlobalIndex | null {
  const path = globalIndexPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as GlobalIndex;
  } catch {
    return null;
  }
}

function persistGlobalIndex(index: GlobalIndex): void {
  const dir = globalCacheDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(globalIndexPath(), JSON.stringify(index, null, 2), "utf-8");
  logger.debug("Global index updated", { repos: index.repos.length });
}

/**
 * Generate CSV content from the global index for leadership export.
 */
export function globalIndexToCSV(index: GlobalIndex): {
  spendByRepo: string;
  directionByRepo: string;
  qualityTrend: string;
} {
  const spendByRepo = [
    "repo_id,label,event_count_24h,token_spend_proxy,top_domain",
    ...index.repos.map((r) =>
      [r.repoId, csvEscape(r.label), r.eventCount, r.tokenSpendProxy, r.topDomain ?? ""].join(","),
    ),
  ].join("\n");

  const directionByRepo = [
    "repo_id,label,direction_density,comprehension_score,event_count_24h",
    ...index.repos.map((r) =>
      [
        r.repoId,
        csvEscape(r.label),
        r.directionDensity,
        r.comprehensionScore ?? "",
        r.eventCount,
      ].join(","),
    ),
  ].join("\n");

  const qualityTrend = [
    "date,total_events,avg_direction,avg_comprehension,total_spend,repo_count",
    ...index.dailyRollups.map((d) =>
      [
        d.date,
        d.totalEvents,
        d.avgDirection,
        d.avgComprehension ?? "",
        d.totalSpend,
        d.repoCount,
      ].join(","),
    ),
  ].join("\n");

  return { spendByRepo, directionByRepo, qualityTrend };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

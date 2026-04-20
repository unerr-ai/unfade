import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyDistill } from "../../schemas/distill.js";
import type { DailyMetricSnapshot } from "../../schemas/metrics.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getMetricsDir } from "../../utils/paths.js";
import { computeIdentityLabels } from "./identity.js";
import { computeRDI } from "./rdi.js";

const SNAPSHOT_FILE = "daily.jsonl";

/**
 * Compute today's metrics and append a single-line JSON snapshot.
 * Idempotent for the same date — overwrites the line if already present.
 */
export function writeMetricSnapshot(
  date: string,
  distill: DailyDistill,
  profile: ReasoningModelV2 | null,
  cwd?: string,
): DailyMetricSnapshot {
  const rdi = computeRDI(distill, profile);
  const labels = profile ? computeIdentityLabels(profile, rdi) : [];

  const topDomain = findTopDomain(distill);

  const snapshot: DailyMetricSnapshot = {
    date,
    rdi,
    dcs: null,
    aq: null,
    cwi: null,
    apiScore: null,
    identityLabels: labels.map((l) => l.label),
    topDomain,
    decisionsCount: distill.decisions.length,
    eventsProcessed: distill.eventsProcessed,
  };

  const metricsDir = getMetricsDir(cwd);
  mkdirSync(metricsDir, { recursive: true });
  const filePath = join(metricsDir, SNAPSHOT_FILE);

  const existingSnapshots = readSnapshots(filePath);
  const filtered = existingSnapshots.filter((s) => s.date !== date);
  filtered.push(snapshot);

  const content = `${filtered.map((s) => JSON.stringify(s)).join("\n")}\n`;

  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(filePath, content, "utf-8");

  return snapshot;
}

/**
 * Read all daily metric snapshots from disk.
 * Returns empty array if file doesn't exist.
 */
export function readSnapshots(filePath?: string, cwd?: string): DailyMetricSnapshot[] {
  const path = filePath ?? join(getMetricsDir(cwd), SNAPSHOT_FILE);
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];

  const snapshots: DailyMetricSnapshot[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      snapshots.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return snapshots;
}

/**
 * Read historical RDI values for trend computation.
 */
export function readRDIHistory(cwd?: string): number[] {
  const snapshots = readSnapshots(undefined, cwd);
  return snapshots.map((s) => s.rdi);
}

/**
 * Write a partial metric snapshot from heuristic data only (no LLM, no distill required).
 * Called by the materializer daemon every ~4 hours.
 * Partial snapshots are overwritten by full distill snapshots for the same date.
 */
export function writePartialSnapshot(
  date: string,
  data: {
    directionDensity: number;
    comprehensionScore: number | null;
    eventCount: number;
    topDomain: string | null;
  },
  cwd?: string,
): DailyMetricSnapshot {
  const snapshot: DailyMetricSnapshot = {
    date,
    rdi: Math.round(data.directionDensity * 0.7),
    dcs: null,
    aq: null,
    cwi: null,
    apiScore: null,
    identityLabels: [],
    topDomain: data.topDomain,
    decisionsCount: 0,
    eventsProcessed: data.eventCount,
    partial: true,
    directionDensity: data.directionDensity,
    comprehensionScore: data.comprehensionScore,
  };

  const metricsDir = getMetricsDir(cwd);
  mkdirSync(metricsDir, { recursive: true });
  const filePath = join(metricsDir, SNAPSHOT_FILE);

  const existing = readSnapshots(filePath);
  const sameDate = existing.find((s) => s.date === date);

  if (sameDate && !sameDate.partial) {
    return sameDate;
  }

  const filtered = existing.filter((s) => s.date !== date);
  filtered.push(snapshot);

  const content = `${filtered.map((s) => JSON.stringify(s)).join("\n")}\n`;
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(filePath, content, "utf-8");

  return snapshot;
}

function findTopDomain(distill: DailyDistill): string | null {
  const domainCounts = new Map<string, number>();
  for (const d of distill.decisions) {
    if (d.domain) {
      domainCounts.set(d.domain, (domainCounts.get(d.domain) ?? 0) + 1);
    }
  }

  let topDomain: string | null = null;
  let topCount = 0;
  for (const [domain, count] of domainCounts) {
    if (count > topCount) {
      topDomain = domain;
      topCount = count;
    }
  }
  return topDomain;
}

// FILE: src/services/intelligence/velocity.ts
// UF-247: Reasoning velocity — measures whether the developer is getting
// *better* at reasoning with AI, not just faster.
// Uses linear regression over trailing 30 daily RDI snapshots.

import { linearRegression, mean } from "simple-statistics";
import { readSnapshots } from "./snapshot.js";

export interface VelocityResult {
  percentChange: number | null;
  slope: number | null;
  dataPoints: number;
  period: string;
}

/**
 * Compute reasoning velocity from the last N days of metric snapshots.
 * Returns percentage change in RDI over the period.
 * Requires ≥ 7 data points — returns null otherwise.
 */
export function computeReasoningVelocity(days = 30, cwd?: string): VelocityResult {
  const snapshots = readSnapshots(undefined, cwd);

  const recent = snapshots.filter((s) => s.rdi > 0).slice(-days);

  if (recent.length < 7) {
    return {
      percentChange: null,
      slope: null,
      dataPoints: recent.length,
      period: `${days}d`,
    };
  }

  const pairs: [number, number][] = recent.map((s, i) => [i, s.rdi]);
  const reg = linearRegression(pairs);

  const rdiValues = recent.map((s) => s.rdi);
  const meanRdi = mean(rdiValues);

  if (meanRdi === 0) {
    return {
      percentChange: 0,
      slope: reg.m,
      dataPoints: recent.length,
      period: `${days}d`,
    };
  }

  const percentChange = Math.round(((reg.m * recent.length) / meanRdi) * 100);

  return {
    percentChange,
    slope: Math.round(reg.m * 1000) / 1000,
    dataPoints: recent.length,
    period: `${days}d`,
  };
}

/**
 * Format velocity as a display string: "+23% over 30d" or "stable" or null.
 */
export function formatVelocity(result: VelocityResult): string | null {
  if (result.percentChange === null) return null;
  if (result.percentChange === 0) return "stable";
  const sign = result.percentChange > 0 ? "+" : "";
  return `${sign}${result.percentChange}% over ${result.period}`;
}

/**
 * Compute judgment moment count from snapshots (decisions with high direction).
 */
export function countJudgmentMoments(days = 30, cwd?: string): number {
  const snapshots = readSnapshots(undefined, cwd);
  const recent = snapshots.slice(-days);
  return recent.reduce((sum, s) => sum + s.decisionsCount, 0);
}

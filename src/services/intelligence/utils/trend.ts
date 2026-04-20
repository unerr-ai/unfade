// FILE: src/services/intelligence/utils/trend.ts
// UF-108: Statistical trend detection for longitudinal analysis.
// Moving average, standard deviation, trend direction.

export interface TrendResult {
  direction: "accelerating" | "stable" | "decelerating";
  magnitude: number;
  confidence: "high" | "medium" | "low";
  dataPoints: number;
}

/**
 * Detect trend direction from a time series of values.
 * Requires ≥ 4 data points. Returns null if insufficient data.
 * Uses simple linear regression slope + standard deviation for significance.
 */
export function detectTrend(values: number[]): TrendResult | null {
  if (values.length < 4) return null;

  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;

  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i - (n - 1) / 2;
    sumXY += x * (values[i] - mean);
    sumXX += x * x;
  }
  const slope = sumXX !== 0 ? sumXY / sumXX : 0;

  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const slopeSignificance = stdDev > 0 ? Math.abs(slope) / (stdDev / Math.sqrt(n)) : 0;

  let direction: TrendResult["direction"];
  if (slopeSignificance > 2 && slope > 0) direction = "accelerating";
  else if (slopeSignificance > 2 && slope < 0) direction = "decelerating";
  else direction = "stable";

  const confidence = n >= 14 ? "high" : n >= 7 ? "medium" : "low";

  return {
    direction,
    magnitude: Math.round(slope * 100) / 100,
    confidence,
    dataPoints: n,
  };
}

/**
 * Moving average over a fixed window.
 */
export function movingAverage(values: number[], window: number): number[] {
  if (values.length < window) return [];
  const result: number[] = [];
  for (let i = window - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    result.push(Math.round((sum / window) * 100) / 100);
  }
  return result;
}

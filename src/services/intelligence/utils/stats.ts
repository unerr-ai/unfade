// FILE: src/services/intelligence/utils/stats.ts
// Comprehensive statistical utilities for the intelligence layer.
// All analyzers that need correlation, effect size, percentiles, outlier
// detection, or distribution analysis use this single module.
// Zero external dependencies — pure TypeScript math.

// ---------------------------------------------------------------------------
// Descriptive statistics
// ---------------------------------------------------------------------------

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

export function stdDev(values: number[]): number {
  return Math.sqrt(variance(values));
}

export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDev(values) / Math.abs(m);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

export function interquartileRange(values: number[]): number {
  return percentile(values, 75) - percentile(values, 25);
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;

  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));

  let num = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

export function spearmanCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  return pearsonCorrelation(rank(xs.slice(0, n)), rank(ys.slice(0, n)));
}

function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  for (let i = 0; i < indexed.length; i++) {
    ranks[indexed[i].i] = i + 1;
  }
  return ranks;
}

// ---------------------------------------------------------------------------
// Effect size
// ---------------------------------------------------------------------------

export function cohensD(groupA: number[], groupB: number[]): number {
  if (groupA.length < 2 || groupB.length < 2) return 0;
  const mA = mean(groupA);
  const mB = mean(groupB);
  const pooledVar =
    ((groupA.length - 1) * variance(groupA) + (groupB.length - 1) * variance(groupB)) /
    (groupA.length + groupB.length - 2);
  const pooledSD = Math.sqrt(pooledVar);
  return pooledSD === 0 ? 0 : (mA - mB) / pooledSD;
}

export type EffectSize = "negligible" | "small" | "medium" | "large";

export function interpretCohensD(d: number): EffectSize {
  const abs = Math.abs(d);
  if (abs < 0.2) return "negligible";
  if (abs < 0.5) return "small";
  if (abs < 0.8) return "medium";
  return "large";
}

// ---------------------------------------------------------------------------
// Outlier detection
// ---------------------------------------------------------------------------

export interface OutlierResult {
  outliers: Array<{ index: number; value: number; zScore: number }>;
  cleanValues: number[];
  threshold: number;
}

export function detectOutliers(values: number[], zThreshold = 2.5): OutlierResult {
  const m = mean(values);
  const sd = stdDev(values);
  if (sd === 0) return { outliers: [], cleanValues: [...values], threshold: zThreshold };

  const outliers: OutlierResult["outliers"] = [];
  const cleanValues: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const z = Math.abs((values[i] - m) / sd);
    if (z > zThreshold) {
      outliers.push({ index: i, value: values[i], zScore: z });
    } else {
      cleanValues.push(values[i]);
    }
  }

  return { outliers, cleanValues, threshold: zThreshold };
}

export function detectOutliersIQR(values: number[], multiplier = 1.5): OutlierResult {
  const q1 = percentile(values, 25);
  const q3 = percentile(values, 75);
  const iqr = q3 - q1;
  const lower = q1 - multiplier * iqr;
  const upper = q3 + multiplier * iqr;

  const outliers: OutlierResult["outliers"] = [];
  const cleanValues: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (values[i] < lower || values[i] > upper) {
      outliers.push({ index: i, value: values[i], zScore: 0 });
    } else {
      cleanValues.push(values[i]);
    }
  }

  return { outliers, cleanValues, threshold: multiplier };
}

// ---------------------------------------------------------------------------
// Distribution analysis
// ---------------------------------------------------------------------------

export interface DistributionSummary {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  p90: number;
  p95: number;
  skewness: number;
  cv: number;
}

export function summarizeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      p25: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      skewness: 0,
      cv: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const m = mean(values);
  const sd = stdDev(values);
  const n = values.length;

  let skewnessSum = 0;
  for (const v of values) skewnessSum += ((v - m) / (sd || 1)) ** 3;
  const skewness = sd === 0 ? 0 : (n / ((n - 1) * Math.max(n - 2, 1))) * skewnessSum;

  return {
    count: n,
    mean: round(m),
    median: round(median(values)),
    stdDev: round(sd),
    min: sorted[0],
    max: sorted[n - 1],
    p25: round(percentile(values, 25)),
    p75: round(percentile(values, 75)),
    p90: round(percentile(values, 90)),
    p95: round(percentile(values, 95)),
    skewness: round(skewness),
    cv: round(coefficientOfVariation(values)),
  };
}

// ---------------------------------------------------------------------------
// Regression
// ---------------------------------------------------------------------------

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  predicted: number[];
}

export function linearRegression(xs: number[], ys: number[]): LinearRegressionResult {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: 0, rSquared: 0, predicted: [] };

  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }

  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;

  const predicted = xs.slice(0, n).map((x) => slope * x + intercept);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - predicted[i]) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { slope: round(slope), intercept: round(intercept), rSquared: round(rSquared), predicted };
}

// ---------------------------------------------------------------------------
// Exponential smoothing
// ---------------------------------------------------------------------------

export function exponentialSmoothing(values: number[], alpha = 0.3): number[] {
  if (values.length === 0) return [];
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result.map(round);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function zScore(value: number, mean: number, stdDev: number): number {
  return stdDev === 0 ? 0 : (value - mean) / stdDev;
}

// ---------------------------------------------------------------------------
// Mann-Kendall trend test (non-parametric monotonic trend detection)
// ---------------------------------------------------------------------------

export interface MannKendallResult {
  trend: "increasing" | "decreasing" | "no-trend";
  s: number;
  z: number;
  pValue: number;
  tauB: number;
  significant: boolean;
  dataPoints: number;
}

export function mannKendall(values: number[], alpha = 0.05): MannKendallResult {
  const n = values.length;
  if (n < 4) {
    return { trend: "no-trend", s: 0, z: 0, pValue: 1, tauB: 0, significant: false, dataPoints: n };
  }

  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - values[i];
      if (diff > 0) s++;
      else if (diff < 0) s--;
    }
  }

  const nPairs = (n * (n - 1)) / 2;
  const tauB = nPairs === 0 ? 0 : s / nPairs;

  const tieGroups = countTieGroups(values);
  let varianceS = (n * (n - 1) * (2 * n + 5)) / 18;
  for (const t of tieGroups) {
    varianceS -= (t * (t - 1) * (2 * t + 5)) / 18;
  }

  const stdS = Math.sqrt(Math.max(0, varianceS));
  let z = 0;
  if (stdS > 0) {
    if (s > 0) z = (s - 1) / stdS;
    else if (s < 0) z = (s + 1) / stdS;
  }

  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const significant = pValue < alpha;

  let trend: MannKendallResult["trend"] = "no-trend";
  if (significant) {
    trend = s > 0 ? "increasing" : "decreasing";
  }

  return {
    trend,
    s,
    z: round(z),
    pValue: round(pValue),
    tauB: round(tauB),
    significant,
    dataPoints: n,
  };
}

function countTieGroups(values: number[]): number[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.values()].filter((c) => c > 1);
}

function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// ---------------------------------------------------------------------------
// Bayesian smoothing (empirical Bayes shrinkage)
// ---------------------------------------------------------------------------

export interface BayesianSmoothResult {
  raw: number;
  smoothed: number;
  shrinkage: number;
  effectiveSampleSize: number;
}

export function bayesianSmooth(
  observed: number,
  sampleSize: number,
  globalPrior: number,
  priorStrength = 10,
): BayesianSmoothResult {
  const totalWeight = sampleSize + priorStrength;
  const shrinkage = priorStrength / totalWeight;
  const smoothed = (sampleSize * observed + priorStrength * globalPrior) / totalWeight;

  return {
    raw: round(observed),
    smoothed: round(smoothed),
    shrinkage: round(shrinkage),
    effectiveSampleSize: round(totalWeight),
  };
}

export function bayesianSmoothBatch(
  observations: Array<{ value: number; sampleSize: number }>,
  priorStrength = 10,
): BayesianSmoothResult[] {
  if (observations.length === 0) return [];

  const totalSamples = observations.reduce((s, o) => s + o.sampleSize, 0);
  const globalPrior =
    totalSamples > 0
      ? observations.reduce((s, o) => s + o.value * o.sampleSize, 0) / totalSamples
      : 0.5;

  return observations.map((o) => bayesianSmooth(o.value, o.sampleSize, globalPrior, priorStrength));
}

// ---------------------------------------------------------------------------
// Sen's slope estimator (robust to outliers, pairs with Mann-Kendall)
// ---------------------------------------------------------------------------

export function senSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j !== i) slopes.push((values[j] - values[i]) / (j - i));
    }
  }

  slopes.sort((a, b) => a - b);
  return round(median(slopes));
}

// ---------------------------------------------------------------------------
// Weighted moving average
// ---------------------------------------------------------------------------

export function weightedMovingAverage(values: number[], weights: number[]): number[] {
  const windowSize = weights.length;
  if (values.length < windowSize) return [];

  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const result: number[] = [];
  for (let i = windowSize - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      sum += values[i - windowSize + 1 + j] * weights[j];
    }
    result.push(round(sum / totalWeight));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export interface ComparisonResult {
  type: "vs-prior" | "vs-average" | "vs-threshold";
  delta: number;
  label: string;
  direction: "up" | "down" | "flat";
}

export function vsPriorPeriod(
  history: Array<{ date: string; value: number }>,
  daysBack: number,
): ComparisonResult | null {
  if (history.length < 2) return null;
  const now = history[history.length - 1];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const prior = history.find((h) => new Date(h.date) <= cutoff) ?? history[0];
  if (!prior || prior.value === now.value) {
    return { type: "vs-prior", delta: 0, label: `vs ${daysBack}d ago`, direction: "flat" };
  }
  const delta = Math.round(((now.value - prior.value) / Math.max(prior.value, 1)) * 100);
  return {
    type: "vs-prior",
    delta: Math.abs(delta),
    label: `vs ${daysBack}d ago`,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

export function vsAverage(
  currentValue: number,
  history: Array<{ value: number }>,
): ComparisonResult | null {
  if (history.length === 0) return null;
  const avg = history.reduce((s, h) => s + h.value, 0) / history.length;
  const delta = Math.round(((currentValue - avg) / Math.max(avg, 1)) * 100);
  return {
    type: "vs-average",
    delta: Math.abs(delta),
    label: `vs ${history.length}-day avg`,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

export function vsThreshold(
  currentValue: number,
  threshold: number,
  thresholdLabel: string,
): ComparisonResult {
  const delta = Math.round(currentValue - threshold);
  return {
    type: "vs-threshold",
    delta: Math.abs(delta),
    label: thresholdLabel,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

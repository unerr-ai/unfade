import { linearRegression } from "simple-statistics";
import type { MetricPresentation } from "../../schemas/metrics.js";

/**
 * Wrap a raw metric score with contextual framing, improvement pathway,
 * and trend analysis. Never show raw numbers alone.
 */
export function presentMetric(name: string, score: number, history: number[]): MetricPresentation {
  const label = labelForScore(name, score);
  const framing = framingForScore(name, score);
  const improvement = improvementForScore(name, score);
  const { trend, trendMagnitude } = computeTrend(history);

  return { score, label, framing, improvement, trend, trendMagnitude };
}

// --- Score labels ---

function labelForScore(name: string, score: number): string {
  if (name === "rdi") {
    if (score >= 70) return "Architectural Thinker";
    if (score >= 50) return "Deliberate Builder";
    if (score >= 30) return "Pragmatic Mover";
    return "Reflex Mode";
  }
  if (name === "dcs") {
    if (score >= 70) return "Precise Director";
    if (score >= 40) return "Developing Clarity";
    return "Broad Strokes";
  }
  if (name === "cwi") {
    if (score > 2) return "Strong Growth";
    if (score > 0) return "Improving";
    if (score === 0) return "Plateau";
    return "Recalibrating";
  }
  return `Score: ${score}`;
}

// --- Framing (mode, not failure) ---

function framingForScore(name: string, score: number): string {
  if (name === "rdi") {
    if (score >= 70)
      return "You think architecturally — exploring alternatives, articulating trade-offs, recovering from dead ends.";
    if (score >= 50)
      return "You're deliberate in your decisions — good balance of exploration and execution.";
    if (score >= 30)
      return "You made fast, decisive choices today. When you need deeper exploration, you'll see this climb.";
    return "Reflex mode — shipping fast. Sometimes that's exactly right.";
  }
  if (name === "dcs") {
    if (score >= 70) return "Your AI directions are precise — clear intent, efficient iterations.";
    if (score >= 40)
      return "Your AI steering is developing — the clearer the prompt, the better the result.";
    return "Broad prompts lead to broad results. Specificity is your lever.";
  }
  return `Your ${name} is ${score}.`;
}

// --- Improvement pathways ---

function improvementForScore(name: string, score: number): string | undefined {
  if (name === "rdi") {
    if (score >= 70) return undefined;
    if (score >= 50)
      return "Try evaluating one more alternative per decision — users who do this see RDI jump 10-15 points.";
    if (score >= 30)
      return "Consider documenting trade-offs when choosing between approaches. Even brief rationale counts.";
    return "When you hit a dead end, note what you tried. Recovery patterns are a strong RDI signal.";
  }
  if (name === "dcs") {
    if (score >= 70) return undefined;
    return "Include file paths + expected behavior in AI prompts. Users who do this see DCS improve 15-20 points within a week.";
  }
  return undefined;
}

// --- Trend computation ---

function computeTrend(history: number[]): {
  trend: "up" | "down" | "stable" | null;
  trendMagnitude?: number;
} {
  if (history.length < 7) {
    return { trend: null };
  }

  const recent = history.slice(-28);
  const points: [number, number][] = recent.map((y, x) => [x, y]);

  const regression = linearRegression(points);
  const slope = regression.m;

  const magnitude = Math.abs(slope);

  if (slope > 0.5) return { trend: "up", trendMagnitude: magnitude };
  if (slope < -0.5) return { trend: "down", trendMagnitude: magnitude };
  return { trend: "stable", trendMagnitude: magnitude };
}

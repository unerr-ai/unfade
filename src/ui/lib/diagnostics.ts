import { getPhaseInfo } from "./maturity";

type Dimension =
  | "comprehension"
  | "velocity"
  | "cost"
  | "patterns"
  | "autonomy"
  | "maturity"
  | "git"
  | "narratives";

export function interpretScore(
  dimension: Dimension,
  score: number,
  trend?: "up" | "down" | "flat",
): string {
  switch (dimension) {
    case "comprehension":
      if (score > 80) return "Full track knowledge — you know every corner";
      if (score > 50) return "Good visibility, some blind corners ahead";
      return "Driving blind — expanding faster than your understanding";
    case "velocity":
      if (trend === "up") return "Engine accelerating";
      if (trend === "down") return "Decelerating — check for friction";
      return "Cruising speed";
    case "cost":
      if (score < 30) return "Running lean";
      if (score <= 100) return "Nominal fuel consumption";
      return "Running rich — consider model optimization";
    case "patterns":
      if (score > 70) return "All gears meshing — patterns well-tuned";
      if (score > 40) return "Some gears slipping — inconsistent prompt patterns";
      return "Transmission grinding — patterns need realignment";
    case "autonomy":
      if (score > 75) return "Steering with precision — you direct, the engine follows";
      if (score > 40) return "Transmission engaging — gaining control over AI output";
      return "Engine running without steering — high AI dependence";
    case "maturity": {
      const phase = score <= 25 ? 1 : score <= 50 ? 2 : score <= 75 ? 3 : 4;
      return getPhaseInfo(phase).description;
    }
    case "git":
      if (score > 70) return "Deep roots across the codebase";
      if (score > 40) return "Familiar with key areas";
      return "Surface-level — expertise concentrated";
    case "narratives":
      if (score > 5) return "Clear signal path";
      if (score > 0) return "Some threads emerging";
      return "Signal building — keep working";
    default:
      return "";
  }
}

export function phaseTransitionNarrative(fromPhase: number, toPhase: number): string {
  const from = getPhaseInfo(fromPhase);
  const to = getPhaseInfo(toPhase);
  if (toPhase > fromPhase) {
    return `Upshift: ${from.label} to ${to.label}. Your drivetrain is engaging — more control, less wheel spin.`;
  }
  return `Downshift: ${from.label} back to ${to.label}. Something is creating friction — check your steering in recent sessions.`;
}

export function costDiagnostic(costPerDecision: number): string {
  if (costPerDecision < 0.3) return "Running lean";
  if (costPerDecision <= 1.0) return "Nominal fuel consumption";
  return "Running rich — consider model optimization";
}

export function gradeLetter(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B+";
  if (score >= 60) return "B";
  if (score >= 50) return "C+";
  if (score >= 40) return "C";
  return "D";
}

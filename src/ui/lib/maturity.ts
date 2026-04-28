export const MATURITY_PHASES = [
  {
    phase: 1,
    label: "Bare Engine",
    color: "var(--color-muted)",
    description: "Engine running but no transmission — AI output accepted without steering",
    diagnostic: "Your vehicle has power but no drivetrain. Output goes wherever the engine points.",
  },
  {
    phase: 2,
    label: "First Gear",
    color: "var(--color-warning)",
    description: "Basic transmission engaged — starting to steer AI output",
    diagnostic: "You have first gear. Turns are rough, but you're beginning to direct the engine.",
  },
  {
    phase: 3,
    label: "Multi-Gear",
    color: "var(--color-cyan)",
    description: "Functional drivetrain — collaborative, directed AI interaction",
    diagnostic: "Your vehicle handles most terrain. Steering is responsive, context compounds.",
  },
  {
    phase: 4,
    label: "Tuned Vehicle",
    color: "var(--color-success)",
    description: "Optimized system — AI amplifies your expertise with precision",
    diagnostic: "Fast, controlled, efficient on your track. The engine serves your direction.",
  },
] as const;

export function getPhaseInfo(phase: number) {
  const idx =
    typeof phase === "number" && !Number.isNaN(phase) ? Math.max(0, Math.min(phase - 1, 3)) : 0;
  return MATURITY_PHASES[idx];
}

export function getPhaseColor(phase: number): string {
  return getPhaseInfo(phase).color;
}

export function getPhaseLabel(phase: number): string {
  return getPhaseInfo(phase).label;
}

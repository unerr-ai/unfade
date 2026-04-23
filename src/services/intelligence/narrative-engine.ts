// FILE: src/services/intelligence/narrative-engine.ts
// Narrative Synthesis Engine — transforms raw intelligence metrics into
// Transmission Thesis-aligned narratives. Three narrative types:
//   1. Diagnostics: "your steering is loose in X" (observation + evidence)
//   2. Prescriptions: "apply constraint-based prompting here" (action + rationale)
//   3. Progress: "you moved from Phase 2.1 to 2.7" (trajectory + what changed)
// Rule-based template engine with zero LLM cost.

import type { AnalyzerContext } from "./analyzers/index.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "./incremental-state.js";
import type { MaturityAssessment, MaturityDimension } from "./maturity-model.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NarrativeType = "diagnostic" | "prescription" | "progress";

export interface Narrative {
  id: string;
  type: NarrativeType;
  headline: string;
  body: string;
  importance: number;
  dimension?: string;
  createdAt: string;
}

interface NarrativeState {
  narratives: Narrative[];
  executiveSummary: string;
  updatedAt: string;
}

type NarrativeOutput = {
  narratives: Narrative[];
  executiveSummary: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Narrative template
// ---------------------------------------------------------------------------

interface NarrativeTemplate {
  id: string;
  type: NarrativeType;
  condition: (ctx: NarrativeContext) => boolean;
  generate: (ctx: NarrativeContext) => Narrative;
}

interface NarrativeContext {
  maturity: MaturityAssessment | null;
  dimensions: MaturityDimension[];
  eventCount: number;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const pct = (n: number) => `${Math.round(n * 100)}%`;

const DIAGNOSTIC_TEMPLATES: NarrativeTemplate[] = [
  {
    id: "loose-steering",
    type: "diagnostic",
    condition: (ctx) => {
      const dir = ctx.dimensions.find((d) => d.name === "direction");
      const mod = ctx.dimensions.find((d) => d.name === "modification-depth");
      return (dir?.score ?? 1) < 0.3 && (mod?.score ?? 1) < 0.3;
    },
    generate: (ctx) => {
      const dir = ctx.dimensions.find((d) => d.name === "direction")!;
      return {
        id: "diag-loose-steering",
        type: "diagnostic",
        headline: "Your steering is loose",
        body:
          `You accept ${pct(1 - dir.score)} of AI output without significant modification. ` +
          `The vehicle pulls where the engine wants — you're not driving, you're riding. ` +
          `Try adding explicit constraints and modifying AI output before accepting.`,
        importance: 0.85,
        dimension: "direction",
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "no-mirrors",
    type: "diagnostic",
    condition: (ctx) => {
      const cl = ctx.dimensions.find((d) => d.name === "context-leverage");
      return (cl?.score ?? 1) < 0.2;
    },
    generate: (ctx) => ({
      id: "diag-no-mirrors",
      type: "diagnostic",
      headline: "You're not using your mirrors",
      body:
        `Context reuse is low. Each session starts from zero when it could build on prior reasoning. ` +
        `Your rear-view mirror — your reasoning history — exists but you're not looking at it. ` +
        `Consider using MCP context injection or maintaining a CLAUDE.md.`,
      importance: 0.75,
      dimension: "context-leverage",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "loop-prone",
    type: "diagnostic",
    condition: (ctx) => {
      const lr = ctx.dimensions.find((d) => d.name === "loop-resilience");
      return (lr?.score ?? 1) < 0.3;
    },
    generate: (ctx) => ({
      id: "diag-loop-prone",
      type: "diagnostic",
      headline: "Your suspension bottoms out on complex problems",
      body:
        `You're entering unproductive loops frequently. The vehicle can't absorb complexity — ` +
        `try decomposition: break complex tasks into smaller, sequential steps. ` +
        `Writing a test case first has been shown to reduce loop rates.`,
      importance: 0.7,
      dimension: "loop-resilience",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "decision-churn",
    type: "diagnostic",
    condition: (ctx) => {
      const dd = ctx.dimensions.find((d) => d.name === "decision-durability");
      return (dd?.score ?? 1) < 0.35;
    },
    generate: (ctx) => ({
      id: "diag-decision-churn",
      type: "diagnostic",
      headline: "Your decisions don't stick",
      body:
        `Decisions are being frequently revised. This suggests either premature commitment or ` +
        `insufficient exploration of alternatives. Consider evaluating more options before deciding, ` +
        `and documenting the rationale so future-you understands why.`,
      importance: 0.65,
      dimension: "decision-durability",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "rough-gear-shifts",
    type: "diagnostic",
    condition: (ctx) => {
      const pe = ctx.dimensions.find((d) => d.name === "prompt-effectiveness");
      const dir = ctx.dimensions.find((d) => d.name === "direction");
      return (pe?.score ?? 1) < 0.35 && (dir?.score ?? 0) > 0.4;
    },
    generate: (ctx) => ({
      id: "diag-rough-gear-shifts",
      type: "diagnostic",
      headline: "Your gear shifts are rough",
      body:
        `You steer well overall, but your prompt effectiveness is low. ` +
        `The transition between planning and implementing lacks a clutch — ` +
        `your direction is strong but the output quality doesn't match. ` +
        `Try front-loading more constraints and examples in your prompts.`,
      importance: 0.6,
      dimension: "prompt-effectiveness",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "redlining",
    type: "diagnostic",
    condition: (ctx) => {
      const pe = ctx.dimensions.find((d) => d.name === "prompt-effectiveness");
      const lr = ctx.dimensions.find((d) => d.name === "loop-resilience");
      return (pe?.score ?? 1) < 0.3 && (lr?.score ?? 1) < 0.4;
    },
    generate: (ctx) => ({
      id: "diag-redlining",
      type: "diagnostic",
      headline: "You're redlining in second gear",
      body:
        `High effort with low return. Your prompts are detailed but acceptance rates are low, ` +
        `and you're hitting loops. You're working hard at steering but the gearing is wrong. ` +
        `Consider a different prompting strategy — what works elsewhere may not fit here.`,
      importance: 0.7,
      dimension: "prompt-effectiveness",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "drafting",
    type: "diagnostic",
    condition: (ctx) => {
      const mod = ctx.dimensions.find((d) => d.name === "modification-depth");
      const dir = ctx.dimensions.find((d) => d.name === "direction");
      return (mod?.score ?? 1) < 0.2 && (dir?.score ?? 1) < 0.25;
    },
    generate: (ctx) => ({
      id: "diag-drafting",
      type: "diagnostic",
      headline: "You're drafting without knowing it",
      body:
        `Low modification depth + low direction. You follow the AI's default path. ` +
        `You think you're driving but you're drafting — the air resistance is low because ` +
        `you're going exactly where the engine wants to go. ` +
        `Try questioning assumptions and evaluating alternatives before accepting.`,
      importance: 0.8,
      dimension: "modification-depth",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "declining-velocity",
    type: "diagnostic",
    condition: (ctx) => {
      const dc = ctx.dimensions.find((d) => d.name === "domain-consistency");
      return dc?.trend === "declining" && (dc?.score ?? 1) < 0.4;
    },
    generate: (ctx) => ({
      id: "diag-declining-velocity",
      type: "diagnostic",
      headline: "Velocity dropping across domains",
      body:
        `Your effectiveness is declining and inconsistent across feature areas. ` +
        `This may indicate spreading too thin or encountering unfamiliar territory. ` +
        `Consider focusing on one domain at a time to rebuild momentum.`,
      importance: 0.55,
      dimension: "domain-consistency",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "low-confidence-assessment",
    type: "diagnostic",
    condition: (ctx) => (ctx.maturity?.confidence ?? 1) < 0.4 && ctx.eventCount > 10,
    generate: (ctx) => ({
      id: "diag-low-confidence",
      type: "diagnostic",
      headline: "Assessment based on limited data",
      body:
        `Your maturity assessment has ${pct(ctx.maturity?.confidence ?? 0)} confidence. ` +
        `More events will improve accuracy. Current phase: ${ctx.maturity?.phaseLabel ?? "unknown"} ` +
        `(Phase ${ctx.maturity?.phase.toFixed(1) ?? "?"}).`,
      importance: 0.3,
      createdAt: new Date().toISOString(),
    }),
  },
];

const PRESCRIPTION_TEMPLATES: NarrativeTemplate[] = [
  {
    id: "build-context-files",
    type: "prescription",
    condition: (ctx) => {
      const cl = ctx.dimensions.find((d) => d.name === "context-leverage");
      return (cl?.score ?? 1) < 0.3 && (ctx.maturity?.phase ?? 0) < 3;
    },
    generate: (ctx) => ({
      id: "rx-context-files",
      type: "prescription",
      headline: "Add mirrors to your vehicle — create a CLAUDE.md",
      body:
        `A CLAUDE.md with your top decisions and project conventions would dramatically improve ` +
        `context leverage. This is like adding rear-view and side mirrors — every session starts ` +
        `with knowledge of where you've been.`,
      importance: 0.9,
      dimension: "context-leverage",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "improve-constraints",
    type: "prescription",
    condition: (ctx) => {
      const pe = ctx.dimensions.find((d) => d.name === "prompt-effectiveness");
      return (pe?.score ?? 1) < 0.4;
    },
    generate: (ctx) => ({
      id: "rx-constraints",
      type: "prescription",
      headline: "Tighten your steering with explicit constraints",
      body:
        `Prompts with explicit constraints (must/should/never) produce significantly better ` +
        `direction. Front-load boundaries and requirements before asking the model to generate. ` +
        `Include file paths, function names, and expected behavior.`,
      importance: 0.75,
      dimension: "prompt-effectiveness",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "decompose-complex-work",
    type: "prescription",
    condition: (ctx) => {
      const lr = ctx.dimensions.find((d) => d.name === "loop-resilience");
      return (lr?.score ?? 1) < 0.35;
    },
    generate: (ctx) => ({
      id: "rx-decompose",
      type: "prescription",
      headline: "Break the road into sections — decompose before coding",
      body:
        `Loop-prone sessions often tackle too much at once. Before starting a complex task, ` +
        `break it into 3-5 sequential sub-tasks. Ask the AI to plan the approach first, ` +
        `then implement each step separately. This reduces iteration count by 40-60%.`,
      importance: 0.8,
      dimension: "loop-resilience",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "test-first-debugging",
    type: "prescription",
    condition: (ctx) => {
      const lr = ctx.dimensions.find((d) => d.name === "loop-resilience");
      const pe = ctx.dimensions.find((d) => d.name === "prompt-effectiveness");
      return (lr?.score ?? 1) < 0.4 && (pe?.score ?? 0) > 0.3;
    },
    generate: (ctx) => ({
      id: "rx-test-first",
      type: "prescription",
      headline: "Write the test before the fix — let the road show the way",
      body:
        `When debugging, write a failing test case BEFORE attempting the fix. ` +
        `This technique reduces debugging loop rates significantly. ` +
        `The test defines success criteria upfront — the AI has a clear target.`,
      importance: 0.7,
      dimension: "loop-resilience",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "document-decisions",
    type: "prescription",
    condition: (ctx) => {
      const dd = ctx.dimensions.find((d) => d.name === "decision-durability");
      return (dd?.score ?? 1) < 0.4;
    },
    generate: (ctx) => ({
      id: "rx-document-decisions",
      type: "prescription",
      headline: "Keep a decision log — future-you will thank you",
      body:
        `Decisions that get revised often lack documented rationale. ` +
        `When making architectural choices, write a 2-line "why" comment. ` +
        `This prevents future sessions from overturning good decisions.`,
      importance: 0.65,
      dimension: "decision-durability",
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "invest-in-domain-breadth",
    type: "prescription",
    condition: (ctx) => {
      const dc = ctx.dimensions.find((d) => d.name === "domain-consistency");
      return (dc?.score ?? 1) < 0.35 && (ctx.maturity?.phase ?? 0) >= 2;
    },
    generate: (ctx) => ({
      id: "rx-domain-breadth",
      type: "prescription",
      headline: "Broaden your drivetrain — apply your best techniques elsewhere",
      body:
        `Your effectiveness varies significantly across domains. ` +
        `Identify what works in your strongest domain and apply those patterns ` +
        `(constraint structure, decomposition style) to weaker areas.`,
      importance: 0.6,
      dimension: "domain-consistency",
      createdAt: new Date().toISOString(),
    }),
  },
];

const PROGRESS_TEMPLATES: NarrativeTemplate[] = [
  {
    id: "phase-transition",
    type: "progress",
    condition: (ctx) => {
      if (!ctx.maturity || ctx.maturity.trajectory.length < 2) return false;
      const prev = ctx.maturity.trajectory[ctx.maturity.trajectory.length - 2];
      const curr = ctx.maturity.trajectory[ctx.maturity.trajectory.length - 1];
      return Math.floor(curr.phase) > Math.floor(prev.phase);
    },
    generate: (ctx) => {
      const trajectory = ctx.maturity!.trajectory;
      const prev = trajectory[trajectory.length - 2];
      const curr = trajectory[trajectory.length - 1];
      return {
        id: `progress-phase-${Math.floor(curr.phase)}`,
        type: "progress",
        headline: `Phase transition: ${ctx.maturity!.phaseLabel}`,
        body:
          `You've moved from Phase ${prev.phase.toFixed(1)} to Phase ${curr.phase.toFixed(1)}. ` +
          `Your vehicle now has ${describePhase(ctx.maturity!.phaseLabel)}. ` +
          `Key improvements: ${
            ctx.dimensions
              .filter((d) => d.trend === "improving")
              .map((d) => d.name)
              .join(", ") || "incremental gains across all dimensions"
          }.`,
        importance: 1.0,
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "dimension-improvement",
    type: "progress",
    condition: (ctx) => ctx.dimensions.some((d) => d.trend === "improving" && d.score > 0.5),
    generate: (ctx) => {
      const improved = ctx.dimensions.filter((d) => d.trend === "improving" && d.score > 0.5);
      const best = improved.sort((a, b) => b.score - a.score)[0];
      return {
        id: `progress-dim-${best.name}`,
        type: "progress",
        headline: `Strong ${best.name}: ${pct(best.score)}`,
        body:
          `Your ${best.name} is improving and now at ${pct(best.score)}. ` +
          `This is a core strength in your AI collaboration workflow.`,
        importance: 0.55,
        dimension: best.name,
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "sub-phase-progress",
    type: "progress",
    condition: (ctx) => {
      if (!ctx.maturity || ctx.maturity.trajectory.length < 7) return false;
      const weekAgo = ctx.maturity.trajectory[ctx.maturity.trajectory.length - 7];
      const now = ctx.maturity.trajectory[ctx.maturity.trajectory.length - 1];
      return Math.abs(now.phase - weekAgo.phase) > 0.3;
    },
    generate: (ctx) => {
      const trajectory = ctx.maturity!.trajectory;
      const weekAgo = trajectory[trajectory.length - 7];
      const now = trajectory[trajectory.length - 1];
      const direction = now.phase > weekAgo.phase ? "improved" : "declined";
      const improving = ctx.dimensions.filter((d) => d.trend === "improving").map((d) => d.name);
      const declining = ctx.dimensions.filter((d) => d.trend === "declining").map((d) => d.name);
      return {
        id: `progress-weekly-${new Date().toISOString().slice(0, 10)}`,
        type: "progress",
        headline: `Weekly: ${weekAgo.phase.toFixed(1)} → ${now.phase.toFixed(1)}`,
        body:
          `Your maturity ${direction} by ${Math.abs(now.phase - weekAgo.phase).toFixed(1)} points this week. ` +
          (direction === "improved"
            ? `Strong gains in: ${improving.join(", ") || "incremental across all dimensions"}.`
            : `Areas that declined: ${declining.join(", ") || "minor regression"}. This may be temporary.`),
        importance: 0.5,
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "milestone-events",
    type: "progress",
    condition: (ctx) => {
      const milestones = [50, 100, 250, 500, 1000];
      return milestones.some((m) => ctx.eventCount >= m && ctx.eventCount < m + 10);
    },
    generate: (ctx) => ({
      id: `progress-milestone-${ctx.eventCount}`,
      type: "progress",
      headline: `${ctx.eventCount} events captured`,
      body:
        `Your intelligence profile is based on ${ctx.eventCount} events. ` +
        `Assessment confidence: ${pct(ctx.maturity?.confidence ?? 0)}. ` +
        `More events → more accurate insights.`,
      importance: 0.35,
      createdAt: new Date().toISOString(),
    }),
  },
];

function describePhase(label: string): string {
  const descriptions: Record<string, string> = {
    "bare-engine": "a running engine — but no transmission yet",
    "first-gear": "basic steering — you're starting to direct the AI",
    "multi-gear": "a functional drivetrain — effective across most terrain",
    "tuned-vehicle": "an optimized system — precise, efficient, and controlled",
  };
  return descriptions[label] ?? "evolving capabilities";
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

const ALL_TEMPLATES = [...DIAGNOSTIC_TEMPLATES, ...PRESCRIPTION_TEMPLATES, ...PROGRESS_TEMPLATES];

export const narrativeEngineAnalyzer: IncrementalAnalyzer<NarrativeState, NarrativeOutput> = {
  name: "narrative-engine",
  outputFile: "narratives.json",
  eventFilter: { sources: [], types: [] },
  dependsOn: ["maturity-model"],
  minDataPoints: 20,

  async initialize(_ctx): Promise<IncrementalState<NarrativeState>> {
    return {
      value: { narratives: [], executiveSummary: "", updatedAt: new Date().toISOString() },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<NarrativeState>> {
    const maturityState = ctx.dependencyStates?.get("maturity-model");
    if (!maturityState) return { state, changed: false };

    const maturity = deriveMaturityFromState(maturityState);
    const narrativeCtx: NarrativeContext = {
      maturity,
      dimensions: maturity?.dimensions ?? [],
      eventCount: state.eventCount + batch.events.length,
    };

    const narratives: Narrative[] = [];
    for (const template of ALL_TEMPLATES) {
      try {
        if (template.condition(narrativeCtx)) {
          narratives.push(template.generate(narrativeCtx));
        }
      } catch {
        // template evaluation failed — skip
      }
    }

    narratives.sort((a, b) => b.importance - a.importance);
    const top = narratives.slice(0, 10);
    const summary = generateExecutiveSummary(maturity, narrativeCtx);

    const changed =
      top.length !== state.value.narratives.length ||
      top.some((n, i) => n.id !== state.value.narratives[i]?.id);

    return {
      state: {
        value: { narratives: top, executiveSummary: summary, updatedAt: new Date().toISOString() },
        watermark:
          batch.events.length > 0 ? batch.events[batch.events.length - 1].ts : state.watermark,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: changed ? 0.1 : 0,
    };
  },

  derive(state): NarrativeOutput {
    return {
      narratives: state.value.narratives,
      executiveSummary: state.value.executiveSummary,
      updatedAt: state.value.updatedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveMaturityFromState(
  maturityState: IncrementalState<unknown>,
): MaturityAssessment | null {
  try {
    const val = maturityState.value as {
      currentPhase?: number;
      dimensions?: MaturityDimension[];
      trajectory?: Array<{ date: string; phase: number; confidence: number }>;
    };
    if (val.currentPhase == null) return null;

    const phase = val.currentPhase;
    const phaseLabel =
      phase < 2
        ? ("bare-engine" as const)
        : phase < 3
          ? ("first-gear" as const)
          : phase < 4
            ? ("multi-gear" as const)
            : ("tuned-vehicle" as const);

    return {
      phase,
      phaseLabel,
      subPhasePosition: phase - Math.floor(phase),
      confidence: 0.5,
      dimensions: val.dimensions ?? [],
      trajectory: val.trajectory ?? [],
      bottlenecks: [],
      nextPhaseRequirements: [],
      assessedAt: maturityState.updatedAt,
      projectId: "",
    };
  } catch {
    return null;
  }
}

function generateExecutiveSummary(
  maturity: MaturityAssessment | null,
  ctx: NarrativeContext,
): string {
  if (!maturity)
    return "Insufficient data for maturity assessment. Continue using AI tools to build your profile.";

  const phaseDesc: Record<string, string> = {
    "bare-engine": "running an engine without a transmission",
    "first-gear": "driving in first gear — basic steering but limited control",
    "multi-gear": "operating a functional drivetrain — effective across most terrain",
    "tuned-vehicle": "driving a tuned vehicle — precise, efficient, and controlled",
  };

  const improving = maturity.dimensions.filter((d) => d.trend === "improving").map((d) => d.name);
  const declining = maturity.dimensions.filter((d) => d.trend === "declining").map((d) => d.name);

  let summary = `AI Collaboration Maturity: Phase ${maturity.phase.toFixed(1)} — ${maturity.phaseLabel.replace(/-/g, " ")}. `;
  summary += `Currently ${phaseDesc[maturity.phaseLabel] ?? "evolving"}. `;
  summary += `Confidence: ${pct(maturity.confidence)} (based on ${ctx.eventCount} events). `;

  if (improving.length > 0) summary += `Improving: ${improving.join(", ")}. `;
  if (declining.length > 0) summary += `Declining: ${declining.join(", ")}. `;

  if (maturity.bottlenecks.length > 0) {
    summary += `Primary bottleneck: ${maturity.bottlenecks[0].dimension}.`;
  }

  return summary;
}

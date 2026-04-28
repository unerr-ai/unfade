// Narrative Engine — dual-path narrative generation with correlation awareness.
//
// IP-6.1: LLM path (daily) + template fallback (per-tick).
// KGI-10: Knowledge-grounded templates.
//
// Narratives are grouped by type: diagnostic, prescription, progress, correlation.
// Every narrative carries evidenceEventIds for drill-through in the UI.

import type { Correlation } from "../../schemas/intelligence-presentation.js";
import type { AnalyzerContext } from "./analyzers/index.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";
import type { MaturityAssessment, MaturityDimension } from "./maturity-model.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type NarrativeType = "diagnostic" | "prescription" | "progress" | "correlation";

export interface Narrative {
  id: string;
  type: NarrativeType;
  headline: string;
  body: string;
  importance: number;
  dimension?: string;
  evidenceEventIds: string[];
  relatedAnalyzers: string[];
  createdAt: string;
}

interface NarrativeState {
  narratives: Narrative[];
  executiveSummary: string;
  updatedAt: string;
  lastLlmRunAt: string;
}

type NarrativeOutput = {
  narratives: Narrative[];
  executiveSummary: string;
  updatedAt: string;
};

// ─── LLM Config ─────────────────────────────────────────────────────────────

export interface LLMConfig {
  provider: "openai" | "anthropic" | "ollama";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface NarrativeEngineConfig {
  llmConfig: LLMConfig | null;
  correlations: Correlation[];
  intelligenceDir: string;
}

// ─── Narrative Template ─────────────────────────────────────────────────────

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
  recentDecisions?: Array<{ predicate: string; objectText: string; context: string; validAt: string }>;
  contradictions?: Array<{ predicate: string; objectText: string; context: string; invalidAt: string }>;
  comprehensionTrends?: Array<{ domain: string; delta: number; direction: "improving" | "declining" | "stable" }>;
  stuckEntities?: Array<{ name: string; sessions: number; factsGained: number }>;
  knowledgeGrounded: boolean;
  correlations: Correlation[];
  analyzerOutputs: Map<string, unknown>;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// ─── Knowledge-Grounded Templates (KGI-10) ─────────────────────────────────

const KNOWLEDGE_TEMPLATES: NarrativeTemplate[] = [
  {
    id: "decision-insight",
    type: "diagnostic",
    condition: (ctx) => (ctx.recentDecisions?.length ?? 0) > 0,
    generate: (ctx) => {
      const decisions = ctx.recentDecisions!;
      const contradictions = ctx.contradictions ?? [];
      const domains = [...new Set(decisions.map((d) => d.objectText || "general"))].slice(0, 3);
      return {
        id: "kg-decision-insight",
        type: "diagnostic",
        headline: `${decisions.length} decisions this week${contradictions.length > 0 ? ` — ${contradictions.length} contradicted earlier choices` : ""}`,
        body: contradictions.length > 0
          ? `You made ${decisions.length} decisions across ${domains.join(", ")}. ${contradictions.length} of these contradicted earlier decisions — your thinking is evolving. Review the contradictions to ensure they're intentional improvements, not regressions.`
          : `You made ${decisions.length} decisions across ${domains.join(", ")}. All decisions are consistent with your prior reasoning — a sign of stable, intentional architecture.`,
        importance: contradictions.length > 0 ? 0.9 : 0.6,
        evidenceEventIds: [],
        relatedAnalyzers: ["decision-replay"],
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "comprehension-trajectory",
    type: "diagnostic",
    condition: (ctx) => (ctx.comprehensionTrends?.length ?? 0) > 0 && ctx.comprehensionTrends!.some((t) => t.direction !== "stable"),
    generate: (ctx) => {
      const trends = ctx.comprehensionTrends!;
      const improving = trends.filter((t) => t.direction === "improving");
      const declining = trends.filter((t) => t.direction === "declining");
      const headline = declining.length > 0
        ? `Comprehension declining in ${declining.map((t) => t.domain).join(", ")}`
        : `Comprehension improving in ${improving.map((t) => t.domain).join(", ")}`;
      const body = [
        ...improving.map((t) => `${t.domain}: +${t.delta.toFixed(0)} (improving)`),
        ...declining.map((t) => `${t.domain}: ${t.delta.toFixed(0)} (declining — consider reviewing this area)`),
      ].join(". ");
      return {
        id: "kg-comprehension-trajectory",
        type: "diagnostic",
        headline,
        body: body || "Comprehension is shifting across domains.",
        importance: declining.length > 0 ? 0.85 : 0.55,
        evidenceEventIds: [],
        relatedAnalyzers: ["comprehension-radar"],
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "stuck-loop-narrative",
    type: "diagnostic",
    condition: (ctx) => (ctx.stuckEntities?.length ?? 0) > 0,
    generate: (ctx) => {
      const stuck = ctx.stuckEntities!;
      const worst = stuck.sort((a, b) => a.factsGained - b.factsGained)[0];
      return {
        id: "kg-stuck-loop",
        type: "diagnostic",
        headline: `Stuck on "${worst.name}" — ${worst.sessions} sessions, ${worst.factsGained} facts gained`,
        body: `You've discussed "${worst.name}" in ${worst.sessions} sessions without extracting new knowledge. This indicates a stuck pattern — try a fundamentally different approach, or ask the AI to explain the problem from first principles.`,
        importance: 0.8,
        evidenceEventIds: [],
        relatedAnalyzers: ["loop-detector"],
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "knowledge-velocity",
    type: "progress",
    condition: (ctx) => (ctx.recentDecisions?.length ?? 0) > 0 && ctx.knowledgeGrounded,
    generate: (ctx) => {
      const decisions = ctx.recentDecisions?.length ?? 0;
      const domains = new Set((ctx.comprehensionTrends ?? []).map((t) => t.domain));
      return {
        id: "kg-knowledge-velocity",
        type: "progress",
        headline: `Knowledge growing: ${decisions} decisions across ${domains.size} domains`,
        body: `Your knowledge graph is expanding. ${decisions} new decisions were extracted from conversations this week, spanning ${domains.size} domains. This knowledge feeds into comprehension tracking, contradiction detection, and maturity assessment.`,
        importance: 0.5,
        evidenceEventIds: [],
        relatedAnalyzers: [],
        createdAt: new Date().toISOString(),
      };
    },
  },
];

// ─── Correlation-Aware Templates (IP-6) ─────────────────────────────────────

const CORRELATION_TEMPLATES: NarrativeTemplate[] = [
  {
    id: "correlation-critical",
    type: "correlation",
    condition: (ctx) => ctx.correlations.some((c) => c.severity === "critical"),
    generate: (ctx) => {
      const criticals = ctx.correlations.filter((c) => c.severity === "critical");
      const top = criticals[0];
      return {
        id: `corr-narrative-critical-${top.type}`,
        type: "correlation",
        headline: top.title,
        body: `${top.explanation} ${top.actionable}`,
        importance: 0.95,
        evidenceEventIds: top.evidenceEventIds,
        relatedAnalyzers: top.analyzers,
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "correlation-warning",
    type: "correlation",
    condition: (ctx) => ctx.correlations.some((c) => c.severity === "warning") && !ctx.correlations.some((c) => c.severity === "critical"),
    generate: (ctx) => {
      const warnings = ctx.correlations.filter((c) => c.severity === "warning");
      const top = warnings[0];
      return {
        id: `corr-narrative-warning-${top.type}`,
        type: "correlation",
        headline: top.title,
        body: `${top.explanation} ${top.actionable}`,
        importance: 0.75,
        evidenceEventIds: top.evidenceEventIds,
        relatedAnalyzers: top.analyzers,
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "correlation-positive",
    type: "correlation",
    condition: (ctx) => ctx.correlations.some((c) => c.severity === "info"),
    generate: (ctx) => {
      const infos = ctx.correlations.filter((c) => c.severity === "info");
      const top = infos[0];
      return {
        id: `corr-narrative-info-${top.type}`,
        type: "correlation",
        headline: top.title,
        body: `${top.explanation} ${top.actionable}`,
        importance: 0.45,
        evidenceEventIds: top.evidenceEventIds,
        relatedAnalyzers: top.analyzers,
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "correlation-summary",
    type: "correlation",
    condition: (ctx) => ctx.correlations.length >= 2,
    generate: (ctx) => {
      const types = [...new Set(ctx.correlations.map((c) => c.type))];
      const criticals = ctx.correlations.filter((c) => c.severity === "critical").length;
      const warnings = ctx.correlations.filter((c) => c.severity === "warning").length;
      return {
        id: "corr-narrative-summary",
        type: "correlation",
        headline: `${ctx.correlations.length} cross-analyzer patterns detected`,
        body: `The correlation engine found ${ctx.correlations.length} patterns across ${types.length} categories: ${criticals > 0 ? `${criticals} critical` : ""}${criticals > 0 && warnings > 0 ? ", " : ""}${warnings > 0 ? `${warnings} warning` : ""}${(criticals > 0 || warnings > 0) && ctx.correlations.length > criticals + warnings ? ` and ${ctx.correlations.length - criticals - warnings} informational` : ""}. These patterns connect insights from ${[...new Set(ctx.correlations.flatMap((c) => c.analyzers))].length} analyzers.`,
        importance: 0.65,
        evidenceEventIds: ctx.correlations.flatMap((c) => c.evidenceEventIds.slice(0, 2)),
        relatedAnalyzers: [...new Set(ctx.correlations.flatMap((c) => c.analyzers))],
        createdAt: new Date().toISOString(),
      };
    },
  },
];

// ─── Diagnostic Templates ───────────────────────────────────────────────────

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
        headline: "Low direction + low modification depth",
        body: `You accept ${pct(1 - dir.score)} of AI output without significant modification. Try adding explicit constraints and modifying AI output before accepting.`,
        importance: 0.85,
        dimension: "direction",
        evidenceEventIds: [],
        relatedAnalyzers: ["efficiency"],
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "no-mirrors",
    type: "diagnostic",
    condition: (ctx) => (ctx.dimensions.find((d) => d.name === "context-leverage")?.score ?? 1) < 0.2,
    generate: () => ({
      id: "diag-no-mirrors",
      type: "diagnostic",
      headline: "Context reuse is critically low",
      body: "Each session starts from zero when it could build on prior reasoning. Consider using MCP context injection or maintaining a CLAUDE.md.",
      importance: 0.75,
      dimension: "context-leverage",
      evidenceEventIds: [],
      relatedAnalyzers: ["efficiency"],
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "loop-prone",
    type: "diagnostic",
    condition: (ctx) => (ctx.dimensions.find((d) => d.name === "loop-resilience")?.score ?? 1) < 0.3,
    generate: () => ({
      id: "diag-loop-prone",
      type: "diagnostic",
      headline: "Entering unproductive loops frequently",
      body: "Try decomposition: break complex tasks into smaller, sequential steps. Writing a test case first has been shown to reduce loop rates.",
      importance: 0.7,
      dimension: "loop-resilience",
      evidenceEventIds: [],
      relatedAnalyzers: ["loop-detector"],
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "decision-churn",
    type: "diagnostic",
    condition: (ctx) => (ctx.dimensions.find((d) => d.name === "decision-durability")?.score ?? 1) < 0.35,
    generate: () => ({
      id: "diag-decision-churn",
      type: "diagnostic",
      headline: "Decisions being frequently revised",
      body: "This suggests either premature commitment or insufficient exploration. Consider evaluating more options before deciding, and documenting the rationale.",
      importance: 0.65,
      dimension: "decision-durability",
      evidenceEventIds: [],
      relatedAnalyzers: ["decision-replay"],
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
    generate: () => ({
      id: "diag-rough-gear-shifts",
      type: "diagnostic",
      headline: "Strong direction but low prompt effectiveness",
      body: "Your direction is strong but output quality doesn't match. Try front-loading more constraints and examples in your prompts.",
      importance: 0.6,
      dimension: "prompt-effectiveness",
      evidenceEventIds: [],
      relatedAnalyzers: ["prompt-patterns"],
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
    generate: () => ({
      id: "diag-declining-velocity",
      type: "diagnostic",
      headline: "Velocity dropping across domains",
      body: "Effectiveness is declining and inconsistent across areas. Consider focusing on one domain at a time to rebuild momentum.",
      importance: 0.55,
      dimension: "domain-consistency",
      evidenceEventIds: [],
      relatedAnalyzers: ["velocity-tracker"],
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
      body: `Your maturity assessment has ${pct(ctx.maturity?.confidence ?? 0)} confidence. More events will improve accuracy. Current phase: ${ctx.maturity?.phaseLabel ?? "unknown"} (Phase ${ctx.maturity?.phase.toFixed(1) ?? "?"}).`,
      importance: 0.3,
      evidenceEventIds: [],
      relatedAnalyzers: [],
      createdAt: new Date().toISOString(),
    }),
  },
];

// ─── Prescription Templates ─────────────────────────────────────────────────

const PRESCRIPTION_TEMPLATES: NarrativeTemplate[] = [
  {
    id: "build-context-files",
    type: "prescription",
    condition: (ctx) => (ctx.dimensions.find((d) => d.name === "context-leverage")?.score ?? 1) < 0.3 && (ctx.maturity?.phase ?? 0) < 3,
    generate: () => ({
      id: "rx-context-files",
      type: "prescription",
      headline: "Create a CLAUDE.md for context leverage",
      body: "A CLAUDE.md with your top decisions and project conventions would dramatically improve context leverage. Every session starts with knowledge of where you've been.",
      importance: 0.9,
      dimension: "context-leverage",
      evidenceEventIds: [],
      relatedAnalyzers: ["efficiency"],
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "improve-constraints",
    type: "prescription",
    condition: (ctx) => (ctx.dimensions.find((d) => d.name === "prompt-effectiveness")?.score ?? 1) < 0.4,
    generate: () => ({
      id: "rx-constraints",
      type: "prescription",
      headline: "Tighten prompts with explicit constraints",
      body: "Prompts with explicit constraints (must/should/never) produce significantly better direction. Front-load boundaries and requirements before asking the model to generate.",
      importance: 0.75,
      dimension: "prompt-effectiveness",
      evidenceEventIds: [],
      relatedAnalyzers: ["prompt-patterns"],
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "decompose-complex-work",
    type: "prescription",
    condition: (ctx) => (ctx.dimensions.find((d) => d.name === "loop-resilience")?.score ?? 1) < 0.35,
    generate: () => ({
      id: "rx-decompose",
      type: "prescription",
      headline: "Decompose before coding — break complex tasks into 3-5 steps",
      body: "Loop-prone sessions often tackle too much at once. Break it into sequential sub-tasks. Ask the AI to plan first, then implement each step separately.",
      importance: 0.8,
      dimension: "loop-resilience",
      evidenceEventIds: [],
      relatedAnalyzers: ["loop-detector"],
      createdAt: new Date().toISOString(),
    }),
  },
  {
    id: "document-decisions",
    type: "prescription",
    condition: (ctx) => (ctx.dimensions.find((d) => d.name === "decision-durability")?.score ?? 1) < 0.4,
    generate: () => ({
      id: "rx-document-decisions",
      type: "prescription",
      headline: "Keep a decision log — document the 'why'",
      body: "Decisions that get revised often lack documented rationale. When making choices, write a 2-line 'why' comment. This prevents future sessions from overturning good decisions.",
      importance: 0.65,
      dimension: "decision-durability",
      evidenceEventIds: [],
      relatedAnalyzers: ["decision-replay"],
      createdAt: new Date().toISOString(),
    }),
  },
];

// ─── Progress Templates ─────────────────────────────────────────────────────

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
      const prev = trajectory[trajectory.length - 2]!;
      const curr = trajectory[trajectory.length - 1]!;
      return {
        id: `progress-phase-${Math.floor(curr.phase)}`,
        type: "progress",
        headline: `Phase transition: ${ctx.maturity?.phaseLabel}`,
        body: `You've moved from Phase ${prev.phase.toFixed(1)} to Phase ${curr.phase.toFixed(1)}. Key improvements: ${ctx.dimensions.filter((d) => d.trend === "improving").map((d) => d.name).join(", ") || "incremental gains across all dimensions"}.`,
        importance: 1.0,
        evidenceEventIds: [],
        relatedAnalyzers: [],
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
        body: `Your ${best.name} is improving and now at ${pct(best.score)}. This is a core strength in your AI collaboration workflow.`,
        importance: 0.55,
        dimension: best.name,
        evidenceEventIds: [],
        relatedAnalyzers: [],
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "milestone-events",
    type: "progress",
    condition: (ctx) => [50, 100, 250, 500, 1000].some((m) => ctx.eventCount >= m && ctx.eventCount < m + 10),
    generate: (ctx) => ({
      id: `progress-milestone-${ctx.eventCount}`,
      type: "progress",
      headline: `${ctx.eventCount} events captured`,
      body: `Your intelligence profile is based on ${ctx.eventCount} events. Assessment confidence: ${pct(ctx.maturity?.confidence ?? 0)}. More events → more accurate insights.`,
      importance: 0.35,
      evidenceEventIds: [],
      relatedAnalyzers: [],
      createdAt: new Date().toISOString(),
    }),
  },
];

// ─── LLM Narrative Synthesis (IP-6.1) ───────────────────────────────────────

async function synthesizeWithLLM(
  ctx: NarrativeContext,
  config: NarrativeEngineConfig,
): Promise<Narrative[] | null> {
  if (!config.llmConfig) return null;

  try {
    const prompt = buildLLMPrompt(ctx, config.correlations);

    const response = await callLLM(config.llmConfig, prompt);
    if (!response) return null;

    return parseLLMNarratives(response, ctx);
  } catch {
    return null;
  }
}

function buildLLMPrompt(ctx: NarrativeContext, correlations: Correlation[]): string {
  const sections: string[] = [];

  sections.push("You are an intelligence narrative engine for a developer tool. Generate concise, actionable narratives about the developer's AI collaboration patterns.");

  if (ctx.maturity) {
    sections.push(`Maturity: Phase ${ctx.maturity.phase.toFixed(1)} (${ctx.maturity.phaseLabel}), confidence ${pct(ctx.maturity.confidence)}.`);
  }

  if (ctx.dimensions.length > 0) {
    const dimSummary = ctx.dimensions
      .map((d) => `${d.name}: ${pct(d.score)} (${d.trend})`)
      .join(", ");
    sections.push(`Dimensions: ${dimSummary}`);
  }

  if (correlations.length > 0) {
    const corrSummary = correlations
      .map((c) => `[${c.severity}] ${c.title}: ${c.explanation}`)
      .join("\n");
    sections.push(`Cross-analyzer correlations:\n${corrSummary}`);
  }

  if (ctx.recentDecisions && ctx.recentDecisions.length > 0) {
    sections.push(`${ctx.recentDecisions.length} decisions this week.`);
  }

  if (ctx.stuckEntities && ctx.stuckEntities.length > 0) {
    sections.push(`Stuck on: ${ctx.stuckEntities.map((e) => e.name).join(", ")}`);
  }

  sections.push("Generate 3-5 narratives as JSON array: [{type, headline, body, importance}]. Types: diagnostic, prescription, progress, correlation. Importance: 0-1.");

  return sections.join("\n\n");
}

async function callLLM(config: LLMConfig, prompt: string): Promise<string | null> {
  try {
    const baseUrl = config.baseUrl ?? (config.provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com/v1");

    if (config.provider === "openai" || config.provider === "ollama") {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? null;
    }

    if (config.provider === "anthropic") {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as { content?: Array<{ text?: string }> };
      return data.content?.[0]?.text ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

function parseLLMNarratives(response: string, ctx: NarrativeContext): Narrative[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      type?: string;
      headline?: string;
      body?: string;
      importance?: number;
    }>;

    return parsed
      .filter((n) => n.headline && n.body)
      .map((n, i) => ({
        id: `llm-narrative-${i}`,
        type: (n.type as NarrativeType) ?? "diagnostic",
        headline: n.headline!,
        body: n.body!,
        importance: n.importance ?? 0.5,
        evidenceEventIds: ctx.correlations.flatMap((c) => c.evidenceEventIds.slice(0, 2)),
        relatedAnalyzers: [...new Set(ctx.correlations.flatMap((c) => c.analyzers))],
        createdAt: new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

// ─── Public Generation Function (IP-6.1) ────────────────────────────────────

export async function generateNarratives(
  analyzerOutputs: Map<string, unknown>,
  config: NarrativeEngineConfig,
  ctx: AnalyzerContext,
  maturityState: IncrementalState<unknown> | undefined,
  eventCount: number,
  lastLlmRunAt: string,
): Promise<{ narratives: Narrative[]; executiveSummary: string; lastLlmRunAt: string }> {
  const maturity = maturityState ? deriveMaturityFromState(maturityState) : null;
  const knowledgeData = await gatherKnowledgeContext(ctx);

  const narrativeCtx: NarrativeContext = {
    maturity,
    dimensions: maturity?.dimensions ?? [],
    eventCount,
    knowledgeGrounded: knowledgeData.knowledgeGrounded,
    recentDecisions: knowledgeData.recentDecisions,
    contradictions: knowledgeData.contradictions,
    comprehensionTrends: knowledgeData.comprehensionTrends,
    stuckEntities: knowledgeData.stuckEntities,
    correlations: config.correlations,
    analyzerOutputs,
  };

  let narratives: Narrative[] = [];
  let newLlmRunAt = lastLlmRunAt;

  const hoursSinceLastLlm = lastLlmRunAt
    ? (Date.now() - new Date(lastLlmRunAt).getTime()) / 3_600_000
    : Infinity;

  if (config.llmConfig && hoursSinceLastLlm >= 24) {
    const llmNarratives = await synthesizeWithLLM(narrativeCtx, config);
    if (llmNarratives && llmNarratives.length > 0) {
      narratives = llmNarratives;
      newLlmRunAt = new Date().toISOString();
    }
  }

  if (narratives.length === 0) {
    for (const template of ALL_TEMPLATES) {
      try {
        if (template.condition(narrativeCtx)) {
          narratives.push(template.generate(narrativeCtx));
        }
      } catch {
        // template evaluation failed — skip
      }
    }
  }

  narratives.sort((a, b) => b.importance - a.importance);
  const summary = generateExecutiveSummary(maturity, narrativeCtx);

  return { narratives, executiveSummary: summary, lastLlmRunAt: newLlmRunAt };
}

// ─── All Templates ──────────────────────────────────────────────────────────

const ALL_TEMPLATES = [
  ...KNOWLEDGE_TEMPLATES,
  ...CORRELATION_TEMPLATES,
  ...DIAGNOSTIC_TEMPLATES,
  ...PRESCRIPTION_TEMPLATES,
  ...PROGRESS_TEMPLATES,
];

// ─── IncrementalAnalyzer ────────────────────────────────────────────────────

export const narrativeEngineAnalyzer: IncrementalAnalyzer<NarrativeState, NarrativeOutput> = {
  name: "narrative-engine",
  outputFile: "narratives.json",
  eventFilter: { sources: [], types: [] },
  dependsOn: ["maturity-model"],
  minDataPoints: 20,

  async initialize(_ctx): Promise<IncrementalState<NarrativeState>> {
    return {
      value: { narratives: [], executiveSummary: "", updatedAt: new Date().toISOString(), lastLlmRunAt: "" },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<NarrativeState>> {
    const maturityState = ctx.dependencyStates?.get("maturity-model");
    if (!maturityState) return { state, changed: false };

    const maturity = deriveMaturityFromState(maturityState);
    const knowledgeData = await gatherKnowledgeContext(ctx);
    const narrativeCtx: NarrativeContext = {
      maturity,
      dimensions: maturity?.dimensions ?? [],
      eventCount: state.eventCount + batch.events.length,
      knowledgeGrounded: knowledgeData.knowledgeGrounded,
      recentDecisions: knowledgeData.recentDecisions,
      contradictions: knowledgeData.contradictions,
      comprehensionTrends: knowledgeData.comprehensionTrends,
      stuckEntities: knowledgeData.stuckEntities,
      correlations: [],
      analyzerOutputs: new Map(),
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
        value: { narratives: top, executiveSummary: summary, updatedAt: new Date().toISOString(), lastLlmRunAt: state.value.lastLlmRunAt },
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

// ─── Helpers ────────────────────────────────────────────────────────────────

async function gatherKnowledgeContext(ctx: AnalyzerContext): Promise<{
  knowledgeGrounded: boolean;
  recentDecisions?: NarrativeContext["recentDecisions"];
  contradictions?: NarrativeContext["contradictions"];
  comprehensionTrends?: NarrativeContext["comprehensionTrends"];
  stuckEntities?: NarrativeContext["stuckEntities"];
}> {
  if (!ctx.knowledge) return { knowledgeGrounded: false };
  try {
    const hasData = await ctx.knowledge.hasKnowledgeData();
    if (!hasData) return { knowledgeGrounded: false };

    const oneWeekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

    const decisions = await ctx.knowledge.getDecisions({ since: oneWeekAgo });
    const recentDecisions = decisions.map((d) => ({
      predicate: d.predicate, objectText: d.objectText, context: d.context, validAt: d.validAt,
    }));

    const allFacts = await ctx.knowledge.getFacts({ activeOnly: false });
    const contradictions = allFacts
      .filter((f) => f.invalidAt !== "" && f.invalidAt >= oneWeekAgo)
      .map((f) => ({
        predicate: f.predicate, objectText: f.objectText, context: f.context, invalidAt: f.invalidAt,
      }));

    const assessments = await ctx.knowledge.getComprehension({});
    const comprehensionTrends: NarrativeContext["comprehensionTrends"] = [];
    if (assessments.length >= 2) {
      const sorted = [...assessments].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const mid = Math.floor(sorted.length / 2);
      const earlier = sorted.slice(0, mid);
      const later = sorted.slice(mid);
      const earlyAvg = earlier.reduce((s, a) => s + a.overallScore, 0) / earlier.length;
      const lateAvg = later.reduce((s, a) => s + a.overallScore, 0) / later.length;
      const delta = lateAvg - earlyAvg;
      comprehensionTrends.push({
        domain: "overall",
        delta,
        direction: delta > 5 ? "improving" : delta < -5 ? "declining" : "stable",
      });
    }

    const entities = await ctx.knowledge.getEntityEngagement({ minOccurrences: 3 });
    const stuckEntities: NarrativeContext["stuckEntities"] = [];
    for (const entity of entities) {
      const entityFacts = allFacts.filter(
        (f) => f.subjectId === entity.entityId && f.invalidAt === "" && f.validAt >= oneWeekAgo,
      );
      if (entityFacts.length < entity.mentionCount * 0.3) {
        stuckEntities.push({
          name: entity.name,
          sessions: entity.mentionCount,
          factsGained: entityFacts.length,
        });
      }
    }

    return {
      knowledgeGrounded: true,
      recentDecisions: recentDecisions.length > 0 ? recentDecisions : undefined,
      contradictions: contradictions.length > 0 ? contradictions : undefined,
      comprehensionTrends: comprehensionTrends.length > 0 ? comprehensionTrends : undefined,
      stuckEntities: stuckEntities.length > 0 ? stuckEntities : undefined,
    };
  } catch {
    return { knowledgeGrounded: false };
  }
}

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
      phase < 2 ? ("bare-engine" as const)
        : phase < 3 ? ("first-gear" as const)
        : phase < 4 ? ("multi-gear" as const)
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
      knowledgeGrounded: (val as { knowledgeGrounded?: boolean }).knowledgeGrounded ?? false,
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

  const improving = maturity.dimensions.filter((d) => d.trend === "improving").map((d) => d.name);
  const declining = maturity.dimensions.filter((d) => d.trend === "declining").map((d) => d.name);

  let summary = `AI Collaboration Maturity: Phase ${maturity.phase.toFixed(1)} — ${maturity.phaseLabel.replace(/-/g, " ")}. `;
  summary += `Confidence: ${pct(maturity.confidence)} (based on ${ctx.eventCount} events). `;

  if (improving.length > 0) summary += `Improving: ${improving.join(", ")}. `;
  if (declining.length > 0) summary += `Declining: ${declining.join(", ")}. `;

  if (ctx.correlations.length > 0) {
    const criticals = ctx.correlations.filter((c) => c.severity === "critical");
    if (criticals.length > 0) {
      summary += `${criticals.length} critical cross-analyzer pattern${criticals.length > 1 ? "s" : ""} detected. `;
    }
  }

  if (maturity.bottlenecks.length > 0) {
    summary += `Primary bottleneck: ${maturity.bottlenecks[0].dimension}.`;
  }

  return summary;
}

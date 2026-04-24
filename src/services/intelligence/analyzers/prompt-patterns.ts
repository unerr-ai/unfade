// FILE: src/services/intelligence/analyzers/prompt-patterns.ts
// UF-106: Prompt Pattern Analyzer — clusters prompts by structural features,
// correlates with outcome (direction score), surfaces effective/anti patterns.

import type { PromptPatterns } from "../../../schemas/intelligence/prompt-patterns.js";
import { logger } from "../../../utils/logger.js";
import { classifyDomainFast } from "../domain-classifier.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { AnalyzerContext } from "./index.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PromptPatternsState {
  output: PromptPatterns;
}

// ---------------------------------------------------------------------------
// Feature extraction types
// ---------------------------------------------------------------------------

interface PromptFeatures {
  hasConstraints: boolean;
  hasExamples: boolean;
  hasSchema: boolean;
  questionCount: number;
  length: "short" | "medium" | "long";
  domain: string;
  directionScore: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSTRAINT_PATTERNS = /must|should|require|constraint|limit|rule|boundary|never|always|only/i;
const EXAMPLE_PATTERNS = /example|for instance|e\.g\.|such as|like this/i;
const SCHEMA_PATTERNS = /schema|type|interface|struct|model|class|enum/i;
const QUESTION_PATTERN = /\?/g;

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

async function _collectSourceEventIds(db: AnalyzerContext["analytics"]): Promise<string[]> {
  try {
    const result = await db.exec(`
      SELECT id FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND (metadata_extra->>'prompt_full' IS NOT NULL OR content_summary IS NOT NULL)
      ORDER BY ts DESC
      LIMIT 20
    `);
    if (!result[0]?.values.length) return [];
    return result[0].values.map((row) => row[0] as string);
  } catch {
    return [];
  }
}

async function extractPromptFeatures(db: AnalyzerContext["analytics"]): Promise<PromptFeatures[]> {
  try {
    const result = await db.exec(`
      SELECT
        COALESCE(metadata_extra->>'prompt_full', content_summary) as prompt_text,
        COALESCE(metadata_extra->>'prompts_all', content_detail) as prompts_context,
        human_direction_score as hds,
        prompt_specificity as spec
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND (metadata_extra->>'prompt_full' IS NOT NULL OR content_summary IS NOT NULL)
      ORDER BY ts DESC
      LIMIT 500
    `);

    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => {
      const promptText = (row[0] as string) ?? "";
      const promptsContext = (row[1] as string) ?? "";
      const text = `${promptText} ${promptsContext}`;
      const hds = (row[2] as number) ?? 0.5;

      const len = text.length;
      const length: "short" | "medium" | "long" =
        len < 100 ? "short" : len < 500 ? "medium" : "long";

      return {
        hasConstraints: CONSTRAINT_PATTERNS.test(text),
        hasExamples: EXAMPLE_PATTERNS.test(text),
        hasSchema: SCHEMA_PATTERNS.test(text),
        questionCount: (text.match(QUESTION_PATTERN) ?? []).length,
        length,
        domain: classifyDomainFast(text),
        directionScore: hds,
      };
    });
  } catch {
    return [];
  }
}

function findEffectivePatterns(features: PromptFeatures[]): PromptPatterns["effectivePatterns"] {
  const patterns: PromptPatterns["effectivePatterns"] = [];
  const domainGroups = groupByDomain(features);

  for (const [domain, group] of domainGroups) {
    if (group.length < 5) continue;

    const withConstraints = group.filter((f) => f.hasConstraints);
    const without = group.filter((f) => !f.hasConstraints);

    if (withConstraints.length >= 3 && without.length >= 3) {
      const avgWith = mean(withConstraints.map((f) => f.directionScore));
      const avgWithout = mean(without.map((f) => f.directionScore));
      if (avgWith > avgWithout * 1.3) {
        patterns.push({
          domain,
          pattern: `Prompts with explicit constraints produce ${Math.round((avgWith / Math.max(avgWithout, 0.01)) * 100 - 100)}% better direction in ${domain}`,
          acceptanceRate: avgWith,
          sampleSize: withConstraints.length,
        });
      }
    }

    const withExamples = group.filter((f) => f.hasExamples);
    const withoutExamples = group.filter((f) => !f.hasExamples);
    if (withExamples.length >= 3 && withoutExamples.length >= 3) {
      const avgWith = mean(withExamples.map((f) => f.directionScore));
      const avgWithout = mean(withoutExamples.map((f) => f.directionScore));
      if (avgWith > avgWithout * 1.2) {
        patterns.push({
          domain,
          pattern: `Including examples in ${domain} prompts improves outcomes by ${Math.round((avgWith / Math.max(avgWithout, 0.01)) * 100 - 100)}%`,
          acceptanceRate: avgWith,
          sampleSize: withExamples.length,
        });
      }
    }

    const longPrompts = group.filter((f) => f.length === "long");
    const shortPrompts = group.filter((f) => f.length === "short");
    if (longPrompts.length >= 3 && shortPrompts.length >= 3) {
      const avgLong = mean(longPrompts.map((f) => f.directionScore));
      const avgShort = mean(shortPrompts.map((f) => f.directionScore));
      if (avgLong > avgShort * 1.3) {
        patterns.push({
          domain,
          pattern: `Detailed prompts (${">"}500 chars) in ${domain} produce significantly better direction than short ones`,
          acceptanceRate: avgLong,
          sampleSize: longPrompts.length,
        });
      }
    }
  }

  return patterns.sort((a, b) => b.acceptanceRate - a.acceptanceRate).slice(0, 10);
}

function findAntiPatterns(features: PromptFeatures[]): PromptPatterns["antiPatterns"] {
  const patterns: PromptPatterns["antiPatterns"] = [];
  const domainGroups = groupByDomain(features);

  for (const [domain, group] of domainGroups) {
    if (group.length < 5) continue;

    const lowDirection = group.filter((f) => f.directionScore < 0.3);
    if (lowDirection.length < 3) continue;

    const lowPct = lowDirection.length / group.length;
    if (lowPct > 0.4) {
      const noConstraints = lowDirection.filter((f) => !f.hasConstraints).length;
      const shortPrompts = lowDirection.filter((f) => f.length === "short").length;

      if (noConstraints / lowDirection.length > 0.7) {
        patterns.push({
          domain,
          pattern: `${Math.round(lowPct * 100)}% of ${domain} sessions have low direction — most lack explicit constraints`,
          rejectionRate: lowPct,
          suggestion: `Try front-loading constraints in ${domain} prompts: specify boundaries, requirements, and expected behavior before asking the model to generate.`,
        });
      } else if (shortPrompts / lowDirection.length > 0.6) {
        patterns.push({
          domain,
          pattern: `Short, vague prompts in ${domain} correlate with low-direction sessions`,
          rejectionRate: lowPct,
          suggestion: `Invest in longer, more specific prompts for ${domain}. Include context about project conventions, constraints, and expected patterns.`,
        });
      }
    }
  }

  return patterns.sort((a, b) => b.rejectionRate - a.rejectionRate).slice(0, 5);
}

function groupByDomain(features: PromptFeatures[]): Map<string, PromptFeatures[]> {
  const groups = new Map<string, PromptFeatures[]>();
  for (const f of features) {
    const arr = groups.get(f.domain) ?? [];
    arr.push(f);
    groups.set(f.domain, arr);
  }
  return groups;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Full computation — assembles prompt features into a PromptPatterns output
// ---------------------------------------------------------------------------

async function computePromptPatterns(db: AnalyzerContext["analytics"]): Promise<PromptPatterns> {
  const now = new Date().toISOString();

  const features = await extractPromptFeatures(db);
  if (features.length < 10) {
    return {
      effectivePatterns: [],
      antiPatterns: [],
      updatedAt: now,
      totalPromptsAnalyzed: 0,
    };
  }

  const effectivePatterns = findEffectivePatterns(features);
  const antiPatterns = findAntiPatterns(features);

  return {
    effectivePatterns,
    antiPatterns,
    updatedAt: now,
    totalPromptsAnalyzed: features.length,
  };
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const promptPatternsAnalyzer: IncrementalAnalyzer<PromptPatternsState, PromptPatterns> = {
  name: "prompt-patterns",
  outputFile: "prompt-patterns.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 10,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<PromptPatternsState>> {
    logger.debug("prompt-patterns: initializing");
    const output = await computePromptPatterns(ctx.analytics);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: output.totalPromptsAnalyzed,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<PromptPatternsState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<PromptPatternsState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const output = await computePromptPatterns(ctx.analytics);
    const oldEffective = state.value.output.effectivePatterns.length;
    const newEffective = output.effectivePatterns.length;
    const oldAnti = state.value.output.antiPatterns.length;
    const newAnti = output.antiPatterns.length;
    const changed = oldEffective !== newEffective || oldAnti !== newAnti;

    const newState: IncrementalState<PromptPatternsState> = {
      value: { output },
      watermark: output.updatedAt,
      eventCount: state.eventCount + newEvents.events.length,
      updatedAt: output.updatedAt,
    };

    return {
      state: newState,
      changed,
      changeMagnitude: Math.abs(newEffective - oldEffective) + Math.abs(newAnti - oldAnti),
    };
  },

  derive(state: IncrementalState<PromptPatternsState>): PromptPatterns {
    return state.value.output;
  },
};

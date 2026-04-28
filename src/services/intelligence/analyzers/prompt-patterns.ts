// UF-106 + IP-4.2: Prompt Pattern Analyzer — clusters prompts by structural features,
// correlates with outcome (direction score), surfaces effective/anti patterns.
//
// IP-4.2 enrichment: _meta freshness, exampleSessionIds per pattern, diagnostics.
// Removed LIMIT 500 — paginated batch processing via full query.

import type { AnalyzerOutputMeta, DiagnosticMessage } from "../../../schemas/intelligence-presentation.js";
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

// ─── State ──────────────────────────────────────────────────────────────────

interface PromptPatternsState {
  output: PromptPatterns;
}

// ─── Feature Extraction Types ───────────────────────────────────────────────

interface PromptFeatures {
  eventId: string;
  hasConstraints: boolean;
  hasExamples: boolean;
  hasSchema: boolean;
  questionCount: number;
  length: "short" | "medium" | "long";
  domain: string;
  directionScore: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONSTRAINT_PATTERNS = /must|should|require|constraint|limit|rule|boundary|never|always|only/i;
const EXAMPLE_PATTERNS = /example|for instance|e\.g\.|such as|like this/i;
const SCHEMA_PATTERNS = /schema|type|interface|struct|model|class|enum/i;
const QUESTION_PATTERN = /\?/g;

// ─── Compute Helpers ────────────────────────────────────────────────────────

async function extractPromptFeatures(db: AnalyzerContext["analytics"]): Promise<PromptFeatures[]> {
  try {
    const result = await db.exec(`
      SELECT
        id,
        COALESCE(metadata_extra->>'prompt_full', content_summary) as prompt_text,
        COALESCE(metadata_extra->>'prompts_all', content_detail) as prompts_context,
        human_direction_score as hds,
        prompt_specificity as spec
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND (metadata_extra->>'prompt_full' IS NOT NULL OR content_summary IS NOT NULL)
      ORDER BY ts DESC
    `);

    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => {
      const eventId = (row[0] as string) ?? "";
      const promptText = (row[1] as string) ?? "";
      const promptsContext = (row[2] as string) ?? "";
      const text = `${promptText} ${promptsContext}`;
      const hds = Number(row[3] ?? 0.5);

      const len = text.length;
      const length: "short" | "medium" | "long" =
        len < 100 ? "short" : len < 500 ? "medium" : "long";

      return {
        eventId,
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

function findEffectivePatterns(
  features: PromptFeatures[],
): PromptPatterns["effectivePatterns"] {
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
          exampleSessionIds: collectBestSessionIds(withConstraints),
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
          exampleSessionIds: collectBestSessionIds(withExamples),
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
          exampleSessionIds: collectBestSessionIds(longPrompts),
        });
      }
    }
  }

  return patterns.sort((a, b) => b.acceptanceRate - a.acceptanceRate);
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
          exampleSessionIds: lowDirection.map((f) => f.eventId),
        });
      } else if (shortPrompts / lowDirection.length > 0.6) {
        patterns.push({
          domain,
          pattern: `Short, vague prompts in ${domain} correlate with low-direction sessions`,
          rejectionRate: lowPct,
          suggestion: `Invest in longer, more specific prompts for ${domain}. Include context about project conventions, constraints, and expected patterns.`,
          exampleSessionIds: lowDirection.filter((f) => f.length === "short").map((f) => f.eventId),
        });
      }
    }
  }

  return patterns.sort((a, b) => b.rejectionRate - a.rejectionRate);
}

function collectBestSessionIds(features: PromptFeatures[]): string[] {
  return features
    .sort((a, b) => b.directionScore - a.directionScore)
    .map((f) => f.eventId)
    .filter(Boolean);
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

// ─── Meta + Diagnostics ─────────────────────────────────────────────────────

async function buildMeta(
  db: AnalyzerContext["analytics"],
  totalPrompts: number,
  updatedAt: string,
): Promise<AnalyzerOutputMeta> {
  const confidence: "high" | "medium" | "low" =
    totalPrompts >= 50 ? "high" : totalPrompts >= 20 ? "medium" : "low";

  let watermark = updatedAt;
  let stalenessMs = 0;

  try {
    const result = await db.exec(
      "SELECT MAX(ts) FROM events WHERE source IN ('ai-session', 'mcp-active')",
    );
    const maxTs = result[0]?.values[0]?.[0] as string | null;
    if (maxTs) {
      watermark = maxTs;
      stalenessMs = Math.max(0, Date.now() - new Date(maxTs).getTime());
    }
  } catch { /* non-fatal */ }

  return { updatedAt, dataPoints: totalPrompts, confidence, watermark, stalenessMs };
}

function buildDiagnostics(
  effectivePatterns: PromptPatterns["effectivePatterns"],
  antiPatterns: PromptPatterns["antiPatterns"],
  totalPrompts: number,
): DiagnosticMessage[] {
  const diagnostics: DiagnosticMessage[] = [];

  if (antiPatterns.length > 0) {
    const worst = antiPatterns[0];
    diagnostics.push({
      severity: worst.rejectionRate > 0.5 ? "critical" : "warning",
      message: `Anti-pattern detected in "${worst.domain}" — ${Math.round(worst.rejectionRate * 100)}% of sessions have low direction`,
      evidence: `${worst.pattern}`,
      actionable: worst.suggestion,
      relatedAnalyzers: ["efficiency", "velocity-tracker"],
      evidenceEventIds: worst.exampleSessionIds,
    });
  }

  if (effectivePatterns.length > 0) {
    const best = effectivePatterns[0];
    diagnostics.push({
      severity: "info",
      message: `Effective pattern found in "${best.domain}" — ${best.pattern}`,
      evidence: `${best.sampleSize} sessions analyzed, acceptance rate: ${Math.round(best.acceptanceRate * 100)}%`,
      actionable: "Apply this pattern to other domains where you see lower direction scores",
      relatedAnalyzers: ["velocity-tracker"],
      evidenceEventIds: best.exampleSessionIds.slice(0, 5),
    });
  }

  if (totalPrompts < 20) {
    diagnostics.push({
      severity: "info",
      message: `Only ${totalPrompts} prompts analyzed — patterns will become more reliable with more data`,
      evidence: `Minimum 20 prompts recommended for statistical significance`,
      actionable: "Continue using AI tools — pattern detection improves with more data",
      relatedAnalyzers: [],
      evidenceEventIds: [],
    });
  }

  return diagnostics;
}

// ─── Full Computation ───────────────────────────────────────────────────────

async function computePromptPatterns(db: AnalyzerContext["analytics"]): Promise<PromptPatterns> {
  const now = new Date().toISOString();

  const features = await extractPromptFeatures(db);
  if (features.length < 10) {
    const _meta = await buildMeta(db, features.length, now);
    return {
      effectivePatterns: [],
      antiPatterns: [],
      updatedAt: now,
      totalPromptsAnalyzed: features.length,
      _meta,
      diagnostics: buildDiagnostics([], [], features.length),
    };
  }

  const effectivePatterns = findEffectivePatterns(features);
  const antiPatterns = findAntiPatterns(features);
  const _meta = await buildMeta(db, features.length, now);
  const diagnostics = buildDiagnostics(effectivePatterns, antiPatterns, features.length);

  return {
    effectivePatterns,
    antiPatterns,
    updatedAt: now,
    totalPromptsAnalyzed: features.length,
    _meta,
    diagnostics,
  };
}

// ─── KGI-8.4: Entity/topic context enrichment ──────────────────────────────

async function enrichPatternEntities(output: PromptPatterns, ctx: AnalyzerContext): Promise<void> {
  if (!ctx.knowledge) return;
  try {
    const hasData = await ctx.knowledge.hasKnowledgeData();
    if (!hasData) return;

    const entities = await ctx.knowledge.getEntityEngagement({});
    if (entities.length === 0) return;

    const entityNames = entities.map((e) => e.name.toLowerCase());

    for (const pattern of output.effectivePatterns) {
      const domainLower = pattern.domain.toLowerCase();
      const matched = entityNames.filter((e) => domainLower.includes(e) || e.includes(domainLower));
      if (matched.length > 0) {
        pattern.entities = matched.slice(0, 5);
      }
    }
  } catch {
    // Non-fatal
  }
}

// ─── IncrementalAnalyzer Export ──────────────────────────────────────────────

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
    await enrichPatternEntities(output, ctx);
    const oldEffective = state.value.output.effectivePatterns.length;
    const newEffective = output.effectivePatterns.length;
    const oldAnti = state.value.output.antiPatterns.length;
    const newAnti = output.antiPatterns.length;
    const changed = oldEffective !== newEffective || oldAnti !== newAnti;

    return {
      state: {
        value: { output },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: Math.abs(newEffective - oldEffective) + Math.abs(newAnti - oldAnti),
    };
  },

  derive(state: IncrementalState<PromptPatternsState>): PromptPatterns {
    return state.value.output;
  },
};

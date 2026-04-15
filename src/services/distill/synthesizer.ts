// FILE: src/services/distill/synthesizer.ts
// UF-034 + UF-039: Stage 3 — Synthesizer.
// LLM path: generateObject() with DailyDistillSchema for narrative synthesis.
// Fallback path: structured signal summary without LLM — valid DailyDistill markdown.

import { generateObject } from "ai";
import {
  type DailyDistill,
  DailyDistillSchema,
  type LinkedSignals,
} from "../../schemas/distill.js";
import { logger } from "../../utils/logger.js";
import type { LLMProviderResult } from "./providers/ai.js";

/**
 * Synthesize linked signals into a DailyDistill.
 * Uses LLM if provider is given, otherwise falls back to structured summary.
 */
export async function synthesize(
  linked: LinkedSignals,
  provider?: LLMProviderResult | null,
): Promise<DailyDistill> {
  if (provider) {
    try {
      return await synthesizeWithLLM(linked, provider);
    } catch (err) {
      logger.warn("LLM synthesis failed, falling back to structured summary", {
        error: err instanceof Error ? err.message : String(err),
      });
      return synthesizeFallback(linked);
    }
  }
  return synthesizeFallback(linked);
}

/**
 * LLM synthesis path — uses generateObject() with Zod schema.
 */
async function synthesizeWithLLM(
  linked: LinkedSignals,
  provider: LLMProviderResult,
): Promise<DailyDistill> {
  const prompt = buildLLMPrompt(linked);

  const { object } = await generateObject({
    model: provider.model,
    schema: DailyDistillSchema,
    prompt,
  });

  // Ensure date and eventsProcessed match the source data
  return {
    ...object,
    date: linked.date,
    eventsProcessed: linked.stats.totalEvents,
    synthesizedBy: "llm",
  };
}

/**
 * Build the LLM prompt from linked signals.
 */
function buildLLMPrompt(linked: LinkedSignals): string {
  const sections: string[] = [
    `You are analyzing a developer's engineering activity for ${linked.date}.`,
    `Generate a Daily Distill — a concise reasoning summary that captures decisions, trade-offs, dead ends, breakthroughs, and patterns.`,
    "",
    `## Raw Signals`,
    "",
    `### Commits (${linked.decisions.length})`,
  ];

  for (const d of linked.decisions) {
    const files = d.files?.join(", ") ?? "no files";
    const alts = d.alternativesCount > 0 ? ` (${d.alternativesCount} alternative branches)` : "";
    sections.push(`- ${d.summary} [${d.branch ?? "unknown branch"}] files: ${files}${alts}`);
  }

  if (linked.tradeOffs.length > 0) {
    sections.push("", `### AI Rejections / Trade-offs (${linked.tradeOffs.length})`);
    for (const t of linked.tradeOffs) {
      sections.push(`- ${t.summary} files: ${t.relatedFiles?.join(", ") ?? "none"}`);
    }
  }

  if (linked.deadEnds.length > 0) {
    sections.push("", `### Reverts / Dead Ends (${linked.deadEnds.length})`);
    for (const d of linked.deadEnds) {
      const time = d.timeSpentMinutes ? ` (~${d.timeSpentMinutes} min spent)` : "";
      sections.push(`- ${d.summary}${time}`);
    }
  }

  if (linked.temporalChains.length > 0) {
    sections.push("", `### Temporal Chains`);
    for (const c of linked.temporalChains) {
      sections.push(`- ${c.module}: ${c.summary}`);
    }
  }

  sections.push(
    "",
    `### Stats`,
    `- Total events: ${linked.stats.totalEvents}`,
    `- Commits: ${linked.stats.commitCount}`,
    `- AI completions: ${linked.stats.aiCompletions}`,
    `- AI rejections: ${linked.stats.aiRejections}`,
    `- Branch switches: ${linked.stats.branchSwitches}`,
    `- Files changed: ${linked.stats.filesChanged.length}`,
    `- Domains: ${linked.stats.domains.join(", ") || "none"}`,
  );

  if (linked.stats.aiAcceptanceRate !== undefined) {
    sections.push(`- AI acceptance rate: ${(linked.stats.aiAcceptanceRate * 100).toFixed(0)}%`);
  }

  sections.push(
    "",
    `## Instructions`,
    `- Write a concise summary (2-3 sentences) of the day's engineering work`,
    `- Extract key decisions with rationale (why this approach, not just what)`,
    `- Identify trade-offs where the developer chose one approach over another`,
    `- Flag dead ends — work that was reverted or abandoned, with estimated time spent`,
    `- Note breakthroughs — moments of significant progress`,
    `- Identify recurring patterns across the day's work`,
    `- Use the developer's own words from commit messages where possible`,
    `- Be specific — reference actual files and branches, not generic summaries`,
  );

  return sections.join("\n");
}

/**
 * Fallback synthesizer — UF-039.
 * Produces valid DailyDistill without LLM.
 * Structured signal summary: decision count, file list, domain tags,
 * time estimates, AI acceptance rate.
 */
export function synthesizeFallback(linked: LinkedSignals): DailyDistill {
  const { stats } = linked;

  // Build summary from stats
  const summaryParts: string[] = [];
  if (stats.commitCount > 0) {
    summaryParts.push(`${stats.commitCount} commit${stats.commitCount !== 1 ? "s" : ""}`);
  }
  if (stats.branchSwitches > 0) {
    summaryParts.push(
      `${stats.branchSwitches} branch switch${stats.branchSwitches !== 1 ? "es" : ""}`,
    );
  }
  if (stats.aiCompletions + stats.aiRejections > 0) {
    summaryParts.push(
      `${stats.aiCompletions + stats.aiRejections} AI interaction${stats.aiCompletions + stats.aiRejections !== 1 ? "s" : ""}`,
    );
  }
  if (stats.domains.length > 0) {
    summaryParts.push(`across ${stats.domains.join(", ")}`);
  }

  const summary =
    summaryParts.length > 0
      ? `Engineering activity on ${linked.date}: ${summaryParts.join(", ")}.`
      : `No significant activity on ${linked.date}.`;

  // Map linked decisions → DailyDistill decisions
  const decisions = linked.decisions.map((d) => ({
    decision: d.summary,
    rationale: d.branch ? `On branch ${d.branch}` : "From git history",
    domain: d.branch ? domainFromBranch(d.branch) : undefined,
    alternativesConsidered: d.alternativesCount > 0 ? d.alternativesCount : undefined,
  }));

  // Map trade-offs
  const tradeOffs =
    linked.tradeOffs.length > 0
      ? linked.tradeOffs.map((t) => ({
          tradeOff: t.summary,
          chose: "Developer's approach",
          rejected: "AI suggestion",
          context: t.relatedFiles?.join(", "),
        }))
      : undefined;

  // Map dead ends
  const deadEnds =
    linked.deadEnds.length > 0
      ? linked.deadEnds.map((d) => ({
          description: d.summary,
          timeSpentMinutes: d.timeSpentMinutes,
          resolution: "Reverted",
        }))
      : undefined;

  // Map breakthroughs
  const breakthroughs =
    linked.breakthroughs.length > 0
      ? linked.breakthroughs.map((b) => ({
          description: b.summary,
          trigger: b.triggeredBy,
        }))
      : undefined;

  // Patterns from temporal chains
  const patterns =
    linked.temporalChains.length > 0
      ? linked.temporalChains.map(
          (c) => `Focused work on ${c.module} (${c.eventIds.length} commits)`,
        )
      : undefined;

  // Acceptance rate as a pattern
  if (stats.aiAcceptanceRate !== undefined) {
    const rate = `AI acceptance rate: ${(stats.aiAcceptanceRate * 100).toFixed(0)}%`;
    if (patterns) {
      patterns.push(rate);
    }
  }

  return {
    date: linked.date,
    summary,
    decisions,
    tradeOffs,
    deadEnds,
    breakthroughs,
    patterns,
    eventsProcessed: stats.totalEvents,
    themes: stats.domains.length > 0 ? stats.domains : undefined,
    domains: stats.domains.length > 0 ? stats.domains : undefined,
    synthesizedBy: "fallback",
  };
}

function domainFromBranch(branch: string): string | undefined {
  const lower = branch.toLowerCase();
  if (lower.includes("feat")) return "feature";
  if (lower.includes("fix") || lower.includes("bug")) return "bugfix";
  if (lower.includes("refactor")) return "refactoring";
  if (lower.includes("test")) return "testing";
  if (lower.includes("doc")) return "documentation";
  if (lower.includes("ci") || lower.includes("deploy")) return "infrastructure";
  return undefined;
}

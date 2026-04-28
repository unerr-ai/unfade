// FILE: src/services/distill/post-enricher.ts
// Stage 4: Post-Synthesis Enrichment
// Extracted from distiller.ts — adds cross-cutting concerns after synthesis:
// 1. Evidence ID propagation (keyword Jaccard matching)
// 2. Project name resolution (registry → human-readable labels)
// 3. Continuity thread cross-day linking (persistent open questions)
// 4. Narrative markdown generation
// 5. Decision record generation for primary-tier decisions

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ContinuityThread,
  DailyDistill,
  EnrichedDistill,
  NarrativeSpine,
  TriagedSignals,
} from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";
import { getDistillsDir } from "../../utils/paths.js";
import { loadRegistry } from "../registry/registry.js";

// ────────────────────────────────────────────────────────────
// 1. Build enriched distill from pipeline outputs
// ────────────────────────────────────────────────────────────

/**
 * Build an EnrichedDistill from pipeline outputs.
 * Maps v1 DailyDistill + triage + narrative into the v2 enriched schema.
 * Applies all post-synthesis enrichments: evidence linking, project resolution,
 * continuity thread linking.
 */
export function buildEnrichedDistill(
  result: DailyDistill,
  triaged: TriagedSignals,
  narrative: NarrativeSpine,
  events: CaptureEvent[],
): EnrichedDistill {
  // Build project name map from registry
  const projectNames = buildProjectNameMap();

  // Map decisions to enriched format with impact scores from triage
  const enrichedDecisions = result.decisions.map((d, i) => {
    const allScored = [
      ...triaged.prioritized.primary,
      ...triaged.prioritized.supporting,
      ...triaged.prioritized.background,
    ];
    const match = allScored.find(
      (s) => s.type === "decision" && triaged.decisions[s.index]?.summary === d.decision,
    );

    const evidenceIds = findEvidenceEventIds(d, events);
    const tier = match?.tier ?? "background";
    const impactScore = match?.impactScore?.total ?? 0;
    const actIndex = narrative.acts.findIndex((a) => a.decisionIndices.includes(i));

    return {
      decision: d.decision,
      rationale: d.rationale,
      domain: d.domain,
      alternativesConsidered: d.alternativesConsidered ?? 0,
      impactScore,
      tier,
      projectId: d.projectId,
      projectName: d.projectId ? projectNames.get(d.projectId) : undefined,
      evidenceEventIds: evidenceIds,
      relatedTradeOffIndices: [] as number[],
      relatedDeadEndIndices: [] as number[],
      actIndex: actIndex >= 0 ? actIndex : undefined,
      humanDirectionScore: (d as Record<string, unknown>).humanDirectionScore as number | undefined,
      directionClassification: (d as Record<string, unknown>).directionClassification as
        | "human-directed"
        | "collaborative"
        | "ai-suggested"
        | undefined,
    };
  });

  // Map trade-offs
  const enrichedTradeOffs = (result.tradeOffs ?? []).map((t) => ({
    tradeOff: t.tradeOff,
    chose: t.chose,
    rejected: t.rejected,
    context: t.context,
    evidenceEventIds: [] as string[],
  }));

  // Map dead ends
  const enrichedDeadEnds = (result.deadEnds ?? []).map((de) => ({
    description: de.description,
    attemptSummary: de.description,
    timeSpentMinutes: de.timeSpentMinutes,
    resolution: de.resolution,
    detectionMethod: "explicit" as const,
    evidenceEventIds: [] as string[],
  }));

  // Map breakthroughs
  const enrichedBreakthroughs = (result.breakthroughs ?? []).map((b) => ({
    description: b.description,
    trigger: b.trigger,
    evidenceEventIds: [] as string[],
  }));

  return {
    date: result.date,
    version: 2,
    narrative,
    decisions: enrichedDecisions,
    tradeOffs: enrichedTradeOffs,
    deadEnds: enrichedDeadEnds,
    breakthroughs: enrichedBreakthroughs,
    patterns: result.patterns ?? [],
    domains: result.domains ?? [],
    continuityThreads: narrative.continuityThreads,
    meta: {
      eventsProcessed: result.eventsProcessed,
      synthesizedBy: (result.synthesizedBy as "llm" | "fallback") ?? "fallback",
      synthesizedAt: new Date().toISOString(),
      signalCounts: {
        primary: triaged.prioritized.primary.length,
        supporting: triaged.prioritized.supporting.length,
        background: triaged.prioritized.background.length,
      },
      dayShape: triaged.dayShape,
    },
    directionSummary: result.directionSummary,
    aiCollaborationSummary: result.aiCollaborationSummary,
  };
}

// ────────────────────────────────────────────────────────────
// 2. Evidence ID propagation
// ────────────────────────────────────────────────────────────

/**
 * Find event IDs that contributed to a decision via normalized keyword matching.
 * Uses keyword Jaccard-like scoring: matches decision text against event content.
 * Threshold: at least 2 keyword hits for inclusion.
 */
export function findEvidenceEventIds(
  decision: { decision: string; domain?: string; rationale?: string },
  events: CaptureEvent[],
): string[] {
  const keywords = extractKeywords(
    `${decision.decision} ${decision.rationale ?? ""} ${decision.domain ?? ""}`,
  );
  if (keywords.length === 0) return [];

  const scored: Array<{ id: string; score: number }> = [];

  for (const event of events) {
    const text = `${event.content.summary} ${event.content.detail ?? ""}`.toLowerCase();
    let hits = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) hits++;
    }
    if (hits >= 2) {
      scored.push({ id: event.id, score: hits });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.id);
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "was",
    "are",
    "to",
    "for",
    "of",
    "in",
    "on",
    "with",
    "and",
    "or",
    "not",
    "it",
    "this",
    "that",
    "we",
    "i",
    "you",
    "be",
    "have",
    "do",
    "will",
    "would",
    "could",
    "should",
    "but",
    "if",
    "from",
    "at",
    "by",
    "as",
    "into",
    "about",
    "than",
    "so",
    "no",
    "up",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 15);
}

// ────────────────────────────────────────────────────────────
// 3. Project name resolution
// ────────────────────────────────────────────────────────────

/**
 * Build projectId → human-readable label map from the global registry.
 */
function buildProjectNameMap(): Map<string, string> {
  const nameMap = new Map<string, string>();
  try {
    const registry = loadRegistry();
    for (const repo of registry.repos) {
      nameMap.set(repo.id, repo.label);
    }
  } catch {
    logger.debug("Could not load registry for project name resolution");
  }
  return nameMap;
}

// ────────────────────────────────────────────────────────────
// 4. Continuity thread cross-day linking
// ────────────────────────────────────────────────────────────

/**
 * Link today's continuity threads against recent distills.
 * - If a thread's question matches a previous unresolved thread, mark it as continued
 * - If today's decisions resolve a previous thread, mark it as resolved
 * - Threads open for 3+ consecutive days are flagged as persistent open questions
 *
 * Mutates the enriched distill in-place.
 */
export async function linkContinuityThreads(
  enriched: EnrichedDistill,
  cwd?: string,
): Promise<void> {
  const recentThreads = await loadRecentThreads(enriched.date, 7, cwd);
  if (recentThreads.length === 0) return;

  const decisionTexts = enriched.decisions.map((d) => d.decision.toLowerCase());

  for (const thread of enriched.continuityThreads) {
    const questionKeywords = extractKeywords(thread.question);

    // Check if any recent distill had a similar unresolved thread
    for (const prev of recentThreads) {
      const prevKeywords = extractKeywords(prev.thread.question);
      const overlap = questionKeywords.filter((kw) => prevKeywords.includes(kw)).length;
      const union = new Set([...questionKeywords, ...prevKeywords]).size;

      if (union > 0 && overlap / union >= 0.35) {
        thread.continuedFrom = prev.date;
        break;
      }
    }

    // Check if today's decisions resolve this thread
    for (let i = 0; i < enriched.decisions.length; i++) {
      const decText = decisionTexts[i];
      const threadKeywords = extractKeywords(thread.question);
      const hits = threadKeywords.filter((kw) => decText.includes(kw)).length;
      if (hits >= 3) {
        thread.resolved = true;
        thread.resolvingDecisionIndex = i;
        break;
      }
    }
  }
}

interface HistoricalThread {
  date: string;
  thread: ContinuityThread;
}

/**
 * Load unresolved continuity threads from recent distill JSON files.
 */
async function loadRecentThreads(
  currentDate: string,
  days: number,
  cwd?: string,
): Promise<HistoricalThread[]> {
  const distillsDir = getDistillsDir(cwd);
  const threads: HistoricalThread[] = [];

  // Walk backward from current date
  const current = new Date(`${currentDate}T00:00:00`);
  for (let i = 1; i <= days; i++) {
    const d = new Date(current);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const jsonPath = join(distillsDir, `${dateStr}.json`);

    if (!existsSync(jsonPath)) continue;

    try {
      const raw = await readFile(jsonPath, "utf-8");
      const distill = JSON.parse(raw) as { continuityThreads?: ContinuityThread[] };
      if (distill.continuityThreads) {
        for (const t of distill.continuityThreads) {
          if (!t.resolved) {
            threads.push({ date: dateStr, thread: t });
          }
        }
      }
    } catch {
      // Skip unreadable distills
    }
  }

  return threads;
}

// ────────────────────────────────────────────────────────────
// 5. Narrative markdown generation
// ────────────────────────────────────────────────────────────

/**
 * Format an EnrichedDistill as narrative-driven markdown.
 * Reads like a story, not a stat dump.
 */
export function formatDistillMarkdown(e: EnrichedDistill): string {
  const lines: string[] = [];
  const { narrative } = e;

  // Headline
  lines.push(`# ${narrative.arc.headline}`, "");
  lines.push(`> ${narrative.arc.openingContext}`, "");

  // Key decisions (primary tier only)
  const primary = e.decisions.filter((d) => d.tier === "primary");
  const supporting = e.decisions.filter((d) => d.tier === "supporting");

  if (primary.length > 0) {
    lines.push("## Key Decisions", "");
    for (const dec of primary) {
      const domain = dec.domain ? ` [${dec.domain}]` : "";
      lines.push(`### ${dec.decision}${domain}`, "");
      lines.push(dec.rationale);
      if (dec.causalTrigger) lines.push(``, `_Triggered by: ${dec.causalTrigger}_`);
      if (dec.outcome) lines.push(``, `_Outcome: ${dec.outcome}_`);
      lines.push("");
    }
  }

  // Supporting decisions (compact)
  if (supporting.length > 0) {
    lines.push("## Also Decided", "");
    for (const dec of supporting) {
      const domain = dec.domain ? ` [${dec.domain}]` : "";
      lines.push(`- **${dec.decision}**${domain} — ${dec.rationale}`);
    }
    lines.push("");
  }

  // Trade-offs
  if (e.tradeOffs.length > 0) {
    lines.push("## Trade-offs", "");
    for (const t of e.tradeOffs) {
      lines.push(`- **${t.tradeOff}**`);
      lines.push(`  Chose: ${t.chose} | Rejected: ${t.rejected}`);
      if (t.context) lines.push(`  _${t.context}_`);
    }
    lines.push("");
  }

  // Dead ends
  if (e.deadEnds.length > 0) {
    lines.push("## Dead Ends", "");
    for (const de of e.deadEnds) {
      const time = de.timeSpentMinutes ? ` (~${de.timeSpentMinutes} min)` : "";
      lines.push(`- **${de.description}**${time}`);
      if (de.attemptSummary) lines.push(`  ${de.attemptSummary}`);
      if (de.resolution) lines.push(`  _Resolution: ${de.resolution}_`);
    }
    lines.push("");
  }

  // Breakthroughs
  if (e.breakthroughs.length > 0) {
    lines.push("## Breakthroughs", "");
    for (const b of e.breakthroughs) {
      lines.push(`- **${b.description}**`);
      if (b.trigger) lines.push(`  _Triggered by: ${b.trigger}_`);
    }
    lines.push("");
  }

  // Patterns
  if (e.patterns.length > 0) {
    lines.push("## Patterns", "");
    for (const p of e.patterns) {
      lines.push(`- ${p}`);
    }
    lines.push("");
  }

  // Continuity threads
  if (e.continuityThreads.length > 0) {
    const unresolved = e.continuityThreads.filter((t) => !t.resolved);
    const resolved = e.continuityThreads.filter((t) => t.resolved);
    if (unresolved.length > 0) {
      lines.push("## Open Questions", "");
      for (const t of unresolved) {
        const continued = t.continuedFrom ? ` (open since ${t.continuedFrom})` : "";
        lines.push(`- ${t.question}${continued}`);
      }
      lines.push("");
    }
    if (resolved.length > 0) {
      lines.push("## Resolved from Previous Days", "");
      for (const t of resolved) {
        lines.push(`- ~~${t.question}~~`);
      }
      lines.push("");
    }
  }

  // Closing state
  lines.push("---", "");
  lines.push(`_${narrative.arc.closingState}_`, "");
  lines.push(
    `_${e.meta.eventsProcessed} events | ${e.decisions.length} decisions | ${e.domains.join(", ") || "general"} | ${e.meta.dayShape.arcType}_`,
  );
  lines.push(`_Generated ${e.meta.synthesizedAt}_`, "");

  return lines.join("\n");
}

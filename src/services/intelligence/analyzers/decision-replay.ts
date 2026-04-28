// KGI-4 + IP-4.4: Decision Replay Engine — knowledge-grounded decision contradiction/supersession detection.
//
// Primary path (knowledge-grounded):
//   1. Query CozoDB for active decisions via knowledge.getDecisions()
//   2. Query for invalidated decisions (superseded/contradicted by Layer 2.5)
//   3. For each invalidated decision that has a corresponding active replacement → replay
//   4. Replay includes: original decision, new fact, confidence, time elapsed
//
// Fallback path: DuckDB decisions table + string similarity (preserved for pre-extraction state).
//
// Rate limit: max 2 replays per week. Dismissed replays expire after 30 days.
//
// IP-4.4 enrichment: _meta freshness, per-replay evidenceEventIds, diagnostics.
// Removed .slice(-10) — full replay history accessible.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzerOutputMeta, DiagnosticMessage } from "../../../schemas/intelligence-presentation.js";
import type { DecisionReplay, ReplaysFile } from "../../../schemas/intelligence/replays.js";
import { getIntelligenceDir } from "../../../utils/paths.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import type { FactEntry } from "../knowledge-reader.js";
import type { AnalyzerContext } from "./index.js";

const MAX_REPLAYS_PER_WEEK = 2;

// ─── State ──────────────────────────────────────────────────────────────────

interface DecisionReplayState {
  output: ReplaysFile;
  source: "knowledge" | "hds-fallback";
}

// ─── Evidence Helpers ───────────────────────────────────────────────────────

async function collectDecisionEventIds(
  ctx: AnalyzerContext,
  domain: string,
  decisionText: string,
): Promise<string[]> {
  try {
    const searchTerm = domain || decisionText.slice(0, 50);
    const result = await ctx.analytics.exec(
      `SELECT id FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND (content_summary LIKE '%${searchTerm.replace(/'/g, "''")}%'
              OR intent_summary LIKE '%${searchTerm.replace(/'/g, "''")}%')
       ORDER BY ts DESC`,
    );
    return (result[0]?.values ?? []).map((r) => String(r[0]));
  } catch {
    return [];
  }
}

// ─── Primary Path: Knowledge-Grounded ───────────────────────────────────────

async function detectReplaysFromKnowledge(ctx: AnalyzerContext): Promise<ReplaysFile> {
  const now = new Date().toISOString();
  const existing = loadExistingReplays();
  const activeCount = countReplaysThisWeek(existing);

  if (activeCount >= MAX_REPLAYS_PER_WEEK) return preserveExisting(existing, now, ctx);

  const activeDecisions = await ctx.knowledge!.getDecisions({});
  const allDecisionFacts = await ctx.knowledge!.getFacts({ activeOnly: false });

  const decisionPredicates = new Set([
    "DECIDED", "CHOSEN_OVER", "REPLACED_BY", "SWITCHED_FROM", "ADOPTED", "DEPRECATED",
  ]);
  const allDecisions = allDecisionFacts.filter((f) => decisionPredicates.has(f.predicate));

  const invalidatedDecisions = allDecisions.filter((f) => f.invalidAt !== "");
  const activeDecisionsBySubject = groupBySubject(activeDecisions);

  const newReplays: DecisionReplay[] = [];

  for (const invalidated of invalidatedDecisions) {
    if (activeCount + newReplays.length >= MAX_REPLAYS_PER_WEEK) break;

    const replacements = activeDecisionsBySubject.get(invalidated.subjectId) ?? [];
    if (replacements.length === 0) continue;

    const replacement = replacements[0];
    const replayId = makeReplayId(invalidated.id, replacement.id);
    if (existing.replays.some((r) => r.id === replayId)) continue;

    const isSupersession = replacement.predicate === "REPLACED_BY" ||
      replacement.predicate === "SWITCHED_FROM";

    const daysElapsed = computeDaysElapsed(invalidated.validAt, replacement.validAt);
    const domain = extractDomain(invalidated);
    const eventIds = await collectDecisionEventIds(ctx, domain, formatDecisionText(invalidated));

    newReplays.push({
      id: replayId,
      originalDecision: {
        date: invalidated.validAt,
        decision: formatDecisionText(invalidated),
        domain,
        rationale: invalidated.context || null,
      },
      triggerReason: isSupersession ? "supersession" : "contradiction",
      triggerDetail: buildTriggerDetail(invalidated, replacement, daysElapsed, isSupersession),
      confidence: Math.max(invalidated.confidence, replacement.confidence),
      createdAt: now,
      dismissed: false,
      dismissedReason: null,
      evidenceEventIds: eventIds,
    });
  }

  const allReplays = [...existing.replays.filter((r) => !isExpired(r)), ...newReplays];
  const _meta = await buildMeta(ctx, allReplays.length, now);
  const diagnostics = buildDiagnostics(allReplays);

  return {
    replays: allReplays,
    maxPerWeek: MAX_REPLAYS_PER_WEEK,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

function buildTriggerDetail(
  old: FactEntry,
  replacement: FactEntry,
  daysElapsed: number,
  isSupersession: boolean,
): string {
  const oldText = formatDecisionText(old);
  const newText = formatDecisionText(replacement);

  if (isSupersession) {
    return `You originally decided "${oldText}" (${old.validAt.slice(0, 10)}). After ${daysElapsed} days, this was explicitly replaced: "${newText}". The original rationale was: "${old.context.slice(0, 120)}".`;
  }

  return `Your decision "${oldText}" (${old.validAt.slice(0, 10)}) was contradicted ${daysElapsed} days later by "${newText}". Consider whether the original reasoning still applies or if circumstances changed.`;
}

// ─── Fallback Path: DuckDB String Similarity ────────────────────────────────

async function detectReplaysFromHDS(ctx: AnalyzerContext): Promise<ReplaysFile> {
  const now = new Date().toISOString();
  const existing = loadExistingReplays();
  const activeCount = countReplaysThisWeek(existing);

  if (activeCount >= MAX_REPLAYS_PER_WEEK) return preserveExisting(existing, now, ctx);

  const newReplays: DecisionReplay[] = [];

  try {
    const decisions = await ctx.analytics.exec(
      `SELECT date, description, domain, rationale
       FROM decisions
       WHERE date <= current_date - INTERVAL '7 days'
       ORDER BY date DESC`,
    );

    if (decisions[0]?.values.length) {
      const recentResult = await ctx.analytics.exec(
        `SELECT content_summary FROM events
         WHERE ts >= now() - INTERVAL '7 days'
           AND source IN ('ai-session', 'mcp-active')
         ORDER BY ts DESC`,
      );

      if (recentResult[0]?.values.length) {
        const recentKeywords = new Set(
          recentResult[0].values
            .map((r) => (r[0] as string) ?? "")
            .join(" ")
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 4),
        );

        for (const row of decisions[0].values) {
          if (activeCount + newReplays.length >= MAX_REPLAYS_PER_WEEK) break;

          const date = (row[0] as string) ?? "";
          const decision = (row[1] as string) ?? "";
          const domain = (row[2] as string) ?? "";
          const rationale = (row[3] as string) ?? null;

          const decisionWords = decision.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
          const overlap = decisionWords.filter((w) => recentKeywords.has(w)).length;
          const similarity = decisionWords.length > 0 ? overlap / decisionWords.length : 0;

          if (similarity < 0.3) continue;

          const replayId = makeReplayId("drift", date + decision.slice(0, 30));
          if (existing.replays.some((r) => r.id === replayId)) continue;

          const eventIds = await collectDecisionEventIds(ctx, domain, decision);

          newReplays.push({
            id: replayId,
            originalDecision: { date, decision, domain, rationale },
            triggerReason: "domain-drift",
            triggerDetail: `You're working in an area related to a decision from ${date}: "${decision.slice(0, 80)}". Context may have changed — worth revisiting.`,
            confidence: Math.min(similarity + 0.3, 1.0),
            createdAt: now,
            dismissed: false,
            dismissedReason: null,
            evidenceEventIds: eventIds,
          });
        }
      }
    }
  } catch {
    // Non-fatal
  }

  const allReplays = [...existing.replays.filter((r) => !isExpired(r)), ...newReplays];
  const _meta = await buildMeta(ctx, allReplays.length, now);
  const diagnostics = buildDiagnostics(allReplays);

  return {
    replays: allReplays,
    maxPerWeek: MAX_REPLAYS_PER_WEEK,
    updatedAt: now,
    _meta,
    diagnostics,
  };
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

function groupBySubject(facts: FactEntry[]): Map<string, FactEntry[]> {
  const map = new Map<string, FactEntry[]>();
  for (const f of facts) {
    const existing = map.get(f.subjectId);
    if (existing) existing.push(f);
    else map.set(f.subjectId, [f]);
  }
  return map;
}

function formatDecisionText(fact: FactEntry): string {
  const object = fact.objectText || fact.objectId;
  return object
    ? `${fact.predicate} ${object}`
    : fact.context.slice(0, 100);
}

function extractDomain(fact: FactEntry): string {
  return fact.subjectId.replace(/^ke-|^ent-/, "").split("-")[0] || "general";
}

function computeDaysElapsed(oldDate: string, newDate: string): number {
  const oldMs = new Date(oldDate).getTime();
  const newMs = new Date(newDate).getTime();
  return Math.max(0, Math.round((newMs - oldMs) / 86400000));
}

function loadExistingReplays(): ReplaysFile {
  try {
    const dir = getIntelligenceDir();
    const path = join(dir, "decision-replay.json");
    if (!existsSync(path)) return emptyReplays("");
    return JSON.parse(readFileSync(path, "utf-8")) as ReplaysFile;
  } catch {
    return emptyReplays("");
  }
}

function emptyReplays(now: string): ReplaysFile {
  return {
    replays: [],
    maxPerWeek: MAX_REPLAYS_PER_WEEK,
    updatedAt: now,
    _meta: {
      updatedAt: now,
      dataPoints: 0,
      confidence: "low",
      watermark: now,
      stalenessMs: 0,
    },
    diagnostics: [],
  };
}

async function preserveExisting(
  existing: ReplaysFile,
  now: string,
  ctx: AnalyzerContext,
): Promise<ReplaysFile> {
  const replays = existing.replays.filter((r) => !isExpired(r));
  const _meta = await buildMeta(ctx, replays.length, now);
  return {
    replays,
    maxPerWeek: MAX_REPLAYS_PER_WEEK,
    updatedAt: now,
    _meta,
    diagnostics: buildDiagnostics(replays),
  };
}

function countReplaysThisWeek(file: ReplaysFile): number {
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  return file.replays.filter((r) => r.createdAt >= weekAgo && !r.dismissed).length;
}

function isExpired(replay: DecisionReplay): boolean {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  return replay.dismissed && replay.createdAt < thirtyDaysAgo;
}

function makeReplayId(...parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 12);
}

// ─── Meta + Diagnostics ─────────────────────────────────────────────────────

async function buildMeta(
  ctx: AnalyzerContext,
  totalReplays: number,
  updatedAt: string,
): Promise<AnalyzerOutputMeta> {
  const confidence: "high" | "medium" | "low" =
    totalReplays >= 5 ? "high" : totalReplays >= 2 ? "medium" : "low";

  let watermark = updatedAt;
  let stalenessMs = 0;

  try {
    const result = await ctx.analytics.exec(
      "SELECT MAX(ts) FROM events WHERE source IN ('ai-session', 'mcp-active')",
    );
    const maxTs = result[0]?.values[0]?.[0] as string | null;
    if (maxTs) {
      watermark = maxTs;
      stalenessMs = Math.max(0, Date.now() - new Date(maxTs).getTime());
    }
  } catch { /* non-fatal */ }

  return { updatedAt, dataPoints: totalReplays, confidence, watermark, stalenessMs };
}

function buildDiagnostics(replays: DecisionReplay[]): DiagnosticMessage[] {
  const diagnostics: DiagnosticMessage[] = [];

  const activeReplays = replays.filter((r) => !r.dismissed);
  const contradictions = activeReplays.filter((r) => r.triggerReason === "contradiction");
  const supersessions = activeReplays.filter((r) => r.triggerReason === "supersession");

  if (contradictions.length > 0) {
    diagnostics.push({
      severity: contradictions.length >= 3 ? "critical" : "warning",
      message: `${contradictions.length} decision contradiction(s) detected — past decisions conflict with current practice`,
      evidence: `Contradicted decisions: ${contradictions.map((r) => r.originalDecision.decision.slice(0, 40)).join("; ")}`,
      actionable: "Review contradicted decisions — either update the original rationale or revert to the previous approach",
      relatedAnalyzers: ["efficiency", "loop-detector"],
      evidenceEventIds: contradictions.flatMap((r) => r.evidenceEventIds.slice(0, 3)),
    });
  }

  if (supersessions.length > 0) {
    diagnostics.push({
      severity: "info",
      message: `${supersessions.length} decision supersession(s) — explicit technology/approach replacements tracked`,
      evidence: `Superseded decisions: ${supersessions.map((r) => r.originalDecision.decision.slice(0, 40)).join("; ")}`,
      actionable: "Document why previous approaches were replaced to build institutional knowledge",
      relatedAnalyzers: [],
      evidenceEventIds: supersessions.flatMap((r) => r.evidenceEventIds.slice(0, 3)),
    });
  }

  if (activeReplays.length === 0) {
    diagnostics.push({
      severity: "info",
      message: "No active decision replays — your decisions are consistent",
      evidence: "No contradictions or supersessions detected in the current analysis window",
      actionable: "Continue documenting decisions for future replay value",
      relatedAnalyzers: [],
      evidenceEventIds: [],
    });
  }

  return diagnostics;
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function computeReplaysWithFallback(
  ctx: AnalyzerContext,
): Promise<{ output: ReplaysFile; source: "knowledge" | "hds-fallback" }> {
  if (ctx.knowledge) {
    try {
      const hasData = await ctx.knowledge.hasKnowledgeData();
      if (hasData) {
        const output = await detectReplaysFromKnowledge(ctx);
        return { output, source: "knowledge" };
      }
    } catch {
      // Fall through
    }
  }

  const output = await detectReplaysFromHDS(ctx);
  return { output, source: "hds-fallback" };
}

// ─── IncrementalAnalyzer Export ──────────────────────────────────────────────

export const decisionReplayAnalyzer: IncrementalAnalyzer<DecisionReplayState, ReplaysFile> = {
  name: "decision-replay",
  outputFile: "decision-replay.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 5,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<DecisionReplayState>> {
    const { output, source } = await computeReplaysWithFallback(ctx);
    return {
      value: { output, source },
      watermark: output.updatedAt,
      eventCount: 0,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<DecisionReplayState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<DecisionReplayState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const { output, source } = await computeReplaysWithFallback(ctx);
    const oldCount = state.value.output.replays.length;
    const newCount = output.replays.length;
    const changed = newCount !== oldCount || source !== state.value.source;

    return {
      state: {
        value: { output, source },
        watermark: output.updatedAt,
        eventCount: state.eventCount + newEvents.events.length,
        updatedAt: output.updatedAt,
      },
      changed,
      changeMagnitude: Math.abs(newCount - oldCount),
    };
  },

  derive(state: IncrementalState<DecisionReplayState>): ReplaysFile {
    return state.value.output;
  },

  contributeEntities(state) {
    const contributions: import("../../substrate/substrate-engine.js").EntityContribution[] = [];

    for (const replay of state.value.output.replays) {
      contributions.push({
        entityId: `dec-${replay.id}`,
        entityType: "decision",
        projectId: "",
        analyzerName: "decision-replay",
        stateFragment: {
          decision: replay.originalDecision.decision,
          domain: replay.originalDecision.domain,
          triggerReason: replay.triggerReason,
          confidence: replay.confidence,
          source: state.value.source,
        },
        relationships: [],
      });
    }

    return contributions;
  },
};

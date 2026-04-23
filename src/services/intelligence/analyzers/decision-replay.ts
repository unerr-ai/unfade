// FILE: src/services/intelligence/analyzers/decision-replay.ts
// UF-112: Decision Replay Engine — monitors current signals against past decisions.
// Triggers replay when: domain drift, alternative validated elsewhere, or echoed dead end.
// Confidence threshold > 0.7. Max 2 replays per week. User-dismissable with feedback.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionReplay, ReplaysFile } from "../../../schemas/intelligence/replays.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import { cosineSimilarity } from "../utils/text-similarity.js";
import type { AnalyzerContext } from "./index.js";

const MAX_REPLAYS_PER_WEEK = 2;
const CONFIDENCE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DecisionReplayState {
  output: ReplaysFile;
}

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

async function detectDomainDrift(
  db: AnalyzerContext["analytics"],
  existing: ReplaysFile,
): Promise<DecisionReplay[]> {
  const replays: DecisionReplay[] = [];

  try {
    const decisions = await db.exec(
      `SELECT date, description, domain, rationale, hds
       FROM decisions
       WHERE date <= current_date - INTERVAL '7 days'
       ORDER BY date DESC
       LIMIT 50`,
    );

    if (!decisions[0]?.values.length) return [];

    const recentEvents = await db.exec(
      `SELECT content_summary FROM events
       WHERE ts >= now() - INTERVAL '7 days'
         AND source IN ('ai-session', 'mcp-active')
       ORDER BY ts DESC
       LIMIT 30`,
    );

    if (!recentEvents[0]?.values.length) return [];

    const recentContext = recentEvents[0].values.map((r) => (r[0] as string) ?? "").join(" ");

    for (const row of decisions[0].values) {
      const decisionDate = (row[0] as string) ?? "";
      const decisionText = (row[1] as string) ?? "";
      const domain = (row[2] as string) ?? "";
      const rationale = (row[3] as string) ?? null;
      const hds = (row[4] as number) ?? 0;

      if (hds < 0.5) continue;

      const similarity = cosineSimilarity(decisionText, recentContext);
      if (similarity < 0.3) continue;

      const replayId = makeReplayId("domain-drift", decisionDate, decisionText);
      if (existing.replays.some((r) => r.id === replayId)) continue;

      const driftConfidence = Math.min(similarity + 0.3, 1.0);
      if (driftConfidence < CONFIDENCE_THRESHOLD) continue;

      replays.push({
        id: replayId,
        originalDecision: {
          date: decisionDate,
          decision: decisionText,
          domain,
          rationale,
        },
        triggerReason: "domain-drift",
        triggerDetail: `You're working in the same area as a decision from ${decisionDate}. The context may have changed — worth revisiting whether "${decisionText.slice(0, 80)}" still holds.`,
        confidence: Math.round(driftConfidence * 100) / 100,
        createdAt: new Date().toISOString(),
        dismissed: false,
        dismissedReason: null,
      });

      if (replays.length >= MAX_REPLAYS_PER_WEEK) break;
    }
  } catch {
    // non-fatal
  }

  return replays;
}

async function detectEchoedDeadEnds(
  db: AnalyzerContext["analytics"],
  existing: ReplaysFile,
): Promise<DecisionReplay[]> {
  const replays: DecisionReplay[] = [];

  try {
    const recentLowDir = await db.exec(
      `SELECT content_summary FROM events
       WHERE source IN ('ai-session', 'mcp-active')
         AND human_direction_score < 0.3
         AND ts >= now() - INTERVAL '3 days'
       ORDER BY ts DESC
       LIMIT 10`,
    );

    if (!recentLowDir[0]?.values.length) return [];

    const recentDeadEndContext = recentLowDir[0].values
      .map((r) => (r[0] as string) ?? "")
      .join(" ");

    const pastDecisions = await db.exec(
      `SELECT date, description, domain, rationale FROM decisions
       WHERE date <= current_date - INTERVAL '7 days'
       ORDER BY date DESC
       LIMIT 50`,
    );

    if (!pastDecisions[0]?.values.length) return [];

    for (const row of pastDecisions[0].values) {
      const date = (row[0] as string) ?? "";
      const decision = (row[1] as string) ?? "";
      const domain = (row[2] as string) ?? "";
      const rationale = (row[3] as string) ?? null;

      const similarity = cosineSimilarity(recentDeadEndContext, `${decision} ${rationale ?? ""}`);
      if (similarity < 0.5) continue;

      const replayId = makeReplayId("echoed-dead-end", date, decision);
      if (existing.replays.some((r) => r.id === replayId)) continue;

      const confidence = Math.min(similarity + 0.2, 1.0);
      if (confidence < CONFIDENCE_THRESHOLD) continue;

      replays.push({
        id: replayId,
        originalDecision: { date, decision, domain, rationale },
        triggerReason: "echoed-dead-end",
        triggerDetail: `Your recent low-direction sessions echo a decision from ${date}: "${decision.slice(0, 80)}". The earlier rationale may help resolve the current stuck loop.`,
        confidence: Math.round(confidence * 100) / 100,
        createdAt: new Date().toISOString(),
        dismissed: false,
        dismissedReason: null,
      });

      if (replays.length >= 1) break;
    }
  } catch {
    // non-fatal
  }

  return replays;
}

function loadExistingReplays(repoRoot: string): ReplaysFile {
  try {
    const path = join(repoRoot, ".unfade", "intelligence", "replays.json");
    if (!existsSync(path)) return { replays: [], maxPerWeek: MAX_REPLAYS_PER_WEEK, updatedAt: "" };
    return JSON.parse(readFileSync(path, "utf-8")) as ReplaysFile;
  } catch {
    return { replays: [], maxPerWeek: MAX_REPLAYS_PER_WEEK, updatedAt: "" };
  }
}

function countReplaysThisWeek(file: ReplaysFile): number {
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  return file.replays.filter((r) => r.createdAt >= weekAgo && !r.dismissed).length;
}

function isExpired(replay: DecisionReplay): boolean {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  return replay.dismissed && replay.createdAt < thirtyDaysAgo;
}

function makeReplayId(type: string, date: string, decision: string): string {
  return createHash("sha256")
    .update(`${type}:${date}:${decision.slice(0, 50)}`)
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Full computation — assembles a ReplaysFile output
// ---------------------------------------------------------------------------

async function computeReplays(
  db: AnalyzerContext["analytics"],
  repoRoot: string,
): Promise<ReplaysFile> {
  const now = new Date().toISOString();

  const existing = loadExistingReplays(repoRoot);
  const activeCount = countReplaysThisWeek(existing);

  const newReplays: DecisionReplay[] = [];

  if (activeCount < MAX_REPLAYS_PER_WEEK) {
    const driftReplays = await detectDomainDrift(db, existing);
    for (const r of driftReplays) {
      if (activeCount + newReplays.length >= MAX_REPLAYS_PER_WEEK) break;
      newReplays.push(r);
    }

    const echoReplays = await detectEchoedDeadEnds(db, existing);
    for (const r of echoReplays) {
      if (activeCount + newReplays.length >= MAX_REPLAYS_PER_WEEK) break;
      newReplays.push(r);
    }
  }

  const allReplays = [...existing.replays.filter((r) => !isExpired(r)), ...newReplays];

  return {
    replays: allReplays.slice(-10),
    maxPerWeek: MAX_REPLAYS_PER_WEEK,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const decisionReplayAnalyzer: IncrementalAnalyzer<DecisionReplayState, ReplaysFile> = {
  name: "decision-replay",
  outputFile: "decision-replay.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 10,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<DecisionReplayState>> {
    const output = await computeReplays(ctx.analytics, ctx.repoRoot);
    return {
      value: { output },
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

    const output = await computeReplays(ctx.analytics, ctx.repoRoot);
    const oldCount = state.value.output.replays.length;
    const newCount = output.replays.length;
    const changed = newCount !== oldCount;

    return {
      state: {
        value: { output },
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

  contributeEntities(state, _batch) {
    const contributions: import("../../substrate/substrate-engine.js").EntityContribution[] = [];
    const output = state.value.output;
    const replays = output.replays ?? [];

    if (!Array.isArray(replays)) return contributions;

    for (const replay of replays as Array<{
      decisionId?: string;
      summary?: string;
      domain?: string;
      durability?: number;
      triggerReason?: string;
      revisedBy?: string;
    }>) {
      if (!replay.decisionId) continue;

      const relationships: import("../../substrate/substrate-engine.js").EntityContribution["relationships"] =
        [];

      if (replay.revisedBy) {
        relationships.push({
          targetEntityId: `dec-${replay.revisedBy}`,
          type: "revises",
          weight: 0.8,
          evidence: replay.triggerReason ?? "decision-replay",
        });
      }

      contributions.push({
        entityId: `dec-${replay.decisionId}`,
        entityType: "decision",
        projectId: "",
        analyzerName: "decision-replay",
        stateFragment: {
          summary: replay.summary ?? "",
          domain: replay.domain ?? "general",
          durability: replay.durability ?? 0.5,
          triggerReason: replay.triggerReason ?? "",
        },
        relationships,
      });
    }

    return contributions;
  },
};

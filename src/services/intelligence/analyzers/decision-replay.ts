// FILE: src/services/intelligence/analyzers/decision-replay.ts
// UF-112: Decision Replay Engine — monitors current signals against past decisions.
// Triggers replay when: domain drift, alternative validated elsewhere, or echoed dead end.
// Confidence threshold > 0.7. Max 2 replays per week. User-dismissable with feedback.

import { createHash } from "node:crypto";
import type { DecisionReplay, ReplaysFile } from "../../../schemas/intelligence/replays.js";
import { cosineSimilarity } from "../utils/text-similarity.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./index.js";

const MAX_REPLAYS_PER_WEEK = 2;
const CONFIDENCE_THRESHOLD = 0.7;
const MIN_DECISION_AGE_DAYS = 7;

export const decisionReplayAnalyzer: Analyzer = {
  name: "decision-replay",
  outputFile: "replays.json",
  minDataPoints: 30,

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const db = ctx.db;
    const now = new Date().toISOString();

    const existing = loadExistingReplays(ctx.repoRoot);
    const activeCount = countReplaysThisWeek(existing);

    const newReplays: DecisionReplay[] = [];

    if (activeCount < MAX_REPLAYS_PER_WEEK) {
      const driftReplays = detectDomainDrift(db, existing);
      for (const r of driftReplays) {
        if (activeCount + newReplays.length >= MAX_REPLAYS_PER_WEEK) break;
        newReplays.push(r);
      }

      const echoReplays = detectEchoedDeadEnds(db, existing);
      for (const r of echoReplays) {
        if (activeCount + newReplays.length >= MAX_REPLAYS_PER_WEEK) break;
        newReplays.push(r);
      }
    }

    const allReplays = [...existing.replays.filter((r) => !isExpired(r)), ...newReplays];

    const replaysFile: ReplaysFile = {
      replays: allReplays.slice(-10),
      maxPerWeek: MAX_REPLAYS_PER_WEEK,
      updatedAt: now,
    };

    return {
      analyzer: "decision-replay",
      updatedAt: now,
      data: replaysFile as unknown as Record<string, unknown>,
      insightCount: newReplays.length,
    };
  },
};

function detectDomainDrift(db: AnalyzerContext["db"], existing: ReplaysFile): DecisionReplay[] {
  const replays: DecisionReplay[] = [];

  try {
    const decisions = db.exec(`
      SELECT date, description, domain, rationale, hds
      FROM decisions
      WHERE date <= date('now', '-${MIN_DECISION_AGE_DAYS} days')
      ORDER BY date DESC
      LIMIT 50
    `);

    if (!decisions[0]?.values.length) return [];

    const recentEvents = db.exec(`
      SELECT content_summary FROM events
      WHERE ts >= datetime('now', '-7 days')
        AND source IN ('ai-session', 'mcp-active')
      ORDER BY ts DESC
      LIMIT 30
    `);

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

function detectEchoedDeadEnds(db: AnalyzerContext["db"], existing: ReplaysFile): DecisionReplay[] {
  const replays: DecisionReplay[] = [];

  try {
    const recentLowDir = db.exec(`
      SELECT content_summary FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL) < 0.3
        AND ts >= datetime('now', '-3 days')
      ORDER BY ts DESC
      LIMIT 10
    `);

    if (!recentLowDir[0]?.values.length) return [];

    const recentDeadEndContext = recentLowDir[0].values
      .map((r) => (r[0] as string) ?? "")
      .join(" ");

    const pastDecisions = db.exec(`
      SELECT date, description, domain, rationale FROM decisions
      WHERE date <= date('now', '-${MIN_DECISION_AGE_DAYS} days')
      ORDER BY date DESC
      LIMIT 50
    `);

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
    const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
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

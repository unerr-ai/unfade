// FILE: src/services/intelligence/analyzers/loop-detector.ts
// UF-107: Loop Detector — indexes low-direction sessions, detects stuck patterns.
// When similarity > 0.7 to a past rejection, generates a warning for MCP context injection.
// Tracks stuck loops (3+ similar low-direction sessions on the same approach).

import type {
  RejectionEntry,
  RejectionIndex,
  StuckLoop,
} from "../../../schemas/intelligence/rejections.js";
import { logger } from "../../../utils/logger.js";
import { classifyDomainFast } from "../domain-classifier.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../incremental-state.js";
import { contentHash, cosineSimilarity } from "../utils/text-similarity.js";
import type { AnalyzerContext } from "./index.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface LoopDetectorState {
  output: RejectionIndex;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.7;
const STUCK_LOOP_MIN = 3;

// ---------------------------------------------------------------------------
// Compute helpers — all take db (analytics) only
// ---------------------------------------------------------------------------

async function indexLowDirectionSessions(
  db: AnalyzerContext["analytics"],
): Promise<RejectionEntry[]> {
  try {
    const result = await db.exec(`
      SELECT id, ts, content_summary, content_detail,
             human_direction_score as hds
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND human_direction_score < 0.3
      ORDER BY ts DESC
      LIMIT 200
    `);

    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => {
      const summary = (row[2] as string) ?? "";
      const detail = (row[3] as string) ?? "";
      const text = `${summary} ${detail}`;
      const domain = classifyDomainFast(text);

      return {
        eventId: (row[0] as string) ?? "",
        date: ((row[1] as string) ?? "").slice(0, 10),
        domain,
        contentHash: contentHash(text),
        summary: summary.slice(0, 200),
        approach: extractApproach(text),
        resolution: null,
      };
    });
  } catch {
    return [];
  }
}

function detectStuckLoops(entries: RejectionEntry[]): StuckLoop[] {
  const approachGroups = new Map<string, RejectionEntry[]>();

  for (const entry of entries) {
    const key = `${entry.domain}::${entry.approach}`;
    const group = approachGroups.get(key) ?? [];
    group.push(entry);
    approachGroups.set(key, group);
  }

  const loops: StuckLoop[] = [];

  for (const [, group] of approachGroups) {
    if (group.length < STUCK_LOOP_MIN) continue;

    const similar = findSimilarCluster(group);
    if (similar.length >= STUCK_LOOP_MIN) {
      const dates = similar.map((e) => e.date).sort();
      loops.push({
        domain: similar[0].domain,
        approach: similar[0].approach,
        occurrences: similar.length,
        firstSeen: dates[0],
        lastSeen: dates[dates.length - 1],
        resolution: null,
      });
    }
  }

  return loops.sort((a, b) => b.occurrences - a.occurrences);
}

function findSimilarCluster(entries: RejectionEntry[]): RejectionEntry[] {
  if (entries.length < 2) return entries;

  const clusters: RejectionEntry[][] = [];
  const visited = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [entries[i]];
    visited.add(i);

    for (let j = i + 1; j < entries.length; j++) {
      if (visited.has(j)) continue;
      const sim = cosineSimilarity(entries[i].summary, entries[j].summary);
      if (sim >= SIMILARITY_THRESHOLD) {
        cluster.push(entries[j]);
        visited.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters.reduce((max, c) => (c.length > max.length ? c : max), []);
}

/**
 * Check if a new session text is similar to any indexed rejection.
 * Used for MCP context injection — warn before the developer gets stuck again.
 */
export function findSimilarRejections(
  text: string,
  index: RejectionIndex,
): Array<{ entry: RejectionEntry; similarity: number }> {
  const matches: Array<{ entry: RejectionEntry; similarity: number }> = [];

  for (const entry of index.entries) {
    const sim = cosineSimilarity(text, entry.summary);
    if (sim >= SIMILARITY_THRESHOLD) {
      matches.push({ entry, similarity: sim });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

function extractApproach(text: string): string {
  const lower = text.toLowerCase();
  if (/singleton|single instance/.test(lower)) return "singleton-pattern";
  if (/dependency injection|di container/.test(lower)) return "dependency-injection";
  if (/microservice/.test(lower)) return "microservices";
  if (/monolith/.test(lower)) return "monolith";
  if (/orm|raw sql/.test(lower)) return "data-access";
  if (/rest|graphql/.test(lower)) return "api-design";
  if (/auth|session|jwt/.test(lower)) return "authentication";
  return "general-approach";
}

async function detectIntentRecurrence(db: AnalyzerContext["analytics"]): Promise<StuckLoop[]> {
  try {
    const result = await db.exec(
      `
      SELECT
        intent_summary as intent,
        COUNT(*) as cnt,
        MIN(ts) as first_seen,
        MAX(ts) as last_seen,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND intent_summary IS NOT NULL
        AND ts >= now() - INTERVAL '7 days'
      GROUP BY intent_summary
      HAVING cnt >= $1 AND failures >= 2
      ORDER BY cnt DESC
      LIMIT 10
    `,
      [STUCK_LOOP_MIN],
    );

    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => {
      const intent = (row[0] as string) ?? "unknown";
      const domain = classifyDomainFast(intent);
      return {
        domain,
        approach: intent.slice(0, 100),
        occurrences: (row[1] as number) ?? 0,
        firstSeen: ((row[2] as string) ?? "").slice(0, 10),
        lastSeen: ((row[3] as string) ?? "").slice(0, 10),
        resolution: null,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Full computation — assembles entries + loops into a RejectionIndex
// ---------------------------------------------------------------------------

async function computeLoopIndex(db: AnalyzerContext["analytics"]): Promise<RejectionIndex> {
  const now = new Date().toISOString();

  const entries = await indexLowDirectionSessions(db);
  const intentLoops = await detectIntentRecurrence(db);
  const stuckLoops = [...detectStuckLoops(entries), ...intentLoops];

  return {
    entries: entries.slice(-200),
    stuckLoops,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer export
// ---------------------------------------------------------------------------

export const loopDetectorAnalyzer: IncrementalAnalyzer<LoopDetectorState, RejectionIndex> = {
  name: "loop-detector",
  outputFile: "rejections.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 5,

  async initialize(ctx: AnalyzerContext): Promise<IncrementalState<LoopDetectorState>> {
    logger.debug("loop-detector: initializing");
    const output = await computeLoopIndex(ctx.analytics);
    return {
      value: { output },
      watermark: output.updatedAt,
      eventCount: output.entries.length,
      updatedAt: output.updatedAt,
    };
  },

  async update(
    state: IncrementalState<LoopDetectorState>,
    newEvents: NewEventBatch,
    ctx: AnalyzerContext,
  ): Promise<UpdateResult<LoopDetectorState>> {
    if (newEvents.events.length === 0) {
      return { state, changed: false };
    }

    const output = await computeLoopIndex(ctx.analytics);
    const oldLoopCount = state.value.output.stuckLoops.length;
    const newLoopCount = output.stuckLoops.length;
    const oldEntryCount = state.value.output.entries.length;
    const newEntryCount = output.entries.length;
    const changed = newLoopCount !== oldLoopCount || Math.abs(newEntryCount - oldEntryCount) > 2;

    const newState: IncrementalState<LoopDetectorState> = {
      value: { output },
      watermark: output.updatedAt,
      eventCount: state.eventCount + newEvents.events.length,
      updatedAt: output.updatedAt,
    };

    return {
      state: newState,
      changed,
      changeMagnitude: Math.abs(newLoopCount - oldLoopCount),
    };
  },

  derive(state: IncrementalState<LoopDetectorState>): RejectionIndex {
    return state.value.output;
  },

  contributeEntities(state, batch) {
    const contributions: import("../../substrate/substrate-engine.js").EntityContribution[] = [];
    const output = state.value.output;
    const stuckLoops =
      (output as unknown as { stuckLoops?: Array<{ domain?: string }> }).stuckLoops ?? [];
    const loopCount = stuckLoops.length;
    const loopRisk = Math.min(1, loopCount * 0.2);

    if (loopRisk <= 0.3) return contributions;

    for (const evt of batch.events) {
      if (!evt.sessionId || evt.source !== "ai-session") continue;

      const relationships: import("../../substrate/substrate-engine.js").EntityContribution["relationships"] =
        [];
      if (loopRisk > 0.7) {
        relationships.push({
          targetEntityId: "pat-iterative-loop",
          type: "demonstrates",
          weight: loopRisk,
          evidence: "loop-risk-threshold",
        });
      }

      contributions.push({
        entityId: `wu-${evt.sessionId}`,
        entityType: "work-unit",
        projectId: evt.projectId,
        analyzerName: "loop-detector",
        stateFragment: {
          loopRisk,
          loopStatus: loopRisk > 0.7 ? "stuck" : "at-risk",
          stuckLoopCount: loopCount,
        },
        relationships,
      });
    }

    return contributions;
  },
};

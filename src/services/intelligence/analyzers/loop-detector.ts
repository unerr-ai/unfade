// FILE: src/services/intelligence/analyzers/loop-detector.ts
// UF-107: Loop Detector — indexes low-direction sessions, detects stuck patterns.
// When similarity > 0.7 to a past rejection, generates a warning for MCP context injection.
// Tracks stuck loops (3+ similar low-direction sessions on the same approach).

import type {
  RejectionEntry,
  RejectionIndex,
  StuckLoop,
} from "../../../schemas/intelligence/rejections.js";
import { contentHash, cosineSimilarity } from "../utils/text-similarity.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./index.js";

const SIMILARITY_THRESHOLD = 0.7;
const STUCK_LOOP_MIN = 3;

export const loopDetectorAnalyzer: Analyzer = {
  name: "loop-detector",
  outputFile: "rejections.idx.json",
  minDataPoints: 5,

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const db = ctx.db;
    const now = new Date().toISOString();

    const entries = indexLowDirectionSessions(db);

    // 12C.14: Also detect intent_summary recurrence + outcome=failure chains
    const intentLoops = detectIntentRecurrence(db);

    const stuckLoops = [...detectStuckLoops(entries), ...intentLoops];

    const index: RejectionIndex = {
      entries: entries.slice(-200),
      stuckLoops,
      updatedAt: now,
    };

    const sourceEventIds = entries
      .slice(0, 20)
      .map((e) => e.eventId)
      .filter(Boolean);

    return {
      analyzer: "loop-detector",
      updatedAt: now,
      data: index as unknown as Record<string, unknown>,
      insightCount: stuckLoops.length,
      sourceEventIds,
    };
  },
};

function indexLowDirectionSessions(db: AnalyzerContext["db"]): RejectionEntry[] {
  try {
    const result = db.exec(`
      SELECT id, ts, content_summary, content_detail,
             json_extract(metadata, '$.direction_signals.human_direction_score') as hds
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL) < 0.3
      ORDER BY ts DESC
      LIMIT 200
    `);

    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => {
      const summary = (row[2] as string) ?? "";
      const detail = (row[3] as string) ?? "";
      const text = `${summary} ${detail}`;
      const domain = classifyDomain(text);

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

/**
 * 12C.14: Detect loops via intent_summary recurrence + outcome=failure chains.
 * When the same intent_summary appears 3+ times with failure outcomes, flag as stuck.
 */
function detectIntentRecurrence(db: AnalyzerContext["db"]): StuckLoop[] {
  try {
    const result = db.exec(`
      SELECT
        json_extract(metadata, '$.intent_summary') as intent,
        COUNT(*) as cnt,
        MIN(ts) as first_seen,
        MAX(ts) as last_seen,
        SUM(CASE WHEN json_extract(metadata, '$.outcome') = 'failure' THEN 1 ELSE 0 END) as failures
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND json_extract(metadata, '$.intent_summary') IS NOT NULL
        AND ts >= datetime('now', '-7 days')
      GROUP BY json_extract(metadata, '$.intent_summary')
      HAVING cnt >= ${STUCK_LOOP_MIN} AND failures >= 2
      ORDER BY cnt DESC
      LIMIT 10
    `);

    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => {
      const intent = (row[0] as string) ?? "unknown";
      const domain = classifyDomain(intent);
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

function classifyDomain(text: string): string {
  const lower = text.toLowerCase();
  if (/api|endpoint|route|handler/.test(lower)) return "api";
  if (/auth|login|session/.test(lower)) return "auth";
  if (/database|sql|query/.test(lower)) return "database";
  if (/test|spec|mock/.test(lower)) return "testing";
  if (/deploy|docker|ci/.test(lower)) return "infra";
  return "general";
}

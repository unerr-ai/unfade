// FILE: src/services/intelligence/knowledge-reader.ts
// KGI-1: Read-only knowledge query layer for Layer 3 analyzers.
// Wraps CozoDB Datalog queries against Layer 2.5's extracted knowledge
// (entities, facts, comprehension assessments, metacognitive signals).
//
// Analyzers use this to ground their intelligence in actual extracted
// conversation content rather than just DuckDB numeric columns.
//
// Every method returns empty arrays when the graph is empty — analyzers
// MUST gracefully degrade when knowledge data isn't available yet.

import type { CozoDb } from "cozo-node";
import { logger } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ComprehensionEntry {
  episodeId: string;
  timestamp: string;
  steering: number;
  understanding: number;
  metacognition: number;
  independence: number;
  engagement: number;
  overallScore: number;
  assessmentMethod: string;
}

export interface FactEntry {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  objectText: string;
  confidence: number;
  context: string;
  validAt: string;
  invalidAt: string;
}

export interface EntityEngagement {
  entityId: string;
  name: string;
  type: string;
  mentionCount: number;
  lastSeen: string;
  confidence: number;
}

export interface DecayEntry {
  domain: string;
  baseScore: number;
  stability: number;
  complexityModifier: number;
  currentScore: number;
  lastTouch: string;
  interactionCount: number;
}

// ─── Interface ──────────────────────────────────────────────────────────────

export interface KnowledgeReader {
  getComprehension(opts: { domain?: string; module?: string; since?: string }): Promise<ComprehensionEntry[]>;
  getFacts(opts: { subject?: string; domain?: string; predicate?: string; activeOnly?: boolean }): Promise<FactEntry[]>;
  getDecisions(opts: { domain?: string; since?: string }): Promise<FactEntry[]>;
  getEntityEngagement(opts: { since?: string; minOccurrences?: number }): Promise<EntityEngagement[]>;
  getDecayState(opts: { domain?: string; entity?: string }): Promise<DecayEntry[]>;
  hasKnowledgeData(): Promise<boolean>;
}

// ─── CozoDB String Escaping ─────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a KnowledgeReader backed by CozoDB.
 * Returns a read-only interface — analyzers never write to CozoDB.
 */
export function createKnowledgeReader(cozo: CozoDb): KnowledgeReader {
  return {
    async getComprehension(opts) {
      try {
        const filters: string[] = [];

        if (opts.since) {
          filters.push(`timestamp >= '${esc(opts.since)}'`);
        }

        const whereClause = filters.length > 0
          ? `, ${filters.join(", ")}`
          : "";

        const result = await cozo.run(
          `?[episode_id, timestamp, steering, understanding, metacognition, independence, engagement, overall_score, assessment_method] :=
            *comprehension_assessment{episode_id, timestamp, steering, understanding, metacognition, independence, engagement, overall_score, assessment_method}${whereClause}`,
        );

        const rows = (result as { rows?: unknown[][] }).rows ?? [];
        return rows.map((r) => ({
          episodeId: r[0] as string,
          timestamp: r[1] as string,
          steering: r[2] as number,
          understanding: r[3] as number,
          metacognition: r[4] as number,
          independence: r[5] as number,
          engagement: r[6] as number,
          overallScore: r[7] as number,
          assessmentMethod: r[8] as string,
        }));
      } catch (err) {
        logger.debug("KnowledgeReader.getComprehension failed", { error: errMsg(err) });
        return [];
      }
    },

    async getFacts(opts) {
      try {
        const filters: string[] = [];

        if (opts.activeOnly !== false) {
          filters.push("invalid_at = ''");
        }
        if (opts.subject) {
          filters.push(`subject_id = '${esc(opts.subject)}'`);
        }
        if (opts.predicate) {
          filters.push(`predicate = '${esc(opts.predicate)}'`);
        }

        const whereClause = filters.length > 0
          ? `, ${filters.join(", ")}`
          : "";

        const result = await cozo.run(
          `?[id, subject_id, predicate, object_id, object_text, confidence, context, valid_at, invalid_at] :=
            *fact{id, subject_id, predicate, object_id, object_text, confidence, context, valid_at, invalid_at}${whereClause}`,
        );

        const rows = (result as { rows?: unknown[][] }).rows ?? [];
        return rows.map((r) => ({
          id: r[0] as string,
          subjectId: r[1] as string,
          predicate: r[2] as string,
          objectId: r[3] as string,
          objectText: r[4] as string,
          confidence: r[5] as number,
          context: r[6] as string,
          validAt: r[7] as string,
          invalidAt: r[8] as string,
        }));
      } catch (err) {
        logger.debug("KnowledgeReader.getFacts failed", { error: errMsg(err) });
        return [];
      }
    },

    async getDecisions(opts) {
      try {
        const decisionPredicates = "'DECIDED', 'CHOSEN_OVER', 'REPLACED_BY', 'SWITCHED_FROM', 'ADOPTED', 'DEPRECATED'";
        const filters = [`invalid_at = ''`, `predicate in [${decisionPredicates}]`];

        if (opts.since) {
          filters.push(`valid_at >= '${esc(opts.since)}'`);
        }

        const whereClause = `, ${filters.join(", ")}`;

        const result = await cozo.run(
          `?[id, subject_id, predicate, object_id, object_text, confidence, context, valid_at, invalid_at] :=
            *fact{id, subject_id, predicate, object_id, object_text, confidence, context, valid_at, invalid_at}${whereClause}`,
        );

        const rows = (result as { rows?: unknown[][] }).rows ?? [];
        return rows.map((r) => ({
          id: r[0] as string,
          subjectId: r[1] as string,
          predicate: r[2] as string,
          objectId: r[3] as string,
          objectText: r[4] as string,
          confidence: r[5] as number,
          context: r[6] as string,
          validAt: r[7] as string,
          invalidAt: r[8] as string,
        }));
      } catch (err) {
        logger.debug("KnowledgeReader.getDecisions failed", { error: errMsg(err) });
        return [];
      }
    },

    async getEntityEngagement(opts) {
      try {
        const result = await cozo.run(
          `?[id, state, type, confidence, last_updated] :=
            *entity{id, state, type, confidence, last_updated, lifecycle},
            lifecycle != 'archived'`,
        );

        const rows = (result as { rows?: unknown[][] }).rows ?? [];
        const minOccurrences = opts.minOccurrences ?? 1;

        return rows
          .map((r) => {
            let state: Record<string, unknown> = {};
            try {
              const raw = r[1];
              state = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
            } catch { /* */ }

            return {
              entityId: r[0] as string,
              name: (state.name as string) ?? "",
              type: (r[2] as string) ?? "",
              mentionCount: (state.mentionCount as number) ?? 1,
              lastSeen: String(r[4] ?? ""),
              confidence: (r[3] as number) ?? 0,
            };
          })
          .filter((e) => e.mentionCount >= minOccurrences && e.name);
      } catch (err) {
        logger.debug("KnowledgeReader.getEntityEngagement failed", { error: errMsg(err) });
        return [];
      }
    },

    async getDecayState(opts) {
      // Decay state lives in DuckDB domain_comprehension, not CozoDB.
      // This method queries via the analytics handle passed through ctx.
      // Since KnowledgeReader only has CozoDB access, we return empty here
      // and the caller should use ctx.analytics for DuckDB decay queries.
      // In practice, analyzers that need decay state query DuckDB directly.
      return [];
    },

    async hasKnowledgeData() {
      try {
        const factResult = await cozo.run(
          "?[count(id)] := *fact{id}",
        );
        const rows = (factResult as { rows?: unknown[][] }).rows ?? [];
        const factCount = (rows[0]?.[0] as number) ?? 0;

        if (factCount > 0) return true;

        const compResult = await cozo.run(
          "?[count(episode_id)] := *comprehension_assessment{episode_id}",
        );
        const compRows = (compResult as { rows?: unknown[][] }).rows ?? [];
        const compCount = (compRows[0]?.[0] as number) ?? 0;

        return compCount > 0;
      } catch {
        return false;
      }
    },
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.display === "string") return obj.display;
    if (typeof obj.message === "string") return obj.message;
  }
  return String(err);
}

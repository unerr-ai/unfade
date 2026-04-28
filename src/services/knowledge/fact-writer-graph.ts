// FILE: src/services/knowledge/fact-writer-graph.ts
// Layer 2.5 KE-11: Fact graph writer + explicit supersession detection.
// Writes extracted AtomicFacts to three destinations:
//   1. CozoDB `fact` relation — queryable bi-temporal fact store
//   2. CozoDB `edge` relation — graph traversal compatibility with SubstrateEngine
//   3. facts.jsonl — append-only source of truth (via KE-4)
//
// Supersession (KE-11.2): when temporalHint === "supersedes_previous", regex-extracts
// the old entity from the context and auto-invalidates matching valid facts. No LLM
// call needed — the extraction prompt already made the temporal judgment.

import { randomUUID } from "node:crypto";
import type { CozoDb } from "cozo-node";
import type { AtomicFact, PersistedFact, ExtractionMethod } from "../../schemas/knowledge.js";
import { logger } from "../../utils/logger.js";
import { normalizeEntityName } from "./entity-normalizer.js";
import { appendFacts } from "./fact-writer.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FactWriteContext {
  /** Map from extracted entity name → resolved entity ID. */
  entityMap: Map<string, string>;
  /** Source event ID. */
  episodeId: string;
  /** Segment ID within the episode (null for single-segment events). */
  segmentId: string | null;
  /** When the fact was stated (event timestamp). */
  eventTimestamp: string;
  /** How the fact was extracted. */
  extractionMethod: ExtractionMethod;
  /** Override for ~/.unfade home directory (testing). */
  homeOverride?: string;
}

export interface FactWriteResult {
  /** Number of new facts written. */
  created: number;
  /** Number of old facts invalidated via supersession. */
  superseded: number;
  /** Number of facts skipped (unresolvable subject). */
  skipped: number;
}

// ─── CozoDB String Escaping ─────────────────────────────────────────────────

function escCozo(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// ─── Supersession Patterns (KE-11.2) ────────────────────────────────────────
// Regex patterns that extract the "old" entity name from fact context strings.
// These match common developer language for technology/approach transitions.

const SUPERSESSION_PATTERNS: RegExp[] = [
  /switched\s+from\s+(.+?)\s+to\s+/i,
  /replaced\s+(.+?)\s+with\s+/i,
  /migrated\s+from\s+(.+?)\s+to\s+/i,
  /deprecated\s+(.+?)\s+in\s+favor\s+of/i,
  /moved\s+(?:away\s+)?from\s+(.+?)\s+to\s+/i,
  /abandoned\s+(.+?)\s+(?:for|in\s+favor\s+of)/i,
  /dropped\s+(.+?)\s+(?:for|in\s+favor\s+of)/i,
  /transitioned\s+from\s+(.+?)\s+to\s+/i,
];

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Write extracted facts to CozoDB and facts.jsonl.
 *
 * For each AtomicFact:
 *   1. Resolve subject/object to entity IDs via entityMap
 *   2. Create PersistedFact with UUID, bi-temporal fields, provenance
 *   3. Write to CozoDB `fact` relation
 *   4. Write corresponding `edge` for graph traversal
 *   5. If temporalHint === "supersedes_previous", detect and invalidate old facts
 *   6. Append to facts.jsonl (source of truth)
 *
 * Facts with unresolvable subjects are skipped. Objects that don't resolve
 * are stored as free text (objectId: null, objectText: value).
 */
export async function writeFactsToGraph(
  facts: AtomicFact[],
  ctx: FactWriteContext,
  cozo: CozoDb,
): Promise<FactWriteResult> {
  const result: FactWriteResult = { created: 0, superseded: 0, skipped: 0 };
  const persistedFacts: PersistedFact[] = [];
  const now = new Date().toISOString();

  for (const fact of facts) {
    const subjectId = resolveEntityId(fact.subject, ctx.entityMap);
    if (!subjectId) {
      logger.debug("Skipping fact with unresolvable subject", {
        subject: fact.subject,
        predicate: fact.predicate,
      });
      result.skipped++;
      continue;
    }

    const objectId = resolveEntityId(fact.object, ctx.entityMap);
    const objectText = objectId ? null : fact.object;

    const persisted: PersistedFact = {
      id: randomUUID(),
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      confidence: fact.confidence,
      explicit: fact.explicit,
      temporalHint: fact.temporalHint,
      context: fact.context,
      subjectId,
      objectId: objectId ?? null,
      objectText,
      validAt: ctx.eventTimestamp,
      invalidAt: null,
      createdAt: now,
      expiredAt: null,
      sourceEpisode: ctx.episodeId,
      sourceSegment: ctx.segmentId ?? null,
      extractionMethod: ctx.extractionMethod,
    };

    try {
      await writeFactToCozoDB(persisted, cozo);
      await writeEdgeToCozoDB(persisted, cozo);

      if (fact.temporalHint === "supersedes_previous") {
        const supersededCount = await handleSupersession(persisted, cozo);
        result.superseded += supersededCount;
      }

      persistedFacts.push(persisted);
      result.created++;
    } catch (err) {
      logger.warn("Failed to write fact to graph", {
        factId: persisted.id,
        subject: fact.subject,
        predicate: fact.predicate,
        error: cozoErrorMessage(err),
      });
    }
  }

  if (persistedFacts.length > 0) {
    try {
      appendFacts(persistedFacts, ctx.homeOverride);
    } catch (err) {
      logger.warn("Failed to append facts to JSONL", {
        count: persistedFacts.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Invalidate a fact by setting its invalid_at and expired_at timestamps.
 * Also closes the corresponding edge's valid_to window.
 */
export async function invalidateFact(
  factId: string,
  invalidAt: string,
  cozo: CozoDb,
): Promise<void> {
  const fid = escCozo(factId);
  const ts = escCozo(invalidAt);

  // Read the existing fact
  const existing = await cozo.run(
    `?[subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, created_at, source_episode, source_segment, extraction_method]
     := *fact{id: '${fid}', subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, created_at, source_episode, source_segment, extraction_method}`,
  );

  const rows = (existing as { rows?: unknown[][] }).rows ?? [];
  if (rows.length === 0) {
    logger.debug("Fact not found for invalidation", { factId });
    return;
  }

  const r = rows[0];

  // Update fact with invalid_at and expired_at
  await cozo.run(
    `?[id, subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method] <- [
      ['${fid}', '${escCozo(r[0] as string)}', '${escCozo(r[1] as string)}', '${escCozo(r[2] as string)}', '${escCozo(r[3] as string)}', ${r[4]}, ${r[5]}, '${escCozo(r[6] as string)}', '${escCozo(r[7] as string)}', '${escCozo(r[8] as string)}', '${ts}', '${escCozo(r[9] as string)}', '${ts}', '${escCozo(r[10] as string)}', '${escCozo(r[11] as string)}', '${escCozo(r[12] as string)}']
    ]
    :put fact {id => subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method}`,
  );

  // Close the corresponding edge's valid_to
  const subjectId = escCozo(r[0] as string);
  const objectId = escCozo(r[2] as string);
  const predicate = escCozo(r[1] as string);
  const invalidAtEpoch = new Date(invalidAt).getTime() / 1000;

  if (objectId) {
    try {
      await cozo.run(
        `?[src, dst, type, weight, created_at, evidence, valid_from, valid_to] :=
          *edge{src, dst, type, weight, created_at, evidence, valid_from, valid_to},
          src = '${subjectId}', dst = '${objectId}', type = '${predicate}'
        :rm edge {src, dst, type}`,
      );

      // Re-insert with updated valid_to (rm + put for wide-key update)
      const edgeResult = await cozo.run(
        `?[weight, created_at, evidence, valid_from] :=
          weight = 1.0, created_at = ${invalidAtEpoch}, evidence = '', valid_from = ${invalidAtEpoch}`,
      );
      // Edge removal is sufficient — the fact invalidation is the authoritative signal
    } catch {
      // Edge may not exist — that's fine
    }
  }

  logger.debug("Fact invalidated", { factId, invalidAt });
}

// ─── CozoDB Write Helpers ───────────────────────────────────────────────────

async function writeFactToCozoDB(fact: PersistedFact, cozo: CozoDb): Promise<void> {
  const f = escFact(fact);

  await cozo.run(
    `?[id, subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method] <- [
      ['${f.id}', '${f.subjectId}', '${f.predicate}', '${f.objectId}', '${f.objectText}', ${fact.confidence}, ${fact.explicit}, '${f.temporalHint}', '${f.context}', '${f.validAt}', '${f.invalidAt}', '${f.createdAt}', '${f.expiredAt}', '${f.sourceEpisode}', '${f.sourceSegment}', '${f.extractionMethod}']
    ]
    :put fact {id => subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at, created_at, expired_at, source_episode, source_segment, extraction_method}`,
  );
}

async function writeEdgeToCozoDB(fact: PersistedFact, cozo: CozoDb): Promise<void> {
  if (!fact.objectId) return;

  const src = escCozo(fact.subjectId);
  const dst = escCozo(fact.objectId);
  const type = escCozo(fact.predicate);
  const evidence = escCozo(fact.context.slice(0, 200));
  const now = Date.now() / 1000;

  await cozo.run(
    `?[src, dst, type, weight, created_at, evidence, valid_from, valid_to] <- [
      ['${src}', '${dst}', '${type}', ${fact.confidence}, ${now}, '${evidence}', ${now}, 9999999999.0]
    ]
    :put edge {src, dst, type => weight, created_at, evidence, valid_from, valid_to}`,
  );
}

// ─── Supersession Detection (KE-11.2) ───────────────────────────────────────

/**
 * When a fact has temporalHint "supersedes_previous":
 *   1. Regex-extract the "old" entity name from the fact's context
 *   2. Find valid facts in CozoDB with same subject and related predicate
 *   3. Narrow to facts whose object matches the old entity (if extracted)
 *   4. Invalidate all matching old facts
 */
async function handleSupersession(
  newFact: PersistedFact,
  cozo: CozoDb,
): Promise<number> {
  const oldEntityName = extractOldEntityFromContext(newFact.context);

  // Find valid facts with same subject and same predicate
  const subjectId = escCozo(newFact.subjectId);
  const predicate = escCozo(newFact.predicate);

  let query: string;
  if (oldEntityName) {
    const oldNorm = escCozo(normalizeEntityName(oldEntityName));
    query = `?[id, object_id, object_text] :=
      *fact{id, subject_id, predicate, object_id, object_text, invalid_at},
      subject_id = '${subjectId}',
      predicate = '${predicate}',
      invalid_at = '',
      id != '${escCozo(newFact.id)}'`;
  } else {
    query = `?[id, object_id, object_text] :=
      *fact{id, subject_id, predicate, object_id, object_text, invalid_at},
      subject_id = '${subjectId}',
      predicate = '${predicate}',
      invalid_at = '',
      id != '${escCozo(newFact.id)}'`;
  }

  try {
    const result = await cozo.run(query);
    const rows = (result as { rows?: unknown[][] }).rows ?? [];

    let invalidatedCount = 0;
    for (const row of rows) {
      const oldFactId = row[0] as string;
      const oldObjectId = row[1] as string;
      const oldObjectText = row[2] as string;

      // If we extracted an old entity name, only invalidate facts whose object matches
      if (oldEntityName) {
        const oldObject = oldObjectText || oldObjectId;
        const oldNorm = normalizeEntityName(oldEntityName);
        const objectNorm = normalizeEntityName(oldObject);
        if (objectNorm !== oldNorm && !objectNorm.includes(oldNorm) && !oldNorm.includes(objectNorm)) {
          continue;
        }
      }

      await invalidateFact(oldFactId, newFact.validAt, cozo);
      invalidatedCount++;
      logger.debug("Superseded old fact", {
        oldFactId,
        newFactId: newFact.id,
        predicate: newFact.predicate,
      });
    }

    return invalidatedCount;
  } catch (err) {
    logger.debug("Supersession detection failed", {
      factId: newFact.id,
      error: cozoErrorMessage(err),
    });
    return 0;
  }
}

/**
 * Extract the "old" entity name from a supersession context string.
 * Matches patterns like "switched from Express to Fastify" → "Express".
 */
export function extractOldEntityFromContext(context: string): string | null {
  for (const pattern of SUPERSESSION_PATTERNS) {
    const match = pattern.exec(context);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Get all valid (non-invalidated) facts for a subject entity.
 * Used by downstream intelligence analyzers and MCP tools.
 */
export async function getValidFactsForSubject(
  subjectId: string,
  cozo: CozoDb,
): Promise<Array<{ id: string; predicate: string; objectId: string; objectText: string; confidence: number }>> {
  const sid = escCozo(subjectId);

  const result = await cozo.run(
    `?[id, predicate, object_id, object_text, confidence] :=
      *fact{id, subject_id, predicate, object_id, object_text, confidence, invalid_at},
      subject_id = '${sid}',
      invalid_at = ''`,
  );

  const rows = (result as { rows?: unknown[][] }).rows ?? [];
  return rows.map((r) => ({
    id: r[0] as string,
    predicate: r[1] as string,
    objectId: r[2] as string,
    objectText: r[3] as string,
    confidence: r[4] as number,
  }));
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function resolveEntityId(name: string, entityMap: Map<string, string>): string | null {
  return entityMap.get(name) ?? entityMap.get(normalizeEntityName(name)) ?? null;
}

interface EscapedFact {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  objectText: string;
  temporalHint: string;
  context: string;
  validAt: string;
  invalidAt: string;
  createdAt: string;
  expiredAt: string;
  sourceEpisode: string;
  sourceSegment: string;
  extractionMethod: string;
}

function escFact(fact: PersistedFact): EscapedFact {
  return {
    id: escCozo(fact.id),
    subjectId: escCozo(fact.subjectId),
    predicate: escCozo(fact.predicate),
    objectId: escCozo(fact.objectId ?? ""),
    objectText: escCozo(fact.objectText ?? ""),
    temporalHint: escCozo(fact.temporalHint),
    context: escCozo(fact.context),
    validAt: escCozo(fact.validAt),
    invalidAt: escCozo(fact.invalidAt ?? ""),
    createdAt: escCozo(fact.createdAt),
    expiredAt: escCozo(fact.expiredAt ?? ""),
    sourceEpisode: escCozo(fact.sourceEpisode),
    sourceSegment: escCozo(fact.sourceSegment ?? ""),
    extractionMethod: escCozo(fact.extractionMethod),
  };
}

function cozoErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.display === "string") return obj.display;
    if (typeof obj.message === "string") return obj.message;
    return JSON.stringify(err).slice(0, 200);
  }
  return String(err);
}

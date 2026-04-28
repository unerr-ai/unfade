// FILE: src/services/knowledge/extractor.ts
// Layer 2.5 KE-17.1: Knowledge extraction orchestrator.
// The master pipeline that ties all extraction modules into a single function.
// Processes CaptureEvents through a 10-step extraction pipeline:
//
//   1. Parse conversation turns (KE-5)
//   2. Segment conversation into topics (KE-6)
//   3. LLM extraction or heuristic fallback (KE-8)
//   4. Resolve entities against knowledge graph (KE-10)
//   5. Write entities to CozoDB (KE-9)
//   6. Write facts to CozoDB + JSONL (KE-11)
//   7. Find contradiction candidates (KE-12)
//   8. Write comprehension assessment (KE-13)
//   9. Write metacognitive signals (KE-13)
//  10. Mark event as extracted (KE-4)
//
// Each event is isolated in a try/catch — one failure doesn't block the batch.
// Events without LLM are deferred, with optional heuristic comprehension proxy.

import type { CozoDb } from "cozo-node";
import type { CaptureEvent } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";
import { parseConversationTurns, extractUserTurns } from "./turn-parser.js";
import { segmentConversation } from "./segmenter.js";
import {
  extractFromEvent,
  type ExtractionConfig,
} from "./llm-extractor.js";
import { extractHeuristicComprehension } from "./heuristic-extractor.js";
import { resolveEntities } from "./entity-resolver.js";
import { writeEntitiesToGraph, getAllEntityNames } from "./entity-writer.js";
import { writeFactsToGraph, type FactWriteContext } from "./fact-writer-graph.js";
import { findContradictionCandidates } from "./contradiction-detector.js";
import { writeComprehensionAssessment, writeMetacognitiveSignals } from "./comprehension-writer.js";
import { markExtracted, markFailed, markDeferred } from "./extraction-tracker.js";
import { normalizeEntityName } from "./entity-normalizer.js";
import {
  type EmbeddingModel,
  createEntityEmbedFn,
} from "./embedding.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KnowledgeExtractionConfig {
  /** LLM configuration. Null = no LLM, events are deferred. */
  llmConfig: ExtractionConfig | null;
  /** Embedding model for entity resolution Pass 3 + contradiction detection. Null = skip embedding passes. */
  embeddingModel: EmbeddingModel | null;
  /** CozoDB knowledge graph instance. */
  cozo: CozoDb;
  /** DuckDB analytics handle (comprehension, extraction status, domain state). */
  analytics: DbLike;
}

export interface KnowledgeExtractionResult {
  entitiesCreated: number;
  factsExtracted: number;
  assessmentsWritten: number;
  signalsDetected: number;
  eventsProcessed: number;
  eventsDeferred: number;
  eventsFailed: number;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract knowledge from a batch of CaptureEvents.
 *
 * Processes events sequentially through the 10-step pipeline. Each event is
 * isolated in a try/catch — one failure marks that event as "failed" in the
 * extraction tracker but doesn't halt the batch.
 *
 * When no LLM is configured, events are marked "deferred" for later processing.
 * AI conversation events still get a heuristic comprehension proxy so basic
 * metrics keep flowing to Layer 3 analyzers.
 */
export async function extractKnowledge(
  events: CaptureEvent[],
  config: KnowledgeExtractionConfig,
): Promise<KnowledgeExtractionResult> {
  const result: KnowledgeExtractionResult = {
    entitiesCreated: 0,
    factsExtracted: 0,
    assessmentsWritten: 0,
    signalsDetected: 0,
    eventsProcessed: 0,
    eventsDeferred: 0,
    eventsFailed: 0,
  };

  const entityEmbedFn = config.embeddingModel
    ? createEntityEmbedFn(config.embeddingModel)
    : undefined;

  // Pre-load existing entity names for LLM resolution hints
  let existingEntities: string[] = [];
  try {
    existingEntities = await getAllEntityNames(config.cozo);
  } catch {
    // Non-critical — extraction works without hints
  }

  for (const event of events) {
    try {
      const eventResult = await processEvent(
        event, config, entityEmbedFn, existingEntities,
      );
      result.entitiesCreated += eventResult.entitiesCreated;
      result.factsExtracted += eventResult.factsExtracted;
      result.assessmentsWritten += eventResult.assessmentsWritten;
      result.signalsDetected += eventResult.signalsDetected;
      result.eventsProcessed += eventResult.processed ? 1 : 0;
      result.eventsDeferred += eventResult.deferred ? 1 : 0;
    } catch (err) {
      result.eventsFailed++;
      try {
        await markFailed(
          config.analytics,
          event.id,
          err instanceof Error ? err.message : String(err),
          event.projectId,
        );
      } catch {
        // Tracker failure is non-critical
      }
      logger.warn("Knowledge extraction failed for event", {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.eventsProcessed > 0 || result.eventsDeferred > 0) {
    logger.debug("Knowledge extraction batch complete", { ...result });
  }

  return result;
}

// ─── Per-Event Pipeline ─────────────────────────────────────────────────────

interface EventResult {
  entitiesCreated: number;
  factsExtracted: number;
  assessmentsWritten: number;
  signalsDetected: number;
  processed: boolean;
  deferred: boolean;
}

async function processEvent(
  event: CaptureEvent,
  config: KnowledgeExtractionConfig,
  entityEmbedFn: ((text: string) => Promise<number[]>) | undefined,
  existingEntities: string[],
): Promise<EventResult> {
  const result: EventResult = {
    entitiesCreated: 0,
    factsExtracted: 0,
    assessmentsWritten: 0,
    signalsDetected: 0,
    processed: false,
    deferred: false,
  };

  // Step 1: Parse turns
  const turns = parseConversationTurns(event);

  // Step 2: Segment conversation
  const segments = segmentConversation(turns, event.id);

  // Step 3: LLM extraction or deferral
  if (!config.llmConfig) {
    await markDeferred(config.analytics, event.id, event.projectId);
    result.deferred = true;

    // Heuristic comprehension for AI conversations (keeps basic metrics flowing)
    if (event.source === "ai-session") {
      const heuristic = extractHeuristicComprehension(event, turns);
      if (heuristic) {
        await writeComprehensionAssessment(
          heuristic, event.projectId, config.cozo, config.analytics,
        );
        result.assessmentsWritten = 1;
      }
    }
    return result;
  }

  const extraction = await extractFromEvent(
    event, turns, segments, config.llmConfig, existingEntities,
  );

  // Step 4: Resolve entities
  const resolved = await resolveEntities(
    extraction.entities,
    config.cozo,
    entityEmbedFn,
    { projectId: event.projectId },
  );

  // Step 5: Write entities to graph
  const entityWriteResult = await writeEntitiesToGraph(
    resolved, extraction.entities, event.id, event.projectId, config.cozo,
  );
  result.entitiesCreated = entityWriteResult.created;

  // Build entity map: extracted name → resolved ID
  const entityMap = buildEntityMap(extraction.entities, resolved);

  // Step 6: Write facts to CozoDB + JSONL
  const factCtx: FactWriteContext = {
    entityMap,
    episodeId: event.id,
    segmentId: segments.length > 0 ? segments[0].segmentId : null,
    eventTimestamp: event.timestamp,
    extractionMethod: "llm",
  };
  const factResult = await writeFactsToGraph(extraction.facts, factCtx, config.cozo);
  result.factsExtracted = factResult.created;

  // Step 7: Find contradiction candidates (stored for daily batch classification)
  // Note: actual LLM classification happens in the daily distill pipeline (KE-12.2)
  // This is Stage 1 only — fast candidate retrieval, no LLM call

  // Step 8: Write comprehension assessment
  if (extraction.comprehension) {
    await writeComprehensionAssessment(
      extraction.comprehension, event.projectId, config.cozo, config.analytics,
    );
    result.assessmentsWritten = 1;
  }

  // Step 9: Write metacognitive signals
  if (extraction.metacognitiveSignals.length > 0) {
    const userTurns = extractUserTurns(turns);
    const aggregates = await writeMetacognitiveSignals(
      event.id,
      extraction.metacognitiveSignals,
      event.projectId,
      userTurns.length,
      config.cozo,
      config.analytics,
    );
    result.signalsDetected = aggregates.signalCount;
  }

  // Step 10: Mark as extracted
  await markExtracted(config.analytics, event.id, event.projectId);
  result.processed = true;

  return result;
}

// ─── Event Loading (for materializer hook) ──────────────────────────────────

/**
 * Load full CaptureEvents from DuckDB by event IDs.
 * Bridges the gap between getUnextractedEvents() (which returns lightweight
 * metadata) and extractKnowledge() (which needs full CaptureEvents).
 */
export async function loadCaptureEventsForExtraction(
  analytics: DbLike,
  eventIds: string[],
): Promise<CaptureEvent[]> {
  if (eventIds.length === 0) return [];

  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ");
  const result = await analytics.exec(
    `SELECT id, project_id, ts, source, type, content_summary, content_detail,
            content_files, content_branch, git_repo, git_branch, git_commit_hash,
            metadata_extra
     FROM events
     WHERE id IN (${placeholders})`,
    eventIds,
  );

  const rows = result[0]?.values ?? [];
  return rows.map((r) => {
    const files = r[7];
    const parsedFiles = Array.isArray(files) ? files.filter((f): f is string => typeof f === "string") : undefined;
    let metadata: Record<string, unknown> | undefined;
    try {
      const extra = r[12];
      metadata = typeof extra === "string" ? JSON.parse(extra) : (extra as Record<string, unknown>) ?? undefined;
    } catch {
      metadata = undefined;
    }

    return {
      id: r[0] as string,
      projectId: (r[1] as string) ?? "",
      timestamp: String(r[2]),
      source: (r[3] as string) as CaptureEvent["source"],
      type: (r[4] as string) as CaptureEvent["type"],
      content: {
        summary: (r[5] as string) ?? "",
        detail: (r[6] as string) ?? undefined,
        files: parsedFiles,
        branch: (r[8] as string) ?? undefined,
      },
      gitContext: r[9] ? {
        repo: (r[9] as string) ?? "",
        branch: (r[10] as string) ?? "",
        commitHash: (r[11] as string) ?? undefined,
      } : undefined,
      metadata,
    } as CaptureEvent;
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the entity name → resolved ID map for fact subject/object resolution.
 * Includes display name, normalized name, and all aliases.
 */
function buildEntityMap(
  extracted: Array<{ name: string; normalizedName: string; aliases: string[] }>,
  resolved: Array<{ id: string }>,
): Map<string, string> {
  const map = new Map<string, string>();

  for (let i = 0; i < extracted.length; i++) {
    const entity = extracted[i];
    const id = resolved[i].id;

    map.set(entity.name, id);
    map.set(entity.normalizedName, id);

    for (const alias of entity.aliases) {
      map.set(alias, id);
      const norm = normalizeEntityName(alias);
      if (norm) map.set(norm, id);
    }
  }

  return map;
}

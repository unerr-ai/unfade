// FILE: src/services/knowledge/contradiction-detector.ts
// Layer 2.5 KE-12: Two-stage contradiction detection.
//
// Stage 1 (KE-12.1): Candidate retrieval — finds existing facts that might
// contradict a new fact. Two paths:
//   - HNSW embedding similarity on fact_embedding (fast, optional, requires KE-16)
//   - Predicate-based CozoDB query (fallback: same subject + same predicate + valid)
//
// Stage 2 (KE-12.2): LLM classification — sends each candidate pair to the LLM
// which classifies it as CONSISTENT | MORE_SPECIFIC | CONTRADICTORY | SUPERSEDES | UNRELATED.
// For CONTRADICTORY/SUPERSEDES, the old fact is auto-invalidated via KE-11.
//
// Integration: detectContradictions() combines both stages for pipeline use.

import type { LanguageModel } from "ai";
import { generateText } from "ai";
import { z } from "zod";

import type { CozoDb } from "cozo-node";
import {
  type ContradictionResult,
  ContradictionClassificationSchema,
  type PersistedFact,
} from "../../schemas/knowledge.js";
import { logger } from "../../utils/logger.js";
import { extractFirstJsonObjectFromModelText } from "../distill/synthesizer.js";
import {
  buildContradictionClassificationPrompt,
  CONTRADICTION_SYSTEM_PROMPT,
} from "./prompts.js";
import { invalidateFact } from "./fact-writer-graph.js";
import type { ExtractionConfig } from "./llm-extractor.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContradictionCandidate {
  existingFactId: string;
  existingFact: CandidateFact;
  similarity: number;
}

/** Minimal fact representation for candidate matching and prompt building. */
interface CandidateFact {
  id: string;
  subject: string;
  subjectId: string;
  predicate: string;
  object: string;
  objectId: string;
  objectText: string;
  confidence: number;
  explicit: boolean;
  temporalHint: string;
  context: string;
  validAt: string;
}

export interface ContradictionDetectionResult {
  candidatesFound: number;
  classificationsRun: number;
  contradictionsResolved: number;
  results: ContradictionResult[];
}

// ─── Config ─────────────────────────────────────────────────────────────────

const HNSW_K = 10;
const HNSW_EF = 50;
const EMBEDDING_SIMILARITY_THRESHOLD = 0.3;
const MAX_PREDICATE_CANDIDATES = 20;

// ─── LLM Output Schema ─────────────────────────────────────────────────────

const LlmContradictionOutputSchema = z.object({
  classification: ContradictionClassificationSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

// ─── CozoDB String Escaping ─────────────────────────────────────────────────

function escCozo(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// ─── Stage 1: Candidate Retrieval (KE-12.1) ─────────────────────────────────

/**
 * Find existing facts that might contradict a new fact.
 *
 * Two retrieval paths:
 *   1. HNSW embedding similarity (if embedFn provided) — top-10 similar facts
 *   2. Predicate-based query (fallback) — same subject + same predicate + still valid
 *
 * Both paths filter out invalidated facts and the new fact itself.
 */
export async function findContradictionCandidates(
  newFact: PersistedFact,
  cozo: CozoDb,
  embedFn?: (text: string) => Promise<number[]>,
): Promise<ContradictionCandidate[]> {
  // Try HNSW embedding path first (if available)
  if (embedFn) {
    const embeddingCandidates = await findCandidatesViaEmbedding(newFact, cozo, embedFn);
    if (embeddingCandidates.length > 0) return embeddingCandidates;
  }

  // Fallback: predicate-based matching
  return findCandidatesViaPredicate(newFact, cozo);
}

/**
 * Stage 1a: HNSW embedding similarity search on fact_embedding index.
 * Returns top-K facts with cosine distance below threshold.
 */
async function findCandidatesViaEmbedding(
  newFact: PersistedFact,
  cozo: CozoDb,
  embedFn: (text: string) => Promise<number[]>,
): Promise<ContradictionCandidate[]> {
  try {
    const factText = `${newFact.subject} ${newFact.predicate} ${newFact.object}`;
    const embedding = await embedFn(factText);
    if (!embedding || embedding.length === 0) return [];

    const vecStr = `[${embedding.map((v) => v.toString()).join(",")}]`;

    const result = await cozo.run(
      `?[id, dist] := ~fact_embedding:fact_vec_idx{ id | query: ${vecStr}, k: ${HNSW_K}, ef: ${HNSW_EF}, bind_distance: dist }`,
    );

    const rows = (result as { rows?: unknown[][] }).rows ?? [];
    const candidates: ContradictionCandidate[] = [];

    for (const row of rows) {
      const candidateId = row[0] as string;
      const distance = row[1] as number;

      if (candidateId === newFact.id) continue;
      if (distance > EMBEDDING_SIMILARITY_THRESHOLD) continue;

      const existingFact = await loadFactFromCozoDB(candidateId, cozo);
      if (!existingFact) continue;
      if (existingFact.subjectId !== newFact.subjectId) continue;

      candidates.push({
        existingFactId: candidateId,
        existingFact,
        similarity: 1 - distance,
      });
    }

    return candidates;
  } catch (err) {
    logger.debug("HNSW contradiction search failed — falling back to predicate match", {
      factId: newFact.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Stage 1b: Predicate-based candidate retrieval.
 * Finds valid facts with the same subject entity and same predicate.
 */
async function findCandidatesViaPredicate(
  newFact: PersistedFact,
  cozo: CozoDb,
): Promise<ContradictionCandidate[]> {
  try {
    const subjectId = escCozo(newFact.subjectId);
    const predicate = escCozo(newFact.predicate);
    const newFactId = escCozo(newFact.id);

    const result = await cozo.run(
      `?[id, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at] :=
        *fact{id, subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at},
        subject_id = '${subjectId}',
        predicate = '${predicate}',
        invalid_at = '',
        id != '${newFactId}'`,
    );

    const rows = (result as { rows?: unknown[][] }).rows ?? [];
    return rows.slice(0, MAX_PREDICATE_CANDIDATES).map((r) => ({
      existingFactId: r[0] as string,
      existingFact: {
        id: r[0] as string,
        subject: newFact.subject,
        subjectId: newFact.subjectId,
        predicate: newFact.predicate,
        object: (r[2] as string) || (r[1] as string),
        objectId: r[1] as string,
        objectText: r[2] as string,
        confidence: r[3] as number,
        explicit: r[4] as boolean,
        temporalHint: (r[5] as string) || "ongoing",
        context: (r[6] as string) || "",
        validAt: (r[7] as string) || "",
      },
      similarity: 1.0,
    }));
  } catch (err) {
    logger.debug("Predicate-based candidate retrieval failed", {
      factId: newFact.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ─── Stage 2: LLM Classification (KE-12.2) ──────────────────────────────────

/**
 * Classify a batch of contradiction candidates using the LLM.
 *
 * For each candidate pair (existing fact, new fact):
 *   1. Build classification prompt (KE-7)
 *   2. Call LLM via generateText
 *   3. Parse and validate JSON response
 *   4. For CONTRADICTORY/SUPERSEDES: auto-invalidate the old fact
 */
export async function classifyContradictionBatch(
  candidates: ContradictionCandidate[],
  newFact: PersistedFact,
  config: ExtractionConfig,
  cozo: CozoDb,
): Promise<ContradictionResult[]> {
  const results: ContradictionResult[] = [];

  for (const candidate of candidates) {
    try {
      const classification = await classifySinglePair(
        candidate.existingFact,
        newFact,
        config,
      );

      if (!classification) continue;

      const result: ContradictionResult = {
        existingFactId: candidate.existingFactId,
        newFactId: newFact.id,
        classification: classification.classification,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
      };

      results.push(result);

      if (
        classification.classification === "CONTRADICTORY" ||
        classification.classification === "SUPERSEDES"
      ) {
        await invalidateFact(candidate.existingFactId, newFact.validAt, cozo);
        logger.debug("Contradiction resolved — old fact invalidated", {
          oldFactId: candidate.existingFactId,
          newFactId: newFact.id,
          classification: classification.classification,
        });
      }
    } catch (err) {
      logger.debug("Contradiction classification failed for candidate", {
        existingFactId: candidate.existingFactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function classifySinglePair(
  existingFact: CandidateFact,
  newFact: PersistedFact,
  config: ExtractionConfig,
): Promise<{ classification: ContradictionResult["classification"]; confidence: number; reasoning: string } | null> {
  const existingAsAtomic = {
    subject: existingFact.subject,
    predicate: existingFact.predicate as PersistedFact["predicate"],
    object: existingFact.object,
    confidence: existingFact.confidence,
    explicit: existingFact.explicit,
    temporalHint: existingFact.temporalHint as PersistedFact["temporalHint"],
    context: existingFact.context,
  };

  const prompt = buildContradictionClassificationPrompt(existingAsAtomic, newFact);

  const result = await generateText({
    model: config.model,
    system: CONTRADICTION_SYSTEM_PROMPT,
    prompt,
    temperature: 0,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(config.timeoutMs),
  });

  let jsonStr: string;
  try {
    jsonStr = extractFirstJsonObjectFromModelText(result.text);
  } catch {
    logger.debug("Contradiction LLM response not valid JSON", { raw: result.text.slice(0, 200) });
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  const validated = LlmContradictionOutputSchema.safeParse(parsed);
  if (!validated.success) {
    logger.debug("Contradiction LLM output failed Zod validation", {
      issues: validated.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return null;
  }

  return validated.data;
}

// ─── Combined Pipeline API ──────────────────────────────────────────────────

/**
 * Full contradiction detection pipeline for a batch of newly written facts.
 *
 * For each new fact:
 *   1. Find contradiction candidates (Stage 1)
 *   2. Classify each candidate pair with LLM (Stage 2)
 *   3. Auto-invalidate contradicted/superseded facts
 *
 * Called from the distill pipeline after fact extraction.
 */
export async function detectContradictions(
  newFacts: PersistedFact[],
  config: ExtractionConfig,
  cozo: CozoDb,
  embedFn?: (text: string) => Promise<number[]>,
): Promise<ContradictionDetectionResult> {
  const summary: ContradictionDetectionResult = {
    candidatesFound: 0,
    classificationsRun: 0,
    contradictionsResolved: 0,
    results: [],
  };

  for (const newFact of newFacts) {
    const candidates = await findContradictionCandidates(newFact, cozo, embedFn);
    summary.candidatesFound += candidates.length;

    if (candidates.length === 0) continue;

    const results = await classifyContradictionBatch(candidates, newFact, config, cozo);
    summary.classificationsRun += candidates.length;
    summary.results.push(...results);

    const resolved = results.filter(
      (r) => r.classification === "CONTRADICTORY" || r.classification === "SUPERSEDES",
    );
    summary.contradictionsResolved += resolved.length;
  }

  if (summary.candidatesFound > 0) {
    logger.debug("Contradiction detection complete", {
      factsProcessed: newFacts.length,
      candidatesFound: summary.candidatesFound,
      classificationsRun: summary.classificationsRun,
      contradictionsResolved: summary.contradictionsResolved,
    });
  }

  return summary;
}

// ─── CozoDB Helpers ─────────────────────────────────────────────────────────

async function loadFactFromCozoDB(factId: string, cozo: CozoDb): Promise<CandidateFact | null> {
  try {
    const fid = escCozo(factId);
    const result = await cozo.run(
      `?[subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at] :=
        *fact{id: '${fid}', subject_id, predicate, object_id, object_text, confidence, explicit, temporal_hint, context, valid_at, invalid_at}`,
    );

    const rows = (result as { rows?: unknown[][] }).rows ?? [];
    if (rows.length === 0) return null;

    const r = rows[0];
    const invalidAt = r[9] as string;
    if (invalidAt) return null;

    return {
      id: factId,
      subject: "",
      subjectId: r[0] as string,
      predicate: r[1] as string,
      object: (r[3] as string) || (r[2] as string),
      objectId: r[2] as string,
      objectText: r[3] as string,
      confidence: r[4] as number,
      explicit: r[5] as boolean,
      temporalHint: (r[6] as string) || "ongoing",
      context: (r[7] as string) || "",
      validAt: (r[8] as string) || "",
    };
  } catch {
    return null;
  }
}

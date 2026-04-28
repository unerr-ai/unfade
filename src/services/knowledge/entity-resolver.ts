// FILE: src/services/knowledge/entity-resolver.ts
// Layer 2.5 KE-10.1: Three-pass entity resolver.
// Deduplicates extracted entities against the CozoDB knowledge graph using
// three progressively fuzzier matching strategies:
//
//   Pass 1: Exact normalized name match (cheapest, most reliable)
//   Pass 2: Alias table lookup + alias-as-canonical-name check
//   Pass 3: Embedding similarity via HNSW vector index (optional, most expensive)
//
// Within-batch deduplication: entities with the same normalized name are grouped
// and resolved once. The result is applied to all members of the group.
//
// This module does NOT write to CozoDB — it only resolves. The caller invokes
// writeEntitiesToGraph() separately with the resolution results.

import { randomUUID } from "node:crypto";
import type { CozoDb } from "cozo-node";
import type { ExtractedEntity } from "../../schemas/knowledge.js";
import { logger } from "../../utils/logger.js";
import { normalizeEntityName } from "./entity-normalizer.js";
import {
  type ResolvedEntity,
  findEntityByNormalizedName,
  findEntityByAlias,
} from "./entity-writer.js";

export type { ResolvedEntity } from "./entity-writer.js";

// ─── Config ─────────────────────────────────────────────────────────────────

/** Cosine distance threshold for HNSW embedding match.
 *  distance < threshold ↔ similarity > (1 - threshold).
 *  0.15 = similarity > 0.85. */
const DEFAULT_EMBEDDING_DISTANCE_THRESHOLD = 0.15;

/** Number of nearest neighbors to retrieve in HNSW search. */
const HNSW_K = 5;

/** HNSW search ef parameter (exploration factor). */
const HNSW_EF = 50;

/** Entity ID prefix for knowledge-extraction entities. */
const ENTITY_ID_PREFIX = "ke-";

export interface ResolveOptions {
  /** Scope resolution to a specific project. */
  projectId?: string;
  /** Override the default cosine distance threshold (0.15). */
  embeddingDistanceThreshold?: number;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve a batch of extracted entities against the CozoDB knowledge graph.
 *
 * Returns a ResolvedEntity[] in the same order as the input ExtractedEntity[].
 * Each resolved entity maps to either an existing graph node or a new one.
 *
 * Within-batch deduplication: entities with the same normalized name are
 * grouped and resolved once. All members of a group get the same resolution.
 */
export async function resolveEntities(
  extracted: ExtractedEntity[],
  cozo: CozoDb,
  embedFn?: (text: string) => Promise<number[]>,
  options?: ResolveOptions,
): Promise<ResolvedEntity[]> {
  const results: ResolvedEntity[] = new Array(extracted.length);
  const projectId = options?.projectId;
  const distanceThreshold =
    options?.embeddingDistanceThreshold ?? DEFAULT_EMBEDDING_DISTANCE_THRESHOLD;

  // Group by normalized name for within-batch deduplication
  const groups = new Map<string, number[]>();

  for (let i = 0; i < extracted.length; i++) {
    const norm = normalizeEntityName(extracted[i].name);
    if (!norm) {
      results[i] = makeNewEntity();
      continue;
    }
    const existing = groups.get(norm);
    if (existing) {
      existing.push(i);
    } else {
      groups.set(norm, [i]);
    }
  }

  for (const [normalizedName, indices] of groups) {
    // Collect all unique aliases from every entity in this group
    const groupAliases = collectGroupAliases(extracted, indices, normalizedName);

    let resolved: ResolvedEntity | null = null;

    // Pass 1: Exact normalized name match
    resolved = await passExactMatch(cozo, normalizedName, projectId);

    // Pass 2: Alias table lookup
    if (!resolved) {
      resolved = await passAliasMatch(cozo, normalizedName, groupAliases, projectId);
    }

    // Pass 3: Embedding similarity (optional — skipped if no embedFn)
    if (!resolved && embedFn) {
      resolved = await passEmbeddingMatch(
        cozo, normalizedName, embedFn, distanceThreshold,
      );
    }

    // Unresolved → create new entity
    if (!resolved) {
      resolved = {
        id: `${ENTITY_ID_PREFIX}${randomUUID()}`,
        isNew: true,
        matchMethod: "new",
        mergedAliases: groupAliases.length > 0 ? groupAliases : undefined,
      };
    }

    // Apply the same resolution to all entities in this group
    for (const idx of indices) {
      results[idx] = resolved;
    }
  }

  return results;
}

// ─── Pass 1: Exact Normalized Name Match ────────────────────────────────────

async function passExactMatch(
  cozo: CozoDb,
  normalizedName: string,
  projectId?: string,
): Promise<ResolvedEntity | null> {
  try {
    const id = await findEntityByNormalizedName(cozo, normalizedName, projectId);
    if (id) {
      logger.debug("Entity resolved via exact match", { normalizedName, entityId: id });
      return { id, isNew: false, matchMethod: "exact" };
    }
  } catch (err) {
    logger.debug("Pass 1 (exact) failed", {
      normalizedName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

// ─── Pass 2: Alias Table Lookup ─────────────────────────────────────────────

async function passAliasMatch(
  cozo: CozoDb,
  normalizedName: string,
  aliases: string[],
  projectId?: string,
): Promise<ResolvedEntity | null> {
  try {
    // Check if the entity's own normalized name is a known alias of another entity
    const idFromName = await findEntityByAlias(cozo, normalizedName);
    if (idFromName) {
      logger.debug("Entity resolved via name-as-alias", { normalizedName, entityId: idFromName });
      return {
        id: idFromName,
        isNew: false,
        matchMethod: "alias",
        mergedAliases: [normalizedName],
      };
    }

    // Check each alias against both the alias table and as a canonical name
    for (const alias of aliases) {
      const idFromAlias = await findEntityByAlias(cozo, alias);
      if (idFromAlias) {
        logger.debug("Entity resolved via alias lookup", {
          normalizedName, alias, entityId: idFromAlias,
        });
        return {
          id: idFromAlias,
          isNew: false,
          matchMethod: "alias",
          mergedAliases: [normalizedName, ...aliases],
        };
      }

      // The alias might be the canonical normalized name of an existing entity
      const idFromCanonical = await findEntityByNormalizedName(cozo, alias, projectId);
      if (idFromCanonical) {
        logger.debug("Entity resolved via alias-as-canonical", {
          normalizedName, alias, entityId: idFromCanonical,
        });
        return {
          id: idFromCanonical,
          isNew: false,
          matchMethod: "alias",
          mergedAliases: [normalizedName],
        };
      }
    }
  } catch (err) {
    logger.debug("Pass 2 (alias) failed", {
      normalizedName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

// ─── Pass 3: Embedding Similarity (HNSW) ────────────────────────────────────

async function passEmbeddingMatch(
  cozo: CozoDb,
  normalizedName: string,
  embedFn: (text: string) => Promise<number[]>,
  distanceThreshold: number,
): Promise<ResolvedEntity | null> {
  try {
    const embedding = await embedFn(normalizedName);
    if (!embedding || embedding.length === 0) return null;

    const vecStr = `[${embedding.map((v) => v.toString()).join(",")}]`;

    const result = await cozo.run(
      `?[id, dist] := ~entity:semantic_vec{ id | query: ${vecStr}, k: ${HNSW_K}, ef: ${HNSW_EF}, bind_distance: dist }`,
    );

    const rows = (result as { rows?: unknown[][] }).rows ?? [];

    for (const row of rows) {
      const candidateId = row[0] as string;
      const distance = row[1] as number;

      if (distance < distanceThreshold) {
        logger.debug("Entity resolved via embedding similarity", {
          normalizedName,
          entityId: candidateId,
          distance: distance.toFixed(4),
          similarity: (1 - distance).toFixed(4),
        });
        return {
          id: candidateId,
          isNew: false,
          matchMethod: "embedding",
          mergedAliases: [normalizedName],
        };
      }
    }
  } catch (err) {
    logger.debug("Pass 3 (embedding) failed — expected if no embeddings exist yet", {
      normalizedName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNewEntity(): ResolvedEntity {
  return {
    id: `${ENTITY_ID_PREFIX}${randomUUID()}`,
    isNew: true,
    matchMethod: "new",
  };
}

/**
 * Collect all unique normalized aliases from a group of extracted entities,
 * excluding the group's own normalized name (to avoid self-match).
 */
function collectGroupAliases(
  extracted: ExtractedEntity[],
  indices: number[],
  normalizedName: string,
): string[] {
  const aliasSet = new Set<string>();

  for (const idx of indices) {
    for (const alias of extracted[idx].aliases) {
      const na = normalizeEntityName(alias);
      if (na && na !== normalizedName) {
        aliasSet.add(na);
      }
    }
  }

  return Array.from(aliasSet);
}

// FILE: src/services/knowledge/entity-writer.ts
// Layer 2.5 KE-9.2: Entity graph writer.
// Writes extracted entities to CozoDB's entity relation and aliases to entity_alias.
// New entities are created with lifecycle: 'emerging'. Existing entities get
// last_updated bumped, mention_count incremented, and confidence updated (max).
//
// Entity metadata (name, normalizedName, context, mentionCount, aliases) is stored
// in the `state` JSON field. `created_at` / `last_updated` serve as first_seen / last_seen.

import type { CozoDb } from "cozo-node";
import type { ExtractedEntity } from "../../schemas/knowledge.js";
import { logger } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * An entity after resolution — maps an extracted entity to either an existing
 * graph node or a newly created one. Used by the entity resolver (KE-10) to
 * communicate resolution results to the writer.
 */
export interface ResolvedEntity {
  /** Existing entity ID or new UUID. */
  id: string;
  /** True if this entity doesn't exist in the graph yet. */
  isNew: boolean;
  /** How the match was determined. */
  matchMethod: "exact" | "alias" | "embedding" | "new";
  /** Aliases discovered during resolution that should be persisted. */
  mergedAliases?: string[];
}

/** State JSON stored in the CozoDB entity relation's `state` field. */
interface EntityState {
  name: string;
  normalizedName: string;
  context: string;
  mentionCount: number;
  aliases: string[];
}

export interface WriteResult {
  created: number;
  updated: number;
}

// ─── CozoDB Constants ───────────────────────────────────────────────────────

/** 64-dimensional zero vector for entity embedding placeholder.
 *  Replaced by real embeddings when computed (KE-16). */
const ZERO_VEC_64 = `[${Array.from({ length: 64 }, () => "0.0").join(",")}]`;

// ─── CozoDB String Escaping ─────────────────────────────────────────────────

function escCozo(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Write resolved entities to the CozoDB knowledge graph.
 *
 * For each entity pair (resolved[i], extracted[i]):
 *   - New entities: `:put entity` with lifecycle 'emerging', mentionCount 1
 *   - Existing entities: read current state, bump mentionCount, update confidence (max),
 *     update last_updated, merge context
 *   - All aliases (from extraction + resolution) written to `entity_alias`
 *
 * Entities are written individually to isolate failures — one bad entity
 * doesn't block the rest.
 */
export async function writeEntitiesToGraph(
  entities: ResolvedEntity[],
  extracted: ExtractedEntity[],
  episodeId: string,
  projectId: string,
  cozo: CozoDb,
): Promise<WriteResult> {
  if (entities.length !== extracted.length) {
    throw new Error(
      `Resolved/extracted length mismatch: ${entities.length} vs ${extracted.length}`,
    );
  }

  let created = 0;
  let updated = 0;

  for (let i = 0; i < entities.length; i++) {
    const resolved = entities[i];
    const ext = extracted[i];

    try {
      if (resolved.isNew) {
        await createEntity(cozo, resolved, ext, projectId);
        created++;
      } else {
        await updateEntity(cozo, resolved, ext);
        updated++;
      }

      await writeAliases(cozo, resolved, ext);
    } catch (err) {
      logger.warn("Failed to write entity to graph", {
        entityId: resolved.id,
        entityName: ext.name,
        error: cozoErrorMessage(err),
      });
    }
  }

  return { created, updated };
}

// ─── Entity Create / Update ─────────────────────────────────────────────────

async function createEntity(
  cozo: CozoDb,
  resolved: ResolvedEntity,
  ext: ExtractedEntity,
  projectId: string,
): Promise<void> {
  const now = Date.now() / 1000;
  const state: EntityState = {
    name: ext.name,
    normalizedName: ext.normalizedName,
    context: ext.context,
    mentionCount: 1,
    aliases: [...ext.aliases, ...(resolved.mergedAliases ?? [])],
  };

  const id = escCozo(resolved.id);
  const type = escCozo(ext.type);
  const pid = escCozo(projectId);
  const stateJson = JSON.stringify(state);

  await cozo.run(
    `?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state, embedding] <- [
      ['${id}', '${type}', '${pid}', ${now}, ${now}, ${ext.confidence}, 'emerging', ${stateJson}, ${ZERO_VEC_64}]
    ]
    :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state, embedding}`,
  );
}

async function updateEntity(
  cozo: CozoDb,
  resolved: ResolvedEntity,
  ext: ExtractedEntity,
): Promise<void> {
  const eid = escCozo(resolved.id);
  const now = Date.now() / 1000;

  // Read existing entity state (may return multiple rows due to wide key)
  const existing = await cozo.run(
    `?[state, confidence, created_at, type, project_id, lifecycle] := *entity{id: '${eid}', state, confidence, created_at, type, project_id, lifecycle}`,
  );

  const rows = (existing as { rows?: unknown[][] }).rows ?? [];
  if (rows.length === 0) {
    logger.warn("Entity not found for update, skipping", { entityId: resolved.id });
    return;
  }

  const row = rows[0];
  let existingState: Partial<EntityState> = {};
  try {
    const raw = row[0];
    existingState = typeof raw === "string" ? JSON.parse(raw) : (raw as Partial<EntityState>) ?? {};
  } catch {
    existingState = {};
  }

  const existingConfidence = (row[1] as number) ?? 0;
  const createdAt = (row[2] as number) ?? now;
  const type = (row[3] as string) ?? ext.type;
  const projectId = (row[4] as string) ?? "";
  const lifecycle = (row[5] as string) ?? "emerging";

  const mergedState: EntityState = {
    name: ext.name || existingState.name || "",
    normalizedName: ext.normalizedName || existingState.normalizedName || "",
    context: ext.context || existingState.context || "",
    mentionCount: (existingState.mentionCount ?? 0) + 1,
    aliases: deduplicateStrings([
      ...(existingState.aliases ?? []),
      ...ext.aliases,
      ...(resolved.mergedAliases ?? []),
    ]),
  };

  const newConfidence = Math.max(existingConfidence, ext.confidence);
  const stateJson = JSON.stringify(mergedState);
  const etype = escCozo(type);
  const epid = escCozo(projectId);
  const elifecycle = escCozo(lifecycle);

  // Preserve existing embedding if present, otherwise zero vector
  const existingEmbedding = await getExistingEmbedding(cozo, resolved.id);
  const embeddingLiteral = existingEmbedding ?? ZERO_VEC_64;

  // Remove all old rows for this entity ID (wide key means updates create new rows)
  await cozo.run(
    `?[id, type, project_id, created_at, last_updated, confidence, lifecycle] :=
      *entity{id, type, project_id, created_at, last_updated, confidence, lifecycle},
      id = '${eid}'
    :rm entity {id, type, project_id, created_at, last_updated, confidence, lifecycle}`,
  );

  // Insert the single updated row
  await cozo.run(
    `?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state, embedding] <- [
      ['${eid}', '${etype}', '${epid}', ${createdAt}, ${now}, ${newConfidence}, '${elifecycle}', ${stateJson}, ${embeddingLiteral}]
    ]
    :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state, embedding}`,
  );
}

// ─── Alias Writer ───────────────────────────────────────────────────────────

async function writeAliases(
  cozo: CozoDb,
  resolved: ResolvedEntity,
  ext: ExtractedEntity,
): Promise<void> {
  const allAliases = deduplicateStrings([
    ...ext.aliases,
    ...(resolved.mergedAliases ?? []),
    ext.normalizedName,
  ]);

  const eid = escCozo(resolved.id);

  for (const alias of allAliases) {
    if (!alias.trim()) continue;
    try {
      const ea = escCozo(alias.toLowerCase().trim());
      await cozo.run(
        `?[entity_id, alias] <- [['${eid}', '${ea}']]
        :put entity_alias {entity_id, alias}`,
      );
    } catch (err) {
      logger.debug("Failed to write alias", {
        entityId: resolved.id,
        alias,
        error: cozoErrorMessage(err),
      });
    }
  }
}

// ─── Query Helpers (for KE-10 entity resolver) ──────────────────────────────

/**
 * Look up an entity by normalized name. Returns the entity ID if found.
 * Used by the entity resolver for exact-match (Pass 1).
 */
export async function findEntityByNormalizedName(
  cozo: CozoDb,
  normalizedName: string,
  projectId?: string,
): Promise<string | null> {
  const name = escCozo(normalizedName);
  const projectClause = projectId
    ? `, project_id = '${escCozo(projectId)}'`
    : "";

  const result = await cozo.run(
    `?[id] := *entity{id, state, lifecycle${projectClause}}, lifecycle != 'archived', n = get(state, 'normalizedName'), n = '${name}'`,
  );

  const rows = (result as { rows?: unknown[][] }).rows ?? [];
  return rows.length > 0 ? (rows[0][0] as string) : null;
}

/**
 * Look up an entity by alias. Returns the entity ID if found.
 * Used by the entity resolver for alias-match (Pass 2).
 */
export async function findEntityByAlias(
  cozo: CozoDb,
  alias: string,
): Promise<string | null> {
  const ea = escCozo(alias.toLowerCase().trim());

  const result = await cozo.run(
    `?[entity_id] := *entity_alias{entity_id, alias: '${ea}'}`,
  );

  const rows = (result as { rows?: unknown[][] }).rows ?? [];
  return rows.length > 0 ? (rows[0][0] as string) : null;
}

/**
 * Get all known entity normalized names for a project.
 * Used to pass existing entity hints to the LLM extraction prompt.
 */
export async function getAllEntityNames(
  cozo: CozoDb,
  projectId?: string,
): Promise<string[]> {
  const projectClause = projectId
    ? `, project_id = '${escCozo(projectId)}'`
    : "";

  const result = await cozo.run(
    `?[n] := *entity{id, state, lifecycle${projectClause}}, lifecycle != 'archived', n = get(state, 'name')`,
  );

  const rows = (result as { rows?: unknown[][] }).rows ?? [];
  return rows.map((r) => r[0] as string).filter(Boolean);
}

// ─── Utilities ──────────────────────────────────────────────────────────────

async function getExistingEmbedding(cozo: CozoDb, entityId: string): Promise<string | null> {
  try {
    const eid = escCozo(entityId);
    const result = await cozo.run(
      `?[embedding] := *entity{id: '${eid}', embedding}`,
    );
    const rows = (result as { rows?: unknown[][] }).rows ?? [];
    if (rows.length > 0 && rows[0][0] != null) {
      const emb = rows[0][0];
      if (Array.isArray(emb)) return JSON.stringify(emb);
    }
  } catch {
    // entity doesn't exist yet or other error
  }
  return null;
}

function deduplicateStrings(arr: string[]): string[] {
  return [...new Set(arr.filter((s) => s.trim().length > 0))];
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

// FILE: src/services/substrate/schema.ts
// CozoDB Datalog stored relation definitions for the unified knowledge graph.
// Schema v3: Merges old substrate entity/edge model with Layer 2.5 temporal
// knowledge extraction relations (fact, comprehension, metacognitive signals).
// Single source of truth for all CozoDB relation definitions.

import type { KnowledgeEntityType } from "../../schemas/knowledge.js";

// ─── Schema Version ────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 3;

// ─── Unified Type Exports ──────────────────────────────────────────────────
// These re-export the canonical types from knowledge.ts for any code that
// previously imported EntityType/RelationshipType from this file.

/**
 * Entity types — superset of knowledge entity types + structural types used by
 * substrate contributors (analyzers, entity-mapper, git linkers).
 * Knowledge types come from KnowledgeEntityTypeSchema; structural types are
 * used for work-units, decisions, features, commits, hotspots, diagnostics.
 */
export type EntityType =
  | KnowledgeEntityType
  | "work-unit"
  | "decision"
  | "feature"
  | "commit"
  | "hotspot"
  | "diagnostic";

/** Edge/relationship types — superset of fact predicates + structural relations. */
export type RelationshipType =
  // Fact predicates (from FactPredicateSchema — stored as CozoDB edges)
  | "USES"
  | "DEPENDS_ON"
  | "IMPLEMENTED_IN"
  | "DEPLOYED_ON"
  | "CONFIGURED_WITH"
  | "DECIDED"
  | "CHOSEN_OVER"
  | "REPLACED_BY"
  | "SWITCHED_FROM"
  | "ADOPTED"
  | "DEPRECATED"
  | "UNDERSTANDS"
  | "INVESTIGATED"
  | "DEBUGGED"
  | "REFACTORED"
  | "REVIEWED"
  | "TESTED"
  | "CREATED"
  | "DESIGNED"
  | "IMPLEMENTED"
  | "EXTENDED"
  | "RELATES_TO"
  | "CONFLICTS_WITH"
  | "ENABLES"
  | "BLOCKS"
  // Structural relations (substrate-engine graph connections)
  | "produced-by"
  | "targets"
  | "demonstrates"
  | "evidences"
  | "revises"
  | "accumulates-to"
  | "applies-to"
  | "learned-from"
  | "assessed-at"
  | "bottlenecked-by"
  | "narrated-by"
  | "part-of"
  | "co-occurred-with";

/** Entity lifecycle states — graph nodes transition through these. */
export type EntityLifecycle = "emerging" | "established" | "confirmed" | "decaying" | "archived";

// ─── Core Relations (Entity + Edge + Provenance) ───────────────────────────

export const ENTITY_SCHEMA = `:create entity {
  id: String,
  type: String,
  project_id: String,
  created_at: Float,
  last_updated: Float,
  confidence: Float default 0.5,
  lifecycle: String default 'emerging',
  => state: Json,
     embedding: [Float; 64] default null
}`;

export const ENTITY_SOURCE_SCHEMA = `:create entity_source {
  entity_id: String,
  analyzer: String,
  => last_contributed: Float,
     contribution_count: Int default 1
}`;

export const EDGE_SCHEMA = `:create edge {
  src: String,
  dst: String,
  type: String,
  => weight: Float default 1.0,
     created_at: Float,
     evidence: String default '',
     valid_from: Float,
     valid_to: Float default 9999999999.0
}`;

export const META_SCHEMA = `:create meta {
  key: String,
  => value: String
}`;

// ─── Knowledge Extraction Relations (Layer 2.5) ────────────────────────────

/** Bi-temporal atomic facts linking entities via typed predicates. */
export const FACT_SCHEMA = `:create fact {
  id: String =>
  subject_id: String,
  predicate: String,
  object_id: String default '',
  object_text: String default '',
  confidence: Float,
  explicit: Bool,
  temporal_hint: String default 'ongoing',
  context: String default '',
  valid_at: String,
  invalid_at: String default '',
  created_at: String,
  expired_at: String default '',
  source_episode: String,
  source_segment: String default '',
  extraction_method: String
}`;

/** 384-dimensional embeddings for semantic fact similarity + contradiction detection. */
export const FACT_EMBEDDING_SCHEMA = `:create fact_embedding {
  id: String =>
  vec: <F32; 384>
}`;

/** Entity alias deduplication — maps alternative names to canonical entity IDs. */
export const ENTITY_ALIAS_SCHEMA = `:create entity_alias {
  entity_id: String,
  alias: String =>
}`;

/** Per-episode comprehension assessment from LLM-as-Judge or heuristic proxy. */
export const COMPREHENSION_ASSESSMENT_SCHEMA = `:create comprehension_assessment {
  episode_id: String =>
  timestamp: String,
  steering: Float,
  understanding: Float,
  metacognition: Float,
  independence: Float,
  engagement: Float,
  overall_score: Float,
  rubber_stamp_count: Int,
  pushback_count: Int,
  assessment_method: String
}`;

/** Individual metacognitive signals detected in conversation turns. */
export const METACOGNITIVE_SIGNAL_SCHEMA = `:create metacognitive_signal {
  episode_id: String,
  turn_index: Int =>
  signal_type: String,
  quote: String,
  strength: Float
}`;

// ─── Indexes ───────────────────────────────────────────────────────────────

/** HNSW vector index on entity embeddings for semantic similarity search. */
export const ENTITY_VECTOR_INDEX = `::hnsw create entity:semantic_vec {
  dim: 64,
  ef: 50,
  fields: [embedding],
  filter: lifecycle != 'archived'
}`;

/** HNSW vector index on fact embeddings for contradiction detection. */
export const FACT_VECTOR_INDEX = `::hnsw create fact_embedding:fact_vec_idx {
  dim: 384,
  m: 16,
  ef_construction: 100,
  fields: [vec],
  distance: Cosine
}`;

// ─── Aggregated Exports ────────────────────────────────────────────────────

/** All CozoDB stored relation schemas — executed in order during initialization. */
export const ALL_COZO_SCHEMA = [
  ENTITY_SCHEMA,
  ENTITY_SOURCE_SCHEMA,
  EDGE_SCHEMA,
  FACT_SCHEMA,
  FACT_EMBEDDING_SCHEMA,
  ENTITY_ALIAS_SCHEMA,
  COMPREHENSION_ASSESSMENT_SCHEMA,
  METACOGNITIVE_SIGNAL_SCHEMA,
] as const;

/** All CozoDB HNSW indexes — executed after schema creation. */
export const ALL_COZO_INDEXES = [
  ENTITY_VECTOR_INDEX,
  FACT_VECTOR_INDEX,
] as const;

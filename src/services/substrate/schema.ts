// FILE: src/services/substrate/schema.ts
// CozoDB Datalog stored relation definitions for the intelligence graph.
// Core relations: entity (nodes), edge (relationships), entity_source (provenance).
// HNSW vector index on entity for semantic similarity search.

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

export const ENTITY_VECTOR_INDEX = `::hnsw create entity:semantic_vec {
  dim: 64,
  ef: 50,
  fields: [embedding],
  filter: lifecycle != 'archived'
}`;

export const META_SCHEMA = `:create meta {
  key: String,
  => value: String
}`;

export const SCHEMA_VERSION = 2;

export const ALL_COZO_SCHEMA = [ENTITY_SCHEMA, ENTITY_SOURCE_SCHEMA, EDGE_SCHEMA] as const;

export const ALL_COZO_INDEXES = [ENTITY_VECTOR_INDEX] as const;

export type EntityType =
  | "work-unit"
  | "decision"
  | "feature"
  | "pattern"
  | "capability"
  | "diagnostic"
  | "maturity-assessment"
  | "commit"
  | "hotspot";

export type RelationshipType =
  | "produced-by"
  | "targets"
  | "demonstrates"
  | "evidences"
  | "revises"
  | "accumulates-to"
  | "depends-on"
  | "applies-to"
  | "learned-from"
  | "assessed-at"
  | "bottlenecked-by"
  | "narrated-by"
  | "part-of"
  | "co-occurred-with";

export type EntityLifecycle = "emerging" | "established" | "confirmed" | "decaying" | "archived";

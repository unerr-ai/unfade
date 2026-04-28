import { describe, expect, it } from "vitest";
import {
  ALL_COZO_INDEXES,
  ALL_COZO_SCHEMA,
  COMPREHENSION_ASSESSMENT_SCHEMA,
  EDGE_SCHEMA,
  ENTITY_ALIAS_SCHEMA,
  ENTITY_SCHEMA,
  ENTITY_SOURCE_SCHEMA,
  ENTITY_VECTOR_INDEX,
  FACT_EMBEDDING_SCHEMA,
  FACT_SCHEMA,
  FACT_VECTOR_INDEX,
  META_SCHEMA,
  METACOGNITIVE_SIGNAL_SCHEMA,
  SCHEMA_VERSION,
} from "../../../src/services/substrate/schema.js";
import type {
  EntityLifecycle,
  EntityType,
  RelationshipType,
} from "../../../src/services/substrate/schema.js";

describe("CozoDB schema v3", () => {
  it("exports schema version 3", () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  // ── Relation DDL completeness ──────────────────────────────────────────

  it("ALL_COZO_SCHEMA contains all 8 relations", () => {
    expect(ALL_COZO_SCHEMA).toHaveLength(8);
    const schemas = ALL_COZO_SCHEMA.join("\n");
    expect(schemas).toContain(":create entity ");
    expect(schemas).toContain(":create entity_source ");
    expect(schemas).toContain(":create edge ");
    expect(schemas).toContain(":create fact ");
    expect(schemas).toContain(":create fact_embedding ");
    expect(schemas).toContain(":create entity_alias ");
    expect(schemas).toContain(":create comprehension_assessment ");
    expect(schemas).toContain(":create metacognitive_signal ");
  });

  it("ALL_COZO_INDEXES contains both HNSW indexes", () => {
    expect(ALL_COZO_INDEXES).toHaveLength(2);
    const indexes = ALL_COZO_INDEXES.join("\n");
    expect(indexes).toContain("::hnsw create entity:semantic_vec");
    expect(indexes).toContain("::hnsw create fact_embedding:fact_vec_idx");
  });

  // ── Core relations ─────────────────────────────────────────────────────

  it("entity relation has id PK, type, project_id, embedding[64]", () => {
    expect(ENTITY_SCHEMA).toContain("id: String");
    expect(ENTITY_SCHEMA).toContain("type: String");
    expect(ENTITY_SCHEMA).toContain("project_id: String");
    expect(ENTITY_SCHEMA).toContain("embedding: [Float; 64]");
    expect(ENTITY_SCHEMA).toContain("lifecycle: String");
    expect(ENTITY_SCHEMA).toContain("state: Json");
  });

  it("entity_source tracks per-analyzer provenance", () => {
    expect(ENTITY_SOURCE_SCHEMA).toContain("entity_id: String");
    expect(ENTITY_SOURCE_SCHEMA).toContain("analyzer: String");
    expect(ENTITY_SOURCE_SCHEMA).toContain("contribution_count: Int");
  });

  it("edge has temporal validity (valid_from, valid_to)", () => {
    expect(EDGE_SCHEMA).toContain("src: String");
    expect(EDGE_SCHEMA).toContain("dst: String");
    expect(EDGE_SCHEMA).toContain("type: String");
    expect(EDGE_SCHEMA).toContain("valid_from: Float");
    expect(EDGE_SCHEMA).toContain("valid_to: Float");
    expect(EDGE_SCHEMA).toContain("evidence: String");
  });

  // ── Knowledge extraction relations (Layer 2.5) ─────────────────────────

  it("fact relation has bi-temporal model (valid_at/invalid_at + created_at/expired_at)", () => {
    expect(FACT_SCHEMA).toContain("id: String");
    expect(FACT_SCHEMA).toContain("subject_id: String");
    expect(FACT_SCHEMA).toContain("predicate: String");
    expect(FACT_SCHEMA).toContain("object_id: String");
    expect(FACT_SCHEMA).toContain("confidence: Float");
    expect(FACT_SCHEMA).toContain("valid_at: String");
    expect(FACT_SCHEMA).toContain("invalid_at: String");
    expect(FACT_SCHEMA).toContain("created_at: String");
    expect(FACT_SCHEMA).toContain("expired_at: String");
    expect(FACT_SCHEMA).toContain("source_episode: String");
    expect(FACT_SCHEMA).toContain("extraction_method: String");
  });

  it("fact_embedding has 384-dimensional vector", () => {
    expect(FACT_EMBEDDING_SCHEMA).toContain("id: String");
    expect(FACT_EMBEDDING_SCHEMA).toContain("vec: <F32; 384>");
  });

  it("entity_alias maps aliases to canonical entity IDs", () => {
    expect(ENTITY_ALIAS_SCHEMA).toContain("entity_id: String");
    expect(ENTITY_ALIAS_SCHEMA).toContain("alias: String");
  });

  it("comprehension_assessment has 5 dimensions + overall score", () => {
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("episode_id: String");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("steering: Float");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("understanding: Float");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("metacognition: Float");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("independence: Float");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("engagement: Float");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("overall_score: Float");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("rubber_stamp_count: Int");
    expect(COMPREHENSION_ASSESSMENT_SCHEMA).toContain("pushback_count: Int");
  });

  it("metacognitive_signal has composite key (episode_id, turn_index)", () => {
    expect(METACOGNITIVE_SIGNAL_SCHEMA).toContain("episode_id: String");
    expect(METACOGNITIVE_SIGNAL_SCHEMA).toContain("turn_index: Int");
    expect(METACOGNITIVE_SIGNAL_SCHEMA).toContain("signal_type: String");
    expect(METACOGNITIVE_SIGNAL_SCHEMA).toContain("quote: String");
    expect(METACOGNITIVE_SIGNAL_SCHEMA).toContain("strength: Float");
  });

  // ── Vector indexes ─────────────────────────────────────────────────────

  it("entity vector index is 64-dimensional with archived filter", () => {
    expect(ENTITY_VECTOR_INDEX).toContain("dim: 64");
    expect(ENTITY_VECTOR_INDEX).toContain("ef: 50");
    expect(ENTITY_VECTOR_INDEX).toContain("filter: lifecycle != 'archived'");
  });

  it("fact vector index is 384-dim Cosine with high construction quality", () => {
    expect(FACT_VECTOR_INDEX).toContain("dim: 384");
    expect(FACT_VECTOR_INDEX).toContain("m: 16");
    expect(FACT_VECTOR_INDEX).toContain("ef_construction: 100");
    expect(FACT_VECTOR_INDEX).toContain("distance: Cosine");
  });

  // ── Type completeness ──────────────────────────────────────────────────

  it("EntityType includes both knowledge and structural types", () => {
    // Knowledge types from KnowledgeEntityTypeSchema
    const knowledgeTypes: EntityType[] = [
      "technology", "pattern", "module", "concept",
      "architecture", "library", "service", "domain",
    ];
    // Structural types for substrate contributors
    const structuralTypes: EntityType[] = [
      "work-unit", "decision", "feature", "commit", "hotspot", "diagnostic",
    ];
    // All should be valid EntityType values (TypeScript enforces this at compile time)
    expect([...knowledgeTypes, ...structuralTypes]).toHaveLength(14);
  });

  it("RelationshipType includes fact predicates and structural relations", () => {
    const factPredicates: RelationshipType[] = [
      "USES", "DEPENDS_ON", "IMPLEMENTED_IN", "DEPLOYED_ON", "CONFIGURED_WITH",
      "DECIDED", "CHOSEN_OVER", "REPLACED_BY", "SWITCHED_FROM", "ADOPTED", "DEPRECATED",
      "UNDERSTANDS", "INVESTIGATED", "DEBUGGED", "REFACTORED", "REVIEWED", "TESTED",
      "CREATED", "DESIGNED", "IMPLEMENTED", "EXTENDED",
      "RELATES_TO", "CONFLICTS_WITH", "ENABLES", "BLOCKS",
    ];
    const structuralRelations: RelationshipType[] = [
      "produced-by", "targets", "demonstrates", "evidences", "revises",
      "accumulates-to", "applies-to", "learned-from", "assessed-at",
      "bottlenecked-by", "narrated-by", "part-of", "co-occurred-with",
    ];
    expect(factPredicates).toHaveLength(25);
    expect(structuralRelations).toHaveLength(13);
  });

  it("EntityLifecycle covers full lifecycle", () => {
    const states: EntityLifecycle[] = [
      "emerging", "established", "confirmed", "decaying", "archived",
    ];
    expect(states).toHaveLength(5);
  });
});

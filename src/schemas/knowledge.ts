// FILE: src/schemas/knowledge.ts
// Layer 2.5 — Temporal Knowledge Extraction schemas.
// Defines all data contracts for the extraction pipeline: entities, facts,
// comprehension assessment, metacognitive signals, contradiction detection,
// and the combined ExtractionResult returned by each LLM call.

import { z } from "zod";

// ─── Enums & Controlled Vocabularies ────────────────────────────────────────

/** Entity types for knowledge graph nodes — what kind of thing was mentioned. */
export const KnowledgeEntityTypeSchema = z.enum([
  "technology",
  "pattern",
  "module",
  "concept",
  "architecture",
  "library",
  "service",
  "domain",
]);
export type KnowledgeEntityType = z.infer<typeof KnowledgeEntityTypeSchema>;

/** Controlled vocabulary of fact predicates (~25 across 5 categories). */
export const FactPredicateSchema = z.enum([
  // Architectural
  "USES",
  "DEPENDS_ON",
  "IMPLEMENTED_IN",
  "DEPLOYED_ON",
  "CONFIGURED_WITH",
  // Decision
  "DECIDED",
  "CHOSEN_OVER",
  "REPLACED_BY",
  "SWITCHED_FROM",
  "ADOPTED",
  "DEPRECATED",
  // Comprehension
  "UNDERSTANDS",
  "INVESTIGATED",
  "DEBUGGED",
  "REFACTORED",
  "REVIEWED",
  "TESTED",
  // Creation
  "CREATED",
  "DESIGNED",
  "IMPLEMENTED",
  "EXTENDED",
  // Relationship
  "RELATES_TO",
  "CONFLICTS_WITH",
  "ENABLES",
  "BLOCKS",
]);
export type FactPredicate = z.infer<typeof FactPredicateSchema>;

/** 7 metacognitive signal types — indicators of thinking-about-thinking. */
export const MetacognitiveSignalTypeSchema = z.enum([
  "why-question",
  "constraint",
  "alternative",
  "error-catch",
  "strategy-reflect",
  "pushback",
  "knowledge-transfer",
]);
export type MetacognitiveSignalType = z.infer<typeof MetacognitiveSignalTypeSchema>;

/** How a conversation segment was segmented. */
export const SegmentMethodSchema = z.enum(["structural", "embedding", "single"]);
export type SegmentMethod = z.infer<typeof SegmentMethodSchema>;

/** Temporal hint on a fact — how it relates to time. */
export const TemporalHintSchema = z.enum(["ongoing", "point-in-time", "supersedes_previous"]);
export type TemporalHint = z.infer<typeof TemporalHintSchema>;

/** How the fact was extracted. */
export const ExtractionMethodSchema = z.enum(["llm", "heuristic", "explicit-statement"]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

/** Contradiction classification between two facts. */
export const ContradictionClassificationSchema = z.enum([
  "CONSISTENT",
  "MORE_SPECIFIC",
  "CONTRADICTORY",
  "SUPERSEDES",
  "UNRELATED",
]);
export type ContradictionClassification = z.infer<typeof ContradictionClassificationSchema>;

/** Per-segment agency classification — who drove the interaction. */
export const AgencyClassificationSchema = z.enum([
  "developer-directed",
  "developer-accepted",
  "developer-rubber-stamped",
  "collaborative",
]);
export type AgencyClassification = z.infer<typeof AgencyClassificationSchema>;

/** Sustainability signal — does this interaction build or erode capability. */
export const SustainabilityDirectionSchema = z.enum([
  "builds-capability",
  "erodes-capability",
  "neutral",
]);
export type SustainabilityDirection = z.infer<typeof SustainabilityDirectionSchema>;

/** Comprehension assessment method. */
export const AssessmentMethodSchema = z.enum(["llm", "heuristic-proxy"]);
export type AssessmentMethod = z.infer<typeof AssessmentMethodSchema>;

// ─── Core Schemas ───────────────────────────────────────────────────────────

/** A topic segment within a conversation — groups turns by subject matter. */
export const ConversationSegmentSchema = z.object({
  segmentId: z.string().describe("episode_id + segment index"),
  episodeId: z.string().describe("Source conversation event ID"),
  turnRange: z.tuple([z.number().int().min(0), z.number().int().min(0)])
    .describe("Inclusive turn indices [start, end]"),
  topicLabel: z.string().describe("LLM-generated or heuristic topic label"),
  summary: z.string().describe("What was discussed in this segment — used for distill narratives, MCP context, and search"),
  filesInScope: z.array(z.string()).describe("Files referenced/modified in this segment"),
  modulesInScope: z.array(z.string()).describe("Directory-level module classification"),
  segmentMethod: SegmentMethodSchema,
});
export type ConversationSegment = z.infer<typeof ConversationSegmentSchema>;

/** An entity extracted from a conversation segment — a node in the knowledge graph. */
export const ExtractedEntitySchema = z.object({
  name: z.string().describe("Canonical display name (e.g. 'Redis')"),
  normalizedName: z.string().describe("Lowercase matching key (e.g. 'redis')"),
  type: KnowledgeEntityTypeSchema,
  context: z.string().describe("How this entity appears in the conversation — role, usage, significance"),
  confidence: z.number().min(0).max(1).describe("0.0–1.0: mentioned in passing (0.3) to deeply discussed (0.9)"),
  aliases: z.array(z.string()).describe("Alternative names detected (e.g. ['hooks', 'useEffect'])"),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

/** An atomic fact — a single proposition linking two entities via a typed predicate. */
export const AtomicFactSchema = z.object({
  subject: z.string().describe("Entity name (must be from the extracted entity list)"),
  predicate: FactPredicateSchema,
  object: z.string().describe("Entity name or free-text value for non-entity objects"),
  confidence: z.number().min(0).max(1),
  explicit: z.boolean().describe("Was this stated directly or inferred from context"),
  temporalHint: TemporalHintSchema,
  context: z.string().describe("Source quote or evidence from the conversation that supports this fact"),
});
export type AtomicFact = z.infer<typeof AtomicFactSchema>;

/** A persisted fact with full bi-temporal model and provenance — stored in CozoDB/JSONL. */
export const PersistedFactSchema = AtomicFactSchema.extend({
  id: z.string().uuid(),
  subjectId: z.string().describe("Resolved entity ID"),
  objectId: z.string().nullable().describe("Resolved entity ID, or null for free-text objects"),
  objectText: z.string().nullable().describe("Free-text when object isn't an entity"),
  validAt: z.string().datetime().describe("When this fact became true"),
  invalidAt: z.string().datetime().nullable().describe("When superseded (null = still valid)"),
  createdAt: z.string().datetime().describe("When we extracted it (transaction time)"),
  expiredAt: z.string().datetime().nullable().describe("When we learned it was superseded"),
  sourceEpisode: z.string().describe("Source event ID"),
  sourceSegment: z.string().nullable().describe("Segment ID within episode"),
  extractionMethod: ExtractionMethodSchema,
});
export type PersistedFact = z.infer<typeof PersistedFactSchema>;

/** The 5 comprehension dimensions, each scored 0–10. */
export const ComprehensionDimensionsSchema = z.object({
  steering: z.number().min(0).max(10).describe("Agency: did the developer direct the AI or follow passively"),
  understanding: z.number().min(0).max(10).describe("Depth: did the developer demonstrate understanding"),
  metacognition: z.number().min(0).max(10).describe("Reflection: did the developer think about their thinking"),
  independence: z.number().min(0).max(10).describe("Capability: could the developer have done this without AI"),
  engagement: z.number().min(0).max(10).describe("Depth of interaction: single-turn vs deep exploration"),
});
export type ComprehensionDimensions = z.infer<typeof ComprehensionDimensionsSchema>;

/** Fixed weights for the 5 comprehension dimensions — used to compute overallScore. */
export const COMPREHENSION_WEIGHTS = {
  steering: 0.25,
  understanding: 0.30,
  metacognition: 0.20,
  independence: 0.15,
  engagement: 0.10,
} as const;

/** Rubric-based comprehension assessment for an entire conversation. */
export const ComprehensionAssessmentSchema = z.object({
  episodeId: z.string(),
  timestamp: z.string().datetime(),
  dimensions: ComprehensionDimensionsSchema,
  overallScore: z.number().min(0).max(100).describe("Weighted composite across all 5 dimensions"),
  evidence: z.array(z.string()).describe("Specific quotes/moments supporting the scores"),
  rubberStampCount: z.number().int().min(0).describe("AI suggestions accepted without modification"),
  pushbackCount: z.number().int().min(0).describe("Times developer questioned or modified AI output"),
  domainTags: z.array(z.string()).describe("Domains the developer engaged with"),
  assessmentMethod: AssessmentMethodSchema,
});
export type ComprehensionAssessment = z.infer<typeof ComprehensionAssessmentSchema>;

/** A single metacognitive signal detected in a conversation turn. */
export const MetacognitiveSignalSchema = z.object({
  turnIndex: z.number().int().min(0),
  signalType: MetacognitiveSignalTypeSchema,
  quote: z.string().describe("The specific text demonstrating metacognition"),
  strength: z.number().min(0).max(1).describe("How clearly it demonstrates metacognition"),
});
export type MetacognitiveSignal = z.infer<typeof MetacognitiveSignalSchema>;

/** Contradiction detection result — classifies the relationship between two facts. */
export const ContradictionResultSchema = z.object({
  existingFactId: z.string().describe("ID of the existing fact being compared"),
  newFactId: z.string().describe("ID of the new fact that triggered detection"),
  classification: ContradictionClassificationSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().describe("LLM explanation of the classification"),
});
export type ContradictionResult = z.infer<typeof ContradictionResultSchema>;

/** Sustainability signal — does this interaction build or erode the developer's capability. */
export const SustainabilitySignalSchema = z.object({
  direction: SustainabilityDirectionSchema,
  reasoning: z.string().describe("Why this interaction builds or erodes capability"),
  evidence: z.array(z.string()).describe("Specific moments/quotes that support the sustainability judgment"),
});
export type SustainabilitySignal = z.infer<typeof SustainabilitySignalSchema>;

/** A reasoning chain extracted from a conversation — trade-offs and decision rationale. */
export const ReasoningChainSchema = z.object({
  decision: z.string().describe("What was decided"),
  alternatives: z.array(z.string()).describe("What alternatives were considered"),
  rationale: z.string().describe("Why this option was chosen"),
  tradeOffs: z.array(z.string()).describe("What trade-offs were accepted"),
  context: z.string().describe("Source conversation text or commit message that contains this reasoning"),
});
export type ReasoningChain = z.infer<typeof ReasoningChainSchema>;

/** Per-segment agency classification with reasoning. */
export const SegmentAgencySchema = z.object({
  segmentId: z.string(),
  classification: AgencyClassificationSchema,
  reasoning: z.string().describe("Why this classification — what the developer did or didn't do that determined agency"),
});
export type SegmentAgency = z.infer<typeof SegmentAgencySchema>;

/**
 * Compute the 0–100 overall comprehension score from individual 0–10 dimensions.
 * Deterministic weighted average — used by both LLM and heuristic extraction paths.
 */
export function computeOverallScore(dims: ComprehensionDimensions): number {
  const weighted =
    dims.steering * COMPREHENSION_WEIGHTS.steering +
    dims.understanding * COMPREHENSION_WEIGHTS.understanding +
    dims.metacognition * COMPREHENSION_WEIGHTS.metacognition +
    dims.independence * COMPREHENSION_WEIGHTS.independence +
    dims.engagement * COMPREHENSION_WEIGHTS.engagement;
  return Math.round(weighted * 10);
}

// ─── Combined Extraction Result ─────────────────────────────────────────────

/**
 * The combined output of one LLM extraction call.
 * Every captured event yields one ExtractionResult. For events with no
 * extractable intelligence, all arrays are empty and comprehension is null.
 */
export const ExtractionResultSchema = z.object({
  episodeId: z.string().describe("The source event ID that was extracted"),
  segments: z.array(ConversationSegmentSchema).describe("Topic segments (empty for non-conversation events)"),
  entities: z.array(ExtractedEntitySchema),
  facts: z.array(AtomicFactSchema),
  comprehension: ComprehensionAssessmentSchema.nullable()
    .describe("Null for non-conversation events (git commits, terminal commands)"),
  metacognitiveSignals: z.array(MetacognitiveSignalSchema)
    .describe("Empty for non-conversation events"),
  agencyClassification: z.array(SegmentAgencySchema)
    .describe("Per-segment agency classification"),
  sustainabilitySignal: SustainabilitySignalSchema.nullable()
    .describe("Null for non-conversation events"),
  reasoningChains: z.array(ReasoningChainSchema),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

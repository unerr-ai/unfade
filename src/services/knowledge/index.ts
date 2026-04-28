// FILE: src/services/knowledge/index.ts
// Layer 2.5 KE-17.2: Public API barrel export.
// Single entry point for all knowledge extraction functionality.

export { extractKnowledge, loadCaptureEventsForExtraction } from "./extractor.js";
export type { KnowledgeExtractionConfig, KnowledgeExtractionResult } from "./extractor.js";

export { computeDecay, computeRetrievability, computeStabilityUpdate, computeDecayedScore } from "./decay-engine.js";
export type { DecayResult } from "./decay-engine.js";

export { computeDailyComprehensionScore, mannKendallTrend } from "./comprehension-aggregator.js";
export type { DailyComprehensionResult } from "./comprehension-aggregator.js";

export { detectContradictions, findContradictionCandidates, classifyContradictionBatch } from "./contradiction-detector.js";
export type { ContradictionCandidate, ContradictionDetectionResult } from "./contradiction-detector.js";

export { loadEmbeddingModel, createEntityEmbedFn, createFactEmbedFn, cosineSimilarity } from "./embedding.js";
export type { EmbeddingModel } from "./embedding.js";

export { writeComprehensionAssessment, writeMetacognitiveSignals } from "./comprehension-writer.js";
export type { MetacognitiveAggregates } from "./comprehension-writer.js";

export { writeFactsToGraph, invalidateFact, getValidFactsForSubject } from "./fact-writer-graph.js";
export type { FactWriteContext, FactWriteResult } from "./fact-writer-graph.js";

export { resolveEntities } from "./entity-resolver.js";
export type { ResolvedEntity } from "./entity-resolver.js";

export { writeEntitiesToGraph, findEntityByNormalizedName, findEntityByAlias, getAllEntityNames } from "./entity-writer.js";
export type { WriteResult } from "./entity-writer.js";

export { normalizeEntityName, isAlias, computeLevenshteinDistance } from "./entity-normalizer.js";

export { parseConversationTurns, extractUserTurns, extractAssistantTurns, estimateTokenCount } from "./turn-parser.js";

export { segmentConversation } from "./segmenter.js";

export { extractFromEvent, extractBatch } from "./llm-extractor.js";
export type { ExtractionConfig, BatchEventInput } from "./llm-extractor.js";

export { extractHeuristicComprehension } from "./heuristic-extractor.js";

export { getUnextractedEvents, markExtracted, markFailed, markDeferred, getExtractionStats, resetFailedEvents } from "./extraction-tracker.js";

export { inferDomainComplexity, inferAllDomainComplexities } from "./domain-complexity.js";

export { appendFact, appendFacts, readAllFacts, countFacts } from "./fact-writer.js";

// Layer 2.5 knowledge extraction schema tests
import { describe, expect, it } from "vitest";
import {
  AgencyClassificationSchema,
  AtomicFactSchema,
  ComprehensionAssessmentSchema,
  ComprehensionDimensionsSchema,
  COMPREHENSION_WEIGHTS,
  ContradictionClassificationSchema,
  ContradictionResultSchema,
  ConversationSegmentSchema,
  ExtractionMethodSchema,
  ExtractionResultSchema,
  ExtractedEntitySchema,
  FactPredicateSchema,
  KnowledgeEntityTypeSchema,
  MetacognitiveSignalSchema,
  MetacognitiveSignalTypeSchema,
  PersistedFactSchema,
  ReasoningChainSchema,
  SegmentAgencySchema,
  SegmentMethodSchema,
  SustainabilityDirectionSchema,
  SustainabilitySignalSchema,
  TemporalHintSchema,
} from "../../src/schemas/knowledge.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const validSegment = {
  segmentId: "evt-123_0",
  episodeId: "evt-123",
  turnRange: [0, 15] as [number, number],
  topicLabel: "Auth middleware refactoring",
  summary: "Discussed replacing session-based auth with JWT tokens. Developer directed approach, rejected AI suggestion to use OAuth and instead chose stateless JWT with refresh token rotation. Covered middleware changes, token validation utility, and error handling.",
  filesInScope: ["src/middleware/auth.ts", "src/utils/jwt.ts"],
  modulesInScope: ["src/middleware", "src/utils"],
  segmentMethod: "structural" as const,
};

const validEntity = {
  name: "Redis",
  normalizedName: "redis",
  type: "technology" as const,
  context: "Used as the primary caching layer for session tokens",
  confidence: 0.85,
  aliases: ["redis-cache", "Redis server"],
};

const validFact = {
  subject: "project",
  predicate: "USES" as const,
  object: "Redis",
  confidence: 0.9,
  explicit: true,
  temporalHint: "ongoing" as const,
  context: "Developer stated 'We use Redis for caching session tokens' during the auth discussion",
};

const validComprehension = {
  episodeId: "evt-123",
  timestamp: "2026-04-28T10:00:00Z",
  dimensions: {
    steering: 8,
    understanding: 7,
    metacognition: 6,
    independence: 5,
    engagement: 9,
  },
  overallScore: 72,
  evidence: ["Developer explicitly rejected auth approach", "Asked why map over set"],
  rubberStampCount: 2,
  pushbackCount: 5,
  domainTags: ["authentication", "caching"],
  assessmentMethod: "llm" as const,
};

const validMetacognitiveSignal = {
  turnIndex: 4,
  signalType: "why-question" as const,
  quote: "Why did you use a map here instead of a set?",
  strength: 0.85,
};

const validContradiction = {
  existingFactId: "fact-001",
  newFactId: "fact-002",
  classification: "SUPERSEDES" as const,
  confidence: 0.92,
  reasoning: "New fact explicitly states Redis was replaced by DuckDB for caching",
};

const validExtractionResult = {
  episodeId: "evt-123",
  segments: [validSegment],
  entities: [validEntity],
  facts: [validFact],
  comprehension: validComprehension,
  metacognitiveSignals: [validMetacognitiveSignal],
  agencyClassification: [{ segmentId: "evt-123_0", classification: "developer-directed" as const, reasoning: "Developer rejected two AI suggestions and specified exact JWT validation approach" }],
  sustainabilitySignal: { direction: "builds-capability" as const, reasoning: "Developer demonstrated deep understanding by catching edge cases the AI missed", evidence: ["Developer identified token expiry race condition at turn 8", "Proactively asked about refresh token rotation"] },
  reasoningChains: [{
    decision: "Use JWT over session cookies",
    alternatives: ["session cookies", "OAuth tokens"],
    rationale: "Stateless auth scales better for microservices",
    tradeOffs: ["No server-side revocation without a blocklist"],
    context: "Developer said 'Let's go with JWT — session cookies won't scale once we split into microservices. We'll need a blocklist for revocation but that's a fair trade-off.'",
  }],
};

// ─── Enum Tests ─────────────────────────────────────────────────────────────

describe("KnowledgeEntityTypeSchema", () => {
  it("accepts all 8 entity types", () => {
    for (const t of ["technology", "pattern", "module", "concept", "architecture", "library", "service", "domain"]) {
      expect(KnowledgeEntityTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects invalid type", () => {
    expect(KnowledgeEntityTypeSchema.safeParse("person").success).toBe(false);
  });
});

describe("FactPredicateSchema", () => {
  it("accepts all 25 predicates", () => {
    const predicates = [
      "USES", "DEPENDS_ON", "IMPLEMENTED_IN", "DEPLOYED_ON", "CONFIGURED_WITH",
      "DECIDED", "CHOSEN_OVER", "REPLACED_BY", "SWITCHED_FROM", "ADOPTED", "DEPRECATED",
      "UNDERSTANDS", "INVESTIGATED", "DEBUGGED", "REFACTORED", "REVIEWED", "TESTED",
      "CREATED", "DESIGNED", "IMPLEMENTED", "EXTENDED",
      "RELATES_TO", "CONFLICTS_WITH", "ENABLES", "BLOCKS",
    ];
    expect(predicates).toHaveLength(25);
    for (const p of predicates) {
      expect(FactPredicateSchema.safeParse(p).success).toBe(true);
    }
  });

  it("rejects unknown predicate", () => {
    expect(FactPredicateSchema.safeParse("LIKES").success).toBe(false);
  });
});

describe("MetacognitiveSignalTypeSchema", () => {
  it("accepts all 7 signal types", () => {
    for (const s of ["why-question", "constraint", "alternative", "error-catch", "strategy-reflect", "pushback", "knowledge-transfer"]) {
      expect(MetacognitiveSignalTypeSchema.safeParse(s).success).toBe(true);
    }
  });
});

describe("ContradictionClassificationSchema", () => {
  it("accepts all 5 classifications", () => {
    for (const c of ["CONSISTENT", "MORE_SPECIFIC", "CONTRADICTORY", "SUPERSEDES", "UNRELATED"]) {
      expect(ContradictionClassificationSchema.safeParse(c).success).toBe(true);
    }
  });
});

describe("AgencyClassificationSchema", () => {
  it("accepts all 4 agency types", () => {
    for (const a of ["developer-directed", "developer-accepted", "developer-rubber-stamped", "collaborative"]) {
      expect(AgencyClassificationSchema.safeParse(a).success).toBe(true);
    }
  });
});

// ─── Core Schema Tests ──────────────────────────────────────────────────────

describe("ConversationSegmentSchema", () => {
  it("parses valid segment", () => {
    const result = ConversationSegmentSchema.safeParse(validSegment);
    expect(result.success).toBe(true);
  });

  it("rejects negative turn indices", () => {
    const result = ConversationSegmentSchema.safeParse({ ...validSegment, turnRange: [-1, 5] });
    expect(result.success).toBe(false);
  });

  it("rejects missing topicLabel", () => {
    const { topicLabel: _, ...rest } = validSegment;
    expect(ConversationSegmentSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts empty filesInScope", () => {
    const result = ConversationSegmentSchema.safeParse({ ...validSegment, filesInScope: [] });
    expect(result.success).toBe(true);
  });

  it("rejects invalid segmentMethod", () => {
    expect(ConversationSegmentSchema.safeParse({ ...validSegment, segmentMethod: "neural" }).success).toBe(false);
  });
});

describe("ExtractedEntitySchema", () => {
  it("parses valid entity", () => {
    expect(ExtractedEntitySchema.safeParse(validEntity).success).toBe(true);
  });

  it("rejects confidence > 1", () => {
    expect(ExtractedEntitySchema.safeParse({ ...validEntity, confidence: 1.5 }).success).toBe(false);
  });

  it("rejects confidence < 0", () => {
    expect(ExtractedEntitySchema.safeParse({ ...validEntity, confidence: -0.1 }).success).toBe(false);
  });

  it("accepts confidence at boundaries", () => {
    expect(ExtractedEntitySchema.safeParse({ ...validEntity, confidence: 0 }).success).toBe(true);
    expect(ExtractedEntitySchema.safeParse({ ...validEntity, confidence: 1 }).success).toBe(true);
  });

  it("accepts empty aliases", () => {
    expect(ExtractedEntitySchema.safeParse({ ...validEntity, aliases: [] }).success).toBe(true);
  });
});

describe("AtomicFactSchema", () => {
  it("parses valid fact", () => {
    expect(AtomicFactSchema.safeParse(validFact).success).toBe(true);
  });

  it("rejects invalid predicate", () => {
    expect(AtomicFactSchema.safeParse({ ...validFact, predicate: "LIKES" }).success).toBe(false);
  });

  it("rejects missing explicit field", () => {
    const { explicit: _, ...rest } = validFact;
    expect(AtomicFactSchema.safeParse(rest).success).toBe(false);
  });
});

describe("PersistedFactSchema", () => {
  it("parses valid persisted fact with full bi-temporal model", () => {
    const persisted = {
      ...validFact,
      id: "550e8400-e29b-41d4-a716-446655440000",
      subjectId: "entity-001",
      objectId: "entity-002",
      objectText: null,
      validAt: "2026-04-20T10:00:00Z",
      invalidAt: null,
      createdAt: "2026-04-28T10:00:00Z",
      expiredAt: null,
      sourceEpisode: "evt-123",
      sourceSegment: "evt-123_0",
      extractionMethod: "llm" as const,
    };
    expect(PersistedFactSchema.safeParse(persisted).success).toBe(true);
  });

  it("accepts non-null invalidAt for superseded facts", () => {
    const persisted = {
      ...validFact,
      id: "550e8400-e29b-41d4-a716-446655440000",
      subjectId: "entity-001",
      objectId: null,
      objectText: "session cookies",
      validAt: "2026-04-01T00:00:00Z",
      invalidAt: "2026-04-13T00:00:00Z",
      createdAt: "2026-04-01T10:00:00Z",
      expiredAt: "2026-04-20T10:00:00Z",
      sourceEpisode: "evt-100",
      sourceSegment: null,
      extractionMethod: "llm" as const,
    };
    expect(PersistedFactSchema.safeParse(persisted).success).toBe(true);
  });
});

describe("ComprehensionDimensionsSchema", () => {
  it("parses valid dimensions", () => {
    expect(ComprehensionDimensionsSchema.safeParse(validComprehension.dimensions).success).toBe(true);
  });

  it("rejects dimension > 10", () => {
    expect(ComprehensionDimensionsSchema.safeParse({ ...validComprehension.dimensions, steering: 11 }).success).toBe(false);
  });

  it("rejects dimension < 0", () => {
    expect(ComprehensionDimensionsSchema.safeParse({ ...validComprehension.dimensions, understanding: -1 }).success).toBe(false);
  });

  it("accepts boundary values 0 and 10", () => {
    const zeroed = { steering: 0, understanding: 0, metacognition: 0, independence: 0, engagement: 0 };
    const maxed = { steering: 10, understanding: 10, metacognition: 10, independence: 10, engagement: 10 };
    expect(ComprehensionDimensionsSchema.safeParse(zeroed).success).toBe(true);
    expect(ComprehensionDimensionsSchema.safeParse(maxed).success).toBe(true);
  });
});

describe("COMPREHENSION_WEIGHTS", () => {
  it("weights sum to 1.0", () => {
    const sum = COMPREHENSION_WEIGHTS.steering + COMPREHENSION_WEIGHTS.understanding
      + COMPREHENSION_WEIGHTS.metacognition + COMPREHENSION_WEIGHTS.independence
      + COMPREHENSION_WEIGHTS.engagement;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe("ComprehensionAssessmentSchema", () => {
  it("parses valid assessment", () => {
    expect(ComprehensionAssessmentSchema.safeParse(validComprehension).success).toBe(true);
  });

  it("rejects overallScore > 100", () => {
    expect(ComprehensionAssessmentSchema.safeParse({ ...validComprehension, overallScore: 101 }).success).toBe(false);
  });

  it("rejects negative rubberStampCount", () => {
    expect(ComprehensionAssessmentSchema.safeParse({ ...validComprehension, rubberStampCount: -1 }).success).toBe(false);
  });

  it("accepts heuristic-proxy method", () => {
    expect(ComprehensionAssessmentSchema.safeParse({ ...validComprehension, assessmentMethod: "heuristic-proxy" }).success).toBe(true);
  });
});

describe("MetacognitiveSignalSchema", () => {
  it("parses valid signal", () => {
    expect(MetacognitiveSignalSchema.safeParse(validMetacognitiveSignal).success).toBe(true);
  });

  it("rejects strength > 1", () => {
    expect(MetacognitiveSignalSchema.safeParse({ ...validMetacognitiveSignal, strength: 1.1 }).success).toBe(false);
  });

  it("rejects non-integer turnIndex", () => {
    expect(MetacognitiveSignalSchema.safeParse({ ...validMetacognitiveSignal, turnIndex: 4.5 }).success).toBe(false);
  });
});

describe("ContradictionResultSchema", () => {
  it("parses valid contradiction", () => {
    expect(ContradictionResultSchema.safeParse(validContradiction).success).toBe(true);
  });

  it("rejects invalid classification", () => {
    expect(ContradictionResultSchema.safeParse({ ...validContradiction, classification: "MAYBE" }).success).toBe(false);
  });
});

describe("ExtractionResultSchema", () => {
  it("parses full extraction result", () => {
    const result = ExtractionResultSchema.safeParse(validExtractionResult);
    expect(result.success).toBe(true);
  });

  it("parses empty extraction (no intelligence found)", () => {
    const empty = {
      episodeId: "evt-456",
      segments: [],
      entities: [],
      facts: [],
      comprehension: null,
      metacognitiveSignals: [],
      agencyClassification: [],
      sustainabilitySignal: null,
      reasoningChains: [],
    };
    const result = ExtractionResultSchema.safeParse(empty);
    expect(result.success).toBe(true);
  });

  it("parses git commit extraction (no comprehension)", () => {
    const gitResult = {
      episodeId: "evt-789",
      segments: [],
      entities: [validEntity],
      facts: [validFact],
      comprehension: null,
      metacognitiveSignals: [],
      agencyClassification: [],
      sustainabilitySignal: null,
      reasoningChains: [{
        decision: "Reverted auth to session cookies",
        alternatives: ["JWT"],
        rationale: "Stateless auth added too much complexity for this use case",
        tradeOffs: ["Requires server-side session storage"],
        context: "Commit message: 'Revert JWT auth — session cookies are simpler for our monolith architecture'",
      }],
    };
    expect(ExtractionResultSchema.safeParse(gitResult).success).toBe(true);
  });

  it("rejects missing episodeId", () => {
    const { episodeId: _, ...rest } = validExtractionResult;
    expect(ExtractionResultSchema.safeParse(rest).success).toBe(false);
  });
});

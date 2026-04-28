import { describe, expect, it, vi } from "vitest";
import type { AnalyzerContext } from "../../../src/services/intelligence/analyzers/index.js";
import type { KnowledgeReader, ComprehensionEntry, FactEntry, EntityEngagement } from "../../../src/services/intelligence/knowledge-reader.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

// ─── Shared Mocks ───────────────────────────────────────────────────────────

function createMockAnalytics(): DbLike {
  return { run() {}, exec() { return [{ columns: [], values: [] }]; } };
}

function createMockKnowledge(overrides: Partial<{
  assessments: ComprehensionEntry[];
  facts: FactEntry[];
  entities: EntityEngagement[];
  hasData: boolean;
}> = {}): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue(overrides.assessments ?? []),
    getFacts: vi.fn().mockResolvedValue(overrides.facts ?? []),
    getDecisions: vi.fn().mockResolvedValue([]),
    getEntityEngagement: vi.fn().mockResolvedValue(overrides.entities ?? []),
    getDecayState: vi.fn().mockResolvedValue([]),
    hasKnowledgeData: vi.fn().mockResolvedValue(overrides.hasData ?? true),
  };
}

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge: null,
    ...overrides,
  };
}

// ─── KGI-8.1: Velocity Quality ──────────────────────────────────────────────

describe("KGI-8.1: velocity-tracker velocityQuality", () => {
  it("adds velocityQuality schema field", async () => {
    const { DomainVelocitySchema } = await import("../../../src/schemas/intelligence/velocity.js");
    const valid = DomainVelocitySchema.parse({
      currentTurnsToAcceptance: 2.5,
      previousTurnsToAcceptance: 4.0,
      velocityChange: -37,
      dataPoints: 10,
      trend: "accelerating",
      velocityQuality: "genuine",
    });
    expect(valid.velocityQuality).toBe("genuine");
  });

  it("velocityQuality is optional (backward compat)", async () => {
    const { DomainVelocitySchema } = await import("../../../src/schemas/intelligence/velocity.js");
    const valid = DomainVelocitySchema.parse({
      currentTurnsToAcceptance: 3,
      previousTurnsToAcceptance: 3,
      velocityChange: 0,
      dataPoints: 5,
      trend: "stable",
    });
    expect(valid.velocityQuality).toBeUndefined();
  });
});

// ─── KGI-8.2: Causality Fact Chains ─────────────────────────────────────────

describe("KGI-8.2: causality fact-chain enrichment", () => {
  it("causalityChainAnalyzer exists and has correct name", async () => {
    const { causalityChainAnalyzer } = await import("../../../src/services/intelligence/causality.js");
    expect(causalityChainAnalyzer.name).toBe("causality-chains");
    expect(causalityChainAnalyzer.outputFile).toBe("causality-chains.json");
  });

  it("initializes without errors with no knowledge", async () => {
    const { causalityChainAnalyzer } = await import("../../../src/services/intelligence/causality.js");
    const ctx = makeCtx();
    const state = await causalityChainAnalyzer.initialize(ctx);
    expect(state.value).toBeDefined();
  });
});

// ─── KGI-8.3: File Direction Entity Annotation ──────────────────────────────

describe("KGI-8.3: file-direction entity annotation", () => {
  it("FileDirectionEntry has optional entities field", async () => {
    const { directionByFileAnalyzer } = await import("../../../src/services/intelligence/file-direction.js");
    expect(directionByFileAnalyzer.name).toBe("direction-by-file");

    const ctx = makeCtx();
    const state = await directionByFileAnalyzer.initialize(ctx);
    const output = directionByFileAnalyzer.derive(state);

    expect(Array.isArray(output)).toBe(true);
    for (const entry of output) {
      if (entry.entities) {
        expect(Array.isArray(entry.entities)).toBe(true);
      }
    }
  });
});

// ─── KGI-8.4: Prompt Patterns Topic Context ─────────────────────────────────

describe("KGI-8.4: prompt-patterns topic context", () => {
  it("EffectivePatternSchema has optional entities field", async () => {
    const { EffectivePatternSchema } = await import("../../../src/schemas/intelligence/prompt-patterns.js");
    const valid = EffectivePatternSchema.parse({
      domain: "auth",
      pattern: "constrained-request",
      acceptanceRate: 0.85,
      sampleSize: 12,
      entities: ["JWT", "authentication"],
    });
    expect(valid.entities).toEqual(["JWT", "authentication"]);
  });

  it("entities field is optional", async () => {
    const { EffectivePatternSchema } = await import("../../../src/schemas/intelligence/prompt-patterns.js");
    const valid = EffectivePatternSchema.parse({
      domain: "backend",
      pattern: "open-ended",
      acceptanceRate: 0.4,
      sampleSize: 8,
    });
    expect(valid.entities).toBeUndefined();
  });

  it("promptPatternsAnalyzer exists and has correct name", async () => {
    const { promptPatternsAnalyzer } = await import("../../../src/services/intelligence/analyzers/prompt-patterns.js");
    expect(promptPatternsAnalyzer.name).toBe("prompt-patterns");
  });
});

// ─── Graceful Degradation ───────────────────────────────────────────────────

describe("Group C: graceful degradation without knowledge", () => {
  it("all four analyzers initialize without knowledge", async () => {
    const ctx = makeCtx({ knowledge: null });

    const { velocityTrackerAnalyzer } = await import("../../../src/services/intelligence/analyzers/velocity-tracker.js");
    const { causalityChainAnalyzer } = await import("../../../src/services/intelligence/causality.js");
    const { directionByFileAnalyzer } = await import("../../../src/services/intelligence/file-direction.js");
    const { promptPatternsAnalyzer } = await import("../../../src/services/intelligence/analyzers/prompt-patterns.js");

    await expect(velocityTrackerAnalyzer.initialize(ctx)).resolves.toBeDefined();
    await expect(causalityChainAnalyzer.initialize(ctx)).resolves.toBeDefined();
    await expect(directionByFileAnalyzer.initialize(ctx)).resolves.toBeDefined();
    await expect(promptPatternsAnalyzer.initialize(ctx)).resolves.toBeDefined();
  });
});

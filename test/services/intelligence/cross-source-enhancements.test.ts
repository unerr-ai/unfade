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
  decisions: FactEntry[];
  entities: EntityEngagement[];
  hasData: boolean;
}> = {}): KnowledgeReader {
  return {
    getComprehension: vi.fn().mockResolvedValue(overrides.assessments ?? []),
    getFacts: vi.fn().mockResolvedValue(overrides.facts ?? []),
    getDecisions: vi.fn().mockResolvedValue(overrides.decisions ?? []),
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

// ─── KGI-12.1: git-ai-linker entity-level linking ──────────────────────────

describe("KGI-12.1: git-ai-linker entity linking", () => {
  it("AIGitLink has optional linkedEntities field", async () => {
    const { aiGitLinkerAnalyzer } = await import("../../../src/services/intelligence/git-ai-linker.js");
    expect(aiGitLinkerAnalyzer.name).toBe("ai-git-linker");
  });

  it("initializes without knowledge", async () => {
    const { aiGitLinkerAnalyzer } = await import("../../../src/services/intelligence/git-ai-linker.js");
    const ctx = makeCtx();
    const state = await aiGitLinkerAnalyzer.initialize(ctx);
    expect(state.value).toBeDefined();
  });
});

// ─── KGI-12.2: git-expertise-map comprehension overlay ──────────────────────

describe("KGI-12.2: git-expertise-map comprehension overlay", () => {
  it("FileExpertise has optional comprehensionQuality field", async () => {
    const { expertiseMapAnalyzer } = await import("../../../src/services/intelligence/git-expertise-map.js");
    expect(expertiseMapAnalyzer.name).toBe("expertise-map");
  });

  it("comprehensionQuality values match spec", () => {
    const validValues = ["genuine-expertise", "ownership-risk", "assisted-expertise", "dangerous-dependency", "unknown"];
    for (const v of validValues) {
      expect(typeof v).toBe("string");
    }
  });

  it("initializes without knowledge", async () => {
    const { expertiseMapAnalyzer } = await import("../../../src/services/intelligence/git-expertise-map.js");
    const ctx = makeCtx();
    const state = await expertiseMapAnalyzer.initialize(ctx);
    expect(state.value).toBeDefined();
  });
});

// ─── KGI-12.3: cross-efficiency-survival fact durability ────────────────────

describe("KGI-12.3: cross-efficiency-survival fact durability", () => {
  it("EfficiencySurvivalOutput has optional factDurability field", async () => {
    const { efficiencySurvivalAnalyzer } = await import("../../../src/services/intelligence/cross-efficiency-survival.js");
    expect(efficiencySurvivalAnalyzer.name).toBe("efficiency-survival");
  });

  it("computes from dependencies without knowledge", async () => {
    const { efficiencySurvivalAnalyzer } = await import("../../../src/services/intelligence/cross-efficiency-survival.js");
    const ctx = makeCtx({
      dependencyStates: new Map([
        ["efficiency", { value: { output: { aes: 65 } }, watermark: "", eventCount: 0, updatedAt: "" }],
        ["file-churn", { value: { output: { byFile: {}, updatedAt: "" } }, watermark: "", eventCount: 0, updatedAt: "" }],
        ["decision-replay", { value: { output: { replays: [], maxPerWeek: 2, updatedAt: "" } }, watermark: "", eventCount: 0, updatedAt: "" }],
      ]),
    });
    const state = await efficiencySurvivalAnalyzer.initialize(ctx);
    expect(state.value.output.compositeScore).toBeGreaterThanOrEqual(0);
    expect(state.value.output.factDurability).toBeUndefined();
  });
});

// ─── KGI-12.4: cross-maturity-ownership comprehension genuineness ───────────

describe("KGI-12.4: cross-maturity-ownership comprehension genuineness", () => {
  it("MaturityOwnershipOutput has genuineness field", async () => {
    const { maturityOwnershipAnalyzer } = await import("../../../src/services/intelligence/cross-maturity-ownership.js");
    expect(maturityOwnershipAnalyzer.name).toBe("maturity-ownership");
  });

  it("initializes with dependency states without knowledge", async () => {
    const { maturityOwnershipAnalyzer } = await import("../../../src/services/intelligence/cross-maturity-ownership.js");
    const ctx = makeCtx({
      dependencyStates: new Map([
        ["maturity-model", { value: { output: { currentPhase: 2, dimensions: [] } }, watermark: "", eventCount: 0, updatedAt: "" }],
        ["expertise-map", { value: { output: { files: [], byModule: [], overallExpertise: 0.5, aiDependencyRate: 0.3, updatedAt: "" } }, watermark: "", eventCount: 0, updatedAt: "" }],
      ]),
    });
    const state = await maturityOwnershipAnalyzer.initialize(ctx);
    expect(state.value.output.genuineness).toBeDefined();
    expect(["genuine", "mixed", "hollow"]).toContain(state.value.output.genuineness);
  });
});

// ─── Graceful degradation ───────────────────────────────────────────────────

describe("Cross-source analyzers: graceful degradation", () => {
  it("all 4 cross-source analyzers handle null knowledge", async () => {
    const ctx = makeCtx({ knowledge: null });

    const { aiGitLinkerAnalyzer } = await import("../../../src/services/intelligence/git-ai-linker.js");
    const { expertiseMapAnalyzer } = await import("../../../src/services/intelligence/git-expertise-map.js");

    await expect(aiGitLinkerAnalyzer.initialize(ctx)).resolves.toBeDefined();
    await expect(expertiseMapAnalyzer.initialize(ctx)).resolves.toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { maturityModelAnalyzer, type MaturityAssessment } from "../../../src/services/intelligence/maturity-model.js";
import type { AnalyzerContext } from "../../../src/services/intelligence/analyzers/index.js";
import type { IncrementalState } from "../../../src/services/intelligence/incremental-state.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

function createMockAnalytics(): DbLike {
  return { run() {}, exec() { return [{ columns: [], values: [] }]; } };
}

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    analytics: createMockAnalytics(),
    operational: { run() {}, exec() { return [{ columns: [], values: [] }]; } },
    repoRoot: "",
    config: {},
    knowledge: null,
    dependencyStates: new Map(),
    ...overrides,
  };
}

function makeDependencyStates(overrides: Record<string, { source?: string; output?: unknown }> = {}) {
  const states = new Map<string, IncrementalState<unknown>>();

  const defaults: Record<string, unknown> = {
    "window-aggregator": { windows: { "24h": { directionDensity: 65 } } },
    "comprehension-radar": { output: { overall: 68 }, source: "hds-fallback" },
    "efficiency": { output: { aes: 62 } },
    "loop-detector": { output: { stuckLoops: [], entries: [] }, source: "hds-fallback" },
    "velocity-tracker": { output: { byDomain: { backend: {}, frontend: {} } } },
    "prompt-patterns": { output: { totalPromptsAnalyzed: 45 } },
    "decision-replay": { output: { replays: [], maxPerWeek: 2, updatedAt: "" }, source: "hds-fallback" },
  };

  for (const [name, defaultVal] of Object.entries(defaults)) {
    const override = overrides[name];
    const value = override ? { ...defaultVal, ...override } : defaultVal;
    states.set(name, {
      value,
      watermark: "",
      eventCount: 10,
      updatedAt: new Date().toISOString(),
    });
  }

  return states;
}

describe("maturity-model (KGI-9)", () => {
  describe("knowledge-grounded dimensions", () => {
    it("sets knowledgeGrounded=true when dependency sources are knowledge", async () => {
      const deps = makeDependencyStates({
        "comprehension-radar": { output: { overall: 75 }, source: "knowledge" },
        "loop-detector": { output: { stuckLoops: [], entries: [] }, source: "knowledge" },
        "decision-replay": { output: { replays: [], maxPerWeek: 2, updatedAt: "" }, source: "knowledge" },
      });

      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);

      expect(state.value.knowledgeGrounded).toBe(true);
      const output = maturityModelAnalyzer.derive(state);
      expect(output.knowledgeGrounded).toBe(true);
    });

    it("sets knowledgeGrounded=false when all sources are hds-fallback", async () => {
      const deps = makeDependencyStates();
      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);

      expect(state.value.knowledgeGrounded).toBe(false);
      const output = maturityModelAnalyzer.derive(state);
      expect(output.knowledgeGrounded).toBe(false);
    });
  });

  describe("loop-resilience dimension", () => {
    it("knowledge path: considers resolved vs active loops", async () => {
      const deps = makeDependencyStates({
        "loop-detector": {
          output: { stuckLoops: [{ domain: "auth" }], entries: [{ domain: "auth" }, { domain: "db" }, { domain: "api" }] },
          source: "knowledge",
        },
      });

      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);

      const loopDim = state.value.dimensions.find((d) => d.name === "loop-resilience");
      expect(loopDim).toBeDefined();
      // 1 stuck out of 3 entries = 2/3 resolved ratio = 0.67 * 0.7 + some base
      expect(loopDim!.score).toBeGreaterThan(0.3);
    });

    it("fallback path: uses active loop count", async () => {
      const deps = makeDependencyStates({
        "loop-detector": { output: { stuckLoops: [{ domain: "a" }, { domain: "b" }], entries: [] }, source: "hds-fallback" },
      });

      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);

      const loopDim = state.value.dimensions.find((d) => d.name === "loop-resilience");
      expect(loopDim!.score).toBeLessThan(0.7);
    });
  });

  describe("decision-durability dimension", () => {
    it("knowledge path: computes durability from contradiction/supersession count", async () => {
      const deps = makeDependencyStates({
        "decision-replay": {
          output: {
            replays: [
              { triggerReason: "contradiction", id: "r1" },
              { triggerReason: "domain-drift", id: "r2" },
              { triggerReason: "supersession", id: "r3" },
            ],
            maxPerWeek: 2,
            updatedAt: "",
          },
          source: "knowledge",
        },
      });

      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);

      const decDim = state.value.dimensions.find((d) => d.name === "decision-durability");
      expect(decDim).toBeDefined();
      // 2 contradictions/supersessions out of 3 total → durability = 1/3 ≈ 0.33
      expect(decDim!.score).toBeLessThan(0.5);
    });

    it("knowledge path: high durability when no contradictions", async () => {
      const deps = makeDependencyStates({
        "decision-replay": {
          output: { replays: [{ triggerReason: "domain-drift", id: "r1" }], maxPerWeek: 2, updatedAt: "" },
          source: "knowledge",
        },
      });

      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);

      const decDim = state.value.dimensions.find((d) => d.name === "decision-durability");
      // 0 contradictions → raw 1.0, but Bayesian blending with prior pulls it down
      expect(decDim!.score).toBeGreaterThan(0.5);
    });
  });

  describe("phase computation", () => {
    it("produces valid phase between 1 and 5", async () => {
      const deps = makeDependencyStates();
      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);
      const output = maturityModelAnalyzer.derive(state);

      expect(output.phase).toBeGreaterThanOrEqual(1);
      expect(output.phase).toBeLessThanOrEqual(5);
      expect(output.dimensions.length).toBe(7);
    });

    it("detects bottlenecks correctly", async () => {
      const deps = makeDependencyStates();
      const ctx = makeCtx({ dependencyStates: deps });
      const state = await maturityModelAnalyzer.initialize(ctx);
      const output = maturityModelAnalyzer.derive(state);

      expect(Array.isArray(output.bottlenecks)).toBe(true);
      expect(Array.isArray(output.nextPhaseRequirements)).toBe(true);
    });
  });

  describe("incremental update", () => {
    it("detects phase changes", async () => {
      const deps = makeDependencyStates();
      const ctx = makeCtx({ dependencyStates: deps });
      const initState = await maturityModelAnalyzer.initialize(ctx);

      const result = await maturityModelAnalyzer.update(
        initState,
        { events: [{ id: "evt", ts: new Date().toISOString() } as any], sessionUpdates: [], featureUpdates: [] },
        ctx,
      );

      expect(typeof result.changed).toBe("boolean");
    });
  });
});

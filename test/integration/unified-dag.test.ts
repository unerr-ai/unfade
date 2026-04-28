// KGI-13.1: DAG Topology Verification
// Verifies that all 25 analyzers register, topological sort succeeds,
// no circular dependencies exist, and dependency declarations are valid.

import { describe, expect, it } from "vitest";
import { allAnalyzers } from "../../src/services/intelligence/analyzers/all.js";
import { IntelligenceScheduler } from "../../src/services/intelligence/engine.js";

describe("KGI-13.1: Unified DAG topology", () => {
  it("registers all 25 analyzers without error", () => {
    const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
    for (const analyzer of allAnalyzers) {
      scheduler.register(analyzer);
    }

    expect(allAnalyzers.length).toBeGreaterThanOrEqual(25);
  });

  it("topological sort succeeds (no unresolved cycles)", () => {
    const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
    for (const analyzer of allAnalyzers) {
      scheduler.register(analyzer);
    }

    // If Kahn's algorithm completes without leftover nodes, sort is valid.
    // The scheduler constructor + register calls rebuild topology automatically.
    // We verify by checking the internal order has all analyzers.
    const graph = (scheduler as any).graph as Map<string, unknown>;
    const topoOrder = (scheduler as any).topoOrder as string[];

    expect(topoOrder.length).toBe(graph.size);
    expect(topoOrder.length).toBe(allAnalyzers.length);
  });

  it("all declared dependencies exist in the graph", () => {
    const analyzerNames = new Set(allAnalyzers.map((a) => a.name));

    for (const analyzer of allAnalyzers) {
      const deps = analyzer.dependsOn ?? [];
      for (const dep of deps) {
        expect(analyzerNames.has(dep)).toBe(true);
      }
    }
  });

  it("no circular dependencies (Kahn's sort produces complete ordering)", () => {
    const graph = new Map<string, string[]>();
    for (const analyzer of allAnalyzers) {
      graph.set(analyzer.name, analyzer.dependsOn ?? []);
    }

    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    for (const [name, deps] of graph) {
      inDegree.set(name, deps.filter((d) => graph.has(d)).length);
    }

    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const [name, deps] of graph) {
        if (deps.includes(current)) {
          const newDeg = (inDegree.get(name) ?? 1) - 1;
          inDegree.set(name, newDeg);
          if (newDeg === 0 && !sorted.includes(name)) queue.push(name);
        }
      }
    }

    // All nodes should be in the sorted list — no cycles
    expect(sorted.length).toBe(graph.size);

    // Verify no remaining nodes with positive in-degree
    for (const [name, deg] of inDegree) {
      if (!sorted.includes(name)) {
        throw new Error(`Cycle detected involving: ${name} (in-degree: ${deg})`);
      }
    }
  });

  it("leaf analyzers have no dependencies", () => {
    const leafAnalyzers = allAnalyzers.filter(
      (a) => !a.dependsOn || a.dependsOn.length === 0,
    );

    // Should have at least 10 leaf analyzers
    expect(leafAnalyzers.length).toBeGreaterThanOrEqual(10);

    const leafNames = leafAnalyzers.map((a) => a.name);
    expect(leafNames).toContain("efficiency");
    expect(leafNames).toContain("comprehension-radar");
    expect(leafNames).toContain("loop-detector");
    expect(leafNames).toContain("blind-spot-detector");
    expect(leafNames).toContain("decision-replay");
    expect(leafNames).toContain("velocity-tracker");
  });

  it("dependent analyzers come after their dependencies in topo order", () => {
    const scheduler = new IntelligenceScheduler({ minIntervalMs: 0 });
    for (const analyzer of allAnalyzers) {
      scheduler.register(analyzer);
    }

    const topoOrder = (scheduler as any).topoOrder as string[];
    const indexMap = new Map(topoOrder.map((name, idx) => [name, idx]));

    for (const analyzer of allAnalyzers) {
      const deps = analyzer.dependsOn ?? [];
      const myIdx = indexMap.get(analyzer.name);
      if (myIdx === undefined) continue;

      for (const dep of deps) {
        const depIdx = indexMap.get(dep);
        if (depIdx === undefined) continue;
        expect(depIdx).toBeLessThan(myIdx);
      }
    }
  });

  it("Group B analyzers (knowledge-grounded rewrites) are present", () => {
    const names = allAnalyzers.map((a) => a.name);

    // Group B: comprehension-radar, blind-spots, decision-replay, loop-detector
    expect(names).toContain("comprehension-radar");
    expect(names).toContain("blind-spot-detector");
    expect(names).toContain("decision-replay");
    expect(names).toContain("loop-detector");
  });

  it("maturity-model depends on Group B analyzers", () => {
    const maturity = allAnalyzers.find((a) => a.name === "maturity-model");
    expect(maturity).toBeDefined();
    expect(maturity!.dependsOn).toContain("comprehension-radar");
    expect(maturity!.dependsOn).toContain("loop-detector");
    expect(maturity!.dependsOn).toContain("decision-replay");
  });

  it("narrative-engine depends on maturity-model", () => {
    const narrative = allAnalyzers.find((a) => a.name === "narrative-engine");
    expect(narrative).toBeDefined();
    expect(narrative!.dependsOn).toContain("maturity-model");
  });

  it("all analyzers have unique names", () => {
    const names = allAnalyzers.map((a) => a.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("all analyzers have outputFile defined", () => {
    for (const analyzer of allAnalyzers) {
      expect(analyzer.outputFile).toBeTruthy();
    }
  });
});

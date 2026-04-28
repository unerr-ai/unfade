// Layer 4 IP-5: Cross-Analyzer Correlation Engine
//
// Detects meaningful patterns spanning multiple analyzers by running registered
// pattern detectors against enriched analyzer outputs. Each pattern is a pure
// function: (analyzer outputs map) → Correlation | null.
//
// Lifecycle:
//   1. Engine created, patterns registered at startup
//   2. Phase 5 hook calls detect() after all analyzers complete
//   3. Correlations persisted to ~/.unfade/intelligence/correlations.json
//   4. API serves correlations; UI renders CorrelationCards with drill-through

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Correlation } from "../../schemas/intelligence-presentation.js";
import { logger } from "../../utils/logger.js";

// ─── Pattern Interface ──────────────────────────────────────────────────────

export interface CorrelationPattern {
  id: string;
  name: string;
  analyzers: string[];
  detect: (outputs: Map<string, unknown>) => Correlation | null;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class CorrelationEngine {
  private patterns: CorrelationPattern[] = [];

  register(pattern: CorrelationPattern): void {
    this.patterns.push(pattern);
  }

  registerAll(patterns: CorrelationPattern[]): void {
    for (const p of patterns) this.register(p);
  }

  get patternCount(): number {
    return this.patterns.length;
  }

  async detect(
    outputs: Map<string, { output: unknown; sourceEventIds: string[] }>,
  ): Promise<Correlation[]> {
    const results: Correlation[] = [];

    for (const pattern of this.patterns) {
      const hasAllOutputs = pattern.analyzers.every((a) => outputs.has(a));
      if (!hasAllOutputs) continue;

      try {
        const outputMap = new Map<string, unknown>();
        for (const [name, data] of outputs) {
          outputMap.set(name, data.output);
        }

        const result = pattern.detect(outputMap);
        if (result) results.push(result);
      } catch (err) {
        logger.debug(`Correlation pattern "${pattern.id}" failed (non-fatal)`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────

export async function writeCorrelations(
  correlations: Correlation[],
  intelligenceDir: string,
): Promise<void> {
  try {
    if (!existsSync(intelligenceDir)) mkdirSync(intelligenceDir, { recursive: true });

    const path = join(intelligenceDir, "correlations.json");
    writeFileSync(path, JSON.stringify(correlations, null, 2), "utf-8");
  } catch (err) {
    logger.debug("Failed to write correlations file", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function loadCorrelations(
  intelligenceDir: string,
): Promise<Correlation[]> {
  try {
    const path = join(intelligenceDir, "correlations.json");
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8")) as Correlation[];
  } catch {
    return [];
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

import { ALL_CORRELATION_PATTERNS } from "./correlation-patterns.js";

export function createCorrelationEngine(): CorrelationEngine {
  const engine = new CorrelationEngine();
  engine.registerAll(ALL_CORRELATION_PATTERNS);
  return engine;
}

// FILE: src/services/intelligence/engine.ts
// UF-100: Intelligence Engine orchestrator — runs all registered analyzers after materializer tick.
// Writes outputs to .unfade/intelligence/ directory. Non-blocking, error-isolated per analyzer.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./analyzers/index.js";

const INTELLIGENCE_DIR = "intelligence";

export class IntelligenceEngine {
  private analyzers: Analyzer[] = [];
  private lastRunMs = 0;
  private minIntervalMs: number;

  constructor(opts: { minIntervalMs?: number } = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 10_000;
  }

  register(analyzer: Analyzer): void {
    this.analyzers.push(analyzer);
    logger.debug("Registered intelligence analyzer", { name: analyzer.name });
  }

  /**
   * Run all registered analyzers. Called from materializer onTick.
   * Throttled to minIntervalMs to avoid thrashing on rapid event bursts.
   * Each analyzer is error-isolated — one failure doesn't block others.
   */
  async run(ctx: AnalyzerContext): Promise<AnalyzerResult[]> {
    const now = Date.now();
    if (now - this.lastRunMs < this.minIntervalMs) return [];

    this.lastRunMs = now;
    const results: AnalyzerResult[] = [];

    const intelligenceDir = join(ctx.repoRoot, ".unfade", INTELLIGENCE_DIR);
    mkdirSync(intelligenceDir, { recursive: true });

    for (const analyzer of this.analyzers) {
      try {
        const hasEnoughData = await this.checkMinData(ctx, analyzer.minDataPoints);
        if (!hasEnoughData) continue;

        const result = await analyzer.run(ctx);
        writeResultAtomically(intelligenceDir, analyzer.outputFile, result.data);
        results.push(result);
      } catch (err) {
        logger.debug(`Intelligence analyzer ${analyzer.name} failed (non-fatal)`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  private async checkMinData(ctx: AnalyzerContext, min: number): Promise<boolean> {
    try {
      const result = ctx.db.exec("SELECT COUNT(*) FROM events");
      const count = (result[0]?.values[0]?.[0] as number) ?? 0;
      return count >= min;
    } catch {
      return false;
    }
  }
}

function writeResultAtomically(dir: string, filename: string, data: Record<string, unknown>): void {
  const target = join(dir, filename);
  const tmp = join(dir, `${filename}.tmp.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, target);
}

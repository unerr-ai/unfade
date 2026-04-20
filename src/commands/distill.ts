// FILE: src/commands/distill.ts
// UF-037: `unfade distill` command.
// Manual trigger (today by default), view by date, backfill N days,
// provider override. Displays summary on completion.

import { loadConfig } from "../config/manager.js";
import { USER_TERMS } from "../constants/terminology.js";
import type { UnfadeConfig } from "../schemas/config.js";
import type { DailyDistill } from "../schemas/distill.js";
import { backfill, distill } from "../services/distill/distiller.js";
import { createLLMProvider } from "../services/distill/providers/ai.js";
import { handleCliError } from "../utils/cli-error.js";
import { logger } from "../utils/logger.js";

interface DistillCommandOptions {
  date?: string;
  backfill?: string;
  provider?: string;
  json?: boolean;
}

/**
 * Format a distill result for stderr output.
 */
function printDistillSummary(d: DailyDistill): void {
  logger.info("");
  logger.info(`  ${USER_TERMS.distill} — ${d.date}`);
  logger.info(`  ${d.summary}`);
  logger.info("");
  logger.info(`  Decisions: ${d.decisions.length}`);

  if (d.tradeOffs && d.tradeOffs.length > 0) {
    logger.info(`  Trade-offs: ${d.tradeOffs.length}`);
  }
  if (d.deadEnds && d.deadEnds.length > 0) {
    logger.info(`  Dead ends: ${d.deadEnds.length}`);
  }
  if (d.breakthroughs && d.breakthroughs.length > 0) {
    logger.info(`  Breakthroughs: ${d.breakthroughs.length}`);
  }
  if (d.patterns && d.patterns.length > 0) {
    logger.info(`  Patterns: ${d.patterns.join(", ")}`);
  }

  logger.info(`  Events processed: ${d.eventsProcessed}`);
  logger.info(`  Synthesized by: ${d.synthesizedBy ?? "unknown"}`);
  logger.info("");
}

/**
 * Resolve LLM provider from CLI override or config.
 */
function withProviderOverride(
  config: UnfadeConfig,
  providerOverride: string | undefined,
): UnfadeConfig {
  if (!providerOverride?.trim()) return config;
  return {
    ...config,
    distill: {
      ...config.distill,
      provider: providerOverride.trim() as UnfadeConfig["distill"]["provider"],
    },
  };
}

async function resolveProvider(providerOverride: string | undefined, config: UnfadeConfig) {
  if (!providerOverride) return undefined;
  return createLLMProvider(withProviderOverride(config, providerOverride));
}

/**
 * Execute the `unfade distill` command.
 */
export async function distillCommand(options: DistillCommandOptions): Promise<void> {
  const startMs = Date.now();
  try {
    return await _distillCommand(options, startMs);
  } catch (err) {
    handleCliError(err, "distill");
  }
}

async function _distillCommand(options: DistillCommandOptions, startMs: number): Promise<void> {
  const config = loadConfig();
  const effectiveConfig = withProviderOverride(config, options.provider);
  const { runOllamaGuardForConfig } = await import("../services/llm/ollama-cli-guard.js");
  await runOllamaGuardForConfig(process.cwd(), effectiveConfig);

  // Resolve provider override if given
  const provider = await resolveProvider(options.provider, config);

  // Backfill mode
  if (options.backfill) {
    const days = Number.parseInt(options.backfill, 10);
    if (Number.isNaN(days) || days <= 0) {
      logger.error("--backfill requires a positive integer");
      return;
    }

    logger.info(`${USER_TERMS.distilling} ${days} past day${days === 1 ? "" : "s"}...`);

    const results = await backfill(days, config, { provider, silent: true });

    if (results.length === 0) {
      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({ data: [], _meta: { tool: "distill", durationMs: Date.now() - startMs } })}\n`,
        );
      } else {
        logger.info("No days with events found in backfill range.");
      }
      return;
    }

    if (options.json) {
      const data = results.map((r) => ({
        date: r.date,
        distill: r.distill,
        path: r.path,
        skipped: r.skipped,
      }));
      process.stdout.write(
        `${JSON.stringify({ data, _meta: { tool: "distill", durationMs: Date.now() - startMs } })}\n`,
      );
      return;
    }

    logger.info(
      `Backfill complete: ${results.length} day${results.length === 1 ? "" : "s"} distilled.`,
    );
    for (const r of results) {
      printDistillSummary(r.distill);
    }
    return;
  }

  // Single date mode (default: today)
  const date = options.date ?? new Date().toISOString().slice(0, 10);

  logger.info(`${USER_TERMS.distilling} ${date}...`);

  const result = await distill(date, config, { provider });

  if (!result) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ data: null, _meta: { tool: "distill", durationMs: Date.now() - startMs } })}\n`,
      );
    } else {
      logger.info(`No events for ${date}. Nothing to distill.`);
    }
    return;
  }

  if (options.json) {
    const data = {
      date: result.date,
      distill: result.distill,
      path: result.path,
      skipped: result.skipped,
    };
    process.stdout.write(
      `${JSON.stringify({ data, _meta: { tool: "distill", durationMs: Date.now() - startMs } })}\n`,
    );
    return;
  }

  printDistillSummary(result.distill);
}

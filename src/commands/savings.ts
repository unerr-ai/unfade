// FILE: src/commands/savings.ts
// 12C.8: `unfade savings` command — show estimated time/cost savings from MCP context injections.

import { handleCliError } from "../utils/cli-error.js";
import { logger } from "../utils/logger.js";

interface SavingsOptions {
  json?: boolean;
}

/**
 * Execute the `unfade savings` command.
 */
export async function savingsCommand(options: SavingsOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const { CacheManager } = await import("../services/cache/manager.js");
    const cache = new CacheManager(cwd);
    const db = await cache.getDb();

    if (!db) {
      logger.info("No data available. Run `unfade` to start capturing.");
      return;
    }

    const { computeValueReceipt } = await import("../services/intelligence/value-receipt.js");
    const receipt = await computeValueReceipt(db);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return;
    }

    formatSavingsOutput(receipt);
  } catch (err) {
    handleCliError(err, "savings");
  }
}

function formatSavingsOutput(receipt: {
  today: {
    injections: number;
    estimatedTokensSaved: number;
    estimatedCostSaved: number;
    estimatedMinutesSaved: number;
  };
  thisWeek: {
    injections: number;
    estimatedTokensSaved: number;
    estimatedCostSaved: number;
    estimatedMinutesSaved: number;
  };
  thisMonth: {
    injections: number;
    estimatedTokensSaved: number;
    estimatedCostSaved: number;
    estimatedMinutesSaved: number;
  };
}): void {
  logger.info("Estimated Savings from MCP Context Injections\n");
  logger.info("  All values are conservative estimates prefixed with ~\n");

  const periods = [
    { label: "Today", data: receipt.today },
    { label: "This Week", data: receipt.thisWeek },
    { label: "This Month", data: receipt.thisMonth },
  ];

  for (const { label, data } of periods) {
    if (data.injections === 0) {
      logger.info(`  ${label}: No injections recorded`);
    } else {
      const tokens =
        data.estimatedTokensSaved >= 1000
          ? `~${(data.estimatedTokensSaved / 1000).toFixed(1)}K`
          : `~${data.estimatedTokensSaved}`;
      const hours = (data.estimatedMinutesSaved / 60).toFixed(1);
      logger.info(`  ${label}:`);
      logger.info(`    ~${data.injections} context injections`);
      logger.info(`    ${tokens} tokens saved (~$${data.estimatedCostSaved.toFixed(2)})`);
      logger.info(`    ~${hours} hours of re-explanation avoided`);
    }
    logger.info("");
  }
}

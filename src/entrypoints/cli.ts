// FILE: src/entrypoints/cli.ts
// Unfade CLI entry point — Commander with all commands.
// Bare `unfade` (no args) starts the long-running server (like `next dev` or `vite`).
// All other commands are run-and-exit.

import { Command } from "@commander-js/extra-typings";
import { distillCommand } from "../commands/distill.js";
import { exportCommand } from "../commands/export.js";
import { mcpCommand } from "../commands/mcp.js";
import { publishCommand } from "../commands/publish.js";
import { queryCommand } from "../commands/query.js";
import { resetCommand } from "../commands/reset.js";
import { logger } from "../utils/logger.js";

const program = new Command()
  .name("unfade")
  .version("0.1.0")
  .description("Capture engineering reasoning from AI-assisted workflows. Run `unfade` to start.")
  .option("--verbose", "Show debug-level output")
  .option("--quiet", "Suppress non-essential output")
  .option("--json", "JSON output for piping/scripting")
  .option("--config <path>", "Custom config file path")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    logger.configure({
      verbose: opts.verbose ?? false,
      quiet: opts.quiet ?? false,
    });
  });

// --- Setup Commands ---

program
  .command("add")
  .description("Register an additional repo for tracking")
  .argument("<path>", "Path to the repo root")
  .action(async (targetPath) => {
    const { addCommand } = await import("../commands/add.js");
    await addCommand(targetPath);
  });

program
  .command("reset")
  .description(
    "Stop all daemons and remove this repo's .unfade/ plus global ~/.unfade/ (full clean slate)",
  )
  .action(async () => {
    await resetCommand();
  });

// --- Run-and-Exit Commands ---

program
  .command("status")
  .description("Show today's reasoning metrics and identity (no server needed)")
  .action(async () => {
    const { statusCommand } = await import("../commands/status.js");
    await statusCommand();
  });

program
  .command("distill")
  .description("Trigger manual distillation for today (or a specific date)")
  .option("--date <date>", "Distill a specific date (YYYY-MM-DD)")
  .option("--backfill <days>", "Backfill N past days")
  .option("--provider <name>", "Override LLM provider (ollama|openai|anthropic)")
  .action(async (opts) => {
    await distillCommand({ ...opts, json: program.opts().json ?? false });
  });

program
  .command("query")
  .description("Search across reasoning history")
  .argument("<search>", "Search query")
  .option("--from <date>", "Start date (YYYY-MM-DD)")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .option("--limit <n>", "Max results (default: 10)")
  .action(async (search, opts) => {
    await queryCommand(search, {
      from: opts.from,
      to: opts.to,
      limit: opts.limit,
      json: program.opts().json ?? false,
    });
  });

program
  .command("card")
  .description("Generate a Reasoning Card (--v3 for full anti-vibe certificate)")
  .option("--v3", "Generate Card v3 with comprehension, velocity, and anti-vibe badge")
  .action(async (opts) => {
    const { cardCommand } = await import("../commands/card.js");
    await cardCommand({ v3: Boolean(opts.v3) });
  });

program
  .command("export")
  .description("Export .unfade/ as portable .tar.gz; --leadership for aggregate-only pack")
  .option("--output <path>", "Output file path")
  .option("--leadership", "Generate leadership/finance export (aggregates only)")
  .option("--yes", "Skip confirmation prompt")
  .action(async (opts) => {
    await exportCommand({
      output: opts.output,
      json: program.opts().json ?? false,
      leadership: Boolean(opts.leadership),
      yes: Boolean(opts.yes),
    });
  });

program
  .command("doctor")
  .description("Diagnose paths, processes, and registry health")
  .option("--rebuild-cache", "Drop and rebuild both SQLite and DuckDB caches from JSONL source")
  .option("--rebuild-intelligence", "Clear and re-initialize all intelligence analyzer states")
  .option("--verify-pipeline", "Run end-to-end verification of the intelligence pipeline")
  .option("--rebuild-graph", "Drop and rebuild the CozoDB intelligence graph from DuckDB")
  .action(async (opts) => {
    if (opts.rebuildCache) {
      const { CacheManager } = await import("../services/cache/manager.js");
      const { rebuildAll } = await import("../services/cache/materializer.js");
      const cache = new CacheManager();
      const rows = await rebuildAll(cache);
      await cache.flushDuckDb();
      await cache.close();
      process.stderr.write(`Rebuilt ${rows} rows into both SQLite + DuckDB caches.\n`);
      return;
    }
    if (opts.rebuildIntelligence) {
      const { CacheManager } = await import("../services/cache/manager.js");
      const { coldStartIntelligence } = await import("../services/intelligence/cold-start.js");
      const cache = new CacheManager();
      const db = await cache.getDb();
      const analyticsDb = cache.analytics ?? db;
      if (!db || !analyticsDb) {
        process.stderr.write("Cache not available — run `unfade doctor --rebuild-cache` first.\n");
        process.exitCode = 1;
        return;
      }
      const result = await coldStartIntelligence(analyticsDb, db);
      await cache.close();
      process.stderr.write(
        `Intelligence rebuilt: ${result.analyzersInitialized} analyzers initialized, ` +
          `${result.stateFilesWritten} state files, ${result.durationMs}ms\n`,
      );
      if (result.processingResult) {
        process.stderr.write(
          `  Processing: ${result.processingResult.nodesProcessed} nodes, ` +
            `${result.processingResult.totalEventsInBatch} events\n`,
        );
      }
      return;
    }
    if (opts.verifyPipeline) {
      const { CacheManager } = await import("../services/cache/manager.js");
      const { verifyPipeline } = await import("../services/intelligence/pipeline-verify.js");
      const cache = new CacheManager();
      const db = await cache.getDb();
      const analyticsDb = cache.analytics ?? db;
      if (!db || !analyticsDb) {
        process.stderr.write("Cache not available — run `unfade doctor --rebuild-cache` first.\n");
        process.exitCode = 1;
        return;
      }
      const result = await verifyPipeline(analyticsDb, db);
      process.stderr.write(`\n${result.summary}\n\n`);
      for (const check of result.checks) {
        const icon = check.passed ? "✓" : check.severity === "critical" ? "✗" : "⚠";
        process.stderr.write(`  ${icon} [${check.layer}] ${check.name}: ${check.detail}\n`);
      }
      process.stderr.write("\n");
      await cache.close();
      if (!result.passed) process.exitCode = 1;
      return;
    }
    if (opts.rebuildGraph) {
      const { CacheManager } = await import("../services/cache/manager.js");
      const { CozoManager } = await import("../services/substrate/cozo-manager.js");
      const { SubstrateEngine } = await import("../services/substrate/substrate-engine.js");
      const { buildAllContributions } = await import("../services/substrate/entity-mapper.js");
      const { ALL_COZO_SCHEMA, ALL_COZO_INDEXES } = await import("../services/substrate/schema.js");
      const cache = new CacheManager();
      const analyticsDb = cache.analytics ?? (await cache.getDb());
      if (!analyticsDb) {
        process.stderr.write("Cache not available — run `unfade doctor --rebuild-cache` first.\n");
        process.exitCode = 1;
        return;
      }
      const startMs = Date.now();
      process.stderr.write("Rebuilding intelligence graph...\n");
      await CozoManager.close();
      const graphDb = await CozoManager.getInstance();
      for (const stmt of ALL_COZO_SCHEMA) {
        try {
          await graphDb.run(stmt.replace(":create", ":replace"));
        } catch {
          /* recreate */
        }
      }
      for (const stmt of ALL_COZO_INDEXES) {
        try {
          await graphDb.run(stmt);
        } catch {
          /* already exists */
        }
      }
      const substrate = new SubstrateEngine(graphDb);
      const contributions = await buildAllContributions(analyticsDb, "");
      const upserted = await substrate.ingest(contributions);
      const propagation = await substrate.propagate();
      const counts = await substrate.entityCounts();
      await cache.close();
      const elapsed = Date.now() - startMs;
      process.stderr.write(
        `Graph rebuilt: ${upserted} entities, ${Object.values(counts).reduce((s, v) => s + v, 0)} active, ` +
          `${propagation.patternsPromoted} patterns promoted, ${elapsed}ms\n`,
      );
      for (const [type, count] of Object.entries(counts)) {
        process.stderr.write(`  ${type}: ${count}\n`);
      }
      return;
    }
    const { doctorCommand } = await import("../commands/doctor.js");
    await doctorCommand();
  });

program
  .command("publish")
  .description("Generate Thinking Graph static site")
  .option("--output <dir>", "Custom output directory (default: .unfade/site/)")
  .action(async (opts) => {
    await publishCommand({ output: opts.output });
  });

program
  .command("prompt")
  .description("Metric badge for shell prompt integration (◆67 ↑)")
  .action(() => {
    const { promptCommand } = require("../commands/prompt.js");
    promptCommand();
  });

program
  .command("ingest")
  .description("Ingest historical AI session data (Claude Code, Cursor, Codex, Aider)")
  .option("--since <duration>", "How far back to ingest (e.g., 7d, 2w, 30d)")
  .option("--status", "Show current ingest progress")
  .action(async (opts) => {
    const { ingestCommand } = await import("../commands/ingest.js");
    await ingestCommand({ since: opts.since, status: opts.status ?? false });
  });

program
  .command("history")
  .description("Query event history by domain, feature, or time range")
  .option("--domain <domain>", "Filter by domain")
  .option("--feature <name>", "Filter by feature name")
  .option("--last <duration>", "Time range (e.g., 7d, 2w, 30d)")
  .option("--format <fmt>", "Output format: text (default), md, json")
  .action(async (opts) => {
    const { historyCommand } = await import("../commands/history.js");
    await historyCommand({
      domain: opts.domain,
      feature: opts.feature,
      last: opts.last,
      format: opts.format,
      json: program.opts().json ?? false,
    });
  });

program
  .command("savings")
  .description("Show estimated time/cost savings from MCP context injections")
  .action(async () => {
    const { savingsCommand } = await import("../commands/savings.js");
    await savingsCommand({ json: program.opts().json ?? false });
  });

// --- Daemon management (power user) ---

const daemonCmd = program.command("daemon").description("Manage the capture engine");
daemonCmd
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    const { daemonStatusCommand } = await import("../commands/daemon.js");
    await daemonStatusCommand();
  });
daemonCmd
  .command("stop")
  .description("Stop the capture engine")
  .action(async () => {
    const { daemonStopCommand } = await import("../commands/daemon.js");
    await daemonStopCommand();
  });
daemonCmd
  .command("restart")
  .description("Restart the capture engine")
  .action(async () => {
    const { daemonRestartCommand } = await import("../commands/daemon.js");
    await daemonRestartCommand();
  });
daemonCmd
  .command("update")
  .description("Update capture engine binary")
  .action(async () => {
    const { daemonUpdateCommand } = await import("../commands/daemon.js");
    await daemonUpdateCommand();
  });

// --- MCP (hidden — IDE integration only) ---

program
  .command("mcp", { hidden: true })
  .description("Start MCP stdio server for IDE integration")
  .action(async () => {
    await mcpCommand();
  });

// --- Bare `unfade` → Start Server (the primary experience) ---

program.action(async () => {
  const cwd = process.cwd();

  // Lightweight init — idempotent, fast, no interactive prompts
  const { ensureInit } = await import("../services/init/lightweight-init.js");
  const { firstRun } = ensureInit(cwd);

  if (firstRun) {
    const { printInitStep } = await import("../cli/server-banner.js");
    printInitStep("First run — .unfade/ initialized. Opening dashboard for setup…");
  }

  // Start the unified server
  const { startUnfadeServer } = await import("../server/unfade-server.js");
  const handle = await startUnfadeServer(cwd);

  // Auto-open browser on first run
  if (firstRun) {
    const { openBrowser } = await import("../utils/open.js");
    openBrowser(`http://localhost:${handle.server.info.port}`);
  }

  // Keep process alive until SIGINT/SIGTERM
  const shutdown = async () => {
    await handle.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
});

program.parse();

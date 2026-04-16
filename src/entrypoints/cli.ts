// FILE: src/entrypoints/cli.ts
// Unfade CLI entry point — Commander skeleton with all command stubs.
// Bare `unfade` (no args) prints help. TUI dashboard deferred to Phase 1.

import { Command } from "@commander-js/extra-typings";
import { daemonStatusCommand, daemonStopCommand } from "../commands/daemon.js";
import { distillCommand } from "../commands/distill.js";
import { exportCommand } from "../commands/export.js";
import { initCommand } from "../commands/init.js";
import { mcpCommand } from "../commands/mcp.js";
import { openCommand } from "../commands/open.js";
import { publishCommand } from "../commands/publish.js";
import { queryCommand } from "../commands/query.js";
import { logger } from "../utils/logger.js";

const program = new Command()
  .name("unfade")
  .version("0.1.0")
  .description("Passively capture engineering reasoning from developer workflows")
  .option("--verbose", "Show debug-level output")
  .option("--quiet", "Suppress non-essential output")
  .option("--json", "JSON output for piping/scripting")
  .option("--config <path>", "Custom config file path")
  .option("--data-dir <path>", "Custom .unfade/ directory path")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    logger.configure({
      verbose: opts.verbose ?? false,
      quiet: opts.quiet ?? false,
    });
  });

// --- Core Commands ---

program
  .command("init")
  .description("Initialize .unfade/, download capture engine, configure LLM, install shell hooks")
  .action(async () => {
    await initCommand();
  });

program
  .command("open")
  .description("Open web UI in browser (localhost:7654)")
  .action(async () => {
    await openCommand();
  });

program
  .command("query")
  .description("Semantic search across reasoning history")
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
  .command("server")
  .description("Start the local HTTP API server")
  .option("--port <port>", "Override HTTP port (default: 7654)")
  .action(async (opts) => {
    const { bootstrapServer } = await import("../services/daemon/server-bootstrap.js");
    if (opts.port) {
      process.env.UNFADE_MCP__HTTP_PORT = opts.port;
    }
    const server = await bootstrapServer();
    logger.info(`Server running on ${server.info.transport.http}`);
    // Keep process alive
    process.on("SIGINT", () => {
      server.close();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      server.close();
      process.exit(0);
    });
  });

// --- MCP (hidden — IDE integration only) ---

program
  .command("mcp", { hidden: true })
  .description("Start MCP stdio server for IDE integration")
  .action(async () => {
    await mcpCommand();
  });

// --- Power User Commands ---

program
  .command("export")
  .description("Export .unfade/ as portable .tar.gz")
  .option("--output <path>", "Output file path (default: ./unfade-export-YYYY-MM-DD.tar.gz)")
  .action(async (opts) => {
    await exportCommand({ output: opts.output, json: program.opts().json ?? false });
  });

program
  .command("publish")
  .description("Generate Thinking Graph static site")
  .option("--output <dir>", "Custom output directory (default: .unfade/site/)")
  .action(async (opts) => {
    await publishCommand({ output: opts.output });
  });

program
  .command("distill")
  .description("Trigger manual distillation")
  .option("--date <date>", "Distill a specific date (YYYY-MM-DD)")
  .option("--backfill <days>", "Backfill N past days")
  .option("--provider <name>", "Override LLM provider (ollama|openai|anthropic)")
  .action(async (opts) => {
    await distillCommand({ ...opts, json: program.opts().json ?? false });
  });

const daemonCmd = program.command("daemon").description("Manage the capture engine");

daemonCmd
  .command("stop")
  .description("Gracefully stop the capture engine")
  .action(async () => {
    await daemonStopCommand();
  });

daemonCmd
  .command("status")
  .description("Show capture engine status")
  .action(async () => {
    await daemonStatusCommand();
  });

// Bare `unfade` with no args → TUI dashboard (if interactive), otherwise help
program.action(async () => {
  if (process.stderr.isTTY) {
    const { launchDashboard } = await import("../tui/dashboard.js");
    await launchDashboard();
  } else {
    program.help();
  }
});

program.parse();

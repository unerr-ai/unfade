// FILE: src/entrypoints/cli.ts
// Unfade CLI entry point — Commander skeleton with all command stubs.
// Bare `unfade` (no args) prints help. TUI dashboard deferred to Phase 1.

import { Command } from "@commander-js/extra-typings";
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
  .action(() => {
    logger.info("unfade init: not implemented yet");
  });

program
  .command("open")
  .description("Open web UI in browser (localhost:7654)")
  .action(() => {
    logger.info("unfade open: not implemented yet");
  });

program
  .command("query")
  .description("Semantic search across reasoning history")
  .argument("[search]", "Search query")
  .action((_search) => {
    logger.info("unfade query: not implemented yet");
  });

// --- Power User Commands ---

program
  .command("export")
  .description("Export .unfade/ as portable .tar.gz")
  .action(() => {
    logger.info("unfade export: not implemented yet");
  });

program
  .command("distill")
  .description("Trigger manual distillation")
  .action(() => {
    logger.info("unfade distill: not implemented yet");
  });

const daemonCmd = program.command("daemon").description("Manage the capture engine");

daemonCmd
  .command("stop")
  .description("Gracefully stop the capture engine")
  .action(() => {
    logger.info("unfade daemon stop: not implemented yet");
  });

daemonCmd
  .command("status")
  .description("Show capture engine status")
  .action(() => {
    logger.info("unfade daemon status: not implemented yet");
  });

// Bare `unfade` with no args → show help
program.action(() => {
  program.help();
});

program.parse();

// FILE: src/utils/logger.ts
// Structured logger that writes EXCLUSIVELY to stderr.
// stdout is sacred — reserved for MCP JSON-RPC only.

import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerConfig {
  verbose: boolean;
  quiet: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: chalk.gray("DBG"),
  info: chalk.cyan("INF"),
  warn: chalk.yellow("WRN"),
  error: chalk.red("ERR"),
};

class Logger {
  private config: LoggerConfig = { verbose: false, quiet: false };

  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private get minLevel(): LogLevel {
    if (this.config.verbose) return "debug";
    if (this.config.quiet) return "warn";
    return "info";
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString().slice(11, 23);
    const label = LOG_LEVEL_LABELS[level];
    const prefix = chalk.dim(timestamp);

    let line = `${prefix} ${label} ${message}`;
    if (data) {
      line += ` ${chalk.dim(JSON.stringify(data))}`;
    }

    // CRITICAL: Always stderr. Never stdout. Never console.log.
    process.stderr.write(`${line}\n`);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data);
  }
}

export const logger = new Logger();

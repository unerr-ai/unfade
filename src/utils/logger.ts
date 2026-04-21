// FILE: src/utils/logger.ts
// Structured logger backed by Pino that writes EXCLUSIVELY to stderr.
// stdout is sacred — reserved for MCP JSON-RPC only.

import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerConfig {
  verbose: boolean;
  quiet: boolean;
}

function resolveLevel(config: LoggerConfig): string {
  if (config.verbose) return "debug";
  if (config.quiet) return "warn";
  return "info";
}

function createPinoInstance(level: string): pino.Logger {
  // Always write to stderr (fd 2) synchronously for predictable output.
  // pino-pretty is used via transport only if PINO_PRETTY=1 env is set.
  return pino({ level }, pino.destination({ dest: 2, sync: true }));
}

class Logger {
  private config: LoggerConfig = { verbose: false, quiet: false };
  private pino: pino.Logger;

  constructor() {
    this.pino = createPinoInstance(resolveLevel(this.config));
  }

  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
    this.pino = createPinoInstance(resolveLevel(this.config));
  }

  /**
   * Create a child logger with bound context fields.
   */
  child(bindings: Record<string, unknown>): Logger {
    const childLogger = Object.create(this) as Logger;
    childLogger.pino = this.pino.child(bindings);
    return childLogger;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.debug(data, message);
    } else {
      this.pino.debug(message);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.info(data, message);
    } else {
      this.pino.info(message);
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.warn(data, message);
    } else {
      this.pino.warn(message);
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.pino.error(data, message);
    } else {
      this.pino.error(message);
    }
  }
}

export const logger = new Logger();

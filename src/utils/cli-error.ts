// FILE: src/utils/cli-error.ts
// UF-089: Shared CLI error handling — wraps errors in user-friendly messages,
// maps common failures to actionable suggestions, hides stack traces from users.

import { logger } from "./logger.js";

interface ErrorHint {
  match: (err: Error) => boolean;
  message: string;
  suggestion: string;
}

const ERROR_HINTS: ErrorHint[] = [
  {
    match: (err) => /ECONNREFUSED/.test(err.message),
    message: "Could not connect to the Unfade server.",
    suggestion: 'Run "unfade server" to start it, or use the command directly without the server.',
  },
  {
    match: (err) => /ollama/i.test(err.message) || /ECONNREFUSED.*11434/.test(err.message),
    message: "Ollama does not appear to be running.",
    suggestion: 'Install Ollama from https://ollama.com and run "ollama serve" before distilling.',
  },
  {
    match: (err) => /\.unfade/.test(err.message) && /ENOENT/.test(err.message),
    message: "No .unfade/ directory found.",
    suggestion: 'Run "unfade" to set up your project.',
  },
  {
    match: (err) => /not a git repository/i.test(err.message) || /ENOENT.*\.git/.test(err.message),
    message: "This directory is not a git repository.",
    suggestion: "Run this command from inside a git repository.",
  },
  {
    match: (err) => /EACCES|EPERM/.test(err.message),
    message: "Permission denied.",
    suggestion: "Check file permissions for the .unfade/ directory.",
  },
];

/**
 * Handle a CLI command error: log a user-friendly message to stderr,
 * log the stack trace at debug level (--verbose), set exit code.
 */
export function handleCliError(err: unknown, commandName: string): void {
  const error = err instanceof Error ? err : new Error(String(err));

  // Check for a known error hint
  for (const hint of ERROR_HINTS) {
    if (hint.match(error)) {
      logger.error(`${hint.message}\n  ${hint.suggestion}`);
      logger.debug(`[${commandName}] ${error.stack ?? error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  // Generic fallback
  logger.error(`${commandName} failed: ${error.message}`);
  logger.debug(`[${commandName}] ${error.stack ?? error.message}`);
  process.exitCode = 1;
}

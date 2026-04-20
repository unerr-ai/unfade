// FILE: src/cli/ui.ts
// Centralized CLI terminal UI utilities.
// chalk theme, ora spinner helpers, stderr output functions.
// All output goes to stderr — stdout is sacred for MCP.

import chalk from "chalk";
import ora, { type Ora } from "ora";

// ---------------------------------------------------------------------------
// Theme — kap10 palette mapped to chalk
// ---------------------------------------------------------------------------

export const theme = {
  accent: chalk.hex("#8B5CF6"),
  accentDim: chalk.hex("#7C3AED"),
  cyan: chalk.hex("#22D3EE"),
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  muted: chalk.dim,
  bold: chalk.bold,
  brand: chalk.hex("#8B5CF6").bold,
} as const;

// ---------------------------------------------------------------------------
// Output helpers — always stderr
// ---------------------------------------------------------------------------

export function writeLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function writeBlank(): void {
  process.stderr.write("\n");
}

// ---------------------------------------------------------------------------
// Step rendering (init flow)
// ---------------------------------------------------------------------------

export function stepDone(label: string, detail?: string): void {
  const suffix = detail ? theme.muted(` (${detail})`) : "";
  writeLine(`  ${theme.success("✓")} ${label}${suffix}`);
}

export function stepSkipped(label: string): void {
  writeLine(`  ${theme.muted("–")} ${theme.muted(label)} ${theme.muted("(already done)")}`);
}

export function stepFailed(label: string, error: string): void {
  writeLine(`  ${theme.warning("✗")} ${label} ${theme.muted(`— ${error}`)}`);
}

// ---------------------------------------------------------------------------
// Spinner — wraps ora, writes to stderr
// ---------------------------------------------------------------------------

export function spinner(text: string): Ora {
  return ora({ text, stream: process.stderr });
}

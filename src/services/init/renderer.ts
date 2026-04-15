// FILE: src/services/init/renderer.ts
// Init progress renderer — writes to stderr using picocolors.
// No Ink/React — plain stderr output with checkmarks and status lines.

import pc from "picocolors";
import { USER_TERMS } from "../../constants/terminology.js";
import type { InitStepName } from "../../schemas/init-progress.js";

const STEP_LABELS: Record<InitStepName, string> = {
  scaffold: `Created ${USER_TERMS.unfadeDir}/ directory`,
  fingerprint: "Analyzed project history",
  binary: `Downloaded ${USER_TERMS.daemon}`,
  "shell-hooks": "Installed shell hooks",
  autostart: "Registered auto-start",
  "llm-detect": "Detected LLM provider",
  "start-daemon": `Started ${USER_TERMS.daemon}`,
  backfill: "Backfilled git history",
};

/**
 * Write a line to stderr. All init output goes to stderr (stdout is sacred).
 */
function writeLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Render the welcome banner.
 */
export function renderBanner(): void {
  writeLine("");
  writeLine(pc.bold(pc.cyan("  Welcome to Unfade")));
  writeLine(pc.dim("  Passive reasoning capture for developers"));
  writeLine("");
}

/**
 * Render a step as completed.
 */
export function renderStepDone(step: InitStepName, detail?: string): void {
  const label = STEP_LABELS[step];
  const suffix = detail ? pc.dim(` (${detail})`) : "";
  writeLine(`  ${pc.green("✓")} ${label}${suffix}`);
}

/**
 * Render a step as skipped (already done on re-run).
 */
export function renderStepSkipped(step: InitStepName): void {
  const label = STEP_LABELS[step];
  writeLine(`  ${pc.dim("–")} ${pc.dim(label)} ${pc.dim("(already done)")}`);
}

/**
 * Render a step as failed (non-fatal).
 */
export function renderStepFailed(step: InitStepName, error: string): void {
  const label = STEP_LABELS[step];
  writeLine(`  ${pc.yellow("✗")} ${label} ${pc.dim(`— ${error}`)}`);
}

/**
 * Render a step as in-progress (spinner placeholder — just shows the label).
 */
export function renderStepStart(step: InitStepName): void {
  const label = STEP_LABELS[step];
  writeLine(`  ${pc.dim("…")} ${pc.dim(label)}`);
}

/**
 * Render the first distill result.
 */
export function renderFirstDistill(eventsProcessed: number, decisions: number, date: string): void {
  writeLine("");
  writeLine(`  ${pc.green("✓")} Generated your first reasoning summary`);
  writeLine(pc.dim(`    ${eventsProcessed} events → ${decisions} decisions (${date})`));
}

/**
 * Render the completion message.
 */
export function renderComplete(): void {
  writeLine("");
  writeLine(pc.bold("  Unfade is running.") + pc.dim(" Your first distill arrives at 6:00 PM."));
  writeLine(
    pc.dim("  Open your dashboard: ") +
      pc.cyan("unfade") +
      pc.dim(" (terminal) / ") +
      pc.cyan("unfade open") +
      pc.dim(" (browser)"),
  );
  writeLine("");
}

/**
 * Render a resumed-init message.
 */
export function renderResumed(): void {
  writeLine(pc.dim("  Resuming from previous init..."));
  writeLine("");
}

/**
 * Render a shell hook info line (not a prompt — informational only).
 */
export function renderShellHookInfo(shell: string): void {
  writeLine(pc.dim(`    Installed for ${shell}. Disable anytime: unfade open → Settings`));
}

/**
 * Render LLM detection result.
 */
export function renderLlmResult(provider: string, model: string | null): void {
  if (provider === "none") {
    writeLine(pc.dim("    Using structured summaries (no LLM detected)"));
  } else {
    writeLine(pc.dim(`    Provider: ${provider}, Model: ${model ?? "default"}`));
  }
}

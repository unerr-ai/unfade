// FILE: src/services/init/renderer.ts
// Init progress renderer — writes to stderr using centralized CLI UI.
// No Ink/React — plain stderr output with checkmarks and status lines.

import { stepDone, stepFailed, stepSkipped, theme, writeBlank, writeLine } from "../../cli/ui.js";
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
 * Render the welcome banner.
 */
export function renderBanner(): void {
  writeBlank();
  writeLine(`  ${theme.brand("Unfade")}`);
  writeLine(theme.muted("  Passive reasoning capture for developers"));
  writeBlank();
}

/**
 * Render a step as completed.
 */
export function renderStepDone(step: InitStepName, detail?: string): void {
  stepDone(STEP_LABELS[step], detail);
}

/**
 * Render a step as skipped (already done on re-run).
 */
export function renderStepSkipped(step: InitStepName): void {
  stepSkipped(STEP_LABELS[step]);
}

/**
 * Render a step as failed (non-fatal).
 */
export function renderStepFailed(step: InitStepName, error: string): void {
  stepFailed(STEP_LABELS[step], error);
}

/**
 * Render the first distill result.
 */
export function renderFirstDistill(eventsProcessed: number, decisions: number, date: string): void {
  writeBlank();
  stepDone("Generated your first reasoning summary");
  writeLine(theme.muted(`    ${eventsProcessed} events → ${decisions} decisions (${date})`));
}

/**
 * Render the completion message with web URL, capture sources, and next steps.
 */
export function renderComplete(serverPort?: number, ingestMessage?: string | null): void {
  writeBlank();
  writeLine(`  ${theme.bold("Unfade is running.")}`);
  writeLine(`  ${theme.muted("Capturing:")} git commits, AI sessions, terminal activity`);
  if (ingestMessage) {
    writeLine(`  ${theme.accent("◆")} ${theme.muted(ingestMessage)}`);
  }
  if (serverPort) {
    writeLine(`  ${theme.muted("Web UI:")} ${theme.cyan(`http://localhost:${serverPort}`)}`);
  }
  writeBlank();
  writeLine(
    `  ${theme.muted("Next:")} ${theme.cyan("unfade")} ${theme.muted("to see your dashboard")}`,
  );
  writeLine(
    `  ${theme.muted("      ")} ${theme.cyan("unfade distill")} ${theme.muted("for instant reasoning summary")}`,
  );
  writeLine(
    `  ${theme.muted("      ")} ${theme.cyan("unfade open")} ${theme.muted("to open the web UI")}`,
  );
  writeBlank();
}

/**
 * Render a resumed-init message.
 */
export function renderResumed(): void {
  writeLine(theme.muted("  Resuming from previous init..."));
  writeBlank();
}

/**
 * Render a shell hook info line (not a prompt — informational only).
 */
export function renderShellHookInfo(shell: string): void {
  writeLine(theme.muted(`    Installed for ${shell}. Disable anytime: unfade open → Settings`));
}

/**
 * Render LLM detection result.
 */
export function renderLlmResult(provider: string, model: string | null, serverPort?: number): void {
  if (provider === "none") {
    writeLine(theme.muted("    No LLM detected — using structured summaries (basic)"));
    const settingsHint = serverPort
      ? theme.cyan(`http://localhost:${serverPort}/settings`)
      : `${theme.cyan("unfade open")} ${theme.muted("→ Settings")}`;
    writeLine(
      `    ${theme.muted("Add Ollama, OpenAI, Anthropic, or any OpenAI-compatible API:")} ${settingsHint}`,
    );
  } else {
    const label = provider === "custom" ? "OpenAI-compatible" : provider;
    writeLine(theme.muted(`    Provider: ${label}, Model: ${model ?? "default"}`));
  }
}

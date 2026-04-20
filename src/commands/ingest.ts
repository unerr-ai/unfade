import * as clack from "@clack/prompts";
import { spinner, theme, writeBlank, writeLine } from "../cli/ui.js";
import { handleCliError } from "../utils/cli-error.js";
import { queryDaemonStatus, queryIngestStatus, triggerIngest } from "../utils/ipc.js";

/**
 * Parse a human-readable duration string into days.
 * Supports: "7d", "2w", "30d", "1m" (month=30d).
 */
function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)\s*(d|w|m)$/i);
  if (!match) return null;

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "d":
      return value;
    case "w":
      return value * 7;
    case "m":
      return value * 30;
    default:
      return null;
  }
}

/**
 * `unfade ingest` — trigger historical AI session data ingestion.
 *
 * --since <duration>: specify how far back to ingest (e.g., "7d", "2w", "30d")
 * --status: show current ingest progress
 *
 * Interactive mode (TTY): shows discovery wizard before starting.
 * Non-interactive (CI/piped): uses defaults silently.
 */
export async function ingestCommand(opts: { since?: string; status?: boolean }): Promise<void> {
  try {
    if (opts.status) {
      await showIngestStatus();
      return;
    }

    const daemonResp = await queryDaemonStatus();
    if (!daemonResp.ok) {
      writeLine(
        `${theme.error("✗")} Capture engine is not running. Run ${theme.bold("unfade init")} first.`,
      );
      process.exitCode = 1;
      return;
    }

    if (opts.since) {
      const days = parseDuration(opts.since);
      if (!days) {
        writeLine(
          `${theme.error("✗")} Invalid duration: "${opts.since}". Use format like 7d, 2w, or 1m.`,
        );
        process.exitCode = 1;
        return;
      }
      await startIngest(days);
      return;
    }

    if (!process.stderr.isTTY) {
      await startIngest(7);
      return;
    }

    await interactiveWizard();
  } catch (err) {
    handleCliError(err, "ingest");
  }
}

async function interactiveWizard(): Promise<void> {
  const statusResp = await queryIngestStatus();
  const currentStatus = statusResp.ok ? (statusResp.data?.status as string) : null;

  if (currentStatus === "running") {
    writeLine(`${theme.warning("◆")} Historical ingest is already running.`);
    writeLine(theme.muted("  Run `unfade ingest --status` to check progress."));
    return;
  }

  writeBlank();
  clack.intro(theme.brand("Historical Ingest"));

  writeLine("");
  writeLine("  Unfade can process your existing AI session history to");
  writeLine("  bootstrap your reasoning profile immediately.");
  writeLine("");
  writeLine(theme.muted("  Sources scanned:"));
  writeLine(theme.muted("    • Claude Code  (~/.claude/projects/)"));
  writeLine(theme.muted("    • Cursor       (~/.cursor/ai-tracking/)"));
  writeLine(theme.muted("    • Codex CLI    (~/.codex/sessions/)"));
  writeLine(theme.muted("    • Aider        (.aider.chat.history.md)"));
  writeLine("");
  writeLine(theme.muted("  Processing uses zero LLM tokens — pure heuristic extraction."));
  writeLine(theme.muted("  Runs in the background. Non-blocking."));

  const timeline = await clack.select({
    message: "How far back should we ingest?",
    options: [
      { value: 7, label: "1 week", hint: "recommended — fast, immediate value" },
      { value: 14, label: "2 weeks" },
      { value: 30, label: "1 month", hint: "more history, takes a few minutes" },
      { value: 90, label: "3 months", hint: "deep history" },
    ],
    initialValue: 7,
  });

  if (clack.isCancel(timeline)) {
    clack.outro(theme.muted("Cancelled."));
    return;
  }

  const days = timeline as number;

  const confirm = await clack.confirm({
    message: `Ingest ${days} days of AI session history?`,
    initialValue: true,
  });

  if (clack.isCancel(confirm) || !confirm) {
    clack.outro(theme.muted("Cancelled."));
    return;
  }

  await startIngest(days);

  clack.outro(
    `Background ingest started for ${days} days. Run ${theme.bold("unfade ingest --status")} to track progress.`,
  );
}

async function startIngest(days: number): Promise<void> {
  const s = spinner(`Starting ${days}-day historical ingest...`);
  s.start();

  const resp = await triggerIngest(days);

  if (resp.ok) {
    s.stop();
    writeLine(
      `${theme.success("✓")} Historical ingest started (${days} days). Processing in background.`,
    );
    writeLine(theme.muted("  Run `unfade ingest --status` to track progress."));
  } else {
    s.stop();
    writeLine(`${theme.error("✗")} ${resp.error ?? "Failed to start ingest"}`);
    process.exitCode = 1;
  }
}

/**
 * UF-115: Poll daemon IPC for ingest progress and display it.
 */
async function showIngestStatus(): Promise<void> {
  const resp = await queryIngestStatus();

  if (!resp.ok) {
    writeLine(`${theme.error("✗")} ${resp.error ?? "Could not query ingest status"}`);
    process.exitCode = 1;
    return;
  }

  const data = resp.data;
  if (!data) {
    writeLine(theme.muted("No ingest data available."));
    return;
  }

  const status = data.status as string;

  writeBlank();
  switch (status) {
    case "idle":
      writeLine(`${theme.muted("○")} No ingest running.`);
      writeLine(theme.muted(`  Start one with: unfade ingest --since 7d`));
      break;

    case "running": {
      writeLine(`${theme.accent("◆")} Historical ingest in progress`);
      if (data.since) {
        writeLine(theme.muted(`  Timeline: since ${data.since}`));
      }
      if (data.total_events !== undefined) {
        writeLine(theme.muted(`  Events emitted: ${data.total_events}`));
      }
      if (data.started_at) {
        const elapsed = elapsedSince(data.started_at as string);
        writeLine(theme.muted(`  Elapsed: ${elapsed}`));
      }
      break;
    }

    case "completed": {
      writeLine(`${theme.success("✓")} Historical ingest completed`);
      if (data.total_events !== undefined) {
        writeLine(theme.muted(`  Total events: ${data.total_events}`));
      }
      if (data.completed_at) {
        writeLine(theme.muted(`  Completed: ${data.completed_at}`));
      }
      break;
    }

    case "failed": {
      writeLine(`${theme.error("✗")} Historical ingest failed`);
      if (data.error) {
        writeLine(theme.muted(`  Error: ${data.error}`));
      }
      break;
    }

    default:
      writeLine(theme.muted(`Ingest status: ${status}`));
  }
  writeBlank();
}

function elapsedSince(isoDate: string): string {
  const start = new Date(isoDate).getTime();
  const now = Date.now();
  const seconds = Math.round((now - start) / 1000);

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

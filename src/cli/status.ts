import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { USER_TERMS } from "../constants/terminology.js";
import type { DailyMetricSnapshot } from "../schemas/metrics.js";
import type { ReasoningModelV2 } from "../schemas/profile.js";
import { countEvents } from "../services/capture/event-store.js";
import { normalizeOllamaOriginForChecks } from "../services/distill/providers/ai.js";
import {
  loadFirstRunReport,
  tryGenerateFirstRunReport,
} from "../services/intelligence/first-run-trigger.js";
import { presentMetric } from "../services/intelligence/presentation.js";
import { readSnapshots } from "../services/intelligence/snapshot.js";
import { detectState } from "../state/detector.js";
import { queryDaemonStatus, queryIngestStatus } from "../utils/ipc.js";
import { getDistillsDir, getProfileDir } from "../utils/paths.js";
import { theme, writeBlank, writeLine } from "./ui.js";

function loadProfile(cwd?: string): ReasoningModelV2 | null {
  const profilePath = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(profilePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
    if (parsed.version === 2) return parsed as ReasoningModelV2;
    return null;
  } catch {
    return null;
  }
}

function loadLatestDistill(
  cwd?: string,
): { date: string; summary: string; decisions: string[] } | null {
  const dir = getDistillsDir(cwd);
  if (!existsSync(dir)) return null;

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse();
  } catch {
    return null;
  }

  if (files.length === 0) return null;

  const date = files[0].replace(".md", "");
  const mdPath = join(dir, files[0]);
  try {
    const content = readFileSync(mdPath, "utf-8");
    const lines = content.split("\n");

    let summary = "";
    const decisions: string[] = [];
    let inDecisions = false;

    for (const line of lines) {
      if (line.startsWith("> ") && !summary) {
        summary = line.slice(2).trim();
      }
      if (line.startsWith("## ")) {
        inDecisions = line.slice(3).trim().toLowerCase() === "decisions";
        continue;
      }
      if (inDecisions && line.startsWith("- **")) {
        const match = line.match(/^- \*\*(.+?)\*\*/);
        if (match) decisions.push(match[1]);
      }
    }

    return { date, summary, decisions };
  } catch {
    return null;
  }
}

function loadLatestSnapshot(cwd?: string): DailyMetricSnapshot | null {
  const snapshots = readSnapshots(undefined, cwd);
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

function personalizationLabel(distillCount: number): { bar: string; label: string } {
  let level: number;
  let label: string;
  if (distillCount === 0) {
    level = 0;
    label = "New";
  } else if (distillCount <= 2) {
    level = 1;
    label = "Learning";
  } else if (distillCount <= 6) {
    level = 2;
    label = "Developing";
  } else if (distillCount <= 14) {
    level = 3;
    label = "Established";
  } else if (distillCount <= 29) {
    level = 4;
    label = "Deep";
  } else {
    level = 5;
    label = "Expert";
  }

  const filled = "█".repeat(level);
  const empty = "░".repeat(5 - level);
  return { bar: `${filled}${empty}`, label };
}

async function checkLlmReachability(
  provider: string,
  apiBase?: string,
): Promise<"reachable" | "unreachable" | "skip"> {
  if (provider === "none") return "skip";
  if (provider !== "ollama") return "skip";

  const origin = normalizeOllamaOriginForChecks(apiBase);
  try {
    const resp = await fetch(`${origin}/api/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return resp.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function getIngestInfo(): Promise<{
  status: string;
  totalEvents?: number;
} | null> {
  try {
    const resp = await queryIngestStatus();
    if (!resp.ok || !resp.data) return null;
    return {
      status: resp.data.status as string,
      totalEvents: resp.data.total_events as number | undefined,
    };
  } catch {
    return null;
  }
}

async function getWatcherInfo(): Promise<Record<string, string[]> | null> {
  try {
    const resp = await queryDaemonStatus();
    if (!resp.ok || !resp.data?.watchers) return null;
    return resp.data.watchers as Record<string, string[]>;
  } catch {
    return null;
  }
}

/**
 * Print one-shot status display to stderr.
 * Now async: checks LLM reachability, ingest progress, active watchers.
 */
export async function printStatus(config: {
  provider: string;
  model: string;
  httpPort: number;
  /** Ollama host (from `distill.apiBase`); used for reachability check. */
  apiBase?: string;
  /** After chained first-run, skip the generic Commands footer (runner already showed next steps). */
  omitCommandsFooter?: boolean;
}): Promise<void> {
  const state = detectState({ skipLlmCheck: true });
  const today = new Date().toISOString().slice(0, 10);
  const eventCount = countEvents(today);
  const profile = loadProfile();
  const distill = loadLatestDistill();
  const snapshot = loadLatestSnapshot();

  const [llmStatus, ingestInfo, watchers] = await Promise.all([
    checkLlmReachability(config.provider, config.apiBase),
    getIngestInfo(),
    state.checks.daemonRunning ? getWatcherInfo() : Promise.resolve(null),
  ]);

  writeBlank();
  writeLine(`  ${theme.brand("Unfade")}`);
  writeBlank();

  // --- Daemon status + events ---
  const statusIcon = state.checks.daemonRunning ? theme.success("●") : theme.warning("○");
  const statusText = state.checks.daemonRunning
    ? USER_TERMS.daemonRunning
    : USER_TERMS.daemonStopped;
  writeLine(
    `  ${statusIcon} ${statusText}    ${theme.muted("Today:")} ${theme.bold(String(eventCount))} ${theme.muted(`event${eventCount === 1 ? "" : "s"}`)}`,
  );

  // Active watchers — show what's being monitored
  if (watchers) {
    const watcherParts: string[] = [];
    for (const [name, paths] of Object.entries(watchers)) {
      if (paths.length > 0) {
        watcherParts.push(`${name} (${paths.length})`);
      }
    }
    if (watcherParts.length > 0) {
      writeLine(`    ${theme.muted("Watching:")} ${theme.muted(watcherParts.join(", "))}`);
    }
  }

  // --- LLM with reachability ---
  if (config.provider === "none") {
    writeLine(
      `  ${theme.warning("⚠")} ${theme.warning("No LLM configured")} ${theme.muted("— configure at")} ${theme.cyan(`http://localhost:${config.httpPort}/settings`)}`,
    );
  } else if (llmStatus === "unreachable") {
    writeLine(
      `  ${theme.muted("Distill:")} ${theme.warning(`${config.provider}/${config.model}`)} ${theme.warning("⚠ unreachable")}`,
    );
    if (config.provider === "ollama") {
      writeLine(
        `    ${theme.muted("Start Ollama for rich summaries, or distill will use basic mode")}`,
      );
    }
  } else {
    writeLine(
      `  ${theme.muted("Distill:")} ${theme.success(`${config.provider}/${config.model}`)}${llmStatus === "reachable" ? theme.success(" ✓") : ""}`,
    );
  }

  // --- Web UI ---
  writeLine(`  ${theme.muted("Web:")} ${theme.cyan(`http://localhost:${config.httpPort}`)}`);

  // --- Ingest progress ---
  if (ingestInfo) {
    switch (ingestInfo.status) {
      case "running":
        writeLine(
          `  ${theme.accent("◆")} ${theme.muted("Ingesting AI session history...")}${ingestInfo.totalEvents ? theme.muted(` (${ingestInfo.totalEvents} events so far)`) : ""}`,
        );
        break;
      case "completed":
        if (ingestInfo.totalEvents && ingestInfo.totalEvents > 0) {
          writeLine(
            `  ${theme.success("✓")} ${theme.muted(`Historical: ${ingestInfo.totalEvents} events ingested`)}`,
          );
        }
        break;
    }
  }

  // --- First-Run Revelation (Phase 5.6 §23 Capability 6) ---
  const existingReport = loadFirstRunReport();
  const firstRunReport = existingReport ?? tryGenerateFirstRunReport();

  if (firstRunReport && !distill) {
    writeBlank();
    writeLine(`  ${theme.brand(`◆ Your first ${firstRunReport.daysAnalyzed} days with Unfade`)}`);
    writeLine(
      `    ${theme.bold(String(firstRunReport.aiInteractions))} AI interactions${firstRunReport.gitEvents > 0 ? `, ${firstRunReport.gitEvents} commits` : ""}`,
    );

    if (firstRunReport.directionDensity > 0) {
      const pct = firstRunReport.directionDensity;
      const label =
        pct >= 60
          ? "you steer more than you follow"
          : pct >= 40
            ? "balanced collaboration"
            : "model-led";
      writeLine(`    ${theme.bold.cyan(`${pct}% human-directed`)} ${theme.muted(`— ${label}`)}`);
    }

    if (firstRunReport.domains.length > 0) {
      const top = firstRunReport.domains[0];
      writeLine(
        `    ${theme.muted("Strongest domain:")} ${theme.accent(top.domain)} ${theme.muted(`(${top.directionDensity}% direction)`)}`,
      );
    }

    if (firstRunReport.highestAcceptVerbatim) {
      const hav = firstRunReport.highestAcceptVerbatim;
      writeLine(
        `    ${theme.muted("Highest accept-verbatim:")} ${theme.warning(hav.domain)} ${theme.muted(`(${hav.acceptRate}%)`)}`,
      );
    }

    const toolNames = Object.keys(firstRunReport.toolBreakdown);
    if (toolNames.length > 0) {
      const toolStr = toolNames.map((t) => `${t} (${firstRunReport.toolBreakdown[t]})`).join(", ");
      writeLine(`    ${theme.muted("Tools:")} ${theme.muted(toolStr)}`);
    }
  }

  // --- RDI + Identity (from metric snapshot) ---
  if (snapshot && snapshot.rdi > 0) {
    const rdiHistory = readSnapshots().map((s) => s.rdi);
    const rdiPresentation = presentMetric("rdi", snapshot.rdi, rdiHistory);

    writeLine(
      `  ${theme.bold.cyan("◆")} ${theme.bold(`RDI: ${snapshot.rdi}`)} ${theme.muted("—")} ${theme.muted(rdiPresentation.label)}`,
    );

    if (snapshot.identityLabels.length > 0) {
      writeLine(
        `    ${theme.muted("Identity:")} ${snapshot.identityLabels.map((l) => theme.accent(l)).join(", ")}`,
      );
    }
  } else {
    // Personalization bar (legacy fallback when no RDI yet)
    const distillCount = profile?.dataPoints ?? 0;
    const { bar, label } = personalizationLabel(distillCount);
    if (distillCount > 0) {
      writeLine(
        `  ${theme.muted(`${USER_TERMS.profile}:`)} ${theme.accent(bar)} ${theme.muted(label)} ${theme.muted(`(${distillCount} distill${distillCount === 1 ? "" : "s"})`)}`,
      );
    } else {
      writeLine(
        `  ${theme.muted(`${USER_TERMS.profile}: building`)} ${theme.muted("— first distill creates your baseline")}`,
      );
    }
  }

  // --- Latest distill ---
  if (distill) {
    writeBlank();
    writeLine(`  ${theme.bold(`Latest distill — ${distill.date}`)}`);
    if (distill.summary) {
      writeLine(`  ${theme.muted(distill.summary)}`);
    }
    for (const d of distill.decisions.slice(0, 3)) {
      writeLine(`  ${theme.success("●")} ${d}`);
    }
    if (distill.decisions.length > 3) {
      writeLine(theme.muted(`    ...and ${distill.decisions.length - 3} more`));
    }
  } else {
    writeBlank();
    writeLine(theme.muted("  Capturing git commits, AI sessions, and terminal activity."));

    // Contextual next-step guidance
    const scheduleHint = theme.muted("Next auto-distill: 6:00 PM today");
    writeLine(
      `  ${scheduleHint} ${theme.muted("·")} ${theme.cyan("unfade distill")} ${theme.muted("for instant results")}`,
    );
  }

  // --- Commands ---
  if (!config.omitCommandsFooter) {
    writeBlank();
    writeLine(
      `  ${theme.muted("Commands:")} ${theme.cyan("unfade distill")}${theme.muted(",")} ${theme.cyan("unfade open")}${theme.muted(",")} ${theme.cyan("unfade query <search>")}${theme.muted(",")} ${theme.cyan("unfade status")}`,
    );
    writeBlank();
  } else {
    writeBlank();
  }
}

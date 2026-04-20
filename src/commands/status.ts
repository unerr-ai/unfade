import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { ReasoningModelV2 } from "../schemas/profile.js";
import { generateInsight } from "../services/intelligence/insights.js";
import { presentMetric } from "../services/intelligence/presentation.js";
import { readSnapshots } from "../services/intelligence/snapshot.js";
import { getProfileDir } from "../utils/paths.js";

/**
 * `unfade status` — compact CLI display of today's reasoning metrics.
 * All output goes to stderr (stdout is sacred for MCP).
 */
export async function statusCommand(): Promise<void> {
  const snapshots = readSnapshots();
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  if (!latest) {
    printBootstrap();
    return;
  }

  const profile = loadProfile();
  const rdiHistory = snapshots.map((s) => s.rdi);
  const rdiPresentation = presentMetric("rdi", latest.rdi, rdiHistory);

  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${chalk.bold.cyan("◆")} ${chalk.bold(`RDI: ${latest.rdi}`)} — ${chalk.dim(rdiPresentation.label)}`,
  );
  lines.push(`    ${chalk.dim(rdiPresentation.framing)}`);

  if (rdiPresentation.improvement) {
    lines.push(`    ${chalk.yellow("→")} ${chalk.dim(rdiPresentation.improvement)}`);
  }

  if (latest.identityLabels.length > 0) {
    lines.push(
      `  ${chalk.dim("Identity:")} ${latest.identityLabels.map((l) => chalk.magenta(l)).join(", ")}`,
    );
  }

  const trendArrow = formatTrendArrow(rdiPresentation.trend);
  if (trendArrow) {
    lines.push(`  ${chalk.dim("Trend:")} ${trendArrow}`);
  }

  lines.push(
    `  ${chalk.dim(`${latest.decisionsCount} decisions · ${latest.topDomain ?? "—"} · ${latest.date}`)}`,
  );

  const insight = generateInsight(profile, snapshots);
  if (insight) {
    lines.push("");
    lines.push(`  ${chalk.yellow("✦")} ${insight}`);
  }

  lines.push("");

  process.stderr.write(`${lines.join("\n")}\n`);
}

function printBootstrap(): void {
  const lines = [
    "",
    `  ${chalk.bold.cyan("◆")} ${chalk.dim("Unfade Intelligence")}`,
    "",
    `  No distills yet. Run ${chalk.bold("unfade distill")} or wait for tonight's auto-distill.`,
    `  Once you have reasoning data, this will show your Reasoning Depth Index,`,
    `  identity labels, and personalized insights.`,
    "",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function formatTrendArrow(trend: "up" | "down" | "stable" | null): string | null {
  if (!trend) return null;
  switch (trend) {
    case "up":
      return `${chalk.green("↑")} improving`;
    case "down":
      return `${chalk.red("↓")} recalibrating`;
    case "stable":
      return `${chalk.dim("→")} stable`;
  }
}

function loadProfile(): ReasoningModelV2 | null {
  const profilePath = join(getProfileDir(), "reasoning_model.json");
  if (!existsSync(profilePath)) return null;
  try {
    const data = JSON.parse(readFileSync(profilePath, "utf-8"));
    if (data.version === 2) return data as ReasoningModelV2;
    return null;
  } catch {
    return null;
  }
}

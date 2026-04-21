// FILE: src/commands/export.ts
// `unfade export [--output path]` — create portable .tar.gz archive of .unfade/ data.
// `unfade export --leadership` — create aggregate-only export for leadership/finance.
// Excludes ephemeral state (sockets, PIDs, health) and binaries.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { theme } from "../cli/ui.js";
import { loadConfig } from "../config/manager.js";
import { handleCliError } from "../utils/cli-error.js";
import { getProjectDataDir } from "../utils/paths.js";

const INCLUDE_DIRS = ["events", "distills", "graph", "profile", "amplification", "cards"];
const INCLUDE_FILES = ["config.json"];

interface ExportManifest {
  exportDate: string;
  dateRange: { from: string | null; to: string | null };
  eventCount: number;
  distillCount: number;
}

function countAndRange(dir: string): { count: number; from: string | null; to: string | null } {
  if (!existsSync(dir)) return { count: 0, from: null, to: null };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"))
    .sort();
  if (files.length === 0) return { count: 0, from: null, to: null };
  const dates = files
    .map((f) => f.replace(/\.(jsonl|json)$/, ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return {
    count: files.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

function buildManifest(dataDir: string): ExportManifest {
  const events = countAndRange(join(dataDir, "events"));
  const distills = countAndRange(join(dataDir, "distills"));
  const allFroms = [events.from, distills.from].filter(Boolean) as string[];
  const allTos = [events.to, distills.to].filter(Boolean) as string[];
  return {
    exportDate: new Date().toISOString().slice(0, 10),
    dateRange: {
      from: allFroms.length > 0 ? allFroms.sort()[0] : null,
      to: allTos.length > 0 ? allTos.sort().reverse()[0] : null,
    },
    eventCount: events.count,
    distillCount: distills.count,
  };
}

export async function exportCommand(
  opts: { output?: string; json?: boolean; leadership?: boolean; yes?: boolean } = {},
): Promise<void> {
  try {
    if (opts.leadership) {
      return await leadershipExport(opts);
    }
    return await standardExport(opts);
  } catch (err) {
    handleCliError(err, "export");
  }
}

async function standardExport(opts: { output?: string; json?: boolean }): Promise<void> {
  const startMs = Date.now();
  const dataDir = getProjectDataDir();

  if (!existsSync(dataDir)) {
    process.stderr.write(
      `${theme.error("Error:")} No ${theme.bold(".unfade/")} directory found. Run ${theme.bold("unfade")} first.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const outputPath = resolve(opts.output ?? `unfade-export-${today}.tar.gz`);
  const stagingDir = join(dataDir, ".export-staging");
  const stagingUnfade = join(stagingDir, ".unfade");

  try {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingUnfade, { recursive: true });

    for (const dir of INCLUDE_DIRS) {
      const srcDir = join(dataDir, dir);
      if (existsSync(srcDir)) {
        execSync(`cp -r ${JSON.stringify(srcDir)} ${JSON.stringify(join(stagingUnfade, dir))}`);
      }
    }

    for (const file of INCLUDE_FILES) {
      const srcFile = join(dataDir, file);
      if (existsSync(srcFile)) {
        execSync(`cp ${JSON.stringify(srcFile)} ${JSON.stringify(join(stagingUnfade, file))}`);
      }
    }

    const manifest = buildManifest(dataDir);
    writeFileSync(join(stagingUnfade, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    execSync(`tar -czf ${JSON.stringify(outputPath)} -C ${JSON.stringify(stagingDir)} .unfade`);

    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ data: { outputPath, manifest }, _meta: { tool: "export", durationMs: Date.now() - startMs } })}\n`,
      );
      return;
    }

    process.stderr.write(`${theme.success("✓")} Exported to ${theme.bold(outputPath)}\n`);
    process.stderr.write(
      theme.muted(`  Events: ${manifest.eventCount}, Distills: ${manifest.distillCount}\n`),
    );
    if (manifest.dateRange.from && manifest.dateRange.to) {
      process.stderr.write(
        theme.muted(`  Date range: ${manifest.dateRange.from} → ${manifest.dateRange.to}\n`),
      );
    }
  } finally {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function leadershipExport(opts: {
  output?: string;
  json?: boolean;
  yes?: boolean;
}): Promise<void> {
  const { rebuildGlobalIndex, globalIndexToCSV } = await import(
    "../services/intelligence/global-index.js"
  );
  const { generateMethodology } = await import("../services/intelligence/methodology.js");

  const config = loadConfig();

  if (config.export.requireConsent && !opts.yes) {
    const { loadRegistry } = await import("../services/registry/registry.js");
    const registry = loadRegistry();
    const repoCount = registry.repos.length;

    process.stderr.write(`\n  ${theme.brand("Leadership Export")}\n\n`);
    process.stderr.write(
      `  This export contains ${theme.bold("aggregate metrics")} for ${theme.bold(String(repoCount))} repo${repoCount !== 1 ? "s" : ""}.\n`,
    );
    process.stderr.write(
      `  ${theme.success("Included:")} direction density, comprehension scores, event counts, cost proxies\n`,
    );
    process.stderr.write(
      `  ${theme.error("Excluded:")} raw prompts, conversation text, file contents, code\n`,
    );
    process.stderr.write(`  Redaction policy: ${theme.bold(config.export.redactionPolicy)}\n\n`);

    const confirmed = await promptConfirm("  Proceed? [y/N] ");
    if (!confirmed) {
      process.stderr.write(theme.muted("  Export cancelled.\n\n"));
      return;
    }
  }

  const index = rebuildGlobalIndex();
  const csvs = globalIndexToCSV(index);
  const methodology = generateMethodology();

  const today = new Date().toISOString().slice(0, 10);
  const outputPath = resolve(opts.output ?? `unfade-leadership-${today}.tar.gz`);

  const stagingDir = join(getProjectDataDir(), ".leadership-staging");
  const stagingContent = join(stagingDir, "unfade-leadership");

  try {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingContent, { recursive: true });

    writeFileSync(join(stagingContent, "spend_by_repo.csv"), csvs.spendByRepo, "utf-8");
    writeFileSync(
      join(stagingContent, "direction_density_by_repo.csv"),
      csvs.directionByRepo,
      "utf-8",
    );
    writeFileSync(join(stagingContent, "reasoning_quality_trend.csv"), csvs.qualityTrend, "utf-8");
    writeFileSync(join(stagingContent, "methodology.md"), methodology, "utf-8");

    // Phase 7: Include intelligence artifacts (numeric only, no raw prompts)
    const intelligenceDir = join(getProjectDataDir(), "intelligence");
    const safeFiles = ["efficiency.json", "costs.json", "comprehension.json", "velocity.json"];
    for (const file of safeFiles) {
      const src = join(intelligenceDir, file);
      if (existsSync(src)) {
        const { readFileSync: readFS } = require("node:fs") as typeof import("node:fs");
        writeFileSync(join(stagingContent, `intelligence_${file}`), readFS(src, "utf-8"), "utf-8");
      }
    }
    writeFileSync(
      join(stagingContent, "manifest.json"),
      JSON.stringify(
        {
          type: "leadership-export",
          generatedAt: new Date().toISOString(),
          repoCount: index.repos.length,
          redactionPolicy: config.export.redactionPolicy,
          methodologyVersion: "1.0",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    execSync(
      `tar -czf ${JSON.stringify(outputPath)} -C ${JSON.stringify(stagingDir)} unfade-leadership`,
    );

    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ data: { outputPath, repoCount: index.repos.length, type: "leadership" }, _meta: { tool: "export", durationMs: 0 } })}\n`,
      );
      return;
    }

    process.stderr.write(
      `\n  ${theme.success("✓")} Leadership export: ${theme.bold(outputPath)}\n`,
    );
    process.stderr.write(
      theme.muted(`  ${index.repos.length} repos, redaction: ${config.export.redactionPolicy}\n`),
    );
    process.stderr.write(
      theme.muted(
        `  Contents: spend_by_repo.csv, direction_density_by_repo.csv, reasoning_quality_trend.csv, methodology.md\n\n`,
      ),
    );
  } finally {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  }
}

function promptConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

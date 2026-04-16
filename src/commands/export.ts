// FILE: src/commands/export.ts
// `unfade export [--output path]` — create portable .tar.gz archive of .unfade/ data.
// Excludes ephemeral state (sockets, PIDs, health) and binaries.
// Includes manifest.json with date range, event/distill counts.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pc from "picocolors";
import { handleCliError } from "../utils/cli-error.js";
import { getProjectDataDir } from "../utils/paths.js";

/** Directories and files to include in the export. */
const INCLUDE_DIRS = ["events", "distills", "graph", "profile", "amplification", "cards"];
const INCLUDE_FILES = ["config.json"];

interface ExportManifest {
  exportDate: string;
  dateRange: { from: string | null; to: string | null };
  eventCount: number;
  distillCount: number;
}

/**
 * Count JSONL files and compute date range from filenames (YYYY-MM-DD.jsonl).
 */
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

/**
 * Build manifest.json for the export archive.
 */
function buildManifest(dataDir: string): ExportManifest {
  const eventsDir = join(dataDir, "events");
  const distillsDir = join(dataDir, "distills");

  const events = countAndRange(eventsDir);
  const distills = countAndRange(distillsDir);

  // Date range is the union of events and distills.
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

/**
 * Export .unfade/ as a portable .tar.gz archive.
 */
export async function exportCommand(opts: { output?: string; json?: boolean } = {}): Promise<void> {
  try {
    return await _exportCommand(opts);
  } catch (err) {
    handleCliError(err, "export");
  }
}

async function _exportCommand(opts: { output?: string; json?: boolean }): Promise<void> {
  const startMs = Date.now();
  const dataDir = getProjectDataDir();

  if (!existsSync(dataDir)) {
    process.stderr.write(
      `${pc.red("Error:")} No ${pc.bold(".unfade/")} directory found. Run ${pc.bold("unfade init")} first.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const outputPath = resolve(opts.output ?? `unfade-export-${today}.tar.gz`);

  // Create a staging directory for the archive contents.
  const stagingDir = join(dataDir, ".export-staging");
  const stagingUnfade = join(stagingDir, ".unfade");

  try {
    // Clean up any previous staging.
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    mkdirSync(stagingUnfade, { recursive: true });

    // Copy included directories.
    for (const dir of INCLUDE_DIRS) {
      const srcDir = join(dataDir, dir);
      if (existsSync(srcDir)) {
        execSync(`cp -r ${JSON.stringify(srcDir)} ${JSON.stringify(join(stagingUnfade, dir))}`);
      }
    }

    // Copy included root files.
    for (const file of INCLUDE_FILES) {
      const srcFile = join(dataDir, file);
      if (existsSync(srcFile)) {
        execSync(`cp ${JSON.stringify(srcFile)} ${JSON.stringify(join(stagingUnfade, file))}`);
      }
    }

    // Build and write manifest.
    const manifest = buildManifest(dataDir);
    writeFileSync(join(stagingUnfade, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    // Ensure output directory exists.
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Create tar.gz archive.
    execSync(`tar -czf ${JSON.stringify(outputPath)} -C ${JSON.stringify(stagingDir)} .unfade`);

    if (opts.json) {
      const data = {
        outputPath,
        manifest,
      };
      process.stdout.write(
        `${JSON.stringify({ data, _meta: { tool: "export", durationMs: Date.now() - startMs } })}\n`,
      );
      return;
    }

    process.stderr.write(`${pc.green("✓")} Exported to ${pc.bold(outputPath)}\n`);
    process.stderr.write(
      pc.dim(`  Events: ${manifest.eventCount}, Distills: ${manifest.distillCount}\n`),
    );
    if (manifest.dateRange.from && manifest.dateRange.to) {
      process.stderr.write(
        pc.dim(`  Date range: ${manifest.dateRange.from} → ${manifest.dateRange.to}\n`),
      );
    }
  } finally {
    // Clean up staging directory.
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}

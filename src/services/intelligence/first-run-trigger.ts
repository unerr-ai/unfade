// FILE: src/services/intelligence/first-run-trigger.ts
// UF-207: Wire ingest completion → FirstRunAnalyzer.
// Checks ingest.json status, runs analyzer once, writes first-run-report.json.
// Gate: only runs when firstRunComplete flag is absent.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getStateDir } from "../../utils/paths.js";
import { writeFirstRunCard } from "../cards/identity.js";
import { analyzeFirstRun, type FirstRunReport } from "./first-run-analyzer.js";

const REPORT_FILENAME = "first-run-report.json";

/**
 * Load the first-run report if it exists. Returns null if not yet generated.
 */
export function loadFirstRunReport(cwd?: string): FirstRunReport | null {
  const path = join(getStateDir(cwd), REPORT_FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as FirstRunReport;
  } catch {
    return null;
  }
}

/**
 * Check if ingest is completed by reading ingest.json from state dir.
 */
function isIngestCompleted(cwd?: string): boolean {
  const path = join(getStateDir(cwd), "ingest.json");
  if (!existsSync(path)) return false;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { status?: string };
    return data.status === "completed";
  } catch {
    return false;
  }
}

/**
 * Attempt to generate the first-run report.
 * Only runs if: (1) ingest is completed, (2) report doesn't already exist.
 * Returns the report if generated, null if skipped.
 */
export function tryGenerateFirstRunReport(cwd?: string): FirstRunReport | null {
  const existing = loadFirstRunReport(cwd);
  if (existing) return existing;

  if (!isIngestCompleted(cwd)) return null;

  try {
    const report = analyzeFirstRun(cwd);
    writeReportAtomically(report, cwd);

    try {
      const cardPath = writeFirstRunCard(report, cwd);
      logger.debug("First-run card generated", { path: cardPath });
    } catch (cardErr) {
      logger.debug("First-run card generation failed (non-fatal)", {
        error: cardErr instanceof Error ? cardErr.message : String(cardErr),
      });
    }

    logger.debug("First-run report generated", {
      interactions: report.totalInteractions,
      direction: report.directionDensity,
    });
    return report;
  } catch (err) {
    logger.debug("First-run analysis failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function writeReportAtomically(report: FirstRunReport, cwd?: string): void {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });
  const targetPath = join(stateDir, REPORT_FILENAME);
  const tmpPath = join(stateDir, `${REPORT_FILENAME}.tmp.${process.pid}`);
  writeFileSync(tmpPath, JSON.stringify(report, null, 2), "utf-8");
  renameSync(tmpPath, targetPath);
}

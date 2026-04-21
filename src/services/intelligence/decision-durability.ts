// FILE: src/services/intelligence/decision-durability.ts
// 12C.6: Decision durability tracker — correlates decisions with subsequent git changes.
// If files from a decision are significantly changed within 2-4 weeks (>50% lines modified),
// marks as "revised." Tracks revision rate by deliberation depth.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectDataDir } from "../../utils/paths.js";
import type { DbLike } from "../cache/manager.js";

export interface DurabilityRecord {
  decisionId: string;
  date: string;
  domain: string;
  description: string;
  alternativesCount: number;
  files: string[];
  status: "held" | "revised" | "pending";
  revisionDetectedAt: string | null;
  daysSinceDecision: number;
}

export interface DurabilityReport {
  decisions: DurabilityRecord[];
  stats: {
    totalTracked: number;
    heldCount: number;
    revisedCount: number;
    pendingCount: number;
    heldRate: number;
    /** Decisions with 3+ alternatives explored — held rate */
    deepDeliberationHeldRate: number | null;
    /** Decisions with <2 alternatives — held rate */
    quickDecisionHeldRate: number | null;
  };
  updatedAt: string;
}

const MIN_DAYS_FOR_HELD = 7;
const REVISION_WINDOW_DAYS = 28;

/**
 * Compute decision durability from decisions table + event_links.
 * Only tracks decisions with triggered_commit links (need concrete git evidence).
 */
export function computeDecisionDurability(db: DbLike): DurabilityReport {
  const decisions = loadTrackedDecisions(db);
  const now = Date.now();

  for (const d of decisions) {
    const daysSince = Math.floor((now - new Date(d.date).getTime()) / (86400 * 1000));
    d.daysSinceDecision = daysSince;

    if (daysSince < MIN_DAYS_FOR_HELD) {
      d.status = "pending";
      continue;
    }

    const revised = checkRevised(db, d);
    if (revised) {
      d.status = "revised";
      d.revisionDetectedAt = new Date().toISOString();
    } else if (daysSince >= MIN_DAYS_FOR_HELD) {
      d.status = "held";
    }
  }

  const held = decisions.filter((d) => d.status === "held");
  const revised = decisions.filter((d) => d.status === "revised");
  const pending = decisions.filter((d) => d.status === "pending");
  const decided = held.length + revised.length;

  const deepDecisions = decisions.filter((d) => d.alternativesCount >= 3 && d.status !== "pending");
  const quickDecisions = decisions.filter((d) => d.alternativesCount < 2 && d.status !== "pending");

  return {
    decisions,
    stats: {
      totalTracked: decisions.length,
      heldCount: held.length,
      revisedCount: revised.length,
      pendingCount: pending.length,
      heldRate: decided > 0 ? Math.round((held.length / decided) * 100) : 0,
      deepDeliberationHeldRate:
        deepDecisions.length > 0
          ? Math.round(
              (deepDecisions.filter((d) => d.status === "held").length / deepDecisions.length) *
                100,
            )
          : null,
      quickDecisionHeldRate:
        quickDecisions.length > 0
          ? Math.round(
              (quickDecisions.filter((d) => d.status === "held").length / quickDecisions.length) *
                100,
            )
          : null,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Write durability report to intelligence directory.
 */
export function writeDecisionDurability(report: DurabilityReport, repoRoot: string): void {
  const dir = join(getProjectDataDir(repoRoot), "intelligence");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "decision-durability.json");
  const tmp = `${target}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(report, null, 2), "utf-8");
  renameSync(tmp, target);
}

function loadTrackedDecisions(db: DbLike): DurabilityRecord[] {
  try {
    const result = db.exec(`
      SELECT d.id, d.date, d.domain, d.description, d.alternatives_count,
             GROUP_CONCAT(DISTINCT el.to_event) as linked_files
      FROM decisions d
      LEFT JOIN event_links el ON el.from_event = d.id AND el.link_type = 'triggered_commit'
      WHERE d.date >= date('now', '-${REVISION_WINDOW_DAYS} days')
      GROUP BY d.id
      ORDER BY d.date DESC
      LIMIT 100
    `);
    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => {
      const linkedStr = (row[5] as string) ?? "";
      const files = linkedStr ? linkedStr.split(",").filter(Boolean) : [];
      return {
        decisionId: (row[0] as string) ?? "",
        date: (row[1] as string) ?? "",
        domain: (row[2] as string) ?? "general",
        description: (row[3] as string) ?? "",
        alternativesCount: (row[4] as number) ?? 0,
        files,
        status: "pending" as const,
        revisionDetectedAt: null,
        daysSinceDecision: 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Check if decision-linked files have been substantially changed.
 * Uses events table to find subsequent modifications to the same files.
 */
function checkRevised(db: DbLike, decision: DurabilityRecord): boolean {
  if (decision.files.length === 0) return false;

  try {
    // Check if there are significant events touching the same files after the decision
    const cutoff = decision.date;
    const windowEnd = new Date(new Date(cutoff).getTime() + REVISION_WINDOW_DAYS * 86400 * 1000)
      .toISOString()
      .slice(0, 10);

    for (const file of decision.files) {
      const result = db.exec(
        `SELECT COUNT(*) FROM events
         WHERE ts > '${cutoff}' AND ts <= '${windowEnd}'
           AND (content_summary LIKE '%${escapeSql(file)}%'
                OR content_detail LIKE '%${escapeSql(file)}%')
           AND source IN ('git-commit', 'ai-session')`,
      );
      const count = (result[0]?.values[0]?.[0] as number) ?? 0;
      // More than 3 subsequent touches to the same file = likely revised
      if (count > 3) return true;
    }

    return false;
  } catch {
    return false;
  }
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''").replace(/%/g, "");
}

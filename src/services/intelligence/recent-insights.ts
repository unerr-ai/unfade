// FILE: src/services/intelligence/recent-insights.ts
// UF-228 writer: ring-buffered append to insights/recent.jsonl for dashboard + SSE.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getInsightsDir } from "../../utils/paths.js";

const MAX_LINES = 100;
const RECENT_FILENAME = "recent.jsonl";

export interface RecentInsightPayload {
  claim: string;
  insightType?: string;
  severity?: "info" | "nudge" | "warning";
  metrics?: Record<string, unknown>;
}

/**
 * Append one insight line; keeps at most MAX_LINES non-empty lines (FIFO).
 */
export function appendRecentInsight(cwd: string | undefined, payload: RecentInsightPayload): void {
  const dir = getInsightsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, RECENT_FILENAME);

  const lines: string[] = [];
  if (existsSync(target)) {
    const raw = readFileSync(target, "utf-8");
    lines.push(...raw.split("\n").filter((l) => l.trim()));
  }

  const record = {
    ts: new Date().toISOString(),
    severity: payload.severity ?? "info",
    insight_type: payload.insightType ?? "system",
    claim: payload.claim,
    metrics: payload.metrics ?? {},
  };

  const next = [...lines.slice(-(MAX_LINES - 1)), JSON.stringify(record)];
  const tmp = join(dir, `${RECENT_FILENAME}.tmp.${process.pid}`);
  writeFileSync(tmp, `${next.join("\n")}\n`, "utf-8");
  renameSync(tmp, target);
}

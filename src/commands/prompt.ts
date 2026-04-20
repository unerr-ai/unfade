import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getMetricsDir } from "../utils/paths.js";

/**
 * `unfade prompt` — 5-6 char metric badge for shell prompt integration.
 * Outputs `◆67 ↑` (RDI + CWI trend) to stdout.
 * Must complete in <50ms: reads only the last line of daily.jsonl,
 * no profile loading, no computation, no imports of heavy modules.
 * Empty string if no data.
 */
export function promptCommand(): void {
  const filePath = join(getMetricsDir(), "daily.jsonl");

  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf-8");
  const lastNewline = content.lastIndexOf("\n", content.length - 2);
  const lastLine = lastNewline === -1 ? content.trim() : content.slice(lastNewline + 1).trim();

  if (!lastLine) return;

  try {
    const snapshot = JSON.parse(lastLine);
    const rdi = snapshot.rdi;
    if (typeof rdi !== "number") return;

    const trendArrow = trendArrowFromSnapshots(content);
    process.stdout.write(`◆${rdi}${trendArrow}`);
  } catch {
    return;
  }
}

function trendArrowFromSnapshots(content: string): string {
  const lines = content.trim().split("\n");
  if (lines.length < 7) return " ";

  const recent = lines.slice(-7);
  let sum = 0;
  let count = 0;
  for (const line of recent) {
    try {
      const snap = JSON.parse(line);
      if (typeof snap.rdi === "number") {
        sum += snap.rdi;
        count++;
      }
    } catch {}
  }

  if (count < 3) return " ";

  const lastSnap = JSON.parse(lines[lines.length - 1]);
  const avg = sum / count;

  if (lastSnap.rdi > avg + 3) return " ↑";
  if (lastSnap.rdi < avg - 3) return " ↓";
  return " →";
}

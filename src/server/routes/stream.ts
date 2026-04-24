// FILE: src/server/routes/stream.ts
// UF-473: Push-based SSE endpoint — subscribes to eventBus for real-time updates.
// Falls back to file polling only for health ticks and initial backfill.

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { BusEvent } from "../../services/event-bus.js";
import { eventBus } from "../../services/event-bus.js";
import { localToday } from "../../utils/date.js";
import { getEventsDir, getStateDir } from "../../utils/paths.js";

export const streamRoutes = new Hono();

const HEALTH_INTERVAL_MS = 30_000;
const EVENT_BACKFILL_LINES = 20;
const EVENT_TAIL_CHUNK_MAX = 512 * 1024;

/** Read last N complete JSON lines from a JSONL file (best-effort for large files). */
function readLastJsonlLines(filePath: string, maxLines: number): unknown[] {
  if (!existsSync(filePath)) return [];
  const filestat = statSync(filePath);
  if (filestat.size === 0) return [];
  const start = Math.max(0, filestat.size - EVENT_TAIL_CHUNK_MAX);
  const len = filestat.size - start;
  const buf = Buffer.alloc(len);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, len, start);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString("utf-8");
  const lines = text.split("\n").filter((l: string) => l.trim().length > 0);
  const tail = lines.slice(-maxLines);
  const out: unknown[] = [];
  for (const line of tail) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

/** Find the most recent non-empty events JSONL file. */
function findLatestEventsFile(): string | null {
  const dir = getEventsDir();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".epoch"))
    .sort()
    .reverse();
  for (const f of files) {
    const p = join(dir, f);
    if (statSync(p).size > 0) return p;
  }
  return null;
}

streamRoutes.get("/api/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let eventId = 0;
    let aborted = false;

    c.req.raw.signal.addEventListener("abort", () => {
      aborted = true;
    });

    // Send current summary on connect
    const summaryPath = join(getStateDir(), "summary.json");
    try {
      if (existsSync(summaryPath)) {
        const content = await readFile(summaryPath, "utf-8");
        const summary = JSON.parse(content);
        await stream.writeSSE({
          data: JSON.stringify(summary),
          event: "summary",
          id: String(eventId++),
        });
      }
    } catch {
      // non-fatal
    }

    // Backfill recent events
    try {
      const todayPath = join(getEventsDir(), `${localToday()}.jsonl`);
      const backfillPath =
        existsSync(todayPath) && statSync(todayPath).size > 0 ? todayPath : findLatestEventsFile();
      if (backfillPath) {
        for (const ev of readLastJsonlLines(backfillPath, EVENT_BACKFILL_LINES)) {
          await stream.writeSSE({
            data: JSON.stringify(ev),
            event: "event",
            id: String(eventId++),
          });
        }
      }
    } catch {
      /* non-fatal */
    }

    // Subscribe to push events from the materializer/summary-writer
    const busListener = async (busEvent: BusEvent) => {
      if (aborted) return;
      try {
        await stream.writeSSE({
          data: JSON.stringify(busEvent.data),
          event: busEvent.type,
          id: String(eventId++),
        });
      } catch {
        // stream closed
        aborted = true;
      }
    };

    eventBus.onBus(busListener);

    // Health tick on a longer interval (no polling needed for data)
    const healthInterval = setInterval(async () => {
      if (aborted) return;

      const materializer = (globalThis as Record<string, unknown>).__unfade_materializer as
        | { getLagMs(): number }
        | undefined;

      const repoManager = (globalThis as Record<string, unknown>).__unfade_repo_manager as
        | {
            getHealthStatus(): Array<{
              daemonPid: number | null;
              daemonRunning: boolean;
              daemonRestartCount: number;
              materializerLagMs: number;
            }>;
            size: number;
          }
        | undefined;

      const primaryRepo = repoManager?.getHealthStatus()?.[0];

      try {
        await stream.writeSSE({
          data: JSON.stringify({
            status: "ok",
            materializerLagMs: materializer?.getLagMs() ?? -1,
            uptime: process.uptime(),
            daemonPid: primaryRepo?.daemonPid ?? null,
            daemonAlive: primaryRepo?.daemonRunning ?? false,
            daemonRestartCount: primaryRepo?.daemonRestartCount ?? 0,
            repoCount: repoManager?.size ?? 0,
          }),
          event: "health",
          id: String(eventId++),
        });
      } catch {
        aborted = true;
      }
    }, HEALTH_INTERVAL_MS);

    // Keep connection alive until client disconnects
    while (!aborted) {
      await stream.sleep(1000);
    }

    // Cleanup
    clearInterval(healthInterval);
    eventBus.offBus(busListener);
  });
});

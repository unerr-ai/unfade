// FILE: src/server/routes/stream.ts
// UF-225: SSE endpoint — pushes summary.json updates, per-capture events, and health ticks.
// Uses Hono's streamSSE() helper. Polls summary.json mtime every 2s for changes.
// On connection: sends current summary + backfills recent capture events for live UI.

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { localToday } from "../../utils/date.js";
import { getEventsDir, getIntelligenceDir, getStateDir } from "../../utils/paths.js";

export const streamRoutes = new Hono();

const POLL_INTERVAL_MS = 2000;
const EVENT_BACKFILL_LINES = 20;
const EVENT_TAIL_CHUNK_MAX = 512 * 1024;

/** Read bytes [start, endExclusive) from a file (sync). */
function readBytesSync(path: string, start: number, endExclusive: number): Buffer {
  const len = endExclusive - start;
  if (len <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, len, start);
  } finally {
    closeSync(fd);
  }
  return buf;
}

function eventsPathForToday(): string {
  return join(getEventsDir(), `${localToday()}.jsonl`);
}

/** Find the most recent non-empty events JSONL file (for backfill when today's file doesn't exist). */
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

/** Read last N complete JSON lines from a JSONL file (best-effort for large files). */
function readLastJsonlLines(filePath: string, maxLines: number): unknown[] {
  if (!existsSync(filePath)) return [];
  const stat = statSync(filePath);
  if (stat.size === 0) return [];
  const start = Math.max(0, stat.size - EVENT_TAIL_CHUNK_MAX);
  const buf = readBytesSync(filePath, start, stat.size);
  const text = buf.toString("utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
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

interface EventTailState {
  path: string;
  offset: number;
  pending: string;
}

function createEventTailState(): EventTailState {
  return { path: "", offset: 0, pending: "" };
}

/**
 * Read newly appended complete lines from the active JSONL file.
 * Updates `state` in place; returns parsed event objects.
 */
function drainNewEventLines(state: EventTailState): unknown[] {
  const path = eventsPathForToday();
  if (path !== state.path) {
    state.path = path;
    state.offset = 0;
    state.pending = "";
  }
  if (!existsSync(path)) {
    return [];
  }
  const stat = statSync(path);
  if (stat.size < state.offset) {
    // truncated / rotated file
    state.offset = 0;
    state.pending = "";
  }
  if (stat.size === state.offset) {
    return [];
  }
  const chunk = readBytesSync(path, state.offset, stat.size);
  state.pending += chunk.toString("utf-8");
  const parts = state.pending.split("\n");
  state.pending = parts.pop() ?? "";
  const events: unknown[] = [];
  for (const line of parts) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip corrupt */
    }
  }
  state.offset = stat.size - Buffer.byteLength(state.pending, "utf8");
  return events;
}

streamRoutes.get("/api/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let eventId = 0;
    let lastMtimeMs = 0;
    let lastIntelligenceMtimeMs = 0;
    let aborted = false;
    const eventTail = createEventTailState();

    c.req.raw.signal.addEventListener("abort", () => {
      aborted = true;
    });

    const summaryPath = join(getStateDir(), "summary.json");

    const readAndSend = async () => {
      if (!existsSync(summaryPath)) return;

      try {
        const currentMtime = statSync(summaryPath).mtimeMs;
        if (currentMtime <= lastMtimeMs) return;
        lastMtimeMs = currentMtime;

        const content = readFileSync(summaryPath, "utf-8");
        const summary = JSON.parse(content);

        await stream.writeSSE({
          data: JSON.stringify(summary),
          event: "summary",
          id: String(eventId++),
        });
      } catch {
        // file read race — skip this tick
      }
    };

    await readAndSend();

    // Backfill recent events: try today first, fall back to most recent file
    try {
      const todayPath = eventsPathForToday();
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
      eventTail.path = todayPath;
      if (existsSync(todayPath)) {
        const st = statSync(todayPath);
        eventTail.offset = st.size;
        eventTail.pending = "";
      }
    } catch {
      /* non-fatal */
    }

    while (!aborted) {
      await stream.sleep(POLL_INTERVAL_MS);
      if (aborted) break;
      await readAndSend();

      try {
        for (const ev of drainNewEventLines(eventTail)) {
          await stream.writeSSE({
            data: JSON.stringify(ev),
            event: "event",
            id: String(eventId++),
          });
        }
      } catch {
        /* non-fatal */
      }

      // 12A.11: Push intelligence updates when any analyzer output changes
      try {
        const intelligenceDir = getIntelligenceDir();
        if (existsSync(intelligenceDir)) {
          const files = readdirSync(intelligenceDir).filter((f) => f.endsWith(".json"));
          let maxMtime = 0;
          for (const file of files) {
            const mtime = statSync(join(intelligenceDir, file)).mtimeMs;
            if (mtime > maxMtime) maxMtime = mtime;
          }
          if (maxMtime > lastIntelligenceMtimeMs) {
            lastIntelligenceMtimeMs = maxMtime;
            const updated: Record<string, unknown> = {};
            for (const file of files) {
              try {
                updated[file.replace(".json", "")] = JSON.parse(
                  readFileSync(join(intelligenceDir, file), "utf-8"),
                );
              } catch {
                /* skip corrupt */
              }
            }
            await stream.writeSSE({
              data: JSON.stringify(updated),
              event: "intelligence",
              id: String(eventId++),
            });
          }
        }
      } catch {
        /* non-fatal */
      }

      if (eventId % 15 === 0) {
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
      }
    }
  });
});

// FILE: src/server/routes/logs.ts
// Fix 6: System logs API — query snapshot + SSE real-time stream.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logBuffer } from "../../services/logs/ring-buffer.js";
import type { LogLevel, LogSource } from "../../services/logs/types.js";
import { LOG_LEVELS, LOG_SOURCES, levelValue } from "../../services/logs/types.js";

export const logsRoutes = new Hono();

/**
 * GET /api/logs — query log buffer with filters.
 * Query params: source (comma-sep), level, since, limit.
 */
logsRoutes.get("/api/logs", (c) => {
  const sourceParam = c.req.query("source");
  const levelParam = c.req.query("level") as LogLevel | undefined;
  const since = c.req.query("since");
  const limitParam = c.req.query("limit");

  const sources = sourceParam
    ? (sourceParam.split(",").filter((s) => LOG_SOURCES.includes(s as LogSource)) as LogSource[])
    : undefined;

  const level = levelParam && LOG_LEVELS.includes(levelParam) ? levelParam : undefined;
  const limit = limitParam ? Math.min(Math.max(Number.parseInt(limitParam, 10) || 100, 1), 500) : 100;

  const entries = logBuffer.query({ source: sources, level, since, limit });

  return c.json({
    data: {
      entries,
      total: entries.length,
      bufferSize: logBuffer.size,
    },
    _meta: { tool: "system-logs", durationMs: 0 },
  });
});

/**
 * GET /api/logs/stream — SSE endpoint for real-time log tail.
 * Query params: source (comma-sep), level.
 */
logsRoutes.get("/api/logs/stream", (c) => {
  const sourceParam = c.req.query("source");
  const levelParam = c.req.query("level") as LogLevel | undefined;

  const sources = sourceParam
    ? new Set(sourceParam.split(",").filter((s) => LOG_SOURCES.includes(s as LogSource)))
    : null;

  const minLevel = levelParam && LOG_LEVELS.includes(levelParam) ? levelParam : "info";
  const minLevelVal = levelValue(minLevel);

  return streamSSE(c, async (stream) => {
    let aborted = false;
    let eventId = 0;

    c.req.raw.signal.addEventListener("abort", () => {
      aborted = true;
    });

    const unsubscribe = logBuffer.subscribe((entry) => {
      if (aborted) return;
      if (sources && !sources.has(entry.source)) return;
      if (levelValue(entry.level) < minLevelVal) return;

      stream
        .writeSSE({
          data: JSON.stringify(entry),
          event: "log",
          id: String(eventId++),
        })
        .catch(() => {
          aborted = true;
        });
    });

    // Keep connection alive until client disconnects
    while (!aborted) {
      await stream.sleep(5000);
    }

    unsubscribe();
  });
});

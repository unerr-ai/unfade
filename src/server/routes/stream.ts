// FILE: src/server/routes/stream.ts
// UF-225: SSE endpoint — pushes summary.json updates and health ticks to connected clients.
// Uses Hono's built-in streamSSE() helper. Polls summary.json mtime every 2s for changes.
// On connection: sends current summary as initial event (client doesn't need a separate fetch).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getProjectDataDir, getStateDir } from "../../utils/paths.js";

export const streamRoutes = new Hono();

const POLL_INTERVAL_MS = 2000;

streamRoutes.get("/api/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let eventId = 0;
    let lastMtimeMs = 0;
    let lastIntelligenceMtimeMs = 0;
    let aborted = false;

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

    while (!aborted) {
      await stream.sleep(POLL_INTERVAL_MS);
      if (aborted) break;
      await readAndSend();

      // 12A.11: Push intelligence updates when any analyzer output changes
      try {
        const intelligenceDir = join(getProjectDataDir(), "intelligence");
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

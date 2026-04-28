// FILE: src/server/routes/distill.ts
// GET /api/distill/latest — most recent distill
// GET /api/distill/:date — distill for specific date
// POST /api/distill — trigger manual distillation

import { existsSync, readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { loadConfig } from "../../config/manager.js";
import { distill } from "../../services/distill/distiller.js";
import { localToday } from "../../utils/date.js";
import { logger } from "../../utils/logger.js";
import { getDistillsDir } from "../../utils/paths.js";

export const distillRoutes = new Hono();

/**
 * Read a distill markdown file and return its content with metadata.
 */
async function readDistill(date: string, cwd?: string) {
  const distillsDir = getDistillsDir(cwd);
  const filePath = join(distillsDir, `${date}.md`);

  if (!existsSync(filePath)) return null;

  try {
    const content = await readFile(filePath, "utf-8");
    const mtime = (await stat(filePath)).mtime.toISOString();
    return { date, content, lastUpdated: mtime };
  } catch {
    return null;
  }
}

/**
 * Find the most recent distill date.
 */
function findLatestDistillDate(cwd?: string): string | null {
  const distillsDir = getDistillsDir(cwd);
  if (!existsSync(distillsDir)) return null;

  try {
    const files = readdirSync(distillsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.replace(".md", ""))
      .sort()
      .reverse();
    return files[0] ?? null;
  } catch {
    return null;
  }
}

distillRoutes.get("/distill/latest", async (c) => {
  const start = performance.now();
  const latestDate = findLatestDistillDate();

  if (!latestDate) {
    return c.json({
      data: null,
      _meta: {
        tool: "unfade-distill",
        durationMs: Math.round(performance.now() - start),
        degraded: true,
        degradedReason: "No distills found",
        lastUpdated: null,
      },
    });
  }

  const distillData = await readDistill(latestDate);
  return c.json({
    data: distillData,
    _meta: {
      tool: "unfade-distill",
      durationMs: Math.round(performance.now() - start),
      degraded: false,
      lastUpdated: distillData?.lastUpdated ?? null,
    },
  });
});

distillRoutes.get("/distill/:date", async (c) => {
  const start = performance.now();
  const date = c.req.param("date");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-distill",
          durationMs: Math.round(performance.now() - start),
          degraded: true,
          degradedReason: "Invalid date format. Use YYYY-MM-DD",
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const distillData = await readDistill(date);
  if (!distillData) {
    return c.json({
      data: null,
      _meta: {
        tool: "unfade-distill",
        durationMs: Math.round(performance.now() - start),
        degraded: true,
        degradedReason: `No distill found for ${date}`,
        lastUpdated: null,
      },
    });
  }

  return c.json({
    data: distillData,
    _meta: {
      tool: "unfade-distill",
      durationMs: Math.round(performance.now() - start),
      degraded: false,
      lastUpdated: distillData.lastUpdated,
    },
  });
});

/**
 * Read an enriched distill JSON file.
 */
async function readEnrichedDistill(date: string, cwd?: string) {
  const distillsDir = getDistillsDir(cwd);
  const filePath = join(distillsDir, `${date}.json`);

  if (!existsSync(filePath)) return null;

  try {
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    const mtime = (await stat(filePath)).mtime.toISOString();
    return { ...data, lastUpdated: mtime };
  } catch {
    return null;
  }
}

distillRoutes.get("/distill/:date/enriched", async (c) => {
  const start = performance.now();
  const date = c.req.param("date");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-distill",
          durationMs: Math.round(performance.now() - start),
          degraded: true,
          degradedReason: "Invalid date format. Use YYYY-MM-DD",
        },
      },
      400,
    );
  }

  const enriched = await readEnrichedDistill(date);
  if (!enriched) {
    // Fall back to markdown-only distill (pre-v2 distills)
    const mdData = await readDistill(date);
    if (!mdData) {
      return c.json({
        data: null,
        _meta: {
          tool: "unfade-distill",
          durationMs: Math.round(performance.now() - start),
          degraded: true,
          degradedReason: `No distill found for ${date}`,
        },
      });
    }
    // Return markdown-only response with v1 flag
    return c.json({
      data: {
        version: 1 as const,
        date,
        markdown: mdData.content,
        lastUpdated: mdData.lastUpdated,
      },
      _meta: {
        tool: "unfade-distill",
        durationMs: Math.round(performance.now() - start),
        degraded: false,
      },
    });
  }

  return c.json({
    data: enriched,
    _meta: {
      tool: "unfade-distill",
      durationMs: Math.round(performance.now() - start),
      degraded: false,
    },
  });
});

distillRoutes.post("/distill", async (c) => {
  const start = performance.now();

  try {
    const body = await c.req.json().catch(() => ({}));
    const date = (body as Record<string, unknown>).date as string | undefined;
    const targetDate = date ?? localToday();

    const config = loadConfig();
    const result = await distill(targetDate, config);

    if (!result) {
      return c.json({
        data: { status: "no_events", date: targetDate },
        _meta: {
          tool: "unfade-distill",
          durationMs: Math.round(performance.now() - start),
          degraded: false,
          lastUpdated: null,
        },
      });
    }

    return c.json({
      data: {
        status: "completed",
        date: result.distill.date,
        summary: result.distill.summary,
        decisions: result.distill.decisions.length,
        eventsProcessed: result.distill.eventsProcessed,
      },
      _meta: {
        tool: "unfade-distill",
        durationMs: Math.round(performance.now() - start),
        degraded: false,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error("Distill failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json(
      {
        data: { status: "error" },
        _meta: {
          tool: "unfade-distill",
          durationMs: Math.round(performance.now() - start),
          degraded: true,
          degradedReason: err instanceof Error ? err.message : "Distillation failed",
          lastUpdated: null,
        },
      },
      500,
    );
  }
});

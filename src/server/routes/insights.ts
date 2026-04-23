// FILE: src/server/routes/insights.ts
// UF-228: GET /api/insights/recent — tail-reads last 20 lines of insights/recent.jsonl.
// Returns JSON array. Graceful: returns [] if file doesn't exist.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { getProjectDataDir } from "../../utils/paths.js";

export const insightsRoutes = new Hono();

const MAX_RECENT = 20;

insightsRoutes.get("/api/insights/recent", async (c) => {
  const insightsPath = join(getProjectDataDir(), "insights", "recent.jsonl");

  if (!existsSync(insightsPath)) {
    return c.json([]);
  }

  try {
    const content = (await readFile(insightsPath, "utf-8")).trim();
    if (!content) return c.json([]);

    const lines = content.split("\n");
    const recentLines = lines.slice(-MAX_RECENT);

    const insights: unknown[] = [];
    for (const line of recentLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        insights.push(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    }

    return c.json(insights);
  } catch {
    return c.json([]);
  }
});

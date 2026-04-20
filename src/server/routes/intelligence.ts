// FILE: src/server/routes/intelligence.ts
// UF-104/UF-105: API routes for Phase 7 intelligence data.
// Reads from .unfade/intelligence/*.json files (written by IntelligenceEngine).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { getProjectDataDir } from "../../utils/paths.js";

export const intelligenceRoutes = new Hono();

function readIntelligenceFile(filename: string, cwd?: string): unknown | null {
  const path = join(getProjectDataDir(cwd), "intelligence", filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function jsonOr204(
  c: { json: (data: unknown) => Response; body: (data: null, status: number) => Response },
  data: unknown,
) {
  if (!data) return c.body(null, 204);
  return c.json(data);
}

intelligenceRoutes.get("/api/intelligence/efficiency", (c) =>
  jsonOr204(c, readIntelligenceFile("efficiency.json")),
);
intelligenceRoutes.get("/api/intelligence/costs", (c) =>
  jsonOr204(c, readIntelligenceFile("costs.json")),
);
intelligenceRoutes.get("/api/intelligence/comprehension", (c) =>
  jsonOr204(c, readIntelligenceFile("comprehension.json")),
);
intelligenceRoutes.get("/api/intelligence/prompt-patterns", (c) =>
  jsonOr204(c, readIntelligenceFile("prompt-patterns.json")),
);
intelligenceRoutes.get("/api/intelligence/coach", (c) =>
  jsonOr204(c, readIntelligenceFile("prompt-patterns.json")),
);
intelligenceRoutes.get("/api/intelligence/velocity", (c) =>
  jsonOr204(c, readIntelligenceFile("velocity.json")),
);
intelligenceRoutes.get("/api/intelligence/rejections", (c) =>
  jsonOr204(c, readIntelligenceFile("rejections.idx.json")),
);
intelligenceRoutes.get("/api/intelligence/alerts", (c) =>
  jsonOr204(c, readIntelligenceFile("alerts.json")),
);
intelligenceRoutes.get("/api/intelligence/replays", (c) =>
  jsonOr204(c, readIntelligenceFile("replays.json")),
);

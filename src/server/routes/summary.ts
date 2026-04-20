// FILE: src/server/routes/summary.ts
// UF-227: GET /api/summary — serves state/summary.json with ETag for cache validation.
// Returns 204 if summary.json doesn't exist yet (pre-materializer state).

import { createHash } from "node:crypto";
import { Hono } from "hono";
import { readSummary } from "../../services/intelligence/summary-writer.js";

export const summaryRoutes = new Hono();

summaryRoutes.get("/api/summary", (c) => {
  const summary = readSummary();
  if (!summary) {
    return c.body(null, 204);
  }

  const body = JSON.stringify(summary);
  const etag = `"${createHash("md5").update(body).digest("hex").slice(0, 16)}"`;

  const ifNoneMatch = c.req.header("If-None-Match");
  if (ifNoneMatch === etag) {
    return c.body(null, 304);
  }

  c.header("ETag", etag);
  c.header("Cache-Control", "no-cache");
  c.header("Content-Type", "application/json");
  return c.body(body);
});

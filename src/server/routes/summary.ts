// FILE: src/server/routes/summary.ts
// UF-227: GET /api/summary — serves state/summary.json with ETag for cache validation.
// Returns 204 if summary.json doesn't exist yet (pre-materializer state).
// Optional ?project= or ?projectId= (registry repo id): validates id; body is still the global
// summary until per-project aggregates are wired through summary-writer (Phase 14/16).

import { createHash } from "node:crypto";
import { Hono } from "hono";
import { readSummary } from "../../services/intelligence/summary-writer.js";
import { findRepoById } from "../../services/registry/registry.js";

export const summaryRoutes = new Hono();

summaryRoutes.get("/api/summary", (c) => {
  const rawProject = c.req.query("project") ?? c.req.query("projectId") ?? "";
  const projectId = rawProject.trim();
  if (projectId && !findRepoById(projectId)) {
    c.header("Content-Type", "application/json");
    return c.json({ error: "Unknown project" }, 404);
  }

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
  if (projectId) {
    c.header("X-Unfade-Requested-Project-Id", projectId);
    c.header("X-Unfade-Metrics-Scope", "global");
  }
  return c.body(body);
});

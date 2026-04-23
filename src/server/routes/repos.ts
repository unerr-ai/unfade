// FILE: src/server/routes/repos.ts
// UF-229: GET /api/repos — registry + per-repo summaries (parallel read).
// UF-230: GET /api/repos/:id/events — events from a specific repo's .unfade/.

import { join } from "node:path";
import { Hono } from "hono";
import { readEventRange } from "../../services/capture/event-store.js";
import {
  type SummaryJson,
  readSummary,
} from "../../services/intelligence/summary-writer.js";
import type { RepoEntry } from "../../services/registry/registry.js";
import { findRepoById, loadRegistry } from "../../services/registry/registry.js";
import { localToday } from "../../utils/date.js";

export const reposRoutes = new Hono();

interface RepoWithSummary {
  id: string;
  root: string;
  label: string;
  lastSeenAt: string;
  capabilities: RepoEntry["capabilities"];
  summary: SummaryJson | null;
}

// GET /api/repos — all registered repos with summary data
reposRoutes.get("/api/repos", (c) => {
  try {
    const registry = loadRegistry();
    const summary = readSummary();
    const results: RepoWithSummary[] = registry.repos.map((repo) => ({
      id: repo.id,
      root: repo.root,
      label: repo.label,
      lastSeenAt: repo.lastSeenAt,
      capabilities: repo.capabilities,
      summary,
    }));
    return c.json(results);
  } catch {
    return c.json([]);
  }
});

// GET /api/repos/:id — single repo metadata + summary
reposRoutes.get("/api/repos/:id", (c) => {
  const id = c.req.param("id");
  const repo = findRepoById(id);
  if (!repo) {
    return c.json({ error: "Repo not found" }, 404);
  }
  return c.json({
    id: repo.id,
    root: repo.root,
    label: repo.label,
    lastSeenAt: repo.lastSeenAt,
    capabilities: repo.capabilities,
    summary: readSummary(),
  });
});

// GET /api/repos/:id/events — events from a specific repo
reposRoutes.get("/api/repos/:id/events", (c) => {
  const id = c.req.param("id");
  const repo = findRepoById(id);
  if (!repo) {
    return c.json({ error: "Repo not found" }, 404);
  }

  const today = localToday();
  const from = c.req.query("from") ?? today;
  const to = c.req.query("to") ?? today;
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;

  const events = readEventRange(from, to, repo.root);
  const limited = events.slice(-Math.min(limit, 200));

  return c.json({
    repoId: repo.id,
    repoLabel: repo.label,
    from,
    to,
    total: events.length,
    events: limited.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      source: e.source,
      type: e.type,
      summary: e.content.summary,
      domain: e.content.project ?? null,
    })),
  });
});

// FILE: src/server/routes/lineage.ts
// Fix 13: GET /api/lineage/:id — bidirectional event↔insight lookup.

import { Hono } from "hono";
import { CacheManager } from "../../services/cache/manager.js";
import { getEventsForInsight, getInsightsForEvent } from "../../services/intelligence/lineage.js";

export const lineageRoutes = new Hono();

/**
 * GET /api/lineage/:id
 * Accepts an event ID or insight ID. Returns both forward and reverse mappings.
 */
lineageRoutes.get("/api/lineage/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ data: null, _meta: { error: "Missing id parameter" } }, 400);
  }

  const cache = new CacheManager();
  const db = await cache.getDb();
  if (!db) {
    return c.json(
      { data: null, _meta: { degraded: true, degradedReason: "No cache database" } },
      503,
    );
  }

  try {
    const asEvent = await getInsightsForEvent(db, id);
    const asInsight = await getEventsForInsight(db, id);

    return c.json({
      data: {
        id,
        insightsFromEvent: asEvent,
        eventsFromInsight: asInsight,
      },
      _meta: {
        tool: "lineage",
        durationMs: 0,
      },
    });
  } catch (err) {
    return c.json(
      {
        data: null,
        _meta: { degraded: true, degradedReason: err instanceof Error ? err.message : String(err) },
      },
      500,
    );
  }
});

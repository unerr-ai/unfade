// FILE: src/server/routes/amplify.ts
// UF-066/UF-068: HTTP endpoints for amplification and similar search.
// GET /unfade/amplify?date= — cross-temporal connections
// GET /unfade/similar?problem=&limit= — similar decision search

import { Hono } from "hono";
import { amplify, findSimilar } from "../../services/distill/amplifier.js";

export const amplifyRoutes = new Hono();

amplifyRoutes.get("/amplify", (c) => {
  const date = c.req.query("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-amplify",
          durationMs: 0,
          degraded: true,
          degradedReason: "Missing or invalid date parameter. Use ?date=YYYY-MM-DD",
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const result = amplify(date);
  return c.json(result);
});

amplifyRoutes.get("/similar", (c) => {
  const problem = c.req.query("problem");

  if (!problem) {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-similar",
          durationMs: 0,
          degraded: true,
          degradedReason: "Missing problem parameter. Use ?problem=your+search+query",
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(50, Math.max(1, Number.parseInt(limitParam, 10) || 10)) : 10;

  const result = findSimilar(problem, limit);
  return c.json(result);
});

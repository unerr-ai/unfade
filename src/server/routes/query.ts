// FILE: src/server/routes/query.ts
// GET /unfade/query — keyword search via Sprint 2A query engine.

import { Hono } from "hono";
import { QueryInputSchema } from "../../schemas/mcp.js";
import { queryEvents } from "../../tools/unfade-query.js";

export const queryRoutes = new Hono();

queryRoutes.get("/query", (c) => {
  const q = c.req.query("q") ?? "";
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limitStr = c.req.query("limit");

  const input: Record<string, unknown> = { query: q };
  if (from || to) {
    input.dateRange = { from: from || undefined, to: to || undefined };
  }
  if (limitStr) {
    const num = Number.parseInt(limitStr, 10);
    if (!Number.isNaN(num)) input.limit = num;
  }

  const parsed = QueryInputSchema.safeParse(input);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-query",
          durationMs: 0,
          degraded: true,
          degradedReason: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const result = queryEvents(parsed.data);
  return c.json(result);
});

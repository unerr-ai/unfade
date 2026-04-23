// FILE: src/server/routes/decisions.ts
// GET /unfade/decisions — decisions list via Sprint 2A reader.

import { Hono } from "hono";
import { DecisionsInputSchema } from "../../schemas/mcp.js";
import { getDecisions } from "../../tools/unfade-decisions.js";

export const decisionsRoutes = new Hono();

decisionsRoutes.get("/decisions", (c) => {
  const limitStr = c.req.query("limit");
  const domain = c.req.query("domain");
  const q = c.req.query("q");
  const period = c.req.query("period");
  const project = c.req.query("project");

  const input: Record<string, unknown> = {};
  if (limitStr) {
    const num = Number.parseInt(limitStr, 10);
    if (!Number.isNaN(num)) input.limit = num;
  }
  if (domain) input.domain = domain;
  if (q) input.q = q;
  if (period === "7d" || period === "30d" || period === "90d") input.period = period;
  if (project) input.project = project;

  const parsed = DecisionsInputSchema.safeParse(input);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-decisions",
          durationMs: 0,
          degraded: true,
          degradedReason: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const result = getDecisions(parsed.data);
  return c.json(result);
});

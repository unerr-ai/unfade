// FILE: src/server/routes/context.ts
// GET /unfade/context — recent context retrieval via Sprint 2A reader.

import { Hono } from "hono";
import { ContextInputSchema } from "../../schemas/mcp.js";
import { getRecentContext } from "../../tools/unfade-context.js";

export const contextRoutes = new Hono();

contextRoutes.get("/context", (c) => {
  const scope = c.req.query("scope") ?? "today";
  const project = c.req.query("project");

  const parsed = ContextInputSchema.safeParse({
    scope,
    project: project || undefined,
  });

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-context",
          durationMs: 0,
          degraded: true,
          degradedReason: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const result = getRecentContext(parsed.data);
  return c.json(result);
});

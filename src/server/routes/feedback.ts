// FILE: src/server/routes/feedback.ts
// UF-079: POST /feedback — stores user feedback on amplification connections.

import { Hono } from "hono";
import { storeFeedback } from "../../services/personalization/feedback.js";

export const feedbackRoutes = new Hono();

feedbackRoutes.post("/feedback", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-feedback",
          durationMs: 0,
          degraded: true,
          degradedReason: "Invalid JSON body",
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const { connection_id, helpful, domain } = body as {
    connection_id?: string;
    helpful?: boolean;
    domain?: string;
  };

  if (!connection_id || typeof helpful !== "boolean") {
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-feedback",
          durationMs: 0,
          degraded: true,
          degradedReason: "Missing required fields: connection_id (string) and helpful (boolean)",
          lastUpdated: null,
        },
      },
      400,
    );
  }

  const start = performance.now();

  storeFeedback({
    connection_id,
    helpful,
    timestamp: new Date().toISOString(),
    domain,
  });

  return c.json({
    data: { stored: true, connection_id },
    _meta: {
      tool: "unfade-feedback",
      durationMs: Math.round(performance.now() - start),
      degraded: false,
      lastUpdated: new Date().toISOString(),
    },
  });
});

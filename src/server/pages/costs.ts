// FILE: src/server/pages/costs.ts
// Redirect /costs → /cost (canonical). Deduplicated in Sprint 13C.

import { Hono } from "hono";

export const costsPage = new Hono();

costsPage.get("/costs", (c) => c.redirect("/cost", 301));

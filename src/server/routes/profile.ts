// FILE: src/server/routes/profile.ts
// GET /api/profile — reasoning profile via Sprint 2A reader.

import { Hono } from "hono";
import { getProfile } from "../../tools/unfade-profile.js";

export const profileRoutes = new Hono();

profileRoutes.get("/profile", (c) => {
  const result = getProfile();
  return c.json(result);
});

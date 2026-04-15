// FILE: src/schemas/tool-response.ts
// ToolResponse — envelope schema for every tool response.
// Includes _meta with timing, degradation status, and personalization level.

import { z } from "zod";

export const ToolResponseSchema = z.object({
  data: z.unknown(),
  _meta: z.object({
    tool: z.string(),
    durationMs: z.number(),
    degraded: z.boolean().default(false),
    degradedReason: z.string().optional(),
    personalizationLevel: z.enum(["none", "seed", "basic", "deep"]).default("none"),
  }),
});

export type ToolResponse = z.infer<typeof ToolResponseSchema>;

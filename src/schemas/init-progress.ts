// FILE: src/schemas/init-progress.ts
// Tracks init progress across steps so re-runs skip completed work.
// Stored at .unfade/state/init_progress.json.

import { z } from "zod";

export const INIT_STEPS = [
  "scaffold",
  "fingerprint",
  "binary",
  "shell-hooks",
  "autostart",
  "llm-detect",
  "start-daemon",
  "backfill",
] as const;

export type InitStepName = (typeof INIT_STEPS)[number];

const InitStepStatusSchema = z.object({
  completed: z.boolean(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
  skipped: z.boolean().optional(),
});

export type InitStepStatus = z.infer<typeof InitStepStatusSchema>;

export const InitProgressSchema = z.object({
  version: z.literal(1).default(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  steps: z.object({
    scaffold: InitStepStatusSchema.default({ completed: false }),
    fingerprint: InitStepStatusSchema.default({ completed: false }),
    binary: InitStepStatusSchema.default({ completed: false }),
    "shell-hooks": InitStepStatusSchema.default({ completed: false }),
    autostart: InitStepStatusSchema.default({ completed: false }),
    "llm-detect": InitStepStatusSchema.default({ completed: false }),
    "start-daemon": InitStepStatusSchema.default({ completed: false }),
    backfill: InitStepStatusSchema.default({ completed: false }),
  }),
});

export type InitProgress = z.infer<typeof InitProgressSchema>;

/**
 * Create a fresh init progress object with all steps incomplete.
 */
export function createInitProgress(): InitProgress {
  return InitProgressSchema.parse({
    startedAt: new Date().toISOString(),
    steps: {},
  });
}

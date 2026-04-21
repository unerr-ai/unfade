// FILE: src/schemas/event.ts
// CaptureEvent — the universal event format.
// Cross-language contract: mirrors Go struct in daemon/internal/capture/event.go.
// The Go daemon writes CaptureEvent JSON to ~/.unfade/events/YYYY-MM-DD.jsonl;
// the TypeScript CLI reads and validates them with this schema.

import { z } from "zod";

export const CaptureEventSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  timestamp: z.string().datetime(),
  source: z.enum(["git", "ai-session", "terminal", "browser", "manual", "mcp-active"]),
  type: z.enum([
    "commit",
    "diff",
    "branch-switch",
    "revert",
    "stash",
    "merge-conflict",
    "ai-conversation",
    "ai-completion",
    "ai-rejection",
    "command",
    "error",
    "retry",
    "bookmark",
    "tab-visit",
    "annotation",
  ]),
  content: z.object({
    summary: z.string(),
    detail: z.string().optional(),
    files: z.array(z.string()).optional(),
    branch: z.string().optional(),
    project: z.string().optional(),
  }),
  gitContext: z
    .object({
      repo: z.string(),
      branch: z.string(),
      commitHash: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CaptureEvent = z.infer<typeof CaptureEventSchema>;

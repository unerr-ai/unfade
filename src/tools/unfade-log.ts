import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpMeta } from "../schemas/mcp.js";
import { getEventsDir } from "../utils/paths.js";

export const UnfadeLogInputSchema = z.object({
  type: z.enum(["decision", "trade-off", "rejection", "exploration", "dead-end", "breakthrough"]),
  content: z.string().min(1).describe("What happened — the reasoning, not just the action"),
  domain: z
    .string()
    .optional()
    .describe("Engineering domain: architecture, performance, security, etc."),
  alternatives: z.array(z.string()).optional().describe("Other approaches considered"),
  confidence: z.number().min(0).max(1).optional().describe("Agent's confidence in the decision"),
  context: z
    .object({
      files: z.array(z.string()).optional(),
      branch: z.string().optional(),
      relatedDecisions: z.array(z.string()).optional(),
    })
    .optional(),
});

export type UnfadeLogInput = z.infer<typeof UnfadeLogInputSchema>;

export interface UnfadeLogOutput {
  data: { eventId: string; status: string };
  _meta: McpMeta;
}

const TYPE_TO_EVENT_TYPE: Record<string, string> = {
  decision: "ai-conversation",
  "trade-off": "ai-conversation",
  rejection: "ai-rejection",
  exploration: "ai-conversation",
  "dead-end": "ai-rejection",
  breakthrough: "ai-conversation",
};

/**
 * Log a structured reasoning event from an AI agent into .unfade/events/.
 * Source: "mcp-active" — distinguishes agent-reported events from passive capture.
 * Writes in the exact same CaptureEvent JSONL format as the Go daemon.
 */
export function logReasoningEvent(input: UnfadeLogInput, cwd?: string): UnfadeLogOutput {
  const start = performance.now();
  const now = new Date();
  const eventId = crypto.randomUUID();
  const date = now.toISOString().slice(0, 10);

  const event = {
    id: eventId,
    timestamp: now.toISOString(),
    source: "mcp-active",
    type: TYPE_TO_EVENT_TYPE[input.type] ?? "ai-conversation",
    content: {
      summary: truncate(input.content, 200),
      detail: input.content,
      files: input.context?.files,
      branch: input.context?.branch,
    },
    metadata: {
      reasoning_type: input.type,
      domain: input.domain,
      alternatives: input.alternatives,
      confidence: input.confidence,
      related_decisions: input.context?.relatedDecisions,
      alternatives_count: input.alternatives?.length ?? 0,
    },
  };

  const eventsDir = getEventsDir(cwd);
  mkdirSync(eventsDir, { recursive: true });

  const filePath = join(eventsDir, `${date}.jsonl`);
  appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf-8");

  return {
    data: { eventId, status: "logged" },
    _meta: {
      tool: "unfade-log",
      durationMs: Math.round(performance.now() - start),
      degraded: false,
      lastUpdated: now.toISOString(),
    },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

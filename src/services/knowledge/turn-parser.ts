// FILE: src/services/knowledge/turn-parser.ts
// Parses CaptureEvent into structured Turn[] arrays for the knowledge extraction pipeline.
// The Go daemon stores structured turn data in metadata.turns for ai-session events.
// For non-conversation events (git, terminal), synthesizes a single turn from content.

import type { CaptureEvent } from "../../schemas/event.js";

/** A single turn in a conversation — the atomic unit for knowledge extraction. */
export interface Turn {
  index: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  filesReferenced?: string[];
  filesModified?: string[];
  toolUse?: ToolUseEntry[];
}

/** A tool invocation within an assistant turn. */
export interface ToolUseEntry {
  name: string;
  input?: string;
}

/** Raw turn shape from Go daemon's metadata.turns array. */
interface RawMetadataTurn {
  role?: string;
  content?: string;
  turn_index?: number;
  timestamp?: string;
  tool_use?: Array<{ name: string; input?: string }>;
}

/**
 * Parse a CaptureEvent into structured Turn[].
 *
 * Resolution order:
 * 1. metadata.turns (structured JSON from Go daemon) — preferred, lossless
 * 2. content.detail (pipe-separated fallback for older events)
 * 3. content.summary (single-turn synthesis for non-conversation events)
 */
export function parseConversationTurns(event: CaptureEvent): Turn[] {
  // AI conversation events have structured turns in metadata
  if (event.source === "ai-session" && event.metadata?.turns) {
    const parsed = parseFromMetadataTurns(event);
    if (parsed.length > 0) return parsed;
  }

  // AI events without structured turns — parse from content.detail
  if (event.source === "ai-session" && event.content.detail) {
    const parsed = parseFromDetail(event.content.detail);
    if (parsed.length > 0) return parsed;
  }

  // Non-conversation events (git, terminal, manual) — single synthesized turn
  return synthesizeSingleTurn(event);
}

/**
 * Parse from Go daemon's structured metadata.turns array.
 * This is the preferred path — it preserves timestamps, tool use, and full content.
 */
function parseFromMetadataTurns(event: CaptureEvent): Turn[] {
  const rawTurns = event.metadata?.turns as RawMetadataTurn[] | undefined;
  if (!Array.isArray(rawTurns) || rawTurns.length === 0) return [];

  const filesReferenced = asStringArray(event.metadata?.files_referenced);
  const filesModified = asStringArray(event.metadata?.files_modified);

  const turns: Turn[] = [];

  for (let i = 0; i < rawTurns.length; i++) {
    const raw = rawTurns[i];
    const role = normalizeRole(raw.role);
    const content = typeof raw.content === "string" ? raw.content.trim() : "";

    // Skip empty turns and system/summary roles that don't carry extractable content
    if (!content) continue;

    const turn: Turn = {
      index: typeof raw.turn_index === "number" ? raw.turn_index : i,
      role,
      content,
    };

    if (raw.timestamp) {
      turn.timestamp = raw.timestamp;
    }

    // Attach file info to assistant turns (they modify files via tools)
    if (role === "assistant") {
      if (filesModified.length > 0) turn.filesModified = filesModified;
    }
    // Attach referenced files to user turns (they mention files)
    if (role === "user") {
      if (filesReferenced.length > 0) turn.filesReferenced = filesReferenced;
    }

    if (Array.isArray(raw.tool_use) && raw.tool_use.length > 0) {
      turn.toolUse = raw.tool_use
        .filter((t) => typeof t.name === "string")
        .map((t) => ({
          name: t.name,
          ...(t.input ? { input: t.input } : {}),
        }));
    }

    turns.push(turn);
  }

  return turns;
}

/**
 * Parse from content.detail pipe-separated format.
 * Format: "role: content | role: content | ..."
 * Used as fallback for events that lack structured metadata.turns.
 */
function parseFromDetail(detail: string): Turn[] {
  if (!detail.trim()) return [];

  // Try JSON parse first — some tools may store turns as JSON in detail
  try {
    const parsed = JSON.parse(detail);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (t: Record<string, unknown>) =>
            typeof t.role === "string" && typeof t.content === "string",
        )
        .map((t: Record<string, unknown>, i: number) => ({
          index: typeof t.turn_index === "number" ? (t.turn_index as number) : i,
          role: normalizeRole(t.role as string),
          content: (t.content as string).trim(),
          ...(t.timestamp ? { timestamp: t.timestamp as string } : {}),
        }))
        .filter((t: Turn) => t.content.length > 0);
    }
  } catch {
    // Not JSON — try pipe-separated format
  }

  // Pipe-separated format: "user: hello | assistant: hi there | ..."
  const segments = detail.split(" | ");
  const turns: Turn[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i].trim();
    if (!segment) continue;

    const colonIdx = segment.indexOf(": ");
    if (colonIdx === -1) {
      // No role prefix — treat as continuation of previous or user turn
      turns.push({ index: i, role: "user", content: segment });
      continue;
    }

    const rolePart = segment.slice(0, colonIdx).toLowerCase().trim();
    const content = segment.slice(colonIdx + 2).trim();
    if (!content) continue;

    turns.push({
      index: i,
      role: normalizeRole(rolePart),
      content,
    });
  }

  return turns;
}

/**
 * Synthesize a single turn from a non-conversation event.
 * Git commits, terminal commands, etc. become a single "user" turn
 * representing the developer's action.
 */
function synthesizeSingleTurn(event: CaptureEvent): Turn[] {
  const content = event.content.detail?.trim() || event.content.summary?.trim();
  if (!content) return [];

  const turn: Turn = {
    index: 0,
    role: "user",
    content,
  };

  if (event.timestamp) {
    turn.timestamp = event.timestamp;
  }

  if (event.content.files?.length) {
    turn.filesModified = event.content.files;
  }

  return [turn];
}

/** Normalize role strings to the three canonical roles. */
function normalizeRole(role?: string): "user" | "assistant" | "system" {
  if (!role) return "user";
  const lower = role.toLowerCase().trim();

  if (lower === "user" || lower === "human") return "user";
  if (lower === "assistant" || lower === "ai" || lower === "bot") return "assistant";
  if (lower === "system") return "system";

  // Claude-specific: "summary" turns are system-level
  if (lower === "summary") return "system";

  // Default: treat unknown roles as user (developer-driven)
  return "user";
}

/** Safely extract a string array from unknown metadata value. */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Extract the user-only turns (developer prompts).
 * Useful for comprehension assessment — what did the developer actually ask/say.
 */
export function extractUserTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.role === "user");
}

/**
 * Extract assistant-only turns (AI responses).
 * Useful for agency classification — what did the AI produce.
 */
export function extractAssistantTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.role === "assistant");
}

/**
 * Count the total conversation token estimate (rough: 4 chars ≈ 1 token).
 * Used for deciding whether to use single-pass or chunked extraction.
 */
export function estimateTokenCount(turns: Turn[]): number {
  let totalChars = 0;
  for (const turn of turns) {
    totalChars += turn.content.length;
  }
  return Math.ceil(totalChars / 4);
}

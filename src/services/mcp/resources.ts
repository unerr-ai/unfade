// FILE: src/services/mcp/resources.ts
// UF-043: MCP Resources — 5 read-only resources exposed via MCP protocol.
// Each calls Sprint 2A read services. NEVER throws — returns empty content
// with status metadata when data unavailable.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRecentContext } from "../../tools/unfade-context.js";
import { getDecisions } from "../../tools/unfade-decisions.js";
import { getProfile } from "../../tools/unfade-profile.js";
import { getDistillsDir } from "../../utils/paths.js";

/**
 * Read the latest distill markdown file and return its content.
 */
function readLatestDistill(): { content: string; date: string } | null {
  const distillsDir = getDistillsDir();
  if (!existsSync(distillsDir)) return null;

  try {
    const files = readdirSync(distillsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse();
    if (files.length === 0) return null;

    const date = files[0].replace(".md", "");
    const content = readFileSync(join(distillsDir, files[0]), "utf-8");
    return { content, date };
  } catch {
    return null;
  }
}

/**
 * Register all 5 MCP resources on the server.
 */
export function registerResources(server: McpServer): void {
  // 1. unfade://context/recent — Last 2 hours of reasoning events
  server.resource(
    "recent-context",
    "unfade://context/recent",
    { description: "Last 2 hours of reasoning events" },
    () => {
      const result = getRecentContext({ scope: "last_2h" });
      const text = result._meta.degraded
        ? JSON.stringify({ status: "unavailable", reason: result._meta.degradedReason })
        : JSON.stringify(result.data, null, 2);

      return {
        contents: [
          {
            uri: "unfade://context/recent",
            mimeType: "application/json",
            text,
          },
        ],
      };
    },
  );

  // 2. unfade://context/today — Today's complete reasoning context
  server.resource(
    "today-context",
    "unfade://context/today",
    { description: "Today's complete reasoning context" },
    () => {
      const result = getRecentContext({ scope: "today" });
      const text = result._meta.degraded
        ? JSON.stringify({ status: "unavailable", reason: result._meta.degradedReason })
        : JSON.stringify(result.data, null, 2);

      return {
        contents: [
          {
            uri: "unfade://context/today",
            mimeType: "application/json",
            text,
          },
        ],
      };
    },
  );

  // 3. unfade://profile — Developer's reasoning profile
  server.resource(
    "reasoning-profile",
    "unfade://profile",
    { description: "Developer's reasoning profile — decision style, domains, patterns" },
    () => {
      const result = getProfile();
      const text = result._meta.degraded
        ? JSON.stringify({ status: "unavailable", reason: result._meta.degradedReason })
        : JSON.stringify(result.data, null, 2);

      return {
        contents: [
          {
            uri: "unfade://profile",
            mimeType: "application/json",
            text,
          },
        ],
      };
    },
  );

  // 4. unfade://decisions/recent — Recent decisions with alternatives and trade-offs
  server.resource(
    "recent-decisions",
    "unfade://decisions/recent",
    { description: "Recent decisions with alternatives and trade-offs" },
    () => {
      const result = getDecisions({ limit: 10 });
      const text = result._meta.degraded
        ? JSON.stringify({ status: "unavailable", reason: result._meta.degradedReason })
        : JSON.stringify(result.data, null, 2);

      return {
        contents: [
          {
            uri: "unfade://decisions/recent",
            mimeType: "application/json",
            text,
          },
        ],
      };
    },
  );

  // 5. unfade://distill/latest — Most recent Daily Distill
  server.resource(
    "latest-distill",
    "unfade://distill/latest",
    { description: "Most recent Daily Distill — full Markdown reasoning summary" },
    () => {
      const distill = readLatestDistill();
      const text = distill
        ? distill.content
        : JSON.stringify({ status: "unavailable", reason: "No distills generated yet" });
      const mimeType = distill ? "text/markdown" : "application/json";

      return {
        contents: [
          {
            uri: "unfade://distill/latest",
            mimeType,
            text,
          },
        ],
      };
    },
  );
}

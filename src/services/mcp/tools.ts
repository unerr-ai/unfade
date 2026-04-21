// FILE: src/services/mcp/tools.ts
// UF-044: MCP Tools — 5 executable tools exposed via MCP protocol.
// Zod-validated inputs (Sprint 2A schemas), _meta envelope responses.
// Degradation: not initialized → { status: "not_initialized" } with setup instructions.
// Never throws — agents must not crash because Unfade is unavailable.

import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyFeatureTag } from "../../commands/tag.js";
import { loadConfig } from "../../config/manager.js";
import { getAmplification } from "../../tools/unfade-amplify.js";
import { getCoachInsights } from "../../tools/unfade-coach.js";
import { getComprehension } from "../../tools/unfade-comprehension.js";
import { getRecentContext } from "../../tools/unfade-context.js";
import { getCosts } from "../../tools/unfade-costs.js";
import { getDecisions } from "../../tools/unfade-decisions.js";
import { getEfficiency } from "../../tools/unfade-efficiency.js";
import { logReasoningEvent, UnfadeLogInputSchema } from "../../tools/unfade-log.js";
import { getProfile } from "../../tools/unfade-profile.js";
import { queryEvents } from "../../tools/unfade-query.js";
import { getSimilar } from "../../tools/unfade-similar.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir } from "../../utils/paths.js";
import { CacheManager } from "../cache/manager.js";
import { distill } from "../distill/distiller.js";
import { enrichMcpMeta } from "../intelligence/mcp-enrichment.js";

/**
 * Check if Unfade is initialized (has .unfade/ directory).
 */
function isInitialized(): boolean {
  try {
    return existsSync(getProjectDataDir());
  } catch {
    return false;
  }
}

/**
 * Return a not-initialized response for tools.
 */
function notInitializedResponse(): { content: { type: "text"; text: string }[] } {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          data: null,
          _meta: {
            tool: "unfade",
            durationMs: 0,
            degraded: true,
            degradedReason: "not_initialized",
            lastUpdated: null,
          },
          status: "not_initialized",
          setup: "Run `npx unfade` to initialize Unfade in this project",
        }),
      },
    ],
  };
}

/**
 * Register all 7 MCP tools on the server.
 */
export function registerTools(server: McpServer): void {
  // 1. unfade_query — Semantic search across reasoning history
  server.tool(
    "unfade_query",
    "Search across your reasoning history — distills, events, decisions",
    {
      query: z.string().describe("Search query for reasoning history"),
      project: z.string().optional().describe("Project ID to scope query. Omit for cross-project."),
      dateRange: z
        .object({
          from: z.string().date().optional().describe("Start date (YYYY-MM-DD)"),
          to: z.string().date().optional().describe("End date (YYYY-MM-DD)"),
        })
        .optional()
        .describe("Optional date range filter"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of results (1-50, default 10)"),
    },
    (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = queryEvents({
          query: args.query,
          dateRange: args.dateRange,
          limit: args.limit ?? 10,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error("MCP unfade_query error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { results: [], total: 0 },
                _meta: {
                  tool: "unfade-query",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Query failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 2. unfade_context — Get recent reasoning context
  server.tool(
    "unfade_context",
    "Get recent reasoning context — what you were working on and why",
    {
      project: z.string().optional().describe("Project ID to scope query. Omit for cross-project."),
      scope: z
        .enum(["last_2h", "today", "this_week"])
        .default("today")
        .describe("Time scope: last_2h, today, or this_week"),
    },
    (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = getRecentContext({
          scope: args.scope ?? "today",
          project: args.project,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error("MCP unfade_context error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { scope: args.scope, events: [], eventCount: 0, distillSummary: null },
                _meta: {
                  tool: "unfade-context",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Context retrieval failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 3. unfade_decisions — List recent decisions
  server.tool(
    "unfade_decisions",
    "List recent engineering decisions with rationale and trade-offs",
    {
      project: z.string().optional().describe("Project ID to scope query. Omit for cross-project."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of decisions (1-50, default 10)"),
      domain: z.string().optional().describe("Filter by domain (e.g., 'backend', 'auth')"),
    },
    (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = getDecisions({
          limit: args.limit ?? 10,
          domain: args.domain,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error("MCP unfade_decisions error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { decisions: [], total: 0 },
                _meta: {
                  tool: "unfade-decisions",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Decisions retrieval failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 4. unfade_profile — Get reasoning profile
  server.tool(
    "unfade_profile",
    "Get your reasoning profile — decision style, domain expertise, patterns",
    {},
    () => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = getProfile();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error("MCP unfade_profile error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: null,
                _meta: {
                  tool: "unfade-profile",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Profile retrieval failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 5. unfade_distill — Trigger manual distillation
  server.tool(
    "unfade_distill",
    "Trigger manual distillation — synthesize today's reasoning into a summary",
    {
      date: z
        .string()
        .date()
        .optional()
        .describe("Date to distill (YYYY-MM-DD, defaults to today)"),
    },
    async (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const targetDate = args.date ?? new Date().toISOString().slice(0, 10);
        const config = loadConfig();
        const result = await distill(targetDate, config);

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  data: { status: "no_events", date: targetDate },
                  _meta: {
                    tool: "unfade-distill",
                    durationMs: 0,
                    degraded: false,
                    lastUpdated: null,
                  },
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: {
                  status: "completed",
                  date: result.distill.date,
                  summary: result.distill.summary,
                  decisions: result.distill.decisions.length,
                  eventsProcessed: result.distill.eventsProcessed,
                },
                _meta: {
                  tool: "unfade-distill",
                  durationMs: 0,
                  degraded: false,
                  lastUpdated: new Date().toISOString(),
                },
              }),
            },
          ],
        };
      } catch (err) {
        logger.error("MCP unfade_distill error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { status: "error" },
                _meta: {
                  tool: "unfade-distill",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Distillation failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 6. unfade_amplify — Cross-temporal connection detection
  server.tool(
    "unfade_amplify",
    "Detect cross-temporal connections — find past decisions similar to today's reasoning",
    {
      project: z.string().optional().describe("Project ID to scope query. Omit for cross-project."),
      date: z.string().date().describe("Date to amplify (YYYY-MM-DD)"),
    },
    (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = getAmplification(args.date);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error("MCP unfade_amplify error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { connections: [], date: args.date },
                _meta: {
                  tool: "unfade-amplify",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Amplification failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 7. unfade_similar — Find analogous past decisions
  server.tool(
    "unfade_similar",
    "Search past decisions for analogous reasoning — find what you decided before about similar problems",
    {
      project: z.string().optional().describe("Project ID to scope query. Omit for cross-project."),
      problem: z.string().describe("Problem or decision description to search for"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of results (1-50, default 10)"),
    },
    (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = getSimilar(args.problem, args.limit ?? 10);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error("MCP unfade_similar error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { results: [], total: 0 },
                _meta: {
                  tool: "unfade-similar",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Similar search failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 8. unfade_log — Log a structured reasoning event (active instrumentation)
  server.tool(
    "unfade_log",
    "Log a structured reasoning event to the developer's local reasoning journal",
    {
      type: UnfadeLogInputSchema.shape.type,
      content: z.string().min(1).describe("What happened — the reasoning, not just the action"),
      domain: z
        .string()
        .optional()
        .describe("Engineering domain: architecture, performance, security, etc."),
      alternatives: z.array(z.string()).optional().describe("Other approaches considered"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Agent's confidence in the decision"),
      context: z
        .object({
          files: z.array(z.string()).optional(),
          branch: z.string().optional(),
          relatedDecisions: z.array(z.string()).optional(),
        })
        .optional(),
    },
    (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = logReasoningEvent(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error("MCP unfade_log error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { eventId: null, status: "error" },
                _meta: {
                  tool: "unfade-log",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Log failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 8. unfade_comprehension — Per-module comprehension scores (Phase 5.6H)
  server.tool(
    "unfade_comprehension",
    "Get per-module comprehension scores — shows which parts of the codebase the developer understands deeply vs relies on AI blindly",
    {},
    async () => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const result = await getComprehension();
        const enrichedMeta = enrichMcpMeta(result._meta);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ...result, _meta: enrichedMeta }, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.error("MCP unfade_comprehension error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { overall: null, modules: [], totalModules: 0 },
                _meta: {
                  tool: "unfade-comprehension",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: err instanceof Error ? err.message : "Comprehension query failed",
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 9. unfade_efficiency — AI Efficiency Score (Phase 7)
  server.tool(
    "unfade_efficiency",
    "Get your AI Efficiency Score (AES) — a 0-100 composite metric showing how effectively you use AI tools",
    {
      period: z.enum(["7d", "30d", "90d"]).optional().describe("Time period for analysis"),
    },
    async (args) => {
      if (!isInitialized()) return notInitializedResponse();
      try {
        const result = getEfficiency({ period: args.period });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: null,
                _meta: {
                  tool: "unfade-efficiency",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: String(err),
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 10. unfade_costs — Cost Attribution (Phase 7)
  server.tool(
    "unfade_costs",
    "Get estimated AI cost attribution — by model, domain, and branch (proxy estimates, not invoices)",
    {
      period: z.string().optional().describe("Time period"),
      groupBy: z.enum(["domain", "model", "branch"]).optional().describe("Grouping dimension"),
    },
    async (args) => {
      if (!isInitialized()) return notInitializedResponse();
      try {
        const result = getCosts({ period: args.period, groupBy: args.groupBy });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: null,
                _meta: {
                  tool: "unfade-costs",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: String(err),
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // 11. unfade_coach — Prompt Coach (Phase 7B)
  server.tool(
    "unfade_coach",
    "Get domain-specific prompt coaching: effective patterns, anti-patterns, and active loop warnings from your AI interaction history",
    {
      domain: z
        .string()
        .optional()
        .describe("Filter to a specific domain (e.g., 'api', 'auth', 'database')"),
    },
    async (args) => {
      if (!isInitialized()) return notInitializedResponse();
      try {
        const result = getCoachInsights({ domain: args.domain });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: null,
                _meta: {
                  tool: "unfade-coach",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: String(err),
                  lastUpdated: null,
                },
              }),
            },
          ],
        };
      }
    },
  );

  // unfade_tag — Explicitly bind a feature tag to recent events
  server.tool(
    "unfade_tag",
    "Tag recent AI conversation events with a feature name — use when automatic feature detection fails",
    {
      featureName: z.string().describe("The feature name to tag events with"),
      last: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe("Number of recent events to tag (default 5)"),
    },
    async (args) => {
      if (!isInitialized()) return notInitializedResponse();

      try {
        const cache = new CacheManager();
        const db = await cache.getDb();
        if (!db) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  data: null,
                  _meta: {
                    tool: "unfade-tag",
                    durationMs: 0,
                    degraded: true,
                    degradedReason: "Cache not available",
                  },
                }),
              },
            ],
          };
        }

        const rows = db.exec(
          "SELECT id FROM events WHERE type = 'ai-conversation' ORDER BY ts DESC LIMIT ?",
          [args.last ?? 5],
        );
        const eventIds = rows[0]?.values.map((r) => r[0] as string) ?? [];

        const tagged = applyFeatureTag(db, args.featureName, eventIds);
        await cache.save();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: { featureName: args.featureName, eventsTagged: tagged },
                _meta: { tool: "unfade-tag", durationMs: 0, degraded: false },
              }),
            },
          ],
        };
      } catch (err) {
        logger.error("MCP unfade_tag error", { error: String(err) });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                data: null,
                _meta: {
                  tool: "unfade-tag",
                  durationMs: 0,
                  degraded: true,
                  degradedReason: String(err),
                },
              }),
            },
          ],
        };
      }
    },
  );
}

// FILE: src/services/mcp/prompts.ts
// UF-045: MCP Prompts — 3 reasoning framework prompts.
// Each fetches relevant context from read services and constructs
// system messages that inject developer patterns into agent workflows.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRecentContext } from "../../tools/unfade-context.js";
import { getDecisions } from "../../tools/unfade-decisions.js";
import { getProfile } from "../../tools/unfade-profile.js";

/**
 * Register all 3 MCP prompts on the server.
 */
export function registerPrompts(server: McpServer): void {
  // 1. unfade_code_review — Code review informed by developer's reasoning patterns
  server.prompt(
    "unfade_code_review",
    "Code review informed by your reasoning patterns and past decisions",
    { diff: z.string().describe("The diff or code changes to review") },
    (args) => {
      const profile = getProfile();
      const decisions = getDecisions({ limit: 5 });
      const context = getRecentContext({ scope: "today" });

      const profileSummary = profile._meta.degraded
        ? "No reasoning profile available yet."
        : [
            `Decision style: evaluates ~${profile.data.avgAlternativesEvaluated.toFixed(1)} alternatives per decision`,
            `AI acceptance rate: ${(profile.data.aiAcceptanceRate * 100).toFixed(0)}%`,
            `Top domains: ${
              profile.data.domainDistribution
                .slice(0, 3)
                .map((d) => d.domain)
                .join(", ") || "none yet"
            }`,
            `Patterns: ${profile.data.patterns.join(", ") || "none detected"}`,
          ].join("\n");

      const recentDecisions = decisions._meta.degraded
        ? "No recent decisions found."
        : decisions.data.decisions
            .map((d) => `- ${d.decision}${d.rationale ? ` (${d.rationale})` : ""}`)
            .join("\n");

      const todayContext =
        context.data.eventCount > 0
          ? `Today's activity: ${context.data.eventCount} events captured.${context.data.distillSummary ? ` Summary: ${context.data.distillSummary}` : ""}`
          : "No activity captured today.";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "Review the following code changes using context from my reasoning history.",
                "",
                "## Developer Profile",
                profileSummary,
                "",
                "## Recent Decisions",
                recentDecisions,
                "",
                "## Today's Context",
                todayContext,
                "",
                "## Code Changes",
                "```",
                args.diff,
                "```",
                "",
                "Review this code considering:",
                "1. Consistency with my recent decisions and architectural patterns",
                "2. Whether this aligns with my domain expertise areas",
                "3. Potential dead ends I've hit before in similar changes",
                "4. Trade-offs that match my decision-making style",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  // 2. unfade_architecture — Architecture decision informed by past decisions
  server.prompt(
    "unfade_architecture",
    "Architecture decision informed by your past decisions and trade-off preferences",
    { question: z.string().describe("The architecture question or decision to make") },
    (args) => {
      const profile = getProfile();
      const decisions = getDecisions({ limit: 10 });

      const profileSummary = profile._meta.degraded
        ? "No reasoning profile available yet."
        : [
            `Exploration depth: evaluates ~${profile.data.avgAlternativesEvaluated.toFixed(1)} alternatives`,
            `Dead ends per day: ${profile.data.avgDeadEndsPerDay.toFixed(1)}`,
            `Domain distribution: ${profile.data.domainDistribution.map((d) => `${d.domain} (${d.frequency})`).join(", ") || "none"}`,
            `Patterns: ${profile.data.patterns.join(", ") || "none detected"}`,
          ].join("\n");

      const pastDecisions = decisions._meta.degraded
        ? "No past decisions found."
        : decisions.data.decisions
            .map(
              (d) =>
                `- [${d.date}]${d.domain ? ` [${d.domain}]` : ""} ${d.decision}${d.rationale ? `\n  Rationale: ${d.rationale}` : ""}`,
            )
            .join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "Help me make an architecture decision using context from my reasoning history.",
                "",
                "## My Decision-Making Profile",
                profileSummary,
                "",
                "## Past Architectural Decisions",
                pastDecisions,
                "",
                "## Current Question",
                args.question,
                "",
                "Consider:",
                "1. How this decision relates to my past architectural choices",
                "2. Trade-offs I typically prefer (based on my decision patterns)",
                "3. Domains where I have deep expertise vs. areas where I'm less experienced",
                "4. Past dead ends to avoid repeating",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  // 3. unfade_debug — Debugging approach informed by past dead ends
  server.prompt(
    "unfade_debug",
    "Debugging approach informed by your past dead ends and exploration patterns",
    {
      error: z.string().describe("The error message or bug description"),
      context: z.string().optional().describe("Additional context about what you were doing"),
    },
    (args) => {
      const profile = getProfile();
      const recentContext = getRecentContext({ scope: "last_2h" });
      const decisions = getDecisions({ limit: 5 });

      const debugProfile = profile._meta.degraded
        ? "No reasoning profile available yet."
        : [
            `Dead ends per day: ${profile.data.avgDeadEndsPerDay.toFixed(1)}`,
            `Exploration depth: evaluates ~${profile.data.avgAlternativesEvaluated.toFixed(1)} alternatives`,
            `Patterns: ${profile.data.patterns.join(", ") || "none detected"}`,
          ].join("\n");

      const recentActivity =
        recentContext.data.eventCount > 0
          ? recentContext.data.events
              .slice(0, 10)
              .map((e) => `- [${e.type}] ${e.summary}`)
              .join("\n")
          : "No recent activity captured.";

      const recentDecisions = decisions._meta.degraded
        ? ""
        : decisions.data.decisions.map((d) => `- ${d.decision}`).join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "Help me debug this issue using context from my recent activity and reasoning patterns.",
                "",
                "## Debugging Profile",
                debugProfile,
                "",
                "## Recent Activity (last 2 hours)",
                recentActivity,
                ...(recentDecisions ? ["", "## Recent Decisions", recentDecisions] : []),
                "",
                "## Error",
                args.error,
                ...(args.context ? ["", "## Additional Context", args.context] : []),
                "",
                "Approach this debugging session considering:",
                "1. What I was working on recently (see activity above)",
                "2. Dead ends I've hit before — suggest alternative approaches early",
                "3. My typical exploration depth — match my debugging style",
                "4. Related decisions that might have introduced this issue",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

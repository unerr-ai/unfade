// FILE: src/services/integrations/skills-writer.ts
// Detects installed coding agents and writes skill/rules files for unfade MCP integration.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";

export interface DetectedAgent {
  id: string;
  name: string;
  installed: boolean;
  hasSkills: boolean;
  skillPath: string;
}

const SKILL_CONTENT = `# Unfade — Reasoning-Aware Development

You have access to Unfade's MCP tools that provide context about the developer's reasoning history, past decisions, and working patterns. Use these tools proactively to write better code and avoid repeated mistakes.

## When starting a task

Call \`unfade_context\` to get recent reasoning context for the current project. This tells you what the developer has been working on, recent decisions, and active threads of work.

## Before making architectural decisions

Call \`unfade_decisions\` to see past engineering decisions and their rationale. This prevents re-debating settled questions and helps you build on established patterns.

Call \`unfade_similar\` with a description of your current decision to find analogous past decisions and their outcomes.

## When investigating bugs or issues

Call \`unfade_query\` with relevant keywords to search across reasoning history. Past dead ends, failed approaches, and debugging sessions are all captured.

## When you make a significant decision

Call \`unfade_log\` to record the decision, alternatives considered, and rationale. This builds the developer's reasoning history for future reference.

Example:
\`\`\`
unfade_log({
  type: "decision",
  content: "Chose WebSocket over SSE for real-time updates because we need bidirectional communication",
  tags: ["architecture", "real-time"]
})
\`\`\`

## For code review context

Call \`unfade_profile\` to understand the developer's reasoning patterns, expertise areas, and decision style. This helps you tailor suggestions appropriately.

## Available tools

| Tool | Purpose |
|------|---------|
| \`unfade_context\` | Recent reasoning context for current task |
| \`unfade_query\` | Search across all reasoning history |
| \`unfade_decisions\` | List recent engineering decisions |
| \`unfade_profile\` | Developer reasoning profile and patterns |
| \`unfade_similar\` | Find analogous past decisions |
| \`unfade_amplify\` | Detect cross-temporal reasoning connections |
| \`unfade_distill\` | Trigger on-demand reasoning distillation |
| \`unfade_log\` | Log a structured reasoning event |
| \`unfade_tag\` | Tag recent AI conversation events |
| \`unfade_comprehension\` | Per-module comprehension scores |
| \`unfade_efficiency\` | AI Efficiency Score and sub-metrics |
| \`unfade_costs\` | Token spend and cost attribution |
`;

interface AgentConfig {
  id: string;
  name: string;
  detectPath: string;
  skillDir: string;
  skillFile: string;
}

const AGENTS: AgentConfig[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    detectPath: join(homedir(), ".claude"),
    skillDir: join(homedir(), ".claude", "commands"),
    skillFile: "unfade.md",
  },
  {
    id: "cursor",
    name: "Cursor",
    detectPath: join(homedir(), ".cursor"),
    skillDir: join(homedir(), ".cursor", "rules"),
    skillFile: "unfade.mdc",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detectPath: join(homedir(), ".codeium", "windsurf"),
    skillDir: join(homedir(), ".codeium", "windsurf", "rules"),
    skillFile: "unfade.md",
  },
];

export function detectInstalledAgents(): DetectedAgent[] {
  return AGENTS.map((agent) => {
    const installed = existsSync(agent.detectPath);
    const skillPath = join(agent.skillDir, agent.skillFile);
    const hasSkills = existsSync(skillPath);
    return {
      id: agent.id,
      name: agent.name,
      installed,
      hasSkills,
      skillPath,
    };
  });
}

export function installSkills(agentId: string): { success: boolean; path: string; error?: string } {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    return { success: false, path: "", error: `Unknown agent: ${agentId}` };
  }

  if (!existsSync(agent.detectPath)) {
    return { success: false, path: "", error: `${agent.name} is not installed` };
  }

  const skillPath = join(agent.skillDir, agent.skillFile);

  try {
    mkdirSync(agent.skillDir, { recursive: true });

    // Atomic write
    const tmpPath = `${skillPath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, SKILL_CONTENT, "utf-8");
    renameSync(tmpPath, skillPath);

    logger.info("Skills installed", { agent: agentId, path: skillPath });
    return { success: true, path: skillPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to install skills", { agent: agentId, error: msg });
    return { success: false, path: skillPath, error: msg };
  }
}

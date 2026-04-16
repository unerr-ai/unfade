// FILE: src/server/pages/settings.ts
// UF-051a-settings: Settings page (GET /settings) — capture engine status,
// source toggles, LLM config, "Connect AI Tools" MCP config snippets.

import { Hono } from "hono";
import { USER_TERMS } from "../../constants/terminology.js";
import { getProfile } from "../../tools/unfade-profile.js";
import { escapeHtml, layout } from "./layout.js";

export const settingsPage = new Hono();

const CLAUDE_CODE_CONFIG = `{
  "mcpServers": {
    "unfade": {
      "command": "npx",
      "args": ["unfade", "mcp"]
    }
  }
}`;

const CURSOR_CONFIG = `{
  "mcpServers": {
    "unfade": {
      "command": "npx",
      "args": ["unfade", "mcp"]
    }
  }
}`;

const WINDSURF_CONFIG = `{
  "mcpServers": {
    "unfade": {
      "command": "npx",
      "args": ["unfade", "mcp"]
    }
  }
}`;

const GENERIC_CONFIG = `{
  "command": "npx",
  "args": ["unfade", "mcp"],
  "transport": "stdio"
}`;

settingsPage.get("/settings", (c) => {
  const profile = getProfile();
  const isHealthy = !profile._meta.degraded;

  const statusBadge = isHealthy
    ? `<span class="badge badge-ok">${escapeHtml(USER_TERMS.daemonRunning)}</span>`
    : `<span class="badge badge-warn">${escapeHtml(USER_TERMS.daemonStopped)}</span>`;

  const content = `
    <h1>Settings</h1>

    <div class="config-section">
      <h2>${escapeHtml(USER_TERMS.daemon)} Status</h2>
      <div class="card">
        <p>${statusBadge}</p>
        <p style="color: var(--text-dim); font-size: 0.875rem; margin-top: 0.5rem;">
          The ${escapeHtml(USER_TERMS.daemon)} runs in the background and passively captures ${escapeHtml(USER_TERMS.events)} from your workflow.
        </p>
      </div>
    </div>

    <div class="config-section">
      <h2>Capture Sources</h2>
      <div class="card">
        <ul class="domain-list">
          <li>
            <span>Git commits &amp; diffs</span>
            <span class="badge badge-ok">Active</span>
          </li>
          <li>
            <span>AI sessions (Claude, ChatGPT, Copilot)</span>
            <span class="badge badge-ok">Active</span>
          </li>
          <li>
            <span>Terminal activity</span>
            <span class="badge badge-ok">Active</span>
          </li>
        </ul>
        <p style="color: var(--text-dim); font-size: 0.8rem; margin-top: 0.75rem;">
          Capture source configuration coming in a future release.
        </p>
      </div>
    </div>

    <div class="config-section">
      <h2>Connect AI Tools</h2>
      <p style="color: var(--text-dim); font-size: 0.9rem; margin-bottom: 1rem;">
        Add Unfade as an MCP server to give your AI tools access to your reasoning history.
        Copy the config below into your tool's settings file.
      </p>

      <div class="card">
        <h3>Claude Code</h3>
        <p style="color: var(--text-dim); font-size: 0.8rem; margin-bottom: 0.5rem;">
          Add to <code>~/.claude/settings.json</code>
        </p>
        <pre><code>${escapeHtml(CLAUDE_CODE_CONFIG)}</code></pre>
      </div>

      <div class="card">
        <h3>Cursor</h3>
        <p style="color: var(--text-dim); font-size: 0.8rem; margin-bottom: 0.5rem;">
          Add to <code>.cursor/mcp.json</code>
        </p>
        <pre><code>${escapeHtml(CURSOR_CONFIG)}</code></pre>
      </div>

      <div class="card">
        <h3>Windsurf</h3>
        <p style="color: var(--text-dim); font-size: 0.8rem; margin-bottom: 0.5rem;">
          Add to your Windsurf MCP configuration
        </p>
        <pre><code>${escapeHtml(WINDSURF_CONFIG)}</code></pre>
      </div>

      <div class="card">
        <h3>Generic MCP Client</h3>
        <p style="color: var(--text-dim); font-size: 0.8rem; margin-bottom: 0.5rem;">
          Use this config for any MCP-compatible tool
        </p>
        <pre><code>${escapeHtml(GENERIC_CONFIG)}</code></pre>
      </div>
    </div>
  `;

  return c.html(layout("Settings", content));
});

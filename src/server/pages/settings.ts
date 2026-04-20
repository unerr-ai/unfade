// FILE: src/server/pages/settings.ts
// Settings page (GET /settings) — capture engine status,
// LLM provider config with awareness explainer, MCP config snippets.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { USER_TERMS } from "../../constants/terminology.js";
import { getProfile } from "../../tools/unfade-profile.js";
import { getProjectDataDir } from "../../utils/paths.js";
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

/**
 * Read current distill config from config.json for form defaults.
 */
function readCurrentLlmConfig(): {
  provider: string;
  model: string;
  apiKey: string;
  apiBase: string;
} {
  try {
    const configPath = join(getProjectDataDir(), "config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const distill = raw?.distill ?? {};
    return {
      provider: distill.provider ?? "ollama",
      model: distill.model ?? "llama3.2",
      apiKey: distill.apiKey ?? "",
      apiBase: distill.apiBase ?? "",
    };
  } catch {
    return { provider: "ollama", model: "llama3.2", apiKey: "", apiBase: "" };
  }
}

settingsPage.get("/settings", (c) => {
  const profile = getProfile();
  const isHealthy = !profile._meta.degraded;
  const llm = readCurrentLlmConfig();

  const statusBadge = isHealthy
    ? `<span class="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-success/15 text-success">${escapeHtml(USER_TERMS.daemonRunning)}</span>`
    : `<span class="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-warning/15 text-warning">${escapeHtml(USER_TERMS.daemonStopped)}</span>`;

  const sel = (val: string) => (llm.provider === val ? "selected" : "");

  // LLM status indicator for the top of the page
  const llmStatusCard =
    llm.provider === "none"
      ? `<div class="bg-warning/10 border border-warning/30 rounded p-4 mb-6 flex items-start gap-3">
           <span class="text-warning text-xl mt-0.5">⚠</span>
           <div>
             <p class="text-foreground font-semibold text-sm">No LLM configured</p>
             <p class="text-muted text-sm mt-1">Without an LLM, Unfade uses basic structured summaries. Configure a provider below to unlock richer distills with reasoning extraction, pattern detection, and cross-session insights.</p>
           </div>
         </div>`
      : `<div class="bg-success/10 border border-success/30 rounded p-4 mb-6 flex items-start gap-3">
           <span class="text-success text-xl mt-0.5">✓</span>
           <div>
             <p class="text-foreground font-semibold text-sm">LLM active: ${escapeHtml(llm.provider)}/${escapeHtml(llm.model)}</p>
             <p class="text-muted text-sm mt-1">Your distills are powered by AI — reasoning extraction, pattern detection, and cross-session insights are enabled.</p>
           </div>
         </div>`;

  const content = `
    <h1 class="text-2xl font-heading font-semibold mb-6">Settings</h1>

    ${llmStatusCard}

    <!-- Daemon status -->
    <div class="mb-8">
      <h2 class="text-lg font-heading font-semibold mb-3">${escapeHtml(USER_TERMS.daemon)} Status</h2>
      <div class="bg-surface border border-border rounded p-5">
        <p class="mb-2">${statusBadge}</p>
        <p class="text-muted text-sm mt-2">The ${escapeHtml(USER_TERMS.daemon)} runs in the background and passively captures ${escapeHtml(USER_TERMS.events)} from your workflow.</p>
      </div>
    </div>

    <!-- LLM provider -->
    <div class="mb-8">
      <h2 class="text-lg font-heading font-semibold mb-2">LLM Provider</h2>
      <p class="text-muted text-sm mb-4">Unfade uses an LLM to distill captured reasoning into structured summaries. Ollama runs locally with no API key. For cloud providers or any OpenAI-compatible API, choose "Custom" and provide the base URL and key.</p>
      <div class="bg-surface border border-border rounded p-5">
        <form hx-post="/unfade/settings/llm" hx-target="#llm-result" hx-swap="innerHTML">
          <div class="mb-4">
            <label for="provider" class="block text-sm font-semibold mb-1.5">Provider</label>
            <select id="provider" name="provider" onchange="toggleLlmFields()"
              class="w-full px-3 py-2 text-sm bg-raised text-foreground border border-border rounded outline-none focus:border-accent font-body">
              <option value="ollama" ${sel("ollama")}>Ollama (local)</option>
              <option value="openai" ${sel("openai")}>OpenAI</option>
              <option value="anthropic" ${sel("anthropic")}>Anthropic</option>
              <option value="custom" ${sel("custom")}>Custom (OpenAI-compatible)</option>
              <option value="none" ${sel("none")}>None (structured summaries only)</option>
            </select>
          </div>

          <div id="llm-model-group" class="mb-4">
            <label for="model" class="block text-sm font-semibold mb-1.5">Model</label>
            <input type="text" id="model" name="model" value="${escapeHtml(llm.model)}"
              placeholder="e.g. llama3.2, gpt-4o, claude-sonnet-4-20250514"
              class="w-full px-3 py-2 text-sm bg-raised text-foreground border border-border rounded outline-none focus:border-accent font-body" />
          </div>

          <div id="llm-apibase-group" class="mb-4">
            <label for="apiBase" class="block text-sm font-semibold mb-1.5">API Base URL</label>
            <input type="text" id="apiBase" name="apiBase" value="${escapeHtml(llm.apiBase)}"
              placeholder="e.g. https://api.openai.com/v1 or http://localhost:11434/api"
              class="w-full px-3 py-2 text-sm bg-raised text-foreground border border-border rounded outline-none focus:border-accent font-body" />
            <span class="block text-xs text-muted mt-1">Leave blank for provider defaults. Required for Custom provider.</span>
          </div>

          <div id="llm-apikey-group" class="mb-4">
            <label for="apiKey" class="block text-sm font-semibold mb-1.5">API Key</label>
            <input type="password" id="apiKey" name="apiKey" value="${escapeHtml(llm.apiKey)}"
              placeholder="sk-..." autocomplete="off"
              class="w-full px-3 py-2 text-sm bg-raised text-foreground border border-border rounded outline-none focus:border-accent font-body" />
            <span class="block text-xs text-muted mt-1">Stored locally in .unfade/config.json. Never sent anywhere except your chosen provider.</span>
          </div>

          <button type="submit" class="mt-2 px-4 py-2 text-sm rounded bg-accent text-white font-semibold hover:bg-accent-dim border-none cursor-pointer">Save LLM Configuration</button>
        </form>
        <div id="llm-result" class="mt-3"></div>
      </div>

      <script>
        function toggleLlmFields() {
          var p = document.getElementById('provider').value;
          var modelGroup = document.getElementById('llm-model-group');
          var apiBaseGroup = document.getElementById('llm-apibase-group');
          var apiKeyGroup = document.getElementById('llm-apikey-group');
          if (p === 'none') {
            modelGroup.style.display = 'none';
            apiBaseGroup.style.display = 'none';
            apiKeyGroup.style.display = 'none';
          } else if (p === 'ollama') {
            modelGroup.style.display = '';
            apiBaseGroup.style.display = '';
            apiKeyGroup.style.display = 'none';
          } else {
            modelGroup.style.display = '';
            apiBaseGroup.style.display = '';
            apiKeyGroup.style.display = '';
          }
        }
        toggleLlmFields();
      </script>
    </div>

    <!-- Capture sources -->
    <div class="mb-8">
      <h2 class="text-lg font-heading font-semibold mb-3">Capture Sources</h2>
      <div class="bg-surface border border-border rounded p-5">
        <ul class="divide-y divide-border">
          <li class="flex justify-between items-center py-3 text-sm">
            <span>Git commits &amp; diffs</span>
            <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-success/15 text-success">Active</span>
          </li>
          <li class="flex justify-between items-center py-3 text-sm">
            <span>AI sessions (Claude, ChatGPT, Copilot)</span>
            <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-success/15 text-success">Active</span>
          </li>
          <li class="flex justify-between items-center py-3 text-sm">
            <span>Terminal activity</span>
            <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-success/15 text-success">Active</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Connect AI Tools -->
    <div class="mb-8">
      <h2 class="text-lg font-heading font-semibold mb-2">Connect AI Tools</h2>
      <p class="text-muted text-sm mb-4">Add Unfade as an MCP server to give your AI tools access to your reasoning history. Copy the config below into your tool's settings file.</p>

      <div class="bg-surface border border-border rounded p-5 mb-3">
        <h3 class="text-base font-heading font-semibold mb-1">Claude Code</h3>
        <p class="text-muted text-xs mb-2">Add to <code class="bg-raised px-1.5 py-0.5 rounded text-sm font-mono">~/.claude/settings.json</code></p>
        <pre class="bg-raised border border-border rounded p-4 overflow-x-auto font-mono text-sm leading-relaxed"><code>${escapeHtml(CLAUDE_CODE_CONFIG)}</code></pre>
      </div>

      <div class="bg-surface border border-border rounded p-5 mb-3">
        <h3 class="text-base font-heading font-semibold mb-1">Cursor</h3>
        <p class="text-muted text-xs mb-2">Add to <code class="bg-raised px-1.5 py-0.5 rounded text-sm font-mono">.cursor/mcp.json</code></p>
        <pre class="bg-raised border border-border rounded p-4 overflow-x-auto font-mono text-sm leading-relaxed"><code>${escapeHtml(CURSOR_CONFIG)}</code></pre>
      </div>

      <div class="bg-surface border border-border rounded p-5 mb-3">
        <h3 class="text-base font-heading font-semibold mb-1">Windsurf</h3>
        <p class="text-muted text-xs mb-2">Add to your Windsurf MCP configuration</p>
        <pre class="bg-raised border border-border rounded p-4 overflow-x-auto font-mono text-sm leading-relaxed"><code>${escapeHtml(WINDSURF_CONFIG)}</code></pre>
      </div>

      <div class="bg-surface border border-border rounded p-5">
        <h3 class="text-base font-heading font-semibold mb-1">Generic MCP Client</h3>
        <p class="text-muted text-xs mb-2">Use this config for any MCP-compatible tool</p>
        <pre class="bg-raised border border-border rounded p-4 overflow-x-auto font-mono text-sm leading-relaxed"><code>${escapeHtml(GENERIC_CONFIG)}</code></pre>
      </div>
    </div>
  `;

  return c.html(layout("Settings", content));
});

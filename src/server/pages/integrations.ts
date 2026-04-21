// FILE: src/server/pages/integrations.ts
// Integrations page — first-class nav item showing MCP tool connections.
// Professional one-click install buttons with tool-specific icons, Cursor deeplink,
// and live status badges. Inspired by Better Auth, PostHog, and similar modern tooling.

import { Hono } from "hono";
import { layout } from "./layout.js";

// Cursor deeplink for one-click MCP install (opens Cursor directly)
const CURSOR_MCP_CONFIG = JSON.stringify({ command: "npx", args: ["unfade", "mcp"] });
const CURSOR_DEEPLINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=Unfade&config=${Buffer.from(CURSOR_MCP_CONFIG).toString("base64")}`;

// SVG icons for each tool (official-style)
const ICON_CLAUDE = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M4.709 15.955l4.486-2.236a.4.4 0 0 0 .2-.347V4.308a.4.4 0 0 0-.59-.352L4.32 6.193a.8.8 0 0 0-.41.699v8.713c0 .36.398.584.71.393l.089-.043zm6.89-3.155l4.486-2.236a.4.4 0 0 0 .2-.347V1.153a.4.4 0 0 0-.59-.352L11.21 3.038a.8.8 0 0 0-.41.699v8.713c0 .36.398.584.71.393l.089-.043zM8.5 19.8l4.486-2.236a.4.4 0 0 0 .2-.347V8.153a.4.4 0 0 0-.59-.352L8.11 10.038a.8.8 0 0 0-.41.699v8.713c0 .36.398.584.71.393l.089-.043z"/></svg>`;
const ICON_CURSOR = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>`;
const ICON_WINDSURF = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2-4 6-8 10-8s8 4 10 8c-2 4-6 8-10 8s-8-4-10-8z"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>`;

export const integrationsPage = new Hono();

integrationsPage.get("/integrations", (c) => {
  const content = `
    <h1 class="text-2xl font-heading font-semibold mb-2">Integrations</h1>
    <p class="text-muted text-sm mb-6">Connect Unfade to your AI tools via MCP. One click configures everything.</p>

    <div class="space-y-4" id="integrations-list">

      <!-- Claude Code -->
      <div class="bg-surface border border-border rounded-lg p-5 flex items-center justify-between hover:border-accent/40 transition-colors">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-lg bg-raised flex items-center justify-center text-foreground">
            ${ICON_CLAUDE}
          </div>
          <div>
            <div class="font-heading font-semibold text-sm">Claude Code</div>
            <div class="text-muted text-xs mt-0.5">CLI &amp; IDE extension by Anthropic</div>
            <div class="text-xs mt-1 font-mono" id="path-claude-code"></div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span id="badge-claude-code" class="hidden inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.78 5.22a.75.75 0 0 0-1.06 0L7 8.94 5.28 7.22a.75.75 0 1 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 0 0 0-1.06z"/></svg>
            Connected
          </span>
          <button onclick="installIntegration('claude-code')" id="btn-claude-code"
            class="px-4 py-2 text-xs rounded-md bg-accent text-white font-semibold cursor-pointer border-none hover:bg-accent-dim transition-colors shadow-sm">
            Add to Claude Code
          </button>
        </div>
      </div>

      <!-- Cursor (with deeplink) -->
      <div class="bg-surface border border-border rounded-lg p-5 flex items-center justify-between hover:border-accent/40 transition-colors">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-lg bg-raised flex items-center justify-center text-foreground">
            ${ICON_CURSOR}
          </div>
          <div>
            <div class="font-heading font-semibold text-sm">Cursor</div>
            <div class="text-muted text-xs mt-0.5">AI-first code editor</div>
            <div class="text-xs mt-1 font-mono" id="path-cursor"></div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span id="badge-cursor" class="hidden inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.78 5.22a.75.75 0 0 0-1.06 0L7 8.94 5.28 7.22a.75.75 0 1 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 0 0 0-1.06z"/></svg>
            Connected
          </span>
          <a href="${CURSOR_DEEPLINK}" id="btn-cursor"
            class="px-4 py-2 text-xs rounded-md bg-accent text-white font-semibold cursor-pointer border-none hover:bg-accent-dim transition-colors shadow-sm no-underline inline-flex items-center gap-1.5">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open in Cursor
          </a>
          <button onclick="installIntegration('cursor')" id="btn-cursor-fallback"
            class="px-3 py-1.5 text-xs rounded-md bg-raised text-foreground font-medium cursor-pointer border border-border hover:bg-canvas transition-colors"
            title="Write config to ~/.cursor/mcp.json manually">
            Add via config
          </button>
        </div>
      </div>

      <!-- Windsurf -->
      <div class="bg-surface border border-border rounded-lg p-5 flex items-center justify-between hover:border-accent/40 transition-colors">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-lg bg-raised flex items-center justify-center text-foreground">
            ${ICON_WINDSURF}
          </div>
          <div>
            <div class="font-heading font-semibold text-sm">Windsurf</div>
            <div class="text-muted text-xs mt-0.5">AI-powered IDE by Codeium</div>
            <div class="text-xs mt-1 font-mono" id="path-windsurf"></div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span id="badge-windsurf" class="hidden inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.78 5.22a.75.75 0 0 0-1.06 0L7 8.94 5.28 7.22a.75.75 0 1 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 0 0 0-1.06z"/></svg>
            Connected
          </span>
          <button onclick="installIntegration('windsurf')" id="btn-windsurf"
            class="px-4 py-2 text-xs rounded-md bg-accent text-white font-semibold cursor-pointer border-none hover:bg-accent-dim transition-colors shadow-sm">
            Add to Windsurf
          </button>
        </div>
      </div>

    </div>

    <!-- Manual / Other Tools -->
    <div class="mt-8 bg-surface border border-border rounded-lg p-5">
      <h2 class="font-heading font-semibold text-sm mb-1">Other MCP Clients</h2>
      <p class="text-muted text-xs mb-3">For any MCP-compatible tool not listed above, add this to your MCP configuration:</p>
      <div class="relative">
        <pre class="bg-raised border border-border rounded-lg p-4 overflow-x-auto font-mono text-xs leading-relaxed select-all"><code>{
  "mcpServers": {
    "unfade": {
      "command": "npx",
      "args": ["unfade", "mcp"]
    }
  }
}</code></pre>
        <button onclick="copyConfig()" id="btn-copy"
          class="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-canvas text-muted border border-border cursor-pointer hover:text-foreground transition-colors">
          Copy
        </button>
      </div>
    </div>

    <script>
      function installIntegration(tool) {
        var btn = document.getElementById('btn-' + tool) || document.getElementById('btn-' + tool + '-fallback');
        btn.disabled = true;
        btn.textContent = 'Installing\u2026';
        fetch('/api/integrations/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: tool })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d.success) {
            btn.textContent = '\u2713 Installed';
            btn.className = 'px-4 py-2 text-xs rounded-md bg-success/10 text-success font-semibold border-none';
            var badge = document.getElementById('badge-' + tool);
            if (badge) badge.classList.remove('hidden');
            var pathEl = document.getElementById('path-' + tool);
            if (pathEl) { pathEl.textContent = d.path; pathEl.classList.add('text-muted'); }
          } else {
            btn.textContent = 'Failed';
            btn.className = 'px-4 py-2 text-xs rounded-md bg-error/10 text-error font-semibold border-none';
            var pathEl = document.getElementById('path-' + tool);
            if (pathEl) { pathEl.textContent = d.error || 'Write failed'; pathEl.classList.add('text-error'); }
          }
        }).catch(function() {
          btn.textContent = 'Error';
          btn.className = 'px-4 py-2 text-xs rounded-md bg-error/10 text-error font-semibold border-none';
        });
      }

      function copyConfig() {
        var text = JSON.stringify({ mcpServers: { unfade: { command: "npx", args: ["unfade", "mcp"] } } }, null, 2);
        navigator.clipboard.writeText(text).then(function() {
          var btn = document.getElementById('btn-copy');
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
        });
      }

      // Load current status
      fetch('/api/integrations/status').then(function(r){return r.json();}).then(function(d){
        if(!d||!d.tools)return;
        d.tools.forEach(function(t){
          var pathEl = document.getElementById('path-' + t.tool);
          if(pathEl && t.path) { pathEl.textContent = t.path; pathEl.classList.add('text-muted'); }
          if(t.connected){
            var btn = document.getElementById('btn-' + t.tool);
            if(btn){ btn.textContent = '\u2713 Connected'; btn.className = 'px-4 py-2 text-xs rounded-md bg-success/10 text-success font-semibold border-none no-underline'; }
            // Hide the fallback button for cursor if already connected
            var fallback = document.getElementById('btn-' + t.tool + '-fallback');
            if(fallback) fallback.classList.add('hidden');
            var badge = document.getElementById('badge-' + t.tool);
            if(badge) badge.classList.remove('hidden');
          }
        });
      }).catch(function(){});
    </script>
  `;

  return c.html(layout("Integrations", content));
});

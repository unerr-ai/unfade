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
      provider: distill.provider ?? "none",
      model: distill.model ?? "llama3.2",
      apiKey: distill.apiKey ?? "",
      apiBase: distill.apiBase ?? "",
    };
  } catch {
    return { provider: "none", model: "llama3.2", apiKey: "", apiBase: "" };
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

    <!-- Proactive Actions (Phase 12) -->
    <div class="mb-8">
      <h2 class="text-lg font-heading font-semibold mb-2">Proactive Actions</h2>
      <p class="text-muted text-sm mb-4">When enabled, Unfade can automatically write learned rules to your AI tool config files, inject session context, and generate weekly digest cards.</p>
      <div class="bg-surface border border-border rounded p-5 space-y-4" id="actions-panel">
        <div class="text-center py-4 text-muted text-sm" id="actions-loading">Loading…</div>
      </div>
    </div>

    <script>
    (function(){
      fetch('/unfade/settings/status').then(function(r){return r.json();}).then(function(cfg){
        var actions=cfg.actions||{enabled:false,autoRules:false,ruleTarget:null,sessionContext:false,weeklyDigest:false,digestDay:'monday'};
        var el=document.getElementById('actions-panel');
        el.innerHTML=
          '<div class="flex items-center justify-between py-2">'+
            '<div><p class="text-sm font-semibold text-foreground">Master toggle</p><p class="text-xs text-muted">Enable all proactive actions</p></div>'+
            '<label class="relative inline-flex cursor-pointer"><input type="checkbox" id="act-enabled" '+(actions.enabled?'checked ':'')+' onchange="saveActions()" class="sr-only peer"/><div class="w-9 h-5 bg-raised peer-checked:bg-accent rounded-full transition-colors"></div></label>'+
          '</div>'+
          '<div class="border-t border-border pt-3 space-y-3" id="act-sub" style="'+(actions.enabled?'':'opacity:0.5;pointer-events:none')+'">'+
            '<div class="flex items-center justify-between">'+
              '<div><p class="text-sm text-foreground">Auto-write rules</p><p class="text-xs text-muted">Write learned patterns to your AI tool config</p></div>'+
              '<input type="checkbox" id="act-rules" '+(actions.autoRules?'checked ':'')+' onchange="saveActions()" class="accent-accent w-4 h-4"/>'+
            '</div>'+
            '<div class="pl-2">'+
              '<label class="text-xs text-muted block mb-1">Rule target</label>'+
              '<select id="act-target" onchange="saveActions()" class="w-full px-2 py-1.5 text-xs bg-raised text-foreground border border-border rounded font-body">'+
                '<option value=""'+((!actions.ruleTarget)?' selected':'')+'>Auto-detect</option>'+
                '<option value=".cursor/rules/unfade.mdc"'+((actions.ruleTarget==='.cursor/rules/unfade.mdc')?' selected':'')+'>Cursor (.cursor/rules/unfade.mdc)</option>'+
                '<option value="CLAUDE.md"'+((actions.ruleTarget==='CLAUDE.md')?' selected':'')+'>Claude Code (CLAUDE.md)</option>'+
                '<option value=".github/copilot-instructions.md"'+((actions.ruleTarget==='.github/copilot-instructions.md')?' selected':'')+'>Copilot (.github/copilot-instructions.md)</option>'+
              '</select>'+
            '</div>'+
            '<div class="flex items-center justify-between">'+
              '<div><p class="text-sm text-foreground">Session context</p><p class="text-xs text-muted">Update CLAUDE.md with recent context on session end</p></div>'+
              '<input type="checkbox" id="act-context" '+(actions.sessionContext?'checked ':'')+' onchange="saveActions()" class="accent-accent w-4 h-4"/>'+
            '</div>'+
            '<div class="flex items-center justify-between">'+
              '<div><p class="text-sm text-foreground">Weekly digest card</p><p class="text-xs text-muted">Auto-generate a shareable reasoning card each week</p></div>'+
              '<input type="checkbox" id="act-weekly" '+(actions.weeklyDigest?'checked ':'')+' onchange="saveActions()" class="accent-accent w-4 h-4"/>'+
            '</div>'+
            '<div class="pl-2">'+
              '<label class="text-xs text-muted block mb-1">Digest day</label>'+
              '<select id="act-day" onchange="saveActions()" class="px-2 py-1.5 text-xs bg-raised text-foreground border border-border rounded font-body">'+
                ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(function(d){return'<option value="'+d+'"'+((actions.digestDay===d)?' selected':'')+'>'+d.charAt(0).toUpperCase()+d.slice(1)+'</option>';}).join('')+
              '</select>'+
            '</div>'+
          '</div>'+
          '<div id="act-save-result" class="text-xs mt-2"></div>';

        document.getElementById('act-enabled').addEventListener('change',function(){
          var sub=document.getElementById('act-sub');
          sub.style.opacity=this.checked?'1':'0.5';
          sub.style.pointerEvents=this.checked?'auto':'none';
        });
      }).catch(function(){
        document.getElementById('actions-loading').textContent='Could not load settings';
      });
    })();

    function saveActions(){
      var body={
        enabled:document.getElementById('act-enabled').checked,
        autoRules:document.getElementById('act-rules').checked,
        ruleTarget:document.getElementById('act-target').value||null,
        sessionContext:document.getElementById('act-context').checked,
        weeklyDigest:document.getElementById('act-weekly').checked,
        digestDay:document.getElementById('act-day').value
      };
      fetch('/unfade/settings/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(res){
        var el=document.getElementById('act-save-result');
        el.textContent=res.saved?'Saved':'Error: '+(res.error||'unknown');
        el.className='text-xs mt-2 '+(res.saved?'text-success':'text-error');
        setTimeout(function(){el.textContent='';},3000);
      }).catch(function(){});
    }
    </script>

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
      <div class="bg-surface border border-border rounded p-5 flex items-center justify-between">
        <div>
          <p class="text-foreground text-sm font-medium">MCP Integrations</p>
          <p class="text-muted text-xs mt-1">One-click install for Claude Code, Cursor, and Windsurf.</p>
        </div>
        <a href="/integrations" class="px-4 py-2 text-xs rounded bg-accent text-white font-medium no-underline hover:bg-accent-dim">Manage Integrations</a>
      </div>
    </div>
  `;

  return c.html(layout("Settings", content));
});

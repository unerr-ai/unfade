// FILE: src/server/pages/setup.ts
// Phase 10: Multi-step setup wizard — enterprise-grade onboarding experience.
// Steps: 1) Configure Intelligence → 2) Connect AI Tools → 3) Start Exploring
// Each step is a full-screen view with progress indicator, smooth transitions.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { getProjectDataDir } from "../../utils/paths.js";
import { escapeHtml, layout } from "./layout.js";

export const setupPage = new Hono();

async function readCurrentLlmConfig(): Promise<{
  provider: string;
  model: string;
  apiKey: string;
  apiBase: string;
}> {
  try {
    const configPath = join(getProjectDataDir(), "config.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    const distill = raw?.distill ?? {};
    return {
      provider: distill.provider ?? "none",
      model: distill.model ?? "",
      apiKey: distill.apiKey ?? "",
      apiBase: distill.apiBase ?? "",
    };
  } catch {
    return { provider: "none", model: "", apiKey: "", apiBase: "" };
  }
}

const CURSOR_DEEPLINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=Unfade&config=${Buffer.from(JSON.stringify({ command: "npx", args: ["unfade", "mcp"] })).toString("base64")}`;

setupPage.get("/setup", async (c) => {
  const llm = await readCurrentLlmConfig();
  const sel = (val: string) => (llm.provider === val ? "selected" : "");
  const hasExistingConfig = llm.provider !== "none";

  const content = `
    <div class="w-full max-w-xl mx-auto">

      <!-- Progress Indicator -->
      <div class="flex items-center justify-center gap-0 mb-12 mt-4">
        <div class="flex items-center">
          <div id="prog-1" class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 bg-accent text-white">1</div>
          <div class="hidden sm:block ml-2 mr-4">
            <span id="prog-1-label" class="text-xs font-medium text-foreground transition-colors">Intelligence</span>
          </div>
        </div>
        <div id="prog-line-1" class="w-12 h-[2px] bg-border transition-all duration-500"></div>
        <div class="flex items-center">
          <div id="prog-2" class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ml-4 bg-raised text-muted border border-border">2</div>
          <div class="hidden sm:block ml-2 mr-4">
            <span id="prog-2-label" class="text-xs font-medium text-muted transition-colors">Integrations</span>
          </div>
        </div>
        <div id="prog-line-2" class="w-12 h-[2px] bg-border transition-all duration-500"></div>
        <div class="flex items-center">
          <div id="prog-3" class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ml-4 bg-raised text-muted border border-border">3</div>
          <div class="hidden sm:block ml-2">
            <span id="prog-3-label" class="text-xs font-medium text-muted transition-colors">Launch</span>
          </div>
        </div>
      </div>

      <!-- Step 1: Configure Intelligence -->
      <div id="step-1" class="wizard-step">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 mb-4">
            <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" class="text-accent"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"/></svg>
          </div>
          <h1 class="text-2xl font-heading font-semibold mb-2">Configure Intelligence</h1>
          <p class="text-muted text-sm max-w-md mx-auto">Connect an LLM to power daily distills, reasoning extraction, and pattern detection across your workflow.</p>
        </div>

        <div class="bg-surface border border-border rounded-xl p-6">
          <div class="mb-4">
            <label for="provider" class="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Provider</label>
            <select id="provider" name="provider" onchange="toggleLlmFields()"
              class="w-full px-4 py-2.5 text-sm bg-raised text-foreground border border-border rounded-lg outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 font-body transition-colors">
              <option value="none" ${sel("none")}>Select a provider...</option>
              <option value="ollama" ${sel("ollama")}>Ollama (local)</option>
              <option value="openai" ${sel("openai")}>OpenAI</option>
              <option value="anthropic" ${sel("anthropic")}>Anthropic</option>
              <option value="custom" ${sel("custom")}>Custom (OpenAI-compatible)</option>
            </select>
          </div>

          <div id="llm-model-group" class="mb-4 hidden">
            <label for="model" class="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Model</label>
            <input type="text" id="model" name="model" value="${escapeHtml(llm.model)}"
              placeholder="e.g. llama3.2, gpt-4o, claude-sonnet-4-20250514"
              class="w-full px-4 py-2.5 text-sm bg-raised text-foreground border border-border rounded-lg outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 font-body transition-colors" />
          </div>

          <div id="llm-apibase-group" class="mb-4 hidden">
            <label for="apiBase" class="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">API Base URL</label>
            <input type="text" id="apiBase" name="apiBase" value="${escapeHtml(llm.apiBase)}"
              placeholder="https://api.example.com/v1"
              class="w-full px-4 py-2.5 text-sm bg-raised text-foreground border border-border rounded-lg outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 font-body transition-colors" />
          </div>

          <div id="llm-apikey-group" class="mb-4 hidden">
            <label for="apiKey" class="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">API Key</label>
            <input type="password" id="apiKey" name="apiKey" value="${escapeHtml(llm.apiKey)}"
              placeholder="sk-..." autocomplete="off"
              class="w-full px-4 py-2.5 text-sm bg-raised text-foreground border border-border rounded-lg outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 font-body transition-colors" />
          </div>

          <!-- Verification result -->
          <div id="llm-result" class="hidden mb-4 rounded-lg p-3 text-sm"></div>

          <!-- Save & Verify button -->
          <button onclick="saveLlmConfig()" id="btn-save-llm"
            class="w-full px-4 py-3 text-sm rounded-lg bg-accent text-white font-semibold cursor-pointer border-none hover:bg-accent-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            ${hasExistingConfig ? "" : "disabled"}>
            Save &amp; Verify Configuration
          </button>
        </div>

        <!-- Step navigation -->
        <div class="flex items-center justify-between mt-6">
          <div></div>
          <button onclick="goToStep(2)" id="btn-next-1"
            class="flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg font-semibold transition-all border-none cursor-pointer ${hasExistingConfig ? "bg-accent text-white hover:bg-accent-dim shadow-sm" : "bg-raised text-muted border border-border cursor-not-allowed opacity-50"}"
            ${hasExistingConfig ? "" : "disabled"}>
            Continue
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
          </button>
        </div>
      </div>

      <!-- Step 2: Connect AI Tools -->
      <div id="step-2" class="wizard-step hidden">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 mb-4">
            <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" class="text-accent"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>
          </div>
          <h1 class="text-2xl font-heading font-semibold mb-2">Connect Your AI Tools</h1>
          <p class="text-muted text-sm max-w-md mx-auto">Give your AI coding tools access to your reasoning history via MCP. This step is optional.</p>
        </div>

        <div class="space-y-3">
          <!-- Claude Code -->
          <div class="bg-surface border border-border rounded-xl p-4 flex items-center justify-between hover:border-accent/40 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-raised flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class="text-foreground"><path d="M4.709 15.955l4.486-2.236a.4.4 0 0 0 .2-.347V4.308a.4.4 0 0 0-.59-.352L4.32 6.193a.8.8 0 0 0-.41.699v8.713c0 .36.398.584.71.393l.089-.043zm6.89-3.155l4.486-2.236a.4.4 0 0 0 .2-.347V1.153a.4.4 0 0 0-.59-.352L11.21 3.038a.8.8 0 0 0-.41.699v8.713c0 .36.398.584.71.393l.089-.043zM8.5 19.8l4.486-2.236a.4.4 0 0 0 .2-.347V8.153a.4.4 0 0 0-.59-.352L8.11 10.038a.8.8 0 0 0-.41.699v8.713c0 .36.398.584.71.393l.089-.043z"/></svg>
              </div>
              <div>
                <div class="text-sm font-semibold">Claude Code</div>
                <div class="text-xs text-muted">CLI &amp; IDE extension</div>
              </div>
              <span class="text-xs text-muted" id="status-claude-code"></span>
            </div>
            <button onclick="installMcp('claude-code')" id="btn-claude-code"
              class="px-4 py-2 text-xs rounded-lg bg-accent text-white font-semibold cursor-pointer border-none hover:bg-accent-dim transition-colors shadow-sm">
              Connect
            </button>
          </div>

          <!-- Cursor -->
          <div class="bg-surface border border-border rounded-xl p-4 flex items-center justify-between hover:border-accent/40 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-raised flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-foreground"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>
              </div>
              <div>
                <div class="text-sm font-semibold">Cursor</div>
                <div class="text-xs text-muted">AI-first code editor</div>
              </div>
              <span class="text-xs text-muted" id="status-cursor"></span>
            </div>
            <a href="${CURSOR_DEEPLINK}" id="btn-cursor"
              class="px-4 py-2 text-xs rounded-lg bg-accent text-white font-semibold cursor-pointer border-none hover:bg-accent-dim transition-colors shadow-sm no-underline inline-flex items-center gap-1.5">
              <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open in Cursor
            </a>
          </div>

          <!-- Windsurf -->
          <div class="bg-surface border border-border rounded-xl p-4 flex items-center justify-between hover:border-accent/40 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-raised flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-foreground"><path d="M2 12c2-4 6-8 10-8s8 4 10 8c-2 4-6 8-10 8s-8-4-10-8z"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
              </div>
              <div>
                <div class="text-sm font-semibold">Windsurf</div>
                <div class="text-xs text-muted">AI-powered IDE</div>
              </div>
              <span class="text-xs text-muted" id="status-windsurf"></span>
            </div>
            <button onclick="installMcp('windsurf')" id="btn-windsurf"
              class="px-4 py-2 text-xs rounded-lg bg-accent text-white font-semibold cursor-pointer border-none hover:bg-accent-dim transition-colors shadow-sm">
              Connect
            </button>
          </div>
        </div>

        <p class="text-xs text-muted text-center mt-4">You can always configure integrations later from Settings.</p>

        <!-- Step navigation -->
        <div class="flex items-center justify-between mt-8">
          <button onclick="goToStep(1)"
            class="flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg font-medium bg-raised text-muted border border-border cursor-pointer hover:text-foreground hover:bg-surface transition-all">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12"/></svg>
            Back
          </button>
          <button onclick="goToStep(3)"
            class="flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg bg-accent text-white font-semibold border-none cursor-pointer hover:bg-accent-dim transition-all shadow-sm">
            Continue
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
          </button>
        </div>
      </div>

      <!-- Step 3: Launch -->
      <div id="step-3" class="wizard-step hidden">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-success/10 mb-4">
            <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" class="text-success"><path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/></svg>
          </div>
          <h1 class="text-2xl font-heading font-semibold mb-2">You're All Set</h1>
          <p class="text-muted text-sm max-w-md mx-auto">Your reasoning capture is active and intelligence is configured. Start working — insights will appear as data accumulates.</p>
        </div>

        <!-- Summary -->
        <div class="bg-surface border border-border rounded-xl p-6 mb-6">
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" class="text-success"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              </div>
              <div>
                <div class="text-sm font-medium">Capture engine active</div>
                <div class="text-xs text-muted">Git, AI sessions, and terminal activity</div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" class="text-success"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              </div>
              <div>
                <div class="text-sm font-medium" id="summary-llm">Intelligence configured</div>
                <div class="text-xs text-muted" id="summary-llm-detail">LLM provider connected</div>
              </div>
            </div>
            <div class="flex items-center gap-3" id="summary-tools-row">
              <div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0" id="summary-tools-icon">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" class="text-success"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              </div>
              <div>
                <div class="text-sm font-medium" id="summary-tools">AI tools connected</div>
                <div class="text-xs text-muted" id="summary-tools-detail"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Step navigation -->
        <div class="flex items-center justify-between">
          <button onclick="goToStep(2)"
            class="flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg font-medium bg-raised text-muted border border-border cursor-pointer hover:text-foreground hover:bg-surface transition-all">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12"/></svg>
            Back
          </button>
          <button onclick="completeSetup()" id="btn-complete"
            class="flex items-center gap-2 px-8 py-3 text-sm rounded-lg bg-success text-white font-semibold border-none cursor-pointer hover:brightness-110 transition-all shadow-lg shadow-success/20">
            Start Exploring
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
          </button>
        </div>
      </div>

    </div>

    <style>
      .wizard-step { animation: fadeIn 0.25s ease-out; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    </style>

    <script>
    (function(){
      var currentStep = 1;
      var llmVerified = ${hasExistingConfig ? "true" : "false"};
      var connectedTools = [];

      function toggleLlmFields() {
        var p = document.getElementById('provider').value;
        var m = document.getElementById('llm-model-group');
        var b = document.getElementById('llm-apibase-group');
        var k = document.getElementById('llm-apikey-group');
        var btn = document.getElementById('btn-save-llm');
        if (p === 'none') {
          m.classList.add('hidden'); b.classList.add('hidden'); k.classList.add('hidden');
          btn.disabled = true;
        } else if (p === 'ollama') {
          m.classList.remove('hidden'); b.classList.remove('hidden'); k.classList.add('hidden');
          btn.disabled = false;
        } else {
          m.classList.remove('hidden'); b.classList.remove('hidden'); k.classList.remove('hidden');
          btn.disabled = false;
        }
      }
      window.toggleLlmFields = toggleLlmFields;
      toggleLlmFields();

      function saveLlmConfig() {
        var btn = document.getElementById('btn-save-llm');
        var result = document.getElementById('llm-result');
        var provider = document.getElementById('provider').value;
        var model = document.getElementById('model').value;
        var apiKey = document.getElementById('apiKey') ? document.getElementById('apiKey').value : '';
        var apiBase = document.getElementById('apiBase') ? document.getElementById('apiBase').value : '';

        btn.disabled = true;
        btn.textContent = 'Verifying configuration\u2026';
        result.classList.add('hidden');

        var formData = new URLSearchParams();
        formData.append('provider', provider);
        formData.append('model', model);
        formData.append('apiKey', apiKey);
        formData.append('apiBase', apiBase);

        fetch('/unfade/settings/llm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        }).then(function(r) { return r.text(); }).then(function(html) {
          result.innerHTML = html;
          result.classList.remove('hidden');
          btn.textContent = 'Save & Verify Configuration';
          btn.disabled = false;

          // Check if verification succeeded
          if (html.indexOf('alert-ok') !== -1 || html.indexOf('text-success') !== -1) {
            llmVerified = true;
            enableNextButton();
          }
        }).catch(function() {
          result.innerHTML = '<div class="bg-error/10 border border-error/30 text-error rounded-lg p-3 text-sm">Network error \u2014 please try again.</div>';
          result.classList.remove('hidden');
          btn.textContent = 'Save & Verify Configuration';
          btn.disabled = false;
        });
      }
      window.saveLlmConfig = saveLlmConfig;

      function enableNextButton() {
        var btn = document.getElementById('btn-next-1');
        btn.disabled = false;
        btn.classList.remove('bg-raised', 'text-muted', 'border', 'border-border', 'cursor-not-allowed', 'opacity-50');
        btn.classList.add('bg-accent', 'text-white', 'hover:bg-accent-dim', 'shadow-sm');
      }

      function updateProgress(step) {
        for (var i = 1; i <= 3; i++) {
          var circle = document.getElementById('prog-' + i);
          var label = document.getElementById('prog-' + i + '-label');
          circle.className = 'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300';
          if (i < step) {
            circle.className += ' bg-success text-white';
            circle.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
            if (label) label.className = 'text-xs font-medium text-success transition-colors';
          } else if (i === step) {
            circle.className += ' bg-accent text-white';
            circle.textContent = i;
            if (label) label.className = 'text-xs font-medium text-foreground transition-colors';
          } else {
            circle.className += ' bg-raised text-muted border border-border ml-4';
            circle.textContent = i;
            if (label) label.className = 'text-xs font-medium text-muted transition-colors';
          }
        }
        // Progress lines
        var line1 = document.getElementById('prog-line-1');
        var line2 = document.getElementById('prog-line-2');
        line1.className = 'w-12 h-[2px] transition-all duration-500 ' + (step > 1 ? 'bg-success' : 'bg-border');
        line2.className = 'w-12 h-[2px] transition-all duration-500 ' + (step > 2 ? 'bg-success' : 'bg-border');
      }

      function goToStep(step) {
        // Guard: can't go to step 2 without verified LLM
        if (step > 1 && !llmVerified) return;

        document.getElementById('step-' + currentStep).classList.add('hidden');
        document.getElementById('step-' + step).classList.remove('hidden');
        currentStep = step;
        updateProgress(step);

        // Update summary on step 3
        if (step === 3) updateSummary();
      }
      window.goToStep = goToStep;

      function updateSummary() {
        var provider = document.getElementById('provider').value;
        var model = document.getElementById('model').value;
        var llmDetail = document.getElementById('summary-llm-detail');
        llmDetail.textContent = provider + (model ? ' / ' + model : '');

        var toolsRow = document.getElementById('summary-tools-row');
        var toolsEl = document.getElementById('summary-tools');
        var toolsDetail = document.getElementById('summary-tools-detail');
        var toolsIcon = document.getElementById('summary-tools-icon');
        if (connectedTools.length > 0) {
          toolsEl.textContent = connectedTools.length + ' tool' + (connectedTools.length > 1 ? 's' : '') + ' connected';
          toolsDetail.textContent = connectedTools.join(', ');
          toolsIcon.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" class="text-success"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
        } else {
          toolsEl.textContent = 'No AI tools connected';
          toolsDetail.textContent = 'You can add integrations later from Settings';
          toolsIcon.className = 'w-8 h-8 rounded-full bg-raised flex items-center justify-center flex-shrink-0';
          toolsIcon.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" class="text-muted"><path stroke-linecap="round" stroke-linejoin="round" d="M18 12H6"/></svg>';
        }
      }

      function installMcp(tool) {
        var btn = document.getElementById('btn-' + tool);
        var status = document.getElementById('status-' + tool);
        btn.disabled = true;
        btn.textContent = 'Connecting\u2026';
        fetch('/api/integrations/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: tool })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d.success) {
            btn.textContent = '\u2713 Connected';
            btn.classList.remove('bg-accent', 'hover:bg-accent-dim');
            btn.classList.add('bg-success/20', 'text-success');
            status.textContent = 'Restart to activate';
            if (connectedTools.indexOf(tool) === -1) connectedTools.push(tool);
          } else {
            btn.textContent = 'Failed';
            btn.disabled = false;
            btn.classList.remove('bg-accent');
            btn.classList.add('bg-error/10', 'text-error');
            status.textContent = d.error || 'Write failed';
          }
        }).catch(function() {
          btn.textContent = 'Error';
          btn.disabled = false;
          status.textContent = 'Network error';
        });
      }
      window.installMcp = installMcp;

      function completeSetup() {
        var btn = document.getElementById('btn-complete');
        btn.disabled = true;
        btn.innerHTML = 'Launching\u2026';
        fetch('/api/setup/complete', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.success) {
              window.location.href = '/';
            } else {
              btn.disabled = false;
              btn.innerHTML = 'Start Exploring <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>';
              alert('Setup failed: ' + (d.error || 'Unknown error'));
            }
          })
          .catch(function() {
            btn.disabled = false;
            btn.innerHTML = 'Start Exploring <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>';
            alert('Network error \u2014 please try again.');
          });
      }
      window.completeSetup = completeSetup;

      // Check existing integration status on load
      fetch('/api/integrations/status').then(function(r){return r.json();}).then(function(d){
        if(!d||!d.tools)return;
        d.tools.forEach(function(t){
          if(t.connected){
            var btn=document.getElementById('btn-'+t.tool);
            if(btn){
              btn.textContent='\u2713 Connected';
              btn.classList.remove('bg-accent','hover:bg-accent-dim');
              btn.classList.add('bg-success/20','text-success');
              btn.disabled=true;
            }
            if(connectedTools.indexOf(t.tool)===-1) connectedTools.push(t.tool);
          }
        });
      }).catch(function(){});
    })();
    </script>
  `;

  return c.html(layout("Setup", content, { minimal: true }));
});

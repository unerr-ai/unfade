// FILE: src/server/pages/repo-detail.ts
// UF-232: Per-repo dashboard — same panels as single-repo but for a specific registered repo.
// Back button → portfolio. Uses /api/repos/:id for summary, /api/repos/:id/events for feed.

import { Hono } from "hono";
import { escapeHtml, layout } from "./layout.js";

export const repoDetailPage = new Hono();

repoDetailPage.get("/repos/:id", (c) => {
  const repoId = c.req.param("id");

  const content = `
    <div class="flex items-center gap-3 mb-6">
      <a href="/portfolio" class="text-accent hover:text-accent-dim text-sm no-underline">&larr; Portfolio</a>
      <h1 class="text-2xl font-heading font-semibold" id="repo-title">Loading…</h1>
    </div>

    <div id="repo-loading" class="text-center py-12 text-muted">
      <p>Loading repo data…</p>
    </div>

    <div id="repo-not-found" class="hidden text-center py-12 text-muted">
      <p class="text-lg mb-2">Repo not found</p>
      <p class="text-sm">This repo may have been unregistered.</p>
    </div>

    <div id="repo-live" class="hidden">

      <!-- Direction density hero -->
      <div class="bg-surface border border-border rounded-lg p-6 mb-6 text-center">
        <div class="font-mono text-5xl font-bold text-cyan" id="rd-direction">—</div>
        <div class="text-sm text-muted mt-2">Human-Directed (24h)</div>
        <div class="text-xs text-muted mt-1" id="rd-label"></div>
      </div>

      <!-- Stat grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-surface border border-border rounded p-4 text-center">
          <div class="font-mono text-3xl font-bold text-foreground" id="rd-events">0</div>
          <div class="text-xs text-muted mt-1">Events (24h)</div>
        </div>
        <div class="bg-surface border border-border rounded p-4 text-center">
          <div class="font-mono text-3xl font-bold text-accent" id="rd-comprehension">—</div>
          <div class="text-xs text-muted mt-1">Comprehension</div>
        </div>
        <div class="bg-surface border border-border rounded p-4 text-center">
          <div class="font-mono text-3xl font-bold text-accent" id="rd-domain">—</div>
          <div class="text-xs text-muted mt-1">Top Domain</div>
        </div>
        <div class="bg-surface border border-border rounded p-4 text-center">
          <div class="font-mono text-3xl font-bold text-accent" id="rd-velocity">—</div>
          <div class="text-xs text-muted mt-1">Velocity</div>
        </div>
      </div>

      <!-- Tool mix -->
      <div class="bg-surface border border-border rounded p-5 mb-6">
        <h2 class="text-lg font-heading font-semibold mb-3">Tool Mix</h2>
        <div id="rd-tools" class="flex gap-3 flex-wrap text-muted text-sm">Loading…</div>
      </div>

      <!-- Recent events -->
      <div class="bg-surface border border-border rounded p-5">
        <h2 class="text-lg font-heading font-semibold mb-3">Recent Events</h2>
        <div id="rd-events-list" class="text-sm text-muted">Loading…</div>
      </div>

    </div>

    <script>
    (function() {
      var repoId = '${escapeHtml(repoId)}';
      var loadingEl = document.getElementById('repo-loading');
      var notFound = document.getElementById('repo-not-found');
      var liveEl = document.getElementById('repo-live');
      var titleEl = document.getElementById('repo-title');

      function dirLabel(pct) {
        if (pct >= 70) return 'You steer confidently';
        if (pct >= 50) return 'Balanced collaboration';
        if (pct >= 30) return 'Model-assisted';
        if (pct > 0) return 'Model-led';
        return '';
      }

      fetch('/api/repos/' + repoId).then(function(r) {
        if (r.status === 404) { throw new Error('not found'); }
        return r.json();
      }).then(function(repo) {
        loadingEl.classList.add('hidden');
        liveEl.classList.remove('hidden');
        titleEl.textContent = repo.label;

        var s = repo.summary;
        if (!s) {
          document.getElementById('rd-direction').textContent = '—';
          document.getElementById('rd-label').textContent = 'No data yet — daemon may still be starting';
          return;
        }

        document.getElementById('rd-direction').textContent = s.directionDensity24h + '%';
        document.getElementById('rd-label').textContent = dirLabel(s.directionDensity24h);
        document.getElementById('rd-events').textContent = s.eventCount24h || '0';
        document.getElementById('rd-comprehension').textContent = s.comprehensionScore != null ? s.comprehensionScore : '—';
        document.getElementById('rd-domain').textContent = s.topDomain || '—';
        document.getElementById('rd-velocity').textContent = s.reasoningVelocityProxy != null ? (s.reasoningVelocityProxy > 0 ? '+' : '') + s.reasoningVelocityProxy + '%' : '—';

        var toolsEl = document.getElementById('rd-tools');
        if (s.toolMix && Object.keys(s.toolMix).length > 0) {
          toolsEl.innerHTML = Object.entries(s.toolMix).map(function(e) {
            return '<span class="bg-raised border border-border rounded px-3 py-1 font-mono">' + e[0] + ' <span class="text-cyan">' + e[1] + '</span></span>';
          }).join('');
        } else {
          toolsEl.textContent = 'No AI tool events yet';
        }
      }).catch(function() {
        loadingEl.classList.add('hidden');
        notFound.classList.remove('hidden');
      });

      fetch('/api/repos/' + repoId + '/events?limit=20').then(function(r) { return r.json(); }).then(function(data) {
        var el = document.getElementById('rd-events-list');
        if (!data.events || data.events.length === 0) {
          el.textContent = 'No events captured yet';
          return;
        }
        el.innerHTML = '<ul class="divide-y divide-border">' +
          data.events.slice().reverse().map(function(e) {
            var ts = new Date(e.timestamp).toLocaleTimeString();
            var badge = e.source === 'ai-session' ? '<span class="text-accent">AI</span>' :
                        e.source === 'git' ? '<span class="text-success">Git</span>' :
                        '<span class="text-muted">' + e.source + '</span>';
            return '<li class="flex justify-between items-center py-2">' +
              '<span>' + badge + ' <span class="text-foreground ml-2">' + (e.summary.length > 80 ? e.summary.slice(0, 80) + '…' : e.summary) + '</span></span>' +
              '<span class="font-mono text-xs text-muted">' + ts + '</span>' +
            '</li>';
          }).join('') +
        '</ul>';
      }).catch(function() {});
    })();
    </script>
  `;

  return c.html(layout("Repo Detail", content));
});

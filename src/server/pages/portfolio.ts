// FILE: src/server/pages/portfolio.ts
// UF-231: Portfolio dashboard — lists all registered repos in a grid.
// Each card: repo label, direction density gauge, event count, comprehension score.
// Click → navigate to /repos/:id for drill-down.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const portfolioPage = new Hono();

portfolioPage.get("/portfolio", (c) => {
  const content = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-heading font-semibold">Portfolio</h1>
      <a href="/" class="text-accent hover:text-accent-dim text-sm no-underline">&larr; Single-repo view</a>
    </div>

    <div id="portfolio-loading" class="text-center py-12 text-muted">
      <p class="text-lg">Loading repos…</p>
    </div>

    <div id="portfolio-empty" class="hidden text-center py-12 text-muted">
      <p class="text-lg mb-2">No repos registered</p>
      <p class="text-sm">Run <code class="bg-raised px-1.5 py-0.5 rounded text-sm font-mono">unfade</code> in a project to register it.</p>
    </div>

    <div id="portfolio-grid" class="hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>

    <script>
    (function() {
      var loading = document.getElementById('portfolio-loading');
      var empty = document.getElementById('portfolio-empty');
      var grid = document.getElementById('portfolio-grid');

      function directionColor(pct) {
        if (pct >= 60) return 'text-success';
        if (pct >= 40) return 'text-cyan';
        if (pct > 0) return 'text-warning';
        return 'text-muted';
      }

      function timeAgo(isoStr) {
        if (!isoStr) return 'never';
        var ms = Date.now() - new Date(isoStr).getTime();
        var s = Math.floor(ms / 1000);
        if (s < 60) return s + 's ago';
        var m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        var h = Math.floor(m / 60);
        if (h < 24) return h + 'h ago';
        return Math.floor(h / 24) + 'd ago';
      }

      fetch('/api/repos').then(function(r) { return r.json(); }).then(function(repos) {
        loading.classList.add('hidden');

        if (!repos || repos.length === 0) {
          empty.classList.remove('hidden');
          return;
        }

        grid.classList.remove('hidden');
        grid.innerHTML = repos.map(function(repo) {
          var s = repo.summary;
          var dd = s ? s.directionDensity24h : 0;
          var ec = s ? s.eventCount24h : 0;
          var cs = s && s.comprehensionScore != null ? s.comprehensionScore : null;
          var td = s ? s.topDomain : null;
          var updated = s ? s.updatedAt : repo.lastSeenAt;

          return '<a href="/repos/' + repo.id + '" class="block no-underline">' +
            '<div class="bg-surface border border-border rounded-lg p-5 hover:border-accent transition-colors cursor-pointer">' +
              '<div class="flex items-center justify-between mb-3">' +
                '<h3 class="font-heading font-semibold text-foreground text-lg">' + repo.label + '</h3>' +
                '<span class="text-xs text-muted">' + timeAgo(updated) + '</span>' +
              '</div>' +
              '<div class="flex items-baseline gap-2 mb-3">' +
                '<span class="font-mono text-3xl font-bold ' + directionColor(dd) + '">' + dd + '%</span>' +
                '<span class="text-xs text-muted">direction</span>' +
              '</div>' +
              '<div class="flex gap-4 text-xs text-muted">' +
                '<span>' + ec + ' events</span>' +
                (cs != null ? '<span>comprehension ' + cs + '</span>' : '') +
                (td ? '<span>' + td + '</span>' : '') +
              '</div>' +
            '</div>' +
          '</a>';
        }).join('');
      }).catch(function() {
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
      });
    })();
    </script>
  `;

  return c.html(layout("Portfolio", content));
});

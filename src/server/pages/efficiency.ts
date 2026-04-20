// FILE: src/server/pages/efficiency.ts
// UF-104: AI Efficiency Score dashboard page — AES gauge, sub-metrics, trend, insights.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const efficiencyPage = new Hono();

efficiencyPage.get("/efficiency", (c) => {
  const content = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-heading font-semibold">AI Efficiency Score</h1>
      <a href="/" class="text-accent hover:text-accent-dim text-sm no-underline">&larr; Dashboard</a>
    </div>

    <div id="eff-loading" class="text-center py-12 text-muted">Loading efficiency data…</div>
    <div id="eff-empty" class="hidden text-center py-12 text-muted">
      <p class="text-lg mb-2">Not enough data yet</p>
      <p class="text-sm">Keep working with AI tools — efficiency metrics appear after 5+ interactions.</p>
    </div>

    <div id="eff-live" class="hidden">
      <!-- AES Hero -->
      <div class="bg-surface border border-border rounded-lg p-6 mb-6 text-center">
        <div class="font-mono text-6xl font-bold text-cyan" id="aes-score">—</div>
        <div class="text-sm text-muted mt-2">AI Efficiency Score</div>
        <div class="text-xs text-muted mt-1" id="aes-confidence"></div>
        <div class="text-xs mt-2" id="aes-trend"></div>
      </div>

      <!-- Sub-metrics grid -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" id="sub-metrics"></div>

      <!-- Top insight -->
      <div id="insight-box" class="hidden bg-surface border border-accent/30 rounded-lg p-5 mb-6">
        <h2 class="text-lg font-heading font-semibold mb-2 text-accent">Insight</h2>
        <p class="text-sm text-muted" id="insight-text"></p>
      </div>

      <!-- Disclaimer -->
      <p class="text-xs text-muted text-center">Metrics are computed from local AI session data. <a href="/settings" class="text-accent">Configure pricing</a> for cost accuracy.</p>
    </div>

    <script>
    (function() {
      var loading = document.getElementById('eff-loading');
      var empty = document.getElementById('eff-empty');
      var live = document.getElementById('eff-live');

      fetch('/api/intelligence/efficiency').then(function(r) { return r.json(); }).then(function(data) {
        loading.classList.add('hidden');
        if (!data || data.aes === undefined) { empty.classList.remove('hidden'); return; }

        live.classList.remove('hidden');
        document.getElementById('aes-score').textContent = data.aes;
        document.getElementById('aes-confidence').textContent = 'Confidence: ' + data.confidence;

        var trendEl = document.getElementById('aes-trend');
        if (data.trend) {
          var trendColor = data.trend === 'improving' ? 'text-success' : data.trend === 'declining' ? 'text-warning' : 'text-muted';
          trendEl.innerHTML = '<span class="' + trendColor + '">' + data.trend + '</span>';
        }

        var metricsEl = document.getElementById('sub-metrics');
        var sm = data.subMetrics || {};
        var names = {directionDensity: 'Direction', tokenEfficiency: 'Token Eff.', iterationRatio: 'Iteration', contextLeverage: 'Context', modificationDepth: 'Modification'};
        metricsEl.innerHTML = Object.entries(sm).map(function(e) {
          var k = e[0], v = e[1];
          var color = v.value >= 60 ? 'text-success' : v.value >= 40 ? 'text-cyan' : 'text-warning';
          return '<div class="bg-surface border border-border rounded p-3 text-center">' +
            '<div class="font-mono text-2xl font-bold ' + color + '">' + v.value + '</div>' +
            '<div class="text-xs text-muted mt-1">' + (names[k] || k) + '</div>' +
            '<div class="text-xs text-muted">' + v.confidence + ' (' + v.dataPoints + ')</div>' +
          '</div>';
        }).join('');

        if (data.topInsight) {
          document.getElementById('insight-box').classList.remove('hidden');
          document.getElementById('insight-text').textContent = data.topInsight;
        }
      }).catch(function() { loading.classList.add('hidden'); empty.classList.remove('hidden'); });
    })();
    </script>
  `;

  return c.html(layout("AI Efficiency", content));
});

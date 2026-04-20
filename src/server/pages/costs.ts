// FILE: src/server/pages/costs.ts
// UF-104: Cost Attribution dashboard page — per-model, per-branch costs with disclaimers.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const costsPage = new Hono();

costsPage.get("/costs", (c) => {
  const content = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-heading font-semibold">Cost Attribution</h1>
      <a href="/" class="text-accent hover:text-accent-dim text-sm no-underline">&larr; Dashboard</a>
    </div>

    <div class="bg-warning/10 border border-warning/30 rounded-lg p-4 mb-6 text-sm text-muted">
      These are <strong class="text-foreground">estimated costs</strong> based on AI event counts and your pricing config.
      They are not invoices. <a href="/settings" class="text-accent">Configure pricing</a> for better accuracy.
    </div>

    <div id="cost-loading" class="text-center py-12 text-muted">Loading cost data…</div>
    <div id="cost-live" class="hidden">

      <!-- Total cost hero -->
      <div class="bg-surface border border-border rounded-lg p-6 mb-6 text-center">
        <div class="text-xs text-muted mb-1">Estimated Total</div>
        <div class="font-mono text-5xl font-bold text-cyan" id="total-cost">$0</div>
        <div class="text-sm text-muted mt-2" id="projected-monthly"></div>
        <div class="text-sm text-muted" id="cost-per-directed"></div>
      </div>

      <!-- By Model -->
      <div class="bg-surface border border-border rounded p-5 mb-4">
        <h2 class="text-lg font-heading font-semibold mb-3">By Model</h2>
        <div id="by-model" class="space-y-2"></div>
      </div>

      <!-- By Branch -->
      <div class="bg-surface border border-border rounded p-5 mb-4">
        <h2 class="text-lg font-heading font-semibold mb-3">By Branch</h2>
        <div id="by-branch" class="space-y-2"></div>
      </div>

      <!-- Waste + Context -->
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="bg-surface border border-border rounded p-4 text-center">
          <div class="font-mono text-3xl font-bold text-warning" id="waste-ratio">—</div>
          <div class="text-xs text-muted mt-1">Waste Ratio</div>
          <div class="text-xs text-muted">Low-direction sessions</div>
        </div>
        <div class="bg-surface border border-border rounded p-4 text-center">
          <div class="font-mono text-3xl font-bold text-warning" id="context-overhead">—</div>
          <div class="text-xs text-muted mt-1">Context Overhead</div>
          <div class="text-xs text-muted">Re-explanation cost proxy</div>
        </div>
      </div>
    </div>

    <script>
    (function() {
      var loading = document.getElementById('cost-loading');
      var live = document.getElementById('cost-live');

      fetch('/api/intelligence/costs').then(function(r) { return r.json(); }).then(function(data) {
        loading.classList.add('hidden');
        if (!data) return;
        live.classList.remove('hidden');

        document.getElementById('total-cost').textContent = '$' + (data.totalEstimatedCost || 0).toFixed(2);
        if (data.projectedMonthlyCost) {
          document.getElementById('projected-monthly').textContent = 'Projected monthly: $' + data.projectedMonthlyCost.toFixed(2);
        }
        if (data.costPerDirectedDecision) {
          document.getElementById('cost-per-directed').textContent = '$' + data.costPerDirectedDecision.toFixed(2) + ' per directed decision';
        }

        var modelEl = document.getElementById('by-model');
        modelEl.innerHTML = (data.byModel || []).map(function(m) {
          return '<div class="flex justify-between items-center py-1 border-b border-border last:border-0">' +
            '<span class="font-mono text-sm">' + m.key + '</span>' +
            '<span class="text-sm text-muted">' + m.eventCount + ' events · $' + m.estimatedCost.toFixed(2) + ' (' + m.percentage + '%)</span>' +
          '</div>';
        }).join('') || '<span class="text-muted text-sm">No model data</span>';

        var branchEl = document.getElementById('by-branch');
        branchEl.innerHTML = (data.byBranch || []).map(function(b) {
          return '<div class="flex justify-between items-center py-1 border-b border-border last:border-0">' +
            '<span class="font-mono text-sm">' + b.key + '</span>' +
            '<span class="text-sm text-muted">' + b.eventCount + ' events (' + b.percentage + '%)</span>' +
          '</div>';
        }).join('') || '<span class="text-muted text-sm">No branch data</span>';

        if (data.wasteRatio != null) document.getElementById('waste-ratio').textContent = Math.round(data.wasteRatio * 100) + '%';
        if (data.contextOverhead != null) document.getElementById('context-overhead').textContent = Math.round(data.contextOverhead * 100) + '%';
      }).catch(function() { loading.classList.add('hidden'); });
    })();
    </script>
  `;

  return c.html(layout("Cost Attribution", content));
});

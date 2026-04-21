// FILE: src/server/pages/cost.ts
// UF-307: Cost Attribution page — hero spend + model/branch bars + waste + estimates.
// All USD wrapped in estimate badge. Data from /api/intelligence/costs.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const costPage = new Hono();

costPage.get("/cost", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-6">Cost Attribution</h1>

    <div class="bg-warning/10 border border-warning/30 rounded-lg p-4 mb-6 text-sm text-muted">
      All costs are <strong class="text-foreground">estimates</strong> based on event counts and your pricing config. <a href="/settings" class="text-accent">Configure pricing →</a>
    </div>

    <div id="cost-loading" class="text-center py-16 text-muted">Loading…</div>
    <div id="cost-empty" class="hidden text-center py-16 text-muted">
      <p class="text-lg mb-2">No cost data yet</p>
      <p class="text-sm">Configure pricing in config.json or Settings page for estimated costs.</p>
    </div>

    <div id="cost-live" class="hidden">

      <!-- Hero spend -->
      <div class="bg-surface border border-border rounded-lg p-6 mb-6 text-center">
        <div class="text-xs text-muted uppercase tracking-wider mb-1">Estimated Total</div>
        <div class="flex items-center justify-center gap-2">
          <span class="font-mono text-5xl font-bold text-cyan" id="c-total">$0</span>
          <span class="inline-block text-[10px] px-1.5 py-0.5 rounded" style="background:var(--proxy);color:var(--accent)">est.</span>
        </div>
        <div class="flex items-center justify-center gap-4 mt-3 text-sm text-muted">
          <span id="c-monthly"></span>
          <span id="c-per-decision"></span>
        </div>
      </div>

      <!-- Two-column: By Model + By Branch -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div class="bg-surface border border-border rounded-lg p-5">
          <h2 class="font-heading text-lg font-semibold mb-4">By Model</h2>
          <div id="c-models" class="space-y-3"></div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-5">
          <h2 class="font-heading text-lg font-semibold mb-4">By Branch</h2>
          <div id="c-branches" class="space-y-3"></div>
        </div>
      </div>

      <!-- Waste + Context Overhead -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-surface border-l-4 border-warning rounded-lg p-5">
          <div class="text-xs text-muted uppercase tracking-wider mb-1">Waste Ratio</div>
          <div class="font-mono text-3xl font-bold text-warning" id="c-waste">—</div>
          <p class="text-xs text-muted mt-2">Low-direction sessions as % of total</p>
        </div>
        <div class="bg-surface border-l-4 border-accent rounded-lg p-5">
          <div class="text-xs text-muted uppercase tracking-wider mb-1">Context Overhead</div>
          <div class="font-mono text-3xl font-bold text-accent" id="c-context">—</div>
          <p class="text-xs text-muted mt-2">Re-explanation proxy (1 − avg specificity)</p>
        </div>
      </div>
    </div>

    <script>
    (function(){
      var loading=document.getElementById('cost-loading');
      var empty=document.getElementById('cost-empty');
      var live=document.getElementById('cost-live');

      fetch('/api/intelligence/costs').then(function(r){
        if(r.status===202||r.status===204)return null;
        return r.json();
      }).then(function(data){
        loading.classList.add('hidden');
        if(!data){empty.classList.remove('hidden');return;}
        live.classList.remove('hidden');

        document.getElementById('c-total').textContent='$'+(data.totalEstimatedCost||0).toFixed(2);
        if(data.projectedMonthlyCost)document.getElementById('c-monthly').textContent='~$'+data.projectedMonthlyCost.toFixed(0)+'/mo projected';
        if(data.costPerDirectedDecision)document.getElementById('c-per-decision').innerHTML='$'+data.costPerDirectedDecision.toFixed(2)+'/decision <span class="inline-block text-[10px] px-1 rounded" style="background:var(--proxy);color:var(--accent)">est.</span>';

        renderBars('c-models',data.byModel||[]);
        renderBars('c-branches',data.byBranch||[]);

        if(data.wasteRatio!=null)document.getElementById('c-waste').textContent=Math.round(data.wasteRatio*100)+'%';
        if(data.contextOverhead!=null)document.getElementById('c-context').textContent=Math.round(data.contextOverhead*100)+'%';
      }).catch(function(){loading.classList.add('hidden');empty.classList.remove('hidden');});

      function renderBars(id,items){
        var el=document.getElementById(id);
        if(!items.length){el.innerHTML='<p class="text-muted text-sm">No data</p>';return;}
        var maxPct=Math.max.apply(null,items.map(function(i){return i.percentage;}));
        el.innerHTML=items.map(function(i){
          var w=maxPct>0?Math.round(i.percentage/maxPct*100):0;
          return'<div>'+
            '<div class="flex justify-between text-xs mb-1">'+
              '<span class="font-mono text-foreground">'+i.key+'</span>'+
              '<span class="text-muted">'+i.eventCount+' events · '+i.percentage+'%'+(i.estimatedCost?' · <span style="background:var(--proxy);color:var(--accent)" class="inline-block text-[10px] px-1 rounded">$'+i.estimatedCost.toFixed(2)+'</span>':'')+'</span>'+
            '</div>'+
            '<div class="h-2 rounded-full bg-overlay">'+
              '<div class="h-2 rounded-full bg-accent" style="width:'+w+'%;transition:width 0.5s"></div>'+
            '</div>'+
          '</div>';
        }).join('');
      }
    })();
    </script>
  `;

  return c.html(layout("Cost", content));
});

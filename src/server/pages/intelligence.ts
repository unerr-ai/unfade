// FILE: src/server/pages/intelligence.ts
// UF-306: Intelligence page — AES gauge (inline SVG ring) + sub-metric strip + trend + insight.
// Data from /api/intelligence/efficiency with fallback to /api/summary.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const intelligencePage = new Hono();

intelligencePage.get("/intelligence", (c) => {
  const activeTab = (c.req.query("tab") ?? "overview") as string;
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "comprehension", label: "Comprehension" },
    { id: "velocity", label: "Velocity" },
    { id: "cost", label: "Cost" },
    { id: "patterns", label: "Patterns & Coach" },
  ];

  const tabBarHtml = tabs
    .map((t) => {
      const active =
        t.id === activeTab
          ? "border-accent text-foreground"
          : "border-transparent text-muted hover:text-foreground hover:border-border";
      const tabIdAttr = ` id="tab-${t.id}"`;
      if (t.id === "overview") {
        return `<a href="/intelligence?tab=overview"${tabIdAttr} class="px-4 py-2 text-sm font-medium border-b-2 transition-colors no-underline inline-block ${active}">Overview</a>`;
      }
      return `<button type="button"${tabIdAttr} class="px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active}"
      hx-get="/intelligence/tab/${t.id}" hx-target="#tab-content" hx-push-url="/intelligence?tab=${t.id}">${t.label}</button>`;
    })
    .join("\n");

  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-4">Intelligence Hub</h1>

    <div class="flex items-center gap-1 border-b border-border mb-6">
      ${tabBarHtml}
    </div>

    <div id="tab-content">
    <!-- Default Overview tab content (pre-rendered server-side) -->

    <div id="intel-loading" class="text-center py-16 text-muted">Loading…</div>
    <div id="intel-empty" class="hidden text-center py-16 text-muted">
      <p class="text-lg mb-2">Not enough data yet</p>
      <p class="text-sm">AI Efficiency Score requires 5+ AI interactions. Keep working with your AI tools.</p>
      <div class="mt-4" id="intel-onboard"></div>
    </div>

    <div id="intel-live" class="hidden">

      <!-- AES Gauge Hero -->
      <div class="flex flex-col items-center mb-8">
        <div style="position:relative;width:200px;height:200px">
          <svg width="200" height="200" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="88" fill="none" stroke="var(--overlay)" stroke-width="12"/>
            <circle cx="100" cy="100" r="88" fill="none" stroke="var(--accent)" stroke-width="12"
              stroke-linecap="round" stroke-dasharray="553" id="aes-ring"
              stroke-dashoffset="553" transform="rotate(-90 100 100)"
              style="transition:stroke-dashoffset 1s ease-out"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div class="font-mono text-5xl font-bold text-foreground" id="aes-score">—</div>
            <div class="text-xs text-muted mt-1">AI Efficiency</div>
          </div>
        </div>
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm" id="aes-trend-badge"></span>
          <span class="text-xs text-muted" id="aes-confidence"></span>
        </div>
      </div>

      <!-- Sub-metric strip -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8" id="sub-metrics"></div>

      <!-- Insight -->
      <div id="aes-insight" class="hidden bg-surface border border-accent/30 rounded-lg p-5 mb-6">
        <div class="text-xs text-accent uppercase tracking-wider mb-2 font-medium">Insight</div>
        <p class="text-sm text-muted" id="aes-insight-text"></p>
      </div>

      <!-- History -->
      <div class="bg-surface border border-border rounded-lg p-5">
        <h2 class="font-heading text-lg font-semibold mb-3">Trend</h2>
        <div id="aes-history" style="height:160px" class="flex items-end gap-1"></div>
      </div>
    </div>

    <script>
    (function(){
      var loading=document.getElementById('intel-loading');
      var empty=document.getElementById('intel-empty');
      var live=document.getElementById('intel-live');

      var subNames={directionDensity:'Direction',tokenEfficiency:'Token Eff.',iterationRatio:'Iteration',contextLeverage:'Context',modificationDepth:'Modification'};
      var subWeights={directionDensity:'30%',tokenEfficiency:'20%',iterationRatio:'20%',contextLeverage:'15%',modificationDepth:'15%'};

      var effPath='/api/intelligence/efficiency';
      (window.__unfade&&typeof window.__unfade.fetch==='function'?window.__unfade.fetch(effPath):fetch(effPath)).then(function(r){
        if(r.status===202||r.status===204)return null;
        return r.json();
      }).then(function(data){
        loading.classList.add('hidden');
        if(!data||data.aes===undefined){
          empty.classList.remove('hidden');
          fetch('/api/intelligence/onboarding').then(function(r){return r.json();}).then(function(ob){
            var eff=ob.progress.find(function(p){return p.capability==='AI Efficiency Score';});
            if(eff)document.getElementById('intel-onboard').innerHTML='<p class="text-xs text-muted">'+eff.hint+'</p>';
          }).catch(function(){});
          return;
        }

        live.classList.remove('hidden');

        var score=data.aes;
        document.getElementById('aes-score').textContent=score;
        var circumference=553;
        var offset=circumference-(score/100)*circumference;
        document.getElementById('aes-ring').setAttribute('stroke-dashoffset',String(offset));

        if(data.trend){
          var tc=data.trend==='improving'?'text-success':data.trend==='declining'?'text-warning':'text-muted';
          document.getElementById('aes-trend-badge').innerHTML='<span class="'+tc+' text-sm font-medium">'+data.trend+'</span>';
        }
        document.getElementById('aes-confidence').textContent=data.confidence||'';

        var sm=data.subMetrics||{};
        var metricsEl=document.getElementById('sub-metrics');
        metricsEl.innerHTML=Object.entries(sm).map(function(e){
          var k=e[0],v=e[1];
          var color=v.value>=60?'text-success':v.value>=40?'text-cyan':v.value>=20?'text-warning':'text-error';
          var confColor=v.confidence==='high'?'bg-success':v.confidence==='medium'?'bg-warning':'bg-muted';
          return'<div class="bg-surface border border-border rounded-lg p-4" style="min-height:88px">'+
            '<div class="text-xs text-muted mb-1">'+(subNames[k]||k)+'</div>'+
            '<div class="font-mono text-3xl font-bold '+color+'">'+v.value+'</div>'+
            '<div class="flex items-center gap-2 mt-1">'+
              '<div class="h-1 rounded-full '+confColor+'" style="width:'+v.value+'%;max-width:100%"></div>'+
              '<span class="text-[10px] text-muted">'+(subWeights[k]||'')+'</span>'+
            '</div>'+
          '</div>';
        }).join('');

        if(data.topInsight){
          document.getElementById('aes-insight').classList.remove('hidden');
          document.getElementById('aes-insight-text').textContent=data.topInsight;
        }

        if(data.history&&data.history.length>0){
          var max=Math.max.apply(null,data.history.map(function(h){return h.aes;}));
          var histEl=document.getElementById('aes-history');
          histEl.innerHTML=data.history.map(function(h){
            var pct=max>0?Math.round(h.aes/max*100):0;
            var color=h.aes>=60?'bg-success':h.aes>=40?'bg-cyan':h.aes>=20?'bg-warning':'bg-error';
            return'<div class="flex-1 '+color+' rounded-t opacity-80 hover:opacity-100 transition-opacity" style="height:'+pct+'%;min-height:2px" title="'+h.date+': '+h.aes+'"></div>';
          }).join('');
        }
      }).catch(function(){loading.classList.add('hidden');empty.classList.remove('hidden');});
    })();
    </script>
    </div><!-- end tab-content -->
  `;

  return c.html(layout("Intelligence Hub", content));
});

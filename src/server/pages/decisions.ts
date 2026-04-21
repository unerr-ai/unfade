// Phase 15: Decisions page — timeline + search + domain filters
// Replaces the Search page. Reads from SQLite decisions table.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const decisionsPage = new Hono();

decisionsPage.get("/decisions", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-4">Decisions</h1>

    <div class="mb-4">
      <input type="text" id="dec-search" placeholder="Search decisions, reasoning, events…"
        class="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-foreground font-body placeholder:text-muted focus:outline-none focus:border-accent/60"
        hx-get="/unfade/decisions" hx-target="#dec-results" hx-trigger="keyup changed delay:300ms"
        hx-include="#dec-search" name="q">
    </div>

    <div class="flex items-center gap-2 mb-6">
      <span class="text-xs text-muted">Source:</span>
      <button onclick="filterDecisions('')" class="px-2 py-0.5 text-xs rounded bg-raised text-foreground" id="filter-all">All</button>
      <button onclick="filterDecisions('git')" class="px-2 py-0.5 text-xs rounded text-muted" id="filter-git">Git</button>
      <button onclick="filterDecisions('ai-session')" class="px-2 py-0.5 text-xs rounded text-muted" id="filter-ai">AI</button>
      <button onclick="filterDecisions('terminal')" class="px-2 py-0.5 text-xs rounded text-muted" id="filter-terminal">Terminal</button>
      <span class="flex-1"></span>
      <select class="bg-raised border border-border rounded px-2 py-0.5 text-xs text-foreground font-mono" id="dec-period" onchange="loadDecisions()">
        <option value="7d">7 days</option>
        <option value="30d" selected>30 days</option>
        <option value="90d">90 days</option>
      </select>
    </div>

    <div id="dec-results">
      <div class="text-center py-8 text-muted" id="dec-loading">Loading decisions…</div>
    </div>

    <script>
    (function(){
      var currentSource='';

      window.filterDecisions=function(source){
        currentSource=source;
        document.querySelectorAll('[id^="filter-"]').forEach(function(b){b.className='px-2 py-0.5 text-xs rounded text-muted';});
        document.getElementById('filter-'+(source||'all')).className='px-2 py-0.5 text-xs rounded bg-raised text-foreground';
        loadDecisions();
      };

      window.loadDecisions=function(){
        var q=document.getElementById('dec-search').value;
        var project=window.__unfade?.projectId||'';
        var period=document.getElementById('dec-period').value;
        var url='/unfade/decisions?limit=50';
        if(q)url+='&q='+encodeURIComponent(q);
        if(project)url+='&project='+project;

        fetch(url).then(function(r){return r.json();}).then(function(result){
          var decisions=result.data?.decisions||[];
          var el=document.getElementById('dec-results');
          if(decisions.length===0){
            el.innerHTML='<div class="text-center py-8 text-muted"><p class="text-lg mb-2">No decisions found</p><p class="text-sm">Decisions are extracted from daily distills. Run <code class="bg-raised px-1 rounded">unfade distill</code> or keep working to generate decisions.</p></div>';
            return;
          }
          el.innerHTML=decisions.map(function(d){
            var domainBadge=d.domain?'<span class="px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent">'+d.domain+'</span>':'';
            return '<div class="border-b border-border py-3 flex items-start gap-3">'+
              '<div class="text-xs text-muted font-mono w-[80px] flex-shrink-0 pt-0.5">'+(d.date||'')+'</div>'+
              '<div class="flex-1 min-w-0">'+
                '<div class="flex items-center gap-2 mb-1">'+domainBadge+'</div>'+
                '<div class="text-sm text-foreground">'+(d.decision||'')+'</div>'+
                (d.rationale?'<div class="text-xs text-muted mt-1">'+d.rationale+'</div>':'')+
              '</div>'+
            '</div>';
          }).join('');
        }).catch(function(){
          document.getElementById('dec-results').innerHTML='<div class="text-center py-8 text-muted">Failed to load decisions</div>';
        });
      };

      loadDecisions();
    })();
    </script>
  `;

  return c.html(layout("Decisions", content));
});

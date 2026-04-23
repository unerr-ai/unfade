// FILE: src/server/pages/decisions.ts
// Phase 15: Decisions page — search, period, optional domain; data from GET /unfade/decisions (distill + graph).

import { Hono } from "hono";
import { layout } from "./layout.js";

export const decisionsPage = new Hono();

decisionsPage.get("/decisions", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-4">Decisions</h1>

    <div class="flex flex-wrap items-center gap-3 mb-4" id="dec-scope-row">
      <span id="dec-scope-badge" class="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border border-border text-muted font-medium">All projects</span>
    </div>

    <div class="mb-4">
      <input type="text" id="dec-search" placeholder="Search decisions and rationale…"
        class="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-foreground font-body placeholder:text-muted focus:outline-none focus:border-accent/60"
        autocomplete="off">
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-6">
      <span class="text-xs text-muted">Domain:</span>
      <select id="dec-domain" class="bg-raised border border-border rounded px-2 py-0.5 text-xs text-foreground font-mono max-w-[200px]" onchange="loadDecisions()">
        <option value="">All</option>
      </select>
      <span class="flex-1"></span>
      <span class="text-xs text-muted">Period:</span>
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
      var debounceTimer=null;

      function unfadeFetch(path){
        if(window.__unfade&&typeof window.__unfade.fetch==='function')return window.__unfade.fetch(path);
        return fetch(path);
      }

      function updateScopeBadge(){
        var badge=document.getElementById('dec-scope-badge');
        if(!badge)return;
        var pid=window.__unfade&&window.__unfade.projectId;
        if(pid){
          badge.textContent='Project: '+pid;
          badge.className='text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border border-accent/40 text-accent font-medium';
        }else{
          badge.textContent='All projects';
          badge.className='text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border border-border text-muted font-medium';
        }
      }

      function esc(s){
        return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function refreshDomainOptions(decisions){
        var sel=document.getElementById('dec-domain');
        if(!sel)return;
        if(sel.value)return;
        var current=sel.value;
        var domains=[...new Set(decisions.map(function(d){return d.domain;}).filter(Boolean))].sort();
        sel.innerHTML='<option value="">All</option>'+domains.map(function(d){
          return '<option value="'+esc(d)+'">'+esc(d)+'</option>';
        }).join('');
        if(domains.indexOf(current)>=0)sel.value=current;
      }

      window.loadDecisions=function(){
        updateScopeBadge();
        var q=document.getElementById('dec-search').value.trim();
        var period=document.getElementById('dec-period').value;
        var domain=document.getElementById('dec-domain').value;
        var params=new URLSearchParams();
        params.set('limit','50');
        if(period)params.set('period',period);
        if(q)params.set('q',q);
        if(domain)params.set('domain',domain);
        var path='/unfade/decisions?'+params.toString();

        unfadeFetch(path).then(function(r){return r.json();}).then(function(result){
          var decisions=result.data?.decisions||[];
          var el=document.getElementById('dec-results');
          refreshDomainOptions(decisions);
          if(decisions.length===0){
            el.innerHTML='<div class="text-center py-8 text-muted"><p class="text-lg mb-2">No decisions found</p><p class="text-sm">Decisions are extracted from daily distills (or graph/decisions.jsonl). Run <code class="bg-raised px-1 rounded">unfade distill</code> to generate distills.</p></div>';
            return;
          }
          el.innerHTML=decisions.map(function(d){
            var domainBadge=d.domain?'<span class="px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent">'+esc(d.domain)+'</span>':'';
            return '<div class="border-b border-border py-3 flex items-start gap-3">'+
              '<div class="text-xs text-muted font-mono w-[80px] flex-shrink-0 pt-0.5">'+esc(d.date)+'</div>'+
              '<div class="flex-1 min-w-0">'+
                '<div class="flex items-center gap-2 mb-1">'+domainBadge+'</div>'+
                '<div class="text-sm text-foreground">'+esc(d.decision)+'</div>'+
                (d.rationale?'<div class="text-xs text-muted mt-1">'+esc(d.rationale)+'</div>':'')+
              '</div>'+
            '</div>';
          }).join('');
        }).catch(function(){
          document.getElementById('dec-results').innerHTML='<div class="text-center py-8 text-muted">Failed to load decisions</div>';
        });
      };

      document.getElementById('dec-search').addEventListener('input',function(){
        clearTimeout(debounceTimer);
        debounceTimer=setTimeout(loadDecisions,300);
      });

      if(window.__unfade&&Array.isArray(window.__unfade.onHealth)){
        window.__unfade.onHealth.push(function(){loadDecisions();});
      }

      loadDecisions();
    })();
    </script>
  `;

  return c.html(layout("Decisions", content));
});

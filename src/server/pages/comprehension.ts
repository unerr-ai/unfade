// FILE: src/server/pages/comprehension.ts
// UF-308: Comprehension page — heatmap grid + table view + blind spot cards.
// Replaces heatmap-panel.ts. Data from /api/intelligence/comprehension + /api/heatmap fallback.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const comprehensionPage = new Hono();

comprehensionPage.get("/comprehension", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-6">Comprehension</h1>

    <div id="comp-loading" class="text-center py-16 text-muted">Loading…</div>
    <div id="comp-empty" class="hidden text-center py-16 text-muted">
      <p class="text-lg mb-2">Not enough data yet</p>
      <p class="text-sm">Comprehension scores need 5+ AI interactions with file references.</p>
    </div>

    <div id="comp-live" class="hidden">

      <!-- Overall score -->
      <div class="bg-surface border border-border rounded-lg p-6 mb-6 flex items-center gap-6">
        <div>
          <div class="text-xs text-muted uppercase tracking-wider mb-1">Overall Comprehension</div>
          <div class="font-mono text-4xl font-bold" id="comp-overall">—</div>
        </div>
        <div class="flex-1">
          <div class="h-3 rounded-full bg-overlay" id="comp-bar-bg">
            <div class="h-3 rounded-full transition-all duration-500" id="comp-bar" style="width:0"></div>
          </div>
        </div>
        <div class="text-xs text-muted" id="comp-confidence"></div>
      </div>

      <!-- View toggle -->
      <div class="flex gap-2 mb-4">
        <button class="comp-tab px-3 py-1.5 rounded-md text-xs font-medium bg-raised border border-border" data-view="heatmap" onclick="switchView('heatmap')">Heatmap</button>
        <button class="comp-tab px-3 py-1.5 rounded-md text-xs font-medium border border-border" data-view="table" onclick="switchView('table')">Table</button>
      </div>

      <!-- Heatmap view -->
      <div id="view-heatmap" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"></div>

      <!-- Table view -->
      <div id="view-table" class="hidden mb-6">
        <div class="bg-surface border border-border rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border text-xs text-muted uppercase tracking-wider">
                <th class="text-left p-3">Module</th>
                <th class="text-right p-3">Score</th>
                <th class="text-right p-3">Events</th>
                <th class="text-right p-3">Confidence</th>
                <th class="text-right p-3">Blind Spot</th>
              </tr>
            </thead>
            <tbody id="comp-table-body"></tbody>
          </table>
        </div>
      </div>

      <!-- Blind spots -->
      <div id="comp-blindspots" class="space-y-3 mb-6"></div>
    </div>

    <script>
    (function(){
      var loading=document.getElementById('comp-loading');
      var empty=document.getElementById('comp-empty');
      var live=document.getElementById('comp-live');

      window.switchView=function(view){
        document.querySelectorAll('.comp-tab').forEach(function(b){
          b.classList.toggle('bg-raised',b.getAttribute('data-view')===view);
        });
        document.getElementById('view-heatmap').classList.toggle('hidden',view!=='heatmap');
        document.getElementById('view-table').classList.toggle('hidden',view!=='table');
      };

      function riskColor(score){
        if(score>=60)return{bg:'bg-success/15',border:'border-success/30',text:'text-success',barBg:'bg-success'};
        if(score>=35)return{bg:'bg-warning/15',border:'border-warning/30',text:'text-warning',barBg:'bg-warning'};
        return{bg:'bg-error/15',border:'border-error/30',text:'text-error',barBg:'bg-error'};
      }

      fetch('/api/intelligence/comprehension').then(function(r){
        if(r.status===202||r.status===204)return fetch('/api/heatmap').then(function(r2){return(r2.status===202||r2.status===204)?null:r2.json();});
        return r.json();
      }).then(function(data){
        loading.classList.add('hidden');
        if(!data){empty.classList.remove('hidden');return;}
        live.classList.remove('hidden');

        var overall=data.overall||0;
        document.getElementById('comp-overall').textContent=overall;
        var rc=riskColor(overall);
        document.getElementById('comp-bar').className='h-3 rounded-full transition-all duration-500 '+rc.barBg;
        document.getElementById('comp-bar').style.width=overall+'%';
        document.getElementById('comp-confidence').textContent=data.confidence||'';

        var modules=data.byModule?Object.entries(data.byModule):
                     data.modules?data.modules.map(function(m){return[m.path,{score:m.directionDensity||m.comprehensionScore||0,decisionsCount:m.eventCount||0,confidence:'medium'}];}):[];

        var heatmapEl=document.getElementById('view-heatmap');
        var tableBody=document.getElementById('comp-table-body');

        heatmapEl.innerHTML=modules.map(function(e){
          var path=e[0],m=e[1];
          var score=typeof m==='number'?m:(m.score||0);
          var count=m.decisionsCount||m.eventCount||0;
          var c=riskColor(score);
          return'<div class="'+c.bg+' border '+c.border+' rounded-lg p-4 cursor-pointer hover:opacity-80" style="min-height:80px">'+
            '<div class="font-mono text-sm font-semibold text-foreground truncate mb-1" title="'+path+'">'+path+'</div>'+
            '<div class="font-mono text-2xl font-bold '+c.text+'">'+score+'</div>'+
            '<div class="text-[10px] text-muted">'+count+' events</div>'+
          '</div>';
        }).join('')||'<p class="text-muted col-span-4">No module data</p>';

        tableBody.innerHTML=modules.map(function(e){
          var path=e[0],m=e[1];
          var score=typeof m==='number'?m:(m.score||0);
          var count=m.decisionsCount||m.eventCount||0;
          var conf=m.confidence||'—';
          var isBlind=score<40&&count>=5;
          var c=riskColor(score);
          return'<tr class="border-b border-border hover:bg-raised/50">'+
            '<td class="p-3 font-mono text-sm">'+path+'</td>'+
            '<td class="p-3 text-right font-mono font-bold '+c.text+'">'+score+'</td>'+
            '<td class="p-3 text-right text-muted">'+count+'</td>'+
            '<td class="p-3 text-right text-muted">'+conf+'</td>'+
            '<td class="p-3 text-right">'+(isBlind?'<span class="text-warning text-xs font-medium">⚠ Blind spot</span>':'')+'</td>'+
          '</tr>';
        }).join('');

        var blindSpots=(data.blindSpotAlerts||data.blindSpots||[]);
        var bsEl=document.getElementById('comp-blindspots');
        if(Array.isArray(blindSpots)&&blindSpots.length>0){
          var bsItems=typeof blindSpots[0]==='string'?
            blindSpots.map(function(b){return{module:b,score:0,suggestion:'Low comprehension in this module'};}):
            blindSpots;

          bsEl.innerHTML='<h2 class="font-heading text-lg font-semibold mb-3">Blind Spots</h2>'+
            bsItems.slice(0,3).map(function(bs){
              return'<div class="bg-warning/10 border-l-4 border-warning rounded-lg p-4">'+
                '<div class="font-semibold text-foreground text-sm">'+(bs.module||bs.domain||'')+'</div>'+
                '<p class="text-xs text-muted mt-1">'+(bs.suggestion||'Comprehension score '+bs.score+' — consider reviewing AI output more carefully')+'</p>'+
              '</div>';
            }).join('')+
            (bsItems.length>3?'<button class="text-xs text-accent">Show all '+bsItems.length+' blind spots</button>':'');
        }
      }).catch(function(){loading.classList.add('hidden');empty.classList.remove('hidden');});
    })();
    </script>
  `;

  return c.html(layout("Comprehension", content));
});

// Phase 15: Intelligence Hub tab routes — htmx partials
// Each route returns an HTML fragment (no layout wrapper) for tab content.

import { Hono } from "hono";
import { estimateBadge } from "../components/badges.js";

export const intelligenceTabRoutes = new Hono();

// Comprehension tab
intelligenceTabRoutes.get("/intelligence/tab/comprehension", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";

  return c.html(`
    <div id="comp-loading" class="text-center py-8 text-muted">Loading comprehension data…</div>
    <div id="comp-content" class="hidden">
      <div class="flex items-center gap-4 mb-6">
        <div class="font-mono text-4xl font-bold text-foreground" id="comp-score">—</div>
        <div><div class="text-xs text-muted uppercase tracking-wider">Overall Comprehension</div></div>
      </div>
      <div class="flex items-center gap-2 mb-4">
        <button onclick="document.getElementById('comp-heatmap').classList.remove('hidden');document.getElementById('comp-table').classList.add('hidden');this.classList.add('bg-raised');this.nextElementSibling.classList.remove('bg-raised')" class="px-3 py-1 text-xs rounded bg-raised">Heatmap</button>
        <button onclick="document.getElementById('comp-table').classList.remove('hidden');document.getElementById('comp-heatmap').classList.add('hidden');this.classList.add('bg-raised');this.previousElementSibling.classList.remove('bg-raised')" class="px-3 py-1 text-xs rounded">Table</button>
      </div>
      <div id="comp-heatmap" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"></div>
      <div id="comp-table" class="hidden"></div>
      <div id="comp-blindspots" class="space-y-3"></div>
    </div>
    <script>
    (function(){
      fetch('/api/intelligence/comprehension${sep}').then(function(r){
        if(r.status===202){document.getElementById('comp-loading').innerHTML='<p>Comprehension data is warming up…</p>';return null;}
        return r.json();
      }).then(function(data){
        if(!data)return;
        document.getElementById('comp-loading').classList.add('hidden');
        document.getElementById('comp-content').classList.remove('hidden');
        document.getElementById('comp-score').textContent=data.overall!=null?data.overall:'—';
        if(data.byModule){
          var hm=document.getElementById('comp-heatmap');
          hm.innerHTML=Object.entries(data.byModule).map(function(e){
            var m=e[0],d=e[1];var s=d.score||0;
            var bg=s>=60?'bg-success/20 border-success/40':s>=35?'bg-warning/20 border-warning/40':'bg-error/20 border-error/40';
            return '<div class="rounded-lg border p-3 text-center '+bg+'" style="min-height:80px"><div class="text-xs text-muted truncate">'+m+'</div><div class="font-mono text-lg font-bold mt-1">'+s+'</div></div>';
          }).join('');
        }
        if(data.blindSpotAlerts&&data.blindSpotAlerts.length>0){
          document.getElementById('comp-blindspots').innerHTML='<h3 class="font-heading text-sm font-semibold mb-2">Blind Spots</h3>'+
            data.blindSpotAlerts.slice(0,3).map(function(a){
              return '<div class="bg-surface border-l-4 border-warning rounded-r-lg p-3"><div class="text-sm font-medium">'+a.module+'</div><div class="text-xs text-muted">Score below threshold for '+(a.sustained_weeks||'?')+' weeks</div></div>';
            }).join('');
        }
      }).catch(function(){document.getElementById('comp-loading').textContent='Failed to load comprehension data';});
    })();
    </script>
  `);
});

// Velocity tab
intelligenceTabRoutes.get("/intelligence/tab/velocity", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";

  return c.html(`
    <div id="vel-loading" class="text-center py-8 text-muted">Loading velocity data…</div>
    <div id="vel-content" class="hidden">
      <div class="flex items-center gap-4 mb-6">
        <div class="font-mono text-3xl font-bold" id="vel-trend">—</div>
        <div id="vel-badge"></div>
      </div>
      <div id="vel-domains" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"></div>
      <div id="vel-durability" class="mt-6"></div>
    </div>
    <script>
    (function(){
      fetch('/api/intelligence/velocity${sep}').then(function(r){
        if(r.status===202){document.getElementById('vel-loading').innerHTML='<p>Velocity data is warming up…</p>';return null;}
        return r.json();
      }).then(function(data){
        if(!data)return;
        document.getElementById('vel-loading').classList.add('hidden');
        document.getElementById('vel-content').classList.remove('hidden');
        var trend=data.overallTrend||'stable';
        var icon=trend==='accelerating'?'↑':trend==='decelerating'?'↓':'→';
        var color=trend==='accelerating'?'text-success':trend==='decelerating'?'text-error':'text-muted';
        document.getElementById('vel-trend').textContent=icon+' '+trend;
        document.getElementById('vel-trend').className='font-mono text-3xl font-bold '+color;
        if(data.byDomain){
          document.getElementById('vel-domains').innerHTML=Object.entries(data.byDomain).map(function(e){
            var d=e[0],v=e[1];
            return '<div class="bg-surface border border-border rounded-lg p-4"><div class="text-sm font-semibold mb-1">'+d+'</div><div class="text-xs text-muted">'+
              (v.turnsToAcceptance?v.turnsToAcceptance.current+' turns (current)':'—')+
              '</div><div class="text-xs text-muted">'+v.sessionsCount+' sessions</div></div>';
          }).join('');
        }
      }).catch(function(){document.getElementById('vel-loading').textContent='Failed to load velocity data';});
    })();
    </script>
  `);
});

// Cost tab
intelligenceTabRoutes.get("/intelligence/tab/cost", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";
  const estBadge = estimateBadge;

  return c.html(`
    <div id="cost-loading" class="text-center py-8 text-muted">Loading cost data…</div>
    <div id="cost-content" class="hidden">
      <div class="flex items-center gap-4 mb-6">
        <div>
          <div class="text-xs text-muted uppercase tracking-wider mb-1">Estimated Spend</div>
          <div class="font-mono text-5xl font-bold text-foreground" id="cost-total">—</div>
        </div>
        <div class="inline-flex items-center gap-1 text-xs" style="border:1px dashed var(--warning);border-radius:4px;padding:1px 6px;background:var(--proxy)">≈ estimate</div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div><h3 class="font-heading text-sm font-semibold mb-3">By Model</h3><div id="cost-by-model" class="space-y-2"></div></div>
        <div><h3 class="font-heading text-sm font-semibold mb-3">By Domain</h3><div id="cost-by-domain" class="space-y-2"></div></div>
      </div>
      <div id="cost-waste" class="bg-surface border-l-4 border-warning rounded-r-lg p-4 mb-4 hidden">
        <div class="text-sm font-medium">Waste</div>
        <div class="text-xs text-muted" id="cost-waste-detail"></div>
      </div>
    </div>
    <script>
    (function(){
      fetch('/api/intelligence/costs${sep}').then(function(r){
        if(r.status===202){document.getElementById('cost-loading').innerHTML='<p>Cost data is warming up…</p>';return null;}
        return r.json();
      }).then(function(data){
        if(!data)return;
        document.getElementById('cost-loading').classList.add('hidden');
        document.getElementById('cost-content').classList.remove('hidden');
        document.getElementById('cost-total').textContent='$'+(data.totalEstimatedCost||0).toFixed(2);
        if(data.byModel){
          var max=Math.max.apply(null,Object.values(data.byModel).map(function(v){return v.cost||0;}));
          document.getElementById('cost-by-model').innerHTML=Object.entries(data.byModel).map(function(e){
            var pct=max>0?Math.round((e[1].cost||0)/max*100):0;
            return '<div class="flex items-center gap-2"><span class="text-xs w-20 truncate">'+e[0]+'</span><div class="flex-1 bg-raised rounded-full h-2"><div class="bg-accent rounded-full h-2" style="width:'+pct+'%"></div></div><span class="text-xs font-mono">$'+(e[1].cost||0).toFixed(2)+'</span></div>';
          }).join('');
        }
        if(data.wasteRatio>0){
          document.getElementById('cost-waste').classList.remove('hidden');
          document.getElementById('cost-waste-detail').textContent='Waste ratio: '+Math.round(data.wasteRatio*100)+'% · Abandoned: $'+(data.abandonedWaste||0).toFixed(2);
        }
      }).catch(function(){document.getElementById('cost-loading').textContent='Failed to load cost data';});
    })();
    </script>
  `);
});

// Patterns & Coach tab
intelligenceTabRoutes.get("/intelligence/tab/patterns", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";

  return c.html(`
    <div id="pat-loading" class="text-center py-8 text-muted">Loading patterns…</div>
    <div id="pat-content" class="hidden">
      <h3 class="font-heading text-sm font-semibold mb-3">Effective Patterns</h3>
      <div id="pat-effective" class="space-y-3 mb-6"></div>
      <h3 class="font-heading text-sm font-semibold mb-3">Anti-Patterns</h3>
      <div id="pat-anti" class="space-y-3 mb-6"></div>
      <h3 class="font-heading text-sm font-semibold mb-3">Alerts</h3>
      <div id="pat-alerts" class="space-y-3"></div>
    </div>
    <script>
    (function(){
      Promise.all([
        fetch('/api/intelligence/prompt-patterns${sep}').then(function(r){return r.status===202?null:r.json();}),
        fetch('/api/intelligence/alerts${sep}').then(function(r){return r.status===202?null:r.json();}),
        fetch('/api/intelligence/replays${sep}').then(function(r){return r.status===202?null:r.json();})
      ]).then(function(results){
        document.getElementById('pat-loading').classList.add('hidden');
        document.getElementById('pat-content').classList.remove('hidden');
        var patterns=results[0],alerts=results[1],replays=results[2];
        if(patterns&&patterns.effectivePatterns){
          document.getElementById('pat-effective').innerHTML=patterns.effectivePatterns.map(function(p){
            return '<div class="bg-surface border-l-4 border-success rounded-r-lg p-4"><div class="flex justify-between"><div class="text-sm font-medium">'+p.pattern+'</div><span class="text-xs font-mono text-success">'+(p.avgDirectionScore?Math.round(p.avgDirectionScore*100)+'%':'')+'</span></div><div class="text-xs text-muted mt-1">'+(p.description||'')+'</div>'+(p.example?'<button onclick="navigator.clipboard.writeText(this.dataset.rule);this.textContent=\\'Copied!\\'" data-rule="'+p.pattern.replace(/"/g,'&quot;')+'" class="mt-2 text-xs text-accent hover:underline bg-transparent border-none cursor-pointer">Copy as CLAUDE.md rule</button>':'')+'</div>';
          }).join('')||'<div class="text-sm text-muted">No patterns detected yet. Keep working — patterns emerge after ~10 sessions.</div>';
        }
        if(patterns&&patterns.antiPatterns){
          document.getElementById('pat-anti').innerHTML=patterns.antiPatterns.map(function(p){
            return '<div class="bg-surface border-l-4 border-warning rounded-r-lg p-4"><div class="text-sm font-medium">'+p.pattern+'</div><div class="text-xs text-muted mt-1">'+(p.suggestion||p.description||'')+'</div></div>';
          }).join('')||'<div class="text-sm text-muted">No anti-patterns detected.</div>';
        }
        if(alerts&&alerts.alerts){
          document.getElementById('pat-alerts').innerHTML=alerts.alerts.map(function(a){
            return '<div class="bg-surface border border-border rounded-lg p-3"><div class="text-sm font-medium">'+a.title+'</div><div class="text-xs text-muted mt-1">'+(a.description||'')+'</div></div>';
          }).join('')||'<div class="text-sm text-muted">No active alerts.</div>';
        }
      }).catch(function(){document.getElementById('pat-loading').textContent='Failed to load patterns';});
    })();
    </script>
  `);
});

// Overview tab (for htmx reload — same content as the server-rendered default)
intelligenceTabRoutes.get("/intelligence/tab/overview", (c) => {
  return c.redirect("/intelligence?tab=overview");
});

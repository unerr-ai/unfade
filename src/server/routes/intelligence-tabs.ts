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

// Sprint 15F: Autonomy tab
intelligenceTabRoutes.get("/intelligence/tab/autonomy", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";

  return c.html(`
    <div id="autonomy-loading" class="text-center py-8 text-muted">Loading autonomy data…</div>
    <div id="autonomy-content" class="hidden">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div id="autonomy-gauge"></div>
        <div id="autonomy-trajectory"></div>
      </div>
      <div class="mb-6">
        <h3 class="font-heading text-sm font-semibold mb-3">Domain dependency map</h3>
        <div id="autonomy-heatmap"></div>
      </div>
    </div>
    <script>
    (function(){
      fetch('/api/intelligence/autonomy${sep}').then(function(r){
        if(r.status===202){document.getElementById('autonomy-loading').innerHTML='<p>Autonomy data is warming up…</p>';return null;}
        return r.json();
      }).then(function(data){
        if(!data)return;
        document.getElementById('autonomy-loading').classList.add('hidden');
        document.getElementById('autonomy-content').classList.remove('hidden');

        var idx=data.independenceIndex||0;
        var bd=data.breakdown||{};
        var trend=data.trend||'stable';
        var gaugeEl=document.getElementById('autonomy-gauge');
        if(gaugeEl){
          var color=idx>=70?'var(--success)':idx>=40?'var(--warning)':'var(--error)';
          var arrow=trend==='improving'?'↑':trend==='declining'?'↓':'→';
          var tc=trend==='improving'?'text-success':trend==='declining'?'text-warning':'text-muted';
          gaugeEl.innerHTML='<div class="flex flex-col items-center">'+
            '<div class="font-mono text-5xl font-bold" style="color:'+color+'">'+idx+'</div>'+
            '<div class="text-xs text-muted mt-1">Independence Index</div>'+
            '<div class="'+tc+' text-sm mt-2">'+arrow+' '+trend+'</div>'+
            '<div class="grid grid-cols-2 gap-3 mt-4 w-full max-w-xs">'+
            ['Direction '+(bd.hds||0),'Modification '+(bd.modificationRate||0),'Alternatives '+(bd.alternativesEval||0),'Comprehension '+(bd.comprehensionTrend||0)]
              .map(function(s){return '<div class="text-xs text-muted">'+s+'</div>';}).join('')+
            '</div>'+
          '</div>';
        }

        var hist=data.hdsHistory||[];
        var trajEl=document.getElementById('autonomy-trajectory');
        if(trajEl&&hist.length>=2){
          var max=Math.max.apply(null,hist.map(function(h){return h.value;}));
          trajEl.innerHTML='<h3 class="font-heading text-sm font-semibold mb-3">Trend</h3>'+
            '<div class="flex items-end gap-1" style="height:120px">'+
            hist.map(function(h){
              var pct=max>0?Math.round(h.value/max*100):0;
              var c=h.value>=60?'bg-success':h.value>=40?'bg-cyan':h.value>=20?'bg-warning':'bg-error';
              return '<div class="flex-1 '+c+' rounded-t opacity-80 hover:opacity-100 transition-opacity" style="height:'+pct+'%;min-height:2px" title="'+h.date+': '+h.value+'"></div>';
            }).join('')+
          '</div>';
        }

        var deps=data.dependencyMap||[];
        var hmEl=document.getElementById('autonomy-heatmap');
        if(hmEl&&deps.length>0){
          hmEl.innerHTML='<table class="w-full text-left"><thead><tr class="text-[11px] uppercase tracking-wider text-muted border-b border-border">'+
            '<th class="py-2 pr-4 font-medium">Domain</th><th class="py-2 px-2 font-medium">Acceptance</th><th class="py-2 px-2 font-medium">Comprehension</th><th class="py-2 pl-2 font-medium">Risk</th></tr></thead><tbody class="divide-y divide-border">'+
            deps.map(function(d){
              var risk=d.acceptanceRate>80&&d.comprehension<40;
              var ac=d.acceptanceRate>80?'bg-error/30 text-error':d.acceptanceRate>60?'bg-warning/20 text-warning':'bg-success/20 text-success';
              var cc=d.comprehension<40?'bg-error/30 text-error':d.comprehension<60?'bg-warning/20 text-warning':'bg-success/20 text-success';
              return '<tr'+(risk?' class="bg-error/5"':'')+'><td class="py-2 pr-4 text-sm text-foreground">'+d.domain+'</td>'+
                '<td class="py-2 px-2"><span class="px-2 py-0.5 rounded text-xs font-mono '+ac+'">'+Math.round(d.acceptanceRate)+'%</span></td>'+
                '<td class="py-2 px-2"><span class="px-2 py-0.5 rounded text-xs font-mono '+cc+'">'+Math.round(d.comprehension)+'%</span></td>'+
                '<td class="py-2 pl-2">'+(risk?'<span class="text-xs text-error font-semibold">⚠ risk</span>':'<span class="text-xs text-muted">ok</span>')+'</td></tr>';
            }).join('')+
          '</tbody></table>';
        }
      }).catch(function(){document.getElementById('autonomy-loading').textContent='Failed to load autonomy data';});
    })();
    </script>
  `);
});

// Sprint 15G: Maturity tab (UF-451)
intelligenceTabRoutes.get("/intelligence/tab/maturity", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";

  return c.html(`
    <div id="maturity-loading" class="text-center py-8 text-muted">Loading maturity data…</div>
    <div id="maturity-content" class="hidden">
      <div class="flex flex-col md:flex-row gap-6 mb-6">
        <div class="flex-1" id="maturity-phase"></div>
        <div class="flex-1" id="maturity-radar"></div>
      </div>
      <div class="mb-6" id="maturity-bottleneck"></div>
      <div class="mb-6" id="maturity-trajectory"></div>
      <div id="maturity-requirements"></div>
    </div>
    <script>
    (function(){
      fetch('/api/intelligence/maturity-assessment${sep}').then(function(r){
        if(r.status===202){document.getElementById('maturity-loading').innerHTML='<p>Maturity assessment is warming up…</p>';return null;}
        return r.json();
      }).then(function(data){
        if(!data||!data.phase)return;
        document.getElementById('maturity-loading').classList.add('hidden');
        document.getElementById('maturity-content').classList.remove('hidden');

        var colors=['var(--muted)','var(--warning)','var(--cyan)','var(--success)'];
        var c=colors[Math.max(0,Math.min(data.phase-1,3))];
        document.getElementById('maturity-phase').innerHTML=
          '<div class="bg-surface border border-border rounded-lg p-5">'+
          '<div class="text-[11px] uppercase tracking-wider text-muted mb-2">Maturity phase</div>'+
          '<div class="font-mono text-4xl font-bold" style="color:'+c+'">Phase '+data.phase+'</div>'+
          '<div class="text-sm text-muted mt-1">'+(data.phaseLabel||'')+'</div>'+
          '<div class="h-1.5 rounded-full bg-raised overflow-hidden mt-3"><div class="h-full rounded-full" style="width:'+Math.round((data.overallScore||0)*100)+'%;background:'+c+'"></div></div>'+
          '</div>';

        var dims=data.dimensions||{};
        var dimNames=['direction','modificationDepth','contextLeverage','promptEffectiveness','domainConsistency','loopResilience','decisionDurability'];
        var radarHtml='<div class="bg-surface border border-border rounded-lg p-5"><div class="text-[11px] uppercase tracking-wider text-muted mb-3">7 dimensions</div><div class="space-y-2">';
        dimNames.forEach(function(d){
          var v=Math.round((dims[d]||0)*100);
          var bc=v>=70?'var(--success)':v>=40?'var(--warning)':'var(--error)';
          radarHtml+='<div class="flex items-center gap-2"><span class="text-xs text-muted w-32 truncate">'+d.replace(/([A-Z])/g,' $1').trim()+'</span>'+
            '<div class="flex-1 bg-raised rounded-full h-1.5 overflow-hidden"><div class="h-full rounded-full" style="width:'+v+'%;background:'+bc+'"></div></div>'+
            '<span class="font-mono text-xs text-muted w-8 text-right">'+v+'</span></div>';
        });
        radarHtml+='</div></div>';
        document.getElementById('maturity-radar').innerHTML=radarHtml;

        if(data.bottleneck){
          document.getElementById('maturity-bottleneck').innerHTML=
            '<div class="bg-warning/10 border border-warning/30 rounded-lg p-4"><div class="text-xs text-warning font-semibold mb-1">Bottleneck</div>'+
            '<div class="text-sm text-foreground">'+data.bottleneck.dimension+' ('+Math.round((data.bottleneck.score||0)*100)+'/100)</div></div>';
        }

        var traj=data.trajectory||[];
        if(traj.length>0){
          document.getElementById('maturity-trajectory').innerHTML=
            '<div class="text-[11px] uppercase tracking-wider text-muted mb-2">Trajectory</div>'+
            '<div class="flex items-end gap-1" style="height:80px">'+traj.map(function(t){
              var pct=Math.round((t.score||0)*100);
              return '<div class="flex-1 bg-accent rounded-t opacity-80" style="height:'+pct+'%;min-height:2px" title="'+t.date+'"></div>';
            }).join('')+'</div>';
        }

        var reqs=data.nextPhaseRequirements||[];
        if(reqs.length>0){
          document.getElementById('maturity-requirements').innerHTML=
            '<div class="text-[11px] uppercase tracking-wider text-muted mb-2">Next phase requirements</div>'+
            '<ul class="space-y-1">'+reqs.map(function(r){
              return '<li class="flex items-center gap-2 text-sm"><span class="'+(r.met?'text-success':'text-muted')+'">'+(r.met?'✓':'○')+'</span><span class="text-foreground">'+r.description+'</span></li>';
            }).join('')+'</ul>';
        }
      }).catch(function(){document.getElementById('maturity-loading').textContent='Failed to load maturity data';});
    })();
    </script>
  `);
});

// Sprint 15G: Git & Expertise tab (UF-452)
intelligenceTabRoutes.get("/intelligence/tab/git-expertise", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";

  return c.html(`
    <div id="gitex-loading" class="text-center py-8 text-muted">Loading git & expertise data…</div>
    <div id="gitex-content" class="hidden">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 class="font-heading text-sm font-semibold mb-3">Expertise ownership</h3>
          <div id="gitex-ownership"></div>
        </div>
        <div>
          <h3 class="font-heading text-sm font-semibold mb-3">File churn ranking</h3>
          <div id="gitex-churn"></div>
        </div>
      </div>
      <div class="mb-6">
        <h3 class="font-heading text-sm font-semibold mb-3">AI-Git correlation</h3>
        <div id="gitex-correlation"></div>
      </div>
    </div>
    <script>
    (function(){
      Promise.all([
        fetch('/api/intelligence/expertise-map${sep}').then(function(r){return r.ok?r.json():null}).catch(function(){return null}),
        fetch('/api/intelligence/file-churn${sep}').then(function(r){return r.ok?r.json():null}).catch(function(){return null}),
        fetch('/api/intelligence/ai-git-links${sep}').then(function(r){return r.ok?r.json():null}).catch(function(){return null})
      ]).then(function(results){
        var expertise=results[0];
        var churn=results[1];
        var links=results[2];
        if(!expertise&&!churn&&!links){document.getElementById('gitex-loading').innerHTML='<p>Git & expertise data is warming up…</p>';return;}
        document.getElementById('gitex-loading').classList.add('hidden');
        document.getElementById('gitex-content').classList.remove('hidden');

        if(expertise&&expertise.files){
          var ownershipColors={deep:'bg-success/20 text-success',familiar:'bg-cyan/20 text-cyan','ai-dependent':'bg-error/20 text-error'};
          document.getElementById('gitex-ownership').innerHTML='<div class="space-y-1">'+
            expertise.files.slice(0,15).map(function(f){
              var oc=ownershipColors[f.ownership]||'bg-raised text-muted';
              return '<div class="flex items-center gap-2 text-xs"><span class="truncate flex-1 font-mono">'+f.path+'</span>'+
                '<span class="px-1.5 py-0.5 rounded '+oc+'">'+(f.ownership||'unknown')+'</span></div>';
            }).join('')+'</div>';
        }

        if(churn&&churn.files){
          document.getElementById('gitex-churn').innerHTML='<div class="space-y-1">'+
            churn.files.slice(0,10).map(function(f){
              var pct=Math.min(100,Math.round((f.churnScore||0)*100));
              return '<div class="flex items-center gap-2 text-xs"><span class="truncate flex-1 font-mono">'+f.path+'</span>'+
                '<div class="w-16 bg-raised rounded-full h-1"><div class="h-full bg-warning rounded-full" style="width:'+pct+'%"></div></div>'+
                '<span class="font-mono text-muted w-8 text-right">'+pct+'</span></div>';
            }).join('')+'</div>';
        }

        if(links&&links.correlations){
          document.getElementById('gitex-correlation').innerHTML='<div class="space-y-2">'+
            links.correlations.slice(0,8).map(function(l){
              return '<div class="flex items-center gap-3 text-xs bg-raised rounded p-2">'+
                '<span class="text-accent">AI</span><span class="text-muted">→</span><span class="text-success">Git</span>'+
                '<span class="flex-1 truncate text-foreground">'+(l.description||l.file||'')+'</span>'+
                '<span class="font-mono text-muted">r='+((l.correlation||0).toFixed(2))+'</span></div>';
            }).join('')+'</div>';
        }
      });
    })();
    </script>
  `);
});

// Sprint 15G: Narratives tab (UF-453)
intelligenceTabRoutes.get("/intelligence/tab/narratives", async (c) => {
  const project = c.req.query("project") ?? "";
  const sep = project ? `?project=${project}` : "";

  return c.html(`
    <div id="narr-loading" class="text-center py-8 text-muted">Loading narratives…</div>
    <div id="narr-content" class="hidden">
      <div id="narr-executive" class="mb-6"></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 class="font-heading text-sm font-semibold mb-3">Active diagnostics</h3>
          <div id="narr-diagnostics" class="space-y-2"></div>
        </div>
        <div>
          <h3 class="font-heading text-sm font-semibold mb-3">Prescriptions</h3>
          <div id="narr-prescriptions" class="space-y-2"></div>
        </div>
      </div>
      <div id="narr-progress"></div>
    </div>
    <script>
    (function(){
      Promise.all([
        fetch('/api/intelligence/narratives${sep}').then(function(r){return r.ok?r.json():null}).catch(function(){return null}),
        fetch('/api/intelligence/maturity-assessment${sep}').then(function(r){return r.ok?r.json():null}).catch(function(){return null})
      ]).then(function(results){
        var narr=results[0];
        var maturity=results[1];
        if(!narr&&!maturity){document.getElementById('narr-loading').innerHTML='<p>Narratives are warming up…</p>';return;}
        document.getElementById('narr-loading').classList.add('hidden');
        document.getElementById('narr-content').classList.remove('hidden');

        var narratives=narr&&narr.narratives?narr.narratives:[];
        var diagnostics=narratives.filter(function(n){return n.type==='diagnostic'||n.severity;});
        var prescriptions=narratives.filter(function(n){return n.type==='prescription'||n.action;});

        if(narratives.length>0&&narratives[0].claim){
          document.getElementById('narr-executive').innerHTML=
            '<div class="bg-surface border border-accent/30 rounded-lg p-5"><div class="text-[11px] uppercase tracking-wider text-accent mb-2">Executive summary</div>'+
            '<p class="text-sm text-foreground">'+narratives[0].claim+'</p></div>';
        }

        var sevColors={critical:'bg-error/20 text-error border-error/30',warning:'bg-warning/20 text-warning border-warning/30',info:'bg-accent/20 text-accent border-accent/30'};
        if(diagnostics.length>0){
          document.getElementById('narr-diagnostics').innerHTML=diagnostics.slice(0,5).map(function(d){
            var sc=sevColors[d.severity]||sevColors.info;
            return '<div class="border rounded-lg p-3 '+sc+'"><div class="text-xs font-semibold mb-1">'+(d.severity||'info').toUpperCase()+'</div>'+
              '<div class="text-sm text-foreground">'+(d.claim||d.headline||'')+'</div></div>';
          }).join('');
        }else{
          document.getElementById('narr-diagnostics').innerHTML='<p class="text-sm text-muted">No active diagnostics</p>';
        }

        if(prescriptions.length>0){
          document.getElementById('narr-prescriptions').innerHTML=prescriptions.slice(0,5).map(function(p){
            return '<div class="bg-surface border border-border rounded-lg p-3"><div class="text-sm text-foreground">'+(p.action||p.claim||'')+'</div>'+
              (p.estimatedImpact?'<div class="text-xs text-accent mt-1">Impact: '+p.estimatedImpact+'</div>':'')+'</div>';
          }).join('');
        }else{
          document.getElementById('narr-prescriptions').innerHTML='<p class="text-sm text-muted">No prescriptions yet</p>';
        }
      });
    })();
    </script>
  `);
});

// Overview tab (for htmx reload — same content as the server-rendered default)
intelligenceTabRoutes.get("/intelligence/tab/overview", (c) => {
  return c.redirect("/intelligence?tab=overview");
});

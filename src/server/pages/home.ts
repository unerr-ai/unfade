// FILE: src/server/pages/home.ts
// UF-303: Home page — the 10-second wow. Hero direction density + KPI strip + insights + quick actions.
// Replaces dashboard.ts. First paint from /api/summary, SSE for live updates.

import { Hono } from "hono";
import {
  iconAlertTriangle,
  iconBarChart,
  iconCalendar,
  iconCards,
  iconTarget,
  iconTrendingUp,
} from "../icons.js";
import { lineageDrillthroughScript } from "./components/lineage-drillthrough.js";
import { layout } from "./layout.js";

export const homePage = new Hono();

homePage.get("/", (c) => {
  const content = `
    <!-- First-run / Loading state -->
    <div id="home-loading" class="text-center py-16 text-muted">
      <div class="font-mono text-5xl font-bold text-accent mb-4">unfade</div>
      <p class="text-sm">Connecting to intelligence layer…</p>
    </div>

    <!-- First-run onboarding -->
    <div id="home-onboarding" class="hidden">
      <div class="bg-surface border border-accent/30 rounded-lg p-8 mb-6 text-center">
        <div class="font-heading text-2xl font-semibold mb-3">Welcome to your reasoning observatory</div>
        <p class="text-muted text-sm mb-4 max-w-lg mx-auto">Unfade captures your AI interactions and surfaces patterns you didn't know were there. Keep working — insights appear as data accumulates.</p>
        <div class="flex items-center justify-center gap-2 mb-4">
          <div class="h-2 rounded-full bg-accent" id="onboard-bar" style="width:0;max-width:200px;transition:width 0.5s"></div>
          <span class="text-xs text-muted" id="onboard-pct">0%</span>
        </div>
        <p class="text-xs text-muted" id="onboard-hint">Waiting for first events…</p>
      </div>
    </div>

    <!-- Main content (shown when data exists) -->
    <div id="home-live" class="hidden">

      <!-- Hero Card -->
      <div class="bg-surface border border-border rounded-lg p-6 mb-6 flex items-center justify-between" style="min-height:140px">
        <div>
          <div class="text-xs text-muted uppercase tracking-wider mb-1">Human-Directed</div>
          <div class="font-mono text-5xl font-bold text-cyan" id="h-direction">—</div>
          <div class="flex items-center gap-2 mt-2">
            <span class="text-sm text-muted" id="h-direction-label"></span>
            <span id="h-trend"></span>
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs text-muted" id="h-freshness"></div>
          <div class="text-xs text-muted mt-1" id="h-confidence"></div>
        </div>
      </div>

      <!-- KPI Strip -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-surface border border-border rounded-lg p-4 text-center">
          <div class="font-mono text-3xl font-bold text-foreground" id="h-events">0</div>
          <div class="text-xs text-muted mt-1">Events (24h)</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-4 text-center">
          <div class="font-mono text-3xl font-bold text-accent" id="h-comprehension">—</div>
          <div class="text-xs text-muted mt-1">Comprehension</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-4 text-center">
          <div class="font-mono text-3xl font-bold text-accent" id="h-domain">—</div>
          <div class="text-xs text-muted mt-1">Top Domain</div>
        </div>
        <div class="bg-surface border border-border rounded-lg p-4 text-center">
          <div class="font-mono text-3xl font-bold text-accent" id="h-cost">—</div>
          <div class="text-xs text-muted mt-1">Cost (est.)</div>
          <div class="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded" style="background:var(--proxy);color:var(--accent)">estimate</div>
        </div>
      </div>

      <!-- Two-column: Insights + Quick Actions -->
      <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">

        <!-- Insight Stream -->
        <div class="bg-surface border border-border rounded-lg p-5">
          <h2 class="font-heading text-lg font-semibold mb-3">Recent Insights</h2>
          <div id="h-insights" class="space-y-2 text-sm text-muted">Loading…</div>
        </div>

        <!-- Quick Actions + Tool Mix -->
        <div class="space-y-4">
          <div class="bg-surface border border-border rounded-lg p-5">
            <h2 class="font-heading text-lg font-semibold mb-3">Quick Actions</h2>
            <div class="space-y-2">
              <a href="/intelligence" class="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline py-1">${iconBarChart({ size: 16 })} Intelligence Hub</a>
              <a href="/coach" class="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline py-1">${iconTarget({ size: 16 })} Prompt Coach</a>
              <a href="/alerts" class="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline py-1">${iconAlertTriangle({ size: 16 })} Alerts & Replays</a>
              <a href="/distill" class="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline py-1">${iconCalendar({ size: 16 })} Latest Distill</a>
              <a href="/cards" class="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline py-1">${iconCards({ size: 16 })} Generate Card</a>
              <a href="/velocity" class="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline py-1">${iconTrendingUp({ size: 16 })} Velocity Trends</a>
            </div>
          </div>
          <div class="bg-surface border border-border rounded-lg p-5">
            <h2 class="font-heading text-lg font-semibold mb-3">Tool Mix</h2>
            <div id="h-tools" class="flex flex-wrap gap-2 text-sm text-muted">—</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Setup Required State -->
    <div id="home-setup" class="hidden">
      <div class="bg-surface border border-warning/30 rounded-lg p-8 text-center">
        <div class="font-heading text-2xl font-semibold mb-3">Setup Required</div>
        <p class="text-muted text-sm mb-4 max-w-lg mx-auto">No LLM provider is configured. Unfade can capture your reasoning patterns but needs an AI provider to generate daily distills and deeper intelligence.</p>
        <a href="/settings" class="inline-block bg-accent text-white px-6 py-2.5 rounded-lg font-medium text-sm no-underline hover:bg-accent-dim transition-colors">Configure LLM Provider</a>
        <p class="text-xs text-muted mt-4">You can also use structured summaries (no AI) — but AI-powered distills are recommended.</p>
      </div>
    </div>

    <!-- Ingesting State -->
    <div id="home-ingesting" class="hidden">
      <div class="bg-surface border border-accent/30 rounded-lg p-8 text-center">
        <div class="font-heading text-2xl font-semibold mb-3">Bootstrapping Reasoning Profile</div>
        <p class="text-muted text-sm mb-4">Ingesting historical data from your repository. This runs in the background.</p>
        <div class="flex items-center justify-center gap-2 mb-2">
          <div class="h-2 w-48 bg-raised rounded-full overflow-hidden"><div class="h-full bg-accent rounded-full transition-all" id="ingest-bar" style="width:0"></div></div>
          <span class="text-xs text-muted" id="ingest-pct">0%</span>
        </div>
        <p class="text-xs text-muted">Keep working — insights will appear as data accumulates.</p>
      </div>
    </div>

    <!-- Stale State Banner -->
    <div id="home-stale" class="hidden mb-4">
      <div class="bg-surface border border-warning/40 rounded-lg px-4 py-3 flex items-center gap-3">
        <span class="text-warning text-sm font-medium">No recent activity</span>
        <span class="text-xs text-muted">Last event was more than 24 hours ago. Resume working to keep your reasoning profile fresh.</span>
      </div>
    </div>

    ${lineageDrillthroughScript()}
    <script>
    (function(){
      var loading=document.getElementById('home-loading');
      var onboarding=document.getElementById('home-onboarding');
      var live=document.getElementById('home-live');
      var setupEl=document.getElementById('home-setup');
      var ingestingEl=document.getElementById('home-ingesting');
      var staleEl=document.getElementById('home-stale');

      // 5-state machine: setup-required → ingesting → calibrating → live → stale
      var currentState='loading';

      function hideAll(){
        loading.classList.add('hidden');
        onboarding.classList.add('hidden');
        live.classList.add('hidden');
        setupEl.classList.add('hidden');
        ingestingEl.classList.add('hidden');
        staleEl.classList.add('hidden');
      }

      function setState(state, data){
        currentState=state;
        hideAll();
        switch(state){
          case 'setup-required': window.location.href='/setup'; return;
          case 'ingesting': ingestingEl.classList.remove('hidden'); break;
          case 'calibrating':
            onboarding.classList.remove('hidden');
            if(data){
              var pct=Math.min(Math.round((data.eventCount24h||0)/5*100),100);
              document.getElementById('onboard-bar').style.width=pct*2+'px';
              document.getElementById('onboard-pct').textContent=pct+'%';
              document.getElementById('onboard-hint').textContent=pct>=100?'Ready — refreshing…':(5-(data.eventCount24h||0))+' more events until first insight';
              if(pct>=100)setTimeout(function(){location.reload();},2000);
            }
            break;
          case 'live': live.classList.remove('hidden'); break;
          case 'stale': live.classList.remove('hidden'); staleEl.classList.remove('hidden'); break;
        }
      }

      function dirLabel(p){if(p>=70)return'You steer confidently';if(p>=50)return'Balanced collaboration';if(p>=30)return'Model-assisted';if(p>0)return'Model-led';return'';}

      function updateLive(s){
        document.getElementById('h-direction').textContent=s.directionDensity24h+'%';
        document.getElementById('h-direction-label').textContent=dirLabel(s.directionDensity24h);
        document.getElementById('h-events').textContent=s.eventCount24h||'0';
        document.getElementById('h-comprehension').textContent=s.comprehensionScore!=null?s.comprehensionScore:'—';
        document.getElementById('h-domain').textContent=s.topDomain||'—';
        if(s.costPerDirectedDecision!=null){
          document.getElementById('h-cost').textContent='$'+s.costPerDirectedDecision.toFixed(2);
        }
        var ago=Math.round((Date.now()-new Date(s.updatedAt).getTime())/1000);
        document.getElementById('h-freshness').textContent='Updated '+(ago<60?ago+'s':Math.round(ago/60)+'m')+' ago';
        document.getElementById('h-confidence').textContent=s.firstRunComplete?'First-run data':'';
        if(s.toolMix&&Object.keys(s.toolMix).length>0){
          document.getElementById('h-tools').innerHTML=Object.entries(s.toolMix).map(function(e){
            return'<span class="bg-raised border border-border rounded px-3 py-1 font-mono text-xs">'+e[0]+' <span class="text-cyan">'+e[1]+'</span></span>';
          }).join('');
        }

        // Determine: stale if last event > 24h
        if(s.updatedAt){
          var ageMs=Date.now()-new Date(s.updatedAt).getTime();
          if(ageMs > 86400000){ setState('stale',s); return; }
        }
        setState('live',s);
      }

      function handleSummary(s){
        if(!s||s.eventCount24h<5){
          setState('calibrating',s);
          return;
        }
        updateLive(s);
      }

      // Server middleware guarantees setup is complete if we reach this page.
      // Go directly to summary check.
      fetch('/api/summary').then(function(r){return r.status===204?null:r.json();}).then(function(d){
        if(d) handleSummary(d); else setState('calibrating',null);
      }).catch(function(){
        setState('calibrating',null);
      });

      // 11E.8: Fetch narrative insights first, fall back to raw insights
      Promise.all([
        fetch('/api/intelligence/narratives').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
        fetch('/api/insights/recent').then(function(r){return r.json();}).catch(function(){return[];})
      ]).then(function(results){
        var narratives=results[0]&&results[0].narratives?results[0].narratives:[];
        var rawInsights=results[1]||[];
        var el=document.getElementById('h-insights');

        // Prefer narratives (causal claims), fall back to raw insights
        if(narratives.length>0){
          el.innerHTML=narratives.slice(-5).reverse().map(function(n){
            var badge='<span class="inline-block text-[10px] px-1.5 py-0.5 rounded mr-1 '+severityClass(n.severity)+'">'+(n.severity||'info')+'</span>';
            var why='<button class="text-xs text-muted hover:text-accent cursor-pointer underline underline-offset-2 bg-transparent border-none p-0 ml-2" onclick="toggleLineage(''+n.id+'','lineage-'+n.id.slice(0,8)+'')">Why? →</button>';
            var lineageDetail='<div class="lineage-detail hidden mt-2 pl-3 border-l-2 border-border" id="lineage-'+n.id.slice(0,8)+'-detail"><div class="text-xs text-muted">Loading…</div></div>';
            return'<div class="py-2 border-b border-border last:border-0">'+badge+'<span class="text-foreground text-sm">'+n.claim+'</span>'+why+lineageDetail+'</div>';
          }).join('');
        } else if(rawInsights.length>0){
          el.innerHTML=rawInsights.slice(-5).reverse().map(function(i){
            return'<div class="py-2 border-b border-border last:border-0 text-foreground text-sm">'+(i.claim||JSON.stringify(i))+'</div>';
          }).join('');
        } else {
          el.innerHTML='<p class="text-muted">No insights yet — keep working.</p>';
        }
      });

      function severityClass(s){
        if(s==='critical')return'bg-red-500/20 text-red-400';
        if(s==='warning')return'bg-yellow-500/20 text-yellow-400';
        return'bg-accent/20 text-accent';
      }

      if(typeof EventSource!=='undefined'){
        var es=new EventSource('/api/stream');
        es.addEventListener('summary',function(e){try{handleSummary(JSON.parse(e.data));}catch(err){}});
        es.addEventListener('health',function(e){
          try{
            var h=JSON.parse(e.data);
            // Update live strip from health events
            var dot=document.getElementById('live-dot');
            var status=document.getElementById('live-status');
            if(h.daemonAlive){dot.classList.remove('stale');status.textContent='Live';}
            else{dot.classList.add('stale');status.textContent='Daemon stopped';}
          }catch(err){}
        });
      }
    })();
    </script>
  `;

  return c.html(layout("Home", content));
});

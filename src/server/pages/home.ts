// FILE: src/server/pages/home.ts
// Enterprise home: inline activation + steady-state activity dashboard. Single SSE path via window.__unfade.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { readSummary } from "../../services/intelligence/summary-writer.js";
import { getStateDir } from "../../utils/paths.js";
import { activationSection } from "../components/system-reveal.js";
import {
  iconAlertTriangle,
  iconBarChart,
  iconCalendar,
  iconCards,
  iconFolder,
  iconTarget,
  iconTrendingUp,
} from "../icons.js";
import { lineageDrillthroughScript } from "./components/lineage-drillthrough.js";
import { escapeHtml, layout } from "./layout.js";

export const homePage = new Hono();

const ACTIVATION_GRACE_MS = 120_000;

homePage.get("/", (c) => {
  const summary = readSummary();
  const warm = !!summary && (summary.eventCount24h >= 5 || summary.firstRunComplete === true);
  let needsActivation = !warm;
  let sessionId = "unknown";
  try {
    const setupPath = join(getStateDir(), "setup-status.json");
    if (existsSync(setupPath)) {
      const setup = JSON.parse(readFileSync(setupPath, "utf-8")) as { initializedAt?: string };
      if (setup.initializedAt) {
        sessionId = setup.initializedAt;
        const initAge = Date.now() - Date.parse(setup.initializedAt);
        if (!Number.isNaN(initAge) && initAge >= 0 && initAge < ACTIVATION_GRACE_MS) {
          needsActivation = true;
        }
      }
    }
  } catch {
    /* keep defaults */
  }
  const sessionAttr = escapeHtml(sessionId);

  const content = `
    <style>
      #home-root { --home-ease: 400ms cubic-bezier(0.16, 1, 0.3, 1); position: relative; }
      #home-root > .home-layer { transition: opacity var(--home-ease), transform var(--home-ease), max-height var(--home-ease), margin var(--home-ease), padding var(--home-ease); overflow: hidden; }
      .home-layer-dash { max-height: 6000px; opacity: 1; transform: translateY(0); }
      .home-layer-act { max-height: 6000px; opacity: 1; transform: translateY(0); }
      .home-mode-activation .home-layer-dash { max-height: 0; opacity: 0; transform: translateY(12px); pointer-events: none; margin-bottom: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; border: none; }
      .home-mode-dashboard .home-layer-act { max-height: 0; opacity: 0; transform: translateY(-12px); pointer-events: none; margin-bottom: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; border: none; }
      .hd-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .hd-dot.ok { background: var(--success); box-shadow: 0 0 0 2px rgba(16,185,129,0.15); }
      .hd-dot.warn { background: var(--warning); animation: hd-p 1.4s cubic-bezier(0.16,1,0.3,1) infinite; }
      .hd-dot.bad { background: var(--error); }
      .hd-dot.muted { background: rgba(255,255,255,0.12); }
      @keyframes hd-p { 0%,100%{opacity:1} 50%{opacity:0.5} }
      .de-row { border-bottom: 1px solid rgba(255,255,255,0.05); padding: 12px 0; display: flex; align-items: baseline; gap: 12px; font-size: 13px; }
      .de-row:last-child { border-bottom: none; }
      .de-src { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; min-width: 44px; font-variant-numeric: tabular-nums; }
      .de-time { font-size: 11px; font-family: 'JetBrains Mono', monospace; color: rgba(250,250,250,0.4); margin-left: auto; font-variant-numeric: tabular-nums; }
      .mk-val { font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
      .mk-lab { font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(250,250,250,0.45); margin-top: 8px; }
    </style>

    <div id="home-root" class="home-mode-${needsActivation ? "activation" : "dashboard"}" data-needs-activation="${needsActivation ? "true" : "false"}" data-session-id="${sessionAttr}">
      <div class="home-layer home-layer-act max-w-[1200px] mx-auto w-full mb-8">
        ${activationSection()}
      </div>

      <div class="home-layer home-layer-dash max-w-[1200px] mx-auto w-full mb-8">
        <div class="bg-surface border border-border rounded-lg px-6 py-3 mb-4 flex flex-wrap items-center gap-6" id="home-health" role="status" aria-label="System health">
          <span class="text-[11px] uppercase tracking-wider text-muted font-medium">System health</span>
          <div class="flex items-center gap-2">
            <span class="hd-dot muted" id="dh-sse"></span>
            <span class="text-[13px] text-muted" id="dh-sse-l">SSE</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="hd-dot muted" id="dh-cap"></span>
            <span class="text-[13px] text-muted" id="dh-cap-l">Capture</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="hd-dot muted" id="dh-mat"></span>
            <span class="text-[13px] text-muted" id="dh-mat-l">Materializer</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="hd-dot muted" id="dh-int"></span>
            <span class="text-[13px] text-muted" id="dh-int-l">Intelligence</span>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-8">
          <div class="bg-surface border border-border rounded-lg p-6 min-h-[320px]">
            <div class="text-[11px] uppercase tracking-wider text-muted font-medium mb-4">Event stream</div>
            <div id="dash-events" class="min-h-[200px]">
              <p id="dash-events-empty" style="color:rgba(250,250,250,0.3);padding:40px 0;text-align:center;font-size:13px">No events captured yet. Start working to see your activity stream.</p>
            </div>
          </div>
          <div class="flex flex-col gap-4">
            <div class="bg-surface border border-border rounded-lg p-6 flex-1">
              <div class="text-[11px] uppercase tracking-wider text-muted font-medium mb-6">Metrics</div>
              <div class="space-y-6">
                <div>
                  <div class="mk-val text-cyan" id="dash-dir">—</div>
                  <div class="mk-lab">Direction (24h)</div>
                </div>
                <div>
                  <div class="mk-val text-foreground" id="dash-ev">—</div>
                  <div class="mk-lab">Events (24h)</div>
                </div>
                <div>
                  <div class="mk-val text-accent" id="dash-comp">—</div>
                  <div class="mk-lab">Comprehension</div>
                </div>
                <div>
                  <div class="mk-val text-accent" id="dash-cost">—</div>
                  <div class="mk-lab">Cost (est.)</div>
                  <div class="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded" style="background:var(--proxy);color:var(--accent)">estimate</div>
                </div>
              </div>
            </div>
            <div class="bg-surface border border-border rounded-lg p-6">
              <div class="text-[11px] uppercase tracking-wider text-muted font-medium mb-4">Quick actions</div>
              <div class="space-y-2">
                <a href="/intelligence" class="flex items-center justify-between text-[13px] text-muted hover:text-foreground no-underline py-2 border-b border-white/5">${iconBarChart({ size: 16 })}<span class="flex-1 ml-2">Intelligence Hub</span><span class="text-muted">→</span></a>
                <a href="/projects" class="flex items-center justify-between text-[13px] text-muted hover:text-foreground no-underline py-2 border-b border-white/5">${iconFolder({ size: 16 })}<span class="flex-1 ml-2">Projects</span><span class="text-muted">→</span></a>
                <a href="/distill" class="flex items-center justify-between text-[13px] text-muted hover:text-foreground no-underline py-2 border-b border-white/5">${iconCalendar({ size: 16 })}<span class="flex-1 ml-2">Distill</span><span class="text-muted">→</span></a>
                <a href="/coach" class="flex items-center justify-between text-[13px] text-muted hover:text-foreground no-underline py-2 border-b border-white/5">${iconTarget({ size: 16 })}<span class="flex-1 ml-2">Coach</span><span class="text-muted">→</span></a>
                <a href="/alerts" class="flex items-center justify-between text-[13px] text-muted hover:text-foreground no-underline py-2 border-b border-white/5">${iconAlertTriangle({ size: 16 })}<span class="flex-1 ml-2">Alerts</span><span class="text-muted">→</span></a>
                <a href="/cards" class="flex items-center justify-between text-[13px] text-muted hover:text-foreground no-underline py-2 border-b border-white/5">${iconCards({ size: 16 })}<span class="flex-1 ml-2">Cards</span><span class="text-muted">→</span></a>
                <a href="/velocity" class="flex items-center justify-between text-[13px] text-muted hover:text-foreground no-underline py-2">${iconTrendingUp({ size: 16 })}<span class="flex-1 ml-2">Velocity</span><span class="text-muted">→</span></a>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-surface border border-border rounded-lg p-6 mb-8">
          <div class="text-[11px] uppercase tracking-wider text-muted font-medium mb-4">Recent narratives</div>
          <div id="dash-insights" class="text-[13px] text-muted">Loading…</div>
        </div>
      </div>
    </div>

    ${lineageDrillthroughScript()}
    <script>
    (function(){
      var LS_KEY = 'unfade-activation-seen';
      var SESS_KEY = 'unfade-session-id';
      var THRESH = 5;

      function syncActivationSession(){
        try {
          var root = document.getElementById('home-root');
          if(!root) return;
          var sid = root.getAttribute('data-session-id') || '';
          var prev = localStorage.getItem(SESS_KEY);
          if(prev !== sid){
            localStorage.removeItem(LS_KEY);
            localStorage.setItem(SESS_KEY, sid);
          }
        } catch(e) {}
      }

      function whenReady(fn){
        if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
      }

      function setDot(el, state){
        if(!el) return;
        el.className = 'hd-dot ' + (state==='ok'?'ok':state==='warn'?'warn':state==='bad'?'bad':'muted');
      }

      function setActDot(id, state){
        var d = document.getElementById('ha-dot-'+id);
        var lab = document.getElementById('ha-st-'+id);
        if(!d) return;
        d.className = 'ua-dot ' + (state==='ready'?'ready':state==='building'?'building':state==='error'?'error':'waiting');
        if(lab){
          lab.textContent = state==='ready'?'Ready':state==='building'?'Starting…':state==='error'?'Error':'Waiting';
          lab.style.color = state==='ready'?'var(--success)':state==='error'?'var(--error)':'rgba(250,250,250,0.5)';
        }
      }

      function makeRowTick(){
        var t0 = Date.now();
        return function(){
          var s = Math.max(0, Math.round((Date.now()-t0)/1000));
          if(s<1) return 'now';
          if(s<60) return s+'s';
          return Math.round(s/60)+'m';
        };
      }

      function setCtx(id, text){
        var el = document.getElementById('ha-ctx-'+id);
        if(el) el.textContent = text;
      }

      function appendEventRow(container, d, tick){
        if(!container) return;
        var emptyEl = document.getElementById(container.id+'-empty');
        if(emptyEl) emptyEl.remove();
        var row = document.createElement('div');
        row.className = container.id==='ha-events' ? 'ua-event' : 'de-row';
        var src = (d.source||'event').replace('ai-session','AI');
        var col = src==='git'?'var(--success)':(src==='AI'||d.source==='ai-session')?'var(--cyan)':'rgba(250,250,250,0.35)';
        var sum = (d.content&&d.content.summary)||'Event captured';
        if(sum.length>64) sum = sum.slice(0,61)+'…';
        var tm = tick();
        if(container.id==='ha-events'){
          row.innerHTML = '<span class="ua-src" style="color:'+col+'">'+src+'</span><span class="ua-body" style="color:rgba(250,250,250,0.7)">'+sum+'</span><span class="ua-mono" style="font-size:11px;color:rgba(250,250,250,0.35);margin-left:auto">'+tm+'</span>';
        } else {
          row.innerHTML = '<span class="de-src" style="color:'+col+'">'+src+'</span><span style="color:rgba(250,250,250,0.8)">'+sum+'</span><span class="de-time">'+tm+'</span>';
        }
        container.appendChild(row);
        while(container.children.length>6) container.removeChild(container.firstChild);
      }

      function setProgress(n){
        var pct = Math.min(Math.round(n/THRESH*100),100);
        var bar = document.getElementById('ha-bar');
        var lbl = document.getElementById('ha-progress-label');
        var cnt = document.getElementById('ha-event-count');
        if(bar) bar.style.width = pct+'%';
        if(lbl) lbl.textContent = Math.min(n,THRESH)+' of '+THRESH+' events toward first insights';
        if(cnt) cnt.textContent = String(n);
      }

      function applySummaryToDashboard(s){
        if(!s) return;
        var dir = document.getElementById('dash-dir');
        var ev = document.getElementById('dash-ev');
        var comp = document.getElementById('dash-comp');
        var cost = document.getElementById('dash-cost');
        if(dir) dir.textContent = (s.directionDensity24h!=null?s.directionDensity24h:'—')+(s.directionDensity24h!=null?'%':'');
        if(ev) ev.textContent = s.eventCount24h!=null?String(s.eventCount24h):'—';
        if(comp) comp.textContent = s.comprehensionScore!=null?s.comprehensionScore:'—';
        if(cost) cost.textContent = s.costPerDirectedDecision!=null?('$'+s.costPerDirectedDecision.toFixed(2)):'—';

        setDot(document.getElementById('dh-sse'), 'ok');
        var dhMat = document.getElementById('dh-mat');
        var dhInt = document.getElementById('dh-int');
        setDot(dhMat, 'ok');
        setDot(dhInt, s.firstRunComplete ? 'ok' : 'warn');
      }

      function syncHealthDash(h){
        var cap = document.getElementById('dh-cap');
        var capL = document.getElementById('dh-cap-l');
        if(h && h.daemonAlive!==undefined){
          setDot(cap, h.daemonAlive?'ok':'bad');
          if(capL) capL.textContent = h.daemonAlive?'Capture':'Capture stopped';
        }
      }

      function transitionToDashboard(){
        var root = document.getElementById('home-root');
        if(!root) return;
        root.classList.remove('home-mode-activation');
        root.classList.add('home-mode-dashboard');
        try { localStorage.setItem(LS_KEY, '1'); } catch(e) {}
      }

      function shouldStartActivation(){
        var root = document.getElementById('home-root');
        if(!root) return false;
        if(root.getAttribute('data-needs-activation')!=='true') return false;
        try { if(localStorage.getItem(LS_KEY)) return false; } catch(e) {}
        return true;
      }

      function wireInsights(){
        Promise.all([
          window.__unfade.fetch('/api/intelligence/narratives').then(function(r){return r.ok?r.json():null}).catch(function(){return null;}),
          window.__unfade.fetch('/api/insights/recent').then(function(r){return r.json();}).catch(function(){return[];})
        ]).then(function(results){
          var narratives = results[0]&&results[0].narratives?results[0].narratives:[];
          var raw = results[1]||[];
          var el = document.getElementById('dash-insights');
          if(!el) return;
          function sevClass(s){
            if(s==='critical') return 'bg-red-500/20 text-red-400';
            if(s==='warning') return 'bg-yellow-500/20 text-yellow-400';
            return 'bg-accent/20 text-accent';
          }
          if(narratives.length>0){
            el.innerHTML = narratives.slice(-5).reverse().map(function(n){
              var badge = '<span class="inline-block text-[10px] px-1.5 py-0.5 rounded mr-1 '+sevClass(n.severity)+'">'+(n.severity||'info')+'</span>';
              var why = '<button type="button" class="text-xs text-muted hover:text-accent cursor-pointer underline underline-offset-2 bg-transparent border-none p-0 ml-2" onclick="toggleLineage(\\''+n.id+'\\',\\'lineage-'+n.id.slice(0,8)+'\\')">Why? →</button>';
              var det = '<div class="lineage-detail hidden mt-2 pl-3 border-l-2 border-border" id="lineage-'+n.id.slice(0,8)+'-detail"><div class="text-xs text-muted">Loading…</div></div>';
              return '<div class="py-3 border-b border-border last:border-0">'+badge+'<span class="text-foreground">'+n.claim+'</span>'+why+det+'</div>';
            }).join('');
          } else if(raw.length>0){
            el.innerHTML = raw.slice(-5).reverse().map(function(i){
              return '<div class="py-3 border-b border-border last:border-0 text-foreground">'+(i.claim||JSON.stringify(i))+'</div>';
            }).join('');
          } else {
            el.innerHTML = '<p class="text-muted">No narratives yet — keep working.</p>';
          }
        });
      }

      whenReady(function(){
        var root = document.getElementById('home-root');
        if(!root) return;

        syncActivationSession();

        if(!shouldStartActivation()){
          root.classList.remove('home-mode-activation');
          root.classList.add('home-mode-dashboard');
        }

        var eventCount = 0;

        var skip = document.getElementById('ha-skip');
        if(skip) skip.addEventListener('click', function(){ transitionToDashboard(); });

        window.__unfade.onHealth.push(function(h){
          syncHealthDash(h);
          if(h && h.daemonAlive){
            setActDot('capture','ready');
            setCtx('sse', 'Connected · uptime '+Math.round(h.uptime||0)+'s');
          } else if(h && h.daemonAlive===false){
            setActDot('capture','error');
          }
        });

        window.__unfade.onSummary.push(function(d){
          setActDot('sse','ready');
          setActDot('mat','ready');
          setCtx('mat', 'Materialized '+(d.eventCount24h||0)+' events into SQLite');
          eventCount = Math.max(eventCount, d.eventCount24h || 0);
          setProgress(eventCount);
          applySummaryToDashboard(d);

          if(eventCount>0 && !document.querySelector('#ha-events .ua-event')){
            var he=document.getElementById('ha-events-empty');
            if(he) he.textContent=eventCount+' events captured. New events appear here in real time.';
          }
          if(eventCount>0 && !document.querySelector('#dash-events .de-row')){
            var de=document.getElementById('dash-events-empty');
            if(de) de.textContent=eventCount+' events captured today. New events appear here in real time.';
          }

          if(d.directionDensity24h>0){
            setCtx('intel', 'Direction: '+d.directionDensity24h+'% | Comprehension: '+(d.comprehensionScore!=null?d.comprehensionScore:'—'));
            var m = document.getElementById('ha-metrics');
            if(m) m.classList.remove('hidden');
            var a = document.getElementById('ha-m-dir'); if(a) a.textContent = d.directionDensity24h+'%';
            var b = document.getElementById('ha-m-comp'); if(b) b.textContent = d.comprehensionScore!=null?d.comprehensionScore:'—';
            var c = document.getElementById('ha-m-ev'); if(c) c.textContent = String(d.eventCount24h||0);
          }

          if(d.firstRunComplete || (d.eventCount24h!=null && d.eventCount24h>=THRESH)){
            setActDot('intel','ready');
            if(root.classList.contains('home-mode-activation')){
              setTimeout(function(){ transitionToDashboard(); }, 600);
            }
          } else {
            setActDot('intel','building');
          }
        });

        window.__unfade.onEvent.push(function(d){
          setActDot('capture','ready');
          setActDot('mat','building');
          var evSrc=(d.source||'event').replace('ai-session','AI');
          var evSum=(d.content&&d.content.summary)||'Event captured';
          if(evSum.length>55) evSum=evSum.slice(0,52)+'…';
          setCtx('capture', evSrc.toUpperCase()+': '+evSum);
          eventCount++;
          setProgress(eventCount);
          var tick = makeRowTick();
          appendEventRow(document.getElementById('ha-events'), d, tick);
          appendEventRow(document.getElementById('dash-events'), d, tick);
        });

        setActDot('sse','building');
        window.__unfade.fetch('/api/summary').then(function(r){ return r.status===204?null:r.json(); }).then(function(s){
          if(s){
            eventCount = s.eventCount24h||0;
            setProgress(eventCount);
            applySummaryToDashboard(s);
            setActDot('sse','ready');
            setActDot('mat','ready');
            if(s.directionDensity24h>0){
              var m = document.getElementById('ha-metrics'); if(m) m.classList.remove('hidden');
              var a = document.getElementById('ha-m-dir'); if(a) a.textContent = s.directionDensity24h+'%';
              var b = document.getElementById('ha-m-comp'); if(b) b.textContent = s.comprehensionScore!=null?s.comprehensionScore:'—';
              var c = document.getElementById('ha-m-ev'); if(c) c.textContent = String(s.eventCount24h||0);
            }
            if(s.firstRunComplete || (s.eventCount24h>=THRESH)){
              setActDot('intel','ready');
              if(root.classList.contains('home-mode-activation')){
                setTimeout(function(){ transitionToDashboard(); }, 400);
              }
            }
          }
        }).catch(function(){});

        wireInsights();

        setTimeout(function(){
          setActDot('sse','ready');
          setActDot('mat','ready');
          if(document.getElementById('ha-dot-capture').classList.contains('waiting')) setActDot('capture','building');
        }, 6000);
      });
    })();
    </script>
  `;

  return c.html(layout("Home", content));
});

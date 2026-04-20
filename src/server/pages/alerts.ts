// FILE: src/server/pages/alerts.ts
// UF-310: Alerts page — blind spots + decision replays with action buttons.
// Max 4 alerts/week. Dismissible with acknowledge/review actions.

import { Hono } from "hono";
import { iconCheck, iconExternalLink, iconEyeOff, iconRefreshCw } from "../icons.js";
import { layout } from "./layout.js";

export const alertsPage = new Hono();

alertsPage.get("/alerts", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-6">Alerts & Replays</h1>
    <p class="text-muted text-sm mb-6">Proactive insights based on sustained patterns. Max 4 per week — quality over noise.</p>

    <div id="alerts-loading" class="text-center py-16 text-muted">Loading…</div>
    <div id="alerts-empty" class="hidden text-center py-16 text-muted">
      <p class="text-lg mb-2">No alerts or replays</p>
      <p class="text-sm">Alerts require 2+ weeks of sustained patterns. Replays need 1+ month of decision history.</p>
    </div>

    <div id="alerts-live" class="hidden">

      <!-- Blind Spots -->
      <div class="mb-8">
        <h2 class="font-heading text-lg font-semibold mb-4 flex items-center gap-2">${iconEyeOff({ size: 20 })} Blind Spots</h2>
        <div id="bs-list" class="space-y-3"></div>
      </div>

      <!-- Decision Replays -->
      <div class="mb-8">
        <h2 class="font-heading text-lg font-semibold mb-4 flex items-center gap-2">${iconRefreshCw({ size: 20 })} Decision Replays</h2>
        <div id="replay-list" class="space-y-3"></div>
      </div>

      <!-- Cap notice -->
      <p class="text-xs text-muted text-center" id="cap-notice"></p>
    </div>

    <script>
    (function(){
      var loading=document.getElementById('alerts-loading');
      var empty=document.getElementById('alerts-empty');
      var live=document.getElementById('alerts-live');
      var checkIcon='${iconCheck({ size: 14 }).replace(/'/g, "\\'")}';
      var linkIcon='${iconExternalLink({ size: 14 }).replace(/'/g, "\\'")}';

      var severityStyles={critical:'border-error bg-error/10',warning:'border-warning bg-warning/10',info:'border-accent bg-accent/10'};

      Promise.all([
        fetch('/api/intelligence/alerts').then(function(r){return r.status===204?null:r.json();}).catch(function(){return null;}),
        fetch('/api/intelligence/replays').then(function(r){return r.status===204?null:r.json();}).catch(function(){return null;})
      ]).then(function(results){
        loading.classList.add('hidden');
        var alertsData=results[0];
        var replaysData=results[1];

        var alerts=(alertsData&&alertsData.alerts)?alertsData.alerts.filter(function(a){return!a.acknowledged;}):[];
        var replays=(replaysData&&replaysData.replays)?replaysData.replays.filter(function(r){return!r.dismissed;}):[];

        if(alerts.length===0&&replays.length===0){empty.classList.remove('hidden');return;}
        live.classList.remove('hidden');

        var bsEl=document.getElementById('bs-list');
        bsEl.innerHTML=alerts.length>0?alerts.map(function(a){
          var cls=severityStyles[a.severity]||severityStyles.info;
          return'<div class="border-l-4 '+cls+' rounded-lg p-4">'+
            '<div class="flex items-start justify-between gap-4">'+
              '<div class="flex-1">'+
                '<div class="font-semibold text-foreground text-sm mb-1">'+a.message+'</div>'+
                '<p class="text-xs text-muted">'+a.detail+'</p>'+
                '<div class="flex items-center gap-3 mt-3 text-xs text-muted">'+
                  '<span>'+a.domain+' · sustained '+a.sustainedWeeks+' weeks</span>'+
                  '<span>metric: '+a.metric+' (threshold: '+a.threshold+')</span>'+
                '</div>'+
              '</div>'+
              '<div class="flex gap-2 flex-shrink-0">'+
                '<button class="flex items-center gap-1 text-xs text-muted hover:text-foreground bg-transparent border border-border rounded-md px-2 py-1 cursor-pointer" style="font:inherit" title="Acknowledge">'+checkIcon+' Ack</button>'+
                '<a href="/comprehension" class="flex items-center gap-1 text-xs text-accent hover:text-accent-dim no-underline border border-border rounded-md px-2 py-1">'+linkIcon+' Review</a>'+
              '</div>'+
            '</div>'+
          '</div>';
        }).join(''):'<p class="text-muted text-sm">No active blind spots</p>';

        var replayEl=document.getElementById('replay-list');
        replayEl.innerHTML=replays.length>0?replays.map(function(r){
          return'<div class="border-l-4 border-accent bg-accent/5 rounded-lg p-4">'+
            '<div class="flex items-start justify-between gap-4">'+
              '<div class="flex-1">'+
                '<div class="font-semibold text-foreground text-sm mb-1">'+r.originalDecision.decision.slice(0,100)+'</div>'+
                '<p class="text-xs text-muted mb-2">'+r.triggerDetail+'</p>'+
                '<div class="flex items-center gap-3 text-xs text-muted">'+
                  '<span>'+r.originalDecision.date+'</span>'+
                  '<span>'+r.triggerReason+'</span>'+
                  '<span>confidence: '+Math.round(r.confidence*100)+'%</span>'+
                '</div>'+
              '</div>'+
              '<div class="flex gap-2 flex-shrink-0">'+
                '<button class="text-xs text-muted hover:text-foreground bg-transparent border border-border rounded-md px-2 py-1 cursor-pointer" style="font:inherit">Still valid</button>'+
                '<button class="text-xs text-accent hover:text-accent-dim bg-transparent border border-accent/30 rounded-md px-2 py-1 cursor-pointer" style="font:inherit">Review</button>'+
              '</div>'+
            '</div>'+
          '</div>';
        }).join(''):'<p class="text-muted text-sm">No pending replays</p>';

        var dismissed=(alertsData?alertsData.alerts.filter(function(a){return a.acknowledged;}).length:0)+
                      (replaysData?replaysData.replays.filter(function(r){return r.dismissed;}).length:0);
        document.getElementById('cap-notice').textContent='Up to 4 alerts/week. Dismissed: '+dismissed+'.';
      });
    })();
    </script>
  `;

  return c.html(layout("Alerts", content));
});

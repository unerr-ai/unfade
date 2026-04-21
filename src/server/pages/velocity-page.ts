// FILE: src/server/pages/velocity-page.ts
// UF-311: Velocity page — overall trend + per-domain sparkline grid.
// Data from /api/intelligence/velocity.

import { Hono } from "hono";
import { iconArrowDown, iconArrowUp, iconMinus } from "../icons.js";
import { layout } from "./layout.js";

export const velocityPage = new Hono();

velocityPage.get("/velocity", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-6">Reasoning Velocity</h1>
    <p class="text-muted text-sm mb-6">How quickly you converge on good decisions per domain — are you getting faster?</p>

    <div id="vel-loading" class="text-center py-16 text-muted">Computing velocity trends…</div>
    <div id="vel-empty" class="hidden text-center py-16 text-muted">
      <p class="text-lg mb-2">Need more longitudinal data</p>
      <p class="text-sm">Velocity trends require 2+ weeks of data with turn counts across multiple sessions.</p>
    </div>

    <div id="vel-live" class="hidden">

      <!-- Overall trend hero -->
      <div class="bg-surface border border-border rounded-lg p-6 mb-6 text-center">
        <div class="text-xs text-muted uppercase tracking-wider mb-1">Overall Reasoning Velocity</div>
        <div class="font-mono text-4xl font-bold" id="vel-overall">—</div>
        <div class="text-sm text-muted mt-2" id="vel-magnitude"></div>
        <div class="text-xs text-muted mt-1" id="vel-points"></div>
      </div>

      <!-- Decision Durability (12C.7) -->
      <div id="dur-section" class="hidden mb-6">
        <h2 class="font-heading text-lg font-semibold mb-4">Decision Durability</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div class="bg-surface border border-border rounded-lg p-4 text-center">
            <div class="text-xs text-muted uppercase tracking-wider mb-1">Held Rate</div>
            <div class="font-mono text-2xl font-bold text-success" id="dur-held-rate">—</div>
          </div>
          <div class="bg-surface border border-border rounded-lg p-4 text-center">
            <div class="text-xs text-muted uppercase tracking-wider mb-1">Total Tracked</div>
            <div class="font-mono text-2xl font-bold" id="dur-total">—</div>
          </div>
          <div class="bg-surface border border-border rounded-lg p-4 text-center">
            <div class="text-xs text-muted uppercase tracking-wider mb-1">Deep Deliberation</div>
            <div class="font-mono text-2xl font-bold" id="dur-deep">—</div>
          </div>
          <div class="bg-surface border border-border rounded-lg p-4 text-center">
            <div class="text-xs text-muted uppercase tracking-wider mb-1">Quick Decisions</div>
            <div class="font-mono text-2xl font-bold" id="dur-quick">—</div>
          </div>
        </div>
        <p class="text-xs text-muted">Decisions that "hold" (files not significantly changed within 4 weeks) vs "revised."</p>
      </div>

      <!-- Per-domain sparkline grid -->
      <h2 class="font-heading text-lg font-semibold mb-4">By Domain</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="vel-domains"></div>
    </div>

    <script>
    (function(){
      var loading=document.getElementById('vel-loading');
      var empty=document.getElementById('vel-empty');
      var live=document.getElementById('vel-live');
      var upIcon='${iconArrowUp({ size: 16 }).replace(/'/g, "\\'")}';
      var downIcon='${iconArrowDown({ size: 16 }).replace(/'/g, "\\'")}';
      var stableIcon='${iconMinus({ size: 16 }).replace(/'/g, "\\'")}';

      fetch('/api/intelligence/velocity').then(function(r){
        if(r.status===202||r.status===204)return null;
        return r.json();
      }).then(function(data){
        loading.classList.add('hidden');
        if(!data||!data.byDomain||Object.keys(data.byDomain).length===0){
          empty.classList.remove('hidden');return;
        }
        live.classList.remove('hidden');

        var trendColor=data.overallTrend==='accelerating'?'text-success':data.overallTrend==='decelerating'?'text-warning':'text-muted';
        document.getElementById('vel-overall').innerHTML='<span class="'+trendColor+'">'+data.overallTrend+'</span>';
        document.getElementById('vel-magnitude').textContent=
          data.overallMagnitude>0?'+'+data.overallMagnitude+'% change':
          data.overallMagnitude<0?data.overallMagnitude+'% change':'No significant change';
        document.getElementById('vel-points').textContent=data.dataPoints+' data points';

        var domainsEl=document.getElementById('vel-domains');
        domainsEl.innerHTML=Object.entries(data.byDomain).map(function(e){
          var domain=e[0],v=e[1];
          var icon=v.trend==='accelerating'?upIcon:v.trend==='decelerating'?downIcon:stableIcon;
          var iconColor=v.trend==='accelerating'?'text-success':v.trend==='decelerating'?'text-warning':'text-muted';
          var changeColor=v.velocityChange<0?'text-success':v.velocityChange>0?'text-warning':'text-muted';
          var changeText=v.velocityChange<0?v.velocityChange+'% faster':v.velocityChange>0?'+'+v.velocityChange+'% slower':'stable';

          // Inline sparkline SVG (simple bar representation)
          var maxTurns=Math.max(v.currentTurnsToAcceptance,v.previousTurnsToAcceptance,1);
          var currW=Math.round(v.currentTurnsToAcceptance/maxTurns*100);
          var prevW=Math.round(v.previousTurnsToAcceptance/maxTurns*100);

          return'<div class="bg-surface border border-border rounded-lg p-4" style="min-height:120px">'+
            '<div class="flex items-center justify-between mb-3">'+
              '<span class="font-heading font-semibold text-foreground">'+domain+'</span>'+
              '<span class="'+iconColor+'">'+icon+'</span>'+
            '</div>'+
            '<div class="space-y-2 mb-3">'+
              '<div class="flex items-center gap-2 text-xs">'+
                '<span class="text-muted w-16">Current</span>'+
                '<div class="flex-1 h-2 rounded-full bg-overlay"><div class="h-2 rounded-full bg-accent" style="width:'+currW+'%"></div></div>'+
                '<span class="font-mono text-foreground w-12 text-right">'+v.currentTurnsToAcceptance+' t</span>'+
              '</div>'+
              '<div class="flex items-center gap-2 text-xs">'+
                '<span class="text-muted w-16">Previous</span>'+
                '<div class="flex-1 h-2 rounded-full bg-overlay"><div class="h-2 rounded-full bg-muted" style="width:'+prevW+'%"></div></div>'+
                '<span class="font-mono text-muted w-12 text-right">'+v.previousTurnsToAcceptance+' t</span>'+
              '</div>'+
            '</div>'+
            '<div class="flex items-center justify-between text-xs">'+
              '<span class="font-semibold '+changeColor+'">'+changeText+'</span>'+
              '<span class="text-muted">'+v.dataPoints+' pts · '+v.trend+'</span>'+
            '</div>'+
          '</div>';
        }).join('');
      }).catch(function(){loading.classList.add('hidden');empty.classList.remove('hidden');});

      // 12C.7: Decision durability section
      fetch('/api/intelligence/decision-durability').then(function(r){
        if(r.status===202||r.status===204||!r.ok)return null;
        return r.json();
      }).then(function(data){
        if(!data||!data.stats||data.stats.totalTracked===0)return;
        document.getElementById('dur-section').classList.remove('hidden');
        document.getElementById('dur-held-rate').textContent=data.stats.heldRate+'%';
        document.getElementById('dur-total').textContent=String(data.stats.totalTracked);
        document.getElementById('dur-deep').textContent=data.stats.deepDeliberationHeldRate!==null?data.stats.deepDeliberationHeldRate+'%':'—';
        document.getElementById('dur-quick').textContent=data.stats.quickDecisionHeldRate!==null?data.stats.quickDecisionHeldRate+'%':'—';
      }).catch(function(){});
    })();
    </script>
  `;

  return c.html(layout("Velocity", content));
});

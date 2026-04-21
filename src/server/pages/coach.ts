// FILE: src/server/pages/coach.ts
// UF-309: Coach page — effective patterns + anti-patterns + clipboard copy as CLAUDE.md rule.
// Data from /api/intelligence/coach (alias for /api/intelligence/prompt-patterns).

import { Hono } from "hono";
import { iconCheck, iconCopy } from "../icons.js";
import { layout } from "./layout.js";

export const coachPage = new Hono();

coachPage.get("/coach", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-6">Prompt Coach</h1>
    <p class="text-muted text-sm mb-6">Domain-specific patterns from your actual AI interactions — not generic advice.</p>

    <div id="coach-loading" class="text-center py-16 text-muted">Analyzing prompt patterns…</div>
    <div id="coach-empty" class="hidden text-center py-16 text-muted">
      <p class="text-lg mb-2">Patterns emerge after ~10 sessions</p>
      <p class="text-sm">Keep working with AI tools — the coach needs enough data to distinguish what works from what doesn't.</p>
    </div>

    <div id="coach-live" class="hidden">

      <!-- Effective Patterns -->
      <div class="mb-8">
        <h2 class="font-heading text-lg font-semibold mb-4 text-success">What works for you</h2>
        <div id="effective-list" class="space-y-3"></div>
      </div>

      <!-- Anti-Patterns -->
      <div class="mb-8">
        <h2 class="font-heading text-lg font-semibold mb-4 text-warning">Opportunities</h2>
        <div id="anti-list" class="space-y-3"></div>
      </div>

      <!-- 11E.9: Narrative Insights -->
      <div class="mb-8 hidden" id="narrative-section">
        <h2 class="font-heading text-lg font-semibold mb-4 text-cyan">Contextual Insights</h2>
        <p class="text-xs text-muted mb-3">Cross-analyzer intelligence — causal patterns detected across your workflow.</p>
        <div id="narrative-list" class="space-y-3"></div>
      </div>

      <p class="text-xs text-muted text-center" id="coach-total"></p>
    </div>

    <script>
    (function(){
      var loading=document.getElementById('coach-loading');
      var empty=document.getElementById('coach-empty');
      var live=document.getElementById('coach-live');
      var copyIcon='${iconCopy({ size: 14 }).replace(/'/g, "\\'")}';
      var checkIcon='${iconCheck({ size: 14 }).replace(/'/g, "\\'")}';

      window.copyRule=function(text,btn){
        var rule='# Unfade Coach Rule\\n> '+text.replace(/"/g,'\\\\"');
        navigator.clipboard.writeText(rule).then(function(){
          btn.innerHTML=checkIcon+' Copied';
          btn.classList.add('text-success');
          setTimeout(function(){btn.innerHTML=copyIcon+' CLAUDE.md';btn.classList.remove('text-success');},2000);
        });
      };

      fetch('/api/intelligence/coach').then(function(r){
        if(r.status===204)return null;
        return r.json();
      }).then(function(data){
        loading.classList.add('hidden');
        if(!data||(!data.effectivePatterns?.length&&!data.antiPatterns?.length)){
          empty.classList.remove('hidden');return;
        }
        live.classList.remove('hidden');

        var effEl=document.getElementById('effective-list');
        effEl.innerHTML=(data.effectivePatterns||[]).map(function(p,i){
          return'<div class="bg-surface border-l-4 border-success rounded-lg p-4">'+
            '<div class="flex items-start justify-between gap-4">'+
              '<div class="flex-1">'+
                '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-success/15 text-success mr-2">'+p.domain+'</span>'+
                '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent">'+Math.round(p.acceptanceRate*100)+'% direction</span>'+
                '<p class="text-sm text-foreground mt-2">'+p.pattern+'</p>'+
                '<p class="text-xs text-muted mt-1">'+p.sampleSize+' sessions analyzed</p>'+
              '</div>'+
              '<button onclick="copyRule(\\''+p.pattern.replace(/'/g,"\\\\'")+'\\''+',this)" class="flex items-center gap-1 text-xs text-muted hover:text-accent bg-transparent border border-border rounded-md px-2 py-1 cursor-pointer whitespace-nowrap" style="font:inherit">'+copyIcon+' CLAUDE.md</button>'+
            '</div>'+
          '</div>';
        }).join('')||'<p class="text-muted text-sm">No effective patterns detected yet.</p>';

        var antiEl=document.getElementById('anti-list');
        antiEl.innerHTML=(data.antiPatterns||[]).map(function(p){
          return'<div class="bg-surface border-l-4 border-warning rounded-lg p-4">'+
            '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-warning/15 text-warning mr-2">'+p.domain+'</span>'+
            '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-error/15 text-error">'+Math.round(p.rejectionRate*100)+'% low direction</span>'+
            '<p class="text-sm text-foreground mt-2">'+p.pattern+'</p>'+
            '<p class="text-xs text-muted mt-2 italic">'+p.suggestion+'</p>'+
          '</div>';
        }).join('')||'<p class="text-muted text-sm">No anti-patterns detected.</p>';

        // 11E.9: Render narrative insights
        if(data.narrativeInsights&&data.narrativeInsights.length>0){
          document.getElementById('narrative-section').classList.remove('hidden');
          var narEl=document.getElementById('narrative-list');
          narEl.innerHTML=data.narrativeInsights.map(function(n){
            var borderColor=n.severity==='critical'?'border-error':n.severity==='warning'?'border-warning':'border-accent';
            var badge=n.severity==='critical'?'bg-error/15 text-error':n.severity==='warning'?'bg-warning/15 text-warning':'bg-accent/15 text-accent';
            return'<div class="bg-surface border-l-4 '+borderColor+' rounded-lg p-4">'+
              '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium '+badge+' mr-2">'+n.severity+'</span>'+
              '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-raised text-muted">'+n.sources.join(' × ')+'</span>'+
              '<p class="text-sm text-foreground mt-2">'+n.claim+'</p>'+
              '<p class="text-xs text-muted mt-1">Confidence: '+Math.round(n.confidence*100)+'%</p>'+
            '</div>';
          }).join('');
        }

        document.getElementById('coach-total').textContent='Based on '+(data.totalPromptsAnalyzed||0)+' analyzed prompts';
      }).catch(function(){loading.classList.add('hidden');empty.classList.remove('hidden');});
    })();
    </script>
  `;

  return c.html(layout("Coach", content));
});

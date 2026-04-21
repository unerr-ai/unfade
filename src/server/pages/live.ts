// FILE: src/server/pages/live.ts
// UF-304: Live page — real-time event stream with system health chips.

import { Hono } from "hono";
import { iconAlertTriangle, iconCheck } from "../icons.js";
import { layout } from "./layout.js";

export const livePage = new Hono();

livePage.get("/live", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-6">Live</h1>

    <!-- System Health Chips -->
    <div class="flex flex-wrap gap-3 mb-6" style="min-height:40px">
      <div class="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 text-xs">
        <span id="chip-daemon-icon">${iconCheck({ size: 14 })}</span>
        <span>Daemon</span>
        <span class="text-muted" id="chip-daemon-detail">checking…</span>
      </div>
      <div class="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 text-xs">
        <span id="chip-materializer-icon">${iconCheck({ size: 14 })}</span>
        <span>Materializer</span>
        <span class="text-muted" id="chip-materializer-detail">checking…</span>
      </div>
      <div class="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 text-xs">
        <span id="chip-sse-icon">${iconCheck({ size: 14 })}</span>
        <span>SSE</span>
        <span class="text-muted" id="chip-sse-detail">connecting…</span>
      </div>
      <div class="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 text-xs">
        <span id="chip-server-icon">${iconCheck({ size: 14 })}</span>
        <span>Server</span>
        <span class="text-muted" id="chip-server-detail">running</span>
      </div>
      <div class="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 text-xs">
        <span id="chip-ingest-icon">${iconCheck({ size: 14 })}</span>
        <span>Ingest</span>
        <span class="text-muted" id="chip-ingest-detail">checking…</span>
      </div>
      <div class="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2 text-xs">
        <span id="chip-intel-icon">${iconCheck({ size: 14 })}</span>
        <span>Intelligence</span>
        <span class="text-muted" id="chip-intel-detail">checking…</span>
      </div>
    </div>

    <!-- Controls bar -->
    <div class="flex items-center gap-3 mb-4 text-xs text-muted">
      <div class="flex gap-1">
        <button class="source-filter px-2 py-1 rounded-md bg-raised border border-border" data-source="all" onclick="setFilter('all')">All</button>
        <button class="source-filter px-2 py-1 rounded-md border border-border" data-source="git" onclick="setFilter('git')">Git</button>
        <button class="source-filter px-2 py-1 rounded-md border border-border" data-source="ai-session" onclick="setFilter('ai-session')">AI</button>
        <button class="source-filter px-2 py-1 rounded-md border border-border" data-source="terminal" onclick="setFilter('terminal')">Terminal</button>
      </div>
      <span class="flex-1"></span>
      <label class="flex items-center gap-1 cursor-pointer">
        <input type="checkbox" id="auto-scroll" checked class="accent-accent">
        Auto-scroll
      </label>
      <span id="event-count" class="font-mono">0 events</span>
    </div>

    <!-- Event stream -->
    <div id="event-stream" class="bg-surface border border-border rounded-lg overflow-y-auto font-mono text-[13px]" style="height:calc(100vh - 340px);min-height:300px">
      <div class="p-4 text-muted text-center" id="stream-empty">Waiting for events…</div>
    </div>

    <script>
    (function(){
      var stream=document.getElementById('event-stream');
      var empty=document.getElementById('stream-empty');
      var countEl=document.getElementById('event-count');
      var autoScroll=document.getElementById('auto-scroll');
      var currentFilter='all';
      var eventCount=0;
      var sseOk='${iconCheck({ size: 14 }).replace(/'/g, "\\'")}';
      var sseWarn='${iconAlertTriangle({ size: 14 }).replace(/'/g, "\\'")}';

      function setChipOk(name,detail){
        document.getElementById('chip-'+name+'-icon').innerHTML=sseOk;
        document.getElementById('chip-'+name+'-icon').style.color='var(--success)';
        document.getElementById('chip-'+name+'-detail').textContent=detail;
      }
      function setChipWarn(name,detail){
        document.getElementById('chip-'+name+'-icon').innerHTML=sseWarn;
        document.getElementById('chip-'+name+'-icon').style.color='var(--warning)';
        document.getElementById('chip-'+name+'-detail').textContent=detail;
      }

      window.setFilter=function(src){
        currentFilter=src;
        document.querySelectorAll('.source-filter').forEach(function(b){
          b.classList.toggle('bg-raised',b.getAttribute('data-source')===src);
        });
        stream.querySelectorAll('.event-row').forEach(function(row){
          row.style.display=(src==='all'||row.getAttribute('data-source')===src)?'':'none';
        });
      };

      function addEvent(ev){
        if(empty)empty.remove();
        empty=null;
        eventCount++;
        countEl.textContent=eventCount+' events';

        var sourceColors={git:'text-success','ai-session':'text-accent',terminal:'text-cyan','mcp-active':'text-accent'};
        var color=sourceColors[ev.source]||'text-muted';
        var ts=ev.timestamp?new Date(ev.timestamp).toLocaleTimeString():'—';
        var display=(currentFilter==='all'||ev.source===currentFilter)?'':'display:none';

        var row=document.createElement('div');
        row.className='event-row flex items-center gap-3 px-4 py-2 border-b border-border hover:bg-raised/50';
        row.setAttribute('data-source',ev.source||'');
        row.style.cssText=display;
        row.innerHTML='<span class="text-muted" style="min-width:80px">'+ts+'</span>'+
          '<span class="'+color+' text-xs font-medium" style="min-width:80px">'+(ev.source||'')+'</span>'+
          '<span class="text-xs px-1.5 py-0.5 rounded bg-raised text-muted" style="min-width:60px">'+(ev.type||'')+'</span>'+
          '<span class="flex-1 truncate text-foreground">'+(ev.summary||ev.content?.summary||'')+'</span>';

        stream.appendChild(row);
        if(autoScroll.checked)stream.scrollTop=stream.scrollHeight;
      }

      fetch('/api/system/health').then(function(r){return r.json();}).then(function(resp){
        var h=resp.data||resp;
        if(h.repoCount!==undefined){
          if(h.repos&&h.repos[0]){
            if(h.repos[0].daemonRunning)setChipOk('daemon','running · '+h.repoCount+' repos');
            else setChipWarn('daemon','not running');
            var lagS=(h.repos[0].materializerLagMs/1000).toFixed(1);
            if(h.repos[0].materializerLagMs<10000)setChipOk('materializer',lagS+'s lag');
            else setChipWarn('materializer',lagS+'s behind');
          }else{
            setChipOk('daemon',h.repoCount+' repos');
          }
        }
        setChipOk('server','pid '+h.pid);
        if(h.ingestStatus){
          if(h.ingestStatus==='complete')setChipOk('ingest','complete');
          else if(h.ingestStatus==='running')setChipWarn('ingest','running…');
          else setChipOk('ingest',h.ingestStatus);
        }else{setChipOk('ingest','idle');}
        if(h.intelligenceReady)setChipOk('intel','active');
        else setChipWarn('intel','warming up');
      }).catch(function(){setChipWarn('server','unreachable');});

      if(typeof EventSource!=='undefined'){
        var es=new EventSource('/api/stream');
        setChipOk('sse','connected');
        es.addEventListener('summary',function(e){
          try{
            var d=JSON.parse(e.data);
            if(d.eventCount24h)countEl.textContent=d.eventCount24h+' events (24h)';
          }catch(err){}
        });
        es.onerror=function(){setChipWarn('sse','reconnecting');};
      }

      fetch('/api/insights/recent').then(function(r){return r.json();}).then(function(items){
        if(!items)return;
        items.forEach(function(i){
          addEvent({source:'intelligence',type:'insight',timestamp:new Date().toISOString(),summary:i.claim||JSON.stringify(i)});
        });
      }).catch(function(){});
    })();
    </script>
  `;

  return c.html(layout("Live", content));
});

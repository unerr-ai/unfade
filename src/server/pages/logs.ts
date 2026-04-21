// FILE: src/server/pages/logs.ts
// Fix 6: System Logs page — real-time, filterable log viewer.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const logsPage = new Hono();

logsPage.get("/logs", (c) => {
  const content = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-heading text-2xl font-bold">System Logs</h1>
      <div class="flex items-center gap-2">
        <label class="text-xs text-muted flex items-center gap-1">
          <input type="checkbox" id="log-autoscroll" checked class="accent-accent">
          Auto-scroll
        </label>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-surface border border-border rounded-lg p-4 mb-4">
      <div class="flex flex-wrap gap-3 items-center">
        <div class="flex gap-1" id="source-filters">
          <button class="log-source-btn active" data-source="all">All</button>
          <button class="log-source-btn" data-source="daemon" style="--src-color:#22D3EE">Daemon</button>
          <button class="log-source-btn" data-source="materializer" style="--src-color:#10B981">Materializer</button>
          <button class="log-source-btn" data-source="intelligence" style="--src-color:#8B5CF6">Intelligence</button>
          <button class="log-source-btn" data-source="server" style="--src-color:#6B7280">Server</button>
          <button class="log-source-btn" data-source="scheduler" style="--src-color:#F59E0B">Scheduler</button>
          <button class="log-source-btn" data-source="ingest" style="--src-color:#F97316">Ingest</button>
        </div>
        <div class="flex gap-1" id="level-filters">
          <button class="log-level-btn" data-level="debug">Debug</button>
          <button class="log-level-btn active" data-level="info">Info</button>
          <button class="log-level-btn" data-level="warn">Warn</button>
          <button class="log-level-btn" data-level="error">Error</button>
        </div>
      </div>
    </div>

    <!-- Log viewer -->
    <div class="bg-substrate border border-border rounded-lg overflow-hidden" style="height:calc(100vh - 320px);min-height:300px">
      <div id="log-viewer" class="overflow-y-auto h-full font-mono text-xs p-4 space-y-0.5">
        <div class="text-muted">Connecting to log stream...</div>
      </div>
    </div>

    <!-- System summary -->
    <div class="bg-surface border border-border rounded-lg p-4 mt-4">
      <div class="flex items-center gap-6 text-xs text-muted" id="log-summary">
        <span>Buffer: <span id="log-buffer-size">0</span> entries</span>
        <span>Stream: <span id="log-stream-status" class="text-success">connecting</span></span>
      </div>
    </div>

    <style>
    .log-source-btn, .log-level-btn {
      padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 500;
      border: 1px solid var(--border-color); background: transparent; color: var(--muted);
      cursor: pointer; transition: all 0.15s;
    }
    .log-source-btn:hover, .log-level-btn:hover { border-color: var(--accent); color: var(--foreground); }
    .log-source-btn.active { background: var(--raised); color: var(--foreground); border-color: var(--accent); }
    .log-level-btn.active { background: var(--raised); color: var(--foreground); border-color: var(--accent); }
    .log-line { display: flex; gap: 8px; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
    .log-line:hover { background: var(--raised); }
    .log-ts { color: var(--muted); flex-shrink: 0; width: 80px; }
    .log-src { flex-shrink: 0; width: 90px; font-weight: 600; }
    .log-src[data-source="daemon"] { color: #22D3EE; }
    .log-src[data-source="materializer"] { color: #10B981; }
    .log-src[data-source="intelligence"] { color: #8B5CF6; }
    .log-src[data-source="server"] { color: #6B7280; }
    .log-src[data-source="scheduler"] { color: #F59E0B; }
    .log-src[data-source="ingest"] { color: #F97316; }
    .log-lvl { flex-shrink: 0; width: 40px; text-transform: uppercase; font-weight: 600; }
    .log-lvl[data-level="debug"] { color: var(--muted); }
    .log-lvl[data-level="info"] { color: var(--foreground); }
    .log-lvl[data-level="warn"] { color: var(--warning); }
    .log-lvl[data-level="error"] { color: var(--error); }
    .log-msg { flex: 1; color: var(--foreground); word-break: break-word; }
    .log-detail { margin-left: 218px; color: var(--muted); white-space: pre-wrap; padding: 2px 0; font-size: 10px; display: none; }
    .log-line.expanded + .log-detail { display: block; }
    </style>

    <script>
    (function(){
      var viewer = document.getElementById('log-viewer');
      var bufferSize = document.getElementById('log-buffer-size');
      var streamStatus = document.getElementById('log-stream-status');
      var autoScroll = document.getElementById('log-autoscroll');
      var activeSource = 'all';
      var activeLevel = 'info';
      var levelMap = {debug:0, info:1, warn:2, error:3};
      var maxLines = 500;

      // Source filter buttons
      document.querySelectorAll('.log-source-btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          document.querySelectorAll('.log-source-btn').forEach(function(b){b.classList.remove('active');});
          btn.classList.add('active');
          activeSource = btn.dataset.source;
          filterVisible();
        });
      });

      // Level filter buttons
      document.querySelectorAll('.log-level-btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          document.querySelectorAll('.log-level-btn').forEach(function(b){b.classList.remove('active');});
          btn.classList.add('active');
          activeLevel = btn.dataset.level;
          filterVisible();
        });
      });

      function filterVisible(){
        var lines = viewer.querySelectorAll('.log-line, .log-detail');
        lines.forEach(function(el){
          if(el.classList.contains('log-detail')){
            // detail visibility handled by expanded class on parent
            return;
          }
          var src = el.dataset.source;
          var lvl = el.dataset.level;
          var show = (activeSource === 'all' || src === activeSource) && levelMap[lvl] >= levelMap[activeLevel];
          el.style.display = show ? '' : 'none';
        });
      }

      function formatTime(iso){
        var d = new Date(iso);
        return d.toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
      }

      function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

      function addEntry(entry){
        var show = (activeSource === 'all' || entry.source === activeSource) && levelMap[entry.level] >= levelMap[activeLevel];
        var line = document.createElement('div');
        line.className = 'log-line';
        line.dataset.source = entry.source;
        line.dataset.level = entry.level;
        if(!show) line.style.display = 'none';
        line.innerHTML = '<span class="log-ts">' + formatTime(entry.timestamp) + '</span>' +
          '<span class="log-src" data-source="'+entry.source+'">' + entry.source + '</span>' +
          '<span class="log-lvl" data-level="'+entry.level+'">' + entry.level + '</span>' +
          '<span class="log-msg">' + escHtml(entry.message) + '</span>';

        if(entry.detail){
          line.style.cursor = 'pointer';
          line.addEventListener('click', function(){ line.classList.toggle('expanded'); });
          var detail = document.createElement('div');
          detail.className = 'log-detail';
          detail.textContent = entry.detail;
          viewer.appendChild(line);
          viewer.appendChild(detail);
        } else {
          viewer.appendChild(line);
        }

        // Trim old lines
        while(viewer.children.length > maxLines * 2){
          viewer.removeChild(viewer.firstChild);
        }

        if(autoScroll.checked){
          viewer.scrollTop = viewer.scrollHeight;
        }
      }

      // Load initial snapshot
      fetch('/api/logs?limit=200&level='+activeLevel).then(function(r){return r.json();}).then(function(d){
        viewer.innerHTML = '';
        if(d.data && d.data.entries){
          bufferSize.textContent = d.data.bufferSize;
          d.data.entries.forEach(addEntry);
        }
      }).catch(function(){
        viewer.innerHTML = '<div class="text-muted">Failed to load logs</div>';
      });

      // SSE stream
      if(typeof EventSource !== 'undefined'){
        var es = new EventSource('/api/logs/stream?level=debug');
        es.addEventListener('log', function(e){
          try{
            var entry = JSON.parse(e.data);
            addEntry(entry);
            bufferSize.textContent = parseInt(bufferSize.textContent)+1;
          }catch(err){}
        });
        es.onopen = function(){ streamStatus.textContent='connected'; streamStatus.className='text-success'; };
        es.onerror = function(){ streamStatus.textContent='reconnecting'; streamStatus.className='text-warning'; };
      }
    })();
    </script>
  `;

  return c.html(layout("Logs", content));
});

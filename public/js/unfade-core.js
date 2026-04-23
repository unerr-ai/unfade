// FILE: public/js/unfade-core.js
// UF-475: Shared client-side state module.
// Single global namespace for SSE, project filtering, and event callbacks.

window.__unfade = {
  sse: null,
  projectId: localStorage.getItem('unfade-project') || '',
  onSummary: [],
  onEvent: [],
  onHealth: [],
  onIntelligence: [],

  fetch: function(path) {
    var sep = path.includes('?') ? '&' : '?';
    var url = this.projectId ? path + sep + 'project=' + this.projectId : path;
    return fetch(url);
  },

  setProject: function(id) {
    this.projectId = id;
    localStorage.setItem('unfade-project', id);
    window.location.search = id ? '?project=' + id : '';
  },

  initSSE: function() {
    if (this.sse || typeof EventSource === 'undefined') return;
    var self = this;
    self.sse = new EventSource('/api/stream');
    var dot = document.getElementById('live-dot');
    var status = document.getElementById('live-status');
    var freshness = document.getElementById('live-freshness');
    var counts = document.getElementById('live-counts');
    if (dot) { dot.classList.remove('stale'); }
    if (status) { status.textContent = 'Live'; }

    self.sse.addEventListener('summary', function(e) {
      try {
        var d = JSON.parse(e.data);
        self.onSummary.forEach(function(cb) { cb(d); });
        var ago = Math.round((Date.now() - new Date(d.updatedAt).getTime()) / 1000);
        if (freshness) freshness.textContent = 'Updated ' + (ago < 60 ? ago + 's' : Math.round(ago / 60) + 'm') + ' ago';
        if (counts) counts.textContent = 'Events (24h): ' + (d.eventCount24h || 0) + ' \u00b7 Direction: ' + (d.directionDensity24h || 0) + '%';
      } catch(err) {}
    });

    self.sse.addEventListener('event', function(e) {
      try { var d = JSON.parse(e.data); self.onEvent.forEach(function(cb) { cb(d); }); } catch(err) {}
    });

    self.sse.addEventListener('health', function(e) {
      try { var d = JSON.parse(e.data); self.onHealth.forEach(function(cb) { cb(d); }); } catch(err) {}
    });

    self.sse.addEventListener('intelligence', function(e) {
      try { var d = JSON.parse(e.data); self.onIntelligence.forEach(function(cb) { cb(d); }); } catch(err) {}
    });

    self.sse.onerror = function() {
      if (dot) dot.classList.add('stale');
      if (status) status.textContent = 'Reconnecting\u2026';
    };
  },

  initProjectSelector: function() {
    var sel = document.getElementById('project-filter');
    if (!sel) return;
    var current = this.projectId || new URLSearchParams(window.location.search).get('project') || '';
    fetch('/api/repos').then(function(r) { return r.json(); }).then(function(repos) {
      if (!repos || !repos.length) return;
      repos.forEach(function(r) {
        var opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.label;
        if (r.id === current) opt.selected = true;
        sel.appendChild(opt);
      });
    }).catch(function() {});
  }
};

// Auto-initialize on load
window.__unfade.initSSE();
window.__unfade.initProjectSelector();

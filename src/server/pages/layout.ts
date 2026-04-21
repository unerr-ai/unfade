// FILE: src/server/pages/layout.ts
// UF-300 (UI): Complete rewrite — Linear-inspired global shell.
// Sidebar (240/56 px) + Live Strip (36 px) + Content (max-w 1200 px) + Evidence Drawer (480 px).
// Exports: layout(), escapeHtml(), markdownToHtml()

import {
  iconAlertTriangle,
  iconBarChart,
  iconBrain,
  iconCalendar,
  iconCards,
  iconChevronLeft,
  iconChevronRight,
  iconDollarSign,
  iconFolder,
  iconHome,
  iconMenu,
  iconMoon,
  iconPlug,
  iconSearch,
  iconSettings,
  iconSun,
  iconTarget,
  iconTerminalSquare,
  iconTrendingUp,
  iconUser,
  iconX,
  iconZap,
} from "../icons.js";

const THEME_VARS = `
:root {
  --canvas: #0A0A0F; --substrate: #0F0F12; --surface: #18181B;
  --raised: #1C1C22; --overlay: #27272A;
  --foreground: #FAFAFA; --muted: rgba(250,250,250,0.6); --border-color: #27272A;
  --accent: #8B5CF6; --accent-dim: #7C3AED; --cyan: #22D3EE;
  --success: #10B981; --warning: #F59E0B; --error: #EF4444;
  --live: #10B981; --stale: #F59E0B; --proxy: rgba(139,92,246,0.25);
}
.light {
  --canvas: #F8F9FA; --substrate: #F4F4F5; --surface: #FFFFFF;
  --raised: #F4F4F5; --overlay: #E4E4E7;
  --foreground: #111118; --muted: rgba(17,17,24,0.6); --border-color: #E4E4E7;
  --accent: #6D28D9; --accent-dim: #5B21B6; --cyan: #0891B2;
  --success: #059669; --warning: #D97706; --error: #DC2626;
  --live: #059669; --stale: #D97706; --proxy: rgba(109,40,217,0.15);
}`;

const BASE_CSS = `
*, *::before, *::after { transition: background-color 0.15s, border-color 0.15s, color 0.15s; box-sizing: border-box; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 3px; }
pre, pre code { background: #0F0F12 !important; color: #FAFAFA !important; }
.sidebar { width: 240px; min-width: 240px; transition: width 0.2s, min-width 0.2s; }
.sidebar.collapsed { width: 56px; min-width: 56px; }
.sidebar.collapsed .nav-label, .sidebar.collapsed .brand-text, .sidebar.collapsed .divider-label { display: none; }
.sidebar.collapsed .nav-item { justify-content: center; padding-left: 0; padding-right: 0; }
.nav-item { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px 0 12px; border-radius: 6px; color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 500; position: relative; }
.nav-item:hover { background: var(--raised); color: var(--foreground); }
.nav-item.active { background: var(--raised); color: var(--foreground); }
.nav-item.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; background: var(--accent); border-radius: 2px; }
.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--live); display: inline-block; }
.live-dot.stale { background: var(--stale); }
.live-strip { height: 36px; background: var(--substrate); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; padding: 0 16px; gap: 16px; font-size: 12px; color: var(--muted); }
.drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 40; display: none; }
.drawer-backdrop.open { display: block; }
.evidence-drawer { position: fixed; top: 0; right: -480px; width: 480px; max-width: 90vw; height: 100vh; background: var(--surface); border-left: 1px solid var(--border-color); box-shadow: -4px 0 24px rgba(0,0,0,0.2); z-index: 50; transition: right 0.2s ease-out; overflow-y: auto; }
.evidence-drawer.open { right: 0; }
.badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; font-weight: 600; background: var(--accent); color: white; }
@media (max-width: 1023px) { .sidebar { width: 56px; min-width: 56px; } .sidebar .nav-label, .sidebar .brand-text, .sidebar .divider-label { display: none; } .sidebar .nav-item { justify-content: center; padding-left: 0; padding-right: 0; } }
@media (max-width: 767px) { .sidebar { display: none; } .sidebar.mobile-open { display: flex; position: fixed; z-index: 30; width: 240px; height: 100vh; } .mobile-menu-btn { display: flex !important; } }
`;

const TAILWIND_CONFIG = `
tailwind.config = {
  darkMode: 'class',
  theme: { extend: {
    colors: { canvas: 'var(--canvas)', substrate: 'var(--substrate)', surface: 'var(--surface)', raised: 'var(--raised)', overlay: 'var(--overlay)', foreground: 'var(--foreground)', muted: 'var(--muted)', border: 'var(--border-color)', accent: 'var(--accent)', 'accent-dim': 'var(--accent-dim)', cyan: 'var(--cyan)', success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)' },
    fontFamily: { heading: ["'Space Grotesk'", 'sans-serif'], body: ["'Inter'", 'sans-serif'], mono: ["'JetBrains Mono'", 'monospace'] },
    borderRadius: { DEFAULT: '8px' },
  }},
};`;

interface NavItem {
  path: string;
  label: string;
  icon: string;
  badge?: string;
}

// 4-layer navigation (Phase 15 §2.3): Observe → Understand → Identity → System
const NAV_OBSERVE: NavItem[] = [
  { path: "/", label: "Home", icon: iconHome() },
  { path: "/projects", label: "Projects", icon: iconFolder() },
  { path: "/live", label: "Live", icon: iconZap() },
  { path: "/distill", label: "Distill", icon: iconCalendar() },
];

const NAV_UNDERSTAND: NavItem[] = [
  { path: "/intelligence", label: "Intelligence", icon: iconBarChart() },
  { path: "/decisions", label: "Decisions", icon: iconSearch() },
  { path: "/coach", label: "Coach", icon: iconTarget() },
];

const NAV_IDENTITY: NavItem[] = [
  { path: "/profile", label: "Profile", icon: iconUser() },
  { path: "/cards", label: "Cards", icon: iconCards() },
];

const NAV_SYSTEM: NavItem[] = [
  { path: "/integrations", label: "Integrations", icon: iconPlug() },
  { path: "/logs", label: "Logs", icon: iconTerminalSquare() },
];

function renderNavItem(item: NavItem): string {
  return `<a href="${item.path}" data-path="${item.path}" class="nav-item">
    <span class="nav-icon" style="flex-shrink:0">${item.icon}</span>
    <span class="nav-label">${item.label}</span>
    ${item.badge ? `<span class="badge nav-label">${item.badge}</span>` : ""}
  </a>`;
}

export interface LayoutOptions {
  alertCount?: number;
  /** Render minimal shell (no sidebar, no live strip) — used for setup/onboarding */
  minimal?: boolean;
}

export function layout(title: string, content: string, options?: LayoutOptions): string {
  if (options?.minimal) {
    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Unfade</title>
  <style>${THEME_VARS}${BASE_CSS}</style>
  <script>(function(){var s=localStorage.getItem('unfade-theme');if(s==='light')document.documentElement.classList.add('light');})();</script>
  <link rel="icon" type="image/svg+xml" href="/public/icon.svg">
  <link rel="icon" type="image/png" href="/public/icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>${TAILWIND_CONFIG}</script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-canvas text-foreground font-body antialiased m-0 p-0 flex items-center justify-center min-h-screen">
  <main class="w-full max-w-[720px] mx-auto px-6 py-8">
    ${content}
  </main>
</body>
</html>`;
  }

  const alertCount = options?.alertCount ?? 0;

  const navObserveHtml = NAV_OBSERVE.map(renderNavItem).join("\n        ");
  const navUnderstandHtml = NAV_UNDERSTAND.map(renderNavItem).join("\n        ");
  const navIdentityHtml = NAV_IDENTITY.map(renderNavItem).join("\n        ");
  const navSystemHtml = NAV_SYSTEM.map(renderNavItem).join("\n        ");
  const _alertBadge = alertCount;

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Unfade</title>
  <style>${THEME_VARS}${BASE_CSS}</style>
  <script>(function(){var s=localStorage.getItem('unfade-theme');if(s==='light')document.documentElement.classList.add('light');})();</script>
  <link rel="icon" type="image/svg+xml" href="/public/icon.svg">
  <link rel="icon" type="image/png" href="/public/icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>${TAILWIND_CONFIG}</script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-canvas text-foreground font-body antialiased m-0 p-0 flex h-screen overflow-hidden">

  <!-- Mobile menu button -->
  <button class="mobile-menu-btn hidden fixed top-2 left-2 z-40 p-2 rounded-md bg-surface border border-border" onclick="document.getElementById('sidebar').classList.toggle('mobile-open')">
    ${iconMenu()}
  </button>

  <!-- Sidebar -->
  <nav id="sidebar" class="sidebar flex flex-col bg-substrate border-r border-border h-screen overflow-y-auto py-4 px-3 flex-shrink-0">
    <div class="flex items-center gap-2 mb-6 px-1">
      <img src="/public/icon.svg" alt="Unfade" width="28" height="28" style="flex-shrink:0">
      <span class="brand-text font-mono font-bold text-lg text-accent">unfade</span>
    </div>

    <div class="flex flex-col gap-0.5 flex-1">
      <div class="divider-label mb-2 px-3 text-[11px] uppercase tracking-wider text-muted font-medium">Observe</div>
      ${navObserveHtml}

      <div class="divider-label mt-4 mb-2 px-3 text-[11px] uppercase tracking-wider text-muted font-medium">Understand</div>
      ${navUnderstandHtml}

      <div class="divider-label mt-4 mb-2 px-3 text-[11px] uppercase tracking-wider text-muted font-medium">Identity</div>
      ${navIdentityHtml}

      <div class="divider-label mt-4 mb-2 px-3 text-[11px] uppercase tracking-wider text-muted font-medium" style="cursor:pointer" onclick="this.nextElementSibling.classList.toggle('hidden')">System ▸</div>
      <div class="hidden">
        ${navSystemHtml}
      </div>
    </div>

    <div class="flex flex-col gap-0.5 mt-auto pt-4 border-t border-border">
      <a href="/settings" data-path="/settings" class="nav-item">
        <span class="nav-icon" style="flex-shrink:0">${iconSettings()}</span>
        <span class="nav-label">Settings</span>
      </a>
      <button onclick="toggleTheme()" class="nav-item w-full text-left border-none bg-transparent cursor-pointer" style="font:inherit;color:inherit">
        <span class="nav-icon" style="flex-shrink:0" id="theme-btn-icon">${iconMoon()}</span>
        <span class="nav-label">Theme</span>
      </button>
      <button onclick="toggleSidebar()" class="nav-item w-full text-left border-none bg-transparent cursor-pointer" style="font:inherit;color:inherit">
        <span class="nav-icon" style="flex-shrink:0" id="collapse-icon">${iconChevronLeft()}</span>
        <span class="nav-label">Collapse</span>
      </button>
    </div>
  </nav>

  <!-- Main area -->
  <div class="flex flex-col flex-1 min-w-0">
    <!-- Live strip -->
    <div class="live-strip flex-shrink-0">
      <span class="live-dot" id="live-dot"></span>
      <span id="live-status">Connecting…</span>
      <span class="mx-3">│</span>
      <select id="project-filter" class="bg-raised border border-border rounded px-2 py-0.5 text-xs text-foreground font-mono" style="max-width:180px" onchange="window.__unfade.setProject(this.value)">
        <option value="">All Projects</option>
      </select>
      <span class="flex-1"></span>
      <span id="live-freshness"></span>
      <span id="live-counts"></span>
    </div>

    <!-- Page content -->
    <main class="flex-1 overflow-y-auto">
      <div class="max-w-[1200px] mx-auto px-6 py-8">
        ${content}
      </div>
    </main>
  </div>

  <!-- Evidence drawer -->
  <div class="drawer-backdrop" id="drawer-backdrop" onclick="closeDrawer()"></div>
  <div class="evidence-drawer" id="evidence-drawer">
    <div class="flex items-center justify-between p-4 border-b border-border" style="height:48px">
      <span class="font-semibold">Evidence</span>
      <button onclick="closeDrawer()" class="text-muted hover:text-foreground bg-transparent border-none cursor-pointer">${iconX()}</button>
    </div>
    <div id="drawer-content" class="p-4"></div>
  </div>

  <script>
  // Active nav
  (function(){var p=location.pathname;document.querySelectorAll('.nav-item[data-path]').forEach(function(a){var dp=a.getAttribute('data-path');if(p===dp||(dp!=='/'&&p.startsWith(dp)))a.classList.add('active');});})();

  // Theme
  function toggleTheme(){var r=document.documentElement,l=r.classList.toggle('light');localStorage.setItem('unfade-theme',l?'light':'dark');document.getElementById('theme-btn-icon').innerHTML=l?'${iconSun().replace(/'/g, "\\'")}':'${iconMoon().replace(/'/g, "\\'")}';};
  (function(){if(document.documentElement.classList.contains('light'))document.getElementById('theme-btn-icon').innerHTML='${iconSun().replace(/'/g, "\\'")}';})();

  // Sidebar collapse
  function toggleSidebar(){var s=document.getElementById('sidebar');s.classList.toggle('collapsed');var c=s.classList.contains('collapsed');localStorage.setItem('unfade-sidebar',c?'collapsed':'expanded');document.getElementById('collapse-icon').innerHTML=c?'${iconChevronRight().replace(/'/g, "\\'")}':'${iconChevronLeft().replace(/'/g, "\\'")}';};
  (function(){if(localStorage.getItem('unfade-sidebar')==='collapsed'){document.getElementById('sidebar').classList.add('collapsed');document.getElementById('collapse-icon').innerHTML='${iconChevronRight().replace(/'/g, "\\'")}'}})();

  // Drawer
  function openDrawer(html){document.getElementById('drawer-content').innerHTML=html;document.getElementById('drawer-backdrop').classList.add('open');document.getElementById('evidence-drawer').classList.add('open');};
  function closeDrawer(){document.getElementById('drawer-backdrop').classList.remove('open');document.getElementById('evidence-drawer').classList.remove('open');};
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer();});

  // Shared client module (Phase 15 §2.9)
  window.__unfade = {
    sse: null,
    projectId: localStorage.getItem('unfade-project') || '',
    onSummary: [],
    onEvent: [],
    onHealth: [],

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
          if (counts) counts.textContent = 'Events (24h): ' + (d.eventCount24h || 0) + ' · Direction: ' + (d.directionDensity24h || 0) + '%';
        } catch(err) {}
      });

      self.sse.addEventListener('event', function(e) {
        try { var d = JSON.parse(e.data); self.onEvent.forEach(function(cb) { cb(d); }); } catch(err) {}
      });

      self.sse.addEventListener('health', function(e) {
        try { var d = JSON.parse(e.data); self.onHealth.forEach(function(cb) { cb(d); }); } catch(err) {}
      });

      self.sse.onerror = function() {
        if (dot) dot.classList.add('stale');
        if (status) status.textContent = 'Reconnecting…';
      };
    }
  };

  // Initialize SSE + populate project selector
  window.__unfade.initSSE();
  (function() {
    var sel = document.getElementById('project-filter');
    var current = window.__unfade.projectId || new URLSearchParams(window.location.search).get('project') || '';
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
  })();
  </script>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  if (text == null || text === "") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let listType: "ul" | "ol" = "ul";

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        out.push("</code></pre>");
        inCodeBlock = false;
      } else {
        if (inList) {
          out.push(listType === "ul" ? "</ul>" : "</ol>");
          inList = false;
        }
        out.push(
          '<pre class="bg-raised border border-border rounded-lg p-4 overflow-x-auto my-3 font-mono text-sm"><code>',
        );
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(escapeHtml(line));
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      continue;
    }

    const hm = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      if (inList) {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      const l = hm[1].length;
      const s = ["", "text-xl", "text-lg", "text-base", "text-sm", "text-sm", "text-sm"];
      out.push(
        `<h${l} class="${s[l]} font-heading font-semibold text-foreground mt-5 mb-2">${inlineMarkdown(hm[2] ?? "")}</h${l}>`,
      );
      continue;
    }
    if (trimmed.startsWith("> ")) {
      if (inList) {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      out.push(
        `<blockquote class="border-l-[3px] border-accent pl-4 my-3 text-muted italic">${inlineMarkdown(trimmed.slice(2))}</blockquote>`,
      );
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList || listType !== "ul") {
        if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
        out.push('<ul class="my-2 ml-6 list-disc">');
        inList = true;
        listType = "ul";
      }
      out.push(`<li class="mb-1">${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList || listType !== "ol") {
        if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
        out.push('<ol class="my-2 ml-6 list-decimal">');
        inList = true;
        listType = "ol";
      }
      out.push(`<li class="mb-1">${inlineMarkdown(trimmed.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }
    if (inList) {
      out.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }
    out.push(`<p class="mb-3">${inlineMarkdown(trimmed)}</p>`);
  }
  if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
  if (inCodeBlock) out.push("</code></pre>");
  return out.join("\n");
}

function inlineMarkdown(text: string): string {
  let r = escapeHtml(text);
  r = r.replace(
    /`([^`]+)`/g,
    '<code class="bg-raised px-1.5 py-0.5 rounded text-sm font-mono">$1</code>',
  );
  r = r.replace(/\*\*(.+?)\*\*/g, "<strong class='text-foreground font-semibold'>$1</strong>");
  r = r.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em class='text-muted'>$1</em>");
  r = r.replace(/_([^_]+)_/g, "<em class='text-muted'>$1</em>");
  return r;
}

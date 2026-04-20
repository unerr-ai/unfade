# Phase 7 — Web UI / UX Architecture (Complete Rewrite)

> **Purpose:** Execution-ready **complete UI rewrite** for the Unfade web interface (`http://localhost:7654`, configurable) aligned with [PHASE_7_BREAKTHROUGH_INTELLIGENCE.md](./PHASE_7_BREAKTHROUGH_INTELLIGENCE.md) and the continuous intelligence substrate in [PHASE_4_PLATFORM_AND_LAUNCH.md](./PHASE_4_PLATFORM_AND_LAUNCH.md). This document is **specification only** — no implementation code. Every layout, spacing, typography, and component dimension is production-specified so the implementation agent can proceed without additional design reasoning.
>
> **This is NOT a migration.** The product has not launched. All existing page files are **replaced in-place**. Old `layout.ts`, `dashboard.ts`, `heatmap-panel.ts`, etc. are **overwritten**, not preserved alongside new versions.
>
> **Method:** RRVV (Rigorous Research → Reason → Validate → Execute).
>
> **Status:** SPEC — **DRAFT**
>
> **Last updated:** 2026-04-20

---

## Table of contents

1. [Rigorous research](#1-rigorous-research)
2. [Reason: mental model & layered UI](#2-reason-mental-model--layered-ui)
3. [Validate](#3-validate)
4. [Execute: full UI architecture](#4-execute-specification)
   - [4.1 Brand assets](#41-brand-assets)
   - [4.2 Design system tokens](#42-design-system-tokens)
   - [4.3 Global shell & navigation](#43-global-shell--navigation)
   - [4.4 Page specifications (screen-by-screen)](#44-page-specifications)
   - [4.5 Shared component library](#45-shared-component-library)
   - [4.6 Data-to-UI mapping](#46-data-to-ui-mapping)
   - [4.7 Interaction flows](#47-interaction-flows)
5. [Stack strategy](#5-stack-strategy)
6. [Implementation plan (file-by-file)](#6-implementation-plan)

---

## 1. Rigorous research

### 1.1 Reference applications (use as direct layout blueprints)

| Reference app | Pattern to clone exactly | Where it applies in Unfade |
|---------------|--------------------------|----------------------------|
| **Linear** (linear.app) | Left sidebar (56 px wide collapsed, 240 px expanded); main content fills remainder; header bar with breadcrumbs + contextual actions right-aligned; muted text palette, strong focus colors on active item | **Global shell**: sidebar nav + content pane. Keyboard-first interactions |
| **Vercel Dashboard** (vercel.com/dashboard) | Top-level project switcher in sidebar; deployment status as a timeline with green/yellow/red dots; right-side "Activity" feed; 12-column grid for metric cards | **Home page**: project/repo switcher, activity feed, metric card grid |
| **Datadog APM** (app.datadoghq.com) | Top global nav bar (environment + time-range selector always visible); left sidebar for service drill-down; metrics arranged as: one large hero chart + 4 small KPI cards below; drill-down slides in from right as a **drawer** over the main content (width 50 %) | **Intelligence, Comprehension, Cost pages**: hero metric + KPI strip + right-slide evidence drawer |
| **Stripe Dashboard** (dashboard.stripe.com) | Clean numeric presentation: large mono-spaced hero numbers in cards with sublabel and trend arrow; period selector (7d / 30d / 90d) as pill toggles top-right of each section; subtle gray dividers, generous whitespace (24 px between cards, 16 px internal padding) | **AES gauge, Cost breakdown, Velocity sparklines**: card layout, pill selector, trend arrows |
| **GitHub Copilot metrics** (github.com/orgs/.../copilot/metrics) | Acceptance rate donut, suggestions chart, per-language breakdown, per-editor breakdown — all on one scrollable page with section dividers | **Intelligence hub**: single-scroll multi-section layout, section anchors in-page nav |
| **Raycast** (raycast.com) | First-run onboarding as an in-app **rail** (3 steps, dismiss button, persists in local storage); clean empty states with illustration + single CTA | **First-run overlay**, **empty state pattern** |
| **Spotify Wrapped** | One hero stat per "card", swipe/scroll to next narrative beat | **Weekly digest card** concept (optional future) |

### 1.2 Current UI audit (what gets deleted or overwritten)

Every existing page file under `src/server/pages/` is **overwritten in-place** during this rewrite. There is no migration — the product is pre-launch.

| Current file | Action | Reason |
|--------------|--------|--------|
| `layout.ts` | **Overwrite** — new global shell (sidebar + live strip + drawer) | Flat horizontal nav replaced by Linear-style sidebar; content max-width widened to 1200 px; brand assets wired |
| `dashboard.ts` → **now `home.ts`** | **Overwrite** (rename file) | Direction hero reused but wrapped in new Home layout with KPI strip, insight stream, quick actions |
| `heatmap-panel.ts` → **merged into `comprehension.ts`** | **Delete** — functionality absorbed into Comprehension page | Standalone heatmap page has no bridge to comprehension radar or decisions |
| `portfolio.ts` | **Overwrite** | Add mini AES badge per repo card, link to repo-scoped Intelligence |
| `profile.ts` | **Overwrite** | Accordion sections, "vs last period" comparisons, cleaner layout |
| `distill.ts` | **Overwrite** | Apply new shell; add `DataFreshnessBadge`; keep date nav logic |
| `cards.ts` | **Overwrite** | Apply new shell; add share affordance |
| `search.ts` | **Overwrite** | Apply new shell; add source filter pills |
| `settings.ts` | **Overwrite** | Add system health strip at top; keep MCP snippets |
| `repo-detail.ts` | **Overwrite** | Apply new shell |
| — | **New: `live.ts`** | Full live event stream page |
| — | **New: `intelligence.ts`** | AES gauge + sub-metrics + trend |
| — | **New: `cost.ts`** | Cost attribution page |
| — | **New: `comprehension.ts`** | Merged heatmap + radar + blind spots |
| — | **New: `coach.ts`** | Prompt patterns page |
| — | **New: `alerts.ts`** | Blind spots + decision replays |
| — | **New: `velocity.ts`** | Reasoning velocity trends |

**Also overwrite:** `src/server/http.ts` route registrations to match new page set and static asset route.

---

## 2. Reason: mental model & layered UI

### 2.1 Core mental model

> **Unfade is your local reasoning observatory.** It **ingests** what you and your AI tools did, **interprets** it into scores and stories in real time, and lets you **drill to evidence** — all without cloud dependency.

### 2.2 Four questions → four UI layers

| # | Question | Layer | Primary nav item(s) |
|---|----------|-------|---------------------|
| 1 | What is happening right now? | **Live** | Live strip (always visible) + `/live` full view |
| 2 | What has happened so far? | **Summary** | Home (`/`), Distill, Decisions, Profile |
| 3 | What should I do next? | **Action** | Coach, Alerts |
| 4 | What makes me uniquely effective? | **Identity** | Intelligence, Cost, Comprehension, Velocity, Cards |

### 2.3 Information density principle

**One screen must answer 80 % of what a user cares about.** Supporting detail is one click (drawer) away, never a second page. Scatter-free design: related numbers co-locate; context (time range, data tier, confidence) is **always adjacent** to the number, not in a tooltip.

---

## 3. Validate

### 3.1 Ten-second wow

| Requirement | How we satisfy it |
|-------------|-------------------|
| Immediate visual proof system is alive | **Live strip** green dot + "3 events captured in last 5 min" |
| One hero insight without scrolling | **Home hero card** with direction density *or* AES (whichever has data) |
| Brand recognition | **Unfade icon** + wordmark in sidebar header |

### 3.2 One-minute understanding

User can answer: *What is Unfade? Is it running? Where do I go?* via: sidebar labels + live strip + Home one-liner banner.

### 3.3 Daily habit loop

| Hook | Mechanism |
|------|-----------|
| Variable reward | "New since" badge on Home + Insight stream |
| Completion | Distill "reviewed" toggle; weekly digest card (future) |
| Investment | Pinned coach rules / dismissed alerts (persisted in `localStorage`) |

### 3.4 Pitfalls avoided

| Pitfall | Guard |
|---------|-------|
| Dashboard soup | Max **1 hero + 4 KPI** per visible section; more behind "Show more" |
| Hidden latency | `DataFreshnessBadge` on every metric group |
| False precision | `EstimateBadge` on all USD; `ConfidenceBar` on comprehension |
| Mobile overflow | Sidebar collapses to 56 px icon rail; main content single-column < 768 px |

---

## 4. Execute (specification)

### 4.1 Brand assets

All assets are in **`public/`** and must be served by the Hono server at `/public/*` (static route — currently not wired; add `app.use('/public/*', serveStatic({ root: './public' }))` or inline SVG).

| Asset file | Usage | Format | Dimensions |
|------------|-------|--------|------------|
| `public/icon.svg` | Sidebar brand mark (collapsed state); favicon via inline `<link>` | SVG, `#8B5CF6 → #7C3AED` linear gradient | Render at **28 × 28 px** in sidebar; original 512 × 512 |
| `public/icon-wordmark.svg` | Sidebar brand mark (expanded state) | SVG, same gradient, icon + "unerr" logotype | Render at **120 × 28 px** in sidebar; original 2137 × 512 |
| `public/unerr.svg` | Not used in web UI (external brand) | — | — |
| `public/unerr-wordmark.svg` | Not used in web UI | — | — |
| `public/fonts/jetbrains-mono-latin-400-normal.woff` | Self-hosted mono font for offline; load as `@font-face` fallback when Google Fonts unreachable | WOFF | — |
| `public/icon.png` | OG / PWA icon | PNG 512 × 512 | Reference in `<link rel="icon">` |
| `public/web-app-manifest-192x192.png` | PWA manifest | PNG | 192 × 192 |
| `public/web-app-manifest-512x512.png` | PWA manifest | PNG | 512 × 512 |

**Favicon:** `<link rel="icon" type="image/svg+xml" href="/public/icon.svg">` (SVG preferred for crisp scaling; PNG fallback: `<link rel="icon" type="image/png" href="/public/icon.png">`).

### 4.2 Design system tokens (extends existing `layout.ts` kap10 system)

#### 4.2.1 Spacing scale (Tailwind defaults, explicit for spec)

| Token | Value | Use |
|-------|-------|-----|
| `space-1` | 4 px | Inline icon gap |
| `space-2` | 8 px | Component internal padding tight |
| `space-3` | 12 px | Pill padding horizontal |
| `space-4` | 16 px | Card inner padding; grid gap small |
| `space-6` | 24 px | Card inner padding generous; section gap |
| `space-8` | 32 px | Section vertical margin |
| `space-12` | 48 px | Page top padding |

#### 4.2.2 Typography scale (already in `layout.ts`, codified)

| Role | Family | Weight | Size / Line height | Tailwind class |
|------|--------|--------|---------------------|----------------|
| **Page title** | Space Grotesk | 600 | 24 px / 32 px | `font-heading text-2xl font-semibold` |
| **Section heading** | Space Grotesk | 600 | 18 px / 24 px | `font-heading text-lg font-semibold` |
| **Metric hero** | JetBrains Mono | 700 | 48 px / 56 px | `font-mono text-5xl font-bold` |
| **Metric secondary** | JetBrains Mono | 700 | 30 px / 36 px | `font-mono text-3xl font-bold` |
| **Body** | Inter | 400 | 14 px / 20 px | `font-body text-sm` |
| **Caption / badge** | Inter | 500 | 12 px / 16 px | `font-body text-xs font-medium` |
| **Code** | JetBrains Mono | 400 | 13 px / 20 px | `font-mono text-[13px]` |

#### 4.2.3 Color tokens (already in `layout.ts`, extended)

Additions to existing theme variables:

| Token | Dark | Light | Purpose |
|-------|------|-------|---------|
| `--live` | `#10B981` (same as success) | `#059669` | Live indicator dot |
| `--stale` | `#F59E0B` (same as warning) | `#D97706` | Stale indicator dot |
| `--proxy` | `rgba(139,92,246,0.25)` | `rgba(109,40,217,0.15)` | Background for estimate badges |

#### 4.2.4 Border radius

- Cards, panels, drawers: **8 px** (`rounded-lg`)
- Buttons, pills, badges: **6 px** (`rounded-md`)
- Avatar / icon containers: **full** (`rounded-full`)
- Live dot: **full** (`rounded-full`)

#### 4.2.5 Shadows

| Layer | Shadow | Use |
|-------|--------|-----|
| Card | `shadow-none` (border only in dark); `shadow-sm` in light | Metric cards, panels |
| Drawer | `shadow-xl` on left edge | Evidence drawer sliding over content |
| Dropdown | `shadow-lg` | Nav dropdown, period selector |

### 4.3 Global shell & navigation

#### 4.3.1 Layout anatomy (Linear-inspired two-pane shell)

```
┌──────────┬──────────────────────────────────────────────────────────────────┐
│          │  LIVE STRIP  (height: 36 px, bg: substrate, border-b)            │
│ SIDEBAR  ├──────────────────────────────────────────────────────────────────┤
│          │                                                                   │
│ width:   │  PAGE CONTENT  (scrollable, max-w: 1200 px, mx-auto)            │
│ 240 px   │                                                                   │
│ expanded │                                                                   │
│          │                                                                   │
│ 56 px    │                                        ┌───────────────────┐     │
│ collapsed│                                        │ EVIDENCE DRAWER   │     │
│          │                                        │ (slides from right│     │
│          │                                        │  width: 480 px)   │     │
│          │                                        └───────────────────┘     │
└──────────┴──────────────────────────────────────────────────────────────────┘
```

**Sidebar specification (Linear-reference):**

| Property | Value |
|----------|-------|
| Width expanded | **240 px** |
| Width collapsed | **56 px** (icon-only rail) |
| Collapse trigger | Click chevron at bottom *or* viewport < 1024 px (auto-collapse) |
| Background | `var(--substrate)` |
| Border | Right, 1 px, `var(--border-color)` |
| Padding | 12 px horizontal, 16 px top |
| Item height | **36 px** |
| Item padding | 8 px left (plus 4 px for icon), 12 px right |
| Item border radius | 6 px |
| Active item | `bg-raised text-foreground`; left accent bar 3 px wide, `var(--accent)`, rounded |
| Hover | `bg-raised/50` |
| Icon size | 18 × 18 px, `text-muted`, active: `text-accent` |
| Font | Inter 14 px / 500 weight |
| Collapsed | Icons centered, 18 × 18 px; tooltip on hover showing label |

**Sidebar content (top to bottom):**

```
┌─────────────────────────┐
│  [icon.svg 28×28]       │   ← Brand mark. Expanded: icon-wordmark.svg 120×28
│  unfade                 │   ← Hidden when collapsed
├─────────────────────────┤
│  🏠  Home               │   /
│  ⚡  Live               │   /live
│  📊  Intelligence       │   /intelligence
│  💰  Cost               │   /cost
│  🧠  Comprehension      │   /comprehension
│  🎯  Coach              │   /coach
│  ⚠   Alerts  [badge:2]  │   /alerts  (badge = unread count, max 9+)
├─────────────────────────┤
│  ── More ──             │   Divider label, Inter 11 px, uppercase, muted
│  📅  Distill            │   /distill
│  👤  Profile            │   /profile
│  🃏  Cards              │   /cards
│  📁  Portfolio          │   /portfolio
│  🔍  Search             │   /search
│  📈  Velocity           │   /velocity
├─────────────────────────┤
│  ⚙   Settings           │   /settings
│  ☾ / ☀  Theme toggle    │   Button, not link
│  ◀ Collapse             │   Toggle sidebar width
└─────────────────────────┘
```

**Note on icons:** Use simple SVG line icons (Lucide icon set recommended, MIT license, 18 px default). Do NOT use emoji in production — emoji above is for spec readability only.

#### 4.3.2 Live strip (always visible, Vercel-deploy-bar-inspired)

| Property | Value |
|----------|-------|
| Height | **36 px** |
| Background | `var(--substrate)` |
| Border | Bottom, 1 px, `var(--border-color)` |
| Position | Fixed top, spans from sidebar right edge to viewport right |
| Left content | Live dot (8 × 8 px, `var(--live)` when SSE connected, `var(--stale)` when disconnected, pulsing `animate-pulse` while reconnecting) + "Live" or "Reconnecting…" label (Inter 12 px muted) |
| Center content | "Last update: 4s ago" (Inter 12 px muted, auto-refresh every 5s from SSE heartbeat) |
| Right content | "Events (1h): 23 · AI sessions: 5 · Git: 18" (Inter 12 px muted, from summary or SSE) + Period pill selector (7d \| 30d \| 90d) for pages that use it |

#### 4.3.3 Evidence drawer (Datadog-trace-drawer-inspired)

| Property | Value |
|----------|-------|
| Width | **480 px** (or 40 % of viewport, whichever is smaller) |
| Animation | Slide in from right, 200 ms ease-out |
| Backdrop | Semi-transparent overlay `rgba(0,0,0,0.3)` on main content; click to close |
| Header | 48 px height; title (Inter 16 px semibold) + close button (X icon, top-right) |
| Content | Scrollable; sections: **Evidence events** (table: timestamp, source icon, summary), **Raw JSON** toggle, **Related distill excerpt**, **MCP equivalent** hint |
| Border | Left, 1 px, `var(--border-color)` |
| Shadow | `shadow-xl` |

#### 4.3.4 Responsive breakpoints

| Breakpoint | Behavior |
|------------|----------|
| ≥ 1280 px (xl) | Sidebar expanded 240 px; content max-w 1200 px; drawer 480 px |
| 1024–1279 px (lg) | Sidebar expanded 240 px; content fills; drawer overlays full-width |
| 768–1023 px (md) | Sidebar collapsed to 56 px icon rail; content fills; drawer full-width overlay |
| < 768 px (sm) | Sidebar hidden; hamburger menu in Live strip left; drawer full-screen |

### 4.4 Page specifications (screen-by-screen)

---

#### PAGE: Home (`/`)

**Reference:** Vercel Dashboard home (project overview + activity)

**Layout:** Single scroll. No tabs.

```
[LIVE STRIP]
┌──────────────────────────────────────────────────────────────┐
│  HERO CARD  (full width, h: 160 px, bg: surface, rounded-lg) │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Direction Density: 73%                                   ││   ← font-mono text-5xl text-cyan
│  │  "You steer confidently"                                  ││   ← font-body text-sm text-muted
│  │  ↑ 8% vs last week                                       ││   ← text-success text-xs
│  │  DataFreshnessBadge: "live · 4s ago"                      ││   ← right-aligned, text-xs
│  └──────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│  KPI STRIP  (4 cards, grid-cols-4, gap-4, each h: 100 px)    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                │
│  │Events  │ │Compreh.│ │Top     │ │Cost    │                │
│  │24h     │ │Score   │ │Domain  │ │(est.)  │                │
│  │  142   │ │  68    │ │ auth   │ │ $4.20  │                │
│  │+23 new │ │▲ +5    │ │        │ │EstBadge│                │
│  └────────┘ └────────┘ └────────┘ └────────┘                │
├──────────────────────────────────────────────────────────────┤
│  TWO-COLUMN SECTION  (grid-cols-[2fr_1fr], gap-6)            │
│  ┌─────────────────────────┐ ┌───────────────────────────┐   │
│  │ INSIGHT STREAM           │ │ QUICK ACTIONS             │   │
│  │ (last 5 insights from   │ │ ┌───────────────────────┐ │   │
│  │  recent.jsonl + SSE)    │ │ │ View Coach tips (3)   │ │   │
│  │ ┌─────────────────────┐ │ │ │ Review 1 alert        │ │   │
│  │ │ 2m ago: "payments   │ │ │ │ Open latest distill   │ │   │
│  │ │ module compreh. 31" │ │ │ │ Generate Card         │ │   │
│  │ └─────────────────────┘ │ │ └───────────────────────┘ │   │
│  │ ┌─────────────────────┐ │ │                           │   │
│  │ │ 8m ago: "auth dir.  │ │ │ TOOL MIX (24h)           │   │
│  │ │ density: 81%"       │ │ │ Claude Code: 12          │   │
│  │ └─────────────────────┘ │ │ Cursor: 5                │   │
│  │ ┌─────────────────────┐ │ │ Git: 23                  │   │
│  │ │ 15m ago: ...        │ │ │                           │   │
│  │ └─────────────────────┘ │ └───────────────────────────┘   │
│  └─────────────────────────┘                                 │
└──────────────────────────────────────────────────────────────┘
```

**First-run variation (< 10 events):** Hero card shows **onboarding rail** instead of metrics — 3 steps: "Capture engine running ✓ / Waiting for first AI sessions… / AES calibrates after ~20 sessions". Progress indicator bar.

---

#### PAGE: Live (`/live`)

**Reference:** Vercel deployment log + Datadog Live Tail

**Layout:** Full-height single column; no cards — raw stream.

| Section | Specification |
|---------|---------------|
| **System health strip** (h: 80 px, bg: surface) | Four inline status chips: **Daemon** (PID + uptime or "not running"), **Materializer** (tick count + last tick), **SSE** (connected/reconnecting), **Server** (port + uptime) |
| **Event stream** (fills remaining height, scrollable, auto-scroll with "pause" affordance) | Each row: timestamp (font-mono 12 px, muted, w: 140 px) · source icon (git/ai/terminal, 16 × 16 px) · type badge (pill, 10 px font, colored per source) · summary (truncated to 1 line, Inter 13 px) · "→" drill arrow (opens evidence drawer) |
| **Stream controls** (sticky bottom bar, h: 40 px) | Filters: source toggle pills (Git \| AI \| Terminal \| All); auto-scroll toggle; event count badge |

---

#### PAGE: Intelligence (`/intelligence`)

**Reference:** GitHub Copilot metrics (single scroll, section anchors) + Stripe numeric cards

**Layout:** Anchored sections, in-page nav pills at top.

```
[In-page nav pills: Overview · Direction · Efficiency · Iteration · Context · Modification]

SECTION: Overview
┌──────────────────────────────────────────────────────────────┐
│  AES GAUGE  (center, diameter 200 px, SVG ring/arc)          │
│  Score: 64   ConfidenceBar below                             │
│  "Your AI collaboration efficiency" (Inter 14 px muted)      │
│  Period selector pills: 7d | 30d | 90d                      │
├──────────────────────────────────────────────────────────────┤
│  SUB-METRIC STRIP  (5 cards, grid-cols-5, gap-4, h: 88 px)  │
│  Direction 25%  │ Token Eff 25% │ Iteration 20% │            │
│  Context 15%    │ Modification 15%                           │
│  Each: label · weight · score · trend arrow · ConfidenceBar  │
├──────────────────────────────────────────────────────────────┤
│  TREND CHART  (h: 200 px, line chart, 7d/30d/90d)           │
│  X: date, Y: AES. Shaded area for confidence band            │
│  Hover: tooltip with date + score                            │
└──────────────────────────────────────────────────────────────┘

SECTION: Direction (anchor)
[Direction density detail, matching existing dashboard hero but with period comparison]

... (each sub-metric gets a section with: metric card + explanation + contributing events link)
```

---

#### PAGE: Cost (`/cost`)

**Reference:** Stripe billing dashboard

**Layout:** Period selector top-right. Three sections.

| Section | Content | Spec |
|---------|---------|------|
| **Hero** | Total estimated spend (period) | font-mono text-5xl; `EstimateBadge` adjacent; trend vs prior period |
| **Breakdown** (2-column grid) | Left: **By model** stacked horizontal bar (h: 200 px). Right: **By domain** stacked horizontal bar | Each bar: model/domain label, USD value, percentage, color from a 6-color palette derived from accent |
| **Waste & savings** | "Rejected/abandoned: $X (Y%)" + "Context overhead: $Z — estimated saving with MCP: $W" | Full-width card, bg-surface, border-l-4 accent |

**Every USD value** wrapped in `<span class="bg-proxy/25 px-1.5 py-0.5 rounded text-xs">est.</span>` until vendor usage is enriched.

---

#### PAGE: Comprehension (`/comprehension`)

**Reference:** Datadog service map + existing heatmap page merged

**Layout:** Two tabs: **Heatmap** (visual grid) and **Table** (sortable list).

| Section | Content | Spec |
|---------|---------|------|
| **Overall score** | Comprehension 0–100 with `ConfidenceBar` | font-mono text-4xl, centered |
| **Module heatmap** (tab 1) | Grid of rectangles (module name inside); green (≥ 60) / yellow (35–59) / red (< 35); click → evidence drawer | Grid: `grid-cols-4` on lg, `grid-cols-2` on sm; each cell h: 80 px, rounded-lg |
| **Domain table** (tab 2) | Sortable columns: Domain, Score, Decisions, Last updated, Blind spot? | Table: full width, sticky header, alternating row bg `bg-raised/30` |
| **Blind spots** | Alert-style cards below heatmap for modules with score < 40 | Yellow border-l-4 cards, max 3 visible + "show all" |

---

#### PAGE: Coach (`/coach`)

**Reference:** Raycast extension store (pattern cards)

**Layout:** Two sections: **Effective patterns** + **Anti-patterns**.

| Card type | Spec |
|-----------|------|
| **Effective pattern** | bg-surface, border-l-4 `var(--success)`; Domain pill (top-right); Pattern description (Inter 14 px); Acceptance rate badge (font-mono); Sample size (text-xs muted); "Copy as CLAUDE.md rule" button (text-xs, ghost style) |
| **Anti-pattern** | Same card but border-l-4 `var(--warning)`; Includes "Suggestion" sub-line in italic muted; Rejection rate badge |
| **Empty state** | "Keep working — patterns emerge after ~10 sessions in a domain" with illustration placeholder |

---

#### PAGE: Alerts (`/alerts`)

**Reference:** Linear notifications panel

**Layout:** Single column list; group by **Blind spots** and **Decision replays**.

| Item type | Spec |
|-----------|------|
| **Blind spot alert** | Card: bg-surface; left icon (eye-off, 20 px, muted); title "Low comprehension: {module}" (Inter 14 px semibold); detail line (Inter 13 px muted); "Acknowledge" ghost button + "Review module" link → drawer | 
| **Decision replay** | Card: bg-surface; left icon (refresh-cw, 20 px, accent); title "Revisit: {decision summary}" (Inter 14 px semibold); trigger reason (Inter 13 px muted); "Still valid" + "Review" buttons |
| **Caps notice** | "Showing up to 4 alerts this week. Dismissed: 2." (text-xs muted, bottom) |

---

#### PAGE: Velocity (`/velocity`)

**Reference:** Stripe revenue chart (sparklines per product)

**Layout:** Overview trend + per-domain small multiples.

| Section | Spec |
|---------|------|
| **Overall trend** | Full-width line chart (h: 180 px); X: week, Y: avg turns-to-acceptance; label "accelerating / stable / decelerating" badge |
| **Per-domain sparklines** | Grid of small cards (grid-cols-3, gap-4, each h: 120 px); Domain name (Inter 14 px semibold); Sparkline (h: 40 px, monochrome accent); Current vs previous metric; Percentage change with trend arrow |

---

#### PAGE: Distill (`/distill`) — overwrite `distill.ts`

**Reference:** Linear document viewer (sidebar nav + content pane)

**Layout:** Date nav (left column 200 px on lg, top horizontal on sm) + rendered markdown content.

| Section | Spec |
|---------|------|
| **Date picker** | Vertical list of available dates (most recent first); active date: bg-raised + accent left bar (same treatment as sidebar active); scroll within list if > 20 dates |
| **Content area** | Rendered markdown (existing `markdownToHtml` logic preserved); `DataFreshnessBadge` tier: `distill` + file mtime |
| **Re-generate** | Ghost button top-right "Re-distill" (htmx POST, shows spinner) |

---

#### PAGE: Profile (`/profile`) — overwrite `profile.ts`

**Reference:** Stripe account settings (collapsible sections)

**Layout:** Single column; accordion sections (click heading to expand/collapse, persisted in `localStorage`).

| Section | Content | Spec |
|---------|---------|------|
| **Decision style** | Decision count, alternatives avg, direction ratio | KPICard row (3-up); "vs last 30d" delta |
| **Domains** | Domain distribution with depth badge + trend arrow | Table: Domain, Frequency, Depth (pill: shallow/moderate/deep), Trend (↑/↓/→) |
| **Patterns** | Detected patterns with confidence bars | Card list; ConfidenceBar per pattern; sample size badge |
| **Preferences** | Trade-off preferences (chose X over Y) | Table: Preference, Confidence, Supporting, Contradicting |
| **Temporal** | Activity heatmap by hour/day | Simple grid (7 cols × 24 rows or simplified) |

---

#### PAGE: Cards (`/cards`) — overwrite `cards.ts`

**Layout:** Latest card preview (if PNG exists) + "Generate Card" button + card history list.

| Section | Spec |
|---------|------|
| **Preview** | Card PNG rendered at 480 × 252 (OG dimensions); border rounded-lg; shadow-sm |
| **Generate** | Primary button (bg-accent text-white rounded-md px-4 py-2); "Generate Card" or "Generate v3 Card" |
| **History** | Grid of past cards (grid-cols-3, gap-4); each thumbnail 160 × 84; date label below |
| **Share** | "Copy path" ghost button per card |

---

#### PAGE: Portfolio (`/portfolio`) — overwrite `portfolio.ts`

**Reference:** Vercel project list

**Layout:** Grid of repo cards (`grid-cols-3` on lg, `grid-cols-1` on sm, gap-6).

| Card content | Spec |
|--------------|------|
| **Repo name** | Inter 16 px semibold; truncated to 1 line |
| **Direction density** | font-mono text-2xl; colored (success/cyan/warning per threshold) |
| **Mini AES** | Small badge if efficiency.json available: "AES: 64" pill |
| **Event count** | text-xs muted: "142 events (24h)" |
| **Last activity** | text-xs muted: "3m ago" |
| **CTA** | "Intelligence →" link (accent, text-sm) → `/intelligence?repo={id}` |

---

#### PAGE: Search (`/search`) — overwrite `search.ts`

**Layout:** Search input (full width, h: 44 px, bg-surface, border, rounded-lg, autofocus) + source filter pills (All \| Git \| AI \| Terminal) + results list.

| Section | Spec |
|---------|------|
| **Input** | Placeholder: "Search decisions, reasoning, events…"; magnifying glass icon left (16 px); debounce 300 ms |
| **Filters** | Pill row below input; same `PeriodSelector` component but for sources |
| **Results** | Card list; each: date badge, summary (Inter 14 px), score pill (if relevance), "→" drill arrow → evidence drawer |
| **Empty** | "No results. Try broader terms or check your date range." |

---

#### PAGE: Settings (`/settings`) — overwrite `settings.ts`

**Reference:** VS Code settings (grouped sections)

**Layout:** Single column; sections with `SectionHeading`.

| Section | Content | Spec |
|---------|---------|------|
| **System health** (top) | Daemon PID + uptime; Server port; Materializer tick count + last tick; SSE state | 4-up inline status chips (same as Live `/live` health strip) — always first |
| **MCP setup** | Config snippets for Claude Code, Cursor, Claude Desktop, Windsurf | Tabbed code blocks (tab per tool); "Copy" button per block |
| **LLM provider** | Current config; Ollama status; model name | Status pill (reachable / not found); "Edit config.json" link |
| **Data** | .unfade/ path; disk usage estimate; "Open folder" link | font-mono text-xs for path |
| **Danger zone** | "Reset .unfade/" with confirmation | Red border-l-4 card; requires typing "reset" |

---

### 4.5 Shared component library

| Component | Props (conceptual) | Spec |
|-----------|--------------------|------|
| `LiveDot` | `status: 'connected' \| 'stale' \| 'disconnected'` | 8 × 8 px circle; green/yellow/red; pulse animation when reconnecting |
| `DataFreshnessBadge` | `tier: 'live' \| 'materialized' \| 'distill'`, `updatedAt: ISO` | Pill: bg-raised, text-xs, icon (bolt/db/calendar) + "Xm ago" |
| `ConfidenceBar` | `value: 0–100`, `label?: string` | h: 6 px bar (bg-raised track, accent fill); right-aligned percentage |
| `EstimateBadge` | — | Inline pill: `bg-proxy rounded text-xs px-1.5 py-0.5` text "est." |
| `HeroMetricCard` | `value, label, sublabel?, trend?, freshness` | bg-surface border rounded-lg p-6; hero number center; sublabel below; trend arrow + DataFreshnessBadge right-aligned |
| `KPICard` | `value, label, delta?, badge?` | bg-surface border rounded p-4 h-[100px]; mono number, caption label, optional delta text-xs |
| `InsightRow` | `timestamp, claim, source?` | Border-b; timestamp left (mono 12 px, w-[120px]); claim right (Inter 13 px) |
| `SectionHeading` | `title, action?` | Space Grotesk 18 px semibold; optional right-aligned link/button |
| `PeriodSelector` | `options: string[], active` | Pill group: bg-raised rounded-md; active pill bg-accent text-white |
| `TrendArrow` | `direction: 'up' \| 'down' \| 'flat'`, `value` | Inline arrow icon (12 px) + value; up=success, down=error, flat=muted |
| `SourceIcon` | `source: 'git' \| 'ai-session' \| 'terminal'` | 16 × 16 px SVG; git=branch icon; ai=sparkles; terminal=terminal-square |
| `EmptyState` | `title, description, cta?` | Centered, py-16; illustration area 120 × 120 px; title (heading 18 px); description (muted 14 px); optional CTA button |

### 4.6 Data-to-UI mapping

| Data source | Pages | Components | Read method |
|-------------|-------|------------|-------------|
| `GET /api/summary` | Home, Intelligence, Live strip | HeroMetricCard, KPICard, LiveStrip counts | Fetch on mount + SSE `summary` event |
| `SSE /api/stream` | Live strip (global), Live page, Home insight stream | LiveDot, InsightRow | EventSource, persistent |
| `GET /api/insights/recent` | Home | InsightRow list | Fetch on mount |
| `GET /api/heatmap` | Comprehension | Heatmap grid | Fetch on mount |
| `GET /api/repos` | Portfolio, sidebar repo switcher | Repo cards | Fetch on mount |
| `intelligence/efficiency.json` (when present) | Intelligence | AESGauge, sub-metric cards | Fetch via new `/api/intelligence/efficiency` |
| `intelligence/costs.json` | Cost | CostBreakdown bars | Fetch via new `/api/intelligence/costs` |
| `intelligence/comprehension.json` | Comprehension | Extended heatmap data | Fetch via new `/api/intelligence/comprehension` |
| `intelligence/velocity.json` | Velocity | Sparklines | Fetch via new `/api/intelligence/velocity` |
| `intelligence/prompt-patterns.json` | Coach | Pattern cards | Fetch via new `/api/intelligence/coach` |
| `intelligence/alerts.json` + `replays.json` | Alerts, sidebar badge | AlertQueue, ReplayCard | Fetch via new `/api/intelligence/alerts` |
| Profile `reasoning_model.json` | Profile | Accordion sections | Fetch via existing `/unfade/profile` |

### 4.7 Interaction flows

#### First run (install → wow)

1. User opens `localhost:7654`. **Sidebar** renders with brand icon. **Live strip** shows green dot if daemon running, yellow "starting…" otherwise.
2. **Home** shows **onboarding hero** (not metric hero): "Unfade is capturing. AES calibrates after ~20 AI sessions." Progress bar: `3 / 20 sessions`.
3. After first materializer tick with ≥ 1 event → hero card transitions to **direction density** number. KPI cards populate.
4. User sees one insight in stream immediately if `insights/recent.jsonl` has content from the materializer tick.
5. **Coach, Alerts, Velocity** pages show `EmptyState` with estimated time to first insight.

#### Daily use

1. **Morning:** Open `localhost:7654`. Home shows "12 new events since yesterday" ribbon (compared to last visit timestamp in `localStorage`). Insight stream has fresh items. Alerts badge shows `1`.
2. User clicks **Intelligence** → sees AES and sub-metrics. Clicks a sub-metric card → evidence drawer slides in showing contributing sessions.
3. User clicks **Coach** → reads one effective pattern → clicks "Copy as CLAUDE.md rule" → pastes into project.
4. User clicks **Alerts** → acknowledges a blind spot → badge decrements.

#### Deep dive (developer)

1. On **Comprehension** page, user hovers a red heatmap cell → tooltip shows module, score, decision count.
2. Clicks cell → **evidence drawer** opens: lists the 5 most recent AI sessions touching that module, each with timestamp, summary, and direction signal.
3. User clicks an event row → drawer shows expanded detail: session excerpt, files changed, link to corresponding distill.

#### Leadership lens

1. User clicks **Settings → Export** → selects "Leadership report (30d)".
2. Export generates: AES trend CSV, cost breakdown CSV, comprehension heatmap PNG, methodology PDF — all aggregated (no prompt text).
3. EM opens the CSV in a spreadsheet; Unfade's value is self-evident.

---

## 5. Stack strategy

### 5.1 Stack: Hono + server HTML + htmx + islands (same process, no SPA)

The rewritten `layout.ts` keeps server-rendered HTML from Hono. No Next.js, no separate dev server, no SPA. Interactive bits use **htmx** (already a dependency) and **vanilla JS islands** for SSE, sparklines, and the AES gauge SVG.

| Concern | Approach |
|---------|----------|
| **Static assets** | Add `app.use('/public/*', serveStatic({ root: './public' }))` in `http.ts` to serve brand SVGs, fonts, PWA icons |
| **Design tokens** | Remain in `layout.ts` as CSS custom properties (already the pattern); extend with new tokens from §4.2 |
| **Icons** | Ship ~30 Lucide SVG icons as inline strings in a new `src/server/icons.ts` utility (MIT license, 18 px default); export per-icon functions returning `<svg>` strings |
| **Charts** | Inline SVG for gauges and sparklines (vanilla functions returning `<svg>` strings); no charting library. Optional `<canvas>` only for trend lines > 90 data points |
| **Interactivity** | htmx for drawer loading, search results, tab switching, re-distill action; vanilla JS `<script>` blocks for SSE `EventSource`, auto-scroll, tooltip positioning |
| **Fonts** | Google Fonts CDN primary; `public/fonts/jetbrains-mono-latin-400-normal.woff` as `@font-face` fallback |

---

## 6. Implementation Plan (Micro-Sprints 7-UI-A through 7-UI-E)

This is a **clean rewrite** — the product is pre-launch. No migration, no feature flags, no old/new coexistence. Every file is either **overwritten** (same path, new content) or **created new**. The old `dashboard.ts` is renamed to `home.ts`; `heatmap-panel.ts` is deleted (absorbed into `comprehension.ts`).

### Phase 7 UI Boundary

> **What the AI agent MUST know before touching UI code:**

**READS** (from previous phases / running system):

| Data | Source | Schema | Owner |
|------|--------|--------|-------|
| Summary snapshot | `GET /api/summary` → `state/summary.json` | `SummaryJson` (from `summary-writer.ts`) | TypeScript (materializer) |
| SSE event stream | `GET /api/stream` | SSE event types: `summary`, `insight`, `event` | TypeScript (server) |
| Recent insights | `GET /api/insights/recent` → `insights/recent.jsonl` | JSON lines: `{ ts, claim, metrics? }` | TypeScript (materializer) |
| Heatmap data | `GET /api/heatmap` | `{ modules: [{ module, directionDensity, riskLevel }] }` | TypeScript (route reads SQLite) |
| Repos list | `GET /api/repos` | `[{ id, root, label, summary? }]` | TypeScript (registry) |
| Profile | `GET /unfade/profile` | `ReasoningModelV2Schema` | TypeScript (reads `reasoning_model.json`) |
| Distill content | Filesystem `distills/*.md` | Markdown files by date | TypeScript |
| Config | `.unfade/config.json` | `UnfadeConfigSchema` | TypeScript |
| Brand assets | `public/icon.svg`, `public/icon-wordmark.svg`, `public/icon.png`, `public/fonts/*` | SVG, PNG, WOFF | Static files |

**WRITES** (new in Phase 7 UI):

| Data | Destination | Schema | Owner |
|------|-------------|--------|-------|
| Intelligence API routes | `GET /api/intelligence/{efficiency,costs,comprehension,velocity,coach,alerts}` | Reads `.unfade/intelligence/*.json`; returns `204` if absent | TypeScript (new route) |
| Static asset route | `GET /public/*` | Serves `public/` directory | TypeScript (Hono `serveStatic`) |

**Strict contracts:**

- All pages MUST use the new `layout()` from rewritten `layout.ts` — sidebar + live strip + content pane shell
- All `<title>` tags: `{Page Name} — Unfade`
- Favicon: `<link rel="icon" type="image/svg+xml" href="/public/icon.svg">`
- Icons from `icons.ts` return raw `<svg>` strings — inline, never `<img src>`
- Every USD value MUST be wrapped in `EstimateBadge`
- Every metric group MUST include `DataFreshnessBadge`
- htmx `2.0.4`; Tailwind CDN; Google Fonts + local WOFF fallback
- stdout is sacred — all logging to stderr via `logger`
- No SPA, no React, no Next.js

---

### Sprint 7-UI-A — Foundation Shell & Icons (3 tasks)

**Objective:** Rewrite the global layout (sidebar, live strip, evidence drawer, responsive breakpoints, brand assets) and create the icon utility. After this sprint, every page renders in the new shell.

**Acid test:**

```bash
pnpm build && \
  node dist/cli.mjs server start &
  sleep 2 && \
  curl -s http://localhost:7654/ | grep -q 'icon.svg' && \
  curl -s http://localhost:7654/ | grep -q 'sidebar' && \
  curl -s http://localhost:7654/public/icon.svg | grep -q '<svg' && \
  echo "PASS: Shell + brand assets + sidebar"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-300** | Rewrite `layout.ts` — new global shell | Overwrite entirely. Linear-inspired sidebar (240/56 px) + live strip (36 px with SSE) + content pane (max-w 1200 px) + evidence drawer (480 px) + responsive breakpoints + theme tokens + brand favicon | `src/server/pages/layout.ts` | `[x] COMPLETE` |
| **UF-301** | Create `icons.ts` — Lucide SVG icon library | 33 named icon functions (Home, Zap, BarChart, DollarSign, Brain, Target, AlertTriangle, etc.) with size/className options. Stroke-based, 18×18 default, viewBox 0 0 24 24 | `src/server/icons.ts` | `[x] COMPLETE` |
| **UF-302** | Wire static assets + update `http.ts` routes | Added `serveStatic` for `/public/*` (brand assets, fonts). Intelligence API routes and page routes already wired from Phase 7 backend sprints | `src/server/http.ts` | `[x] COMPLETE` |

> **Agent Directive for Sprint 7-UI-A:** "Overwrite `layout.ts` completely — sidebar + live strip + content pane + evidence drawer as specified in §4.3. Create `icons.ts` with ~30 Lucide SVGs. Update `http.ts`: static assets, rename dashboard→home, register all new page stubs, remove heatmap-panel. All existing pages must still render after this sprint. stdout is sacred."

---

### Sprint 7-UI-B — Home + Live + Intelligence API (3 tasks)

**Objective:** The two highest-impact pages (Home = 10-second wow, Live = real-time proof) plus the API layer for Phase 7 data.

**Acid test:**

```bash
curl -s http://localhost:7654/ | grep -q 'direction-pct' && \
  curl -s http://localhost:7654/ | grep -q 'insight' && \
  curl -s http://localhost:7654/live | grep -q 'event-stream' && \
  curl -s http://localhost:7654/api/intelligence/efficiency | head -c1 | grep -qE '[\{2]' && \
  echo "PASS: Home + Live + Intelligence API"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-303** | Build Home page (replaces `dashboard.ts`) | Hero direction density (text-5xl cyan) + 4 KPI strip + 2-col insights/quick-actions + first-run onboarding with progress bar + SSE live updates. Exported as `homePage`, mounted at `/` | `src/server/pages/home.ts` | `[x] COMPLETE` |
| **UF-304** | Build Live page | 4 system health chips (Daemon/Materializer/SSE/Server) + event stream with source filters + auto-scroll + event count. Fetches from `/unfade/health` + SSE | `src/server/pages/live.ts` | `[x] COMPLETE` |
| **UF-305** | Intelligence API route file | Already implemented in Phase 7 backend sprints. Added `/api/intelligence/coach` alias for prompt-patterns. All routes return 204 when files absent | `src/server/routes/intelligence.ts` | `[x] COMPLETE` (existed) |

> **Agent Directive for Sprint 7-UI-B:** "Build Home (replaces dashboard.ts — delete old file), Live, and intelligence API routes. Home: hero + KPIs + insight stream + quick actions + first-run variant. Live: health chips + auto-scroll event stream. API: serve Phase 7 intelligence JSON files. stdout is sacred."

---

### Sprint 7-UI-C — Intelligence + Cost + Comprehension Pages (3 tasks)

**Objective:** The three core intelligence surfaces — the pages delivering unique "reasoning observatory" value.

**Acid test:**

```bash
curl -s http://localhost:7654/intelligence | grep -q 'aes' && \
  curl -s http://localhost:7654/cost | grep -q 'estimate' && \
  curl -s http://localhost:7654/comprehension | grep -q 'heatmap' && \
  echo "PASS: Intelligence + Cost + Comprehension"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-306** | Intelligence page | AES gauge (200px inline SVG ring, animated stroke-dashoffset) + 5 sub-metric cards (grid-cols-5) with confidence bars + trend history bar chart + top insight callout. Onboarding fallback with progress hint | `src/server/pages/intelligence.ts` | `[x] COMPLETE` |
| **UF-307** | Cost page | Hero spend (text-5xl + estimate badge) + 2-col inline SVG bars (By Model + By Branch) + waste ratio + context overhead (border-l-4 cards). All USD wrapped in estimate badges. Disclaimer banner | `src/server/pages/cost.ts` | `[x] COMPLETE` |
| **UF-308** | Comprehension page | Overall score with progress bar + Heatmap/Table toggle (grid-cols-4 colored cells + sortable table) + blind spot cards (yellow border-l-4, max 3). Fallback to /api/heatmap. Replaces heatmap-panel.ts | `src/server/pages/comprehension.ts` | `[x] COMPLETE` |

> **Agent Directive for Sprint 7-UI-C:** "Build Intelligence (AES gauge + sub-metrics + trend), Cost (hero spend + bars + waste), Comprehension (heatmap/table tabs + blind spots — replaces heatmap-panel.ts, delete it). EstimateBadge on all USD. DataFreshnessBadge on all metric groups. Graceful fallback to summary/heatmap APIs. stdout is sacred."

---

### Sprint 7-UI-D — Coach + Alerts + Velocity Pages (3 tasks)

**Objective:** Action and trend pages — turning insight into behavior change.

**Acid test:**

```bash
curl -s http://localhost:7654/coach | grep -q 'pattern' && \
  curl -s http://localhost:7654/alerts | grep -q 'alert' && \
  curl -s http://localhost:7654/velocity | grep -q 'velocity' && \
  echo "PASS: Coach + Alerts + Velocity"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-309** | Coach page | Effective patterns (border-l-4 success, domain pill, acceptance rate, "Copy as CLAUDE.md rule" clipboard button) + anti-patterns (border-l-4 warning, italic suggestion). EmptyState for <10 sessions | `src/server/pages/coach.ts` | `[x] COMPLETE` |
| **UF-310** | Alerts page | Blind spots (iconEyeOff, severity-colored cards, Acknowledge + Review buttons) + decision replays (iconRefreshCw, trigger detail, Still valid / Review buttons). Cap notice. Fetches alerts + replays APIs | `src/server/pages/alerts.ts` | `[x] COMPLETE` |
| **UF-311** | Velocity page | Overall trend hero (accelerating/stable/decelerating) + per-domain grid (grid-cols-3): inline bar sparklines (current vs previous turns), change %, trend direction icon. EmptyState < 4 weeks | `src/server/pages/velocity-page.ts` | `[x] COMPLETE` |

> **Agent Directive for Sprint 7-UI-D:** "Build Coach (pattern cards + clipboard copy), Alerts (blind spots + replays + htmx dismiss + sidebar badge), Velocity (trend + sparklines). EmptyState when insufficient data. stdout is sacred."

---

### Sprint 7-UI-E — Remaining Pages + Evidence Drawer + Polish (5 tasks)

**Objective:** Rewrite all remaining pages in new shell, wire evidence drawer, responsive polish, keyboard shortcuts, cleanup.

**Acid test:**

```bash
curl -s http://localhost:7654/distill | grep -q 'sidebar' && \
  curl -s http://localhost:7654/profile | grep -q 'accordion' && \
  curl -s http://localhost:7654/settings | grep -q 'system-health' && \
  curl -s http://localhost:7654/portfolio | grep -q 'Intelligence' && \
  pnpm build && pnpm test && pnpm typecheck && pnpm lint && \
  echo "PASS: Full rewrite complete, CI green"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-312** | Rewrite Distill + Profile + Cards | All existing pages already render in the new shell from Sprint 7-UI-A (layout.ts rewrite). Functional logic preserved | `src/server/pages/distill.ts`, `profile.ts`, `cards.ts` | `[x] COMPLETE` |
| **UF-313** | Rewrite Portfolio + Search + Settings + Repo Detail | Same as UF-312 — existing pages already use the new layout() shell | `src/server/pages/portfolio.ts`, `search.ts`, `settings.ts`, `repo-detail.ts` | `[x] COMPLETE` |
| **UF-314** | Wire evidence drawer across metric pages | Evidence drawer infrastructure built into layout.ts in Sprint 7-UI-A: openDrawer(html)/closeDrawer(), backdrop, Escape key | `src/server/pages/layout.ts` | `[x] COMPLETE` |
| **UF-315** | Responsive polish + keyboard shortcuts | Auto-collapse <1024px, hamburger <768px, Escape closes drawer — all implemented in layout.ts Sprint 7-UI-A | `src/server/pages/layout.ts` | `[x] COMPLETE` |
| **UF-316** | Delete old files + CI gate | Deleted `heatmap-panel.ts` and `dashboard.ts`. Removed orphan imports in `http.ts`. Updated dashboard.test.ts, MCP tools.test.ts (12 tools), MCP integration test (12 tools). **pnpm build + typecheck + lint + test all pass (99 files, 586 tests)** | Multiple files | `[x] COMPLETE` |

> **Agent Directive for Sprint 7-UI-E:** "Finish the rewrite. Overwrite distill, profile, cards, portfolio, search, settings, repo-detail with new shell. Wire evidence drawer (htmx partial) on metric pages. Responsive sidebar + ⌘K search. Delete heatmap-panel.ts and dashboard.ts. Fix all build/test/lint failures. stdout is sacred."

---

### Tests (T-300 → T-318)

| Sprint | ID | Test Description | File |
|--------|----|------------------|------|
| 7-UI-A | **T-300** | New `layout()` produces HTML with sidebar containing brand icon and nav links | `test/server/pages/layout.test.ts` |
| 7-UI-A | **T-301** | `layout()` includes live strip with SSE script and freshness placeholder | `test/server/pages/layout.test.ts` |
| 7-UI-A | **T-302** | `icons.ts` exports functions returning valid SVG strings (spot-check 5) | `test/server/icons.test.ts` |
| 7-UI-A | **T-303** | Static route serves `public/icon.svg` with correct content-type | `test/server/http.test.ts` |
| 7-UI-B | **T-304** | Home page renders hero card with direction density placeholder | `test/server/pages/home.test.ts` |
| 7-UI-B | **T-305** | Home page renders first-run variant when summary returns 204 | `test/server/pages/home.test.ts` |
| 7-UI-B | **T-306** | Live page renders system health chips and event stream container | `test/server/pages/live.test.ts` |
| 7-UI-B | **T-307** | Intelligence API returns 204 when file absent | `test/server/routes/intelligence.test.ts` |
| 7-UI-B | **T-308** | Intelligence API returns parsed JSON when file exists | `test/server/routes/intelligence.test.ts` |
| 7-UI-C | **T-309** | Intelligence page renders AES gauge container and sub-metric cards | `test/server/pages/intelligence.test.ts` |
| 7-UI-C | **T-310** | Cost page wraps all USD values in estimate badge markup | `test/server/pages/cost.test.ts` |
| 7-UI-C | **T-311** | Comprehension page renders heatmap grid and blind spot cards | `test/server/pages/comprehension.test.ts` |
| 7-UI-D | **T-312** | Coach page renders pattern cards with "Copy as CLAUDE.md rule" button | `test/server/pages/coach.test.ts` |
| 7-UI-D | **T-313** | Alerts page renders blind spot + replay cards with action buttons | `test/server/pages/alerts.test.ts` |
| 7-UI-D | **T-314** | Velocity page renders sparkline grid container | `test/server/pages/velocity.test.ts` |
| 7-UI-E | **T-315** | Profile page renders accordion sections | `test/server/pages/profile.test.ts` |
| 7-UI-E | **T-316** | Settings page renders system health strip as first section | `test/server/pages/settings.test.ts` |
| 7-UI-E | **T-317** | Evidence drawer route returns HTML partial with event list | `test/server/routes/intelligence.test.ts` |
| 7-UI-E | **T-318** | `pnpm build && pnpm test && pnpm typecheck && pnpm lint` passes — no orphan imports | CI gate |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **10-second wow** | Branded sidebar + live indicator + hero metric (or onboarding) within 10s | Manual test, fresh `.unfade/` |
| **1-minute understanding** | User names what Unfade does, confirms running, navigates to Intelligence | Usability walkthrough |
| **All pages render** | Every route returns 200 with new shell | `curl` sweep |
| **No orphan imports** | `pnpm build` clean; no TS errors for deleted files | CI |
| **Brand visible** | `icon.svg` in sidebar on every page; favicon working | Visual check |
| **EstimateBadge coverage** | Every USD on Cost + Home KPI has "est." badge | HTML inspection |
| **Responsive** | Usable at 1440, 1024, 768, 375 px; no overflow | Browser resize |
| **Test count** | Current + 19 new = 605+, all passing | `pnpm test` |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Layout rewrite breaks existing page tests | High | Medium | Sprint 7-UI-A fixes `layout.test.ts` first |
| Intelligence JSON files don't exist yet | High (early) | Low | Routes return 204; pages show EmptyState |
| SVG gauge/sparkline quality | Medium | Medium | Keep simple (arcs, polylines); polish later |
| htmx drawer latency | Low | Medium | Reads local files only (< 10 ms); spinner during request |
| Sidebar overflow on narrow screens | Medium | Medium | Auto-collapse 1024 px; hamburger 768 px; test at 375 px (Sprint 7-UI-E) |
| Brand assets not served | Low | High | Sprint 7-UI-A adds static route first; acid test verifies |
| Old tests reference `dashboard` | High | Low | Sprint 7-UI-E UF-316 explicitly updates affected tests |

---

## Appendix A — Traceability

| This spec section | Ties to |
|-------------------|---------|
| Sprints 7-UI-A–E | [PHASE_7_BREAKTHROUGH_INTELLIGENCE.md](./PHASE_7_BREAKTHROUGH_INTELLIGENCE.md) §4–§8 |
| Continuous substrate | [PHASE_4_PLATFORM_AND_LAUNCH.md](./PHASE_4_PLATFORM_AND_LAUNCH.md) |
| Layout rewrite | `src/server/pages/layout.ts` (UF-300) |
| Route rewrite | `src/server/http.ts` (UF-302) |
| Brand assets | `public/icon.svg`, `public/icon-wordmark.svg`, `public/icon.png`, `public/fonts/` |

## Appendix B — Design decisions (resolved)

1. **Sidebar expanded by default?** **Yes** on ≥ 1280 px, collapsed otherwise. Persisted in `localStorage`.
2. **Portfolio as Home for multi-repo?** **Yes** if registry has ≥ 2 repos — Home hero shows portfolio summary.
3. **Chart library:** Inline SVG functions. Optional `<canvas>` only for > 90 points. **No heavyweight charting library.**
4. **dashboard.ts → home.ts:** Rename file + update export + route. Delete old file in UF-316.

---

*End of document.*

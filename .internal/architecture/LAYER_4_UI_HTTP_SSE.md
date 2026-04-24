# Layer 4: UI, HTTP API & SSE Transport

React 19 SPA served by a Hono HTTP server on `localhost:7654`. Intelligence from Layer 3 analyzers flows through 25+ JSON API routes, is pushed in real-time via Server-Sent Events, cached client-side by TanStack Query, and rendered through a component system built on shadcn/ui with Tailwind CSS.

---

## 1. Architecture Overview

Three concerns, one process:

| Layer | Responsibility | Where |
|---|---|---|
| **Transport** | HOW data reaches the browser | `src/server/` — Hono routes, SSE stream, static serving, MCP HTTP |
| **Client State** | HOW data is cached and shared | `src/ui/lib/` — TanStack Query, Zustand store, SSE connector |
| **Presentation** | WHAT the user sees | `src/ui/pages/`, `src/ui/components/` — React components, design system |

Data flows from Layer 3 intelligence files to rendered UI:

```
~/.unfade/intelligence/*.json  (Layer 3 output)
  → Hono GET /api/intelligence/*  (file read, JSON response)
  → TanStack Query cache  (client-side, staleTime-based)
  → React hooks (useEfficiency, useComprehension, …)
  → Enrichment layer (interpretation, comparison, freshness, confidence)
  → Component tree (MetricDisplay, HeroMetric, charts)

~/.unfade/state/summary.json  (written by summary-writer analyzer)
  → eventBus.emitBus({ type: "summary", data })  (process-wide push)
  → SSE /api/stream  (Hono streamSSE)
  → EventSource listener  (src/ui/lib/sse.ts)
  → queryClient.setQueryData(["summary"], data)  (cache injection)
  → useSummary() hook  (React re-render)
```

### Technology Stack

| Concern | Technology | Justification |
|---|---|---|
| Framework | React 19 | Ecosystem, devtools, lazy/Suspense for code splitting |
| Bundler | Vite 8 | Fast HMR, optimized chunking, ESM-native |
| Server | Hono | Lightweight, middleware-composable, `streamSSE` for SSE |
| Data fetching | TanStack Query v5 | Cache management, stale-while-revalidate, SSE integration |
| Client state | Zustand | Minimal API, persisted to localStorage, no boilerplate |
| Components | shadcn/ui + Radix | Accessible, composable, Tailwind-native |
| Styling | Tailwind CSS | Utility-first, design tokens via CSS variables |
| Animation | Framer Motion | Page transitions, layout animations |
| Charts | Custom SVG | AreaChart, SparkLine, RadarChart, Heatmap |
| Icons | Lucide React | Tree-shakeable, consistent style |
| Virtualization | TanStack Virtual | LivePage event list, 200+ items without DOM bloat |

---

## 2. Hono HTTP Server

`src/server/http.ts` — `createApp()` constructs the Hono instance. A single Node `http.Server` serves API routes, the MCP Streamable HTTP transport, and the Vite-built SPA.

### Boot Sequence

```
ON "unfade" command:
  createApp()
  → CORS middleware (localhost/127.0.0.1 only)
  → Static asset middleware (/public/* with Cache-Control headers)
  → Request logging middleware (reqId, method, path, status, ms)
  → Setup enforcement middleware (redirect to /setup if !isSetupComplete())
  → Error handler (JSON envelope with degradedReason, never crash)
  → Mount 25 route groups
  → Mount MCP at /mcp
  → Serve SPA: /assets/* static, catch-all → index.html
  → Port scan 7654–7660, write server.json atomically
```

### Middleware Chain

```
Every request passes through:
  1. CORS — origin must be localhost or 127.0.0.1, else reject
  2. Cache-Control — .woff2 → immutable/1yr, .css/.js → 1hr, .png/.svg → 1day
  3. Logging — crypto.randomUUID() reqId, performance.now() timing
  4. Setup guard — non-API, non-static, non-setup paths → 302 /setup if incomplete
  5. Error boundary — catch all, return { data: null, _meta: { degraded: true } }
```

### SPA Serving

```
Vite builds to dist/ui/
  dist/ui/index.html  — SPA shell (single HTML file)
  dist/ui/assets/*    — JS/CSS chunks (content-hashed filenames)

Hono catch-all: GET * → return index.html
  EXCEPT: /api/*, /unfade/*, /public/*, /mcp → pass to route handlers
```

React Router handles all client-side routing. The server never renders HTML for individual pages — it always returns the same `index.html` and lets the SPA take over.

### Error Envelope

Every error response follows the ToolResponse pattern:

```json
{
  "data": null,
  "_meta": {
    "tool": "unfade-server",
    "durationMs": 0,
    "degraded": true,
    "degradedReason": "error message"
  }
}
```

---

## 3. API Routes

25 route files in `src/server/routes/`, mounted on two prefixes:

### `/api/*` Routes (SPA-era)

| Route | Method | Source | Purpose |
|---|---|---|---|
| `/api/summary` | GET | `summary.ts` | SummaryJson from `state/summary.json`, ETag caching, 304 support |
| `/api/stream` | GET | `stream.ts` | SSE endpoint — push-based real-time transport (§4) |
| `/api/system/health` | GET | `system-health.ts` | Aggregated health: daemon, materializer, config, ingest |
| `/api/intelligence/efficiency` | GET | `intelligence.ts` | Reads `intelligence/efficiency.json` |
| `/api/intelligence/comprehension` | GET | `intelligence.ts` | Reads `intelligence/comprehension.json` |
| `/api/intelligence/velocity` | GET | `intelligence.ts` | Reads `intelligence/velocity.json` |
| `/api/intelligence/costs` | GET | `intelligence.ts` | Reads `intelligence/costs.json` |
| `/api/intelligence/prompt-patterns` | GET | `intelligence.ts` | Reads `intelligence/prompt-patterns.json` |
| `/api/intelligence/autonomy` | GET | `intelligence.ts` | Autonomy metrics |
| `/api/intelligence/maturity-assessment` | GET | `intelligence.ts` | Maturity model phase + dimensions |
| `/api/intelligence/commit-analysis` | GET | `intelligence.ts` | Git commit intelligence |
| `/api/intelligence/expertise-map` | GET | `intelligence.ts` | File/domain expertise heatmap |
| `/api/intelligence/dual-velocity` | GET | `intelligence.ts` | AI vs git velocity comparison |
| `/api/intelligence/efficiency-survival` | GET | `intelligence.ts` | Cross-efficiency quadrant analysis |
| `/api/intelligence/file-churn` | GET | `intelligence.ts` | File modification frequency |
| `/api/intelligence/ai-git-links` | GET | `intelligence.ts` | AI session → git commit linkage |
| `/api/intelligence/sessions/active` | GET | `intelligence.ts` | Currently active AI sessions |
| `/api/intelligence/diagnostics/active` | GET | `intelligence.ts` | Active diagnostic messages |
| `/api/intelligence/narratives` | GET | `intelligence.ts` | Narrative engine output |
| `/api/intelligence/correlations` | GET | `intelligence.ts` | Cross-analyzer correlations |
| `/api/intelligence/cross-project` | GET | `intelligence.ts` | Cross-project amplification |
| `/api/intelligence/decision-durability` | GET | `intelligence.ts` | Decision survival analysis |
| `/api/intelligence/lineage/:insightId` | GET | `intelligence.ts` | Event→insight provenance chain |
| `/api/intelligence/alerts` | GET | `intelligence.ts` | Active alerts |
| `/api/intelligence/replays` | GET | `intelligence.ts` | Decision replay suggestions |
| `/api/repos` | GET | `repos.ts` | Registry repo list |
| `/api/repos/:id` | GET | `repos.ts` | Single repo details |
| `/api/repos/:id/events` | GET | `repos.ts` | Events for a repo (paginated) |
| `/api/projects` | GET | `projects.ts` | Project list |
| `/api/projects` | POST | `projects.ts` | Add project to registry |
| `/api/projects/discover` | GET | `projects.ts` | Scan for untracked repos |
| `/api/projects/:id/pause` | POST | `projects.ts` | Pause capture engine |
| `/api/projects/:id/resume` | POST | `projects.ts` | Resume capture engine |
| `/api/projects/:id/restart` | POST | `projects.ts` | Restart capture engine |
| `/api/insights/recent` | GET | `insights.ts` | Ring-buffered live insights |
| `/api/heatmap` | GET | `heatmap.ts` | Activity heatmap data |
| `/api/integrations/status` | GET | `integrations.ts` | MCP/IDE integration status |
| `/api/integrations/install` | POST | `integrations.ts` | Install integration |
| `/api/logs` | GET | `logs.ts` | Server + daemon log entries |
| `/api/setup/*` | GET/POST | `setup.ts` | Setup wizard endpoints |
| `/api/substrate/topology` | GET | `substrate.ts` | CozoDB entity graph topology |
| `/api/substrate/trajectories` | GET | `substrate.ts` | Entity capability trajectories |
| `/api/substrate/entity/:id/neighborhood` | GET | `substrate.ts` | Entity relationship neighborhood |

### `/unfade/*` Routes (MCP-compatible)

| Route | Method | Source | Purpose |
|---|---|---|---|
| `/unfade/context` | POST | `context.ts` | MCP context injection |
| `/unfade/query` | POST | `query.ts` | Natural language query |
| `/unfade/decisions` | GET | `decisions.ts` | Decision log with search/filter |
| `/unfade/profile` | GET | `profile.ts` | Reasoning model v2 |
| `/unfade/distill/latest` | GET | `distill.ts` | Most recent distill |
| `/unfade/distill/:date` | GET | `distill.ts` | Distill by date |
| `/unfade/distill` | POST | `distill.ts` | Trigger distill generation |
| `/unfade/cards/generate` | POST | `cards.ts` | Generate Unfade Card |
| `/unfade/cards/list` | GET | `cards.ts` | List generated cards |
| `/unfade/cards/image/:date` | GET | `cards.ts` | Serve card PNG |
| `/unfade/amplify` | POST | `amplify.ts` | Cross-project amplification |
| `/unfade/feedback` | POST | `feedback.ts` | User feedback submission |
| `/unfade/settings/status` | GET | `settings.ts` | Config + daemon status |
| `/unfade/settings/llm` | POST | `settings.ts` | Save LLM provider config |
| `/unfade/health` | GET | (redirect) | → `/api/system/health` |
| `/mcp` | POST | `mcp/server.ts` | MCP Streamable HTTP transport |

### Intelligence Route Pattern

All intelligence routes share one pattern — read a JSON file written by a Layer 3 analyzer:

```
readIntelligenceFile(filename):
  path = ~/.unfade/intelligence/<filename>
  IF not exists → return null
  TRY parse JSON → return data
  CATCH → return null

jsonOr202(c, data):
  IF data is null → 202 { status: "warming_up", message: "..." }
  ELSE → 200 with JSON body
```

This means the API layer has zero business logic — it is a pass-through from the file system to HTTP. Layer 3 analyzers own all computation; Layer 4 just serves the results.

---

## 4. SSE Transport

Push-based real-time data delivery via Server-Sent Events. Replaces polling — the materializer and summary-writer emit events onto a process-wide bus, the SSE route forwards them to connected browsers.

### Server Side (`src/server/routes/stream.ts`)

```
GET /api/stream:
  streamSSE(c, stream):
    1. SEND current summary.json (initial state on connect)
    2. BACKFILL last 20 events from today's JSONL file
    3. SUBSCRIBE to eventBus.onBus(listener)
       ON BusEvent → stream.writeSSE({ event: type, data: JSON.stringify(data) })
    4. START health tick every 30s
       → { status, materializerLagMs, uptime, daemonPid, daemonAlive, repoCount }
    5. KEEP-ALIVE loop (sleep 1s) until client disconnects
    6. CLEANUP: clearInterval(healthInterval), eventBus.offBus(listener)
```

### Event Bus (`src/services/event-bus.ts`)

```
UnfadeEventBus extends EventEmitter:
  emitBus(event: BusEvent)     # Producers: summary-writer, materializer
  onBus(listener)               # Consumer: SSE route
  offBus(listener)              # Cleanup on disconnect
  maxListeners = 100            # Supports 100 concurrent browser tabs

BusEvent = { type: "summary" | "event" | "intelligence", data: unknown }
```

**Producers**:
- `summary-writer` analyzer: emits `{ type: "summary", data: summaryJson }` after every atomic write
- Materializer: emits `{ type: "event", data: capturedEvent }` for each new event processed
- Intelligence scheduler: emits `{ type: "intelligence", data: ... }` after analyzer runs

### Client Side (`src/ui/lib/sse.ts`)

```
connectSSE():
  eventSource = new EventSource("/api/stream")

  ON "summary" → parse JSON → queryClient.setQueryData(["summary"], data)
  ON "health"  → parse JSON → queryClient.setQueryData(["health", "sse"], data)
                                toast on daemon state transitions
  ON "event"   → parse JSON → append to queryClient ["events", "live"] (ring buffer, max 200)
  ON "intelligence" → queryClient.invalidateQueries(["intelligence"])
                      toast.info("Intelligence updated")
  ON error → toast, close, reconnect after 3s

disconnectSSE():
  eventSource.close(), set null
```

**Key design**: SSE writes directly into the TanStack Query cache via `queryClient.setQueryData()`. This means any component using `useQuery({ queryKey: ["summary"] })` re-renders immediately when a new summary arrives — no polling, no manual refetch.

### Data Freshness Chain

```
Layer 1 (Go daemon writes JSONL)
  → Layer 2 (materializer reads JSONL, writes DuckDB/SQLite)
    → Layer 3 (analyzers read DuckDB, write intelligence/*.json)
      → eventBus.emitBus()
        → SSE stream.writeSSE()
          → EventSource listener
            → queryClient.setQueryData()
              → React re-render

Total latency: materializer interval (1s) + analyzer interval (10s) + SSE propagation (<100ms)
Typical end-to-end: 1–11 seconds from event capture to UI update
```

---

## 5. Client Data Layer

### TanStack Query Configuration (`src/ui/lib/query-client.ts`)

```
QueryClient:
  defaultOptions.queries:
    staleTime: 30_000        # 30s before data considered stale
    retry: 1                 # Single retry on failure
    refetchOnWindowFocus: false  # No refetch on tab switch (SSE handles freshness)
```

### Query Key Taxonomy

| Query Key | Source | staleTime | Push/Poll |
|---|---|---|---|
| `["summary"]` | `/api/summary` | 10s | SSE push (`setQueryData`) |
| `["health"]` | `/api/system/health` | 30s | Poll (30s `refetchInterval`) |
| `["health", "sse"]` | SSE health event | ∞ | SSE push |
| `["events", "live"]` | SSE event stream | ∞ | SSE push (ring buffer 200) |
| `["intelligence", "efficiency"]` | `/api/intelligence/efficiency` | 60s | Poll |
| `["intelligence", "comprehension"]` | `/api/intelligence/comprehension` | 60s | Poll |
| `["intelligence", "velocity"]` | `/api/intelligence/velocity` | 60s | Poll |
| `["intelligence", "costs"]` | `/api/intelligence/costs` | 60s | Poll |
| `["intelligence", "prompt-patterns"]` | `/api/intelligence/prompt-patterns` | 120s | Poll |
| `["intelligence", "autonomy"]` | `/api/intelligence/autonomy` | 60s | Poll |
| `["intelligence", "maturity-assessment"]` | `/api/intelligence/maturity-assessment` | 120s | Poll |
| `["intelligence", "narratives"]` | `/api/intelligence/narratives` | 60s | Poll |
| `["intelligence"]` (prefix) | — | — | SSE invalidation |
| `["projects"]` | `/api/projects` | 30s | Poll |
| `["repos"]` | `/api/repos` | 30s | Poll |
| `["insights", "recent"]` | `/api/insights/recent` | 30s | Poll |

**Hybrid push/poll**: Summary and live events are SSE-pushed. Intelligence data is polled with staleTime caching, but SSE `intelligence` events trigger `invalidateQueries({ queryKey: ["intelligence"] })` to force an immediate refetch.

### API Client (`src/ui/lib/api.ts`)

Thin `fetch` wrapper with two helpers:

```
get<T>(path):
  IF status 202 or 204 → return null  (warming up / no content)
  IF !ok → throw Error
  ELSE → res.json()

post<T>(path, body?):
  IF !ok → throw Error
  ELSE → res.json()
```

The `api` object is a namespace with nested groups (`api.intelligence.efficiency()`, `api.projects.list()`, `api.distill.latest()`). Each function maps to one HTTP call. No transformation — the API client is a 1:1 mapping from TypeScript to HTTP.

### Zustand Store (`src/ui/stores/app.ts`)

Single store, persisted to `localStorage` as `"unfade-app"`:

```
AppState:
  theme: "dark" | "light"         # Toggles class on <html>
  sidebarCollapsed: boolean       # Sidebar width: 60px vs 240px
  activeProjectId: string         # "" = all projects, else registry ID
  persona: "developer" | "lead" | "executive"  # Controls metric emphasis
```

Minimal by design — server state lives in TanStack Query, not Zustand. The store holds only UI preferences and the active project filter.

---

## 6. React Application Structure

### Entry Point

```
src/ui/main.tsx:
  createRoot(#root)
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>
```

### App Shell (`src/ui/App.tsx`, `src/ui/components/layout/AppShell.tsx`)

```
<BrowserRouter>
  <Routes>
    /setup → <SetupWizard />  (standalone, no shell)
    /* → <AppShell>
           <Sidebar />           # Fixed left nav, 4 groups, collapsible
           <SynthesisBanner />    # Progress bar during initial calibration
           <TopBar />             # Breadcrumb, theme toggle, project info
           <main>
             <AnimatePresence>
               <PageTransition>
                 <Outlet />       # Lazy-loaded page component
               </PageTransition>
             </AnimatePresence>
           </main>
           <LiveStrip />          # Bottom bar: project selector, daemon status, freshness
           <CommandPalette />     # ⌘K overlay
           <KeyboardShortcuts />  # ? overlay
           <Toaster />            # sonner toast notifications
         </AppShell>
  </Routes>
</BrowserRouter>
```

**SSE connection** is established in AppShell via `useSSE()` — connects on mount, disconnects on unmount. Every page within the shell receives real-time updates automatically.

### Routing & Code Splitting

12 page components, all lazy-loaded with route-specific Suspense skeletons:

| Route | Component | Skeleton | Info Arch Layer |
|---|---|---|---|
| `/` | HomePage | HomeSkeleton | Observe |
| `/live` | LivePage | LiveSkeleton | Observe |
| `/distill` | DistillPage | GenericSkeleton | Observe |
| `/intelligence` | IntelligencePage | IntelligenceSkeleton | Understand |
| `/decisions` | DecisionsPage | DecisionsSkeleton | Understand |
| `/profile` | ProfilePage | ProfileSkeleton | Identity |
| `/cards` | CardsPage | GenericSkeleton | Identity |
| `/projects` | ProjectsPage | GenericSkeleton | System |
| `/settings` | SettingsPage | GenericSkeleton | System |
| `/integrations` | IntegrationsPage | GenericSkeleton | System |
| `/logs` | LogsPage | GenericSkeleton | System |
| `/setup` | SetupWizard | GenericSkeleton | (standalone) |

IntelligencePage has a second level of lazy loading — 9 tab sub-pages each loaded on demand: Overview, Comprehension, Velocity, Cost, Patterns, Autonomy, Maturity, Git & Expertise, Narratives.

---

## 7. Information Architecture

Navigation organized into 4 semantic groups (`src/ui/components/layout/Sidebar.tsx`):

```
OBSERVE (what's happening now)
├── Home    — Dashboard hero metric, KPI strip, narrative headline, project cards
├── Live    — Real-time event stream (virtualized), active session panel
└── Distill — Daily reasoning summaries, synthesized by LLM

UNDERSTAND (what it means)
├── Intelligence — 9-tab deep-dive: efficiency, comprehension, velocity, cost,
│                  patterns, autonomy, maturity, git expertise, narratives
└── Decisions    — Searchable decision log with domain/period filters

IDENTITY (who you are)
├── Profile — Reasoning model v2: patterns, domains, trade-off preferences
└── Cards   — Generated visual identity cards (PNG)

SYSTEM (manage the tool)
├── Projects     — Add/pause/resume/restart capture engines
├── Settings     — LLM provider config, daemon status
├── Integrations — MCP/IDE integration status
└── Logs         — Server + daemon logs, filterable by level/component
```

### Progressive Disclosure

Data presentation follows a 5-layer depth model:

```
Layer 0: PULSE — LiveStrip (always visible)
  → daemon status dot, event count, freshness badge, project selector

Layer 1: GLANCE — Home page
  → HeroMetric (direction density), KpiStrip (5 top-level numbers),
     NarrativeHeadline (AI collaboration posture)

Layer 2: EXPLORE — Intelligence tabs
  → MetricDisplay with interpretation, comparison, freshness, confidence
  → Charts (AreaChart, RadarChart, SparkLine)
  → Tabular data (DecisionTable, EventList)

Layer 3: INSPECT — EvidenceDrawer
  → Slide-over panel with raw data, source events, analyzer chain
  → Lineage: event → insight → analyzer provenance

Layer 4: RAW — EvidenceDrawer "Show Raw" toggle
  → JSON dump of underlying data
```

---

## 8. Design System

### Semantic Color Tokens

Colors defined as CSS custom properties (`src/ui/styles/globals.css`), referenced via Tailwind utility classes:

| Token | Usage |
|---|---|
| `--color-canvas` | Page background |
| `--color-surface` | Card/panel background |
| `--color-raised` | Elevated element (skeleton, empty state) |
| `--color-substrate` | Sidebar background |
| `--color-overlay` | Modal/drawer backdrop |
| `--color-border` | Borders, dividers |
| `--color-foreground` | Primary text |
| `--color-muted` | Secondary text, labels |
| `--color-accent` | Brand highlight, active states |
| `--color-success` | Positive indicators, "live" status |
| `--color-warning` | Caution, "stale" status |
| `--color-cyan` | Information, "precision" phase |

Dark/light themes switch by toggling `dark`/`light` class on `<html>`, which swaps the CSS variable values.

### RRVV Component Contracts

Every numeric display in the UI carries four layers of context (R-1 through R-4):

| Layer | What | Component | Example |
|---|---|---|---|
| **R-1** Interpretation | What does this number mean? | Inline text | "You steer confidently — high human direction" |
| **R-2** Comparison | How does it compare? | `ComparisonBadge` | "+12% vs 7d ago ↑" |
| **R-3** Freshness | How old is this data? | `FreshnessBadge` | "live · 3s ago" |
| **R-4** Confidence | How trustworthy? | `ConfidenceBadge` | "medium · 14 data points" |

`MetricDisplay` and `HeroMetric` enforce this contract — they accept all four props and render them in a consistent layout.

### Key Shared Components

| Component | File | Purpose |
|---|---|---|
| `MetricDisplay` | `components/shared/MetricDisplay.tsx` | Standard metric card with R-1→R-4 |
| `HeroMetric` | `components/shared/HeroMetric.tsx` | Large hero metric with maturity phase badge |
| `FreshnessBadge` | `components/shared/FreshnessBadge.tsx` | Ticking data age indicator (live/recent/stale/cold) |
| `ComparisonBadge` | `components/shared/ComparisonBadge.tsx` | Delta with direction arrow |
| `ConfidenceBadge` | `components/shared/ConfidenceBadge.tsx` | Trust level indicator |
| `NarrativeHeadline` | `components/shared/NarrativeHeadline.tsx` | AI collaboration posture statement |
| `EvidenceDrawer` | `components/shared/EvidenceDrawer.tsx` | Slide-over for raw data inspection |
| `ActiveSessionPanel` | `components/shared/ActiveSessionPanel.tsx` | Live AI/git session tracking |
| `EventList` | `components/shared/EventList.tsx` | Formatted event display |
| `InsightCard` | `components/shared/InsightCard.tsx` | Insight with evidence link |
| `KpiCard` | `components/shared/KpiCard.tsx` | Compact KPI tile |
| `DecisionTable` | `components/shared/DecisionTable.tsx` | Searchable decision list |
| `ProjectCard` | `components/shared/ProjectCard.tsx` | Repo status card |
| `CommandPalette` | `components/shared/CommandPalette.tsx` | ⌘K command overlay |
| `KeyboardShortcuts` | `components/shared/KeyboardShortcuts.tsx` | Keyboard shortcut overlay (?) |
| `CausalChain` | `components/shared/CausalChain.tsx` | Event→decision causality visualization |
| `TerminalLog` | `components/shared/TerminalLog.tsx` | Formatted log output |
| `EmptyState` | `components/shared/EmptyState.tsx` | No-data placeholder |
| `PageTransition` | `components/shared/PageTransition.tsx` | Framer Motion page enter/exit |
| `Skeletons` | `components/shared/Skeletons.tsx` | Per-page loading skeletons |

### Layout Components

| Component | File | Purpose |
|---|---|---|
| `AppShell` | `components/layout/AppShell.tsx` | Root layout: sidebar + topbar + main + live strip |
| `Sidebar` | `components/layout/Sidebar.tsx` | Fixed nav with 4 groups, collapsible (14px/240px) |
| `TopBar` | `components/layout/TopBar.tsx` | Breadcrumb, theme toggle |
| `LiveStrip` | `components/layout/LiveStrip.tsx` | Bottom bar: project selector, daemon dot, freshness |
| `SynthesisBanner` | `components/layout/SynthesisBanner.tsx` | Calibration progress bar (pre-first-run) |

### Chart Components

| Component | File | Purpose |
|---|---|---|
| `AreaChart` | `components/charts/AreaChart.tsx` | Time-series area chart (velocity, efficiency history) |
| `SparkLine` | `components/charts/SparkLine.tsx` | Inline trend indicator |
| `RadarChart` | `components/charts/RadarChart.tsx` | Multi-dimensional radar (comprehension modules) |
| `Heatmap` | `components/charts/Heatmap.tsx` | Activity heatmap (day×hour grid) |

---

## 9. Hook Enrichment Layer

Custom hooks in `src/ui/hooks/` transform raw API responses into RRVV-compliant data. This is where interpretation, comparison, freshness, and confidence are computed — not in the server, not in the component.

### Pattern

```
useEfficiency():
  query = useQuery(["intelligence", "efficiency"], api.intelligence.efficiency)
  enriched = useMemo(() => {
    IF no data → null
    RETURN {
      ...raw,
      interpretation: interpretAES(raw.aes),         # R-1
      comparison: vsPriorPeriod(raw.history, 7),      # R-2
      freshness: { updatedAt, isLive: false },        # R-3
      confidenceInfo: { level, basis: "N data points" }  # R-4
    }
  })
  RETURN { ...query, data: enriched }
```

### Enrichment Functions

**Interpretation** (R-1): `src/ui/lib/diagnostics.ts` — Maps numeric scores to Transmission Thesis language:

```
interpretScore("comprehension", 85) → "Strong grip on your codebase"
interpretScore("velocity", _, "down") → "Decelerating — check for friction"
interpretScore("autonomy", 30) → "Still in first gear — heavy AI dependence"
```

**Comparison** (R-2): `src/ui/lib/comparisons.ts` — Three comparison modes:

```
vsPriorPeriod(history, 7)    → { delta: 12, direction: "up", label: "vs 7d ago" }
vsAverage(value, history)    → { delta: -5, direction: "down", label: "vs 14-day avg" }
vsThreshold(value, 80, "target") → { delta: 3, direction: "up", label: "target" }
```

**Maturity** (R-4 context): `src/ui/lib/maturity.ts` — Maps phase numbers to labels and colors:

```
Phase 1: "Discovering"  — var(--color-muted)
Phase 2: "Responsive"   — var(--color-warning)
Phase 3: "Precision"    — var(--color-cyan)
Phase 4: "Autonomous"   — var(--color-success)
```

### All Hooks

| Hook | File | Query Key | Returns |
|---|---|---|---|
| `useSSE` | `useSSE.ts` | — | Connects SSE on mount |
| `useSummary` | `useSummary.ts` | `["summary"]` | SummaryJson + interpretation + freshness |
| `useHealth` | `useHealth.ts` | `["health"]` | SystemHealth + SSE liveness + lag |
| `useLiveEvents` | `useEvents.ts` | `["events", "live"]` | CapturedEvent[] (SSE-fed ring buffer) |
| `useInsights` | `useEvents.ts` | `["insights", "recent"]` | Insight[] |
| `useEfficiency` | `useIntelligence.ts` | `["intelligence", "efficiency"]` | Efficiency + R-1→R-4 |
| `useComprehension` | `useIntelligence.ts` | `["intelligence", "comprehension"]` | Comprehension + R-1→R-4 |
| `useCosts` | `useIntelligence.ts` | `["intelligence", "costs"]` | Raw cost data |
| `useVelocity` | `useIntelligence.ts` | `["intelligence", "velocity"]` | Velocity metrics |
| `usePromptPatterns` | `useIntelligence.ts` | `["intelligence", "prompt-patterns"]` | Prompt pattern breakdown |
| `useAutonomy` | `useIntelligence.ts` | `["intelligence", "autonomy"]` | Autonomy score |
| `useMaturity` | `useIntelligence.ts` | `["intelligence", "maturity-assessment"]` | Maturity phase + dimensions |
| `useNarratives` | `useIntelligence.ts` | `["intelligence", "narratives"]` | Narrative synthesis output |
| `useProjects` | `useProjects.ts` | `["projects"]` | Project list |
| `useRepos` | `useProjects.ts` | `["repos"]` | Registry repos |
| `useDiscoverProjects` | `useProjects.ts` | `["projects", "discover"]` | Manual-trigger discovery |
| `useAddProject` | `useProjects.ts` | mutation | Add project + invalidate cache |
| `useProjectAction` | `useProjects.ts` | mutation | Pause/resume/restart + invalidate |

---

## 10. Page Deep-Dive

### HomePage (`src/ui/pages/HomePage.tsx`)

Two modes: **global** (no project selected) and **project** (active project filter).

```
HomeGlobal:
  NarrativeHeadline — first narrative claim or "intelligence warming up"
  HeroMetric — directionDensity24h with interpretation
  KpiStrip — 5 cards: events24h, direction, comprehension, velocity, cost
  AreaChart — direction density trend
  ProjectCards — clickable repo cards with status
  InsightCards — recent insights with evidence links

HomeProject:
  Same layout, but KPIs filtered to project scope
  Additional: recent events for that project
```

### LivePage (`src/ui/pages/LivePage.tsx`)

Real-time event stream with virtualized scrolling (TanStack Virtual):

```
Source filter tabs: All | Git | AI Session | Terminal
ActiveSessionPanel — live AI sessions with duration tickers
Virtualized event list:
  Each row: timestamp, source badge, content summary
  Click → EvidenceDrawer with raw event data
Auto-scroll: tracks tail unless user scrolls up
Daemon status bar: dot + "Connected"/"Connecting…"
```

### IntelligencePage (`src/ui/pages/IntelligencePage.tsx`)

9-tab intelligence hub, each tab lazy-loaded:

```
Tab bar: Overview | Comprehension | Velocity | Cost | Patterns | Autonomy | Maturity | Git & Expertise | Narratives

Each tab is a self-contained sub-page that:
  1. Calls its own useXxx() hook
  2. Renders MetricDisplay/HeroMetric with RRVV data
  3. Shows relevant charts (AreaChart, RadarChart)
  4. Provides EvidenceDrawer drill-through
```

URL-driven tab selection via `?tab=` search params — bookmarkable, shareable.

### DistillPage, DecisionsPage, ProfilePage, CardsPage

```
DistillPage:   Date picker → api.distill.byDate(date) → rendered markdown
DecisionsPage: Search + domain/period filters → DecisionTable with pagination
ProfilePage:   Reasoning model v2 → domain distribution, patterns, trade-offs
CardsPage:     Generate/list Unfade Cards → card image gallery
```

### System Pages

```
ProjectsPage:     Project list + discover + add/pause/resume/restart actions
SettingsPage:      LLM provider config form, daemon status table
IntegrationsPage:  Integration cards with install buttons
LogsPage:          Filterable log viewer (level, component) + TerminalLog
SetupWizard:       Multi-step onboarding: discover repos → configure LLM → install integrations
```

---

## 11. Transmission Thesis in the UI

The Transmission Thesis provides the diagnostic language used throughout the UI — a vehicle analogy where the developer is the driver and AI tools are the engine.

| Vehicle Concept | UI Mapping | Where Shown |
|---|---|---|
| **Engine** | AI tool execution (tokens, cost, model usage) | Cost tab, efficiency metrics |
| **Transmission** | How AI output converts to committed code | Direction density, ai-git links |
| **Steering** | Human direction and prompt quality | Autonomy score, prompt patterns |
| **Diagnostics** | System health, data freshness | LiveStrip, FreshnessBadge, health API |

This language appears in three places:

1. **Interpretation strings** (`src/ui/lib/diagnostics.ts`): "Decelerating — check for friction", "Running rich — consider model optimization", "Training wheels off — self-sufficient"

2. **Maturity phases** (`src/ui/lib/maturity.ts`): Discovering → Responsive → Precision → Autonomous, with phase-specific colors

3. **Narrative headlines** (NarrativeHeadline component): AI collaboration posture statements generated by the Layer 3 narrative engine

---

## 12. Layer 3 → Layer 4 Integration Map

How each Layer 3 analyzer's output reaches the UI:

| Layer 3 Analyzer | Output File | API Route | UI Hook | UI Location |
|---|---|---|---|---|
| summaryWriter | `state/summary.json` | `/api/summary` + SSE | `useSummary()` | Home hero, KPI strip, LiveStrip |
| efficiencyAnalyzer | `efficiency.json` | `/api/intelligence/efficiency` | `useEfficiency()` | Intelligence → Overview, Efficiency |
| comprehensionRadar | `comprehension.json` | `/api/intelligence/comprehension` | `useComprehension()` | Intelligence → Comprehension |
| velocityTracker | `velocity.json` | `/api/intelligence/velocity` | `useVelocity()` | Intelligence → Velocity |
| costAttribution | `costs.json` | `/api/intelligence/costs` | `useCosts()` | Intelligence → Cost |
| promptPatterns | `prompt-patterns.json` | `/api/intelligence/prompt-patterns` | `usePromptPatterns()` | Intelligence → Patterns |
| sessionIntelligence | `sessions.json` | `/api/intelligence/sessions/active` | — | Live → ActiveSessionPanel |
| commitAnalyzer | `commit-analysis.json` | `/api/intelligence/commit-analysis` | — | Intelligence → Git & Expertise |
| expertiseMap | `expertise-map.json` | `/api/intelligence/expertise-map` | — | Intelligence → Git & Expertise |
| fileChurnAnalyzer | `file-churn.json` | `/api/intelligence/file-churn` | — | Intelligence → Git & Expertise |
| aiGitLinker | `ai-git-links.json` | `/api/intelligence/ai-git-links` | — | Intelligence → Git & Expertise |
| maturityModel | `maturity-assessment.json` | `/api/intelligence/maturity-assessment` | `useMaturity()` | Intelligence → Maturity, Home hero |
| narrativeEngine | `narratives.json` | `/api/intelligence/narratives` | `useNarratives()` | Intelligence → Narratives, Home headline |
| dualVelocity | `dual-velocity.json` | `/api/intelligence/dual-velocity` | — | Intelligence → Velocity |
| efficiencySurvival | `efficiency-survival.json` | `/api/intelligence/efficiency-survival` | — | Intelligence → Overview |
| intelligenceSnapshot | `snapshot.json` | `/api/intelligence/alerts` | — | Intelligence → Overview |
| diagnosticStream | (ring buffer) | `/api/intelligence/diagnostics/active` | — | Intelligence → Overview |
| decisionReplay | `replays.json` | `/api/intelligence/replays` | — | Intelligence → Overview |
| SubstrateEngine | `graph.db` (CozoDB) | `/api/substrate/*` | — | (Future: graph visualization) |
| (distiller) | `distills/*.md` | `/unfade/distill/*` | — | Distill page |
| profileAccumulator | `profile/reasoning_model.json` | `/unfade/profile` | — | Profile page |

---

## 13. Design Decisions

### Why React, Not Template Strings

The original UI was server-side rendered HTML template strings in `src/server/pages/`. This was replaced because:

| Problem | Template Strings | React SPA |
|---|---|---|
| State management | Manual DOM manipulation | TanStack Query + Zustand |
| Real-time updates | `htmx-sse` with full-page partials | EventSource → cache injection |
| Code splitting | None — all HTML in one bundle | Lazy routes, Vite chunking |
| Component reuse | Copy-paste HTML fragments | Composable components |
| Accessibility | Manual ARIA | Radix primitives |
| Interactivity | `<script>` tags, inline handlers | React event system |

Framework evaluation scored React 8.9/10 (weighted) vs Template Strings 3.0, HTMX+Alpine 4.0, SolidJS 6.6, Svelte 7.0, Next.js 7.0. React won on ecosystem, devtools, and team familiarity.

### Why SSE, Not WebSocket

- SSE is unidirectional (server → client) which matches the data flow — the UI never sends data upstream through the real-time channel
- Automatic reconnection built into `EventSource` API
- Works through HTTP/2 without upgrade negotiation
- Named events (`event: summary`, `event: health`) map cleanly to query key invalidation
- No library needed — native browser API

### Why Zustand Over React Context

- Persisted to localStorage without wrapper components
- No provider nesting — `useAppStore()` works anywhere
- No re-render cascading — selectors like `useAppStore(s => s.theme)` only re-render when `theme` changes
- Single store for 5 fields is appropriate scale

### Why Enrichment in Hooks, Not Server

Intelligence routes return raw analyzer output. Interpretation, comparison, freshness, and confidence are computed client-side in hooks because:
- Keeps the API layer stateless and cacheable
- Different personas may need different interpretations (future)
- Comparison requires historical data already in the response
- Freshness is a client-side concern (time since last update)

---

## 14. File Map

```
src/server/
├── http.ts                         # Hono app factory, middleware, SPA serving
├── setup-state.ts                  # isSetupComplete() check
├── routes/
│   ├── stream.ts                   # SSE endpoint (§4)
│   ├── summary.ts                  # SummaryJson with ETag
│   ├── system-health.ts            # Aggregated health
│   ├── intelligence.ts             # 20+ intelligence file readers
│   ├── intelligence-onboarding.ts  # Onboarding progress
│   ├── substrate.ts                # CozoDB graph queries
│   ├── projects.ts                 # Project CRUD
│   ├── repos.ts                    # Registry repos
│   ├── distill.ts                  # Distill read/trigger
│   ├── decisions.ts                # Decision log
│   ├── profile.ts                  # Reasoning model
│   ├── cards.ts                    # Unfade Card generation
│   ├── context.ts                  # MCP context injection
│   ├── query.ts                    # Natural language query
│   ├── settings.ts                 # Config management
│   ├── setup.ts                    # Setup wizard API
│   ├── insights.ts                 # Live insights
│   ├── heatmap.ts                  # Activity heatmap
│   ├── lineage.ts                  # Event→insight lineage
│   ├── logs.ts                     # Log viewer
│   ├── integrations.ts             # Integration management
│   ├── actions.ts                  # Action log
│   ├── amplify.ts                  # Cross-project amplification
│   ├── feedback.ts                 # User feedback
│   └── decision-detail.ts         # Single decision detail

src/services/
├── event-bus.ts                    # Process-wide EventEmitter for SSE push

src/ui/
├── main.tsx                        # React entry point
├── App.tsx                         # BrowserRouter + lazy routes
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx            # Root layout with SSE connection
│   │   ├── Sidebar.tsx             # 4-group navigation
│   │   ├── TopBar.tsx              # Breadcrumb, theme toggle
│   │   ├── LiveStrip.tsx           # Bottom status bar
│   │   └── SynthesisBanner.tsx     # Calibration progress
│   ├── shared/
│   │   ├── MetricDisplay.tsx       # R-1→R-4 metric card
│   │   ├── HeroMetric.tsx          # Large hero with maturity phase
│   │   ├── FreshnessBadge.tsx      # Data age indicator
│   │   ├── ComparisonBadge.tsx     # Delta with direction
│   │   ├── ConfidenceBadge.tsx     # Trust level
│   │   ├── NarrativeHeadline.tsx   # AI collaboration posture
│   │   ├── EvidenceDrawer.tsx      # Raw data inspection
│   │   ├── ActiveSessionPanel.tsx  # Live session tracking
│   │   ├── EventList.tsx           # Event display
│   │   ├── InsightCard.tsx         # Insight with evidence
│   │   ├── KpiCard.tsx             # Compact KPI tile
│   │   ├── DecisionTable.tsx       # Searchable decisions
│   │   ├── ProjectCard.tsx         # Repo status card
│   │   ├── CommandPalette.tsx      # ⌘K command overlay
│   │   ├── KeyboardShortcuts.tsx   # Shortcut reference
│   │   ├── CausalChain.tsx         # Causality visualization
│   │   ├── TerminalLog.tsx         # Log output
│   │   ├── EmptyState.tsx          # No-data placeholder
│   │   ├── PageTransition.tsx      # Page animation
│   │   └── Skeletons.tsx           # Loading skeletons
│   └── charts/
│       ├── AreaChart.tsx           # Time-series area chart
│       ├── SparkLine.tsx           # Inline trend
│       ├── RadarChart.tsx          # Multi-dimensional radar
│       └── Heatmap.tsx             # Activity heatmap
├── hooks/
│   ├── useSSE.ts                   # SSE connection lifecycle
│   ├── useSummary.ts               # Summary + interpretation
│   ├── useHealth.ts                # Health + SSE liveness
│   ├── useEvents.ts                # Live events + insights
│   ├── useIntelligence.ts          # 8 intelligence hooks
│   └── useProjects.ts             # Projects + repos + mutations
├── lib/
│   ├── api.ts                      # fetch wrapper, api namespace
│   ├── sse.ts                      # EventSource manager
│   ├── query-client.ts             # QueryClient singleton
│   ├── comparisons.ts              # R-2 comparison functions
│   ├── diagnostics.ts              # R-1 interpretation strings
│   ├── maturity.ts                 # Phase labels and colors
│   └── utils.ts                    # cn() class merge utility
├── stores/
│   └── app.ts                      # Zustand: theme, sidebar, project, persona
├── types/
│   ├── summary.ts                  # SummaryJson interface
│   ├── health.ts                   # HealthEvent, SystemHealth, RepoHealth
│   ├── events.ts                   # CapturedEvent, Insight, Narrative
│   ├── intelligence.ts             # Efficiency, Comprehension, Velocity, etc.
│   └── projects.ts                 # Project, RepoEntry, DiscoveredProject
├── styles/
│   └── globals.css                 # Tailwind + design tokens
└── pages/
    ├── HomePage.tsx                # Dashboard (global + project modes)
    ├── LivePage.tsx                # Real-time event stream
    ├── DistillPage.tsx             # Daily reasoning summaries
    ├── IntelligencePage.tsx        # 9-tab intelligence hub
    ├── DecisionsPage.tsx           # Decision log
    ├── ProfilePage.tsx             # Reasoning profile
    ├── CardsPage.tsx               # Visual identity cards
    ├── ProjectsPage.tsx            # Project management
    ├── SettingsPage.tsx            # LLM + daemon config
    ├── IntegrationsPage.tsx        # Integration management
    ├── LogsPage.tsx                # Log viewer
    └── setup/
        └── SetupWizard.tsx         # Multi-step onboarding
```

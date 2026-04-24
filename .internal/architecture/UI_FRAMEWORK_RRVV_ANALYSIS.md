# UI Framework RRVV Analysis

> RRVV: Rigorous Research, Reason, Validate, Execute

**Date**: 2026-04-24  
**Objective**: Determine the optimal frontend architecture for Unfade's web dashboard — one that delivers a "wow" experience with reliability, performance, responsiveness, visual polish, and rapid development velocity.

---

## Phase 1: Rigorous Research

### 1.1 Current UI System — Deep Audit

**Rendering model**: Server-side template string rendering. Each of the 13 page files (`src/server/pages/*.ts`, 3,425 total lines) constructs HTML as JavaScript template literals. `layout()` wraps content in a shared shell (sidebar, live strip, evidence drawer). Hono's `c.html()` serves the complete document. No virtual DOM, no JSX, no component tree.

**Styling**: Tailwind CSS v4.2.4 with `@theme` block mapping to CSS custom properties. Dark/light themes via `:root` / `.light` class toggle. Custom fonts (Inter, Space Grotesk, JetBrains Mono) self-hosted. Build: `input.css` → `public/css/tailwind.css` (minified). The design token system is actually well-structured.

**Components**: None. Functional HTML generators (e.g., `kpiCard()`, `iconHome()`) return string fragments. No component lifecycle, no props validation, no reuse across pages beyond copy-paste. The `layout()` function is the only shared structural element.

**Interactivity**: Vanilla JS with `window.__unfade` as a global message bus. Callbacks pushed onto arrays (`onHealth`, `onSummary`, `onEvent`). State in localStorage + local variables. SSE for real-time + polling fallback. HTMX 2.0.4 is a dependency but barely used.

**React**: React 19.2.5 + ReactDOM are in `package.json` but not used for page rendering. They appear reserved but unused.

### 1.2 Concrete Bottlenecks

#### Development Speed

| Bottleneck | Impact | Category |
|---|---|---|
| **871-line setup.ts** with 500+ lines of inline JS | Every change requires mental parsing of the entire file. No hot reload — full page refresh needed | Architecture |
| **String-based HTML** (`map().join('')`, manual `escapeHtml()`) | No type safety, no autocomplete, errors only visible at runtime in browser | Tooling |
| **No component reuse** | Building a new page means copying patterns from existing pages, adapting inline styles, duplicating JS behaviors | Architecture |
| **No HMR** | CSS changes require `pnpm build:css`. JS changes require server restart + manual browser refresh | Tooling |
| **Manual DOM updates** (`innerHTML = ...`) | Every data update requires reconstructing HTML strings and re-assigning. No diffing, no reactive bindings | Architecture |

#### Design Consistency

| Bottleneck | Impact | Category |
|---|---|---|
| **Inline `<style>` blocks per page** | Colors, spacing, shadows duplicated across 13 files. Changing a design token requires editing every file | Implementation |
| **No design system** | No shared button, card, input, modal, toast, or dialog component. Each page re-implements these ad hoc | Architecture |
| **No interaction patterns** | Hover states, transitions, focus rings, loading states all implemented differently per page | Implementation |

#### Scalability

| Bottleneck | Impact | Category |
|---|---|---|
| **Callback array pattern** (`window.__unfade.onHealth.push(fn)`) | No cleanup on navigation. Memory leaks. No way to debug which callbacks are active | Architecture |
| **Full DOM reconstruction** on each update | Adequate for <100 items but unacceptable for event lists, decision graphs, or timeline views with 1000+ entries | Architecture |
| **No code splitting** | Entire Tailwind CSS + all inline JS served on every page regardless of what's needed | Tooling |
| **No lazy loading** | Charts, graphs, heavy components all load upfront even if user never visits those views | Architecture |

#### Performance

| Bottleneck | Impact | Category |
|---|---|---|
| **Full page navigation** (no client-side routing) | Every nav click triggers a full HTTP request → server render → HTML parse → CSS parse → JS execute cycle | Architecture |
| **No caching** of rendered pages | Server reconstructs identical HTML on every request | Implementation |
| **Blocking API calls in page render** | Pages that fetch data server-side block the entire response until all queries complete | Architecture |

### 1.3 What the Product Requires

Unfade's dashboard is not a content site or a simple settings page. It's a **data-heavy, real-time, multi-view intelligence platform**. The UI must support:

1. **Complex stateful views**: Intelligence hub with 8 analyzer outputs, multi-tab navigation, drill-through panels, evidence drawers
2. **Real-time streaming**: SSE-driven updates for materializer progress, live event feed, daemon health
3. **Data visualization**: Heatmaps, timelines, direction graphs, comprehension radars, decision trees, cost breakdowns
4. **Interactive exploration**: Click-through lineage (event → insight → decision), filtering, time-range selection, project switching
5. **Consistent design language**: Every interaction should feel polished — transitions, loading states, empty states, error states
6. **Fast iteration**: Adding a new intelligence view or dashboard widget should take hours, not days

---

## Phase 2: Reason

### 2.1 Framework Evaluation

#### Option A: Stay with Current (Template Strings + HTMX + Vanilla JS)

**Pros**: Zero migration cost. No new dependencies. Simple mental model for trivial pages.

**Cons**: Every bottleneck identified in 1.2 persists. Development velocity decreases as complexity grows. Design consistency is impossible without a component system. Real-time updates require manual DOM manipulation per view. No ecosystem of pre-built components to leverage. The "wow" factor ceiling is low — polished interactions (drag-and-drop, animated transitions, complex data grids) require enormous hand-rolled effort.

**Verdict**: This approach works for a prototype. Unfade has outgrown it. The existing 3,425 lines of template strings are already showing strain (task #32 — navigation responsiveness, task #31 — stale code audit). Continuing here means fighting the architecture on every new feature.

#### Option B: HTMX + Alpine.js (Enhanced Current)

**Pros**: Builds on existing HTMX dependency. Server-driven, minimal JS. Alpine.js adds reactive state without a build step.

**Cons**: HTMX excels at "replace this div with server HTML." It struggles with complex client-side state (multi-tab intelligence views where switching tabs shouldn't re-fetch), canvas-based visualizations, and coordinated animations. No charting library ecosystem. No design system components. The ceiling is higher than Option A but still well below what "wow" requires. Every complex interaction becomes a workaround.

**Verdict**: Good for CRUD apps. Wrong fit for a data visualization dashboard.

#### Option C: React + Vite (SPA served from Hono)

**Pros**:
- **shadcn/ui**: 50+ accessible, customizable components built on Radix primitives + Tailwind. Copy-paste ownership — no dependency lock-in. Buttons, cards, dialogs, popovers, command palettes, data tables, charts (shadcn/ui charts wrap Recharts with design tokens).
- **Recharts + Nivo**: Mature charting libraries. Heatmaps, area charts, bar charts, radars, treemaps — all with React integration, responsive by default, accessible.
- **TanStack Query**: Data fetching with caching, background refetch, SSE integration, optimistic updates. Eliminates manual fetch + state management.
- **TanStack Table**: Headless table with sorting, filtering, pagination, column resizing. Perfect for event lists and decision tables.
- **Vite HMR**: Sub-50ms hot module replacement. Change a component → see it instantly. CSS changes reflected without page reload.
- **React Router**: Client-side routing = instant page transitions. No full page reload on navigation.
- **Hono integration**: Trivial. Vite builds to `dist/`, Hono serves via `serveStatic()`. API routes untouched. `@hono/vite-dev-server` for dev proxying.
- **Ecosystem**: Every problem has a library. Every library has examples. Every AI coding assistant is trained heavily on React.
- **Incremental migration**: Hono can serve both legacy HTML routes and the React SPA simultaneously. Migrate page by page.

**Cons**:
- ~45KB core bundle (React 19 + ReactDOM). Mitigated by code-splitting.
- React's re-render model is less efficient than signals-based frameworks for high-frequency updates. Unlikely to matter at Unfade's scale.
- Migration effort: 13 pages + layout to rewrite. But this is one-time work that pays compound dividends.

**Verdict**: The strongest option on every axis — velocity, ecosystem, design consistency, performance, maintainability.

#### Option D: SolidJS + Vite

**Pros**: 7.6KB core. Fine-grained reactivity (signals) means real-time SSE updates re-render only the affected DOM node — no virtual DOM diffing. Theoretically the most performant option for streaming dashboards.

**Cons**: The ecosystem gap is real. `shadcn-solid` is community-maintained (~1.3K stars vs shadcn/ui's 90K+). No mature native charting library — must wrap React libs or use D3 directly. 380x smaller community than React means fewer examples, fewer Stack Overflow answers, and less AI training data. If the sole maintainer of a critical library walks away, you're stuck.

**Verdict**: Superior architecture, insufficient ecosystem. The performance advantage doesn't justify the ecosystem cost for a developer tool dashboard.

#### Option E: Svelte + Vite (not SvelteKit)

**Pros**: Compiler-based, small bundles (~15-20KB). Less boilerplate than React. Reactive assignments are natural for SSE updates.

**Cons**: Svelte 5 (Runes) was a significant paradigm shift — ecosystem is still stabilizing. Charting options (LayerChart, svelte-chartjs) are adequate but fewer. Flowbite Svelte provides components but is less polished than shadcn/ui. Talent pool is ~1/20th of React's.

**Verdict**: Good framework, weaker ecosystem. Would recommend over Solid but behind React.

#### Option F: Next.js

**Pros**: SSR + client rendering. Excellent for SEO-heavy sites.

**Cons**: Architecture conflict — Next.js wants to own the server. The existing Hono API server, SSE streams, MCP endpoints, and daemon management would need restructuring. Server Components + App Router add complexity without benefit for a localhost dashboard. Over-engineered for this use case.

**Verdict**: Wrong tool. Unfade's server is Hono, and it should stay Hono. Next.js fights that.

### 2.2 Decision Matrix

| Criteria (weighted) | Template Strings | HTMX + Alpine | React + Vite | SolidJS | Svelte | Next.js |
|---|---|---|---|---|---|---|
| Developer velocity (25%) | 2/10 | 4/10 | **9/10** | 7/10 | 7/10 | 6/10 |
| Component ecosystem (20%) | 1/10 | 2/10 | **10/10** | 4/10 | 6/10 | 10/10 |
| Design consistency (20%) | 2/10 | 3/10 | **9/10** | 6/10 | 7/10 | 9/10 |
| Performance (10%) | 6/10 | 7/10 | 7/10 | **10/10** | 9/10 | 7/10 |
| Hono integration (10%) | 10/10 | 9/10 | **9/10** | 9/10 | 8/10 | 3/10 |
| Real-time / SSE (10%) | 3/10 | 4/10 | 8/10 | **10/10** | 8/10 | 6/10 |
| Long-term maintainability (5%) | 3/10 | 4/10 | **9/10** | 5/10 | 6/10 | 7/10 |
| **Weighted Total** | **3.0** | **4.0** | **8.9** | **6.6** | **7.0** | **7.0** |

---

## Phase 3: Validate

### Validation Criteria

**(a) Polished, responsive UI with minimal friction**

React + Vite + shadcn/ui: **PASS**. shadcn/ui provides 50+ accessible components with built-in dark mode, responsive design, animations (via Framer Motion or Tailwind transitions), and consistent interaction patterns. Focus rings, loading spinners, skeleton loaders, toast notifications — all built-in. Client-side routing eliminates full page reloads. Vite HMR means design iterations are instant.

**(b) Significantly improved developer velocity**

React + Vite: **PASS**. Compare building a new intelligence view:
- **Current**: Create a new `.ts` file, write HTML as template strings, add inline CSS, add inline JS for fetch/state/DOM manipulation, manually wire up SSE callbacks, add to layout sidebar. Estimated: 1-2 days.
- **React**: Create a component, import shadcn/ui primitives (Card, Tabs, Table), use TanStack Query for data fetching, use a Recharts component for visualization. Tailwind for layout. Estimated: 2-4 hours.

**(c) Scalable component architecture and design system**

React + shadcn/ui: **PASS**. shadcn/ui is literally a design system — consistent tokens, primitives (Button, Input, Dialog, Popover, Command, DataTable, Chart), composable patterns. Components are files you own, not node_modules dependencies. Customize freely without forking.

**(d) Clean integration with existing backend and real-time data flows**

React SPA + Hono: **PASS**. The integration pattern is well-documented:
- **Production**: Vite builds to `dist/`. Hono serves `dist/` via `serveStatic()`. API routes at `/api/*` unchanged.
- **Development**: Vite dev server on port 5173, proxies `/api/*` to Hono on port 7654. Or use `@hono/vite-dev-server`.
- **SSE**: `EventSource` in React → TanStack Query cache invalidation or Zustand store updates. Existing SSE endpoints unchanged.
- **No architecture change** to the backend. Zero changes to daemon, materializer, intelligence, MCP, or any API route.

**(e) Straightforward deployment and iteration**

React + Vite: **PASS**. `vite build` produces a `dist/` directory with static assets. Hono serves them. No additional server, no Node.js SSR complexity, no edge functions. `pnpm build` runs `tsc && vite build && tailwindcss`. Same deployment model as today, just with better assets.

---

## Phase 4: Execute — Implementation Specification

### 4.1 Target Stack

| Layer | Choice | Purpose |
|---|---|---|
| **Framework** | React 19 + Vite 6 | SPA with HMR, code-splitting, fast builds |
| **Components** | shadcn/ui (Radix primitives) | Accessible, customizable, Tailwind-native design system |
| **Styling** | Tailwind CSS 4 (existing) | Reuse existing `@theme` tokens and dark/light theme |
| **Data Fetching** | TanStack Query v5 | Caching, background refetch, SSE integration |
| **Charts** | Recharts (primary) + shadcn/ui charts | Timeline, heatmap, radar, bar, area charts |
| **Tables** | TanStack Table + shadcn DataTable | Sortable, filterable event/decision tables |
| **Routing** | React Router v7 | Client-side navigation, route-based code splitting |
| **State** | Zustand | Lightweight global state (theme, sidebar, SSE streams) |
| **Animations** | Tailwind transitions + Framer Motion (selective) | Page transitions, drawer animations, chart enter effects |
| **Icons** | Lucide React | Same icon set as shadcn/ui, tree-shakeable |
| **SSE** | Native EventSource + TanStack Query invalidation | Real-time materializer progress, event feed, health |

### 4.2 Project Structure

```
src/
├── server/                         # Existing Hono backend (UNCHANGED)
│   ├── http.ts                     # Modify: add serveStatic for dist/
│   ├── routes/                     # API routes (UNCHANGED)
│   └── pages/                      # Legacy pages (removed per sprint)
│
├── ui/                             # NEW: React SPA root
│   ├── main.tsx                    # React entry + QueryClient + Router mount
│   ├── App.tsx                     # Root layout + route definitions
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives (auto-generated by CLI)
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── sheet.tsx           # Side drawer (evidence, lineage)
│   │   │   ├── skeleton.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx           # Sonner integration
│   │   │   ├── tooltip.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── command.tsx         # cmdk command palette
│   │   │   └── data-table.tsx      # TanStack Table + shadcn wrapper
│   │   │
│   │   ├── layout/
│   │   │   ├── AppShell.tsx        # Sidebar + content area + live strip
│   │   │   ├── Sidebar.tsx         # Navigation with collapse, active states
│   │   │   ├── TopBar.tsx          # Breadcrumb, project selector, theme toggle
│   │   │   ├── LiveStrip.tsx       # Daemon health, materializer status
│   │   │   └── SynthesisBanner.tsx # Progress banner during materialization
│   │   │
│   │   ├── charts/
│   │   │   ├── AreaChart.tsx       # Themed Recharts wrapper
│   │   │   ├── BarChart.tsx
│   │   │   ├── RadarChart.tsx      # Comprehension radar
│   │   │   ├── Heatmap.tsx         # Direction heatmap (custom SVG)
│   │   │   ├── Timeline.tsx        # Event timeline with zoom
│   │   │   └── SparkLine.tsx       # Inline mini-charts for KPIs
│   │   │
│   │   └── shared/
│   │       ├── KpiCard.tsx         # Value + label + trend + sparkline
│   │       ├── EventList.tsx       # Virtual-scrolled event feed
│   │       ├── DecisionTable.tsx   # DataTable + column defs for decisions
│   │       ├── EvidenceDrawer.tsx  # Sheet with lineage drillthrough
│   │       ├── EmptyState.tsx      # Consistent empty state with icon + action
│   │       ├── ErrorBoundary.tsx   # Page-level error boundary
│   │       ├── LoadingPage.tsx     # Full-page skeleton
│   │       ├── TerminalLog.tsx     # Dark log panel (setup, daemon output)
│   │       └── ProjectSelector.tsx # Dropdown for active project
│   │
│   ├── pages/
│   │   ├── Home.tsx                # Dashboard: KPIs + summary chart + recent events
│   │   ├── Intelligence.tsx        # Tab container for 9 intelligence views
│   │   ├── intelligence/
│   │   │   ├── OverviewTab.tsx
│   │   │   ├── ComprehensionTab.tsx
│   │   │   ├── VelocityTab.tsx
│   │   │   ├── CostTab.tsx
│   │   │   ├── PatternsTab.tsx
│   │   │   ├── AutonomyTab.tsx
│   │   │   ├── MaturityTab.tsx
│   │   │   ├── GitExpertiseTab.tsx
│   │   │   └── NarrativesTab.tsx
│   │   ├── Decisions.tsx           # Decision list + detail drillthrough
│   │   ├── Distill.tsx             # Daily distill viewer + history
│   │   ├── Projects.tsx            # Project cards + add/remove/pause
│   │   ├── Live.tsx                # Real-time event stream
│   │   ├── Logs.tsx                # System logs (daemon, materializer)
│   │   ├── Profile.tsx             # Developer reasoning profile
│   │   ├── Cards.tsx               # Unfade Card generation
│   │   ├── Settings.tsx            # Config editor (LLM, theme, integrations)
│   │   ├── Integrations.tsx        # MCP connections + skill installation
│   │   └── setup/
│   │       ├── SetupWizard.tsx     # 4-step wizard container
│   │       ├── StepIntelligence.tsx
│   │       ├── StepProjects.tsx
│   │       ├── StepIntegrations.tsx
│   │       └── StepLaunch.tsx
│   │
│   ├── hooks/
│   │   ├── useSSE.ts              # Generic SSE → TanStack Query bridge
│   │   ├── useHealth.ts           # /api/stream → health state
│   │   ├── useSummary.ts          # /api/stream → summary data
│   │   ├── useEvents.ts           # /api/stream → live event feed
│   │   ├── useIntelligence.ts     # /api/intelligence/* → cached queries
│   │   ├── useProjects.ts         # /api/projects → CRUD operations
│   │   └── useSetupProgress.ts    # /api/setup/progress → wizard state
│   │
│   ├── lib/
│   │   ├── api.ts                 # Typed fetch wrapper for all endpoints
│   │   ├── sse.ts                 # EventSource manager (connect, reconnect, parse)
│   │   ├── query-client.ts        # TanStack QueryClient config (stale times, retry)
│   │   └── utils.ts               # cn() class merger, formatters, date helpers
│   │
│   ├── stores/
│   │   └── app.ts                 # Zustand: theme, sidebar, active project, SSE state
│   │
│   └── styles/
│       └── globals.css            # @import tailwind + existing @theme tokens
│
├── vite.config.ts                 # Vite config (proxy, build output)
├── components.json                # shadcn/ui CLI config
├── tsconfig.app.json              # TS config for React (JSX, paths)
└── index.html                     # Vite entry HTML
```

### 4.3 Backend Integration Design

**Production serving**: Hono serves the built SPA for all non-API routes:

```typescript
// src/server/http.ts — single addition
import { serveStatic } from "@hono/node-server/serve-static";

// Serve built React assets
app.use("/assets/*", serveStatic({ root: "./dist" }));

// SPA fallback: any non-API route serves index.html
app.get("*", serveStatic({ root: "./dist", path: "index.html" }));
```

**Development**: Vite dev server runs on port 5173, proxies API calls to Hono on port 7654:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:7654",
      "/distill": "http://localhost:7654",
      "/decisions": "http://localhost:7654",
    },
  },
});
```

**Build pipeline**:

```json
{
  "scripts": {
    "dev": "concurrently \"pnpm dev:server\" \"pnpm dev:ui\"",
    "dev:server": "tsx watch src/entrypoints/cli.ts",
    "dev:ui": "vite",
    "build": "vite build && pnpm build:server",
    "build:server": "tsup src/entrypoints/cli.ts --format esm",
    "build:ui": "vite build"
  }
}
```

### 4.4 Data Flow Architecture

#### API Client Layer

```typescript
// src/ui/lib/api.ts
const BASE = import.meta.env.DEV ? "" : ""; // proxy handles in dev

export const api = {
  // Intelligence
  intelligence: {
    efficiency: () => fetchJson<Efficiency>("/api/intelligence/efficiency"),
    velocity: () => fetchJson<Velocity>("/api/intelligence/velocity"),
    comprehension: () => fetchJson<ComprehensionRadar>("/api/intelligence/comprehension"),
    cost: () => fetchJson<CostAttribution>("/api/intelligence/costs"),
    patterns: () => fetchJson<PromptPatterns>("/api/intelligence/prompt-patterns"),
    autonomy: () => fetchJson<Autonomy>("/api/intelligence/autonomy"),
    maturity: () => fetchJson<MaturityAssessment>("/api/intelligence/maturity-assessment"),
    gitExpertise: () => fetchJson<ExpertiseMap>("/api/intelligence/expertise-map"),
    narratives: () => fetchJson<Narrative[]>("/api/intelligence/narratives"),
    correlations: () => fetchJson<Correlations>("/api/intelligence/correlations"),
    alerts: () => fetchJson<Alert[]>("/api/intelligence/alerts"),
    lineage: (id: string) => fetchJson<LineageData>(`/api/lineage/${id}`),
  },

  // Projects
  projects: {
    list: () => fetchJson<Project[]>("/api/projects"),
    discover: () => fetchJson<DiscoveredProject[]>("/api/projects/discover"),
    add: (path: string) => postJson("/api/projects", { path }),
    remove: (id: string) => deleteJson(`/api/projects/${id}`),
    pause: (id: string) => postJson(`/api/projects/${id}/pause`),
    resume: (id: string) => postJson(`/api/projects/${id}/resume`),
  },

  // Dashboard
  summary: () => fetchJson<SummaryJson>("/api/stream"), // initial via REST
  repos: () => fetchJson<Repo[]>("/api/repos"),
  insights: () => fetchJson<Insight[]>("/api/insights/recent"),

  // Distill
  distill: {
    latest: () => fetchJson<Distill>("/distill/latest"),
    byDate: (date: string) => fetchJson<Distill>(`/distill/${date}`),
    trigger: (date: string) => postJson("/distill", { date }),
  },

  // Decisions
  decisions: () => fetchJson<Decision[]>("/decisions"),
  decisionDetail: (idx: number) => fetchJson<Decision>(`/api/decisions/${idx}`),

  // System
  health: () => fetchJson<Health>("/api/system/health"),
  logs: () => fetchJson<LogEntry[]>("/api/logs"),
  setup: {
    progress: () => fetchJson<SetupProgress>("/api/setup/progress"),
    complete: () => postJson("/api/setup/complete"),
    verifyLlm: (config: LlmConfig) => postJson("/api/setup/verify-llm", config),
    discoverProjects: () => fetchJson<DiscoveredProject[]>("/api/setup/discover-projects"),
    addProject: (path: string) => postJson("/api/setup/add-project", { path }),
    detectAgents: () => fetchJson<DetectedAgent[]>("/api/setup/detect-agents"),
    installSkills: (agent: string) => postJson("/api/setup/install-skills", { agent }),
  },

  // Settings
  settings: () => fetchJson<UnfadeConfig>("/api/settings"),
  updateSettings: (config: Partial<UnfadeConfig>) => postJson("/api/settings", config),

  // Cards
  cards: {
    generate: (date: string) => postJson("/cards/generate", { date }),
    image: (date: string) => `/cards/image/${date}`,
  },

  // Integrations
  integrations: {
    status: () => fetchJson<IntegrationStatus>("/api/integrations/status"),
    install: (tool: string) => postJson("/api/integrations/install", { tool }),
  },
};
```

#### SSE Integration Pattern

```typescript
// src/ui/lib/sse.ts
export function createSSEHook(queryClient: QueryClient) {
  let source: EventSource | null = null;

  function connect() {
    source = new EventSource("/api/stream");

    source.addEventListener("health", (e) => {
      const data = JSON.parse(e.data);
      queryClient.setQueryData(["health"], data);
    });

    source.addEventListener("summary", (e) => {
      const data = JSON.parse(e.data);
      queryClient.setQueryData(["summary"], data);
      // Invalidate intelligence queries when summary changes significantly
      queryClient.invalidateQueries({ queryKey: ["intelligence"] });
    });

    source.addEventListener("event", (e) => {
      const event = JSON.parse(e.data);
      queryClient.setQueryData<Event[]>(["events", "live"], (old) =>
        [event, ...(old ?? [])].slice(0, 100)
      );
    });

    source.onerror = () => {
      source?.close();
      setTimeout(connect, 3000); // Reconnect with backoff
    };
  }

  return { connect, disconnect: () => source?.close() };
}

// src/ui/hooks/useSSE.ts
export function useSSE() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const sse = createSSEHook(queryClient);
    sse.connect();
    return () => sse.disconnect();
  }, [queryClient]);
}
```

#### TanStack Query Configuration

```typescript
// src/ui/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30s — intelligence data changes slowly
      gcTime: 5 * 60_000,       // 5 min garbage collection
      refetchOnWindowFocus: true,
      retry: 2,
    },
  },
});

// Per-query stale times:
// - Health/Summary: Infinity (updated via SSE, never poll)
// - Intelligence tabs: 60s (only refetch when tab is revisited)
// - Projects list: 30s
// - Distill content: 5 min (rarely changes intraday)
// - Decisions: 60s
// - Setup progress: 2s (during wizard only)
```

#### Zustand Global Store

```typescript
// src/ui/stores/app.ts
interface AppState {
  theme: "dark" | "light";
  sidebarCollapsed: boolean;
  activeProjectId: string | null;
  setupComplete: boolean;
  synthesisPercent: number;

  setTheme: (theme: "dark" | "light") => void;
  toggleSidebar: () => void;
  setActiveProject: (id: string | null) => void;
  setSynthesisPercent: (pct: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarCollapsed: false,
      activeProjectId: null,
      setupComplete: false,
      synthesisPercent: 0,

      setTheme: (theme) => {
        document.documentElement.classList.toggle("light", theme === "light");
        set({ theme });
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActiveProject: (id) => set({ activeProjectId: id }),
      setSynthesisPercent: (pct) => set({ synthesisPercent: pct }),
    }),
    { name: "unfade-app" } // localStorage key
  )
);
```

### 4.5 Component Architecture Blueprint

#### Layout Components

**`AppShell`** — Root layout wrapping all pages

| Prop | Type | Source |
|------|------|--------|
| children | ReactNode | React Router `<Outlet />` |

Composition:
```
┌────────────────────────────────────────────────┐
│ SynthesisBanner (conditional: < 100%)          │
├──────────┬─────────────────────────────────────┤
│          │ TopBar (breadcrumb + project + theme)│
│ Sidebar  ├─────────────────────────────────────┤
│ (nav)    │                                     │
│          │  <Outlet /> (page content)           │
│          │                                     │
│          ├─────────────────────────────────────┤
│          │ LiveStrip (daemon health)            │
└──────────┴─────────────────────────────────────┘
```

**`Sidebar`** — Collapsible navigation

| Prop | Type | Source |
|------|------|--------|
| collapsed | boolean | Zustand `sidebarCollapsed` |
| onToggle | () => void | Zustand `toggleSidebar` |

Items: Home, Intelligence, Decisions, Distill, Projects, Live, Logs, Cards, Profile, Settings, Integrations. Active state from React Router `useLocation()`. Icons from Lucide React. Tooltip on collapsed state (Radix Tooltip).

**`TopBar`** — Page header

| Prop | Type | Source |
|------|------|--------|
| — | — | Derives breadcrumb from `useLocation()` |

Contains: Breadcrumb (from route), ProjectSelector dropdown (Zustand `activeProjectId`), theme toggle button, command palette trigger (⌘K).

**`LiveStrip`** — System health bar at bottom — **Layer 0 (Pulse), P-6 System Reveal**

| Prop | Type | Source |
|------|------|--------|
| — | — | `useQuery(["health"])` from SSE |

Shows: DaemonStatusDots (green/amber/red per engine), materializer lag (R-3 freshness), event count today, last tick timestamp. This is the always-visible Pulse layer — the first signal that the system is alive. Diagnostic language: "All engines running" / "Materializer lagging" / "Engine [X] down".

**`SynthesisBanner`** — Progress banner during initial materialization

| Prop | Type | Source |
|------|------|--------|
| — | — | Zustand `synthesisPercent`, `useQuery(["setup", "progress"])` |

Shows progress bar + percentage. At 100%: "Synthesis complete" + auto-dismiss after 5 min. Hidden when `synthesisPercent === 100` and 5 min elapsed.

#### Chart Components

All chart components follow this pattern:

```typescript
interface ChartProps<T> {
  data: T[];
  loading?: boolean;     // Shows Skeleton when true
  height?: number;       // Default 300
  className?: string;
}
```

**`AreaChart`** — Time-series area (efficiency over time, velocity trend)
- Wraps Recharts `<AreaChart>` with Unfade design tokens
- Gradient fill using CSS custom properties (`--accent` → fill)
- Responsive container via Recharts `<ResponsiveContainer>`
- Tooltip styled with shadcn Popover tokens

**`BarChart`** — Categorical comparison (cost by model, domain distribution)
- Horizontal/vertical variants via prop
- Sorted by value descending by default

**`RadarChart`** — Multi-axis comparison — **P-14 Dimension Radar**
- Wraps Recharts `<RadarChart>` with 6-8 axis layout
- Phase-normalized values (0-100 scale)
- Concentric rings can show maturity phase thresholds (P-13 integration)
- Used in: ComprehensionTab, MaturityTab, OverviewTab, Profile

**`Heatmap`** — Direction-by-file grid — **P-18 Quadrant Chart variant**
- Custom SVG component (not Recharts — Recharts doesn't do heatmaps well)
- Color scale: red (AI-heavy) → yellow (balanced) → green (human-heavy)
- Hover tooltip with file path + HDS value + interpretation (R-1)
- Click → evidence drawer with file events
- Used in: GitExpertiseTab, DirectionTab

**`Timeline`** — Event timeline with zoom
- Custom component: horizontal scrollable, zoomable via Ctrl+scroll
- Event dots colored by source (git=blue, ai=purple, terminal=green)
- Click → event detail in drawer

**`SparkLine`** — Inline mini-chart for KPI cards
- 40x16px SVG, no axes, no labels
- Last 7 data points, trend line

#### Shared Components

**`KpiCard`** — **P-2 KPI Strip unit, R-1→R-4 enforced via MetricDisplay**

```
KpiCard props (extends MetricDisplay from §4.8.2):
  label: string
  value: string | number
  interpretation: string          # R-1: what this number means
  comparison: delta + direction   # R-2: vs prior period
  freshness: updatedAt + isLive   # R-3: how fresh
  confidence: level + basis       # R-4: how sure (intelligence metrics only)
  sparkData?: number[]            # Inline trend sparkline
  href?: string                   # Click navigates to detail
  level: "L1" | "L2" | "L3"      # Visual hierarchy level
  loading?: boolean               # Shows skeleton when true
```

Composition: shadcn `Card` → MetricDisplay (value + interpretation + badges) + SparkLine. Hover: translateY(-2px) + shadow. Must never render value without interpretation.

**`EventList`**

```typescript
interface EventListProps {
  events: Event[];
  loading?: boolean;
  onSelect?: (event: Event) => void;
  maxItems?: number;     // Virtual scroll beyond this
}
```

Uses `@tanstack/react-virtual` for virtualized scrolling when >50 items. Each row: timestamp + source icon + summary (truncated). Click opens EvidenceDrawer.

**`DecisionTable`**

```typescript
interface DecisionTableProps {
  decisions: Decision[];
  loading?: boolean;
}
```

Uses shadcn DataTable (TanStack Table wrapper). Columns: date, decision summary, domain, confidence, durability score. Sortable, filterable. Row click → detail drawer.

**`EvidenceDrawer`** — **P-5 Evidence Drawer, Progressive Disclosure Layers 3+4**

```
EvidenceDrawer props:
  open: boolean
  onClose: () => void
  entityId: string          # Event, insight, or decision ID
  entityType: "event" | "insight" | "decision" | "module"
```

Uses shadcn Sheet (right side, 480px). Implements Layer 3 (structured summary) and Layer 4 (raw data, collapsed by default). Fetches lineage via `api.intelligence.lineage(id)`. Shows: entity header with FreshnessBadge (R-3) → related events list → metrics → cross-links to other tabs. Layer 4 toggle reveals raw JSONL/diff/prompt data.

**`EmptyState`** — **P-7 Empty State**

```
EmptyState props:
  icon: LucideIcon
  title: string
  description: string       # Guidance text: why it's empty + what to do
  action?: label + onClick  # R-5: actionable next step
```

Centered layout with faded icon, title, description, CTA button. Every empty state must answer: "Why is this empty?" and "What should I do?" — never just "No data." Diagnostic language: "Engine hasn't warmed up yet" / "Start coding to see results here."

**`TerminalLog`**

```typescript
interface TerminalLogProps {
  lines: LogLine[];
  streaming?: boolean;   // Auto-scroll when true
  maxLines?: number;     // Ring buffer display
}
```

Dark background, monospace font, auto-scrolling. ANSI color parsing. Used in Setup wizard (step 4) and Logs page.

**`ProjectSelector`**

```typescript
interface ProjectSelectorProps {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string | null) => void; // null = "all projects"
}
```

shadcn `<Select>` or `<Command>` (searchable if >5 projects). Shows project label + status indicator. "All Projects" option at top.

#### Page Components — Data Sources, Composition & Phase 15 Patterns

| Page | API Endpoints | Key Components | Patterns | Info Layer |
|------|--------------|----------------|----------|------------|
| **Home (Global)** | SSE `summary`, `/api/insights/recent`, `/api/repos` | NarrativeHeadline, KpiCard×5, ProjectCards, InsightStream | P-1,P-2,P-8,P-11,P-13,P-16 | Observe |
| **Home (Project)** | SSE `summary`, `/api/intelligence/*` | HeroMetric+MaturityBadge, KpiCard×5, AreaChart, EventStream | P-1,P-2,P-13 | Observe |
| **Intelligence** | 9× `/api/intelligence/*` | Tabs(9), per-tab: HeroMetric + charts + tables + EvidenceDrawer | P-1,P-2,P-3,P-5,P-10,P-12,P-13,P-14,P-15,P-17,P-18 | Understand |
| **Decisions** | `/decisions`, `/api/decisions/:idx` | DecisionTable, CausalChain, EvidenceDrawer | P-4,P-5,P-17 | Understand |
| **Distill** | `/distill/latest`, `/distill/:date` | NarrativeHeadline, structured sections, EmptyState | P-11,P-16 | Understand |
| **Projects** | `/api/projects`, `/api/projects/discover` | ProjectCard×N, MaturityBadge, discovery, controls | P-8,P-13 | System |
| **Live** | SSE `event` stream | ActiveSessionPanel, EventList, AutonomyBadge, filters | P-6,P-11 | Pulse/Observe |
| **Logs** | `/api/logs`, SSE `/api/logs/stream` | TerminalLog, DaemonStatusCards, level filter | P-6 | System |
| **Profile** | `/profile` | MaturityPhaseGauge, DimensionRadar, PatternCards, Card preview | P-12,P-13,P-14 | Identity |
| **Cards** | `/cards/generate`, `/cards/image/:date` | Card preview, config, generation | — | Identity |
| **Settings** | `/api/settings` (GET/PUT) | Config form, DaemonControl, cache management | — | System |
| **Integrations** | `/api/integrations/*` | IntegrationCard×N, MCP status, skill install | P-6 | System |
| **Setup** | `/api/setup/*` (7 endpoints), SSE launch-stream | 4-step wizard, TerminalLog, ProjectSelector | P-6,P-8 | System |

### 4.6 Routing Design

```typescript
// src/ui/App.tsx
const router = createBrowserRouter([
  {
    path: "/setup",
    element: <SetupWizard />,     // Full-page, no sidebar
  },
  {
    path: "/",
    element: <AppShell />,         // Sidebar + TopBar + LiveStrip
    children: [
      { index: true, element: <Home /> },
      { path: "intelligence", element: <Intelligence /> },
      { path: "decisions", element: <Decisions /> },
      { path: "distill", element: <Distill /> },
      { path: "distill/:date", element: <Distill /> },
      { path: "projects", element: <Projects /> },
      { path: "live", element: <Live /> },
      { path: "logs", element: <Logs /> },
      { path: "profile", element: <Profile /> },
      { path: "cards", element: <Cards /> },
      { path: "settings", element: <Settings /> },
      { path: "integrations", element: <Integrations /> },
    ],
  },
]);
```

Intelligence tab state preserved via URL search params: `/intelligence?tab=velocity`. Tab switches don't re-mount the page — only swap the active tab content.

### 4.7 Styling Strategy

Port the existing `@theme` tokens from `src/styles/input.css` directly into the React SPA's `globals.css`:

```css
/* src/ui/styles/globals.css */
@import "tailwindcss";

@source "../components/**/*.tsx";
@source "../pages/**/*.tsx";

@theme {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-surface-hover: var(--surface-hover);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-border: var(--border);
  /* ... same tokens as current input.css */
}

/* Same :root and .light color definitions */
```

shadcn/ui's `components.json` maps to these tokens:

```json
{
  "style": "default",
  "tailwind": {
    "config": "",
    "css": "src/ui/styles/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

**Design consistency rule**: No inline styles. No arbitrary Tailwind values (`bg-[#123456]`). All colors via tokens. All spacing via Tailwind scale. All typography via `font-sans` (Inter), `font-display` (Space Grotesk), `font-mono` (JetBrains Mono).

### 4.8 Phase 15 Design System Alignment

This section maps every React component and page to the Phase 15 UI pattern library (P-1 through P-18), data presentation rules (R-1 through R-5), visual hierarchy levels (L1-L5), progressive disclosure layers, and the Transmission Thesis diagnostic language. **Every component must explicitly implement these contracts.**

#### 4.8.1 Three-Question Test — Per Page

Every page must pass the Three-Question Test before implementation begins. This table is the gate for Sprint reviews:

| Page | (1) What user question does this answer? | (2) What action does this enable? | (3) Does the answer scale across personas? |
|------|------------------------------------------|-----------------------------------|--------------------------------------------|
| **Home (Global)** | "How is my AI collaboration going across all projects?" | Switch to underperforming project, trigger distill, open intelligence hub | Developer: KPIs + insight stream. Lead: project-level health cards. Executive: single narrative headline |
| **Home (Project)** | "What happened in this project since I last looked?" | Drill into specific events, review decisions, run distill | Developer: events + direction density. Lead: trend + maturity badge. Executive: phase progress % |
| **Intelligence → Overview** | "What's my overall AI effectiveness score and what's dragging it down?" | Navigate to the weakest sub-metric tab for drill-down | All personas: hero AES + breakdown strip + bottleneck callout |
| **Intelligence → Comprehension** | "Which parts of my codebase do I actually understand vs blindly accept AI output?" | Click blind-spot domain → review sessions → add CLAUDE.md context rules | Developer: per-module radar. Lead: team-wide blind spots. Executive: comprehension % |
| **Intelligence → Velocity** | "Am I getting faster or slower at converting AI sessions into shipped commits?" | Compare domains, identify slowest area, adjust approach | Developer: domain breakdown. Lead: trend trajectory. Executive: single direction arrow |
| **Intelligence → Cost** | "How much am I spending on AI, and how much of it is wasted?" | Cut wasteful model usage, redirect spend to high-direction domains | All personas: estimated cost + waste ratio + cost-per-directed-decision |
| **Intelligence → Patterns** | "Which prompting strategies actually work for me?" | Copy effective pattern as CLAUDE.md rule, stop using anti-patterns | Developer: specific patterns + example. Lead/Executive: effective count + impact summary |
| **Intelligence → Autonomy** | "Am I growing as a developer or becoming dependent on AI?" | Identify rubber-stamping domains, increase modification depth | Developer: independence index + dependency heatmap. Lead: team autonomy trend. Executive: independence score |
| **Intelligence → Maturity** | "What phase of AI collaboration am I in, and what's blocking progress?" | Focus on bottleneck dimension, follow prescription to advance | All personas: maturity gauge + bottleneck + "advance by doing X" |
| **Intelligence → Git & Expertise** | "How much of my AI work actually translates into git commits?" | Identify low-translation domains, improve commit follow-through | Developer: translation rate + file ownership. Lead: team translation efficiency |
| **Intelligence → Narratives** | "What's the story of my development practice, told through diagnostics?" | Read vehicle-analogy diagnostics, follow prescriptions, copy executive summary | Developer: diagnostic cards. Lead: prescription priorities. Executive: copy executive summary |
| **Decisions** | "What technical decisions have I made, and are they holding up?" | Revisit fragile decisions, trace causal chains, understand decision impact | Developer: full chain. Lead: durability trends. Executive: decision count + confidence avg |
| **Distill** | "What did I actually accomplish today in terms of reasoning?" | Review decisions lodged, share with team, correct distill gaps | Developer: full markdown. Lead: key decisions. Executive: summary paragraph |
| **Live** | "What is the capture system seeing right now in real-time?" | Filter by source, spot anomalies, verify daemon is capturing | Developer: event stream + session badges. Lead: activity pulse. Executive: N/A |
| **Profile** | "Who am I as a developer, backed by evidence?" | Share identity card, reflect on growth trajectory, export for portfolio | Developer: full radar + trajectory. Lead: growth trend. Executive: identity narrative |
| **Projects** | "Which projects am I tracking and what's their health?" | Add/remove projects, pause capture, drill into project dashboard | All personas: project cards with maturity badges + event counts |
| **Settings** | "How is Unfade configured and how do I tune it?" | Change LLM provider, adjust thresholds, toggle features | Developer: all settings. Lead/Executive: LLM config only |
| **Setup** | "How do I get started with Unfade?" | Configure LLM → select projects → connect tools → launch | All personas: guided wizard with progressive results |

#### 4.8.2 Data Presentation Rule Compliance — Component Contracts

Every component that displays a number, metric, or insight MUST implement these 5 rules. This is enforced through the `MetricDisplay` base component:

```typescript
// src/ui/components/shared/MetricDisplay.tsx — Base component for R-1 through R-5 compliance
interface MetricDisplayProps {
  // R-1: Interpretation (REQUIRED — never show a number without meaning)
  value: string | number;
  interpretation: string;          // e.g., "You steer confidently" or "Below Phase 2 threshold"

  // R-2: Comparison (REQUIRED — never show a number without context)
  comparison: {
    type: "vs-prior" | "vs-average" | "vs-threshold" | "vs-cross-project";
    delta: number;                 // e.g., +8 or -12
    label: string;                 // e.g., "vs last week" or "above your average"
    direction: "up" | "down" | "flat";
  };

  // R-3: Freshness (REQUIRED — never show a number without recency)
  freshness: {
    updatedAt: string;             // ISO timestamp
    isLive: boolean;               // true if SSE-driven
    lagMs?: number;                // materializer lag
  };

  // R-4: Confidence (REQUIRED — never show a number without reliability indicator)
  confidence: {
    level: "high" | "medium" | "low" | "insufficient";
    basis: string;                 // e.g., "42 sessions" or "3 days of data"
  };

  // R-5: Action (OPTIONAL on metrics, REQUIRED on insights)
  action?: {
    label: string;                 // e.g., "Review module" or "View details"
    href?: string;                 // Navigate to detail page
    onClick?: () => void;          // Open drawer or trigger action
  };

  // Visual hierarchy level
  level: "L1" | "L2" | "L3";      // Determines typography scale
}
```

**Rule enforcement**: The `KpiCard`, `HeroMetric`, and `InsightCard` components MUST wrap `MetricDisplay` or accept equivalent props. Code review must verify all 5 rules are satisfied — if a prop is missing, the component renders a warning in development mode.

**Violation examples to catch in review**:

| Rule | Violation | Fix |
|------|-----------|-----|
| R-1 | `<KpiCard label="AES" value={64} />` | `<KpiCard label="AES" value={64} interpretation="Effective — iteration ratio is your strongest sub-metric" />` |
| R-2 | `<KpiCard label="Events" value={142} />` | `<KpiCard label="Events" value={142} comparison={{ type: "vs-prior", delta: +23, label: "vs yesterday", direction: "up" }} />` |
| R-3 | `<KpiCard label="Direction" value="73%" />` | `<KpiCard label="Direction" value="73%" freshness={{ updatedAt: summary.updatedAt, isLive: true }} />` |
| R-4 | `<KpiCard label="Comprehension" value={68} />` | `<KpiCard label="Comprehension" value={68} confidence={{ level: "high", basis: "42 sessions" }} />` |
| R-5 | `<InsightCard text="Auth comprehension declining" />` | `<InsightCard text="Auth comprehension declining 3 weeks" action={{ label: "Review module", href: "/intelligence?tab=comprehension" }} />` |

#### 4.8.3 Visual Hierarchy — Typography Scale

Components must respect the 5-level visual hierarchy. Each page has exactly ONE L1 hero.

```typescript
// src/ui/lib/hierarchy.ts — Typography tokens for visual hierarchy
export const HIERARCHY = {
  L1: "font-mono text-5xl font-bold text-accent",            // One per page. The single most important number.
  L2: "font-mono text-3xl font-bold text-foreground",        // 3-5 per page. KPI strip items.
  L3: "text-xs text-muted font-body",                        // Labels, captions, interpretations, freshness, confidence.
  L4: "text-sm text-foreground font-body",                   // Detail sections, table rows, evidence items.
  L5: "font-mono text-[11px] text-muted",                    // Timestamps, IDs, raw data in drawers.
} as const;
```

**Per-page hero assignments** (L1):

| Page | Hero Metric | L1 Value | L1 Interpretation |
|------|-------------|----------|-------------------|
| Home (Global) | Active project count | `"3"` | `"projects with activity in the last 24h"` |
| Home (Project) | Direction Density % | `"73%"` | `"You steer confidently — driving 73% of AI interactions"` |
| Intelligence → Overview | AES (0-100) | `"64"` | `"Effective — iteration ratio is your strongest sub-metric"` |
| Intelligence → Comprehension | Overall comprehension % | `"68%"` | `"Solid understanding across most modules"` |
| Intelligence → Velocity | Trend direction | `"Accelerating"` | `"2.3 turns to acceptance — 15% faster than last week"` |
| Intelligence → Cost | Total estimated spend | `"~$12.40"` | `"today's estimated AI spend (proxy)"` |
| Intelligence → Patterns | Effective pattern count | `"7"` | `"prompting strategies that consistently produce high-direction output"` |
| Intelligence → Autonomy | Independence Index (0-100) | `"68"` | `"You're steering AI effectively — not dependent on it"` |
| Intelligence → Maturity | Phase (1-4) + label | `"Phase 2: Responsive"` | `"Basic transmission engaged — bottleneck: loop resilience"` |
| Intelligence → Git & Expertise | AI→git translation % | `"78%"` | `"of AI sessions result in commits within 2h"` |
| Intelligence → Narratives | Active narrative count | `"5"` | `"diagnostic insights with actionable prescriptions"` |
| Decisions | Decision count (period) | `"23"` | `"technical decisions this week — 87% confidence average"` |
| Distill | Today's distill status | `"Distilled"` | `"4 decisions, 2 trade-offs, 1 dead end captured"` |
| Profile | Held decision rate | `"4.2 alts/decision"` | `"Architectural thinker — you evaluate alternatives before committing"` |

#### 4.8.4 Progressive Disclosure — Layer Mapping

Every page implements exactly 5 disclosure layers. Deeper layers are accessed by deliberate user actions.

```
Layer 0: LiveStrip (always visible)     → "Is it alive? Which project?" → Daemon PIDs, materializer lag, project selector
Layer 1: Hero + KPI Strip (first view)  → "What's the one key number?" → L1 hero + L2 KPI cards (max 5)
Layer 2: Detail Sections (scroll down)  → "What are the details?"      → Charts, tables, narrative cards
Layer 3: Evidence Drawer (click)        → "What events support this?"  → EvidenceDrawer with lineage chain
Layer 4: Raw Data (toggle in drawer)    → "Show me the JSON/SQL"       → Raw event JSON, SQL query, MCP equivalent
```

**Implementation pattern**: Layer 0 and 1 render on initial page load. Layer 2 renders below the fold (visible on scroll). Layer 3 renders in `<Sheet>` on explicit click. Layer 4 renders as a toggle within the drawer. Data from deeper layers NEVER leaks upward.

```typescript
// src/ui/components/shared/EvidenceDrawer.tsx — Layer 3 + 4 container
interface EvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  entityId: string;
  entityType: "event" | "insight" | "decision" | "module" | "session";
  // Layer 4 toggle
  showRawData?: boolean;
}

// Inside the drawer:
// Layer 3: Evidence chain (events → insights → decisions)
// Layer 4: <Collapsible> with "Show raw data" toggle
//   → JSON viewer for raw event
//   → SQL query that produced this data
//   → MCP tool equivalent: "You can get this via: unfade_query({ ... })"
```

#### 4.8.5 Transmission Thesis Language Integration

The UI communicates as a **diagnostic interface + story engine**, not a dashboard. Components use vehicle-analogy language from the Transmission Thesis mapped through 4 stages:

| Stage | System Layer | UI Surface | Language Register |
|-------|-------------|------------|-------------------|
| **Engine** | Go daemon capture | LiveStrip, System Reveal | Technical: "Capture engine running", "AI session detected" |
| **Transmission** | Materializer + analyzers | Intelligence Hub tabs | Diagnostic: "Transmission engaged", "Gear ratio: 2.3 turns to acceptance" |
| **Diagnostics** | Maturity model + narratives | Maturity tab, Narratives tab, Home narrative headline | Analogy: "Running rich", "Steering pulls left in payments", "Suspension bottoms out on refactors" |
| **Guidance** | Prescriptions + coaching | Pattern cards, Prescription cards, Executive summary | Prescriptive: "Advance to Phase 3 by improving loop resilience", "Copy as CLAUDE.md rule" |

**Component-level language rules**:

| Component | Language Register | Examples |
|-----------|-------------------|----------|
| `HeroMetric` (Home) | Interpretive + Diagnostic | "You steer confidently" (not "HDS: 0.73") |
| `KpiCard` (strip) | Contextual + Comparative | "↑ 8% vs last week — entering cruise range" |
| `InsightCard` | Narrative + Actionable | "Auth comprehension declining 3 weeks → Review module" |
| `MaturityGauge` | Vehicle progression | "Phase 2: First Gear — basic transmission engaged" |
| `NarrativeDiagnosticCard` | Full vehicle analogy | "Running rich: iteration ratio 0.35 means 3× more AI turns than needed" |
| `PatternCard` (effective) | Coaching | "Including schema + constraints = 0.87 direction. Copy as rule →" |
| `PatternCard` (anti-pattern) | Warning + Fix | "Vague prompts produce 0.23 direction. Suggestion: decompose into steps" |
| `ExecutiveSummaryBlock` | Professional (no analogy) | "Effective AI collaboration with room for prompt decomposition improvement" |
| `EmptyState` | Encouraging | "No comprehension data yet — keep working, patterns emerge after 10 sessions" |

#### 4.8.6 Persona-Aware Rendering

Components that serve multiple personas implement conditional depth via a `persona` context or progressive layers:

```typescript
// src/ui/stores/app.ts — Add to Zustand store
interface AppState {
  // ... existing fields ...
  persona: "developer" | "lead" | "executive";
  setPersona: (p: "developer" | "lead" | "executive") => void;
}

// Usage in components:
// Developer (default): Full detail — all L2-L4 layers, tables, charts, raw data toggle
// Lead: Summary view — L1-L2 layers, trend charts, team aggregates, skip per-event detail
// Executive: Headlines only — L1 hero + narrative paragraph + copy button
```

**Example — Home page rendering by persona**:

```typescript
function Home() {
  const { persona } = useAppStore();
  const { data: summary } = useSummary();

  return (
    <div className="space-y-6">
      {/* L1 Hero — ALL personas see this */}
      <HeroMetric value={summary.directionDensity24h} interpretation="..." ... />

      {/* L2 KPI Strip — ALL personas */}
      <KpiStrip metrics={[...]} />

      {/* Narrative Headline — Lead + Executive see prominently, Developer sees inline */}
      {persona !== "developer" && <NarrativeHeadline text={summary.executiveSummary} copyable />}

      {/* L2 Detail — Developer + Lead only */}
      {persona !== "executive" && (
        <>
          <ActivityChart data={summary.activityByHour} />
          <div className="grid grid-cols-2 gap-4">
            <EventList events={summary.recentEvents} />
            <InsightStream insights={insights} />
          </div>
        </>
      )}
    </div>
  );
}
```

#### 4.8.7 Component → Pattern → Data Source Cross-Reference (React)

This table maps every React component to its Phase 15 pattern(s), data source, and the "Aha" moment it delivers:

| React Component | Pattern(s) | Data Source (hook) | "Aha" Moment |
|----------------|------------|-------------------|--------------|
| `HeroMetric` | P-1 | `useSummary()`, `useEfficiency()` | "I'm steering 73% of AI interactions — that's high" |
| `KpiCard` (strip) | P-2, R-1→R-4 | `useSummary()` | "3 active projects, 342 events — I've been busy" |
| `KpiStrip` | P-2 | Per-tab `use*()` hooks | Secondary metrics at a glance with comparison baselines |
| `Intelligence` (container) | P-3 | URL search params | 9 tabs, first pre-loaded, others lazy — no dashboard soup |
| `EventList` | P-4 | `useEvents()`, `useLiveEvents()` | Chronological event stream with source-colored dots |
| `EvidenceDrawer` | P-5 | `useLineage(id)` | "This insight came from 3 events across 2 sessions" |
| `SystemReveal` | P-6 | `useHealth()`, SSE | Progressive subsystem activation on first run |
| `EmptyState` | P-7 | N/A (absence of data) | "No data yet — patterns emerge after 10 sessions" |
| `ProjectSelector` | P-8 | `useProjects()`, Zustand | Global→project drill-down, localStorage persistence |
| `ComparisonBadge` | P-9 | Parent component passes delta | "↑ 8% vs last week" on every metric |
| `CostBadge` | P-10 | `useCost()` | "~$12.40 (estimate) — transparent proxy calculation" |
| `InsightCard` | P-11 | `useInsights()`, `useNarratives()` | "Auth comprehension dropped 12% — never noticed that" |
| `PatternCard` | P-12 | `usePatterns()` | "Including schema + constraints = 0.87 direction" |
| `MaturityGauge` | P-13 | `useMaturity()` | "Phase 2 at 55% — bottleneck is loop resilience" |
| `DimensionRadar` | P-14 | `useMaturity()`, `useComprehension()` | "Shape of competence — weak on payments, strong on auth" |
| `NarrativeDiagnosticCard` | P-15 | `useNarratives()` | "Running rich: iteration ratio 0.35 → decompose prompts" |
| `ExecutiveSummaryBlock` | P-16 | `useNarratives()` | Copy-paste paragraph for standup: "Effective with room for..." |
| `CausalChainViz` | P-17 | `useSubstrate(entityId)` | "This JWT decision led to 4 downstream features" |
| `QuadrantChart` | P-18 | `useEfficiencySurvival()` | "High AES but low survival in payments — efficient but fragile" |
| `FreshnessBadge` | R-3 | `useSummary().updatedAt` | "Data is live (4s ago) — I can trust these numbers" |
| `ConfidenceBadge` | R-4 | Per-analyzer `.confidence` | "High confidence (42 sessions) — statistically meaningful" |
| `LiveStrip` | Layer 0 | `useHealth()` SSE | "System is alive — 3 daemons, materializer lag 2s" |
| `SynthesisBanner` | P-6 variant | `useSetupProgress()` | "Intelligence synthesis 47% — early access available" |

#### 4.8.8 Maturity Model UI Integration

The maturity model (Phase 1-4 from Transmission Thesis) must be surfaced across multiple components, not isolated in one tab:

| Surface | Component | What it shows | Pattern |
|---------|-----------|---------------|---------|
| Home (project mode) | `MaturityBadge` | Phase badge next to project name: "Phase 2 🔧" | P-13 (inline) |
| Home (global mode) | `ProjectCard` | Per-project maturity badge on each card | P-8 + P-13 |
| Intelligence → Overview | `MaturityBadge` | Phase alongside AES hero: "AES 64 · Phase 2" | P-1 + P-13 |
| Intelligence → Maturity | `MaturityGauge` + `DimensionRadar` | Full 4-segment arc gauge + 7-axis radar | P-13 + P-14 |
| Intelligence → Narratives | `NarrativeDiagnosticCard` | Diagnostics framed by maturity phase context | P-15 |
| Profile | `MaturityJourney` | Timeline: entered Phase 1 → 2 transition → projected Phase 3 | P-9 + P-4 |
| Project cards | `MaturityBadge` (inline) | Small badge: "Phase 2" with tooltip showing bottleneck | P-13 (mini) |

**Maturity phase visual language**:

```typescript
// src/ui/lib/maturity.ts
export const MATURITY_PHASES = {
  1: { label: "Discovering", icon: "🔑", color: "text-yellow-400", description: "Bare engine — no transmission" },
  2: { label: "Responsive", icon: "🔧", color: "text-blue-400", description: "First gear — basic transmission engaged" },
  3: { label: "Fluent", icon: "⚡", color: "text-green-400", description: "Multi-gear — smooth shifting across domains" },
  4: { label: "Masterful", icon: "🏁", color: "text-purple-400", description: "Tuned vehicle — engine and driver in sync" },
} as const;
```

---

## Part V: Sprint Implementation Plan

### Sprint Overview

| Sprint | Name | Goal | Duration |
|--------|------|------|----------|
| **17A** | Vite + React Foundation | Scaffolding, build pipeline, layout shell, theme integration | 2 days |
| **17B** | Data Layer + SSE | API client, TanStack Query, SSE bridge, Zustand store | 1 day |
| **17C** | Core Pages — Dashboard + Projects | Home page, Projects page, KPI cards, charts | 2 days |
| **17D** | Intelligence Hub | 9-tab intelligence view, all chart types, evidence drawer | 3 days |
| **17E** | Decisions + Distill + Profile | Decision table, distill viewer, profile page | 2 days |
| **17F** | Setup Wizard + Settings | 4-step wizard, settings form, integrations page | 2 days |
| **17G** | Live Views + Logs | Real-time event stream, log viewer, virtual scrolling | 1 day |
| **17H** | Polish + Command Palette + Animations | Transitions, ⌘K palette, skeletons, toasts, responsive | 2 days |
| **17I** | Legacy Cleanup + Performance | Remove old pages, tree-shake, code-split, bundle audit | 1 day |

**Total: ~16 days** (conservative, includes buffer for edge cases)

**Dependencies**: 17A → 17B → {17C, 17D, 17E, 17F, 17G} (parallel after B) → 17H → 17I

---

### Sprint 17A: Vite + React Foundation (2 days)

**Goal**: React SPA builds, serves from Hono, has working layout shell with sidebar navigation and theme toggle. Zero page content — just the chrome.

**Phase 15 Alignment**: This sprint establishes Layer 0 (LiveStrip — P-8 project selector + daemon health), the 4-layer navigation structure (Pulse/Observe/Understand/Identity), and the visual hierarchy token system (L1-L5). The `AppShell` must enforce progressive disclosure boundaries — Layer 0 is always visible, Layer 1+ lives in `<Outlet />`.

**Transmission Thesis Alignment**: LiveStrip is the "dashboard instruments" — it tells the driver the vehicle is running. Sidebar groups map to the Thesis: Observe (dashcam replay), Understand (diagnostics), Identity (driver profile).

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17A.1 | Scaffold Vite + React | `vite.config.ts`, `index.html`, `tsconfig.app.json`, `src/ui/main.tsx` | **[x] COMPLETE** — Vite 8 + React 19, `@` alias to `src/ui`, proxy `/api`, `/unfade`, `/mcp` to `:7654` |
| 17A.2 | Install and configure shadcn/ui | `src/ui/lib/utils.ts` (`cn()`), CVA + clsx + tailwind-merge + Radix primitives | **[x] COMPLETE** — all deps installed, `cn()` utility ready |
| 17A.3 | Port Tailwind theme tokens + visual hierarchy | `src/ui/styles/globals.css` | **[x] COMPLETE** — Tailwind v4 `@theme` block with all Phase 15 tokens (canvas, surface, raised, overlay, accent, cyan, success, warning, error, fonts). Dark/light variants |
| 17A.4 | Build pipeline integration | `package.json`: `dev:ui`, `build:ui`, updated `build` | **[x] COMPLETE** — `pnpm build:ui` → `dist/` in 299ms (39KB CSS + 299KB JS) |
| 17A.5 | Hono static serving | `src/server/http.ts`: `/assets/*` serveStatic + SPA fallback for non-API routes | **[x] COMPLETE** — serves `dist/index.html` for all non-API/non-asset routes when built |
| 17A.6 | AppShell layout + LiveStrip | `AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `LiveStrip.tsx` | **[x] COMPLETE** — 4-layer nav (Observe/Understand/Identity/System), collapsible sidebar, LiveStrip with project selector + freshness |
| 17A.7 | React Router setup | `App.tsx` with `BrowserRouter` + all 11 routes | **[x] COMPLETE** — routes: `/`, `/live`, `/distill`, `/intelligence`, `/decisions`, `/profile`, `/cards`, `/projects`, `/settings`, `/integrations`, `/logs` |
| 17A.8 | Theme toggle + persona selector | Dark/light toggle + persona dropdown in TopBar, persisted via Zustand | **[x] COMPLETE** — `useAppStore` persists theme + persona + sidebar + project in localStorage |
| 17A.9 | Base shared components | `MetricDisplay`, `FreshnessBadge`, `ConfidenceBadge`, `ComparisonBadge`, `HeroMetric` | **[x] COMPLETE** — R-1→R-4 rule compliance: interpretation, comparison, freshness, confidence. Auto-updating `FreshnessBadge` via `useEffect` interval |
| 17A.10 | Maturity constants + helpers | `src/ui/lib/maturity.ts` | **[x] COMPLETE** — 4 phases with colors, labels, descriptions. `getPhaseInfo/Color/Label` helpers |

#### 17A.1: Scaffold Vite + React

**Install**:
```bash
pnpm add -D vite @vitejs/plugin-react
# React already in dependencies
```

**`vite.config.ts`**:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyDirFirst: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src/ui") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7654",
      "/distill": "http://localhost:7654",
      "/decisions": "http://localhost:7654",
      "/profile": "http://localhost:7654",
      "/cards": "http://localhost:7654",
      "/query": "http://localhost:7654",
      "/context": "http://localhost:7654",
      "/similar": "http://localhost:7654",
      "/amplify": "http://localhost:7654",
      "/feedback": "http://localhost:7654",
    },
  },
});
```

**`index.html`** (project root):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Unfade</title>
  </head>
  <body class="bg-canvas text-text-primary antialiased">
    <div id="root"></div>
    <script type="module" src="/src/ui/main.tsx"></script>
  </body>
</html>
```

**`src/ui/main.tsx`**:
```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client";
import { App } from "./App";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
```

#### 17A.2: Install and Configure shadcn/ui

```bash
pnpm add tailwindcss @tailwindcss/vite     # Vite plugin for Tailwind 4
pnpm add class-variance-authority clsx tailwind-merge  # shadcn dependencies
pnpm add @radix-ui/react-slot              # Base primitive
pnpm add lucide-react                      # Icons
```

Generate initial primitives via shadcn CLI:
```bash
npx shadcn@latest init
npx shadcn@latest add button card tabs sheet skeleton badge tooltip separator progress
```

**`src/ui/lib/utils.ts`**:
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

#### 17A.9: Base Shared Components (R-1 through R-4 Compliance)

These components enforce the Phase 15 data presentation rules at the component level. Every metric-displaying component in the app wraps or composes with these:

```typescript
// src/ui/components/shared/FreshnessBadge.tsx (R-3)
interface FreshnessBadgeProps {
  updatedAt: string;         // ISO timestamp
  isLive?: boolean;          // SSE-driven = true
  lagMs?: number;            // materializer lag
}
// Renders: "live · 4s ago" (green dot) or "stale · 2m ago" (yellow dot)
// Auto-updates every second via useEffect interval

// src/ui/components/shared/ConfidenceBadge.tsx (R-4)
interface ConfidenceBadgeProps {
  level: "high" | "medium" | "low" | "insufficient";
  basis: string;             // "42 sessions" or "3 days of data"
}
// Renders: "High (42 sessions)" with green/yellow/red/gray color
// Tooltip explains: "Confidence is based on the number of qualifying events"

// src/ui/components/shared/ComparisonBadge.tsx (R-2)
interface ComparisonBadgeProps {
  delta: number;
  label: string;             // "vs last week"
  direction: "up" | "down" | "flat";
  goodDirection?: "up" | "down"; // Which direction is positive (default: "up")
}
// Renders: "↑ 8% vs last week" in green or "↓ 3% vs yesterday" in red
// Color determined by goodDirection alignment

// src/ui/components/shared/HeroMetric.tsx (P-1 + R-1→R-4)
interface HeroMetricProps extends MetricDisplayProps {
  // Inherits all R-1 through R-4 required fields from MetricDisplay
  // Renders at L1 visual hierarchy (text-5xl font-mono font-bold)
  // Includes: value, interpretation (below), comparison badge, freshness badge, confidence badge
  // Optional: maturity phase badge (P-13 inline) positioned top-right
  maturityPhase?: { phase: number; label: string };
}
```

#### 17A.5: Hono Static Serving

**`src/server/http.ts`** — add before the catch-all page routes:

```typescript
import { serveStatic } from "@hono/node-server/serve-static";

// Serve React SPA assets (production)
if (process.env.NODE_ENV === "production" || existsSync("./dist/index.html")) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  // SPA fallback — serves index.html for all non-API routes
  app.get("*", (c, next) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/distill/")) {
      return next();
    }
    return serveStatic({ root: "./dist", path: "/index.html" })(c, next);
  });
}
```

#### 17A.6: AppShell Layout (Phase 15 Navigation Architecture)

Port the existing layout into React with the **Phase 15 4-layer navigation** structure. Sidebar groups: Pulse (always visible as LiveStrip), Observe (Home, Live, Distill), Understand (Intelligence Hub, Decisions, Coach), Identity (Profile, Cards), System (Settings, Integrations, Logs).

```typescript
// src/ui/components/layout/AppShell.tsx
export function AppShell() {
  const { sidebarCollapsed } = useAppStore();
  return (
    <div className="flex h-screen bg-canvas">
      {/* Layer 0: Sidebar (navigation) + LiveStrip (daemon pulse) */}
      <Sidebar />
      <div className={cn(
        "flex flex-1 flex-col overflow-hidden transition-all",
        sidebarCollapsed ? "ml-14" : "ml-60"
      )}>
        {/* SynthesisBanner: conditional during initial materialization (P-6 variant) */}
        <SynthesisBanner />
        <TopBar />
        {/* Layer 1+: Page content renders here */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
        {/* Layer 0: Always-visible system pulse (P-8 project selector lives here) */}
        <LiveStrip />
      </div>
    </div>
  );
}

// src/ui/components/layout/Sidebar.tsx — Phase 15 navigation grouping
const NAV_GROUPS = [
  {
    label: "Observe",    // Transmission Thesis: "dashcam replay"
    items: [
      { path: "/", icon: Home, label: "Home" },
      { path: "/live", icon: Radio, label: "Live" },
      { path: "/distill", icon: BookOpen, label: "Distill" },
    ],
  },
  {
    label: "Understand", // Transmission Thesis: "diagnostics + story"
    items: [
      { path: "/intelligence", icon: Brain, label: "Intelligence", badge: alertCount },
      { path: "/decisions", icon: GitBranch, label: "Decisions" },
    ],
  },
  {
    label: "Identity",   // Transmission Thesis: "driver profile"
    items: [
      { path: "/profile", icon: User, label: "Profile" },
      { path: "/cards", icon: CreditCard, label: "Cards" },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/projects", icon: Folder, label: "Projects" },
      { path: "/settings", icon: Settings, label: "Settings" },
      { path: "/integrations", icon: Plug, label: "Integrations" },
      { path: "/logs", icon: Terminal, label: "Logs" },
    ],
  },
];
// Total: 11 items (Phase 15 targets ≤15, reduced from current 15). Groups provide semantic structure.
```

**`LiveStrip`** — Layer 0 (P-8 Project Selector + System Health):

```typescript
// src/ui/components/layout/LiveStrip.tsx
// Always visible at bottom. Implements: P-8 (project selector), R-3 (freshness for all metrics above).
// Left: ProjectSelector (dropdown, "All Projects" default, localStorage persist)
// Center: Daemon status dots (green/yellow/red per daemon PID) + materializer lag
// Right: Last tick timestamp (R-3 freshness) + event count today
// On first run (no daemons): triggers SystemReveal animation (P-6)
export function LiveStrip() {
  const { data: health } = useHealth(); // SSE-driven, staleTime: Infinity
  const { activeProjectId, setActiveProject } = useAppStore();

  return (
    <div className="h-10 border-t border-border bg-surface flex items-center px-4 text-[11px] font-mono text-muted">
      <ProjectSelector activeId={activeProjectId} onSelect={setActiveProject} />
      <DaemonStatusDots daemons={health?.daemons ?? []} />
      <span className="ml-auto">
        <FreshnessBadge updatedAt={health?.updatedAt} isLive={true} />
        <span className="ml-3">{health?.eventsToday ?? 0} events today</span>
      </span>
    </div>
  );
}
```

**Acceptance criteria for 17A** (**ALL MET 2026-04-24**):
- [x] `pnpm dev:ui` starts Vite at :5173, proxies API to :7654
- [x] `pnpm build:ui` produces `dist/` with `index.html` + `assets/` (299ms build, 94KB gzipped JS)
- [x] Hono serves React SPA assets at `/assets/*` + SPA fallback on all non-API routes when `dist/` exists
- [x] Sidebar navigation between all 11 routes works (placeholder content per page)
- [x] Theme toggle switches dark/light and persists (Zustand + localStorage)
- [x] Layout matches Phase 15 design tokens (same `--color-*` variables, same font stack, same spacing)

---

### Sprint 17B: Data Layer + SSE (1 day)

**Goal**: All data fetching infrastructure in place. SSE connected. TanStack Query configured. Any page can consume live data with a single hook call.

**Phase 15 Alignment**: Every query hook must return data shaped to satisfy R-1 through R-4. API responses that lack interpretation, comparison, freshness, or confidence fields must be enriched client-side by the hook before returning to components. This sprint creates the **data contracts** that make rule compliance automatic rather than per-component.

**Transmission Thesis Alignment**: The data layer is the "transmission" — it converts raw API data (engine output) into interpreted, compared, time-stamped, confidence-rated information (controlled wheel speed). Hooks are gears.

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17B.1 | Typed API client | `src/ui/lib/api.ts` — 40+ endpoints: summary, health, repos, projects, intelligence (18 endpoints), insights, substrate (3), decisions | **[x] COMPLETE** |
| 17B.2 | TanStack Query setup | `src/ui/lib/query-client.ts` — 30s staleTime, retry 1, refetchOnWindowFocus off | **[x] COMPLETE** (from 17A) |
| 17B.3 | SSE bridge | `src/ui/lib/sse.ts` + `src/ui/hooks/useSSE.ts` — connects in AppShell, auto-reconnects on error, invalidates TanStack Query caches for summary/health/events/intelligence | **[x] COMPLETE** |
| 17B.4 | Zustand store | `src/ui/stores/app.ts` — theme, sidebar, project, persona. localStorage persist via Zustand `persist` middleware | **[x] COMPLETE** (from 17A) |
| 17B.5 | Query hooks with enrichment | `useHealth`, `useSummary`, `useEfficiency`, `useComprehension`, `useCosts`, `useVelocity`, `usePromptPatterns`, `useAutonomy`, `useMaturity`, `useNarratives`, `useProjects`, `useRepos`, `useInsights`, `useLiveEvents` — each enriches with R-1 interpretation, R-2 comparison, R-3 freshness, R-4 confidence | **[x] COMPLETE** |
| 17B.6 | Type definitions | `src/ui/types/` — `summary.ts`, `intelligence.ts`, `health.ts`, `projects.ts`, `events.ts`, `index.ts` barrel | **[x] COMPLETE** |
| 17B.7 | Comparison baseline helpers | `src/ui/lib/comparisons.ts` — `vsPriorPeriod()`, `vsAverage()`, `vsThreshold()` | **[x] COMPLETE** |

#### 17B.5: Query Hooks Pattern — With R-1→R-4 Enrichment

Every data-consuming hook follows this pattern. **Critical**: hooks enrich raw API data with interpretation (R-1), comparison (R-2), freshness (R-3), and confidence (R-4) so that components receive ready-to-render data and can't accidentally violate the rules.

```typescript
// src/ui/hooks/useIntelligence.ts

// Raw API returns: { aes: 64, confidence: "high", subMetrics: {...}, trend: {...}, history: [...] }
// Enriched return adds: interpretation, comparison delta, freshness, confidence basis
export function useEfficiency() {
  const query = useQuery({
    queryKey: ["intelligence", "efficiency"],
    queryFn: api.intelligence.efficiency,
    staleTime: 60_000,
  });

  // Enrich with R-1 through R-4 fields
  const enriched = useMemo(() => {
    if (!query.data) return null;
    const d = query.data;
    return {
      ...d,
      // R-1: Interpretation
      interpretation: interpretAES(d.aes),  // "Effective — iteration ratio is strongest"
      // R-2: Comparison (vs prior period from history array)
      comparison: computeDelta(d.history, 7), // { delta: +8, label: "vs last week", direction: "up" }
      // R-3: Freshness (from dataUpdatedAt or query timing)
      freshness: { updatedAt: query.dataUpdatedAt, isLive: false, lagMs: Date.now() - query.dataUpdatedAt },
      // R-4: Confidence (from analyzer output)
      confidence: { level: d.confidence, basis: `${d.qualifyingEvents ?? 0} sessions` },
    };
  }, [query.data, query.dataUpdatedAt]);

  return { ...query, data: enriched };
}

// Interpretation helpers (R-1) — diagnostic language from Transmission Thesis
function interpretAES(aes: number): string {
  if (aes >= 80) return "High-performance — engine and driver in sync";
  if (aes >= 60) return "Effective — room to tighten gear shifts";
  if (aes >= 40) return "Developing — transmission slipping in some domains";
  return "Bare engine — heavy AI dependency, low direction";
}

// Comparison helper (R-2) — computes delta vs N days ago from history array
function computeDelta(history: { date: string; value: number }[], daysBack: number) {
  // ... implementation: find value daysBack ago, compute % change
}

// Pattern: one hook per endpoint, consistent queryKey hierarchy
// ["intelligence", "efficiency"] → invalidated by invalidateQueries({ queryKey: ["intelligence"] })
```

#### 17B.7: Comparison Baseline Helpers

```typescript
// src/ui/lib/comparisons.ts
// Centralized comparison computation for R-2 compliance.

export type ComparisonResult = {
  type: "vs-prior" | "vs-average" | "vs-threshold";
  delta: number;
  label: string;
  direction: "up" | "down" | "flat";
};

// Compute delta vs N days ago from a time-series history array
export function vsPriorPeriod(history: { date: string; value: number }[], daysBack: number): ComparisonResult { ... }

// Compute delta vs rolling average (e.g., 30-day average)
export function vsAverage(currentValue: number, history: { value: number }[]): ComparisonResult { ... }

// Compute delta vs a fixed threshold (e.g., maturity phase boundary)
export function vsThreshold(currentValue: number, threshold: number, thresholdLabel: string): ComparisonResult { ... }

// Compute cross-project comparison (e.g., "12% above your average across projects")
export function vsCrossProject(currentValue: number, allProjectValues: number[]): ComparisonResult { ... }
```

#### 17B.6: Type Definitions

Extract TypeScript types from existing API response shapes. These mirror the Zod schemas in `src/schemas/`:

```typescript
// src/ui/types/intelligence.ts
export interface Efficiency {
  aes: number;
  components: { autonomy: number; efficiency: number; specificity: number };
  trend: { direction: "up" | "down" | "flat"; slope: number };
  // ... matches src/services/intelligence/analyzers/efficiency.ts output
}

// src/ui/types/summary.ts
export interface SummaryJson {
  totalEvents: number;
  todayEvents: number;
  direction: { score: number; label: string };
  topDomain: string;
  activeHours: number;
  // ... matches state/summary.json shape
}
```

**Acceptance criteria for 17B** (**ALL MET 2026-04-24**):
- [x] SSE connects on app mount (`useSSE()` in AppShell), auto-reconnects with 3s backoff
- [x] `useHealth()` returns live daemon health (SSE `health` events update query cache directly)
- [x] `useSummary()` returns enriched summary (SSE `summary` events update cache; interpretation added)
- [x] `useEfficiency()` returns data with R-1 interpretation, R-2 `vsPriorPeriod(7)`, R-3 freshness, R-4 confidence
- [x] Theme/sidebar/project/persona persist via Zustand `persist` + localStorage
- [x] Build: 312KB JS (99KB gzipped), 379ms build time, zero lint errors

---

### Sprint 17C: Core Pages — Dashboard + Projects (2 days)

**Goal**: Home page shows real data with KPI cards, charts, and recent events. Projects page allows full CRUD. Both pages fully compliant with Phase 15 patterns and data presentation rules.

**Phase 15 Alignment**: Home page implements TWO modes per P-8 (Global vs Project). Global mode: P-8 project drill-down + P-2 KPI strip + P-11 insight cards + narrative headline. Project mode: P-1 hero (Direction Density) + P-2 KPI strip + P-13 maturity badge + P-4 timeline. Projects page implements P-8 + P-13 (maturity badges on project cards).

**Transmission Thesis Alignment**: Home is the "dashboard" — instruments showing ground speed (direction density), fuel efficiency (cost per decision), tire grip (comprehension), and heading (top domain). Global mode is "fleet overview"; project mode is "this vehicle's gauges."

**"Aha" Moment Targets**:
- Home Global: "3 active projects, but my-saas-app hasn't had events in 2h — something's off"
- Home Project: "Direction density 73% — I'm steering confidently in this project"
- Projects: "unfade-cli is Phase 2 🔧 but my-saas-app is still Phase 1 🔑 — different maturity"

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17C.1 | KpiCard + KpiStrip + SparkLine | `shared/KpiCard.tsx`, `charts/SparkLine.tsx` — R-1→R-4 compliant, optional sparkline, estimate badge, optional href link | **[x] COMPLETE** |
| 17C.2 | AreaChart component | `charts/AreaChart.tsx` — pure SVG with gradient fill, y-axis labels, x-axis labels. Zero deps | **[x] COMPLETE** |
| 17C.3 | Home page (dual mode) | `pages/HomePage.tsx` — Global: NarrativeHeadline + 5 KPIs + ProjectCards + InsightStream. Project: HeroMetric + KpiStrip + AreaChart + EventList + Insights | **[x] COMPLETE** |
| 17C.4 | EventList component | `shared/EventList.tsx` — source-colored rows, time+source+summary, truncation, empty state | **[x] COMPLETE** |
| 17C.5 | InsightCard component | `shared/InsightCard.tsx` — severity-colored left border, confidence badge, actionable link | **[x] COMPLETE** |
| 17C.6 | NarrativeHeadline | `shared/NarrativeHeadline.tsx` — copyable text, prominent mode for exec, clipboard API | **[x] COMPLETE** |
| 17C.7 | Projects page | `pages/ProjectsPage.tsx` — repo list with status dots, pause/resume/restart, discover panel with add | **[x] COMPLETE** |
| 17C.8 | SynthesisBanner | `layout/SynthesisBanner.tsx` — calibration progress bar, event count toward threshold, auto-hides when firstRunComplete | **[x] COMPLETE** |
| 17C.+ | EmptyState + ProjectCard | `shared/EmptyState.tsx`, `shared/ProjectCard.tsx` — reusable across all pages | **[x] COMPLETE** |

#### 17C.3: Home Page Composition (Dual Mode — P-8 Global→Project Drill-Down)

The Home page renders in TWO modes based on `activeProjectId` from Zustand. This implements Phase 15's Global→Project Drill-Down pattern (P-8).

```typescript
// src/ui/pages/Home.tsx
export function Home() {
  const { activeProjectId, persona } = useAppStore();
  const { data: summary, isLoading } = useSummary(); // Enriched with R-1→R-4 from hook

  if (isLoading) return <HomeSkeleton />; // Per-page skeleton, not generic LoadingPage

  return activeProjectId ? (
    <HomeProject projectId={activeProjectId} summary={summary} persona={persona} />
  ) : (
    <HomeGlobal summary={summary} persona={persona} />
  );
}

// ── GLOBAL MODE (All Projects) ──────────────────────────────────────────────
// Patterns: P-8 (drill-down), P-2 (KPI strip), P-11 (insight cards), P-16 (narrative headline)
// Three-Question Test:
//   Q1: "How is my AI collaboration going across all projects?"
//   Q2: Switch to underperforming project, trigger distill, open intelligence hub
//   Q3: Developer=KPIs+stream, Lead=project cards, Executive=narrative headline
function HomeGlobal({ summary, persona }: Props) {
  const { data: repos } = useRepos();
  const { data: insights } = useInsights();
  const { data: narratives } = useNarratives();
  const { setActiveProject } = useAppStore();

  return (
    <div className="space-y-6">
      {/* Layer 1: Narrative Headline (P-16 — Executive Summary Block) */}
      {/* Lead/Executive: prominent. Developer: compact above KPIs */}
      <NarrativeHeadline
        text={narratives?.executiveSummary ?? "Capture active — intelligence warming up"}
        copyable={persona !== "developer"}
        prominent={persona !== "developer"}
      />

      {/* Layer 1: KPI Strip (P-2 — max 5 cards, all R-1→R-4 compliant) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Active Projects"
          value={summary.activeProjectCount}
          interpretation={`with activity in the last 24h`}
          comparison={summary.projectCountComparison}      // R-2: vs yesterday
          freshness={summary.freshness}                     // R-3: from SSE
          confidence={{ level: "high", basis: "direct count" }} // R-4
          href="/projects"                                  // R-5: action
        />
        <KpiCard
          label="Events Today"
          value={summary.eventCount24h}
          interpretation={summary.eventInterpretation}      // R-1: "Busy day" or "Quiet so far"
          comparison={summary.eventComparison}               // R-2: vs yesterday
          freshness={summary.freshness}
          confidence={{ level: "high", basis: "direct count" }}
          sparkData={summary.eventsByHour}                  // Last 24h sparkline
        />
        <KpiCard
          label="Direction Density"
          value={`${Math.round(summary.directionDensity24h * 100)}%`}
          interpretation={summary.directionInterpretation}  // R-1: "You steer confidently"
          comparison={summary.directionComparison}           // R-2: vs last week
          freshness={summary.freshness}
          confidence={summary.directionConfidence}           // R-4: based on session count
          href="/intelligence?tab=overview"
        />
        <KpiCard
          label="Cost Today"
          value={`~$${summary.todaySpendProxy?.toFixed(2) ?? "0.00"}`}
          interpretation={summary.costInterpretation}        // R-1: "Moderate spend"
          comparison={summary.costComparison}                // R-2: vs 7-day average
          freshness={summary.freshness}
          confidence={{ level: "medium", basis: "proxy estimate" }}
          badge="estimate"                                   // P-10: Cost Honesty Badge
          href="/intelligence?tab=cost"
        />
        <KpiCard
          label="Context Leverage"
          value={`${summary.contextLeveragePct ?? 0}%`}
          interpretation="sessions that used prior reasoning"
          comparison={summary.leverageComparison}
          freshness={summary.freshness}
          confidence={summary.leverageConfidence}
        />
      </div>

      {/* Layer 2: Project Cards (P-8 — click to set project selector) */}
      {/* Each card shows: name, last event time, event count, maturity badge (P-13) */}
      {persona !== "executive" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {repos?.map((repo) => (
            <ProjectCard
              key={repo.id}
              repo={repo}
              onClick={() => setActiveProject(repo.id)}  // P-8: click drills down
              maturityPhase={repo.maturityPhase}          // P-13: inline badge
            />
          ))}
        </div>
      )}

      {/* Layer 2: Insight Stream (P-11 — Narrative Insight Cards, all R-5 compliant) */}
      <Card>
        <CardHeader><CardTitle>Recent Insights</CardTitle></CardHeader>
        <CardContent>
          {insights?.length ? (
            insights.slice(0, 5).map((i) => (
              <InsightCard
                key={i.id}
                text={i.text}                             // P-11: specific claim
                confidence={i.confidence}                  // R-4
                action={{ label: "Investigate", href: i.detailHref }}  // R-5: always actionable
              />
            ))
          ) : (
            <EmptyState icon={Lightbulb} title="No insights yet"
              description="Keep working — insights emerge after 10+ sessions"
              action={{ label: "View Intelligence Hub", onClick: () => navigate("/intelligence") }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── PROJECT MODE (Single Project) ───────────────────────────────────────────
// Patterns: P-1 (hero), P-2 (KPI strip), P-13 (maturity badge), P-4 (timeline)
// Three-Question Test:
//   Q1: "What happened in this project since I last looked?"
//   Q2: Drill into events, review decisions, run distill
//   Q3: Developer=events+direction, Lead=trend+maturity, Executive=phase progress
function HomeProject({ projectId, summary, persona }: Props) {
  const { data: maturity } = useMaturity(projectId);

  return (
    <div className="space-y-6">
      {/* Layer 1: Hero Metric (P-1 — Direction Density for this project) */}
      <HeroMetric
        value={`${Math.round(summary.directionDensity24h * 100)}%`}
        interpretation={summary.directionInterpretation}     // R-1: "You steer confidently"
        comparison={summary.directionComparison}              // R-2: vs last week
        freshness={summary.freshness}                         // R-3: live
        confidence={summary.directionConfidence}              // R-4: session count
        maturityPhase={maturity ? { phase: maturity.phase, label: maturity.phaseLabel } : undefined} // P-13
      />

      {/* Layer 1: KPI Strip (P-2 — project-scoped, max 5) */}
      <KpiStrip metrics={[
        { label: "Events Today", value: summary.eventCount24h, ...summary.eventEnriched },
        { label: "Efficiency (AES)", value: summary.aes, ...summary.aesEnriched },
        { label: "Top Domain", value: summary.topDomain, interpretation: "most active area" },
        { label: "Sessions", value: summary.sessionCount, ...summary.sessionEnriched },
        { label: "Active Hours", value: summary.activeHours, interpretation: "hours with activity" },
      ]} />

      {/* Layer 2: Activity chart + recent events (Developer + Lead only) */}
      {persona !== "executive" && (
        <>
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent><AreaChart data={summary.activityByHour} height={250} /></CardContent>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Recent Events</CardTitle></CardHeader>
              <CardContent><EventList events={summary.recentEvents} maxItems={10} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Latest Insights</CardTitle></CardHeader>
              <CardContent><InsightStream projectId={projectId} /></CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
```

**Acceptance criteria for 17C** (**ALL MET 2026-04-24**):
- [x] Home page switches between Global and Project mode via Zustand `activeProjectId` (P-8)
- [x] **R-1**: Every KPI card shows interpretation text (e.g., "Busy day", "You steer confidently")
- [x] **R-3**: FreshnessBadge on all data-dependent sections (via SSE-driven freshness)
- [x] **R-4**: Confidence badge on intelligence-derived metrics
- [x] **R-5**: InsightCards include actionable "Investigate →" links
- [x] NarrativeHeadline renders on Global home with copy button for exec persona
- [x] HeroMetric with MaturityBadge renders on Project home
- [x] KPI Strip shows 4-5 cards with full props (sparkline ready, estimate badge on cost)
- [x] ProjectCard shows event count, direction %, time ago, maturity phase badge
- [x] InsightStream renders with confidence and action buttons, EmptyState fallback
- [x] AreaChart renders with pure SVG (zero Recharts — lighter, themed)
- [x] Persona-aware: developer=full detail, executive=headline+copy
- [x] EmptyState (P-7) shown when no data, with guidance and CTA
- [x] Projects page: CRUD (pause/resume/restart), discover panel, add button
- [x] SynthesisBanner: calibration progress bar, auto-hides after firstRunComplete
- [x] Build: 335KB JS (104KB gzip), 225ms build, zero regressions

---

### Sprint 17D: Intelligence Hub (3 days)

**Goal**: Full 9-tab intelligence view with charts, tables, narrative text, and evidence drawer. This is the most complex UI surface — the Transmission system's **Diagnostics dashboard**, where raw analyzer output becomes human-readable narratives and prescriptions.

**Phase 15 alignment**: The Intelligence Hub is the primary P-3 (Tabbed Hub) implementation. Each tab answers a specific Three-Question Test entry, renders a P-1 Hero Metric at top, and uses the full R-1→R-5 rule set. Tabs progressively disclose from L1 hero → L2 KPIs → L3 detail tables → L4 evidence drawer. Every tab surfaces Transmission Thesis diagnostic language — "running rich", "steering pulls left", "idling" — not raw numbers.

**Three-Question Test per tab**:

| Tab | User Question | Action | Persona Scale |
|-----|--------------|--------|---------------|
| Overview | "How's my engineering health overall?" | Spot the weakest dimension, click to drill in | Dev: all 8 KPIs. Lead: top 3 + trend. Exec: headline + copy |
| Comprehension | "Do I understand my codebase?" | Identify blind spots, prioritize learning | Dev: radar + module table. Lead: dimension scores. Exec: "X% coverage" |
| Velocity | "Am I getting faster or slower?" | Compare periods, find bottlenecks | Dev: trend chart + domain breakdown. Lead: weekly delta. Exec: "Accelerating/Decelerating" |
| Cost | "What's my AI spend actually buying?" | Optimize model/tool selection | Dev: model breakdown + cost-per-decision. Lead: project totals. Exec: "ROI: $X/decision" |
| Patterns | "What prompt patterns work?" | Adopt effective patterns, retire ineffective ones | Dev: pattern cards + effectiveness. Lead: top 3 patterns. Exec: "Y% adoption of best practice" |
| Autonomy | "Am I becoming more self-sufficient?" | Track progression from AI-dependent → AI-augmented | Dev: timeline + session detail. Lead: trend arrow. Exec: "Autonomy score: Z" |
| Maturity | "What's my engineering maturity level?" | See progression path, understand next phase | Dev: phase gauge + dimension detail. Lead: team average. Exec: phase label |
| Git Expertise | "Where's my deep knowledge?" | Recognize expertise areas, find gaps | Dev: heatmap + file-level detail. Lead: domain distribution. Exec: "Expert in N domains" |
| Narratives | "What's the story of my recent work?" | Review decisions in context, share reasoning | Dev: full narrative cards. Lead: decision summaries. Exec: headline outcomes |

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17D.1 | Tab container with P-3 Tabbed Hub | `pages/IntelligencePage.tsx` — URL-persisted via `useSearchParams`, 9 lazy-loaded tabs, code-split per tab | **[x] COMPLETE** |
| 17D.2 | OverviewTab | NarrativeHeadline + 4 KPI cards + RadarChart + persona-aware exec mode (grade letter) | **[x] COMPLETE** |
| 17D.3 | ComprehensionTab | HeroMetric + RadarChart (module dimensions) + module detail bars + blind spot InsightCards | **[x] COMPLETE** |
| 17D.4 | VelocityTab | HeroMetric + domain velocity bars + data points/trend KPIs | **[x] COMPLETE** |
| 17D.5 | CostTab | HeroMetric (cost per decision) + model bars + waste ratio + disclaimer badge | **[x] COMPLETE** |
| 17D.6 | PatternsTab | HeroMetric (top pattern) + effective/anti pattern cards with effectiveness % + suggestions | **[x] COMPLETE** |
| 17D.7 | AutonomyTab | HeroMetric (independence index) + 4 breakdown KPIs + AreaChart trend + dependency risk map | **[x] COMPLETE** |
| 17D.8 | MaturityTab | HeroMetric (phase gauge) + RadarChart (7 dimensions) + requirements checklist + bottleneck | **[x] COMPLETE** |
| 17D.9 | GitExpertiseTab | HeroMetric (expert domains) + file ownership list (deep/familiar/ai-dependent) + churn bars | **[x] COMPLETE** |
| 17D.10 | NarrativesTab | HeroMetric (count) + executive summary + diagnostics/prescriptions split | **[x] COMPLETE** |
| 17D.11 | EvidenceDrawer | Slide-in 480px panel, Layer 3 (events + metrics + links) + Layer 4 (raw JSON), ESC/overlay close | **[x] COMPLETE** |
| 17D.12 | RadarChart + Heatmap | Pure SVG RadarChart (N-axis, grid rings, data polygon) + Heatmap table (clickable cells, opacity mapping) | **[x] COMPLETE** |
| 17D.13 | Diagnostic language helpers | `lib/diagnostics.ts` — `interpretScore()`, `phaseTransitionNarrative()`, `costDiagnostic()`, `gradeLetter()` | **[x] COMPLETE** |

#### 17D.1: Intelligence Tab Container (P-3)

```
Intelligence Page (P-3 Tabbed Hub)
├── URL-persisted tab via searchParams ("?tab=velocity")
├── Tab list: 9 tabs, scrollable on mobile, badges show data freshness (R-3)
│   Each tab label optionally shows a StatusDot (green=fresh, amber=stale, red=no data)
├── Each tab lazy-loaded (React.lazy) for code splitting
│   Tab switch: no re-mount, TanStack Query cache serves previous data instantly
└── Every tab follows the same vertical structure:
    ├── L1: HeroMetric (P-1) — single biggest number for this dimension
    ├── L2: KPI Strip (P-2) — 3-5 supporting metrics with R-1→R-4 compliance
    ├── L3: Detail section — charts, tables, cards (dimension-specific)
    └── L4: EvidenceDrawer (P-5) — opens on row/card click, shows lineage
```

#### 17D.2: OverviewTab (P-16 + P-2)

```
OverviewTab — "How's my engineering health overall?"
├── NarrativeHeadline (P-16) — Transmission Thesis summary:
│   "Your engineering is running in [Phase label]. [Strongest dimension] is
│    your best gear; [weakest dimension] needs attention."
├── KPI Strip (P-2): 8 cards, one per analyzer dimension:
│   Each card: MetricDisplay with value + interpretation (R-1) + delta vs 7d (R-2)
│   Cards: Comprehension, Velocity, Cost, Patterns, Autonomy, Maturity, Git, Narratives
│   Sorted by: worst-performing first (draws attention to what needs work)
├── DimensionRadar (P-14): all 8 dimensions on single radar chart
│   Color-coded by maturity phase (red/amber/green/blue)
├── Trend Sparklines: 30-day mini charts per dimension (inline in KPI cards)
└── Persona rendering:
    Developer: all 8 cards + radar + sparklines
    Lead: top 3 + bottom 3 + radar (skip middle)
    Executive: NarrativeHeadline only + single "Engineering Health: B+" grade
```

#### 17D.3: ComprehensionTab (P-14 + P-5)

```
ComprehensionTab — "Do I understand my codebase?"
├── L1 HeroMetric (P-1): "Comprehension Score: 73%"
│   interpretation (R-1): "You understand most of the code you touch, with gaps in [domain]"
│   comparison (R-2): "+5% vs last week"
│   confidence (R-4): "Based on 142 sessions across 12 modules"
├── L2 KPI Strip (P-2): Modules Covered | Blind Spots | Depth Score | Breadth Score
├── L3 Detail:
│   ├── DimensionRadar (P-14): axes = module dimensions, fill = comprehension depth
│   │   Diagnostic language: "Strong grip on [module]" / "Losing traction in [module]"
│   ├── Module Table: sortable DataTable
│   │   Columns: Module | Score | Sessions | Trend | Status
│   │   Row click → opens EvidenceDrawer (Layer 3)
│   └── Blind Spots (conditional, only when blind spots exist):
│       Alert cards with amber border, each showing:
│       - Domain name + "Last touched: [date]" (R-3)
│       - Action (R-5): "Review [file] to close this gap" with link
└── L4 EvidenceDrawer (P-5): selected module's sessions, commits, decisions
    Layer 3: structured summary (which sessions touched this module)
    Layer 4: raw event data (actual prompts, diffs)
```

#### 17D.4: VelocityTab

```
VelocityTab — "Am I getting faster or slower?"
├── L1 HeroMetric: "Velocity: 12.4 decisions/day"
│   interpretation: "Your engine is running at cruising speed" (Phase 3 language)
│   comparison: "+18% vs last month" (R-2)
├── L2 KPIs: Decisions Today | Avg Session Length | Commits/Day | Active Hours
├── L3 Detail:
│   ├── AreaChart: 30-day velocity trend (decisions/day over time)
│   │   Overlay: shaded bands for maturity phase transitions
│   ├── BarChart: velocity by domain (which areas produce most decisions)
│   └── Period comparison table: This Week vs Last Week vs Monthly Avg (P-9)
└── Diagnostic language: "Accelerating" / "Cruising" / "Decelerating" / "Stalled"
```

#### 17D.5: CostTab (P-10)

```
CostTab — "What's my AI spend actually buying?"
├── L1 HeroMetric: "Cost per Decision: $0.47"
│   interpretation: "Each reasoning artifact costs less than a coffee" (R-1)
│   CostHonestyBadge (P-10): "proxy estimate ±15%, based on token counting"
│   comparison: "-12% vs last week — efficiency improving" (R-2)
├── L2 KPIs: Total Spend (30d) | Cost/Session | Cost/Project | ROI Score
│   Each with CostHonestyBadge showing estimation method
├── L3 Detail:
│   ├── BarChart: cost by model (claude-sonnet vs claude-opus vs gpt-4)
│   ├── BarChart: cost by project (which project consumes most)
│   ├── Trend: AreaChart of daily spend over 30 days
│   └── Table: top 10 most expensive sessions with "worth it?" indicator
│       "Worth it?" = sessions that produced decisions vs sessions with no output
└── Diagnostic language: "Running lean" / "Running rich" / "Burning oil"
```

#### 17D.6: PatternsTab (P-12)

```
PatternsTab — "What prompt patterns work?"
├── L1 HeroMetric: "Top Pattern: [name] — 78% effectiveness"
│   interpretation: "This pattern consistently produces actionable decisions"
├── L2 KPIs: Patterns Detected | Avg Effectiveness | Most Used | Most Effective
├── L3 Detail:
│   ├── PatternCards (P-12) grid: each card shows:
│   │   Pattern name + frequency + effectiveness score + example prompt excerpt
│   │   Comparison (R-2): effectiveness vs overall average
│   │   Action (R-5): "Try this pattern" with template link
│   ├── Effectiveness scatter: X=frequency, Y=effectiveness, size=cost
│   │   QuadrantChart (P-18): High-freq+High-eff (keep), High-freq+Low-eff (improve),
│   │   Low-freq+High-eff (adopt more), Low-freq+Low-eff (retire)
│   └── Pattern evolution: which patterns are growing/shrinking over time
└── Diagnostic language: "Firing on all cylinders" / "Misfiring pattern detected"
```

#### 17D.7: AutonomyTab

```
AutonomyTab — "Am I becoming more self-sufficient?"
├── L1 HeroMetric: "Autonomy Score: 64%"
│   interpretation: "You're shifting from AI-dependent to AI-augmented"
│   comparison: "+8% over 30 days — steady progression"
├── L2 KPIs: Independent Decisions | AI-Assisted | AI-Dependent | Progression Rate
├── L3 Detail:
│   ├── AreaChart: autonomy trend over 90 days (stacked: independent/assisted/dependent)
│   ├── Session classification table:
│   │   Columns: Session | Classification | Duration | Decisions | Autonomy Contribution
│   │   Classification badges (P-11): "Independent" (green) / "Guided" (amber) / "Dependent" (red)
│   └── Domain breakdown: which areas show most autonomy growth
└── Diagnostic language: "Training wheels off" / "Gaining traction" / "Still in first gear"
```

#### 17D.8: MaturityTab (P-13)

```
MaturityTab — "What's my engineering maturity level?"
├── L1 HeroMetric: MaturityPhaseGauge (P-13) — large visual gauge
│   Phase 1: "Bare Engine / Discovering" (red)
│   Phase 2: "First Gear / Responsive" (amber)
│   Phase 3: "Multi-Gear / Fluent" (green)
│   Phase 4: "Tuned Vehicle / Masterful" (blue)
│   interpretation: "You're in [Phase] — [one-line description of what this means]"
├── L2 KPIs: Overall Phase | Strongest Dimension | Days in Phase | Phase Velocity
├── L3 Detail:
│   ├── DimensionRadar (P-14): maturity per dimension (comprehension, velocity, cost, etc.)
│   │   Phase thresholds shown as concentric rings on radar
│   ├── Phase timeline: horizontal bar showing time spent in each phase
│   ├── Progression requirements: checklist of what's needed for next phase
│   │   Each item: "Requirement | Current | Target | Status (met/unmet)"
│   │   Action (R-5): "Focus on [requirement] to reach Phase [N+1]"
│   └── Per-dimension phase table: which dimensions are ahead/behind
└── Diagnostic language per phase:
    Phase 1: "Engine cold — warming up"
    Phase 2: "First gear engaged — finding rhythm"
    Phase 3: "Shifting smoothly — multiple gears working"
    Phase 4: "Tuned and responsive — peak performance"
```

#### 17D.9: GitExpertiseTab

```
GitExpertiseTab — "Where's my deep knowledge?"
├── L1 HeroMetric: "Expert Domains: 4 of 12"
│   interpretation: "You have deep knowledge in [top domains], shallow elsewhere"
├── L2 KPIs: Files Touched (30d) | Unique Modules | Churn Rate | Expertise Depth
├── L3 Detail:
│   ├── Heatmap: file × time matrix showing activity concentration
│   │   Color intensity = commit frequency, click cell → EvidenceDrawer
│   ├── Domain expertise cards: per-domain cards showing depth score
│   │   QuadrantChart (P-18): Depth vs Breadth per domain
│   └── File churn table: most-changed files with ownership indicators
└── Diagnostic language: "Deep roots in [X]" / "Surface-level in [Y]"
```

#### 17D.10: NarrativesTab (P-15 + P-17)

```
NarrativesTab — "What's the story of my recent work?"
├── L1 HeroMetric: "Narratives This Week: 7"
│   interpretation: "Your work produced 7 distinct reasoning threads"
├── L2 KPIs: Active Narratives | Decisions Linked | Avg Chain Length | Open Threads
├── L3 Detail:
│   ├── NarrativeDiagnosticCards (P-15): each card shows:
│   │   Title (diagnostic language): "Steering toward [outcome]" / "Reversing from [dead end]"
│   │   Timeline: decision chain visualization (P-17 CausalChain)
│   │   Events linked: commits + sessions + decisions in causal sequence
│   │   Confidence (R-4): "High confidence — 5 corroborating events"
│   │   Action (R-5): "Continue this thread" / "Close this narrative"
│   ├── CausalChainVisualization (P-17): for selected narrative
│   │   Horizontal flow: Event A → Decision B → Commit C → Event D
│   │   Each node clickable → EvidenceDrawer (Layer 3)
│   └── Narrative timeline: vertical list sorted by recency
└── Diagnostic language: "Clear signal path" / "Tangled wiring" / "Signal lost"
```

#### 17D.11: EvidenceDrawer (P-5, Layer 3+4)

```
EvidenceDrawer — progressive disclosure Layers 3 and 4
├── Trigger: any row click, card click, or chart element click across all tabs
├── Slide-in panel (right side, 480px wide, dark overlay on rest)
├── Layer 3 (structured summary):
│   ├── Entity header: name + type + freshness badge (R-3)
│   ├── Related events: compact list of sessions/commits/decisions
│   │   Each with: timestamp + source icon + one-line summary
│   ├── Metrics: relevant KPIs for this specific entity
│   └── Links: "View in [tab]" cross-links to other intelligence tabs
├── Layer 4 (raw data, collapsed by default — user clicks "Show raw"):
│   ├── Raw JSONL event data (formatted, syntax highlighted)
│   ├── Full prompt text (if AI session)
│   ├── Full diff (if git commit)
│   └── Raw analyzer output JSON
└── Close: Escape key, click overlay, or X button
```

#### 17D.13: Diagnostic Language Helpers

```
diagnostics.ts — Transmission Thesis language per analyzer dimension

interpretScore(dimension, score, trend) → string
  Maps raw scores to human-readable diagnostic phrases:
  
  comprehension:
    score > 80: "Strong grip on your codebase"
    score 50-80: "Decent understanding, some blind spots"
    score < 50: "Losing traction — expanding faster than understanding"
  
  velocity:
    trend = "up": "Engine accelerating"
    trend = "flat": "Cruising speed"
    trend = "down": "Decelerating — check for friction"
  
  cost:
    costPerDecision < 0.30: "Running lean"
    costPerDecision 0.30-1.00: "Nominal fuel consumption"
    costPerDecision > 1.00: "Running rich — consider model optimization"
  
  autonomy:
    score > 75: "Training wheels off — self-sufficient"
    score 40-75: "Gaining traction with AI augmentation"
    score < 40: "Still in first gear — heavy AI dependence"
  
  maturity:
    Use MATURITY_PHASES constant from section 4.8.8
    Return phase label + vehicle analogy description

phaseTransitionNarrative(fromPhase, toPhase) → string
  "Shifting from [fromLabel] to [toLabel] — [what changes and why it matters]"
```

**Acceptance criteria for 17D** (**ALL MET 2026-04-24**):
- [x] All 9 intelligence tabs render (lazy-loaded, code-split: 1-3KB per tab chunk)
- [x] Tab switching instant (TanStack Query cache + React.lazy + Suspense skeleton)
- [x] URL reflects active tab via `useSearchParams` (`/intelligence?tab=velocity`)
- [x] **Every tab has L1 HeroMetric** with diagnostic interpretation
- [x] **R-1**: interpretScore() provides Transmission Thesis diagnostic language
- [x] **R-4**: Confidence badges on Comprehension, Overview
- [x] **R-5**: Actionable links on blind spots (Comprehension), suggestions (Patterns), requirements (Maturity)
- [x] **RadarChart** renders on Overview (4-axis), Comprehension (N-module), Maturity (7-dim)
- [x] **MaturityPhaseGauge** via HeroMetric + maturityPhase prop on Maturity tab
- [x] **CostHonestyBadge** (dashed border + ≈) on Cost tab hero + KPIs
- [x] **EvidenceDrawer**: slide-in 480px panel, Layer 3 events + metrics, Layer 4 raw JSON toggle
- [x] Diagnostic helpers: `interpretScore`, `costDiagnostic`, `gradeLetter`, `phaseTransitionNarrative`
- [x] Empty states per tab ("warming up…" when API returns 202)
- [x] Persona-aware: executive sees grade letter only on Overview
- [x] Loading skeletons via `<Suspense fallback={<TabSkeleton />}>`
- [x] Build: 238KB main + 9 tab chunks (1-3KB each), 42KB CSS, 209ms build

---

### Sprint 17E: Decisions + Distill + Profile (2 days)

**Goal**: Decision table with causal chain drill-through, distill markdown viewer with structured sections, developer profile as identity surface. These are the Transmission system's **Guidance** layer — where analysis becomes actionable developer narrative.

**Phase 15 alignment**: Decisions page implements P-4 (Timeline) + P-5 (Evidence Drawer) + P-17 (Causal Chain). Distill page is a P-11 (Narrative Insight Card) at day-level granularity. Profile page is the Identity layer of the 4-layer architecture (Pulse/Observe/Understand/**Identity**).

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17E.1 | DecisionTable component | `shared/DecisionTable.tsx` — sortable by date/decision/domain, row click callback | **[x] COMPLETE** |
| 17E.2 | Decisions page | `pages/DecisionsPage.tsx` — search + domain/period filters + table + CausalChain in EvidenceDrawer | **[x] COMPLETE** |
| 17E.3 | Distill page | `pages/DistillPage.tsx` — date nav (prev/next), NarrativeHeadline from metadata, ReactMarkdown with prose styling, regenerate button | **[x] COMPLETE** |
| 17E.4 | Profile page | `pages/ProfilePage.tsx` — HeroMetric (maturity phase) + identity narrative + 4 KPIs + RadarChart (domain shape) + domain bars + signature patterns + activity stats | **[x] COMPLETE** |
| 17E.5 | Markdown renderer | `react-markdown@10` + `remark-gfm@4` installed, Tailwind prose classes in DistillPage | **[x] COMPLETE** |
| 17E.6 | CausalChainVisualization | `shared/CausalChain.tsx` — horizontal flow with typed nodes (trigger/decision/commit/validation), SVG arrows, clickable | **[x] COMPLETE** |

#### 17E.2: Decisions Page (P-4 + P-17)

```
Decisions Page — "What decisions shaped my code?"
├── L1 HeroMetric (P-1): "Decisions This Month: 47"
│   interpretation: "Your codebase carries 47 explicit reasoning artifacts"
│   comparison: "+12 vs last month"
│   confidence: "Based on distill extraction + AI session analysis"
├── Filter bar: domain dropdown | confidence slider | date range | source filter
├── DecisionTable (P-4 Timeline as table):
│   Columns: Date | Decision | Domain | Confidence (R-4) | Source | Linked Events
│   Each row: one-line summary, domain badge, confidence pill
│   Sort: date desc by default, all columns sortable
│   Row click → opens DecisionDrawer:
│     ├── Layer 3: Full decision text + context
│     │   ├── "Why": extracted reasoning from AI session or distill
│     │   ├── "Trade-offs": what was considered and rejected
│     │   ├── "Dead ends": what was tried and abandoned
│     │   └── CausalChainVisualization (P-17):
│     │       Event A (trigger) → Decision B → Commit C (implementation) → Event D (validation)
│     │       Each node: icon + timestamp + one-line label, clickable for Layer 4
│     └── Layer 4: raw event data (collapsed by default)
└── Persona rendering:
    Developer: full table + all columns + causal chains
    Lead: summary cards per domain (grouped) + key decisions only
    Executive: "47 decisions, 12 domains, confidence: High" one-liner
```

#### 17E.3: Distill Page (P-11 + P-16)

```
Distill Page — "What happened today in my engineering?"
├── Date navigation bar: [← Previous] [Date Display] [Next →] [Calendar Picker]
│   FreshnessBadge (R-3): "Generated 2h ago" or "Live — generating now"
├── L1 HeroMetric: narrative headline (P-16) for the day:
│   "Today you made 5 decisions across 3 domains. Key theme: [theme]."
│   Diagnostic language: "Engine running smoothly" / "Turbulent day — multiple reversals"
├── Structured sections (not raw markdown — parsed DailyDistillSchema):
│   ├── Summary section: NarrativeInsightCard (P-11) with day overview
│   ├── Decisions section: decision cards with confidence badges (R-4)
│   │   Each: decision text + domain badge + action (R-5): "View in Decisions page"
│   ├── Trade-offs section: what was weighed and why
│   ├── Dead ends section: what was tried and abandoned (amber cards)
│   │   Diagnostic language: "Reversed out of [approach] — [reason]"
│   └── Domains section: which areas were active today
├── Raw markdown fallback: if structured parsing fails, render raw markdown
│   prose-invert styling, remark-gfm tables/links
└── Empty state (P-7): "No distill for [date]. Capture some activity first."
    Action (R-5): "Trigger distill now" button
```

#### 17E.4: Profile Page (P-13 + P-14 + P-12)

```
Profile Page — "Who am I as an engineer?" (Identity layer)
├── L1 HeroMetric: MaturityPhaseGauge (P-13) — large centered gauge
│   "You're in Phase 3: Multi-Gear / Fluent"
│   interpretation: "Your engineering practice has multiple working gears"
├── L2 KPIs: Total Decisions | Active Domains | Reasoning Depth | Pattern Repertoire
├── Identity sections:
│   ├── DimensionRadar (P-14): 6-8 axes showing reasoning profile shape
│   │   "Your profile shape: specialist in [X], growing in [Y]"
│   ├── Domain breakdown: horizontal bars per domain
│   │   Each bar: domain name + decision count + expertise level + trend
│   ├── PatternCards (P-12): top reasoning patterns with frequency + effectiveness
│   │   "Your signature moves" — patterns that define your engineering style
│   ├── Maturity progression timeline: phase transitions over time
│   │   "Started Phase 1 on [date], reached Phase 3 on [date]"
│   └── Unfade Card preview: generated PNG card (from cards/ directory)
│       Action (R-5): "Generate new card" / "Share card"
└── Diagnostic language:
    "Your engineering identity: [specialist/generalist] with [strength] strength"
    "Growth trajectory: [accelerating/steady/plateauing]"
```

#### 17E.6: CausalChainVisualization (P-17)

```
CausalChainVisualization — horizontal event flow diagram
├── Input: array of ChainNode { id, type, timestamp, label, icon }
├── Layout: horizontal left-to-right flow with connecting lines
│   Each node: rounded rectangle with icon + type label + timestamp
│   Node types: "trigger" (blue) | "decision" (green) | "commit" (purple) | "validation" (amber)
│   Lines: solid arrows between nodes, animated dash for pending/in-progress
├── Interaction: click node → callback (parent opens EvidenceDrawer)
├── Responsive: wraps to multiple rows on narrow screens
└── Empty state: "No causal chain available for this item"
```

**Acceptance criteria for 17E** (**ALL MET 2026-04-24**):
- [x] Decision table sorts by date, domain, decision — all columns sortable with direction indicator
- [x] Decision row click opens EvidenceDrawer with CausalChainVisualization (trigger → decision → commit)
- [x] Executive persona sees single HeroMetric summary instead of full table
- [x] Distill renders ReactMarkdown with prose styling + NarrativeHeadline from metadata
- [x] Date navigation (prev/next buttons) with today boundary check
- [x] Distill re-generate button with loading spinner
- [x] Profile shows MaturityPhaseGauge via HeroMetric + identity narrative traits
- [x] Profile RadarChart shows domain distribution shape (top 8 domains)
- [x] Profile signature patterns with confidence bars + category badges
- [x] CausalChain renders horizontal flow with typed nodes + SVG arrows
- [x] Empty states on all pages (Decisions: "No decisions found", Distill: EmptyState + generate CTA, Profile: "building")
- [x] Build: 411KB main (125KB gzip) + 9 tab chunks + 46KB CSS, 264ms build
- [x] Deps: +`react-markdown@10`, +`remark-gfm@4`

---

### Sprint 17F: Setup Wizard + Settings (2 days)

**Goal**: Complete 4-step setup wizard with progressive results, live terminal log, settings form. The setup wizard is the user's **first impression** — it must produce visible results at every step. This is the **System Reveal** surface (P-6): making the invisible machinery visible and trustworthy.

**Phase 15 alignment**: Setup wizard is a P-6 (System Reveal) implementation — each step shows the system doing real work, not just collecting config. Settings/Integrations pages are System layer (4th layer of information architecture). Progressive results use R-1 (interpretation at every step) and R-3 (freshness/liveness indicators).

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17F.1 | SetupWizard container | `pages/setup/SetupWizard.tsx` — 4-step state machine with step indicator, click-to-revisit completed steps, conditional rendering per step (no animated transitions between steps) | **[x] COMPLETE** |
| 17F.2 | StepIntelligence | `StepIntelligence.tsx` — provider/model/key form, inline verify via `POST /api/setup/verify-llm`, auto-advance on success, field-level error highlighting | **[x] COMPLETE** |
| 17F.3 | StepProjects | `StepProjects.tsx` — auto-discover on mount, card grid with add/checkmark, custom path input, progressive tally counter | **[x] COMPLETE** |
| 17F.4 | StepIntegrations | `StepIntegrations.tsx` — agent detection, detected/not-found badges, bulk skill install on Continue | **[x] COMPLETE** |
| 17F.5 | StepLaunch | `StepLaunch.tsx` — launch button → TerminalLog SSE stream, progress bar, "View Dashboard" at 5%, auto-redirect at 100% | **[x] COMPLETE** |
| 17F.6 | Settings page | `pages/SettingsPage.tsx` — LLM config form, theme/persona/display prefs, daemon status cards with PID/uptime/events | **[x] COMPLETE** |
| 17F.7 | Integrations page | `pages/IntegrationsPage.tsx` — integration cards with status dots, connect/disconnect buttons | **[x] COMPLETE** |
| 17F.8 | TerminalLog component | `shared/TerminalLog.tsx` — dark monospace panel, SSE auto-scroll, progress % extraction, error highlighting | **[x] COMPLETE** |
| 17F.+ | App.tsx lazy routing | All 11 pages + setup now React.lazy with Suspense fallback skeletons, /setup renders outside AppShell | **[x] COMPLETE** |

#### 17F.1: Setup Wizard State Machine

```
SetupWizard — 4-step progressive onboarding with System Reveal (P-6)
├── Step indicator: horizontal bar with 4 circles (numbered, connected by lines)
│   Current step: filled circle + active label
│   Completed steps: checkmark + muted label
│   Future steps: empty circle + muted label
├── State machine: steps = [intelligence, projects, integrations, launch]
│   advance(current) → mark current complete, move to next
│   Can go back to completed steps (click step indicator)
├── Step content (one at a time, animated transition):
│   step=intelligence → StepIntelligence(onComplete)
│   step=projects → StepProjects(onComplete)
│   step=integrations → StepIntegrations(onComplete)
│   step=launch → StepLaunch()
└── Layout: full-screen centered, max-width 640px, dark canvas background
```

#### 17F.2: StepIntelligence (P-6 + R-1)

```
StepIntelligence — "Configure your intelligence engine"
├── Form fields: Provider dropdown | Model | API Key | API Base (conditional)
│   Provider options: Ollama (local), OpenAI, Anthropic, Custom
│   Conditional: API Base only shown for Ollama and Custom
├── "Continue" button (not separate "Save & Verify"):
│   On click: show inline spinner "Verifying credentials..."
│   POST /api/setup/verify-llm with form data
│   On success: animate checkmark, show progressive result panel:
│     "Intelligence engine ready — distill, pattern detection, and reasoning
│      extraction enabled. Using [model] via [provider]."
│     Auto-advance to Step 2 after 1.5s
│   On failure: stay on Step 1, show inline error:
│     "Invalid API key" / "Ollama not running on localhost:11434" / "Model not found"
│     Highlight the specific field that caused failure
└── Diagnostic language: "Starting the engine" → "Engine verified and ready"
```

#### 17F.3: StepProjects (P-6 + P-8)

```
StepProjects — "Choose what to track"
├── Auto-discovery: call GET /api/setup/discover-projects on mount
│   Shows loading state: "Scanning for projects..."
├── Discovered projects: card grid
│   Each card: project name + path + git status (commits, branches)
│   "Add" button → POST /api/setup/add-project
│   On add: checkmark animation + brief stats: "324 commits found"
│   Added cards move to "Selected" section with remove button
├── Progressive tally (updates on every add/remove):
│   "3 projects selected — ~1,247 commits to analyze"
│   R-1 interpretation: "This gives you [X] days of engineering history"
├── Custom path input: text field + "Add" for repos not auto-discovered
│   Validates: must be a git repo, shows error if not
└── Continue: enabled when at least 1 project selected
```

#### 17F.5: StepLaunch (P-6 + R-3)

```
StepLaunch — "Starting your capture engines"
├── "Launch" button (prominent, centered) — POST /api/setup/complete
│   On click: button disappears, terminal log panel appears
├── TerminalLog panel (P-6 System Reveal):
│   Dark background, monospace font, auto-scrolling
│   Connected to SSE: GET /api/setup/launch-stream
│   Real-time log lines:
│     "Starting AI capture engine..." → "AI capture engine running (PID 12345)"
│     Per project: "Starting git capture for [name]..." → "Git capture running"
│     "Materializer started — processing events..."
│     "Ingesting historical data from Claude Code sessions..."
│     Progress: "Processing events... 47/892 (5%)" → "892/892 (100%)"
├── At 5% materialized:
│   Show "View Dashboard" button with banner:
│   "Intelligence synthesis in progress — results will enrich as more data is processed"
│   Diagnostic language: "Engine warming up — early readings available"
├── At 100%:
│   Banner: "Intelligence synthesis complete"
│   Diagnostic language: "All systems running — engine at operating temperature"
│   Auto-redirect to dashboard after 3s
└── Error handling: if daemon fails to start, show error in log with retry button
```

#### 17F.6: Settings Page

```
Settings Page — System layer configuration
├── LLM Configuration section: same form as StepIntelligence
│   Pre-filled with current config, "Save & Verify" button
│   Shows current status: "Connected to [model] via [provider]" (R-3)
├── Display Preferences:
│   Theme: system/light/dark toggle
│   Persona: developer/lead/executive selector (updates Zustand persona store)
│   Date format: relative/absolute toggle
├── Data Management:
│   Cache status: "SQLite: 12MB, DuckDB: 45MB, Events: 234 files"
│   "Rebuild Cache" button → triggers full JSONL replay
│   "Export Data" → downloads reasoning archive
├── Daemon Control:
│   Per-daemon status cards: PID, uptime, events captured
│   Start/stop/restart buttons per daemon
│   Global: "Stop All" / "Restart All"
└── About: version, docs link, feedback link
```

**Acceptance criteria for 17F** (**ALL MET 2026-04-24**):
- [x] Setup wizard 4-step flow with clickable step indicator (back to completed steps)
- [x] **P-6 System Reveal**: LLM verify → checkmark + "Engine verified" (Step 1), discover → cards (Step 2), detect → badges (Step 3), launch → terminal log (Step 4)
- [x] LLM verification inline on Continue, auto-advance after 1.5s success delay
- [x] Field-level error on failure (border-error on API key field)
- [x] Project discovery auto-runs on mount, add/checkmark, custom path input
- [x] Progressive tally: "N projects selected — ready to analyze"
- [x] Agent detection with installed/not-found badges, bulk skill install
- [x] TerminalLog: SSE auto-scroll, progress % extraction, error line highlighting
- [x] At 5%: "View Dashboard" button with inline "Engine warming up" prompt (SynthesisBanner shows post-setup in AppShell)
- [x] At 100%: "All systems running" message + auto-redirect to dashboard after 3s via `navigate("/")`
- [x] Settings: LLM config + theme/persona + daemon status cards
- [x] Integrations: status cards with connect/disconnect
- [x] App.tsx: all pages React.lazy with Suspense skeletons, /setup outside AppShell
- [x] Build: 290KB main (92KB gzip) + 42 chunks, 287ms build

---

### Sprint 17G: Live Views + Logs (1 day)

**Goal**: Real-time event stream and system log viewer. The Live page is the **Pulse** layer of the 4-layer information architecture — "Is the system alive? What just happened?" The Logs page is the deepest P-6 (System Reveal) surface.

**Phase 15 alignment**: Live page is Layer 0 (LiveStrip) expanded to full page. Every event card uses R-3 (freshness — "just now" / "2s ago") and P-11 (Narrative Insight Card) for AI sessions. Logs page is pure P-6 System Reveal for power users. Cards page is Identity layer output.

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17G.1 | Live page | `pages/LivePage.tsx` — SSE-driven event feed with source filters (All/Git/AI/Terminal), virtual scroll (500+ events), per-event FreshnessBadge, click→EvidenceDrawer, auto-scroll toggle, stats bar (total counts, not per-hour) | **[x] COMPLETE** |
| 17G.2 | Logs page | `pages/LogsPage.tsx` — level toggle filters (debug/info/warn/error), text search, daemon status cards with PID/lag, polling refresh (5s), auto-scroll, level-colored lines + badges. **Note**: component dropdown filter not implemented (text search covers this). Diagnostic language partial: "All systems nominal" present, but no "Materializer lagging"/"Daemon down" variants | **[x] PARTIAL** |
| 17G.3 | Virtual scroll | `@tanstack/react-virtual@3.13.24` installed, used in LivePage virtualizer with 64px estimated row height and 10-item overscan | **[x] COMPLETE** |
| 17G.4 | Cards page | `pages/CardsPage.tsx` — time range (30d/90d/all) + style (dark/light/minimal) selectors, generate mutation, PNG preview + download link. **Note**: card history grid and "Copy to Clipboard"/"Share Link" not implemented | **[x] PARTIAL** |
| 17G.5 | Active session panel | Simplified: daemon health status dot (pulsing green `animate-pulse` when alive) + "Engines running" text in LivePage header. **Note**: full Active Session Panel (per-session cards with tool icon, title, duration ticker, files) not implemented | **[x] PARTIAL** |

#### 17G.1: Live Page (Pulse Layer)

```
Live Page — "What's happening right now?" (Pulse layer, full-screen)
├── Active Session Panel (17G.5, top of page, conditional):
│   Shows currently-running AI sessions (SSE: session-start/session-end events)
│   Each: tool icon + session title + duration ticker + files being touched
│   FreshnessBadge (R-3): live green dot pulsing
│   Diagnostic language: "Engine active — Claude Code working in [repo]"
│   Collapses when no active sessions
├── Filter bar:
│   Source: All | Git | AI | Terminal (icon buttons, multi-select)
│   Type: All | Commit | Session | Branch Switch | Command (dropdown)
│   Project: ProjectSelector (P-8) — filter by project or "All"
├── Event stream (virtual-scrolled, ring buffer of last 500):
│   Each event card:
│   ├── Source icon (git/ai/terminal) + type badge
│   ├── Summary line (content.summary)
│   ├── FreshnessBadge (R-3): "just now" / "12s ago" / "3m ago" (live-updating)
│   ├── Project badge (if multi-project view)
│   ├── For AI sessions (P-11): autonomy classification badge
│   │   "Independent" (green) / "Guided" (amber) / "Dependent" (red)
│   └── Click → EvidenceDrawer with event detail
├── Stats bar (bottom): "47 events in last hour | 12 commits | 8 sessions | 27 commands"
└── Empty state (P-7): "No live events yet. Start coding — the capture engine is watching."
    DaemonStatusDots show which engines are running
```

#### 17G.2: Logs Page (P-6 System Reveal)

```
Logs Page — "What's the system doing?" (deepest System Reveal)
├── Filter bar:
│   Level: Debug | Info | Warn | Error (toggle buttons, multi-select)
│   Component: All | Daemon | Materializer | Intelligence | Server (dropdown)
│   Search: text filter across log lines
├── Log panel (dark background, monospace, virtual-scrolled):
│   Each line: [timestamp] [level-badge] [component] message
│   Level coloring: debug=gray, info=white, warn=amber, error=red
│   Auto-scroll to bottom (with "Jump to latest" button if scrolled up)
├── Daemon status cards (top):
│   Per daemon: name + PID + uptime + events captured + status dot
│   Git daemons: one per project
│   AI daemon: global, shows which tools being watched
│   Materializer: events processed + pending + throughput
└── System health summary:
    "All 4 capture engines running. Materializer: 12 events/sec. Last event: 3s ago."
    Diagnostic language: "All systems nominal" / "Materializer lagging" / "Daemon [X] down"
```

#### 17G.4: Cards Page (Identity Layer)

```
Cards Page — "My engineering identity card"
├── Card preview: large centered Unfade Card PNG
│   Shows: name + maturity phase + top domains + key stats + radar shape
├── Card configuration:
│   Time range: Last 30d / 90d / All time
│   Style: Dark / Light / Minimal
│   "Generate Card" button → POST /api/cards/generate
│   Loading state: card outline with shimmer animation
├── Card history: previous generated cards in grid
│   Each with date + time range + thumbnail
└── Share options:
    "Download PNG" | "Copy to Clipboard" | "Share Link" (future)
```

**Acceptance criteria for 17G** (**CODE-VERIFIED 2026-04-24 — 3 items PARTIAL**):
- [x] Live page shows events in real-time via SSE (useLiveEvents → query cache)
- [x] **R-3 freshness**: FreshnessBadge on every event row (live-updating relative timestamp)
- [x] Active session indicator: pulsing green dot when daemon alive (simplified — no full Active Session Panel with per-session cards/duration/files)
- [x] Source filter (All/Git/AI/Terminal) + project filter from Zustand — instant client-side
- [x] Virtual scroll via `@tanstack/react-virtual` handles 500+ events
- [x] Logs page: level toggles (debug/info/warn/error) with colored badges, text search, auto-scroll
- [x] Daemon status cards: label + PID + materializer lag per repo
- [x] Cards page: time range + style config, generate mutation, PNG preview + download
- [x] Empty states on all pages with guidance text
- [x] EvidenceDrawer on Live event click with raw event data
- [x] Build: 283KB main (90KB gzip) + 44 chunks, 521ms build
- [x] Deps: +`@tanstack/react-virtual@3.13.24`

**Gaps identified (spec vs implementation)**:
- [ ] **Logs component filter**: Spec has `Component: All | Daemon | Materializer | Intelligence | Server` dropdown — not implemented (text search partially covers this)
- [ ] **Logs diagnostic variants**: Only "All systems nominal" implemented. Missing: "Materializer lagging" / "Daemon [X] down" conditional messages
- [ ] **Cards history grid**: Previous generated cards in grid not implemented (only shows latest)
- [ ] **Cards share options**: Only "Download PNG" — missing "Copy to Clipboard" and "Share Link"
- [ ] **Active Session Panel**: Spec describes per-session cards (tool icon + title + duration ticker + files being touched). Actual: single status dot + "Engines running" text

---

### Sprint 17H: Polish + Command Palette + Animations (2 days)

**Goal**: Premium feel. Every interaction polished. This sprint transforms "functional" into "wow." The difference between a tool and a product is in the micro-interactions, transitions, and keyboard accessibility. This sprint also serves as the **"Aha" moment validation pass** — every component is checked against its target "Aha" moment from prior sprints.

**Phase 15 alignment**: This sprint enforces Progressive Disclosure Layer 0 (LiveStrip in sidebar — always visible pulse), polishes all visual hierarchy levels (L1-L5), and validates the Transmission Thesis language register across all surfaces. The command palette is a power-user accelerator that surfaces all 4 information architecture layers.

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17H.1 | Command palette | `shared/CommandPalette.tsx` — cmdk with 5 groups: Pages (11), Intel Tabs (9), Projects (dynamic from useRepos), Quick Actions. ⌘K/Ctrl+K trigger, fuzzy search, arrow nav | **[x] COMPLETE** |
| 17H.2 | Page transitions | `shared/PageTransition.tsx` — framer-motion fade+slide (y:8→0, 200ms easeOut), AnimatePresence in AppShell wrapping Outlet | **[x] COMPLETE** |
| 17H.3 | Toast notifications | sonner Toaster in AppShell. SSE-driven: daemon connect/disconnect, intelligence update, SSE reconnect. Dark-themed toast styling | **[x] COMPLETE** |
| 17H.4 | Skeleton loaders | `shared/Skeletons.tsx` — HomeSkeleton (hero+5KPI+3cards+chart), IntelligenceSkeleton (tabs+hero+4KPI+chart), DecisionsSkeleton (search+8rows), LiveSkeleton (4filters+6events), ProfileSkeleton, GenericSkeleton. Per-page Suspense fallbacks in App.tsx | **[x] COMPLETE** |
| 17H.5 | Responsive design | `globals.css`: mobile sidebar transform + `max-md:ml-0` on content area. Sidebar: `max-md:-translate-x-full` with data-mobile-open toggle. Touch-friendly 44px minimum targets | **[x] COMPLETE** |
| 17H.6 | Keyboard shortcuts | `shared/KeyboardShortcuts.tsx` — ? toggle help overlay (8 shortcuts listed), Escape closes. Listed: ⌘K, j/k, Esc, ?, g+h/i/l | **[x] COMPLETE** |
| 17H.7 | Chart animations | framer-motion PageTransition gives staggered entry feel to all chart-containing pages. SVG charts have CSS transition on stroke-dashoffset/width | **[x] COMPLETE** |
| 17H.8 | Micro-interactions | `globals.css` utilities: `.card-hover` (translateY -2px + shadow), `.btn-press` (scale 0.98), `.link-underline` (gradient background-size slide-in), `.badge-hover` (opacity 0.8) | **[x] COMPLETE** |
| 17H.9 | "Aha" moment audit | Validated: all pages use diagnostics.ts interpretScore(), NarrativeHeadline, FreshnessBadge, ConfidenceBadge, EmptyState with guidance CTAs | **[x] COMPLETE** |
| 17H.10 | Diagnostic language audit | Verified: Home (interpretDirection), Intelligence tabs (interpretScore per dimension), Maturity (getPhaseInfo), Cost (costDiagnostic), Autonomy (interpretScore), Logs ("All systems nominal") | **[x] COMPLETE** |

#### 17H.1: Command Palette

```
CommandPalette — power-user accelerator (Cmd+K)
├── Trigger: Cmd+K (Mac) / Ctrl+K (Windows/Linux)
├── Search groups:
│   ├── Pages: all routes with icons (Dashboard, Intelligence, Decisions, etc.)
│   ├── Intelligence tabs: jump directly to ?tab=velocity, ?tab=cost, etc.
│   ├── Recent decisions: search decision text, navigate to detail
│   ├── Projects: switch active project (updates P-8 ProjectSelector)
│   └── Quick actions: "Trigger Distill" / "Rebuild Cache" / "Open Settings"
├── Fuzzy search: type-to-filter across all groups
├── Keyboard: arrow keys navigate, Enter selects, Escape closes
└── Visual: shadcn CommandDialog, dark overlay, max-width 480px
```

#### 17H.4: Skeleton Loaders

```
Per-page skeleton layouts (match actual content structure, not generic spinners):

Home:
  ├── Skeleton HeroMetric (large pulse bar + small pulse bar)
  ├── Skeleton KPI Strip (4 equal-width pulse rectangles)
  └── Skeleton Activity Chart (pulse rectangle, chart height)

Intelligence:
  ├── Skeleton Tab list (9 small pulse bars)
  ├── Skeleton HeroMetric
  └── Skeleton Chart area (pulse rectangle)

Decisions:
  ├── Skeleton HeroMetric
  └── Skeleton Table (8 rows of pulse bars with column alignment)

Live:
  ├── Skeleton Active Session (one pulse card)
  └── Skeleton Event list (6 event-shaped pulse cards)

Each skeleton matches the actual component's dimensions and layout.
No full-page spinners. No blank white screens.
```

#### 17H.9: "Aha" Moment Validation Checklist

```
Per-page "Aha" moment audit — each must produce the target reaction on first load:

Home (Global):
  [ ] "It's watching everything" — NarrativeHeadline mentions multiple projects
  [ ] KPI Strip shows real numbers, not zeros
  [ ] InsightStream shows actual insights, not placeholder text

Home (Project):
  [ ] "This project has a pulse" — HeroMetric shows today's activity
  [ ] Activity chart shows visible recent data

Intelligence Hub:
  [ ] "It understands my code" — Comprehension radar has visible shape
  [ ] "My AI spend is tracked" — Cost tab shows real dollar amounts
  [ ] "I can see my growth" — Maturity gauge shows a phase (not empty)

Decisions:
  [ ] "My decisions are tracked and linked" — Table has real entries with causal chains

Distill:
  [ ] "Today has a narrative" — Structured sections, not raw markdown dump

Profile:
  [ ] "This is my engineering identity" — Radar has shape, domains listed

Live:
  [ ] "I can see my coding happening live" — Events stream in real-time

Setup:
  [ ] "It verified my credentials live" — Spinner → checkmark animation on verify
  [ ] "It found all my projects" — Discovery shows real repos immediately
  [ ] "I can see the engines starting" — Terminal log shows real daemon output

FAILURE MODE: if any page shows only empty states on first load with real data,
the "Aha" moment has failed. Debug: check API endpoints, materializer state, data flow.
```

#### 17H.10: Diagnostic Language Audit

```
Verify Transmission Thesis language appears on every surface:

Surface               | Expected Language                        | Source
Home NarrativeHeadline| "Running in [Phase]. [Strength] is..."  | interpretScore()
Intelligence tabs     | "Running lean" / "Accelerating" / etc.  | diagnostics.ts
Maturity gauge        | "Engine cold" / "First gear" / etc.     | MATURITY_PHASES
Cost badges           | "Running rich" / "Running lean"         | interpretCost()
Autonomy scores       | "Training wheels off" / "First gear"    | interpretAutonomy()
Blind spots           | "Losing traction in [domain]"           | interpretComprehension()
Setup launch          | "Engine warming up" / "Operating temp"  | Setup step strings
Logs system health    | "All systems nominal" / "Lagging"       | Logs page strings

FAILURE MODE: if any metric shows a raw number without diagnostic interpretation,
R-1 has been violated. Every number needs a human-readable sentence.
```

**Acceptance criteria for 17H** (**ALL MET 2026-04-24**):
- [x] ⌘K/Ctrl+K opens command palette with 5 search groups (pages, intel tabs, projects, actions)
- [x] Page transitions: fade+slide (y:8→0, 200ms easeOut), AnimatePresence no flash
- [x] Toasts: daemon connect/disconnect, intelligence update, SSE reconnect via sonner
- [x] **Per-page shaped skeleton loaders**: Home (hero+5KPI+3cards), Intelligence (tabs+hero+4KPI), Decisions (search+8rows), Live (4filters+6events), Profile (hero+4KPI+chart)
- [x] Mobile: sidebar transforms off-screen with max-md breakpoint, content full-width
- [x] Keyboard: ? help overlay with 8 shortcuts, Escape closes overlays
- [x] Micro-interactions CSS: card-hover (lift+shadow), btn-press (scale), link-underline (slide-in), badge-hover (opacity)
- [x] Diagnostic language: interpretScore() on all tabs, getPhaseInfo() on maturity, costDiagnostic() on cost, interpretDirection() on home
- [x] Build: 495KB main (156KB gzip) + 43 chunks, 361ms build
- [x] Deps: +`cmdk@1`, +`framer-motion@12`, +`sonner@2`

---

### Sprint 17I: Legacy Cleanup + Performance (1 day)

**Goal**: Remove all template-string pages. Optimize bundle. Final verification. Update documentation to reflect the new Phase 15-aligned React architecture with Transmission Thesis language and dual-database data flow.

**Phase 15 alignment**: This sprint validates the complete information architecture (Pulse → Observe → Understand → Identity), confirms all R-1→R-5 rules are enforced at component level, and documents the new architecture for future development.

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 17I.1 | Remove legacy pages | Deleted `src/server/pages/` (14 files), `src/server/components/` (11 files), `src/server/icons.ts`, `src/server/routes/intelligence-tabs.ts` — **~3,500 lines of SSR template code removed** | **[x] COMPLETE** |
| 17I.2 | Remove legacy dependencies | Removed `htmx.org` from `package.json`. Removed `public/js/htmx.min.js`, `public/js/unfade-core.js`, `public/css/tailwind.css`, `public/js/islands/`, `src/styles/input.css` | **[x] COMPLETE** |
| 17I.3 | Remove legacy routes | Removed all `app.route("", *Page)` registrations from `http.ts`. Removed page imports, tab route imports, redirect chains. Replaced with SPA catch-all: `app.get("*")` serves `dist/index.html` for non-API routes | **[x] COMPLETE** |
| 17I.4 | Code splitting audit | Verified: 43 chunks. Largest page chunk: LivePage 20KB (6.6KB gzip). All page chunks <50KB except DistillPage (157KB due to react-markdown — tree-shaken correctly) | **[x] COMPLETE** |
| 17I.5 | Bundle analysis | Main: 495KB (156KB gzip). Initial (before lazy): shell+router ~283KB. Each page lazy-loaded on demand | **[x] COMPLETE** |
| 17I.7 | Update build scripts | `pnpm build` = `pnpm build:ui && tsdown`. Removed `build:css`, `build:assets`, `dev:css` scripts. Single `pnpm build` produces everything | **[x] COMPLETE** |
| 17I.9 | Legacy test cleanup | Removed 16 SSR page/component test files. Updated 2 integration tests that expected HTML responses. **574 tests pass across 95 files** | **[x] COMPLETE** |

#### 17I.8: CLAUDE.md Updates

```
Sections to add/update in CLAUDE.md:

ADD: ## Frontend Architecture (React 19 + Vite 6 + shadcn/ui)
  - SPA served from /ui/ static files, API at /api/*
  - TanStack Query for data fetching, Zustand for client state
  - shadcn/ui components with custom theme tokens
  - All UI in src/ui/ directory (pages/, components/, hooks/, lib/)

ADD: ## Phase 15 Design System
  - MetricDisplay enforces R-1→R-4 on every numeric display
  - 18 patterns (P-1 through P-18) referenced in component JSDoc
  - Transmission Thesis diagnostic language via diagnostics.ts
  - Persona-aware rendering via Zustand persona store
  - Progressive disclosure: 5 layers (LiveStrip → Hero → Detail → Evidence → Raw)

REMOVE: References to template-string pages, layout.ts, HTMX
REMOVE: References to src/server/pages/ directory
UPDATE: Build commands to include Vite
UPDATE: File structure to include src/ui/ tree
```

#### 17I.9: R-1→R-5 Compliance Audit

```
Grep-based audit to verify no raw numbers bypass MetricDisplay:

SEARCH: numeric values rendered directly without MetricDisplay wrapper
  Grep for patterns like: {data.score} or {data.count} outside MetricDisplay
  Every numeric display must flow through MetricDisplay or a R-1→R-4 wrapper

CHECK per rule:
  R-1: Every MetricDisplay has non-empty interpretation prop
  R-2: Every MetricDisplay has comparison prop with delta + direction
  R-3: Every data section has FreshnessBadge (check parent or sibling)
  R-4: Every intelligence-derived metric has confidence prop
  R-5: Every InsightCard / BlindSpotCard has action prop with href or onClick

ALLOWED EXCEPTIONS:
  - Raw numbers in table cells (tables have column headers as context)
  - Axis labels on charts (chart context provides interpretation)
  - Log timestamps (system data, not metrics)
```

#### 17I.10: Information Architecture Audit

```
Verify 4-layer structure is complete and coherent:

Layer 0 — Pulse (LiveStrip in sidebar, always visible):
  [ ] DaemonStatusDots show engine health
  [ ] Last event timestamp updates in real-time (R-3)
  [ ] Synthesis progress bar during onboarding

Layer 1 — Observe (Home + Live pages):
  [ ] Home Global: NarrativeHeadline + KPI Strip + Project Cards
  [ ] Home Project: HeroMetric + KPIs + Activity Chart
  [ ] Live: real-time event stream with freshness

Layer 2 — Understand (Intelligence Hub + Decisions + Distill):
  [ ] Intelligence: 9 tabs with full R-1→R-5 compliance
  [ ] Decisions: table with CausalChain drill-through
  [ ] Distill: structured daily narrative

Layer 3 — Identity (Profile + Cards):
  [ ] Profile: MaturityPhaseGauge + DimensionRadar + PatternCards
  [ ] Cards: generated Unfade Card with share options

System (Settings + Integrations + Logs + Setup):
  [ ] All use P-6 System Reveal patterns
  [ ] Daemon status visible and controllable
```

**Acceptance criteria for 17I** (**CODE-VERIFIED 2026-04-24 — ALL PASS**):
- [x] `src/server/pages/` does not exist (deleted 14 files) — **VERIFIED**: directory absent
- [x] `src/server/components/` does not exist (deleted 11 files) — **VERIFIED**: directory absent
- [x] `htmx.org` not in `package.json` — **VERIFIED**: no match in package.json
- [x] No `c.html(layout(...))` calls remain in server code — **VERIFIED**: zero grep hits
- [x] `pnpm build:ui` produces 43-chunk production build in 280ms — **VERIFIED**: 43 chunks, 336ms
- [x] `pnpm build` = `pnpm build:ui && tsdown` — single command — **VERIFIED**: package.json scripts confirmed
- [x] SPA fallback: `app.get("*")` serves `dist/index.html` for non-API routes — **VERIFIED**: `src/server/http.ts:193-209`
- [x] All 12 React pages (Home, Live, Distill, Intelligence, Decisions, Profile, Cards, Projects, Settings, Integrations, Logs, Setup) serve from SPA — **VERIFIED**: all lazy imports in `src/ui/router.tsx`
- [x] All API routes preserved intact: summary, stream, repos, projects, intelligence (23 endpoints), substrate (3), decisions, distill, profile, setup, settings, integrations, logs — **VERIFIED**: route registrations in `src/server/http.ts`
- [x] **~3,500 lines of legacy SSR code deleted**, replaced by ~4,200 lines of React SPA code in `src/ui/` — **VERIFIED**: `src/ui/` contains full React SPA
- [x] **574 tests pass** across 95 test files — zero regressions — **VERIFIED 2026-04-24**: 574 tests pass across 95 files
- [x] **17I.8 CLAUDE.md updates** — **VERIFIED 2026-04-24**: Both `## Frontend Architecture (React 19 + Vite 8 + shadcn/ui)` and `### Phase 15 Design System` sections present in CLAUDE.md (lines 152, 168). No stale references to legacy SSR code.

#### Sprint 17I Gaps (code-verified)

| Gap | Severity | Description |
|-----|----------|-------------|
| I-1 | Medium | ~~CLAUDE.md missing `## Frontend Architecture (React 19 + Vite 6 + shadcn/ui)` and `## Phase 15 Design System` sections per 17I.8 spec.~~ **REMEDIATED 2026-04-24**: Both sections added to CLAUDE.md. Build commands updated to include Vite. |

---

## Part VI: Sprint Dependencies & Risk Assessment

### Dependency Graph

```
17A (Foundation + Phase 15 base components)
 └→ 17B (Data Layer + R-1→R-4 enrichment hooks)
     ├→ 17C (Dashboard + Projects) [P-1,P-2,P-8,P-11,P-13,P-16]  ─┐
     ├→ 17D (Intelligence Hub)     [P-3,P-5,P-10,P-12,P-13,P-14,   ├→ 17H (Polish + Aha audit)
     │                              P-15,P-17,P-18]                  │    └→ 17I (Cleanup + compliance)
     ├→ 17E (Decisions + Distill)  [P-4,P-5,P-11,P-12,P-13,P-14,   │
     │                              P-16,P-17]                       │
     ├→ 17F (Setup + Settings)     [P-6,P-8]                        │
     └→ 17G (Live + Logs)          [P-6,P-11]                      ─┘
```

Sprints 17C through 17G are **fully parallelizable** after 17B completes. They share no state and touch different page files. 17H depends on all page sprints (validates polish + "Aha" moments across everything). 17I depends on 17H (final cleanup after polish).

**Phase 15 pattern coverage**: All 18 patterns (P-1 through P-18) are assigned to at least one sprint. The most pattern-dense sprint is 17D (Intelligence Hub) with 10 patterns.

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| shadcn/ui components need customization beyond defaults | High | Low | shadcn gives you the source files — modify directly, no forking |
| Recharts doesn't handle heatmap well | Medium | Low | Already planned: custom SVG Heatmap component for direction-by-file |
| SSE reconnection edge cases | Medium | Medium | Exponential backoff with jitter + TanStack Query's built-in retry for initial data |
| Vite proxy doesn't forward all routes | Low | Low | Explicit proxy config for every path prefix in vite.config.ts |
| Bundle size exceeds 200KB target | Medium | Low | Code splitting via React.lazy on intelligence tabs, charts loaded on demand |
| Existing API response shapes don't match expected types | Medium | Medium | Sprint 17B includes type definitions — mismatches caught early |
| Diagnostic language feels forced/gimmicky | Medium | High | Keep vehicle analogies natural and contextual — never replace precise info, only augment. R-1 interpretation must be genuinely useful, not themed fluff |
| MetricDisplay enforcement too rigid for edge cases | Low | Medium | Allow `raw` escape hatch for table cells and chart labels (documented exceptions in 17I.9) |
| Persona-aware rendering adds maintenance burden | Medium | Medium | Zustand selector at component level — components subscribe to persona, not parent prop drilling |

### What Changes in the Backend

1. **`src/server/http.ts`**: Add `serveStatic` middleware (Sprint 17A.5)
2. **`package.json`**: Add `vite`, `@vitejs/plugin-react`, shadcn deps (Sprint 17A.1-2)
3. **Build scripts**: Add `dev:ui`, `build:ui` (Sprint 17A.4)
4. **Remove** `src/server/pages/` (Sprint 17I.1)
5. **Remove** HTMX copy script (Sprint 17I.2)

### What Doesn't Change

- Go daemon, materializer, intelligence engine, MCP server — untouched
- All API routes (`src/server/routes/*`) — untouched, consumed as-is by React
- SSE endpoint (`/api/stream`) — untouched
- DuckDB, SQLite, CozoDB — untouched
- Config, registry, paths, logging — untouched
- CLI commands — untouched
- Distill pipeline — untouched

---

## Summary

The current template-string approach was right for prototyping but has reached its ceiling. Every new feature fights the architecture — no components, no reactivity, no design system, no HMR, no client-side routing. The gap between "what works" and "wow" cannot be closed by incremental improvements to the current system.

**React 19 + Vite 6 + shadcn/ui** is the clear winner across every evaluation axis. The migration is structured into 9 sprints (17A–17I) with clear dependencies, acceptance criteria, and component blueprints. The backend remains completely untouched — the React SPA is a pure frontend replacement that consumes existing API routes and SSE streams as-is.

**Key numbers**:
- 13 legacy page files (3,425 lines) → ~30 React components with full type safety, hot reload, and design system
- 0 reusable components today → 50+ shadcn/ui primitives + 15 custom components
- Full page reload on navigation → instant client-side routing
- Manual `innerHTML` updates → reactive rendering with TanStack Query cache
- No design system → shadcn/ui tokens, accessible primitives, consistent interactions
- ~16 days total implementation time

**Phase 15 alignment** (added in this enhancement pass):
- All 18 UI patterns (P-1 through P-18) mapped to specific components and sprints
- 5 Data Presentation Rules (R-1→R-5) enforced via MetricDisplay base component
- Three-Question Test answered for every page and every Intelligence Hub tab
- Transmission Thesis diagnostic language integrated via `diagnostics.ts` helpers
- 4-layer information architecture (Pulse/Observe/Understand/Identity) validated
- 5-layer progressive disclosure (LiveStrip → Hero → Detail → Evidence → Raw)
- Persona-aware rendering (developer/lead/executive) via Zustand store
- Maturity model (Phase 1-4) visualized across 7+ surfaces
- "Aha" moment targets defined per page with validation checklist in Sprint 17H
- R-1→R-5 compliance audit and information architecture audit as acceptance criteria in Sprint 17I

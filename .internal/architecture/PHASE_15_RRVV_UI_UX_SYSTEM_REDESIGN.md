# Phase 15 — RRVV UI/UX System Redesign

> **Purpose:** Ground-up redesign of the Unfade web interface aligned with Phase 14 global-first storage architecture. This is not an incremental improvement — it fundamentally reimagines the UI into a premium, production-grade developer tool experience with proper project-level vs global views, an "active system reveal" post-onboarding experience, composable components, and real-time system visibility. Every UI surface is deeply explainable, traceable from raw capture event to rendered pixel, and aligned with real user needs across developers, engineers, and executive stakeholders.
>
> **Method:** RRVV (Rigorous Research → Reason → Validate → Execute).
>
> **Prerequisite:** Phase 14 (Global-First Storage Architecture) must be complete or in-progress. This document assumes `projectId` exists on all events, SQLite cache has `project_id`, and `~/.unfade/` is the primary storage location.
>
> **Status:** SPEC — **PRODUCTION-GRADE BLUEPRINT**
>
> **Last updated:** 2026-04-21

---

## Table of Contents

0. [Data Lineage Atlas](#0-data-lineage-atlas)
1. [Rigorous Research: Current UI Audit](#1-rigorous-research-current-ui-audit)
2. [Reason: Ground-Up Redesign as Value-Delivery System](#2-reason-ground-up-redesign-as-value-delivery-system)
3. [Validate: Against Product, Design & Data Integrity Expectations](#3-validate-against-product-design--data-integrity-expectations)
4. [Execute: UI Overhaul Plan](#4-execute-ui-overhaul-plan)
5. [Implementation Plan: Annotated Sprints 15A–15E](#5-implementation-plan-annotated-sprints-15a15e)
6. [Tests (T-400 → T-420)](#6-tests-t-400--t-420)
7. [Success Metrics](#7-success-metrics)
8. [Risk Assessment](#8-risk-assessment)
9. [Dependency Graph](#9-dependency-graph)
10. [Appendices](#appendices)

---

## 0. Data Lineage Atlas

> This section provides the complete traceability map from raw event capture to rendered UI pixel. Every UI surface in this document references this atlas. Understanding this flow is prerequisite to understanding the UI design.

### 0.1 End-to-End Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: CAPTURE (Go daemon — one per registered repo)                      │
│                                                                             │
│  Git Hooks ─────┐                                                           │
│  AI Sessions ───┤──→ CaptureEvent { id, projectId, type, source,           │
│  Terminal ───────┘     timestamp, content, gitContext, metadata }            │
│                         ↓                                                   │
│  Written to: ~/.unfade/events/<date>.jsonl (append-only, one line per event)│
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: MATERIALIZATION (TypeScript — single materializer loop)            │
│                                                                             │
│  Reads JSONL ──→ Parses events ──→ Inserts into SQLite                      │
│                                                                             │
│  SQLite tables populated:                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ events          — raw event rows (id, project_id, ts, source,      │    │
│  │                   type, content_summary, content_detail, metadata)  │    │
│  │ sessions        — grouped by session_id (start_ts, end_ts,         │    │
│  │                   turn_count, outcome, estimated_cost, domain)      │    │
│  │ decisions       — from distill pipeline (domain, description,      │    │
│  │                   rationale, hds, direction_class)                  │    │
│  │ decision_edges  — graph connections (from_id, to_id, relation)     │    │
│  │ metric_snapshots— daily aggregate scores (rdi, dcs, aq, cwi)       │    │
│  │ direction_windows — rolling time-window direction density           │    │
│  │ comprehension_proxy — per-event comprehension scores                │    │
│  │ comprehension_by_module — per-directory comprehension               │    │
│  │ direction_by_file — per-file direction density                      │    │
│  │ token_proxy_spend — estimated cost per model per day                │    │
│  │ event_insight_map — bidirectional event↔insight lineage             │    │
│  │ features        — inferred feature branches/groupings               │    │
│  │ event_features  — event-to-feature associations                     │    │
│  │ event_links     — cross-event relationships                         │    │
│  │ sessions        — AI session groupings                              │    │
│  │ events_fts      — FTS5 full-text search index                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                         ↓                                                   │
│  Session Materializer: groups events by metadata.session_id into sessions   │
│  table, computes turn_count, outcome, estimated_cost per session            │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: INTELLIGENCE (8 analyzers + summary writer)                        │
│                                                                             │
│  Intelligence Engine runs all analyzers after each materializer tick:        │
│                                                                             │
│  ┌──────────────────────┬─────────────────────┬────────────────────────┐    │
│  │ Analyzer             │ Output File          │ Key SQLite Queries     │    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ efficiency           │ efficiency.json      │ AVG(human_direction_   │    │
│  │                      │                     │ score), AVG(turn_count)│    │
│  │                      │                     │ AVG(prompt_specificity)│    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ comprehension-radar  │ comprehension.json   │ comprehension_by_      │    │
│  │                      │                     │ module, comprehension_ │    │
│  │                      │                     │ proxy scores           │    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ cost-attribution     │ costs.json           │ token_proxy_spend,     │    │
│  │                      │                     │ sessions.estimated_cost│    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ loop-detector        │ rejections.idx.json  │ events WHERE type=     │    │
│  │                      │                     │ 'ai-rejection'         │    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ velocity-tracker     │ velocity.json        │ sessions (turn_count,  │    │
│  │                      │                     │ outcome, domain)       │    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ prompt-patterns      │ prompt-patterns.json │ events.content_summary │    │
│  │                      │                     │ + direction scores     │    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ blind-spot-detector  │ alerts.json          │ comprehension_by_      │    │
│  │                      │                     │ module sustained trends│    │
│  ├──────────────────────┼─────────────────────┼────────────────────────┤    │
│  │ decision-replay      │ replays.json         │ decisions + recent     │    │
│  │                      │                     │ events for similarity  │    │
│  └──────────────────────┴─────────────────────┴────────────────────────┘    │
│                                                                             │
│  Summary Writer (runs every tick):                                          │
│  → Queries SQLite for rolling-window stats                                  │
│  → Writes ~/.unfade/state/summary.json atomically (tmp+rename, <4KB)        │
│  → Powers dashboard first-paint and SSE heartbeat                           │
│                                                                             │
│  Additional artifacts:                                                      │
│  → ~/.unfade/intelligence/decision-durability.json (correlates decisions    │
│    with subsequent git changes: held/revised/pending)                       │
│  → ~/.unfade/insights/recent.jsonl (narrative insights from analyzers)      │
│  → ~/.unfade/intelligence/narratives.jsonl (cross-session connections)      │
│  → ~/.unfade/intelligence/correlation.json (cross-project correlations)     │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: API (Hono HTTP server — 47+ routes)                                │
│                                                                             │
│  Dashboard heartbeat:                                                       │
│    GET /api/summary      → reads state/summary.json (ETag cached)           │
│    GET /api/stream (SSE) → polls summary.json mtime → pushes to clients     │
│                                                                             │
│  Intelligence endpoints (each reads from ~/.unfade/intelligence/):          │
│    GET /api/intelligence/efficiency      → efficiency.json                  │
│    GET /api/intelligence/comprehension   → comprehension.json               │
│    GET /api/intelligence/costs           → costs.json                       │
│    GET /api/intelligence/velocity        → velocity.json                    │
│    GET /api/intelligence/prompt-patterns → prompt-patterns.json             │
│    GET /api/intelligence/alerts          → alerts.json                      │
│    GET /api/intelligence/replays         → replays.json                     │
│    GET /api/intelligence/rejections      → rejections.idx.json              │
│    GET /api/intelligence/decision-durability → decision-durability.json     │
│    GET /api/intelligence/narratives      → narratives.jsonl                 │
│    GET /api/intelligence/correlations    → correlation.json                 │
│    GET /api/intelligence/actions         → logs/actions.jsonl               │
│    GET /api/intelligence/coach           → prompt-patterns.json (alias)     │
│    GET /api/intelligence/onboarding      → computed readiness percentages   │
│                                                                             │
│  System & operational:                                                      │
│    GET /api/system/health  → daemon/materializer/config/ingest aggregation  │
│    GET /api/repos          → ~/.unfade/state/registry.v1.json               │
│    GET /api/repos/:id      → single repo from registry                      │
│    GET /api/repos/:id/events → SQLite events WHERE project_id=?             │
│    GET /api/heatmap        → SQLite comprehension_by_module query           │
│    GET /api/insights/recent → ~/.unfade/insights/recent.jsonl               │
│    GET /api/decisions/:idx → decisions table + evidence resolution           │
│    GET /api/lineage/:id   → event_insight_map bidirectional lookup          │
│    GET /api/logs           → in-memory ring buffer                          │
│    GET /api/logs/stream    → SSE log tail                                   │
│    GET /api/integrations/status → IDE config file checks                    │
│                                                                             │
│  MCP/tools (respond with ToolResponse envelope):                            │
│    GET /unfade/context     → recent context for AI injection                │
│    GET /unfade/query       → event search                                   │
│    GET /unfade/decisions   → decision list                                  │
│    GET /unfade/profile     → reasoning_model.json (v2)                      │
│    GET /unfade/distill/:date → distill markdown for date                    │
│    GET /unfade/similar     → semantic decision search                       │
│    GET /unfade/amplify     → cross-temporal connections                     │
│                                                                             │
│  Mutations:                                                                 │
│    POST /unfade/distill    → trigger distillation                           │
│    POST /unfade/cards/generate → generate identity card PNG                 │
│    POST /api/actions/apply-rule → write coach rule to CLAUDE.md             │
│    POST /api/integrations/install → write MCP config to IDE files           │
│    POST /api/setup/complete → mark onboarding done                          │
│    POST /settings/llm      → update LLM config                             │
│    POST /settings/actions   → update proactive actions config               │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 5: UI (Server-rendered HTML + htmx + SSE)                             │
│                                                                             │
│  Layout shell → page function → component functions → HTML string           │
│  SSE EventSource → DOM updates (metrics, events, health)                    │
│  htmx → partial swaps (tabs, drawers, search)                              │
│  localStorage → theme, sidebar state, project context, dismiss states       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 0.2 SummaryJson Shape (Dashboard Heartbeat)

Written by `src/services/intelligence/summary-writer.ts` on every materializer tick:

```typescript
interface SummaryJson {
  schemaVersion: 1;
  updatedAt: string;                    // ISO timestamp of last write
  freshnessMs: number;                  // ms since last materializer tick
  directionDensity24h: number;          // AVG(human_direction_score) last 24h
  eventCount24h: number;                // COUNT(*) from events in last 24h
  comprehensionScore: number | null;    // from comprehension.json overall
  topDomain: string | null;             // SQLite GROUP BY domain, MAX count
  toolMix: Record<string, number>;      // { git: 45, 'ai-session': 30, terminal: 25 }
  reasoningVelocityProxy: number | null; // from velocity.json overallMagnitude
  firstRunComplete: boolean;            // enough data for meaningful metrics
  costPerDirectedDecision?: number | null; // total_cost / high_direction_sessions
  costQualityTrend?: 'improving' | 'stable' | 'declining' | null;
  todaySpendProxy?: number;             // extrapolated daily AI spend
  todayDirectedDecisions?: number;      // count of hds >= 0.5 events today
}
```

### 0.3 Analyzer Output Shapes

Each analyzer writes JSON atomically to `~/.unfade/intelligence/<outputFile>`:

| Analyzer | Output File | Key Fields |
|----------|-------------|------------|
| efficiency | `efficiency.json` | `{ aes, confidence, subMetrics: { directionDensity, tokenEfficiency, iterationRatio, contextLeverage, modificationDepth }, trend, history[], topInsight }` |
| comprehension-radar | `comprehension.json` | `{ overall, confidence, byModule: { [module]: { score, sessions, trend } }, blindSpots[], blindSpotAlerts[] }` |
| cost-attribution | `costs.json` | `{ totalEstimatedCost, byModel, byDomain, byBranch, byFeature, abandonedWaste, wasteRatio, contextOverhead, projectedMonthlyCost, costPerDirectedDecision }` |
| loop-detector | `rejections.idx.json` | `{ rejections[], loopPatterns[], hotSpots[] }` |
| velocity-tracker | `velocity.json` | `{ byDomain: { [domain]: { turnsToAcceptance, sessionsCount, avgDuration } }, overallTrend, overallMagnitude, dataPoints }` |
| prompt-patterns | `prompt-patterns.json` | `{ effectivePatterns[], antiPatterns[], totalPromptsAnalyzed }` |
| blind-spot-detector | `alerts.json` | `{ alerts[]: { type, title, severity, sustainedWeeks, data }, maxPerWeek }` |
| decision-replay | `replays.json` | `{ replays[]: { originalDecisionId, triggerEvent, similarity, analysis, suggestedAction, confidence } }` |

### 0.4 SQLite Schema Reference

All tables in `~/.unfade/cache/unfade.db` (created by `src/services/cache/manager.ts`):

| Table | Purpose | Key Columns | Indexes |
|-------|---------|-------------|---------|
| `events` | Raw event storage | `id PK, project_id, ts, source, type, content_summary, content_detail, git_repo, git_branch, metadata JSON` | project_id, (project_id, ts), ts, source |
| `sessions` | AI session groupings | `id PK, project_id, start_ts, end_ts, event_count, turn_count, outcome, estimated_cost, domain, branch, feature_id` | project_id |
| `decisions` | Extracted decisions | `id PK, project_id, date, domain, description, rationale, alternatives_count, hds, direction_class` | project_id, (project_id, date), domain, date |
| `decision_edges` | Decision graph | `from_id, to_id, relation, weight, match_type` | — |
| `metric_snapshots` | Daily aggregate scores | `date, project_id, rdi, dcs, aq, cwi, api_score, decisions_count, labels JSON` | project_id |
| `direction_windows` | Rolling direction density | `window_size, window_end, project_id, direction_density, event_count, tool_mix JSON` | — |
| `comprehension_proxy` | Per-event comprehension | `event_id PK, project_id, mod_depth, specificity, rejection, score` | project_id |
| `comprehension_by_module` | Per-directory comprehension | `module + project_id PK, score, event_count, updated_at` | — |
| `direction_by_file` | Per-file direction density | `path + project_id PK, direction_density, event_count` | — |
| `token_proxy_spend` | Estimated cost tracking | `date + model + project_id PK, count, estimated_cost` | — |
| `event_insight_map` | Event↔insight lineage | `event_id + insight_id PK, analyzer, contribution_weight, computed_at` | insight_id |
| `features` | Inferred feature groupings | `id PK, project_id, name, branch, first_seen, last_seen, event_count, status` | project_id, branch, status |
| `events_fts` | Full-text search (FTS5) | `content_summary, content_detail` | Virtual table |

---

## 1. Rigorous Research: Current UI Audit

### 1.1 Information Architecture Audit

**Current navigation structure** (from `layout.ts`):

```
NAV_PRIMARY:   Home, Live, Intelligence, Cost, Comprehension, Coach, Alerts
NAV_SECONDARY: Distill, Profile, Cards, Portfolio, Search, Velocity, Integrations, Logs
FOOTER:        Settings, Theme, Collapse
```

**Surface area:** 21 page files, 23 route files, ~4000 lines of inline HTML/JS.

| Finding | Severity | Detail |
|---------|----------|--------|
| **No project dimension in data views** | CRITICAL | Every page renders data from a single project's `.unfade/` directory. No project switcher, no global aggregation, no filter parameter on any API endpoint. Portfolio page is the only multi-project view but it's a separate page, not an integrated dimension |
| **Navigation overload** | HIGH | 15 nav items (7 primary + 8 secondary) is too many for a tool that should have a 10-second wow. User must decide where to go before understanding what's available |
| **Duplicate surface area** | MEDIUM | Intelligence + Comprehension + Velocity + Coach + Alerts all render intelligence data from separate JSON files. Could be unified into a single intelligence hub with tabs/sections |
| **Portfolio disconnected** | HIGH | Portfolio exists as a secondary nav item but should be the default entry point for multi-project users (Phase 14's target state). Currently, clicking a repo card navigates to `/repos/:id` which is a separate dashboard — no way to return to the same page with project filter applied |
| **Settings + Integrations + Logs are operational, not intelligence** | LOW | These belong in a separate "System" group, not mixed with intelligence surfaces |
| **Data present but not meaningful** | HIGH | Several pages display raw numbers without contextualizing them. A direction density of 0.73 means nothing without "You steer confidently" or comparison to team/historical averages. Intelligence data exists but lacks the interpretation layer that turns metrics into insights |
| **No cross-page data consistency** | MEDIUM | Each page independently fetches and renders data. The same metric (e.g., AES) can appear with different freshness on Home vs Intelligence page because they're fetched at different times |

### 1.2 Component Architecture Audit

| Finding | Severity | Detail |
|---------|----------|--------|
| **No component system** | HIGH | Every page is a standalone function returning an HTML string. Cards, badges, metric displays are copy-pasted between pages — no shared rendering functions. Phase 7 spec defines a component library (§4.5) with `HeroMetricCard`, `KPICard`, `ConfidenceBar`, etc. but these are implemented as inline HTML in each page, not as reusable functions |
| **Inline JS per page** | MEDIUM | Each page embeds its own `<script>` block. Home has a 140-line state machine. Live has an SSE subscriber. Intelligence has gauge animation. No shared JS utilities. SSE connection is established independently per page |
| **No component testing** | MEDIUM | Components are HTML strings — cannot be unit-tested in isolation. Page tests verify the full HTML output contains expected substrings |
| **No data-to-component contract** | HIGH | Components don't document what data they expect or where it comes from. A KPI card showing "Events: 142" doesn't declare that this value originates from `summary.json.eventCount24h` which is computed by `SELECT COUNT(*) FROM events WHERE ts > ?` |

### 1.3 State Management Audit

| Finding | Severity | Detail |
|---------|----------|--------|
| **SSE polling, not event-driven** | MEDIUM | `stream.ts` polls `summary.json` mtime every 2s via `statSync()`. Sends 3 event types: summary, intelligence, health. Not reactive to actual event writes |
| **No shared client state** | HIGH | Each page independently fetches its data. Navigating Home → Intelligence → Home re-fetches everything. No client-side cache, no shared SSE subscription across pages |
| **Server-rendered only** | INFO | Full page reload on navigation (htmx partial loads for some interactions). This is fine for the stack choice but means every navigation re-renders the entire layout + page |
| **Home state machine** | MEDIUM | 5-state machine (loading → setup-required → ingesting → calibrating → live/stale) implemented in 140 lines of inline JS. Determines state from summary data. Transitions are abrupt — no progressive reveal |
| **`localStorage` for preferences** | OK | Theme, sidebar state, alert dismissals persisted client-side. Appropriate for user prefs |

### 1.4 Data Flow Audit

**Current data pipeline (per-project):**

```
Go daemon → <repo>/.unfade/events/*.jsonl
              ↓ (materializer reads)
        state/summary.json ← intelligence/*.json
              ↓ (SSE polls mtime)
        /api/stream → browser EventSource
              ↓
        Page JS updates DOM
```

**Phase 14 target data pipeline (global):**

```
Go daemon → ~/.unfade/events/*.jsonl (with projectId)
              ↓ (single materializer reads)
        ~/.unfade/state/summary.json ← intelligence/*.json
              ↓ (SSE polls or event-driven)
        /api/stream → browser EventSource
              ↓
        Page JS updates DOM (with project filter context)
```

**API routes requiring `projectId` support:**

| Route | Current Data Source | Phase 15 Change |
|-------|-------------------|-----------------|
| `GET /api/summary` | Reads one `summary.json` | `?projectId=` filter or global aggregate |
| `GET /api/intelligence/*` (14 endpoints) | Reads from `<project>/.unfade/intelligence/` | Read from `~/.unfade/intelligence/` with project scope |
| `GET /api/heatmap` | Project-local SQLite `comprehension_by_module` | `WHERE project_id = ?` when `?projectId=` provided |
| `GET /api/repos` | Lists registry, reads each repo's summary | Already multi-project — keep as-is |
| `GET /api/repos/:id/events` | Reads from `<repo>/.unfade/events/` | Read from `~/.unfade/events/` filtered by projectId |
| `GET /api/stream` (SSE) | Polls one `summary.json` | Event-driven from materializer EventEmitter, include `projectId` in payloads |
| `GET /api/system/health` | Aggregates repo manager status | Already global — keep as-is |
| `GET /api/insights/recent` | Reads project-local `insights/recent.jsonl` | Read from `~/.unfade/insights/` |
| `GET /api/decisions/:idx` | Reads project-local `graph/decisions.jsonl` | Query SQLite `decisions` table with optional `WHERE project_id = ?` |
| `GET /unfade/profile` | Reads project-local `reasoning_model.json` | Read from `~/.unfade/profile/` (global profile) |

### 1.5 Visual Design Audit

| Finding | Status | Detail |
|---------|--------|--------|
| **Design tokens** | GOOD | CSS custom properties for colors, typography (Space Grotesk / Inter / JetBrains Mono), dark/light themes. Comprehensive and consistent |
| **Tailwind via CDN** | CONCERN | `<script src="cdn.tailwindcss.com">` on every page. Adds ~300ms parse time. No tree-shaking, no custom utilities compiled. Acceptable for pre-launch, should compile for production |
| **Responsive design** | GOOD | Sidebar collapses at 1024px, hamburger at 768px. Content max-width 1200px. Evidence drawer overlays on small screens |
| **Brand assets** | GOOD | SVG icon/wordmark, favicon, PWA manifest icons all present in `public/` |
| **Empty states** | PARTIAL | Some pages have empty states (Coach, Intelligence) but implementation is inconsistent. No shared `EmptyState` component function |
| **Loading states** | WEAK | Home has animated loading state. Other pages show nothing while data loads — no skeleton screens, no progressive rendering |
| **Estimate badges** | GOOD | USD values wrapped in `EstimateBadge` on Cost page. Consistent pattern |
| **Data freshness** | PARTIAL | Home shows freshness. Other pages don't consistently show when data was last updated |

### 1.6 Performance Audit

| Finding | Impact | Detail |
|---------|--------|--------|
| **Full HTML on every navigation** | MEDIUM | Each page returns complete HTML including layout, CSS vars, Tailwind config, font imports. ~15-20KB per page load. htmx could do partial swaps but currently only used for drawer + search |
| **SSE reconnection** | LOW | EventSource auto-reconnects. No exponential backoff — rapid reconnection attempts on disconnect |
| **No response caching** | LOW | Summary endpoint has ETag support. Other endpoints don't cache. Intelligence JSON files are small (<10KB each) |
| **Inline SVG charts** | OK | Gauges and sparklines are inline SVG strings — no chart library overhead. Correct choice for this scale |

### 1.7 Value-Delivery Gap Analysis

| UI Surface | Data Present | Value Delivered | Gap |
|------------|-------------|-----------------|-----|
| Home hero metric | Direction density number | "How effective is my AI usage?" | Missing: human-readable interpretation, comparison baseline, actionable suggestion |
| KPI strip | 4 raw numbers | Peripheral awareness | Missing: what's normal, what requires attention, delta context |
| AES gauge | Score 0-100 | Composite quality indicator | Missing: which sub-metric to improve, what behavioral change would help |
| Comprehension heatmap | Per-module scores | Where understanding is strong/weak | Missing: business risk framing, team-level aggregation |
| Cost numbers | Estimated spend | Spend tracking | Missing: ROI context (cost per outcome), budget comparison, waste breakdown |
| Decision timeline | Chronological list | Historical decisions | Missing: durability status, impact assessment, pattern recognition |
| Coach patterns | Pattern list | Behavioral patterns | Missing: prioritization (which pattern to fix first), estimated impact |
| Profile | Pattern descriptions | Self-knowledge | Missing: growth trajectory, peer comparison framework, career narrative |

---

## 2. Reason: Ground-Up Redesign as Value-Delivery System

### 2.1 Core Mental Model Shift

**Phase 7 model:** "Unfade is your local reasoning observatory for *this project*."

**Phase 15 model:** "Unfade is your **global reasoning layer** across all projects — with project-level drill-down as a first-class dimension. Every screen answers a specific question, enables a specific action, and scales from developer to executive."

The UI must answer these questions in this order:
1. **Is Unfade alive and working?** (System pulse — answered in <2 seconds)
2. **What's happening across all my projects?** (Global overview — answered in <10 seconds)
3. **What's happening in *this* project?** (Project drill-down — one click)
4. **What should I do differently?** (Actionable intelligence — always accessible)
5. **Who am I as a developer?** (Identity — emerges over time)

### 2.2 Value-Delivery Design Principles

Every UI element must pass the **Three-Question Test**:
1. **What user question does this answer?** — If it doesn't answer a question, remove it.
2. **What action does this enable?** — If it doesn't enable action, it's decoration.
3. **Does the answer scale across personas?** — A developer sees tactical detail; an executive sees strategic summary. Same data, different framing.

**Persona-Aware Design:**

| Persona | Primary Questions | Time Budget | Depth Preference |
|---------|------------------|-------------|------------------|
| **Developer** | "How am I doing today? Where should I focus? What patterns work?" | 30-60s daily check | Deep — wants sub-metrics, evidence, raw events |
| **Engineer/Tech Lead** | "Is the team using AI effectively? Where are the capability gaps?" | 5-10 min weekly review | Medium — wants trends, comparisons, blind spots |
| **Executive/CTO/CFO** | "What's the ROI on AI tools? Is the investment paying off?" | 2-3 min monthly check | High-level — wants costs, trends, and one-number summaries |

### 2.3 Information Architecture Redesign

**From 15 flat nav items to 4 conceptual layers:**

```
LAYER 1: PULSE (always visible)
  - Live Strip (system health, last event, connection status)
  - Project Selector (dropdown in live strip, persisted)

LAYER 2: OBSERVE (primary navigation — what's happening)
  - Home (global dashboard OR project dashboard based on selector)
  - Live (real-time event stream, filterable by project)
  - Distill (daily summaries, scoped to project)

LAYER 3: UNDERSTAND (intelligence surfaces)
  - Intelligence Hub (AES + sub-metrics + comprehension + velocity — unified)
  - Decisions (graph browser + search — replaces Search page)
  - Coach (patterns + anti-patterns + alerts — merged)

LAYER 4: IDENTITY (long-term)
  - Profile (reasoning model, cross-project)
  - Cards (generated identity cards)

SYSTEM (collapsed group)
  - Settings, Integrations, Logs
```

**Navigation reduction:** 15 items → 9 items + 1 collapsed group. Every removed item is merged, not deleted:

| Removed | Merged Into | Rationale |
|---------|-------------|-----------|
| Portfolio | Home (when project selector = "All Projects") | Portfolio IS the global home — no separate page needed |
| Repo Detail | Home (when project selector = specific project) | One page, two modes — less navigation, same data |
| Comprehension | Intelligence Hub (Comprehension tab) | Intelligence data shouldn't be fragmented across 5 pages |
| Velocity | Intelligence Hub (Velocity tab) | Same — consolidation reduces cognitive load |
| Cost | Intelligence Hub (Cost tab) | Same — users shouldn't hunt for cost data |
| Alerts | Intelligence Hub (Patterns & Coach tab) | Alerts are intelligence about patterns — they belong together |
| Search | Decisions (integrated search bar) | Search is an action on decisions, not a separate destination |

### 2.4 The "Active System Reveal" Experience

**Problem:** Current UI has a binary transition: onboarding → live. Users don't understand what Unfade is *doing* — they see numbers appear but don't know the system's internal processes.

**Solution: Progressive System Reveal (5 phases)**

```
Phase A: CONNECTING (0-5 seconds after first open)
  "Unfade is starting up..."
  → Shows: capture engine initializing, materializer connecting, SSE establishing
  → Reveals each subsystem as it comes online (green dots appearing one by one)
  → USER QUESTION ANSWERED: "Is the system working?"
  → ACTION ENABLED: Wait or troubleshoot if a subsystem fails

Phase B: CAPTURING (first 5 minutes)
  "Unfade is watching your work..."
  → Shows: real-time event counter with source attribution
  → Mini live feed of events being captured (3-4 visible)
  → "13 events from git, 2 from Claude Code, 1 from terminal"
  → USER QUESTION ANSWERED: "Is it capturing my work?"
  → ACTION ENABLED: Verify capture sources, fix missing integrations

Phase C: MATERIALIZING (after first materializer tick, ~30 seconds)
  "Unfade is building your reasoning model..."
  → Shows: materializer progress (events processed, decisions extracted)
  → First metrics appear with gentle fade-in animations
  → Direction density number materializes, then comprehension, then AES
  → USER QUESTION ANSWERED: "What does my work look like as data?"
  → ACTION ENABLED: See first metrics, start understanding the framework

Phase D: INTELLIGENCE WARMING (after intelligence engine runs, ~2 minutes)
  "Unfade is analyzing your patterns..."
  → Intelligence cards populate one by one
  → Coach patterns appear
  → "First insight: You iterate 2.3x faster on auth code than on payments"
  → USER QUESTION ANSWERED: "What has Unfade learned about me?"
  → ACTION ENABLED: First actionable insight, explore intelligence tabs

Phase E: LIVE (steady state)
  Full dashboard. All metrics live-updating.
  System reveal strip collapses to the permanent Live Strip.
  "Active since 2m ago · 47 events captured · AES: 64"
  → USER QUESTION ANSWERED: All questions — full tool access
  → ACTION ENABLED: All actions — explore, configure, share
```

This replaces the current abrupt 5-state machine with a narrative experience that builds trust and understanding.

### 2.5 Project Selector Design

**The project selector is THE key Phase 14 UI addition.** It appears in the Live Strip and controls all data views.

```
┌─────────────────────────────────────────────────────────────────┐
│ ● Live  │  [▼ All Projects]  │  Last: 4s ago  │  Events: 142  │
└─────────────────────────────────────────────────────────────────┘
                    ↓ (click)
┌──────────────────────────┐
│  ✓ All Projects          │  ← Global view (default)
│    unfade-cli             │  ← Per-project drill-down
│    unerr-cli              │
│    my-saas-app            │
│  ─────────────────────── │
│  + Register project       │  ← Opens setup flow
└──────────────────────────┘
```

**Behavior:**
- Default: "All Projects" — Home shows portfolio grid, Intelligence shows aggregate metrics, Distill shows combined timeline
- Select a project: Home shows project dashboard, Intelligence shows project-scoped metrics, Distill shows project distills
- Persisted in `localStorage` — remembered across sessions
- URL parameter `?project=<id>` for shareable links
- API routes receive `projectId` query parameter from all data-fetching code

**Value by persona:**
- **Developer:** Switch context instantly between repos without restarting or opening new tabs
- **Engineer/Tech Lead:** Compare projects side-by-side by switching the selector
- **Executive:** "All Projects" IS the executive view — portfolio-level at a glance

### 2.6 Unified Intelligence Hub

**Problem:** 5 separate pages (Intelligence, Cost, Comprehension, Velocity, Coach) fragment the intelligence story.

**Solution:** Single Intelligence Hub page with horizontal tab navigation:

```
[Overview] [Comprehension] [Velocity] [Cost] [Patterns & Coach]
```

| Tab | Content | Data Source | User Question Answered |
|-----|---------|------------|----------------------|
| **Overview** | AES gauge + 5 sub-metrics + trend chart + top insight | efficiency.json | "How well am I using AI?" |
| **Comprehension** | Heatmap + table toggle + blind spots | comprehension.json + heatmap API | "Where do I truly understand my code?" |
| **Velocity** | Overall trend + per-domain sparklines + decision durability | velocity.json + decision-durability.json | "Am I getting faster and are my decisions sticking?" |
| **Cost** | Hero spend + by-model + by-domain bars + waste | costs.json | "Where is my AI budget going?" |
| **Patterns & Coach** | Effective + anti-patterns + alerts + replays | prompt-patterns.json + alerts.json + replays.json | "What habits should I keep, change, or watch?" |

**Each tab is an htmx partial** — clicking a tab swaps only the content area, preserving the page header, project context, and SSE connection. URL updates to `/intelligence?tab=cost` for bookmarkability.

### 2.7 Composable Component System

**Problem:** Components are copy-pasted HTML strings across 21 page files.

**Solution:** Shared component functions in `src/server/components/`:

```
src/server/components/
├── metric-card.ts        # heroMetricCard, kpiCard, kpiStrip
├── badges.ts             # dataFreshnessBadge, estimateBadge, confidenceBadge, sourceBadge, projectBadge
├── charts.ts             # gaugeSvg, sparklineSvg, barChartSvg, heatmapCell, trendArrow
├── empty-state.ts        # emptyState (with illustration + CTA)
├── evidence-drawer.ts    # drawerContent, drawerEventRow
├── project-selector.ts   # projectSelector, projectCard
├── data-table.ts         # dataTable, sortableHeader
├── system-reveal.ts      # systemRevealOverlay, revealPhase
├── live-strip.ts         # liveStrip (extracted from layout)
├── tabs.ts               # tabBar, tabPanel
├── nav.ts                # sidebarNav, navItem, navGroup
└── index.ts              # Re-exports all components
```

Each component is a pure function: `(props) => string`. No framework, no classes. Composable via string concatenation (same as current pattern, just organized).

**Component Data Contract:**
Every component documents its props, the data source for each prop, and the SQLite query that ultimately produces the value. This contract is enforced in this spec — see Section 5 for per-component specifications.

### 2.8 Real-Time Data Pipeline Upgrade

**Current:** SSE polls `summary.json` mtime every 2s.

**Target:** Event-driven SSE from materializer.

```
Materializer tick
  → emits 'tick' event on in-process EventEmitter
    → SSE handler receives, reads fresh data, pushes to clients

Event capture (daemon writes to events/)
  → fs.watch() on ~/.unfade/events/ directory
    → SSE handler pushes raw event preview to Live page clients
```

**Implementation:**
1. `src/server/sse-hub.ts` — singleton EventEmitter, handles client connections
2. Materializer emits `tick` event after each cycle
3. SSE handler subscribes to hub, not file polling
4. Remove mtime polling entirely — event-driven is the only mode

### 2.9 Client-Side Architecture

**Problem:** Each page has its own `<script>` block, no shared code.

**Solution:** Single shared client module inlined in layout:

```typescript
// Inlined in layout.ts <script> block
window.__unfade = {
  // SSE singleton — one connection shared across all pages
  sse: null,
  onSummary: [],    // callbacks registered by page scripts
  onEvent: [],
  onHealth: [],
  
  // Project context
  projectId: localStorage.getItem('unfade-project') || 'all',
  
  // API helper with project filter
  async fetch(path) {
    const sep = path.includes('?') ? '&' : '?';
    const url = this.projectId === 'all' ? path : `${path}${sep}projectId=${this.projectId}`;
    return fetch(url);
  },

  // Initialize SSE (called once by layout)
  initSSE() {
    if (this.sse) return;
    this.sse = new EventSource('/api/stream');
    this.sse.addEventListener('summary', (e) => {
      const data = JSON.parse(e.data);
      this.onSummary.forEach(cb => cb(data));
    });
    // ... other event types
  }
};
```

Pages register callbacks instead of creating their own SSE connections:
```javascript
// In intelligence.ts inline script
window.__unfade.onSummary.push((data) => {
  document.getElementById('aes-value').textContent = data.aes ?? '--';
});
```

---

## 3. Validate: Against Product, Design & Data Integrity Expectations

### 3.1 Product Validation

| Requirement | Phase 7 | Phase 15 | How |
|-------------|---------|----------|-----|
| **10-second wow** | Hero metric OR onboarding | Active System Reveal — system comes alive visually in front of user | Progressive subsystem activation with narrative text |
| **Project-level views** | Not supported (Portfolio is separate page) | Project Selector in Live Strip controls all views | `?projectId=` on all API calls, client-side filter context |
| **Global views** | Not supported | "All Projects" default shows aggregated data | Global SQLite queries, aggregated intelligence |
| **Cross-project insights** | Impossible | "You use similar caching patterns in unfade-cli and my-saas-app" | Amplifier reads global decisions.jsonl |
| **Premium developer tool feel** | Linear-inspired sidebar | Linear-inspired sidebar + project selector + system reveal + unified intelligence | Same design tokens, new component system |
| **One-screen answers 80%** | Partially — 5 separate intelligence pages | Intelligence Hub answers 80% in one tab set | Unified page with htmx tab switching |

### 3.2 Data Integrity Validation

| Requirement | Satisfied | Detail |
|-------------|-----------|--------|
| **Every UI element has defined data lineage** | Yes | Section 0 (Data Lineage Atlas) maps every data path from capture to pixel. Section 5 documents per-component data contracts |
| **Users understand what they see** | Yes | Every metric includes human-readable interpretation, confidence badge, and freshness indicator. System Reveal teaches the framework |
| **Data scales across roles** | Yes | Persona-specific framing in Section 5 — same data, different interpretation layer per persona |
| **Consistent data fetching** | Yes | `window.__unfade.fetch()` auto-injects `projectId`. All intelligence endpoints use `readIntelligenceFile()` pattern. SSE singleton shares state |
| **Cohesive enterprise-grade feel** | Yes | Component library ensures visual consistency. Design tokens enforce brand. Empty states and loading states are handled uniformly |

### 3.3 Engineering Validation

| Constraint | Satisfied | Detail |
|------------|-----------|--------|
| **Hono + server HTML** | Yes | No framework change. Components are still pure string functions |
| **htmx interactions** | Yes | Tab switching, drawer, search all via htmx partials |
| **stdout is sacred** | Yes | No change to logging convention |
| **No SPA** | Yes | Server-rendered pages with htmx enhancement. Shared client JS is minimal (SSE + project context) |
| **Clean-slate build** | Yes | Each sprint builds fresh components from scratch. No legacy code preserved — old pages are deleted, not refactored |
| **Test strategy** | Yes | Component functions can be unit-tested. Page tests verify composition. Integration tests verify API + rendering |

### 3.4 Phase 14 Alignment Validation

| Phase 14 Change | UI Impact | Phase 15 Response |
|-----------------|-----------|-------------------|
| Events move to `~/.unfade/events/` | All event-reading routes change paths | Routes use `getGlobalEventsDir()` — path change is transparent to UI |
| `projectId` on all events | API routes need filter parameter | Client sends `?projectId=` from project selector context |
| Single daemon, single materializer | System health shows one daemon, not N | Health strip simplifies — one engine status, multiple project counts |
| Global profile | Profile page shows unified view | Profile page unchanged — reads from `~/.unfade/profile/` |
| Global decisions graph | Decisions page can search across projects | Decisions page + project selector = scoped or global search |
| SQLite cache with `project_id` | Intelligence queries can filter | API routes add `WHERE project_id = ?` when `projectId` provided |
| `.unfade` marker file per repo | UI setup flow changes | Setup page: "Register this project" instead of "Initialize .unfade/" |

### 3.5 Pitfalls & Guards

| Pitfall | Guard |
|---------|-------|
| **Project selector adds complexity to every page** | Project context is set once in `window.__unfade.projectId`; all API calls go through `window.__unfade.fetch()` which injects the parameter automatically |
| **Intelligence Hub becomes dashboard soup** | Strict tab separation. Each tab has max 1 hero + 4 KPIs. Details in evidence drawer, not inline |
| **System Reveal feels slow** | Each phase auto-advances when subsystem is ready. User can skip directly to dashboard at any time ("Skip to dashboard" link) |
| **Component library is scope creep** | Components are written incrementally — start with highest-reuse (metric cards, badges), not all-at-once |
| **htmx tab switching causes flash** | Use `hx-indicator` spinner. Pre-render first tab server-side. Cache other tabs client-side after first load |
| **Data without interpretation is noise** | Every metric includes: raw value, human-readable label, confidence badge, comparison context, and an action hint where applicable |

---

## 4. Execute: UI Overhaul Plan

### 4.1 Updated Navigation Structure

```
┌─────────────────────────┐
│  [icon.svg 28×28]       │
│  unfade                 │
├─────────────────────────┤
│  ── Observe ──          │
│  Home                   │   /
│  Live                   │   /live
│  Distill                │   /distill
├─────────────────────────┤
│  ── Understand ──       │
│  Intelligence           │   /intelligence
│  Decisions              │   /decisions
│  Coach                  │   /coach
├─────────────────────────┤
│  ── Identity ──         │
│  Profile                │   /profile
│  Cards                  │   /cards
├─────────────────────────┤
│  ── System ──           │   (collapsed by default)
│  Settings               │   /settings
│  Integrations           │   /integrations
│  Logs                   │   /logs
├─────────────────────────┤
│  Theme toggle           │
│  Collapse               │
└─────────────────────────┘
```

### 4.2 Updated Design Tokens

Additions to existing Phase 7 tokens:

| Token | Dark | Light | Purpose |
|-------|------|-------|---------|
| `--project-indicator` | `#6366F1` | `#4F46E5` | Project selector accent |
| `--reveal-bg` | `rgba(10,10,15,0.95)` | `rgba(248,249,250,0.95)` | System reveal overlay |
| `--reveal-pulse` | `rgba(139,92,246,0.3)` | `rgba(109,40,217,0.2)` | Subsystem activation pulse |
| `--tab-active` | `var(--accent)` | `var(--accent)` | Active tab indicator |
| `--tab-inactive` | `var(--muted)` | `var(--muted)` | Inactive tab text |

### 4.3 Updated Live Strip (with Project Selector)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ●  Live  │  [▼ All Projects ▾]  │  Last: 4s ago  │  Events (1h): 23  │
└─────────────────────────────────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| Height | **36 px** (unchanged) |
| Project Selector | Dropdown, 180px width, bg-raised, rounded-md, border. Chevron icon right. Current selection in Inter 12px medium |
| Project Dropdown | Max-height 240px, scrollable. Each item: 32px height, repo icon + label. Checkmark on active. "All Projects" always first with globe icon |
| Keyboard | `Ctrl+Shift+P` opens project selector |

### 4.4 Page Specifications

---

#### PAGE: Home (`/`) — Global-First with Dual-Mode

**When Project Selector = "All Projects":**

```
[LIVE STRIP with project selector]
┌──────────────────────────────────────────────────────────────┐
│  GLOBAL KPI STRIP (4 cards, grid-cols-4)                      │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                │
│  │Projects│ │Events  │ │AES     │ │Cost    │                │
│  │Active  │ │24h     │ │(global)│ │(est.)  │                │
│  │  3     │ │  342   │ │  64    │ │ $12.40 │                │
│  └────────┘ └────────┘ └────────┘ └────────┘                │
├──────────────────────────────────────────────────────────────┤
│  PROJECT CARDS  (grid-cols-3, gap-6)                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ unfade-cli    │ │ unerr-cli    │ │ my-saas-app  │         │
│  │ AES: 71  ●   │ │ AES: 58  ●   │ │ AES: --  ◐   │         │
│  │ 142 events   │ │ 89 events    │ │ 12 events    │         │
│  │ 3m ago       │ │ 15m ago      │ │ 2h ago       │         │
│  │ [Open →]     │ │ [Open →]     │ │ [Open →]     │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
├──────────────────────────────────────────────────────────────┤
│  GLOBAL INSIGHT STREAM (last 5 cross-project insights)        │
│  3m ago: "unfade-cli: auth module comprehension dropped 12%"  │
│  8m ago: "unerr-cli: similar caching pattern to unfade-cli"   │
└──────────────────────────────────────────────────────────────┘
```

**When Project Selector = specific project:**

```
[LIVE STRIP with project selector showing "unfade-cli"]
┌──────────────────────────────────────────────────────────────┐
│  HERO CARD  (Direction Density: 73%)                          │
│  "You steer confidently"                                      │
│  ↑ 8% vs last week · DataFreshnessBadge: "live · 4s ago"    │
├──────────────────────────────────────────────────────────────┤
│  KPI STRIP  (Events 24h · Comprehension · Top Domain · Cost) │
├──────────────────────────────────────────────────────────────┤
│  TWO-COLUMN: Insight Stream + Quick Actions                   │
└──────────────────────────────────────────────────────────────┘
```

**Clicking a project card in "All Projects" view sets the Project Selector to that project.** No separate `/repos/:id` route needed.

---

#### PAGE: Intelligence Hub (`/intelligence`) — Unified

**Tab navigation:**
```
[Overview] [Comprehension] [Velocity] [Cost] [Patterns & Coach]
```

Each tab is an htmx partial: `GET /intelligence/tab/:name` returns HTML fragment.

**Overview tab** (default):
- AES gauge (200px SVG ring) + 5 sub-metric cards + trend chart
- Project-scoped when selector is set, global aggregate when "All Projects"
- "Compared to your other projects: unfade-cli has 12% higher direction density than average"

**Comprehension tab:**
- Heatmap grid + table toggle
- Blind spot cards (max 3)
- When global: shows cross-project heatmap with project color coding

**Velocity tab:**
- Overall trend + per-domain sparklines
- Decision durability metrics

**Cost tab:**
- Hero spend + by-model + by-domain bars + waste
- EstimateBadge on all USD

**Patterns & Coach tab:**
- Effective patterns + anti-patterns (merged from Coach page)
- Active alerts + decision replays (merged from Alerts page)
- "Copy as CLAUDE.md rule" button included
- Alert badge count shown on tab header

---

#### PAGE: Decisions (`/decisions`) — New (replaces Search)

**Unified decision browser + search:**

```
┌──────────────────────────────────────────────────────────────┐
│  [Search decisions, reasoning, events...]                     │
│  Source: [All] [Git] [AI] [Terminal]   Period: [7d|30d|90d]  │
├──────────────────────────────────────────────────────────────┤
│  DECISION TIMELINE  (chronological, most recent first)        │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Apr 21 · auth · "Chose JWT over session cookies"         ││
│  │ Confidence: 85%  │  Files: 3  │  → Evidence              ││
│  ├──────────────────────────────────────────────────────────┤│
│  │ Apr 20 · api · "Added rate limiting middleware"          ││
│  │ Confidence: 72%  │  Files: 2  │  → Evidence              ││
│  └──────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│  DOMAIN DISTRIBUTION (sidebar: domain → count pill cloud)     │
└──────────────────────────────────────────────────────────────┘
```

When global: decisions show project badge. Cross-project connections highlighted.

---

#### PAGE: Active System Reveal (first-run overlay)

Replaces the current Home 5-state machine. Shown as a full-screen overlay on first visit (before any data exists), then transitions to the normal Home page.

```
Phase A: CONNECTING
┌──────────────────────────────────────────────────────────────┐
│                                                               │
│              [unfade logo, subtle pulse animation]             │
│                                                               │
│              Connecting to intelligence layer...              │
│                                                               │
│  Capture Engine    ○ ──→ ● (green, with animation)            │
│  Materializer      ○ ──→ ... (waiting)                       │
│  Intelligence      ○ (waiting)                               │
│  SSE Connection    ○ ──→ ● (green)                           │
│                                                               │
└──────────────────────────────────────────────────────────────┘

Phase B: CAPTURING (subsystems coming online)
┌──────────────────────────────────────────────────────────────┐
│              Watching your work...                            │
│                                                               │
│  ┌─────────────────────────────────────────────┐             │
│  │  git commit "Add auth module"          3s ago│             │
│  │  claude-code session started           1s ago│             │
│  └─────────────────────────────────────────────┘             │
│                                                               │
│  Events captured: 13                                         │
│  ████████░░░░░░░░░░░░  calibrating...                       │
│                                                               │
│  [Skip to dashboard →]                                       │
└──────────────────────────────────────────────────────────────┘

Phase C-E: Metrics fade in one by one, overlay dissolves into Home
```

**Implementation:** The reveal is a `<div id="system-reveal">` overlay that sits on top of the Home page. As metrics become available (via SSE), the overlay elements animate out and the underlying dashboard elements animate in. After all phases complete, the overlay is removed from DOM and a `localStorage` flag prevents it from showing again.

---

### 4.5 Composable Component Library

**File structure:**

```
src/server/components/
├── metric-card.ts        → heroMetricCard(), kpiCard(), kpiStrip()
├── badges.ts             → dataFreshnessBadge(), estimateBadge(), confidenceBadge(), sourceBadge(), projectBadge()
├── charts.ts             → gaugeSvg(), sparklineSvg(), barChartSvg(), heatmapCell(), trendArrow()
├── empty-state.ts        → emptyState()
├── evidence-drawer.ts    → drawerContent(), drawerEventRow()
├── project-selector.ts   → projectSelector(), projectCard()
├── data-table.ts         → dataTable(), sortableHeader()
├── system-reveal.ts      → systemRevealOverlay(), revealPhase()
├── live-strip.ts         → liveStrip() — standalone component (previously inline in layout)
├── tabs.ts               → tabBar(), tabPanel()
├── nav.ts                → sidebarNav(), navItem(), navGroup()
└── index.ts              → re-exports all
```

**Component contract:**
- Every component is a pure function returning a string
- Props are typed interfaces (not Zod — runtime validation is overkill for internal HTML rendering)
- No side effects — components don't read files or call APIs
- Testable: `expect(kpiCard({ value: 42, label: 'Events' })).toContain('42')`

### 4.6 Data-to-UI Mapping

| Data Source | Pages Using It | Project-Aware | Fetch Method |
|-------------|---------------|---------------|--------------|
| `GET /api/summary?projectId=` | Home, Live Strip | Yes — filter or aggregate | Fetch + SSE |
| `SSE /api/stream` | Live Strip (global), Live, Home | Yes — stream includes `projectId` per event | EventSource (singleton) |
| `GET /api/intelligence/*?projectId=` | Intelligence Hub (all tabs) | Yes | Fetch per tab activation |
| `GET /api/decisions?projectId=&q=` | Decisions | Yes | htmx search + initial load |
| `GET /api/repos` | Home (All Projects view), Project Selector | Already multi-project | Fetch on layout load |
| `GET /api/heatmap?projectId=` | Intelligence Hub > Comprehension tab | Yes | Fetch on tab activation |
| `GET /unfade/profile` | Profile | No — global by definition | Fetch on mount |
| `GET /api/system/health` | Live Strip, Settings | Already global | Fetch + SSE health events |
| `GET /api/distills?projectId=` | Distill | Yes | Fetch on mount + date nav |
| `GET /api/logs` | Logs | No — system-level | Fetch + SSE log stream |
| `GET /api/integrations/status` | Integrations | No — system-level | Fetch on mount |

### 4.7 API Route Changes Required

| Route | Change | Sprint |
|-------|--------|--------|
| `GET /api/summary` | Accept `?projectId=`. If absent, return global aggregate. If present, filter by project | 15B |
| `GET /api/intelligence/*` (14 endpoints) | Read from `~/.unfade/intelligence/`. Accept `?projectId=` for scoped data | 15B |
| `GET /api/heatmap` | Add `WHERE project_id = ?` to SQLite query when `?projectId=` provided | 15B |
| `GET /api/stream` (SSE) | Replace mtime polling with EventEmitter from materializer. Include `projectId` in event payloads | 15E |
| `GET /api/decisions` | New route: reads SQLite `decisions` table, supports `?projectId=&q=&domain=&source=&period=` | 15C |
| `GET /intelligence/tab/:name` | New route: returns htmx partial for Intelligence Hub tabs | 15C |
| `DELETE /repos/:id` page route | Remove — repo detail page removed (merged into Home) | 15A |
| `GET /api/repos/:id/events` | Keep but read from global events dir filtered by projectId | 15B |

---

## 5. Implementation Plan: Annotated Sprints 15A–15E

> Each sprint below provides a fully annotated, component-by-component specification with complete data lineage. For each UI surface, this section documents:
>
> 1. **Data Consumed** — exact fields, types, and API endpoints
> 2. **Data Lineage** — the complete path from capture to pixel (referencing Section 0 Atlas)
> 3. **Transformation** — how raw data becomes the displayed value
> 4. **Presentation** — visual design, layout, interaction
> 5. **User Question Answered** — what this element tells the user
> 6. **Action Enabled** — what the user can do with this information
> 7. **Persona Value** — how this element serves developers, engineers, and executives differently

---

### Sprint 15A — Component System + Navigation Restructure

**Objective:** Write the composable component library from scratch. Build the 4-layer navigation model. Delete Portfolio and Repo Detail pages (their functionality is replaced by the new Home page in Sprint 15B).

**Acid test:**
```bash
pnpm build && pnpm test && \
  curl -s http://localhost:7654/ | grep -q 'project-selector' && \
  curl -s http://localhost:7654/ | grep -q 'Observe' && \
  echo "PASS: Component system + new nav"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-400** | Create component library | Write `metric-card.ts`, `badges.ts`, `charts.ts`, `empty-state.ts`, `tabs.ts`, `nav.ts` from scratch. Pure functions returning HTML strings | `src/server/components/*.ts` |
| **UF-401** | Update `layout.ts` navigation | 4-layer nav (Observe / Understand / Identity / System). System group collapsed by default. Project selector placeholder in live strip (static, no functionality yet) | `src/server/pages/layout.ts` |
| **UF-402** | Write new pages using components | Build Home, Intelligence, Coach pages from scratch using the component library. Delete `portfolio.ts` and `repo-detail.ts` entirely | `src/server/pages/*.ts` |
| **UF-403** | Shared client-side module | Write `window.__unfade` object in layout from scratch: SSE singleton, project context, `fetch()` helper. All page scripts use shared SSE from the start | `src/server/pages/layout.ts` |

#### 15A — Component-by-Component Data Contracts

---

##### `heroMetricCard()` — `src/server/components/metric-card.ts`

```typescript
interface HeroMetricCardProps {
  value: string | number;      // The primary metric value
  label: string;               // Human-readable label (e.g., "Direction Density")
  sublabel?: string;           // Contextual interpretation (e.g., "You steer confidently")
  trend?: {
    direction: 'up' | 'down' | 'flat';
    value: string;             // e.g., "↑ 8% vs last week"
  };
  freshness?: {
    tier: 'live' | 'recent' | 'stale' | 'cold';
    updatedAt: string;         // ISO timestamp
  };
  confidence?: 'high' | 'medium' | 'low';
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | The `value` prop is populated by the calling page. On Home: `directionDensity24h` from `SummaryJson`. On Intelligence: `aes` from `efficiency.json` |
| **Data lineage** | **Home hero:** `SummaryJson.directionDensity24h` ← summary-writer queries `SELECT AVG(json_extract(metadata, '$.direction_signals.human_direction_score')) FROM events WHERE ts > datetime('now', '-24 hours') AND source IN ('ai-session', 'mcp-active')` ← events ingested by materializer from `~/.unfade/events/<date>.jsonl` ← Go daemon captures AI session interactions, computing `human_direction_score` (0-1 float) per interaction based on how much the developer steered the AI vs accepting its first suggestion |
| **Transformation** | Raw: float 0.0–1.0 in event metadata → SQLite AVG → summary.json float → page multiplies ×100 for percentage → component renders as integer with "%" |
| **Presentation** | Large monospace numeral (`text-5xl font-bold text-[var(--accent)]`). Optional trend arrow. Optional `dataFreshnessBadge()`. Optional `confidenceBadge()`. Subtle border glow on hover. Max-width 360px, centered within content area |
| **User question answered** | "How effectively am I using AI today?" (developer) / "What's the team's AI quality score?" (executive) |
| **Action enabled** | If direction density is low (<40%), take action: write more specific prompts, review AI suggestions more critically. If AES is declining, drill into sub-metrics via Intelligence Hub tabs |
| **Developer value** | Immediate feedback on AI collaboration quality. A dropping number is an early warning to adjust behavior before wasting more time on unfocused AI interactions |
| **Engineer/Tech Lead value** | Team-level pulse: "Are we using AI well this sprint?" Trend shows whether training or process changes are taking effect |
| **Executive value** | Single number that answers "is our AI investment producing quality?" Trackable over quarters. Directly correlates with delivery speed and code quality metrics |

---

##### `kpiCard()` + `kpiStrip()` — `src/server/components/metric-card.ts`

```typescript
interface KpiCardProps {
  value: string | number;
  label: string;
  delta?: string;              // e.g., "+12%" or "-3 vs yesterday"
  icon?: string;               // SVG icon string
  href?: string;               // Link to detail page
}

// kpiStrip() renders an array of KpiCardProps in a responsive grid
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Array of 4–5 cards. On Home (global): `[{ value: repos.length, label: 'Active Projects' }, { value: summary.eventCount24h, label: 'Events 24h' }, { value: efficiency.aes, label: 'AES' }, { value: summary.todaySpendProxy, label: 'Est. Cost' }]`. On Home (project): `[eventCount24h, comprehensionScore, topDomain, todaySpendProxy]` |
| **Data lineage per card** | **Events 24h:** `SummaryJson.eventCount24h` ← `SELECT COUNT(*) FROM events WHERE ts > datetime('now', '-24 hours')` ← materializer inserts from JSONL ← Go daemon captures. **Comprehension:** `SummaryJson.comprehensionScore` ← read from `comprehension.json.overall` ← comprehension-radar analyzer computes from `comprehension_by_module` table ← derived from direction scores in AI sessions touching each module. **Top Domain:** `SummaryJson.topDomain` ← `SELECT domain, COUNT(*) FROM events GROUP BY domain ORDER BY COUNT(*) DESC LIMIT 1` ← domain extracted from file paths in events. **Cost:** `SummaryJson.todaySpendProxy` ← `SELECT SUM(estimated_cost) FROM token_proxy_spend WHERE date = ?` ← cost-attribution analyzer estimates from event count × model pricing |
| **Transformation** | Each card receives a pre-computed value from summary.json or intelligence file. The strip itself does no computation — just layout |
| **Presentation** | Compact cards in `grid-cols-4` (responsive: `grid-cols-2` at 768px, stacked at 375px). Each card: small icon top-left, monospace value center, label below, optional delta badge (green ↑ / red ↓). Cards use `bg-[var(--surface)]` with `border-[var(--border-color)]`, `rounded-lg`, `p-4` |
| **User question answered** | "What are the 4 most important numbers right now?" — secondary to the hero metric, these provide peripheral awareness |
| **Action enabled** | Low event count → check capture engine. Low comprehension → review that domain. High cost → check waste ratio. Click card → navigate to detail page |
| **Developer value** | Quick health check: "Am I in a productive flow today?" without needing to open multiple pages |
| **Executive value** | Four numbers that summarize AI usage posture: volume, depth, focus, spend. Perfect for 10-second standup check |

---

##### `dataFreshnessBadge()` — `src/server/components/badges.ts`

```typescript
interface DataFreshnessBadgeProps {
  updatedAt: string;  // ISO timestamp
}
// Computes tier internally:
// live: <30s, recent: <5m, stale: <30m, cold: >30m
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `updatedAt` ISO string from `SummaryJson.updatedAt` |
| **Data lineage** | `SummaryJson.updatedAt` ← set to `new Date().toISOString()` by summary-writer on each materializer tick ← materializer runs every ~5-10 seconds during active development |
| **Transformation** | Component computes `Date.now() - Date.parse(updatedAt)` and maps to tier: `live` (<30s), `recent` (<5m), `stale` (<30m), `cold` (>30m) |
| **Presentation** | Colored dot + text: green "live · 4s ago", yellow "recent · 2m ago", orange "stale · 15m ago", gray "cold · 2h ago" |
| **User question answered** | "Is this data current or stale?" — trust signal |
| **Action enabled** | If stale/cold: check server health, verify daemon is running |
| **Developer value** | Know whether to trust the numbers. Early morning = cold is normal. Mid-session = stale means investigate |
| **Executive value** | Data governance — confirms dashboards reflect reality for any metric shared in reports |

---

##### `estimateBadge()` — `src/server/components/badges.ts`

```typescript
interface EstimateBadgeProps {
  content: string;  // The USD value to wrap, e.g., "$12.40"
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Any USD string from cost data |
| **Data lineage** | Cost values originate from `costs.json` ← cost-attribution analyzer ← `token_proxy_spend` table ← events per model × configurable pricing rates. Pricing rates are user-configured in `~/.unfade/config.json` under `intelligence.pricing` |
| **Transformation** | None — wraps the content string in visual treatment |
| **Presentation** | Subtle dashed border, "≈" prefix, tooltip: "This is a proxy estimate based on session metadata, not exact billing data." Background tint `bg-amber-500/10` |
| **User question answered** | "How precise is this cost number?" — intellectual honesty |
| **Action enabled** | Prevents overreacting to estimates. User knows to check actual billing for precise figures |
| **Developer value** | Understand "$12.40 today" is a useful ballpark, not an invoice |
| **Executive value** | Critical for budget discussions — prevents embarrassing discrepancies between Unfade projections and actual cloud billing. Establishes trust through transparency |

---

##### `confidenceBadge()` — `src/server/components/badges.ts`

```typescript
interface ConfidenceBadgeProps {
  level: 'high' | 'medium' | 'low';
  dataPoints?: number;  // e.g., 42 sessions
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Confidence level from any intelligence analyzer. From efficiency.ts: `high` ≥ 10 data points, `medium` ≥ 5, `low` < 5 |
| **Data lineage** | Data points = qualifying AI session events in last 24h. `SELECT COUNT(*) FROM events WHERE source IN ('ai-session', 'mcp-active') AND ts > datetime('now', '-24 hours')` |
| **Transformation** | Analyzer computes confidence; badge renders it |
| **Presentation** | Three-state pill: green "High (42 sessions)", yellow "Medium (7 sessions)", red "Low (2 sessions)" |
| **User question answered** | "Should I trust this number?" |
| **Action enabled** | Low confidence → wait for more data, don't overreact. High confidence → act on the metric |
| **Developer value** | Know when to trust a metric. Early in the day, everything is low confidence — that's normal |
| **Executive value** | Statistical rigor. Prevents presenting thin data as definitive findings |

---

##### `gaugeSvg()` — `src/server/components/charts.ts`

```typescript
interface GaugeSvgProps {
  value: number;    // Current value (e.g., AES score 0-100)
  max: number;      // Maximum value (usually 100)
  size: number;     // Diameter in px (usually 200)
  label: string;    // Center text label
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `efficiency.json.aes` (0-100 composite score) |
| **Data lineage** | AES = Direction(30%) + TokenEfficiency(20%) + IterationRatio(20%) + ContextLeverage(15%) + ModificationDepth(15%). Each sub-metric queries SQLite `events` table. Phase multiplier applied (planning 1.5×, debugging 0.7×). Outcome adjustment (up to 20% penalty for high failure rate). Full computation in `src/services/intelligence/analyzers/efficiency.ts` |
| **Transformation** | Raw: 5 separate SQLite queries → 5 normalized sub-scores (0-100) → weighted sum → phase multiplier → outcome adjustment → final AES (0-100) → gauge fills proportional arc |
| **Presentation** | 200×200px SVG ring chart. Background circle `var(--overlay)`, foreground arc `var(--accent)` with CSS transition animation. Large monospace value centered. Used as hero on Intelligence Hub Overview tab |
| **User question answered** | "How well am I using AI?" (single most important composite metric) |
| **Action enabled** | Low AES → drill into sub-metrics to identify which dimension is dragging score down. Improving AES → keep doing what you're doing |
| **Developer value** | Single number tracking AI collaboration quality over time. Ring animation provides satisfying visual feedback |
| **Executive value** | THE KPI for AI adoption quality. Team averaging 70+ = precision instrument. Below 40 = needs AI coaching. Directly maps to ROI |

---

##### `sparklineSvg()` — `src/server/components/charts.ts`

```typescript
interface SparklineSvgProps {
  points: number[];    // Array of values (e.g., last 30 days of AES scores)
  width: number;       // Usually 120
  height: number;      // Usually 32
  color?: string;      // Stroke color, defaults to accent
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Historical arrays from analyzer outputs. AES: `efficiency.json.history[]`. Velocity: `velocity.json.byDomain[domain].history` |
| **Data lineage** | Historical data from `metric_snapshots` table: `SELECT date, rdi FROM metric_snapshots WHERE project_id = ? ORDER BY date DESC LIMIT 30`. Populated by summary-writer during each materializer cycle |
| **Transformation** | Array of raw scores → normalized to SVG coordinate space → polyline path |
| **Presentation** | Inline SVG polyline, typically 120×32px. No axes, no labels — just trend shape. Stroke color matches metric's accent. Used inside KPI cards |
| **User question answered** | "Which direction is this metric trending?" |
| **Action enabled** | Upward trajectory at low value = keep going. Flat at high value = stable, good. Declining = investigate |
| **Developer value** | Glance at trend without opening analytics. Sparkline at AES 55 trending up > flat line at 65 |
| **Executive value** | Direction of travel. Instantly communicates trajectory for team reviews |

---

##### `emptyState()` — `src/server/components/empty-state.ts`

```typescript
interface EmptyStateProps {
  illustration: string;   // SVG line art string
  title: string;          // e.g., "No AI sessions captured yet"
  description: string;    // What's needed and when data will appear
  cta?: { label: string; href: string };  // Optional call-to-action
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Shown when API returns 202 "warming_up" (from `jsonOr202()` pattern in intelligence routes) or when data file doesn't exist |
| **Data lineage** | N/A — represents absence of data |
| **Presentation** | Centered illustration, heading, description, optional CTA button. Gentle fade-in. `bg-[var(--surface)]` with subtle border. Consistent across all empty-able pages |
| **User question answered** | "Why is this page blank?" → "It's not broken, it's waiting for data" |
| **Action enabled** | CTA points to relevant action: "Connect Claude Code" or "Keep working — data appears after 5+ AI sessions" |
| **Developer value** | Reduces first-setup anxiety. Clear explanation beats blank page |
| **Executive value** | Professional appearance even before data exists. Looks intentional during demos |

---

##### `tabBar()` + `tabPanel()` — `src/server/components/tabs.ts`

```typescript
interface TabBarProps {
  tabs: Array<{
    id: string;          // URL parameter value
    label: string;       // Display text
    badge?: number;      // Optional count badge (e.g., alert count)
    active?: boolean;
  }>;
  baseUrl: string;       // Base URL for htmx swaps
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Tab configuration (static) + optional badge counts from intelligence data |
| **Data lineage** | Badge count for Patterns tab: `alerts.json.alerts.length` (number of active alerts) |
| **Presentation** | Horizontal tab bar with underline indicator on active tab. Badge pills. `hx-indicator` spinner during tab load. `hx-push-url` updates URL to `?tab=name`. First tab pre-rendered server-side |
| **User question answered** | "What intelligence views are available?" |
| **Action enabled** | Navigate between intelligence dimensions without leaving the page |

---

##### 4-Layer Sidebar Navigation — `src/server/pages/layout.ts`

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Static navigation structure. Active state from current URL path. Collapsed state from `localStorage('unfade-sidebar-collapsed')` |
| **Presentation** | 240px sidebar (56px collapsed). Four groups with subtle headers: **Observe** (Home, Live, Distill), **Understand** (Intelligence, Decisions, Coach), **Identity** (Profile, Cards), **System** (Settings, Integrations, Logs — collapsed by default). Each item: icon + label, hover highlight, active accent left border. Collapses to icons-only at 1024px |
| **User question answered** | "Where can I go? What does this tool offer?" |
| **Action enabled** | Navigate to any page in 1 click. The 4-layer grouping guides natural exploration: observe → understand → identity |
| **Developer value** | Grouping matches mental model. No cognitive overload from 15 flat items |
| **Executive value** | Clean, minimal navigation projects professionalism |

---

##### Shared Client Module — `window.__unfade` in `layout.ts`

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Manages singleton `EventSource('/api/stream')`. Provides `fetch(path)` that auto-injects `?projectId=` |
| **Data lineage** | SSE stream: materializer tick → summary-writer updates `summary.json` → stream.ts detects change → SSE push → browser. In Sprint 15E: materializer emits EventEmitter `tick` → SSE hub subscribes → push to clients (no mtime polling) |
| **Presentation** | No visual rendering — shared data layer. Pages register callbacks |
| **User question answered** | N/A — infrastructure |
| **Action enabled** | Consistent data across all pages. Project switching works everywhere automatically |

---

### Sprint 15B — Project Selector + Global Data Views

**Objective:** Project selector is functional. Home shows global portfolio view when "All Projects" selected. All API routes accept `?projectId=`. Requires Phase 14 backend changes (at minimum: `projectId` on events and SQLite column).

**Acid test:**
```bash
curl -s "http://localhost:7654/api/summary" | jq '.projects' && \
  curl -s "http://localhost:7654/api/summary?projectId=abc" | jq '.projectId' && \
  curl -s http://localhost:7654/ | grep -q 'All Projects' && \
  echo "PASS: Project selector + global views"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-404** | Implement `projectSelector()` component | Dropdown in live strip. Fetches `/api/repos` on mount. Sets `localStorage` + `window.__unfade.projectId`. Triggers page data refresh on change | `src/server/components/project-selector.ts`, `layout.ts` |
| **UF-405** | Home: dual-mode rendering | "All Projects": global KPI strip + project cards grid + global insights. Specific project: hero metric + KPI strip + project insights. Server reads `?projectId=` query param | `src/server/pages/home.ts` |
| **UF-406** | API routes: add `?projectId=` support | Update summary, intelligence (14 endpoints), heatmap, insights/recent, decisions routes. When `projectId` present: filter. When absent: aggregate | `src/server/routes/*.ts` |
| **UF-407** | SSE: include `projectId` in event payloads | Materializer provides `projectId` context. SSE events include it. Client filters if project selector is set | `src/server/routes/stream.ts` |

#### 15B — Page & Component Data Contracts

---

##### Project Selector — `src/server/components/project-selector.ts`

```typescript
interface ProjectSelectorProps {
  repos: Array<{
    id: string;
    name: string;
    path: string;
    lastEventAt?: string;
    eventCount24h?: number;
    aes?: number;
  }>;
  currentProjectId: string;  // 'all' or specific id
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/repos` → `{ repos: Array<{ id, name, path, lastEventAt, eventCount24h, aes? }> }`. Fetched on mount, cached in `window.__unfade.repos`. Refreshed on SSE `health` event |
| **Data lineage** | `/api/repos` reads `~/.unfade/state/registry.v1.json` (global registry). For each repo, reads its `summary.json` to provide `aes` and `eventCount24h`. Registry updated by `unfade init` or `unfade add <path>`. Go daemon stamps each event with `projectId` matching the registered repo's ID |
| **Transformation** | Registry JSON → repo list with summary data attached → sorted by last activity → rendered as dropdown items |
| **Presentation** | Dropdown in Live Strip (36px bar). 180px width, `bg-[var(--raised)]`, `rounded-md`, border. Globe icon + "All Projects" or repo icon + project name. Dropdown max-height 240px, scrollable. Each item: 32px row, icon, name, AES pill, active checkmark. `Ctrl+Shift+P` keyboard shortcut |
| **User question answered** | "Which project am I looking at? What other projects are available?" |
| **Action enabled** | Switch all data views to a different project in one click. "All Projects" for global view |
| **Developer value** | Instant context switching between repos without restarting server or opening new tab |
| **Engineer/Tech Lead value** | Compare projects by switching the selector. "All Projects" shows portfolio health |
| **Executive value** | Portfolio-level visibility. "All Projects" IS the executive default view |

---

##### Home — Global Mode ("All Projects") — `src/server/pages/home.ts`

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/summary` (no projectId) → global `SummaryJson`. (2) `GET /api/repos` → repo list with per-project summaries. (3) `GET /api/insights/recent` → last 5 cross-project insights: `Array<{ claim, confidence, sources, projectId?, timestamp }>` |
| **Data lineage** | `summary.json` written by summary-writer every materializer tick. Queries: `SELECT COUNT(*) FROM events WHERE ts > datetime('now', '-24 hours')` for eventCount24h. `SELECT AVG(hds) FROM events WHERE ...` for directionDensity24h. Per-repo summaries loaded from registry + individual summary reads |
| **Transformation** | Raw SQLite aggregates → `summary.json` fields → API response → page renders using `kpiStrip()` for global KPIs + `projectCard()` for each repo + insight list |
| **Presentation** | **Global KPI Strip** — 4 `kpiCard()` in `grid-cols-4`: Active Projects, Events 24h, Global AES, Est. Cost. **Project Cards Grid** — `grid-cols-3` (`grid-cols-2` at 1024px, `grid-cols-1` at 768px). Each card: project name, AES pill, event count, last activity, "Open →" link. **Global Insight Stream** — last 5 insights with timestamp, project badge, claim text |
| **User question answered** | "What's happening across ALL my projects right now?" |
| **Action enabled** | Click project card → sets selector → drills into project. Spot inactive projects. Compare project health at a glance |
| **Developer value** | Multi-project overview: "My three projects are all healthy. unfade-cli has highest AES, my-saas-app hasn't had events in 2h — maybe capture engine stopped" |
| **Executive value** | THIS is the executive dashboard. Portfolio-level AI monitoring: project count, total spend, aggregate efficiency, which projects are most/least active. Perfect for weekly leadership updates |

---

##### Home — Project Mode (specific project) — `src/server/pages/home.ts`

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/summary?projectId=<id>` → project-scoped `SummaryJson`. (2) `GET /api/intelligence/efficiency?projectId=<id>` → `{ aes, confidence, subMetrics, trend, history, topInsight }`. (3) `GET /api/insights/recent?projectId=<id>` → project insights |
| **Data lineage** | Same as global, but all SQLite queries include `WHERE project_id = ?`. Summary-writer computes per-project when scoped. Efficiency from `efficiency.json` (may be project-scoped or filtered in-memory) |
| **Transformation** | Direction density float → percentage. AES → integer 0-100. Comprehension → percentage. Cost → USD with estimate badge |
| **Presentation** | **Hero Card** — `heroMetricCard()` with Direction Density %, trend vs last week, freshness badge. Sublabel: "You steer confidently" (>70%) / "Balanced collaboration" (40-70%) / "AI is leading" (<40%). **KPI Strip** — Events 24h, Comprehension, Top Domain, Est. Cost. **Two-Column** — Left: Insight Stream. Right: Quick Actions (links to Intelligence, Decisions, Distill) |
| **User question answered** | "How's my work going in this specific codebase today?" |
| **Action enabled** | Morning check: direction density OK? Event count normal? Comprehension stable? If something's off, click through to Intelligence Hub |
| **Developer value** | 10-second daily orientation. "Good, my AI collaboration is on track" or "Direction density dropped — I need better prompts today" |
| **Executive value** | Project-level deep dive. "Why is unfade-cli's AES dropping?" → click project card → see the project Home → identify the issue |

---

##### Live Strip — `src/server/components/live-strip.ts`

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `summary` events: `{ updatedAt, eventCount24h, freshnessMs }`. SSE `health` events: `{ daemonStatus, materializerStatus, sseStatus }`. Project selector data from `/api/repos` |
| **Data lineage** | `freshnessMs` = `Date.now() - Date.parse(summary.updatedAt)`. Health from server's in-memory process monitoring. Both pushed via SSE singleton |
| **Presentation** | Fixed 36px bar. Left: green/red dot + "Live"/"Disconnected". Center: Project Selector. Right: freshness badge + event counter. All update via SSE |
| **User question answered** | "Is the system alive? When was data last updated? Which project am I viewing?" |
| **Action enabled** | Switch projects. Verify system health at a glance |

---

##### API: `GET /api/summary?projectId=` — `src/server/routes/summary.ts`

| Aspect | Specification |
|--------|---------------|
| **Data lineage** | Without `projectId`: reads global `~/.unfade/state/summary.json` (pre-computed by summary-writer). With `projectId`: queries SQLite directly with `WHERE project_id = ?` for fresh project-scoped metrics |
| **Transformation** | ETag header for caching. `projectId` adds SQL filter. Aggregation for global: weighted average of AES across projects, sum of event counts |
| **Significance** | Most frequently called endpoint — every page, every SSE tick. Adding project filtering here makes every page project-aware automatically |

---

##### API: `GET /api/intelligence/*?projectId=` — `src/server/routes/intelligence.ts`

| Aspect | Specification |
|--------|---------------|
| **Data lineage** | 14 endpoints, each reads from `~/.unfade/intelligence/<file>.json` via `readIntelligenceFile()`. These files written atomically (tmp+rename) by intelligence engine per materializer tick. For project scope: read from `~/.unfade/intelligence/<projectId>/` or filter global file in-memory |
| **Transformation** | `readIntelligenceFile()` updated to accept optional `projectId`. When present, reads project-scoped directory. Falls back to global with in-memory filtering |
| **Pattern** | `jsonOr202()` returns 202 with `{ status: 'warming_up' }` when file doesn't exist yet → triggers `emptyState()` in UI |

---

### Sprint 15C — Intelligence Hub + Decisions Page

**Objective:** Merge Intelligence, Cost, Comprehension, Velocity, Coach, Alerts into Intelligence Hub with htmx tabs. Create Decisions page (replaces Search). Remove 5 standalone pages.

**Acid test:**
```bash
curl -s http://localhost:7654/intelligence | grep -q 'tab-comprehension' && \
  curl -s "http://localhost:7654/intelligence/tab/cost" | grep -q 'estimate' && \
  curl -s http://localhost:7654/decisions | grep -q 'search' && \
  echo "PASS: Intelligence Hub + Decisions"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-408** | Intelligence Hub page | Main page with tab bar. Default "Overview" tab rendered server-side. Other tabs loaded via htmx GET `/intelligence/tab/:name`. URL updated to `?tab=name` | `src/server/pages/intelligence.ts` (overwrite) |
| **UF-409** | Intelligence Hub tab routes | 5 htmx partial routes returning HTML fragments: overview, comprehension, velocity, cost, patterns. Each reads project context from query param | `src/server/routes/intelligence-tabs.ts` (new) |
| **UF-410** | Decisions page | Timeline + search. Reads from SQLite `decisions` table. Source and domain filters. htmx search with debounce. Project badge when global | `src/server/pages/decisions.ts` (new, replaces `search.ts`) |
| **UF-411** | Delete standalone pages | Delete `cost.ts`, `comprehension.ts`, `velocity-page.ts`, `alerts.ts`, `coach.ts`. Remove their routes from `http.ts`. Coach functionality is built into the Intelligence Hub Patterns tab | Multiple files |

#### 15C — Intelligence Hub Tab-by-Tab Data Contracts

---

##### Overview Tab (`/intelligence` or `?tab=overview`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/intelligence/efficiency?projectId=` → `{ aes, confidence, subMetrics: { directionDensity: { value, weight, label, unit }, tokenEfficiency, iterationRatio, contextLeverage, modificationDepth }, trend, history: Array<{ date, aes }>, topInsight, updatedAt, period }` |
| **Data lineage** | efficiency analyzer → 5 SQLite queries: (1) `AVG(human_direction_score)` from events, (2) ratio of high-direction sessions, (3) `AVG(turn_count)` from sessions, (4) `AVG(prompt_specificity)` from events, (5) `AVG(score) FROM comprehension_proxy`. Weighted sum → phase multiplier → outcome adjustment → `efficiency.json`. History from `metric_snapshots` table |
| **Transformation** | Raw sub-metric scores (0-1 floats from SQLite) → normalized to 0-100 → weighted by assigned percentages → phase multiplier (planning 1.5×, debugging 0.7×) → outcome adjustment (up to 20% penalty for failures) → final AES 0-100 |
| **Presentation** | `gaugeSvg()` 200px AES ring. 5 `kpiCard()` sub-metrics in `grid-cols-5` (each shows value, weight badge "30%", confidence badge, sparkline). `sparklineSvg()` 30-day trend. Highlighted insight card when `topInsight` exists |
| **User question answered** | "How well am I using AI, and which dimension should I improve?" |
| **Developer value** | Precise diagnosis: "AES 64 but iteration ratio 35% — I'm going back-and-forth too much. Context leverage also low at 41% — need more specific prompts." Each sub-metric maps to behavioral change |
| **Executive value** | AES is THE ROI metric. Team averaging 70+ = precision instrument. Trend chart = quarterly review slide. Sub-metrics reveal training investment targets |

---

##### Comprehension Tab (`?tab=comprehension`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/intelligence/comprehension?projectId=` → `{ overall, confidence, byModule: Record<string, { score, sessions, trend }>, byDomain: Record<string, { score, sessions }>, blindSpots: Array<{ module, reason, severity }>, blindSpotAlerts: Array<{ module, sustained_weeks }> }`. (2) `GET /api/heatmap?projectId=` → `{ cells: Array<{ module, day, score }> }` |
| **Data lineage** | comprehension-radar analyzer → `comprehension_by_module` table (per-module scores) + `comprehension_proxy` table (per-event scores). Blind spots detected when module has ≥5 sessions with sustained low direction scores (<40%) for 2+ weeks. Heatmap from SQLite: daily per-module comprehension scores |
| **Transformation** | Per-event direction scores in module's files → module average → blind spot detection (sustained low scores) → overall score (weighted by session count per module) |
| **Presentation** | `heroMetricCard()` overall comprehension + confidence. Heatmap grid (X: days, Y: modules, color: red→green). Table toggle (sortable: module, score, sessions, trend sparkline). Blind spot cards (max 3, severity-colored). When global: cross-project heatmap with project color-coding |
| **User question answered** | "Where do I truly understand my code vs where am I relying on AI as a black box?" |
| **Developer value** | Self-awareness: "My auth comprehension is 82% but payments is 32% — I keep accepting AI suggestions without modification in payments. That's a risk." Blind spots surface unknown unknowns. Heatmap reveals daily patterns |
| **Executive value** | Team capability mapping. Low comprehension in critical modules (payments, auth, infra) = business risk. Informs training, code review focus, hiring. "We need someone who actually understands the payments domain" |

---

##### Velocity Tab (`?tab=velocity`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/intelligence/velocity?projectId=` → `{ byDomain: Record<string, { turnsToAcceptance: { current, previous, trend }, sessionsCount, avgDuration }>, overallTrend, overallMagnitude, dataPoints }`. (2) `GET /api/intelligence/decision-durability?projectId=` → `{ decisions: Array<{ id, summary, status: 'held'|'revised'|'pending', domain, decidedAt, lastCheckedAt }>, stats: { totalTracked, heldCount, revisedCount, pendingCount, heldRate } }` |
| **Data lineage** | velocity-tracker → `sessions` table (grouped by session_id, with turn_count, outcome, domain). Decision durability → `decisions` table correlated with subsequent git commit events: if >50% of lines in relevant files modified within 28 days → revised; if >7 days with no major changes → held |
| **Transformation** | Per-session turn counts grouped by domain → average turns-to-acceptance → current vs previous period comparison → trend. Decision nodes correlated with git changes over time → held/revised/pending status |
| **Presentation** | `heroMetricCard()` overall trend. Domain table: each row = domain, current turns, previous, trend arrow, sparkline. Durability stats strip: held rate %, deep-deliberation held rate, quick-decision held rate. Decision table: status badges (green Held, orange Revised, gray Pending). Click decision → Evidence Drawer with original context + subsequent changes |
| **User question answered** | "Am I getting faster at reaching good solutions? Do my decisions stick?" |
| **Developer value** | "In auth, I used to take 8 turns, now 3 — my prompts are better." Durability: "90% of auth decisions held but only 45% of payments — need more deliberation there." Direct skill growth feedback |
| **Executive value** | Velocity = productivity metric. Durability = quality metric. Together: "Is AI making us better, or just faster at making mistakes?" Held-rate is compelling for ROI |

---

##### Cost Tab (`?tab=cost`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/intelligence/costs?projectId=` → `{ totalEstimatedCost, period, isProxy: true, byModel: Record<string, { cost, sessions, percentage }>, byDomain: Record<string, { cost, sessions }>, byBranch, byFeature, abandonedWaste, wasteRatio, contextOverhead, projectedMonthlyCost, costPerDirectedDecision, disclaimer }` |
| **Data lineage** | cost-attribution analyzer → `token_proxy_spend` table (date × model × project = estimated cost) + `sessions` table (outcome=failure for waste). Events per model × configurable pricing rates from `config.json`. `abandonedWaste` = sum of estimated cost for sessions with `outcome=failure` or `outcome=abandoned`. `costPerDirectedDecision` = total cost ÷ high-direction sessions |
| **Transformation** | Event counts per model → multiply by pricing config → aggregate by model/domain/branch → compute waste (failed session costs) → compute cost-per-directed-decision → project monthly |
| **Presentation** | `heroMetricCard()` with `estimateBadge()` wrapping USD. Secondary: cost-per-directed-decision. `barChartSvg()` by-model breakdown. `barChartSvg()` by-domain breakdown. Red-tinted waste card: abandoned waste, waste ratio, context overhead. Projected monthly card with disclaimer. ALL USD wrapped in `estimateBadge()` |
| **User question answered** | "Where is my AI budget going, and how much is wasted?" |
| **Developer value** | "Spent ~$8.40 on Claude today, mostly in payments. $2.10 wasted on abandoned sessions. My cost-per-directed-decision is $0.47." Optimize: cheaper models for simple tasks, better prompts |
| **Executive value** | THE tab for AI investment justification. "Team spends ~$2,400/month. 18% waste. Payments consumes 45% of spend but 20% of decisions — training gap." Cost-per-directed-decision = efficiency KPI. By-model informs vendor negotiations |

---

##### Patterns & Coach Tab (`?tab=patterns`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/intelligence/prompt-patterns?projectId=` → `{ effectivePatterns: Array<{ pattern, description, avgDirectionScore, occurrences, example }>, antiPatterns: Array<{ pattern, description, avgDirectionScore, occurrences, suggestion }>, totalPromptsAnalyzed }`. (2) `GET /api/intelligence/alerts?projectId=` → `{ alerts: Array<{ id, type, title, description, severity, sustainedWeeks, detectedAt }>, maxPerWeek }`. (3) `GET /api/intelligence/replays?projectId=` → `{ replays: Array<{ id, originalDecisionId, triggerEvent, similarity, analysis, suggestedAction, confidence }> }` |
| **Data lineage** | **Patterns:** prompt-patterns analyzer clusters prompts by structural features (constraints, examples, schema refs, question count, length) → correlates with direction scores → high-direction clusters = effective, low = anti-patterns. **Alerts:** blind-spot-detector detects: high acceptance rate (>90%), low comprehension (<40% sustained 2+ weeks), declining direction (week-over-week drop 2+ weeks). Phase-normalized, min 5 data points, max 2 alerts/week. **Replays:** decision-replay monitors current signals against past decisions for domain drift or echoed dead ends. Confidence threshold 0.7, min age 7 days, max 2/week |
| **Transformation** | Prompt structural features → cluster → correlate with outcome scores → label effective/anti. Sustained metrics → threshold breach → alert generation. Current context similarity to past decisions → replay trigger |
| **Presentation** | **Effective Patterns** — green-bordered cards: pattern name, description, avg direction score, occurrence count, example snippet, "Copy as CLAUDE.md rule" button. **Anti-Patterns** — red-bordered cards: same + "Suggestion" field. **Alerts** — warning cards with severity badges, sustained duration. Dismissable. Tab header badge count. **Replays** — blue-bordered: original decision summary, trigger, similarity %, analysis, suggested action. Max 2 visible |
| **User question answered** | "What AI habits should I keep, change, or watch out for?" |
| **Developer value** | "Most effective: 'include schema + constraints + example' → 0.87 direction score. Worst: 'open-ended without context' → 0.23." Copy effective patterns as CLAUDE.md rules. Alerts: "auth comprehension declining 3 weeks." Replays: "you're echoing the caching approach that was revised" |
| **Executive value** | Team coaching data: "80% share same anti-pattern — 30-min workshop could improve AES ~15 points." Alerts = early warning. Replays = reduced repeated mistakes. All reduce waste, improve quality |

---

##### Decisions Page (`/decisions`) — New (Replaces Search)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/decisions?projectId=&q=&domain=&source=&period=` → `{ decisions: Array<{ id, summary, domain, source, confidence, files, timestamp, projectId?, durability? }>, total, domains: Record<string, number> }` |
| **Data lineage** | SQLite `decisions` table, populated by distill pipeline. Each daily distill: read events → extract decisions via LLM synthesis (or fallback) → write to `decisions` table + `graph/decisions.jsonl`. Each decision includes: summary, domain, source events, confidence, related files. Cross-linked via `decision_edges` table |
| **Transformation** | Events (git commits + AI sessions + rejections) → distill synthesis → decision extraction → SQLite storage → filtered query → timeline rendering |
| **Presentation** | Full-width search input (`hx-trigger="keyup changed delay:300ms"`). Filter bar: Source (All/Git/AI/Terminal), Domain (from `domains` response), Period (7d/30d/90d). Chronological timeline: each decision = timestamp, domain badge, project badge (when global), summary, confidence %, file count, "→ Evidence" link. Domain distribution sidebar: pill cloud. FTS5 powers search |
| **User question answered** | "Why was this built this way? What did I decide about X?" |
| **Developer value** | "What did I decide about caching 2 weeks ago?" → search → find decision + trade-offs + rejected alternatives. Prevents re-litigating. New team members search to understand codebase history |
| **Executive value** | Organizational knowledge retention. Developer leaves → decisions stay. Post-mortems: "What decisions led to this?" Audits: evidence trail. The decision graph is institutional memory |

---

##### Deleted Pages

| Page | Merged Into | Route Removed |
|------|-------------|---------------|
| `cost.ts` | Intelligence Hub → Cost tab | `GET /cost` |
| `comprehension.ts` | Intelligence Hub → Comprehension tab | `GET /comprehension` |
| `velocity-page.ts` | Intelligence Hub → Velocity tab | `GET /velocity` |
| `alerts.ts` | Intelligence Hub → Patterns & Coach tab | `GET /alerts` |
| `coach.ts` | Intelligence Hub → Patterns & Coach tab | `GET /coach` |
| `search.ts` | Decisions page | `GET /search` |

No code carried forward — each tab is written from scratch using the component library.

---

### Sprint 15D — Active System Reveal

**Objective:** First-run experience that progressively reveals each subsystem. Replaces the current 5-state machine in Home.

**Acid test:**
```bash
# Clear localStorage, open localhost:7654
# Should see system reveal overlay, not raw dashboard
curl -s http://localhost:7654/ | grep -q 'system-reveal' && \
  echo "PASS: System reveal present"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-412** | System Reveal component | `systemRevealOverlay()` — full-screen overlay with 5 phases. Subscribes to SSE for subsystem status. Auto-advances. "Skip to dashboard" link. Removed from DOM after complete. `localStorage` flag prevents re-show | `src/server/components/system-reveal.ts` |
| **UF-413** | Integrate with Home | Home page includes system reveal overlay when `localStorage` flag not set. Overlay fades out, dashboard fades in. Remove old 5-state machine JS | `src/server/pages/home.ts` |
| **UF-414** | SSE subsystem status events | Add `subsystem` event type to SSE: `{ subsystem: 'daemon'|'materializer'|'intelligence', status: 'starting'|'ready'|'error' }`. Emitted during startup sequence | `src/server/routes/stream.ts`, `src/server/unfade-server.ts` |

#### 15D — System Reveal Phase-by-Phase Data Contracts

---

##### Phase A — CONNECTING (0-5 seconds)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `subsystem` events: `{ subsystem: 'daemon'|'materializer'|'intelligence'|'sse', status: 'starting'|'ready'|'error' }`. Initial `health` event with current system state |
| **Data lineage** | Server emits during startup: HTTP bind → SSE ready, Go daemon spawn → daemon starting/ready, materializer loop start → ready, first intelligence tick → ready |
| **Presentation** | Full-screen overlay (`position:fixed; inset:0; z-50`). Unfade logo with pulse animation. 4 subsystem rows: ○ (waiting) → spinning (starting) → ● green (ready) → ● red (error). Text: "Connecting to intelligence layer..." |
| **User question answered** | "Is the system working?" |
| **Developer value** | Instant architecture understanding. "It has a capture engine, materializer, and intelligence layer" |
| **Executive value** | Impressive first demo. Progressive activation looks professional |

---

##### Phase B — CAPTURING (first 5 minutes)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `event` payloads: `{ type, source, content: { summary }, timestamp }`. Running count from SSE `summary` events with `eventCount24h` |
| **Data lineage** | Events written by Go daemon → `~/.unfade/events/<date>.jsonl` → materializer ingests → SSE forwards to browser (~2s latency) |
| **Presentation** | Mini event feed (3-4 items). Counter with source attribution: "13 from git, 2 from Claude Code, 1 from terminal". Progress bar + "calibrating...". "Skip to dashboard →" link |
| **User question answered** | "Is it capturing my work?" |
| **Developer value** | Verification: "I committed and it appeared — git hooks connected." If not: know to fix integration |
| **Executive value** | Demonstrates passive capture: "It captures everything automatically — no manual logging" |

---

##### Phase C — MATERIALIZING (~30 seconds)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `summary` event with first non-empty data: `{ directionDensity24h, eventCount24h, comprehensionScore, firstRunComplete }` |
| **Data lineage** | Materializer first cycle complete: JSONL → SQLite → session materializer → intelligence engine → summary.json. Takes ~10-30s depending on event volume |
| **Presentation** | Metrics fade in one by one: direction density (blur → sharp), comprehension, AES gauge fills. Brief annotation per metric: "Direction Density: 73% — how much you steer the AI". Overlay begins dissolving into dashboard |
| **User question answered** | "What does my work look like as data?" |
| **Developer value** | First metrics from actual work. "My direction density is 73% — I didn't know that" |
| **Executive value** | "Within 30 seconds, we can see the AI efficiency score." Speed-to-value |

---

##### Phase D — INTELLIGENCE WARMING (~2 minutes)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `intelligence` events as each analyzer completes. Analyzers with insufficient data (< `minDataPoints`) produce null |
| **Data lineage** | Intelligence engine runs all 8 analyzers. Each writes to `~/.unfade/intelligence/<file>.json`. Some need ≥5 data points |
| **Presentation** | Intelligence cards populate one by one. First insight highlighted: "First insight: You iterate 2.3x faster on auth than payments." Overlay fully dissolved. "calibrating..." on analyzers still waiting for data |
| **User question answered** | "What has Unfade learned about me?" |
| **Developer value** | First actionable intelligence from passive observation |
| **Executive value** | "After 2 minutes, Unfade identified where the team needs training" |

---

##### Phase E — LIVE (steady state)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Full dashboard mode. All APIs return live data. Intelligence refreshes per materializer tick (~5-10s) |
| **Data lineage** | Continuous loop: daemon captures → materializer ingests → intelligence runs → summary updates → SSE pushes → DOM updates. Typical action-to-dashboard latency: 5-15s |
| **Presentation** | Overlay removed from DOM. `localStorage('unfade-reveal-complete')` flag set. Live Strip shows: "Active since 2m ago · 47 events captured · AES: 64" |
| **User question answered** | All questions — full tool access |
| **Developer value** | Context from the reveal means they understand every number. Much better than landing on unexplained dashboard |
| **Executive value** | Professional onboarding: "Nobody needed training — the system revealed itself" |

---

### Sprint 15E — Event-Driven SSE + Polish + Cleanup

**Objective:** Replace mtime polling with event-driven SSE. Responsive polish. Remove dead code. Full test suite.

**Acid test:**
```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint && \
  echo "PASS: Full redesign complete, CI green"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-415** | SSE Hub (event-driven) | `src/server/sse-hub.ts` — EventEmitter singleton. Materializer emits 'tick'. SSE handler subscribes. Delete mtime polling code entirely | `src/server/sse-hub.ts` (new), `stream.ts`, materializer |
| **UF-416** | Component tests | Unit tests for all components in `src/server/components/`. Each function tested with various prop combinations | `test/server/components/*.test.ts` |
| **UF-417** | Remove dead pages + routes | Delete `portfolio.ts`, `repo-detail.ts`, `search.ts`, `cost.ts`, `comprehension.ts`, `velocity-page.ts`, `alerts.ts` and their route files. Update `http.ts` imports. Verify no orphan imports | Multiple files |
| **UF-418** | Responsive + a11y polish | Verify all pages at 1440/1024/768/375px. Keyboard nav for project selector. Tab order. ARIA labels on interactive elements | `src/server/pages/*.ts`, `src/server/components/*.ts` |

#### 15E — Infrastructure & Remaining Pages

---

##### SSE Hub — `src/server/sse-hub.ts`

| Aspect | Specification |
|--------|---------------|
| **Current (replaced)** | `stream.ts` uses `setInterval` every 2s to `statSync('state/summary.json')`, checks mtime, reads file, pushes to clients. Wasteful: 30 stat calls/min when nothing changes |
| **New architecture** | Materializer emits `'tick'` on shared EventEmitter. SSE Hub subscribes. On tick: reads fresh `summary.json` + `intelligence/*.json`, formats SSE payloads, pushes to all clients. `fs.watch('~/.unfade/events/')` for sub-second event previews on Live page |
| **Event types** | `summary` (metrics), `intelligence` (analyzer outputs), `health` (system status), `event` (raw event preview for Live page), `subsystem` (startup phases for System Reveal) |
| **User question answered** | N/A — infrastructure enabling real-time across all pages |
| **Developer value** | Dashboard feels truly live — changes appear within milliseconds of materializer processing |
| **Executive value** | Responsive, professional tool. Real-time, not periodic reports |

---

##### Live Page (`/live`) — Event Stream

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `event` payloads: `{ id, type, source, timestamp, content: { summary, files?, branch? }, projectId }`. Historical: `GET /api/repos/:id/events?limit=50` for initial load |
| **Data lineage** | Go daemon → JSONL → `fs.watch` → SSE Hub → browser (~500ms). Historical from SQLite `events` table ORDER BY ts DESC |
| **Presentation** | Full-height scrolling stream. Each event: colored left border (green=git, blue=AI, gray=terminal), timestamp, type badge, source icon, summary, files (collapsible), branch badge. Auto-scroll with lock on manual scroll-up. Project badge in "All Projects" mode. Filter bar: source checkboxes, type filter |
| **User question answered** | "What exactly is Unfade capturing right now?" |
| **Developer value** | Real-time verification and debugging. Flow awareness — seeing your own activity stream is engaging |
| **Executive value** | Capture fidelity demonstration. Audit capability: "Show all AI events in payments this week" |

---

##### Distill Page (`/distill`) — Daily Reasoning Summaries

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/distills?projectId=&limit=30` → distill list. `GET /api/distills/:date?projectId=` → `{ date, markdown, synthesizedBy, decisions[], tradeOffs, deadEnds, domains, eventsProcessed }` |
| **Data lineage** | Distill pipeline (`src/services/distill/distiller.ts`): events → signals → context linking → LLM synthesis (or fallback) → decisions + trade-offs + dead ends → profile update → graph update → markdown write to `~/.unfade/distills/<date>.md`. Triggered daily by scheduler (default 18:00, ±5 min jitter) or CLI `unfade distill` |
| **Presentation** | Calendar sidebar (month view, dots on distill dates, green=LLM, gray=fallback). Rendered markdown: Summary, Key Decisions (confidence + domain), Trade-offs, Dead Ends (with time invested), Domains. Today's distill highlighted or "generates at 6PM" with early trigger option. Synthesizer badge |
| **User question answered** | "What did I accomplish today/this week? What decisions were made and why?" |
| **Developer value** | Daily review: "4 decisions, 2 trade-offs, 1 dead end costing 45 min." Weekly prep for standups. Onboarding: new members read last 2 weeks |
| **Executive value** | Project narrative without status reports. Due diligence. Post-mortems: "What decisions led to this?" LLM-synthesized distills read like professional engineering summaries |

---

##### Profile Page (`/profile`) — Developer Reasoning Identity

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /unfade/profile` → `ReasoningModelV2`: `{ version: 2, patterns: Array<{ name, description, frequency, domains, confidence }>, domains: Array<{ name, sessionCount, comprehension, velocity }>, decisionStats: { total, heldRate, avgConfidence, topDomain }, strengths[], growthAreas[] }` |
| **Data lineage** | Built incrementally by distill pipeline. Each daily distill updates `~/.unfade/profile/reasoning_model.json` (v2). Patterns from repeated decision-making styles across distills. Domain expertise from comprehension + sessions. Decision stats from decision graph. Global by design — represents developer across all projects. Takes weeks to stabilize, months to fully develop |
| **Presentation** | Header: name/handle, decision count, member since, reasoning style summary. Pattern cards: "Incremental refactorer", "Context-heavy prompter", "Test-first thinker" — each with frequency, domain tags, confidence. Domain expertise chart (radar or bar). Decision quality: held rate, confidence distribution. Strengths & Growth Areas columns |
| **User question answered** | "Who am I as a developer? What are my cognitive strengths and blind spots?" |
| **Developer value** | Data-grounded self-knowledge: "I'm an incremental refactorer, strong in auth/payments, 87% held rate, growth area: test coverage in AI domain." Career development, performance reviews |
| **Executive value** | Objective developer assessment beyond LOC/PR count. "92% held-rate — their architectural decisions stick." Team composition. Hiring: reasoning profiles from open-source work |

---

##### Cards Page (`/cards`) — Visual Developer Identity

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/cards?projectId=` → card list. `POST /api/cards/generate` → trigger creation. Cards generated from `reasoning_model.json` + latest intelligence outputs |
| **Data lineage** | Profile patterns + AES + domain expertise + decision quality → card generator → PNG stored in `~/.unfade/cards/` |
| **Presentation** | Gallery of generated cards (developer trading card format). "Generate new card" button. Share options (download PNG). Most recent featured |
| **User question answered** | "How do I share my developer identity?" |
| **Developer value** | Portfolio piece: shareable on LinkedIn/GitHub. Motivating: card improves over time |
| **Executive value** | Team visualization. Gallery of team cards shows collective strengths/gaps |

---

##### Settings Page (`/settings`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/system/health` → subsystem status. Config from `~/.unfade/config.json`. `GET /settings/status` → proactive actions status |
| **Presentation** | System status indicators. Editable config: distill schedule, LLM provider, pricing. Registered projects list. Danger zone |
| **User question answered** | "How do I configure Unfade?" |

---

##### Logs Page (`/logs`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/logs?level=&source=&limit=` → entries from in-memory ring buffer (~1000 entries). `GET /api/logs/stream` → SSE log tail |
| **Presentation** | Scrollable log viewer with level/source filtering. Auto-scroll. Export button |
| **User question answered** | "What's happening inside the system? Why didn't X work?" |

---

##### Integrations Page (`/integrations`)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/integrations/status` → `{ integrations: Array<{ name, type, status, lastEvent?, config }> }`. Status inferred from config presence + recent events from each source |
| **Presentation** | Card grid: Claude Code, Cursor, Copilot, Terminal, Git. Each: icon, status badge, last event, configure button. Setup instructions for disconnected |
| **User question answered** | "Which AI tools are connected? Am I getting full capture coverage?" |
| **Developer value** | "Cursor isn't connected — that's why no events." Fix capture gaps |
| **Executive value** | Deployment audit: "Are all team members' tools connected?" |

---

##### Component Tests — `test/server/components/*.test.ts`

| What's tested | Examples |
|---------------|---------|
| Every component function with various prop combinations | `heroMetricCard({ value: 72, label: 'AES' })` → contains "72" and "AES" |
| Conditional rendering | `kpiCard({ value: 42, delta: '+5%' })` → contains delta; without delta → no delta element |
| Accessibility attributes | All interactive elements have ARIA labels |
| Edge cases | `gaugeSvg({ value: 0, max: 100 })` → zero-state SVG. `emptyState({ title: 'No data' })` → contains CTA |

---

##### Responsive & Accessibility

| Breakpoint | Layout |
|------------|--------|
| 1440px | Sidebar expanded, 3-column grids, full content area |
| 1024px | Sidebar collapsed to icons, 2-column grids |
| 768px | Hamburger menu, single column |
| 375px | Mobile: full-width, stacked, no sidebar |

| A11y Requirement | Implementation |
|-----------------|----------------|
| ARIA labels | All interactive elements: buttons, dropdowns, tabs |
| Tab order | Follows visual order |
| Focus indicators | Visible on all focusable elements |
| Screen reader | `aria-live="polite"` on SSE-updated regions (Live Strip, metrics) |
| Color contrast | WCAG AA (4.5:1 text, 3:1 UI components) |
| Keyboard nav | Project selector: `Ctrl+Shift+P`. Tabs: arrow keys. Escape closes dropdowns/drawers |

---

## 6. Tests (T-400 → T-420)

| Sprint | ID | Test | File |
|--------|----|------|------|
| 15A | **T-400** | `heroMetricCard()` returns HTML with value and label | `test/server/components/metric-card.test.ts` |
| 15A | **T-401** | `kpiCard()` includes delta when provided | `test/server/components/metric-card.test.ts` |
| 15A | **T-402** | `dataFreshnessBadge()` shows correct tier icon | `test/server/components/badges.test.ts` |
| 15A | **T-403** | `estimateBadge()` wraps content in proxy background | `test/server/components/badges.test.ts` |
| 15A | **T-404** | Layout includes 4-layer navigation groups | `test/server/pages/layout.test.ts` |
| 15A | **T-405** | Layout includes `window.__unfade` initialization script | `test/server/pages/layout.test.ts` |
| 15B | **T-406** | Project selector dropdown renders repo list from `/api/repos` | `test/server/components/project-selector.test.ts` |
| 15B | **T-407** | Home renders global KPI strip when no projectId | `test/server/pages/home.test.ts` |
| 15B | **T-408** | Home renders project hero when projectId set | `test/server/pages/home.test.ts` |
| 15B | **T-409** | `/api/summary?projectId=abc` returns filtered data | `test/server/routes/summary.test.ts` |
| 15B | **T-410** | `/api/intelligence/efficiency?projectId=abc` returns scoped data | `test/server/routes/intelligence.test.ts` |
| 15C | **T-411** | Intelligence Hub renders tab bar with 5 tabs | `test/server/pages/intelligence.test.ts` |
| 15C | **T-412** | `/intelligence/tab/cost` returns HTML partial with estimate badges | `test/server/routes/intelligence-tabs.test.ts` |
| 15C | **T-413** | Decisions page renders search input and timeline | `test/server/pages/decisions.test.ts` |
| 15C | **T-414** | Decisions page includes project badge when global | `test/server/pages/decisions.test.ts` |
| 15D | **T-415** | System reveal overlay includes all 5 phases | `test/server/components/system-reveal.test.ts` |
| 15D | **T-416** | System reveal subscribes to SSE subsystem events | `test/server/components/system-reveal.test.ts` |
| 15E | **T-417** | SSE hub emits events when materializer ticks | `test/server/sse-hub.test.ts` |
| 15E | **T-418** | No orphan imports after page removal | CI gate (`pnpm build && pnpm typecheck`) |
| 15E | **T-419** | All pages render at 375px without horizontal overflow | `test/server/pages/responsive.test.ts` |
| 15E | **T-420** | Full CI passes: `pnpm build && pnpm test && pnpm typecheck && pnpm lint` | CI gate |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **10-second active reveal** | New user sees system coming alive within 10s | Manual test: clear localStorage, open localhost:7654 |
| **Project switching** | Switching project updates all visible data in <500ms | Measure: click project, time until DOM updated |
| **Navigation items** | 9 visible + 3 collapsed (from 15 flat) | Count sidebar items |
| **Component reuse** | 0 duplicate HTML patterns across pages | Grep for inline card/badge HTML outside `components/` |
| **Intelligence Hub** | 5 intelligence surfaces in 1 page | Count tabs on `/intelligence` |
| **SSE event-driven** | No mtime polling anywhere | Verify no `statSync` calls in stream.ts |
| **Phase 14 alignment** | All API routes accept `?projectId=` | Integration test suite |
| **Test coverage** | Current + 21 new tests, all passing | `pnpm test` |
| **Data lineage completeness** | Every UI element traceable to capture source | Audit against Section 0 atlas |
| **Persona coverage** | Every page serves developer + executive persona | Audit Section 5 "persona value" fields |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Phase 14 backend not ready** | Medium | High | Sprint 15A can proceed without Phase 14. Sprints 15B+ require Phase 14A complete (projectId on events, SQLite column). Build sequencing ensures Phase 14A ships first |
| **Intelligence Hub tab switching latency** | Low | Medium | htmx swaps are local file reads (<10ms). Add `hx-indicator` spinner. Pre-render default tab server-side |
| **System reveal annoys returning users** | Low | Medium | `localStorage` flag after first completion. "Skip" link always visible. Never shown if summary.json exists |
| **Deleting old pages breaks existing tests** | Medium | Medium | Delete old tests alongside old pages. Write new tests for new components. Sprint 15A runs full test suite |
| **Scope creep from "premium feel" ambition** | High | Medium | Each sprint has acid test. Ship after each sprint. Polish is Sprint 15E, not blocking |
| **Data lineage documentation drifts from implementation** | Medium | Low | Component tests verify data contracts. Section 0 atlas is the source of truth — update it when pipeline changes |

---

## 9. Dependency Graph

```
Phase 14 (Global-First Storage)
  ├── Sprint 14A (projectId on events + SQLite)
  │     └── Sprint 15B (Project selector + global views) [DEPENDS]
  ├── Sprint 14B (Single daemon + global paths)
  │     └── Sprint 15E (Event-driven SSE) [DEPENDS]
  └── Sprint 14C (Intelligence pipeline update)
        └── Sprint 15C (Intelligence Hub with project scoping) [SOFT DEPENDS]

Sprint 15A (Components + Nav)      ← No Phase 14 dependency
  └── Sprint 15B (Project Selector)
        └── Sprint 15C (Intelligence Hub + Decisions)
              └── Sprint 15D (System Reveal)
                    └── Sprint 15E (SSE + Polish)
```

**Sprint 15A can begin immediately** — it builds the component library and new navigation from scratch without any Phase 14 dependency. Sprint 15B requires Phase 14A (projectId exists).

---

## Appendices

### Appendix A — Pages Deleted / Replaced

| Deleted Page | Replaced By | Sprint |
|--------------|-------------|--------|
| `portfolio.ts` | Home (All Projects view) | 15B |
| `repo-detail.ts` | Home (project-selected view) | 15B |
| `cost.ts` | Intelligence Hub → Cost tab | 15C |
| `costs.ts` | Intelligence Hub → Cost tab | 15C |
| `comprehension.ts` | Intelligence Hub → Comprehension tab | 15C |
| `velocity-page.ts` | Intelligence Hub → Velocity tab | 15C |
| `alerts.ts` | Intelligence Hub → Patterns tab | 15C |
| `search.ts` | Decisions page | 15C |
| `coach.ts` | Intelligence Hub → Patterns tab | 15C |
| `efficiency.ts` | Intelligence Hub → Overview tab | 15C |

### Appendix B — Traceability

| This spec section | Ties to |
|-------------------|---------|
| Project Selector | [PHASE_14](./PHASE_14_GLOBAL_FIRST_STORAGE_ARCHITECTURE.md) §5 (single daemon, global events) |
| Intelligence Hub | [PHASE_7_WEB_UI_UX](./PHASE_7_WEB_UI_UX_ARCHITECTURE.md) §4.4 (page specs) |
| System Reveal | [PHASE_7_WEB_UI_UX](./PHASE_7_WEB_UI_UX_ARCHITECTURE.md) §4.7 (first-run flow) |
| Component Library | [PHASE_7_WEB_UI_UX](./PHASE_7_WEB_UI_UX_ARCHITECTURE.md) §4.5 (shared components — built from scratch) |
| Navigation Restructure | [PHASE_7_WEB_UI_UX](./PHASE_7_WEB_UI_UX_ARCHITECTURE.md) §4.3 (sidebar spec) |
| Event-Driven SSE | [PHASE_14](./PHASE_14_GLOBAL_FIRST_STORAGE_ARCHITECTURE.md) §7.3 I-4 (SSE polls mtime) |
| Data Lineage Atlas | New — no prior phase equivalent |

### Appendix C — Intelligence Artifact File Map

| File | Written By | Read By (API) | Read By (UI Page) |
|------|-----------|--------------|-------------------|
| `~/.unfade/state/summary.json` | summary-writer | `GET /api/summary` | Home, Live Strip |
| `~/.unfade/intelligence/efficiency.json` | efficiency analyzer | `GET /api/intelligence/efficiency` | Intelligence Hub → Overview |
| `~/.unfade/intelligence/comprehension.json` | comprehension-radar | `GET /api/intelligence/comprehension` | Intelligence Hub → Comprehension |
| `~/.unfade/intelligence/costs.json` | cost-attribution | `GET /api/intelligence/costs` | Intelligence Hub → Cost |
| `~/.unfade/intelligence/velocity.json` | velocity-tracker | `GET /api/intelligence/velocity` | Intelligence Hub → Velocity |
| `~/.unfade/intelligence/prompt-patterns.json` | prompt-patterns | `GET /api/intelligence/prompt-patterns` | Intelligence Hub → Patterns |
| `~/.unfade/intelligence/alerts.json` | blind-spot-detector | `GET /api/intelligence/alerts` | Intelligence Hub → Patterns |
| `~/.unfade/intelligence/replays.json` | decision-replay | `GET /api/intelligence/replays` | Intelligence Hub → Patterns |
| `~/.unfade/intelligence/rejections.idx.json` | loop-detector | `GET /api/intelligence/rejections` | (internal) |
| `~/.unfade/intelligence/decision-durability.json` | decision-durability | `GET /api/intelligence/decision-durability` | Intelligence Hub → Velocity |
| `~/.unfade/intelligence/narratives.jsonl` | narrative generator | `GET /api/intelligence/narratives` | Home (insights) |
| `~/.unfade/intelligence/correlation.json` | correlation engine | `GET /api/intelligence/correlations` | (future cross-project) |
| `~/.unfade/distills/<date>.md` | distill pipeline | `GET /api/distills/:date` | Distill |
| `~/.unfade/profile/reasoning_model.json` | distill pipeline | `GET /unfade/profile` | Profile |
| `~/.unfade/graph/decisions.jsonl` | distill pipeline | SQLite `decisions` table | Decisions |
| `~/.unfade/state/registry.v1.json` | server (init/add) | `GET /api/repos` | Project Selector, Home |

### Appendix D — Component → Data Source Quick Reference

| Component | Primary Data Source | SQLite Table(s) | Analyzer |
|-----------|-------------------|-----------------|----------|
| `heroMetricCard` (Home) | `summary.json.directionDensity24h` | `events` (AVG hds) | summary-writer |
| `heroMetricCard` (Intelligence) | `efficiency.json.aes` | `events`, `sessions`, `comprehension_proxy` | efficiency |
| `kpiCard` (Events) | `summary.json.eventCount24h` | `events` (COUNT) | summary-writer |
| `kpiCard` (Comprehension) | `summary.json.comprehensionScore` | `comprehension_by_module` | comprehension-radar |
| `kpiCard` (Cost) | `summary.json.todaySpendProxy` | `token_proxy_spend` | cost-attribution |
| `kpiCard` (Domain) | `summary.json.topDomain` | `events` (GROUP BY domain) | summary-writer |
| `gaugeSvg` (AES) | `efficiency.json.aes` | `events`, `sessions`, `comprehension_proxy` | efficiency |
| `sparklineSvg` (trend) | `efficiency.json.history` | `metric_snapshots` | summary-writer |
| `dataFreshnessBadge` | `summary.json.updatedAt` | N/A | summary-writer |
| `estimateBadge` | `costs.json.*` | `token_proxy_spend` | cost-attribution |
| `confidenceBadge` | Various analyzer `.confidence` | `events` (COUNT qualifying) | per-analyzer |
| `heatmapCell` | `comprehension.json.byModule` | `comprehension_by_module` | comprehension-radar |
| `projectCard` | `registry.v1.json` + per-repo `summary.json` | `events` (per project) | summary-writer |
| `tabBar` (alert badge) | `alerts.json.alerts.length` | `comprehension_by_module`, `events` | blind-spot-detector |

---

*End of document.*

# Phase 15 — RRVV UI/UX System Redesign

> **Purpose:** Ground-up redesign of the Unfade web interface aligned with Phase 14 global-first storage architecture. This is not an incremental improvement — it fundamentally reimagines the UI into a premium, production-grade developer tool experience with proper project-level vs global views, an "active system reveal" post-onboarding experience, composable components, and real-time system visibility. Every UI surface is deeply explainable, traceable from raw capture event to rendered pixel, and aligned with real user needs across developers, engineers, and executive stakeholders.
>
> **Method:** RRVV (Rigorous Research → Reason → Validate → Execute).
>
> **Prerequisite:** Phase 14 (Global-First Storage Architecture) must be complete or in-progress. This document assumes `projectId` exists on all events, SQLite cache has `project_id`, and `~/.unfade/` is the primary storage location.
>
> **Status:** ✅ COMPLETE — all 5 sprints (15A–15E) implemented and verified. Sprint 15H (UI Architecture Hardening) is a prerequisite before future UI sprints.
>
> **Last updated:** 2026-04-23 (UI Architecture RRVV Evaluation + Sprint 15H foundation sprint)

---

## Table of Contents

0. [Data Lineage Atlas](#0-data-lineage-atlas)
1. [Rigorous Research: Current UI Audit](#1-rigorous-research-current-ui-audit)
2. [Reason: Ground-Up Redesign as Value-Delivery System](#2-reason-ground-up-redesign-as-value-delivery-system)
3. [Validate: Against Product, Design & Data Integrity Expectations](#3-validate-against-product-design--data-integrity-expectations)
4. [Execute: UI Overhaul Plan](#4-execute-ui-overhaul-plan)
5. [Implementation Plan: Annotated Sprints 15H, 15A–15G](#5-implementation-plan-annotated-sprints-15h-15a15g)
6. [Tests (T-400 → T-480)](#6-tests-t-400--t-480)
7. [Success Metrics](#7-success-metrics)
8. [Risk Assessment](#8-risk-assessment)
9. [Dependency Graph](#9-dependency-graph)
10. [Appendices](#appendices) (includes Appendix D: UI Pattern Reference Library & Data Presentation Standards)
11. [UI Architecture Evaluation (RRVV)](#11-ui-architecture-evaluation-rrvv) — Framework analysis, industry survey, migration strategy

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
│                                                                             │
│  ═══ PHASE 16 INTELLIGENCE EVOLUTION ═══                                   │
│  (See PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md for full specification)      │
│                                                                             │
│  The 8-analyzer intelligence layer was replaced by a 6-sublayer pipeline:  │
│                                                                             │
│  3a. CLASSIFICATION — per-event prompt type (8 types, softmax confidence), │
│      execution phase, chain pattern (9 types), feature targeting            │
│  3b. DAG SCHEDULER — 25 IncrementalAnalyzers in topological order,         │
│      cascade propagation with magnitude-gated change detection              │
│  3c. SEMANTIC SUBSTRATE — CozoDB graph (entities, edges, propagation,      │
│      HNSW vector search, 10+ Datalog query templates)                      │
│  3d. NARRATIVE SYNTHESIS — 20 vehicle-analogy templates (diagnostics,      │
│      prescriptions, progress), executive summaries                          │
│  3e. MATURITY MODEL — 7-dimension Phase 1-4 assessment (direction,         │
│      modification-depth, context-leverage, prompt-effectiveness,            │
│      domain-consistency, loop-resilience, decision-durability)              │
│  3f. CROSS-SOURCE INTEGRATION — efficiency+survival, maturity+ownership,   │
│      dual velocity (AI vs git), git intelligence (commits, churn, expertise)│
│                                                                             │
│  New UI-facing outputs:                                                     │
│  → maturity-assessment.json — Phase 1-4 + 7 dimensions + trajectory       │
│  → narratives.json — diagnostics, prescriptions, progress narratives       │
│  → session-intelligence.json — per-session loop risk, phase, direction     │
│  → commit-analysis.json — commit patterns, message quality, velocity       │
│  → expertise-map.json — per-file expertise (deep/familiar/ai-dependent)    │
│  → efficiency-survival.json — AES × churn × durability composite           │
│  → maturity-ownership.json — maturity adjusted by code ownership           │
│  → dual-velocity.json — AI velocity vs git velocity correlation            │
│  → cross-project-insights.json — pattern transfer, efficiency gaps         │
│  → graph-context.json — live CozoDB graph context for MCP                  │
│  → snapshots/<hour>.json — hourly intelligence state snapshots             │
│                                                                             │
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
| **Phase 16 Additions** | | |
| maturity-model | `maturity-assessment.json` | `{ phase: 1-4, phaseLabel, overallScore, dimensions: { direction, modificationDepth, contextLeverage, promptEffectiveness, domainConsistency, loopResilience, decisionDurability }, bottleneck, trajectory[], phaseTransitions[] }` |
| narrative-engine | `narratives.json` | `{ diagnostics[]: { id, template, severity, headline, detail }, prescriptions[]: { id, priority, action, estimatedImpact }, progress[]: { id, milestone, description, achievedAt }, executiveSummary: string }` |
| git-commit-analyzer | `commit-analysis.json` | `{ frequency: { daily, weekly }, messageQuality, sizeDistribution, branchPatterns, commitVelocity }` |
| git-file-churn | `file-churn.json` | `{ hotFiles[]: { path, churnRate, changeCount }, churnHeatmap[] }` |
| git-expertise-map | `expertise-map.json` | `{ byFile: Record<string, { ownership, expertiseScore, aiSessionCount, gitCommitCount }> }` |
| ai-git-linker | `ai-git-links.json` | `{ links[]: { sessionId, commitHash, timeDelta, filesOverlap }, translationRate }` |
| cross-efficiency-survival | `efficiency-survival.json` | `{ sessions[]: { aes, survivalScore, quadrant }, quadrantDistribution, overallAlignment }` |
| cross-maturity-ownership | `maturity-ownership.json` | `{ byDomain: Record<string, { phase, genuineness, expertiseScore }>, riskAreas[] }` |
| cross-dual-velocity | `dual-velocity.json` | `{ aiVelocity, gitVelocity, alignment, translationEfficiency, comparison }` |

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

#### Phase 16 Upgrade: Value-Delivery Gap Closure + New Surfaces

> The following table maps how Phase 16's intelligence evolution closes the gaps identified above and introduces new UI surfaces that must be designed.

| Phase 15 Gap | Phase 16 Closure | New UI Surface Required |
|-------------|-----------------|------------------------|
| Home hero: missing interpretation | **Narrative synthesis** provides human-readable diagnostics ("Your engine is running rich — high iteration loops burning fuel") | Home hero gains a **narrative headline** below the metric, pulled from `narratives.json` active diagnostics |
| KPI strip: missing what's normal | **Maturity model** provides phase-relative baselines ("In Phase 2: Responsive, direction density >60% is expected") | KPI cards gain **phase context badges** — "Phase 2 baseline: 55%" |
| AES gauge: missing which sub-metric to improve | **Maturity bottleneck detection** identifies the weakest dimension of 7 | Intelligence Overview gains **bottleneck indicator** — "Advance to Phase 3 by improving loop-resilience (currently 42%)" |
| Comprehension heatmap: missing risk framing | **Expertise map** (git × AI fusion) shows true ownership vs AI dependency | Comprehension tab gains **expertise overlay** — files colored by "deep" / "familiar" / "ai-dependent" |
| Cost numbers: missing ROI context | **Efficiency-survival analysis** shows whether efficient AI work produces durable code | Cost tab gains **quadrant chart** — effective-durable vs effective-fragile vs inefficient-durable vs inefficient-fragile |
| Decision timeline: missing impact | **Semantic substrate** tracks decision → revision → outcome chains | Decisions page gains **durability badges** (held/revised) + **causal chain links** ("This decision was revised 3 times → led to pattern X") |
| Coach patterns: missing prioritization | **Narrative prescriptions** rank improvements by impact | Patterns tab gains **prescription cards** — "Priority 1: Reduce iteration loops (saves ~$2.10/day in abandoned sessions)" |
| Profile: missing growth trajectory | **Maturity model Phase 1-4** + **learning trajectories** from semantic substrate | Profile gains **maturity journey visualization** — Phase 1→2→3→4 with milestones and timeline |
| **NEW: No causal reasoning surface** | **Semantic substrate** stores entity→edge→entity graph with backward propagation | **Intelligence Hub > Narratives tab** — shows active causal chains, entity relationships, pattern provenance |
| **NEW: No cross-source visibility** | **Git intelligence pipeline** + cross-source analyzers | **Intelligence Hub > Git & Expertise tab** — commit patterns, file churn, AI→git links, expertise ownership |
| **NEW: No maturity awareness** | **Maturity model** with 7 dimensions + phase progression | **Intelligence Hub > Maturity tab** — phase gauge, dimension radar, trajectory chart, advancement requirements |
| **NEW: No narrative output** | **Narrative synthesis engine** with 20 templates + vehicle analogies | **Intelligence Hub > Narratives tab** — active diagnostics, prescriptions, progress stories, executive summary |

#### Community-Validated Gap Analysis (April 2025)

> Cross-referenced from: Reddit (r/ClaudeCode, r/cursor, r/ExperiencedDevs, r/vibecoding, r/VibeCodeDevs), Hacker News, X/Twitter dev discourse, Anthropic's internal studies, and `.internal/product/TRANSMISSION_THESIS.md`. Ranked by community engagement signal strength.

| # | Pain Point | Community Signal | What Transmission Thesis Says | What Current UI Surfaces | Gap / Missing Surface |
|---|-----------|-----------------|------------------------------|-------------------------|----------------------|
| 1 | **Knowledge evaporation** — reasoning dies when session ends, next dev starts from zero | Highest engagement across all 5 Reddit posts; HN front-page thread "AI makes us forget why" | Gap A: "real-time transmission" — context must persist across sessions and tools | Events list, distill summaries, MCP context injection | **No visibility into context leverage** — users can't see whether prior reasoning was reused or lost. No "Knowledge Retained" framing on distill page |
| 2 | **Daily context re-onboarding ("50 First Dates")** — every AI session starts from scratch despite prior work | Second-highest engagement; dev forums call it "Groundhog Day coding" | Transmission Thesis §3: "The dashcam records the crash. It doesn't prevent it." — Unfade must shift from passive recording to active context injection | MCP server injects context silently; no user-facing confirmation | **No Context Leverage metric** — users don't know if MCP injection happened. Home page shows raw event counts but not "sessions with prior context vs sessions starting cold" |
| 3 | **Identity crisis ("just a prompter")** — senior devs feel reduced to prompt-writers, losing engineering identity | Strong emotional engagement on r/ExperiencedDevs; Anthropic study: 17% comprehension decline | Thesis §5: Unfade = "Driver Development Program" — must affirm engineering identity through evidence | Profile page shows raw decision stats (avg alternatives, acceptance rate) as numbers | **No Identity Narrative** — profile shows data tables, not affirmation. Missing: "You evaluated 4.2 alternatives per decision this week — that's architectural thinking, not prompting" |
| 4 | **Skill atrophy / cognitive dependency** — developers stop understanding code they ship | Anthropic internal study cited across forums; r/cursor thread "I can't code without AI anymore" | Thesis §4: maturity phases — Phase 1 "Bare Engine" has >85% acceptance rate, comprehension declining | Comprehension heatmap per module; AES score | **No Autonomy/Independence surface** — no single view showing "are you becoming more or less dependent on AI over time?" No Independence Index, no skill trajectory chart, no dependency heatmap |
| 5 | **Decision context loss** — "why did we do it this way?" lost within days | Moderate engagement; common in enterprise dev forums | Thesis §2: "Steering" — decision awareness is a core vehicle component | Decision timeline (chronological list), decision-durability endpoint | **No prescriptive decision surface** — decisions shown as list, not as "your decisions in auth lasted 3x longer than your decisions in UI — what's different?" |
| 6 | **Token waste opacity** — money spent on AI with no ROI visibility | Consistent concern across all forums; CFO/CTO pain point | Thesis §6: "Dashboard" — cost telemetry must show value-per-dollar, not just spend | Cost tab shows estimated spend, cost-per-model breakdown | **No ROI framing** — cost shown without outcome correlation. Missing: "You spent $14 on 23 sessions, 18 produced durable commits — $0.78/durable outcome" |
| 7 | **No growth narrative** — no evidence of improvement over time, AI tools feel static | Lower but persistent engagement; devs want "proof I'm getting better" | Thesis §5: maturity journey Phase 1→4 | Profile patterns list, domain distribution | **No temporal growth visualization** — no "you were Phase 1 in January, Phase 2 by March." No "What You Learned This Week" section |

**Meta-insight:** The community is not asking for more dashboards — they are asking for a **diagnostic mechanic**. The Transmission Thesis frames this as the "Dashboard → Mechanic" shift: stop showing raw gauges and start running diagnostics with prescriptions. Every gap above maps to a missing **narrative + action** pair, not a missing chart.

#### 7 Proposed UI Upgrades (Community-Driven)

| # | Upgrade | Target Surface | New Components | Key Metric / Data Source |
|---|---------|---------------|----------------|------------------------|
| 1 | **Vehicle Health Summary Card** | Home page — replaces raw metrics sidebar | `vehicleHealthSummary()` | Maturity phase + top prescription + bottleneck dimension from `maturity-assessment.json` + `narratives.json` |
| 2 | **Autonomy Tab** (Intelligence Hub) | Intelligence Hub — new 9th tab | `autonomyDashboard()`, `independenceGauge()`, `skillTrajectoryChart()`, `dependencyHeatmap()` | Independence Index (weighted composite of HDS, modification rate, alternatives evaluated, comprehension trend) |
| 3 | **Context Leverage Metric** | Home KPI strip — new card | `kpiCard()` with context leverage data | `% sessions with MCP context injection` vs `sessions starting from scratch` — derived from `events` where `source = 'mcp-active'` |
| 4 | **Identity Narrative Block** | Profile page — replaces raw Decision Style numbers | `identityNarrative()` | Narrative synthesis from decision stats: "You evaluated N alternatives — that's architectural thinking, not prompting" |
| 5 | **Prescription Slot** (Intelligence Overview) | Intelligence Hub > Overview — below AES gauge | `prescriptionCard()` (existing from P16) + `vehicleDiagnosticBadge()` | Top prescription from `narratives.json` + vehicle analogy from Transmission Thesis diagnostic templates |
| 6 | **Knowledge Retained Section** | Distill page — new section after summary | `knowledgeRetainedCard()` | Decisions lodged count, dead ends explored, comprehension movements, context available for tomorrow |
| 7 | **Session Autonomy Indicator** | Live page — per-session badge | `sessionAutonomyBadge()` | Per-session: direction %, loop risk, autonomy level (HIGH/MED/LOW) from active session intelligence |

---

## 2. Reason: Ground-Up Redesign as Value-Delivery System

### 2.1 Core Mental Model Shift

**Phase 7 model:** "Unfade is your local reasoning observatory for *this project*."

**Phase 15 model:** "Unfade is your **global reasoning layer** across all projects — with project-level drill-down as a first-class dimension. Every screen answers a specific question, enables a specific action, and scales from developer to executive."

> **Phase 16 model evolution:** "Unfade is your **AI collaboration transmission system** — it doesn't just observe, it diagnoses, explains, and guides. The UI is a **diagnostic interface + story engine**, not a dashboard. Every surface answers 'what happened' (metrics), 'why it matters' (causal reasoning via semantic graph), and 'what this means for me' (narrative synthesis). The Transmission Thesis maps directly to UI layers: **Engine** (capture) → **Transmission** (classification + analyzers) → **Diagnostics** (maturity + narratives) → **Guidance** (prescriptions + coaching)."

The UI must answer these questions in this order:
1. **Is Unfade alive and working?** (System pulse — answered in <2 seconds)
2. **What's happening across all my projects?** (Global overview — answered in <10 seconds)
3. **What's happening in *this* project?** (Project drill-down — one click)
4. **What should I do differently?** (Actionable intelligence — always accessible)
5. **Why is this happening?** (Causal reasoning — entity graph, backward propagation, decision chains) *(Phase 16 addition)*
6. **What does this mean for my growth?** (Maturity trajectory — Phase 1→4 advancement, narrative synthesis) *(Phase 16 addition)*
7. **Who am I as a developer?** (Identity — emerges over time, enriched by semantic substrate)

### 2.2 Value-Delivery Design Principles

Every UI element must pass the **Three-Question Test** (implementation reference: see Appendix D for the full Pattern Library, Data Presentation Standards, and Feature→Pattern mapping):
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

> **Phase 16 navigation upgrade:** The "Understand" group expands to reflect the system's evolution from metric dashboards to a diagnostic + narrative intelligence layer. Intelligence Hub grows from 5 to 8 tabs (adding Maturity, Git & Expertise, Narratives). The 4-layer model remains structurally intact — new intelligence is surfaced within existing navigation, not by adding new top-level pages. This preserves the 10-second-wow constraint while dramatically deepening what each surface reveals.

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

Phase D2: GRAPH BUILDING (Phase 16 addition — after substrate ingestion, ~3 minutes)
  "Unfade is building your knowledge graph..."
  → Entity count populates: "12 decisions, 5 features, 3 patterns identified"
  → First causal link appears: "Connected: auth decisions → 8 files → 2 patterns"
  → Maturity phase reveals: "Phase 1: Discovering — your transmission is engaging"
  → First narrative diagnostic: "Early observation: strong direction density
    with room to improve loop resilience"
  → USER QUESTION ANSWERED: "How does Unfade understand the *relationships*
    between my decisions, features, and patterns?"
  → ACTION ENABLED: Understand that Unfade tracks causal connections, not just metrics

Phase E: LIVE (steady state)
  Full dashboard. All metrics live-updating.
  System reveal strip collapses to the permanent Live Strip.
  "Active since 2m ago · 47 events captured · AES: 64 · Phase 2: Responsive"
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
[Overview] [Maturity] [Autonomy] [Comprehension] [Velocity] [Cost] [Patterns & Coach] [Git & Expertise] [Narratives]
```

| Tab | Content | Data Source | User Question Answered |
|-----|---------|------------|----------------------|
| **Overview** | AES gauge + 5 sub-metrics + trend chart + top insight + maturity phase badge | efficiency.json + maturity-assessment.json | "How well am I using AI?" |
| **Maturity** | Phase 1-4 gauge + 7 dimension radar + trajectory chart + bottlenecks + requirements | maturity-assessment.json + maturity-ownership.json | "What phase am I in and how do I advance?" |
| **Autonomy** | Independence Index gauge (0-100) + skill trajectory chart (30-day) + dependency heatmap + "What You Learned This Week" | efficiency.json (HDS, modification rate) + comprehension.json (trend) + events (alternatives evaluated) + distills (weekly learnings) | "Am I becoming more or less dependent on AI? What skills am I building?" |
| **Comprehension** | Heatmap + table toggle + blind spots + expertise overlay | comprehension.json + heatmap API + expertise-map.json | "Where do I truly understand my code?" |
| **Velocity** | Overall trend + per-domain sparklines + decision durability + dual velocity (AI vs git) | velocity.json + decision-durability.json + dual-velocity.json | "Am I getting faster and does it translate to shipping?" |
| **Cost** | Hero spend + by-model + by-domain bars + waste + efficiency-survival quadrant | costs.json + efficiency-survival.json | "Where is my AI budget going and does it produce lasting code?" |
| **Patterns & Coach** | Effective + anti-patterns + alerts + replays + narrative prescriptions | prompt-patterns.json + alerts.json + replays.json + narratives.json | "What habits should I keep, change, or watch?" |
| **Git & Expertise** | Commit patterns + file churn heatmap + expertise map + AI-git links | commit-analysis.json + file-churn.json + expertise-map.json + ai-git-links.json | "How does my AI work connect to actual shipped code?" |
| **Narratives** | Active narratives (diagnostics/prescriptions/progress) + executive summary | narratives.json + maturity-assessment.json | "What's the story of my AI collaboration?" |

> **Phase 16 upgrade note:** The Intelligence Hub grows from 5 → 9 tabs. Four new tabs surface Phase 16's deepest intelligence: **Maturity** (the Transmission Thesis Phase 1-4 model — answers "where am I on the journey from bare engine to tuned vehicle?"), **Autonomy** (community-validated — answers "am I becoming more independent or more dependent on AI?", surfaces Independence Index, skill trajectory, and dependency patterns), **Git & Expertise** (the first cross-source tab — fuses AI intelligence with git commit patterns), and **Narratives** (the vehicle-analogy story engine — converts metrics into human-readable diagnostics and prescriptions). The Overview tab gains a maturity phase badge. Comprehension gains an expertise overlay (showing "deep" vs "ai-dependent" files). Velocity gains dual-velocity (AI sessions vs commits). Cost gains the efficiency-survival quadrant. Patterns gains narrative prescriptions alongside the existing coach patterns.

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

### 2.10 End-to-End User Flow Diagram (Phase 16 Integrated)

> **Purpose:** This diagram maps every major screen and transition in the UI, documenting for each: what the user sees, what intelligence layer produces it, what the user now understands, and how the experience aligns with the Transmission Thesis (Engine → Transmission → Diagnostics → Guidance).

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  STAGE 1: FIRST RUN — SYSTEM REVEAL (§2.4)                                 ║
║  Screen: Full-screen overlay on Home                                        ║
║  Intelligence: None → Layer 1 (Capture) → Layer 2 (Materialization)         ║
║  Thesis mapping: ENGINE — the system's raw capture capability is revealed   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  Phase A: CONNECTING → Phase B: CAPTURING → Phase C: MATERIALIZING          ║
║  User sees:  Subsystem dots   | Event counter   | First metrics appear     ║
║  Understands: "System works"  | "It sees my work"| "My work becomes data"  ║
║              ↓ auto-advance                                                  ║
║  Phase D: INTELLIGENCE WARMING → Phase D2: GRAPH BUILDING [P16]            ║
║  User sees:  First insights   | Entity count + maturity phase badge         ║
║  Understands: "It analyzes"  | "It knows relationships, not just numbers"   ║
║              ↓ overlay dissolves                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
              ↓
╔══════════════════════════════════════════════════════════════════════════════╗
║  STAGE 2: DAILY ORIENTATION — HOME (§4.4)                                   ║
║  Screen: / (Home) — Global or project-scoped                                ║
║  Intelligence: summary.json (metrics), maturity-assessment.json (phase),    ║
║    narratives.json (headline), efficiency.json (AES)                        ║
║  Thesis mapping: ENGINE + TRANSMISSION — metrics + maturity phase badge     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  User sees (All Projects):                                                   ║
║    Global KPI strip + Project cards [with maturity phase per project]        ║
║    Global narrative headline [P16: "2 projects in Phase 2, 1 warming up"]   ║
║    Insight stream [includes narrative prescriptions alongside metric alerts] ║
║  User understands: "How are all my projects doing? What phase is each at?"  ║
║  Actions: Click project card → Stage 3. Click insight → Stage 4/5.         ║
║                                                                              ║
║  User sees (Specific Project):                                               ║
║    Hero: Direction Density + maturity phase badge + narrative diagnostic     ║
║    KPI strip with phase baseline context                                     ║
║    Insight stream with narrative entries                                      ║
║  User understands: "How's this project today? What phase am I in? Why?"     ║
║  Actions: Click Intelligence link → Stage 4. Click Decisions → Stage 5.    ║
║                                                                              ║
║  ┌────────────────────────────────────────────────────────────────────────┐  ║
║  │ Intelligence Layer Mapping:                                           │  ║
║  │  • Hero metric ← summary-writer (Layer 3b: efficiency analyzer)      │  ║
║  │  • Maturity phase ← maturity-model (Layer 3e)                        │  ║
║  │  • Narrative headline ← narrative-engine (Layer 3d)                   │  ║
║  │  • KPI values ← summary.json (Layer 3b: 4 analyzers)                │  ║
║  │  • Phase baseline ← maturity-assessment (Layer 3e: dimension scores) │  ║
║  │  • Insight stream ← narratives.json + alerts.json (Layer 3d + 3b)   │  ║
║  └────────────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════════════╝
              ↓ (click "Intelligence" in nav)
╔══════════════════════════════════════════════════════════════════════════════╗
║  STAGE 3: LIVE OBSERVATION — LIVE PAGE (§15E)                               ║
║  Screen: /live — Real-time event stream                                     ║
║  Intelligence: SSE raw events, classification metadata [P16]                ║
║  Thesis mapping: ENGINE — raw capture stream with classification overlay    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  User sees: Real-time event feed (git, AI sessions, terminal)               ║
║    P16 addition: Each event shows prompt type badge + feature target         ║
║    P16 addition: Session clusters show chain pattern ("iterative-refinement")║
║  User understands: "What's happening right now? How is each event classified?"║
║  Actions: Click event → Evidence Drawer. Filter by source/project.          ║
║                                                                              ║
║  ┌────────────────────────────────────────────────────────────────────────┐  ║
║  │ Intelligence Layer Mapping:                                           │  ║
║  │  • Raw events ← Layer 1 (Go daemon capture)                          │  ║
║  │  • Prompt type + feature ← Layer 3a (classification pipeline) [P16]  │  ║
║  │  • Chain pattern ← Layer 3a (prompt-chain analyzer) [P16]            │  ║
║  └────────────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════════════╝
              ↓ (click Intelligence in nav)
╔══════════════════════════════════════════════════════════════════════════════╗
║  STAGE 4: INTELLIGENCE EXPLORATION — INTELLIGENCE HUB (§2.6)               ║
║  Screen: /intelligence — 9 tabs (Phase 16 + community-validated)             ║
║  Intelligence: ALL layers contribute to different tabs                       ║
║  Thesis mapping: TRANSMISSION + DIAGNOSTICS — deep analysis + narratives    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  Tab: OVERVIEW → "How well am I using AI?"                                  ║
║    Sees: AES gauge + sub-metrics + maturity badge + narrative diagnostic    ║
║    Layers: 3b (efficiency) + 3e (maturity) + 3d (narrative)                 ║
║    Understands at exit: "My AES is 64, I'm Phase 2, loop resilience is weak"║
║                                                                              ║
║  Tab: MATURITY [P16] → "What phase am I in?"                               ║
║    Sees: Phase gauge + 7-dimension radar + trajectory + bottleneck          ║
║    Layers: 3e (maturity-model) + 3f (maturity-ownership)                    ║
║    Understands at exit: "Phase 2, need loop-resilience >60% for Phase 3"    ║
║                                                                              ║
║  Tab: COMPREHENSION → "Where do I truly understand my code?"                ║
║    Sees: Heatmap + blind spots + expertise overlay [P16: ownership colors]  ║
║    Layers: 3b (comprehension-radar) + 3f (expertise-map via git pipeline)   ║
║    Understands at exit: "Strong in auth, hollow in payments — AI-dependent" ║
║                                                                              ║
║  Tab: VELOCITY → "Am I getting faster?"                                     ║
║    Sees: Trend + domain sparklines + durability + dual velocity [P16]       ║
║    Layers: 3b (velocity-tracker) + 3f (dual-velocity)                       ║
║    Understands at exit: "Faster, decisions stick, 78% AI→git translation"   ║
║                                                                              ║
║  Tab: COST → "Where is my AI budget going?"                                 ║
║    Sees: Spend + by-model + waste + efficiency-survival quadrant [P16]      ║
║    Layers: 3b (cost-attribution) + 3f (efficiency-survival)                 ║
║    Understands at exit: "AI spend produces durable code in auth, not payment"║
║                                                                              ║
║  Tab: PATTERNS & COACH → "What habits to keep or change?"                   ║
║    Sees: Patterns + alerts + replays + narrative prescriptions [P16]        ║
║    Layers: 3b (prompt-patterns, alerts, replays) + 3d (prescriptions)       ║
║    Understands at exit: "Priority: decompose prompts → estimated 15% AES↑" ║
║                                                                              ║
║  Tab: GIT & EXPERTISE [P16] → "How does AI work translate to shipped code?" ║
║    Sees: Commit heatmap + churn + expertise map + AI-git links              ║
║    Layers: 3f (git pipeline: commit, churn, expertise, ai-git-linker)       ║
║    Understands at exit: "78% translation rate, payments is AI-dependent"    ║
║                                                                              ║
║  Tab: NARRATIVES [P16] → "What's the story of my AI collaboration?"        ║
║    Sees: Executive summary + diagnostics + prescriptions + progress         ║
║    Layers: 3d (narrative-engine) + 3e (maturity) + 3c (substrate context)   ║
║    Understands at exit: "Here's a paragraph for my status report"           ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
              ↓ (click Decisions in nav)
╔══════════════════════════════════════════════════════════════════════════════╗
║  STAGE 5: DECISION UNDERSTANDING — DECISIONS PAGE (§15C)                    ║
║  Screen: /decisions — Search + timeline + causal chains                     ║
║  Intelligence: SQLite decisions + semantic substrate [P16]                   ║
║  Thesis mapping: DIAGNOSTICS — understanding why things were built this way ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  User sees: Decision timeline with search, filters, durability badges       ║
║    P16 additions: Causal chain links, revision history, entity context      ║
║  User understands: "Why was this built this way? Does the decision hold?"   ║
║  Actions: Search decisions. Click → Evidence Drawer with full context.      ║
║    P16: Click causal chain → trace decision impact forward/backward         ║
║                                                                              ║
║  ┌────────────────────────────────────────────────────────────────────────┐  ║
║  │ Intelligence Layer Mapping:                                           │  ║
║  │  • Decisions ← SQLite decisions table (Layer 2)                       │  ║
║  │  • Durability ← decision-durability analyzer (Layer 3b)               │  ║
║  │  • Causal chains ← semantic substrate entity→edge traversal (3c) [P16]│  ║
║  │  • Revision history ← decision_edges table (Layer 2) + substrate [P16]│  ║
║  └────────────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════════════╝
              ↓ (click Coach in nav)
╔══════════════════════════════════════════════════════════════════════════════╗
║  STAGE 6: BEHAVIORAL COACHING — COACH PAGE (§15C)                           ║
║  Screen: /coach — Patterns + prescriptions + rules                          ║
║  Intelligence: prompt-patterns + alerts + narratives (prescriptions)         ║
║  Thesis mapping: GUIDANCE — actionable behavioral change recommendations    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  User sees: Effective patterns, anti-patterns, active alerts                ║
║    P16 additions: Narrative prescriptions ranked by priority and impact     ║
║    P16 additions: "Apply" buttons that link to CLAUDE.md rules             ║
║  User understands: "What to do next and why it will help"                   ║
║  Actions: Copy rules to CLAUDE.md. Dismiss alerts. Follow prescriptions.   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
              ↓ (click Profile in nav)
╔══════════════════════════════════════════════════════════════════════════════╗
║  STAGE 7: IDENTITY FORMATION — PROFILE PAGE (§15E)                          ║
║  Screen: /profile — Developer reasoning identity + maturity journey         ║
║  Intelligence: reasoning_model.json + maturity + substrate trajectories     ║
║  Thesis mapping: The fully-tuned vehicle — identity as the end product      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  User sees: Patterns, domains, decision stats, strengths/growth areas       ║
║    P16 additions: Maturity journey timeline (Phase 1→2→3→4 with dates)     ║
║    P16 additions: Learning trajectory curves per capability                  ║
║    P16 additions: Cross-project identity (pattern transfer, growth curves)  ║
║    P16 additions: Narrative self-portrait paragraph                          ║
║  User understands: "Who am I becoming as a developer? Where am I growing?"  ║
║  Actions: Share profile card. Set growth goals. Review trajectory.          ║
║                                                                              ║
║  ┌────────────────────────────────────────────────────────────────────────┐  ║
║  │ Intelligence Layer Mapping:                                           │  ║
║  │  • Patterns/domains ← profile-accumulator (Layer 3b)                  │  ║
║  │  • Maturity journey ← maturity-model history (Layer 3e) [P16]        │  ║
║  │  • Learning trajectories ← substrate computeTrajectories (3c) [P16] │  ║
║  │  • Cross-project ← cross-project analyzer (Layer 3f) [P16]          │  ║
║  │  • Self-portrait ← narrative-engine executive summary (3d) [P16]     │  ║
║  └────────────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**Transmission Thesis alignment through the user flow:**

| Stage | Screen | Thesis Layer | User Progression |
|-------|--------|-------------|-----------------|
| 1 | System Reveal | Engine | "The system is alive and capturing" |
| 2 | Home | Engine + Transmission | "Here are my numbers and my maturity phase" |
| 3 | Live | Engine | "I can see events flowing in real-time with classification" |
| 4 | Intelligence Hub | Transmission + Diagnostics | "Deep analysis: maturity, narratives, costs, expertise" |
| 5 | Decisions | Diagnostics | "Why things were built this way — causal chains" |
| 6 | Coach | Guidance | "What to change and why — prioritized prescriptions" |
| 7 | Profile | The Tuned Vehicle | "Who I am becoming — growth narrative" |

**Progressive revelation principle:** Each stage reveals deeper intelligence. The user is never front-loaded with complexity. Home shows 3 things (number, phase, narrative). Intelligence Hub reveals 8 dimensions. Decisions shows causal chains. Profile shows the full trajectory. At no point does the user need to understand the entire system to derive value.

**5-10 second value test per screen:**
- Home: "AES 64, Phase 2, 'Running rich'" → value in 5 seconds
- Intelligence Overview: "AES gauge + bottleneck indicator" → value in 7 seconds
- Maturity: "Phase 2, loop-resilience is the bottleneck" → value in 6 seconds
- Comprehension: "Auth green (82%), payments red (32%) + expertise overlay shows AI-dependent" → value in 6 seconds
- Velocity: "Accelerating + 78% AI→git translation + decisions sticking" → value in 7 seconds
- Cost: "$12.40 today + efficiency-survival quadrant shows 60% in 'effective-durable'" → value in 8 seconds
- Git & Expertise: "78% AI→commit translation, 3 hot files, auth=deep/payments=AI-dependent" → value in 8 seconds
- Patterns & Coach: "3 effective patterns + 1 prescription: 'decompose prompts → 15% AES↑'" → value in 6 seconds
- Narratives: "Executive summary paragraph, copy for status report" → value in 3 seconds
- Decisions: "Search 'caching' → decision + durability badge + causal chain link" → value in 8 seconds
- Live: "Event stream + 2 active sessions (1 yellow loop risk) + 1 active diagnostic" → value in 5 seconds
- Profile: "Phase 1→2 journey + learning trajectories + growth areas" → value in 10 seconds

---

## 3. Validate: Against Product, Design & Data Integrity Expectations

### 3.1 Product Validation

| Requirement | Phase 7 | Phase 15 | Phase 16 Upgrade | How |
|-------------|---------|----------|-----------------|-----|
| **10-second wow** | Hero metric OR onboarding | Active System Reveal — system comes alive visually in front of user | System Reveal adds Phase D2 (graph building + maturity phase reveal) | Progressive subsystem activation with narrative text + entity count + maturity badge |
| **Project-level views** | Not supported | Project Selector in Live Strip controls all views | Project cards gain maturity phase badges | `?projectId=` on all API calls, maturity-assessment per project |
| **Global views** | Not supported | "All Projects" default shows aggregated data | Global narrative headline + cross-project maturity comparison | Narrative-engine executive summary + maturity-model per project |
| **Cross-project insights** | Impossible | "Similar caching patterns across repos" | Pattern transfer detection + cross-project trajectories + maturity comparison | Semantic substrate cross-project queries + cross-project analyzer |
| **Premium developer tool feel** | Linear-inspired sidebar | + project selector + system reveal + unified intelligence | + maturity gauges + narrative diagnostics + entity relationship visualization | Same design tokens, new component system, vehicle-analogy language |
| **One-screen answers 80%** | Partially — 5 pages | Intelligence Hub answers 80% in one tab set | 9 tabs answer 95%: adds maturity, autonomy, git expertise, narratives | Unified page with htmx tab switching, new Phase 16 tabs |
| **Progressive intelligence reveal** | N/A | N/A | Each screen adds depth: Home (number+phase+narrative) → Hub (8 dimensions) → Decisions (causal chains) → Profile (growth trajectory) | Transmission Thesis mapping: Engine→Transmission→Diagnostics→Guidance |
| **Diagnostic language** | N/A | N/A | Vehicle analogies replace raw metrics: "Running rich" instead of "iteration ratio 0.35" | Narrative-engine 20 templates, zero LLM cost |
| **Maturity awareness** | N/A | N/A | Phase 1-4 visible on every screen (Home badge, Hub tab, Profile journey) | maturity-model 7-dimension scoring |

### 3.2 Data Integrity Validation

| Requirement | Satisfied | Detail |
|-------------|-----------|--------|
| **Every UI element has defined data lineage** | Yes | Section 0 (Data Lineage Atlas) maps every data path from capture to pixel, now including Phase 16 layers (3a-3f). Section 5 documents per-component data contracts. New tabs (Maturity, Git & Expertise, Narratives) have full data lineage specifications |
| **Users understand what they see** | Yes | Every metric includes human-readable interpretation, confidence badge, and freshness indicator. System Reveal teaches the framework. **Phase 16 upgrade:** Vehicle-analogy narratives translate abstract metrics into intuitive language. Maturity phase badge contextualizes all numbers ("Phase 2 expects AES >55"). Prescriptions explain not just "what" but "why" and "what impact" |
| **Data scales across roles** | Yes | Persona-specific framing in Section 5 — same data, different interpretation layer per persona. **Phase 16 upgrade:** Executive summary paragraph in Narratives tab serves executives directly. Maturity phases give a simple framework for non-technical stakeholders. Developers get technical depth (dimension radar, causal chains). The same data powers all three persona levels |
| **Consistent data fetching** | Yes | `window.__unfade.fetch()` auto-injects `projectId`. All intelligence endpoints use `readIntelligenceFile()` pattern. SSE singleton shares state. **Phase 16 upgrade:** New intelligence endpoints (maturity-assessment, narratives, commit-analysis, etc.) follow the same `readIntelligenceFile()` + `jsonOr202()` pattern. Substrate queries via dedicated API endpoints |
| **Cohesive enterprise-grade feel** | Yes | Component library ensures visual consistency. Design tokens enforce brand. Empty states and loading states are handled uniformly. **Phase 16 upgrade:** Vehicle-analogy language creates a consistent voice. Maturity phase badges use a unified visual language across all surfaces |
| **Full intelligence stack surfaced** | Yes (Phase 16) | UI now exposes all 6 intelligence sublayers: classification (Live page badges), DAG analyzers (Intelligence Hub), maturity model (Home + Hub Maturity tab + Profile), narrative synthesis (Home headline + Hub Narratives tab), semantic substrate (Decisions causal chains + Profile trajectories), cross-source (Hub Git & Expertise tab + Velocity dual-velocity + Cost efficiency-survival) |

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
| **Data without interpretation is noise** | Every metric includes: raw value, human-readable label, confidence badge, comparison context, and an action hint where applicable. Enforced by the Five Rules of Data Presentation (Appendix D.2 — rules R-1 through R-5) and the "Aha" Moment Checklist (Appendix D.2) |
| **Phase 16: Intelligence Hub tab overload (9 tabs)** | Tabs are progressive: Overview is always the default landing. Maturity/Autonomy/Narratives show high-signal summaries. Git & Expertise is opt-in for power users. Tab labels are clear and self-explanatory. Mobile: tabs collapse to a dropdown. Autonomy tab addresses the #1 community concern (skill atrophy) — removing it would miss the most validated user need |
| **Phase 16: Vehicle analogy feels gimmicky** | Analogy is used sparingly — narrative diagnostics only, not on every metric. Language is professional ("running rich" not "vroom vroom"). Users who want raw numbers can ignore narrative sections entirely. Executive summary uses formal language |
| **Phase 16: Maturity model feels judgmental** | Phase labels are encouraging ("Discovering" not "Beginner"). Trajectory shows improvement, not just current position. Bottleneck language is constructive ("improve X to advance") not critical ("you're bad at X") |
| **Phase 16: Graph/substrate complexity exposed to users** | Users NEVER see "CozoDB" or "Datalog." They see "connected decisions," "causal chains," and "related patterns." The substrate is invisible infrastructure — users experience it as smart connections between decisions and outcomes |

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
│  │ Phase 2 🔧   │ │ Phase 1 🔑   │ │ -- calibrating│         │  ← Phase 16: Maturity phase per project
│  │ 142 events   │ │ 89 events    │ │ 12 events    │         │
│  │ 3m ago       │ │ 15m ago      │ │ 2h ago       │         │
│  │ [Open →]     │ │ [Open →]     │ │ [Open →]     │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
├──────────────────────────────────────────────────────────────┤
│  GLOBAL NARRATIVE HEADLINE                                     │  ← Phase 16: Executive-level narrative
│  "Across 3 projects: 2 in Phase 2 (Responsive), 1 warming up. │
│   Pattern transfer detected: auth patterns from unfade-cli     │
│   appearing in unerr-cli."                                     │
├──────────────────────────────────────────────────────────────┤
│  GLOBAL INSIGHT STREAM (last 5 cross-project insights)        │
│  3m ago: "unfade-cli: auth module comprehension dropped 12%"  │
│  8m ago: "unerr-cli: similar caching pattern to unfade-cli"   │
│  12m ago: "prescription: reduce iteration loops (saves ~$2/d)" │  ← Phase 16: Narrative prescriptions in stream
└──────────────────────────────────────────────────────────────┘

> **Phase 16 global home upgrade:** Project cards gain a maturity phase badge (Phase 1-4 with icon). A global narrative headline appears between project cards and the insight stream — this gives executives a one-sentence assessment of the AI collaboration posture across projects. The insight stream now includes narrative prescriptions alongside metric-based alerts, creating a unified story feed.
```

**When Project Selector = specific project:**

```
[LIVE STRIP with project selector showing "unfade-cli"]
┌──────────────────────────────────────────────────────────────┐
│  HERO CARD  (Direction Density: 73%)                          │
│  "You steer confidently"                                      │
│  ↑ 8% vs last week · DataFreshnessBadge: "live · 4s ago"    │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ 🔧 Phase 2: Responsive — "Your transmission is engaging" ││  ← Phase 16: Maturity phase badge
│  │ narrative: "High direction density with moderate loop     ││  ← Phase 16: Active diagnostic headline
│  │ resilience — like an engine with strong torque but rough  ││
│  │ gear shifts under load"                                    ││
│  └──────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│  KPI STRIP  (Events 24h · Comprehension · Top Domain · Cost) │
│  [Phase baseline context: "Phase 2 expects AES >55"]          │  ← Phase 16: Maturity baseline context
├──────────────────────────────────────────────────────────────┤
│  TWO-COLUMN: Insight Stream + Quick Actions                   │
│  Insight stream includes narrative entries alongside metrics   │  ← Phase 16: Narrative synthesis entries
└──────────────────────────────────────────────────────────────┘
```

> **Phase 16 home upgrade rationale:** The Home page is the first surface users see repeatedly. Adding the maturity phase badge and narrative headline transforms it from "here are your numbers" to "here is what's happening, why, and what phase of your AI journey you're in." The narrative headline uses the vehicle analogy from the Transmission Thesis — this is where users first encounter the "engine → transmission → diagnostics" language. KPI cards gain phase baseline context so the user knows whether their numbers are good *for their phase*. The insight stream gains narrative entries so it becomes a living story, not just metric alerts.
>
> **Data sources added:** `GET /api/intelligence/maturity-assessment?projectId=` for phase + dimensions, `GET /api/intelligence/narratives?projectId=` for active diagnostic headline.

> **Community-validated upgrade — Vehicle Health Summary Card (replaces raw metrics sidebar):**
> The community research (Section 1.7) identified that users crave **diagnostics, not dashboards**. The project-specific Home view gains a `vehicleHealthSummary()` card positioned between the hero and KPI strip. This card replaces the "here are your numbers" approach with a narrative-first diagnostic:
>
> ```
> ┌──────────────────────────────────────────────────────────────┐
> │  VEHICLE HEALTH SUMMARY                                      │
> │  ┌────────────────────────────────────────────────────────┐  │
> │  │ Phase 2: Responsive    ▰▰▰▰▰▰▱▱▱▱  (55%)             │  │
> │  │ Bottleneck: Loop Resilience (42%)                       │  │
> │  │ ────────────────────────────────────────────────────── │  │
> │  │ Rx: "Reduce iteration loops in auth module —            │  │
> │  │     saves ~$2.10/day in abandoned sessions"             │  │
> │  │ ────────────────────────────────────────────────────── │  │
> │  │ 🔧 3 diagnostics active · 1 prescription pending       │  │
> │  └────────────────────────────────────────────────────────┘  │
> └──────────────────────────────────────────────────────────────┘
> ```
>
> **Data sources:** `maturity-assessment.json` (phase, dimensions, bottleneck), `narratives.json` (active diagnostics + top prescription). **Component:** `vehicleHealthSummary()` in `src/server/components/narrative-card.ts`. **User question answered:** "What's wrong with my setup and what should I fix first?"

> **Community-validated upgrade — Context Leverage Metric (new KPI card):**
> Pain point #2 ("50 First Dates") identified that users can't tell whether their prior reasoning is being reused. Add a 5th KPI card to the project-specific Home KPI strip:
>
> ```
> ┌────────────┐
> │ Context    │
> │ Leverage   │
> │   72%      │  ← "72% of sessions used prior context"
> │ ↑ 8% vs 7d│
> └────────────┘
> ```
>
> **Computation:** `(sessions with source='mcp-active' events) / (total AI sessions in 24h) × 100`. Derived from `events` table: `SELECT COUNT(DISTINCT session_id) FROM events WHERE source = 'mcp-active' AND ts > 24h` ÷ `SELECT COUNT(DISTINCT session_id) FROM events WHERE source IN ('ai-session', 'mcp-active') AND ts > 24h`. **API:** Served via `GET /api/summary?projectId=` (new field: `contextLeveragePct`). **User question answered:** "Is my past reasoning being reused, or am I starting from scratch every session?"

**Clicking a project card in "All Projects" view sets the Project Selector to that project.** No separate `/repos/:id` route needed.

---

#### PAGE: Intelligence Hub (`/intelligence`) — Unified

**Tab navigation (9 tabs — Phase 16 expanded from 5, +1 community-validated):**
```
[Overview] [Maturity] [Autonomy] [Comprehension] [Velocity] [Cost] [Patterns & Coach] [Git & Expertise] [Narratives]
```

Each tab is an htmx partial: `GET /intelligence/tab/:name` returns HTML fragment.

**Overview tab** (default):
- AES gauge (200px SVG ring) + 5 sub-metric cards + trend chart
- **Phase 16 additions:** Maturity phase badge alongside AES gauge (e.g., "Phase 2: Responsive"). Bottleneck indicator below sub-metrics: "Advance to Phase 3 by improving loop-resilience (42%)". Active narrative diagnostic in a callout card below the trend chart: the most relevant vehicle-analogy diagnostic from `narratives.json`.
- **Community-validated addition — Prescription Slot:** Rotating prescription card below AES gauge using `prescriptionCard()` component. Shows top-priority prescription from `narratives.json` with vehicle-analogy diagnostic badge. Example: `"Rx: Your engine is running rich — decompose complex prompts to reduce iteration loops (saves ~$2.10/day)"`. Rotates every 30s if multiple prescriptions active. This transforms the Overview from "here's your score" to "here's your score AND here's what to do about it."
- Project-scoped when selector is set, global aggregate when "All Projects"
- "Compared to your other projects: unfade-cli has 12% higher direction density than average"

> **Overview tab Phase 16 data integration:**
> - `GET /api/intelligence/maturity-assessment?projectId=` → `{ phase, phaseLabel, dimensions: { direction, modificationDepth, contextLeverage, promptEffectiveness, domainConsistency, loopResilience, decisionDurability }, bottleneck, nextPhaseRequirements }`
> - `GET /api/intelligence/narratives?projectId=` → `{ diagnostics: Array<{ id, template, severity, headline, detail }>, prescriptions: Array<{ id, priority, action, estimatedImpact }> }`
> - The Overview tab now answers three questions at once: "How well?" (AES), "What phase?" (maturity), and "What's happening?" (narrative diagnostic)

**Maturity tab** *(Phase 16 addition)*:
- Hero: Phase gauge (1-4 with filled arc showing progression within current phase)
- 7-dimension radar chart: direction, modification-depth, context-leverage, prompt-effectiveness, domain-consistency, loop-resilience, decision-durability
- Trajectory chart: weekly maturity progression over time (sparkline of phase scores)
- Bottleneck cards: which dimensions need improvement to advance
- Requirements panel: specific thresholds for next phase (e.g., "Phase 3 requires loop-resilience >60% and decision-durability >70%")
- Maturity-ownership overlay: "Your maturity in auth (Phase 3) is genuine; in payments (Phase 1) it's hollow — AI-dependent without deep ownership"
- When global: comparative maturity across projects

> **Maturity tab data sources:**
> - `GET /api/intelligence/maturity-assessment?projectId=` → full phase assessment + 7 dimensions + history
> - `GET /api/intelligence/maturity-ownership?projectId=` → genuineness classification per domain
> - **User question answered:** "Where am I on the journey from bare engine to tuned vehicle?" / "What phase is my team at?" (executive)
> - **Action enabled:** Focus effort on bottleneck dimension. Understand which domains have genuine vs hollow maturity. Set targets for phase advancement.

**Autonomy tab** *(Community-validated addition — addresses pain points #3 identity crisis, #4 skill atrophy)*:
- Hero: Independence Index gauge (0-100 composite) — `independenceGauge()` component
  - Weighted composite: HDS 30% + modification rate 25% + alternatives evaluated 20% + comprehension trend direction 25%
- Skill trajectory chart (30-day): line chart showing comprehension, HDS, and modification rate trends over time
  - X-axis: days, Y-axis: normalized scores. Three overlaid lines with legend
  - Answers: "Am I getting better at working with AI, or am I losing skills?"
- Dependency heatmap: per-domain grid showing acceptance rate vs comprehension
  - Red cells = high acceptance + low comprehension (cognitive dependency risk)
  - Green cells = moderate acceptance + high comprehension (healthy collaboration)
  - Answers: "In which domains am I just accepting AI suggestions without understanding?"
- "What You Learned This Week" section: extracted from distill summaries
  - Lists decisions made, trade-offs considered, dead ends explored, new domains touched
  - Evidence-based identity affirmation: "You made 14 architectural decisions, explored 3 dead ends, and expanded into 2 new domains — that's engineering, not prompting"
- When global: comparative independence across projects

> **Autonomy tab data sources:**
> - `GET /api/intelligence/efficiency?projectId=` → `{ direction: { humanDirectionScore }, subScores: { modificationDepth } }`
> - `GET /api/intelligence/comprehension?projectId=` → `{ overall, byModule, trend }`
> - `GET /api/summary?projectId=` → `{ contextLeveragePct }` (new field)
> - `GET /api/distills?projectId=&range=7d` → weekly distill summaries for "What You Learned"
> - `GET /api/intelligence/autonomy?projectId=` → **New endpoint:** `{ independenceIndex, hdsHistory, modificationHistory, comprehensionTrend, dependencyMap, weeklyLearnings }`
> - **User question answered:** "Am I becoming a better engineer through AI, or am I becoming dependent on it?"
> - **Action enabled:** Identify dependency risk domains. Track skill growth over time. Use "What You Learned" evidence in performance reviews and self-assessment. Counter the "just a prompter" narrative with data.
> - **Developer value:** Direct answer to the #1 existential fear in the AI coding community. Evidence-based proof of growth.
> - **Executive value:** "Are our developers growing with AI or atrophying? Which teams need AI coaching intervention?"

**Comprehension tab:**
- Heatmap grid + table toggle
- Blind spot cards (max 3)
- **Phase 16 addition:** Expertise overlay on heatmap — each cell gains an ownership indicator (deep/familiar/ai-dependent from `expertise-map.json`). Files where comprehension is high but expertise is "ai-dependent" are flagged as risk zones.
- When global: shows cross-project heatmap with project color coding

**Velocity tab:**
- Overall trend + per-domain sparklines
- Decision durability metrics
- **Phase 16 addition:** Dual velocity panel — side-by-side comparison of AI velocity (sessions/day, turns-to-acceptance) vs git velocity (commits/day, lines changed). Alignment classification: "AI-heavy" / "balanced" / "git-heavy" / "both-low". Translation efficiency score: "78% of AI sessions resulted in commits within 2 hours."
- Data source: `GET /api/intelligence/dual-velocity?projectId=`

**Cost tab:**
- Hero spend + by-model + by-domain bars + waste
- EstimateBadge on all USD
- **Phase 16 addition:** Efficiency-survival quadrant chart — 2×2 scatter of sessions plotted by AES (x-axis) vs code survival (y-axis, from file churn analysis). Quadrants: effective-durable (green), effective-fragile (yellow), inefficient-durable (blue), inefficient-fragile (red). This answers: "Is my AI spend producing code that lasts?"
- Data source: `GET /api/intelligence/efficiency-survival?projectId=`

**Git & Expertise tab** *(Phase 16 addition)*:
- Commit analysis: frequency heatmap (calendar view), message quality score, average commit size
- File churn hotspots: top 10 most-churned files with churn rate sparklines
- Expertise map: per-file ownership classification (deep/familiar/ai-dependent) with drill-down
- AI-git links: timeline showing temporal correlation between AI sessions and subsequent commits
- Data sources: `commit-analysis.json`, `file-churn.json`, `expertise-map.json`, `ai-git-links.json`
- **User question answered:** "How does my AI coding translate into shipped code?"
- **Executive value:** "Are our developers using AI as a tool that produces lasting contributions, or is it generating throwaway code?"

**Patterns & Coach tab:**
- Effective patterns + anti-patterns (merged from Coach page)
- Active alerts + decision replays (merged from Alerts page)
- "Copy as CLAUDE.md rule" button included
- Alert badge count shown on tab header
- **Phase 16 addition:** Narrative prescriptions section — ranked cards with priority, action description, estimated impact (e.g., "Priority 1: Decompose complex prompts — estimated 15% AES improvement"). Prescriptions sourced from `narratives.json`.

**Narratives tab** *(Phase 16 addition)*:
- Active diagnostics: vehicle-analogy cards explaining current state (e.g., "Running rich — high iteration loops burning token fuel on abandoned sessions")
- Prescriptions: prioritized action cards with estimated impact
- Progress stories: timeline of milestones and transitions (e.g., "Crossed from Phase 1 to Phase 2 on Apr 15 after improving prompt-effectiveness")
- Executive summary: one-paragraph synthesis suitable for status reports, generated without LLM cost
- Cross-session memory: "In the last 7 days, you revisited the caching pattern 3 times — each iteration was 12% more efficient"
- Data sources: `narratives.json`, `maturity-assessment.json`, semantic substrate (entity relationships)
- **User question answered:** "What is the story of my AI collaboration?" / "Give me a paragraph for my status report" (executive)
- **Action enabled:** Use executive summary in team updates. Follow prescriptions to advance maturity. Understand recurring patterns via cross-session memory.

> **Phase 16 RRVV Audit: Substrate Graph Query Surfaces**
>
> The CozoDB semantic substrate (`graph-queries.ts`, `query-power.ts`) provides graph intelligence capabilities that require explicit UI surfaces beyond what the 9 tabs above cover. These surfaces should be integrated as progressive-disclosure drill-throughs, not standalone pages:
>
> 1. **Entity Knowledge Graph (drill-through from any entity mention):** When a user clicks a feature, decision, or pattern name anywhere in the Intelligence Hub, a slide-out drawer shows the entity's graph neighborhood — connected entities, edge types, confidence scores, lifecycle state. Uses `featureKnowledgeGraph()` and `decisionGenealogy()` from `graph-queries.ts`. Data source: `GET /api/substrate/entity/:id/neighborhood`.
>
> 2. **Learning Trajectory Charts (Profile page + Maturity tab):** The `computeTrajectories()` function in `learning-trajectories.ts` produces per-capability linear regression trends (slope, R², trend direction). These should render as sparkline trend charts on the Profile page's capability section and as an "improvement velocity" indicator on the Maturity tab's dimension radar. Data source: `GET /api/substrate/trajectories?projectId=`.
>
> 3. **Topology Insights (Intelligence Hub Overview, progressive disclosure):** Hub entities (high in-degree features) and community clusters from `analyzeTopology()` in `generation-depth.ts` should surface as a "Knowledge Structure" collapsible section at the bottom of the Overview tab — showing "5 hub features connecting 80% of your decisions" with a mini-graph visualization. Data source: `GET /api/substrate/topology?projectId=`.
>
> 4. **Causal Chain Explorer (Decisions page drill-through):** The `inferCausalEdges()` output and `causality.ts` chain data should render as an interactive chain visualization when clicking "Show causal chain" on any decision. Uses P-17 (Causal Chain Visualization) pattern. Data source: `GET /api/substrate/causal-chains?entityId=`.
>
> **Implementation note:** These are all drill-through surfaces accessible via click/expand — they do NOT add navigation items or tabs. They follow the progressive disclosure principle: Level 1 = metric/badge, Level 2 = detail panel, Level 3 = graph exploration drawer. The substrate query cache (`QueryCache` in `query-power.ts`, 5-minute TTL) ensures these don't add latency.

> **Phase 16 RRVV Audit: Real-Time Intelligence Surfaces**
>
> Two Phase 16 capabilities produce real-time intelligence that needs explicit UI surfaces:
>
> 1. **DiagnosticStream Notifications:** `diagnostic-stream.ts` emits live diagnostics (observation/warning/recommendation) with actionable messages and auto-expiry TTLs. These should surface as:
>    - **Live Strip integration:** Active diagnostic count badge next to the event counter (e.g., "2 active diagnostics"). Click expands a dropdown showing top 3 active diagnostics with severity colors and dismiss buttons.
>    - **SSE event type:** New `diagnostic` SSE event type pushes diagnostics to connected clients. Client renders as a toast notification that auto-dismisses after 10s (or pins if actionable).
>    - Data source: `GET /api/intelligence/diagnostics/active` → `{ diagnostics: Diagnostic[], count: number }`.
>    - **User question answered:** "Is anything happening right now that I should know about?"
>
> 2. **Session Intelligence Panel (Live page addition):** `session-intelligence.ts` tracks per-session state (loopRisk 0-1, directionTrend rising/stable/falling, suggestedAction, phaseHistory). The Live page should gain an "Active Sessions" collapsible panel above the event stream showing:
>    - Currently tracked sessions (max 5 shown) with loop risk indicator (green < 0.3, yellow 0.3-0.7, red > 0.7)
>    - Direction trend arrow per session
>    - Suggested action text when loopRisk > 0.5 (e.g., "Consider decomposing this prompt — loop risk is rising")
>    - Data source: `GET /api/intelligence/sessions/active` → `{ sessions: SessionState[], count: number }`.
>    - **User question answered:** "Are any of my current sessions heading into trouble?"

> **Phase 16 RRVV Audit: Cross-Project Intelligence Surface**
>
> `cross-project.ts` produces 4 insight types that need a dedicated surface. This should be a conditional section on the Home page (visible only when Project Selector = "All Projects" AND 2+ projects are registered):
>
> - **Pattern Transfer:** "Your 'decompose complex prompts' pattern works well in unfade-cli (82% effectiveness) but isn't being used in my-saas-app"
> - **Efficiency Gap:** "my-saas-app has 15 points lower AES than unfade-cli — investigating domain differences"
> - **Domain Expertise:** "Your auth velocity is accelerating in unfade-cli but decelerating in my-saas-app"
> - **Methodology Drift:** "Direction scores diverge 35% between projects — different AI collaboration styles emerging"
>
> Rendered as insight cards with confidence badges (P-4 pattern) in the Home page's insight stream when in global view. Data source: `GET /api/intelligence/cross-project` → `{ insights: CrossProjectInsight[], checkedProjects: number }`.
> **User question answered:** "Are my AI collaboration practices consistent across projects? What can I transfer?"

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

> **Phase 16 decisions upgrade:** Each decision card gains:
> - **Durability badge:** "Held 28d" (green) / "Revised ×2" (orange) / "Pending" (gray) — from `decision-durability.json`
> - **Causal chain link:** "This decision → led to pattern X → influenced 3 subsequent sessions" — from semantic substrate entity→edge traversal via `GET /api/intelligence/decision-chains?id=`
> - **Revision history:** When a decision was revised, show the original + revision(s) as a threaded timeline — from `decision_edges` table with `relation = 'revises'`
> - **Entity context:** Which features, files, and patterns this decision is connected to in the semantic graph — from CozoDB `?[feat, rel] := Edge[eid, 'targets', feat], Entity[eid, 'decision', ...]`
>
> This transforms the Decisions page from a flat timeline into a **decision knowledge graph browser** — users can trace the causal impact of any decision forward and backward through the entity graph. The semantic substrate makes this possible without manual annotation.

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

Phase C: MATERIALIZING (first metrics appear)
  Direction density → comprehension → AES fade in one by one

Phase D: INTELLIGENCE WARMING (intelligence engine runs)
  Intelligence cards populate, coach patterns appear
  "First insight: You iterate 2.3x faster on auth code"

Phase D2: GRAPH BUILDING [Phase 16] (~3 minutes after substrate ingestion)
┌──────────────────────────────────────────────────────────────┐
│  Building your knowledge graph...                             │
│                                                               │
│  ● 12 decisions  ● 5 features  ● 3 patterns                 │
│  ↳ Connected: auth decisions → 8 files → 2 patterns          │
│                                                               │
│  Phase 1: Discovering                                         │
│  "Your transmission is engaging"                              │
│                                                               │
│  First narrative: "Strong direction density with room to      │
│  improve loop resilience"                                     │
└──────────────────────────────────────────────────────────────┘

Phase E: LIVE — Full dashboard, overlay dissolves into Home
```

**Implementation:** The reveal is an inline activation section (`<section id="home-activation">`) that sits within the Home page shell (not an overlay). As subsystems come online (via SSE), status dots transition from `waiting` → `building` → `ready`. Phase D2 requires a 5th subsystem row for the semantic substrate ("Knowledge graph") with its own dot. Entity counts populate via `GET /api/substrate/topology`. Maturity phase badge appears via `GET /api/intelligence/maturity-assessment`. After all phases complete, the activation section fades out and a `localStorage` flag (`unfade-activated`) prevents it from showing again. The current `system-reveal.ts` has 4 subsystem rows (SSE, Capture, Materializer, Intelligence) — it needs a 5th row for the graph/substrate phase.

---

### 4.5 Composable Component Library

**File structure:**

```
src/server/components/
├── metric-card.ts        → heroMetricCard(), kpiCard(), kpiStrip()
├── badges.ts             → dataFreshnessBadge(), estimateBadge(), confidenceBadge(), sourceBadge(), projectBadge(), maturityPhaseBadge() [P16]
├── charts.ts             → gaugeSvg(), sparklineSvg(), barChartSvg(), heatmapCell(), trendArrow(), radarChart() [P16], phaseGauge() [P16], quadrantChart() [P16]
├── empty-state.ts        → emptyState()
├── evidence-drawer.ts    → drawerContent(), drawerEventRow()
├── project-selector.ts   → projectSelector(), projectCard()
├── data-table.ts         → dataTable(), sortableHeader()
├── system-reveal.ts      → systemRevealOverlay(), revealPhase()
├── live-strip.ts         → liveStrip() — standalone component (previously inline in layout)
├── tabs.ts               → tabBar(), tabPanel()
├── nav.ts                → sidebarNav(), navItem(), navGroup()
├── narrative-card.ts     → diagnosticCard(), prescriptionCard(), progressMilestone(), executiveSummary() [P16]
├── maturity-viz.ts       → maturityJourney(), dimensionRadar(), bottleneckCard(), ownershipTable() [P16]
├── expertise-viz.ts      → expertiseMap(), churnHeatmap(), aiGitTimeline(), translationRate() [P16]
├── causal-chain.ts       → causalChainViz(), entityContext(), revisionThread() [P16]
├── autonomy-viz.ts       → independenceGauge(), skillTrajectoryChart(), dependencyHeatmap() [15F]
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
| `GET /api/intelligence/maturity-assessment?projectId=` | Home (badge), Intelligence Hub (Maturity tab, Overview badge), Profile (journey) | Yes | Fetch on mount + SSE refresh |
| `GET /api/intelligence/narratives?projectId=` | Home (headline), Intelligence Hub (Narratives tab, Patterns prescriptions), Profile (self-portrait) | Yes | Fetch on mount + SSE refresh |
| `GET /api/intelligence/commit-analysis?projectId=` | Intelligence Hub (Git & Expertise tab) | Yes | Fetch on tab activation |
| `GET /api/intelligence/expertise-map?projectId=` | Intelligence Hub (Comprehension overlay, Git & Expertise tab), Profile (capability map) | Yes | Fetch on tab activation |
| `GET /api/intelligence/efficiency-survival?projectId=` | Intelligence Hub (Cost tab quadrant) | Yes | Fetch on tab activation |
| `GET /api/intelligence/dual-velocity?projectId=` | Intelligence Hub (Velocity tab dual-velocity panel) | Yes | Fetch on tab activation |
| `GET /api/intelligence/maturity-ownership?projectId=` | Intelligence Hub (Maturity tab ownership table) | Yes | Fetch on tab activation |
| `GET /api/intelligence/autonomy?projectId=` | Intelligence Hub (Autonomy tab — independence index, skill trajectory, dependency heatmap, weekly learnings) | Yes | Fetch on tab activation |

### 4.7 API Route Changes Required

| Route | Change | Sprint |
|-------|--------|--------|
| `GET /api/summary` | **15B partial (2026-04):** Accept `?project=` or `?projectId=` (registry repo id). Unknown id → 404. Known id → same global `summary.json` body + `X-Unfade-Metrics-Scope: global` until per-project aggregates land in summary-writer | 15B |
| `GET /api/intelligence/*` (14 endpoints) | Read from `~/.unfade/intelligence/`. Accept `?projectId=` for scoped data | 15B |
| `GET /api/heatmap` | Add `WHERE project_id = ?` to SQLite query when `?projectId=` provided | 15B |
| `GET /api/stream` (SSE) | **Done (2026-04):** push `summary` via `eventBus` from `summary-writer`; `stream.ts` forwards. **`projectId` inside each SSE JSON payload:** partial / follow-up when capture always stamps `project_id` | 15E |
| `GET /api/decisions` | New route: reads SQLite `decisions` table, supports `?projectId=&q=&domain=&source=&period=` | 15C |
| `GET /intelligence/tab/:name` | New route: returns htmx partial for Intelligence Hub tabs | 15C |
| `DELETE /repos/:id` page route | Remove — repo detail page removed (merged into Home) | 15A |
| `GET /api/repos/:id/events` | Keep but read from global events dir filtered by projectId | 15B |
| `GET /api/intelligence/maturity-assessment` | **Phase 16 addition:** Read maturity-assessment.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/narratives` | **Phase 16 addition:** Read narratives.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/commit-analysis` | **Phase 16 addition:** Read commit-analysis.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/expertise-map` | **Phase 16 addition:** Read expertise-map.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/efficiency-survival` | **Phase 16 addition:** Read efficiency-survival.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/maturity-ownership` | **Phase 16 addition:** Read maturity-ownership.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/dual-velocity` | **Phase 16 addition:** Read dual-velocity.json, accept `?projectId=` | 15C+ |
| `GET /intelligence/tab/maturity` | **Phase 16 addition:** htmx partial for Maturity tab | 15C+ |
| `GET /intelligence/tab/git-expertise` | **Phase 16 addition:** htmx partial for Git & Expertise tab | 15C+ |
| `GET /intelligence/tab/narratives` | **Phase 16 addition:** htmx partial for Narratives tab | 15C+ |
| `GET /api/intelligence/file-churn` | **Phase 16 addition:** Read file-churn.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/ai-git-links` | **Phase 16 addition:** Read ai-git-links.json, accept `?projectId=` | 15C+ |
| `GET /api/intelligence/diagnostics/active` | **Phase 16 addition:** Returns active diagnostics from DiagnosticStream ring buffer | 15C+ |
| `GET /api/intelligence/sessions/active` | **Phase 16 addition:** Returns active session intelligence states (loopRisk, directionTrend, suggestedAction) | 15C+ |
| `GET /api/intelligence/cross-project` | **Phase 16 addition:** Returns cross-project insights (pattern-transfer, efficiency-gap, domain-expertise, methodology-drift) | 15C+ |
| `GET /api/substrate/entity/:id/neighborhood` | **Phase 16 addition:** Returns entity graph neighborhood from CozoDB (connected entities, edge types, confidence, lifecycle) | 15C+ |
| `GET /api/substrate/trajectories` | **Phase 16 addition:** Returns learning trajectory data (per-capability slope, R², trend direction) from `learning-trajectories.ts` | 15C+ |
| `GET /api/substrate/topology` | **Phase 16 addition:** Returns topology insights (hubs, bridges, clusters) from `generation-depth.ts` | 15C+ |
| `GET /api/substrate/causal-chains` | **Phase 16 addition:** Returns causal chain data for entity drill-through from `causality.ts` + `generation-depth.ts` | 15C+ |
| `GET /api/intelligence/autonomy` | **Sprint 15F (spec):** Independence Index + breakdown — **not implemented** (2026-04 audit) | 15F |
| `GET /intelligence/tab/autonomy` | **Sprint 15F (spec):** Autonomy htmx partial — **not implemented** | 15F |

---

## 5. Implementation Plan: Annotated Sprints 15H, 15A–15G

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

### Sprint 15H — UI Architecture Hardening (Foundation Sprint)

**Objective:** Eliminate external CDN dependencies, bundle all assets locally, and establish the infrastructure for hybrid React islands. This sprint is a **prerequisite** to all other UI sprints — it fixes foundational performance and reliability issues that every subsequent page build inherits.

**Why first:** Every page in Sprints 15A–15G renders through `layout.ts`, which currently loads Tailwind CSS JIT compiler (~300KB), htmx, and Google Fonts from external CDNs. Building 15A–15G on this foundation means every page suffers from CDN latency, offline breakage, and the 300KB Tailwind JIT penalty. Fixing the foundation first means every subsequent sprint benefits automatically.

**Acid test:**
```bash
pnpm build && pnpm test && \
  # Verify no external CDN scripts in rendered HTML
  curl -s http://localhost:7654/ | grep -vq 'cdn.tailwindcss.com' && \
  curl -s http://localhost:7654/ | grep -vq 'unpkg.com/htmx' && \
  curl -s http://localhost:7654/ | grep -vq 'fonts.googleapis.com' && \
  # Verify local assets load
  curl -s http://localhost:7654/public/css/tailwind.css | head -1 | grep -q '{' && \
  curl -s http://localhost:7654/public/js/htmx.min.js | head -1 | grep -q 'htmx' && \
  # Verify SSE is true push (no mtime polling)
  grep -rq 'statSync' src/server/routes/stream.ts && echo "FAIL: mtime polling" || echo "PASS" && \
  echo "PASS: UI architecture hardened"
```

| ID | Status | Task | Description | Files |
|----|--------|------|-------------|-------|
| **UF-470** | [x] COMPLETE | Replace Tailwind CDN with local pre-compiled CSS | Remove `<script src="https://cdn.tailwindcss.com">` from layout.ts. Install `tailwindcss` as a dev dependency. Create `tailwind.config.ts` scanning `src/server/**/*.ts` for class usage. Add `pnpm build:css` script that generates `public/css/tailwind.css` (pre-compiled, ~15-30KB gzipped vs 300KB JIT). Update layout.ts to `<link rel="stylesheet" href="/public/css/tailwind.css">`. Integrate into `pnpm build` pipeline. **Impact:** eliminates ~300KB client-side JIT compilation on every page load — likely the #1 cause of slow page renders | `src/server/pages/layout.ts`, `tailwind.config.ts`, `package.json`, `public/css/tailwind.css` |
| **UF-471** | [x] COMPLETE | Bundle htmx locally | Remove `<script src="https://unpkg.com/htmx.org@2.0.4">` from layout.ts. Copy `htmx.min.js` to `public/js/htmx.min.js` (or install `htmx.org` as dependency and copy from `node_modules`). Update layout.ts to `<script src="/public/js/htmx.min.js">`. Add cache-busting hash to filename or query param | `src/server/pages/layout.ts`, `public/js/htmx.min.js` |
| **UF-472** | [x] COMPLETE | Self-host Google Fonts | Remove `<link href="https://fonts.googleapis.com/css2?...">` from layout.ts. Download Space Grotesk, Inter, JetBrains Mono as WOFF2 files to `public/fonts/`. Create local `@font-face` declarations in the Tailwind CSS or a separate `fonts.css`. Eliminates DNS lookup + CORS + Google tracking on every page load | `src/server/pages/layout.ts`, `public/fonts/*.woff2`, `public/css/fonts.css` |
| **UF-473** | [x] COMPLETE | Replace mtime-polling SSE with true push | Current `stream.ts` polls `summary.json` mtime every 2 seconds via `statSync`. Replace with an in-process event emitter: materializer emits events → SSE handler pushes to connected clients. Eliminates 2s latency floor and unnecessary filesystem polling. Use Node.js `EventEmitter` or `BroadcastChannel` — no external dependency needed | `src/server/routes/stream.ts`, `src/services/cache/materializer.ts` |
| **UF-474** | [x] COMPLETE | Eliminate synchronous file reads from request path | `home.ts` calls `readFileSync(setupPath)` and `readSummary()` (which reads `summary.json` synchronously) on every HTTP request. Convert to async reads or cache summary in memory (updated by materializer event). Prevents request-path I/O blocking under concurrent requests | `src/server/pages/home.ts`, `src/server/routes/*.ts` |
| **UF-475** | [x] COMPLETE | Create shared client-side state module | Currently each page/tab has its own inline `<script>` IIFE that independently fetches data and manually manipulates DOM. Create a lightweight shared module (`public/js/unfade-core.js`) that provides: (a) project context from `window.__unfade.projectId`, (b) shared fetch wrapper with error handling, (c) SSE event subscription, (d) simple pub/sub for cross-tab state sync. Keep it vanilla JS — no framework dependency. Pages import via `<script type="module">` | `public/js/unfade-core.js`, `src/server/pages/layout.ts` |
| **UF-476** | [x] COMPLETE | React islands infrastructure | Since `react@19.2.5` is already in `package.json` (used for Satori), add `react-dom` for client-side hydration. Create `public/js/islands/` directory structure. Build a minimal island mount helper: `mountIsland(containerId, Component, props)` that hydrates a React component into a server-rendered `<div id="...">`. This is infrastructure only — no pages converted yet. Pages that need interactivity (graph exploration, real-time panels) will use this in 15G | `package.json`, `public/js/islands/mount.js`, `src/server/components/island-container.ts` |
| **UF-477** | [x] COMPLETE | Add `Cache-Control` headers for static assets | Currently no caching headers on `/public/*`. Add `Cache-Control: public, max-age=31536000, immutable` for hashed assets (CSS, JS, fonts) and `Cache-Control: no-cache` for HTML pages. Prevents redundant re-downloads of unchanged assets on navigation | `src/server/http.ts` |
| **UF-478** | [x] COMPLETE | Build pipeline integration | Ensure `pnpm build` runs: (1) TypeScript compilation, (2) Tailwind CSS compilation, (3) htmx copy, (4) font copy — in correct order. Add `pnpm build:assets` script for CSS + static assets. Update `.gitignore` for generated CSS. Verify `pnpm dev` watches both TS and CSS changes | `package.json`, `.gitignore` |

---

### Sprint 15A — Component System + Navigation Restructure

**Objective:** Write the composable component library from scratch. Build the 4-layer navigation model. Delete Portfolio and Repo Detail pages (their functionality is replaced by the new Home page in Sprint 15B).

**Acid test:**
```bash
pnpm build && pnpm test && \
  curl -s http://localhost:7654/ | grep -q 'project-filter' && \
  curl -s http://localhost:7654/ | grep -q 'Observe' && \
  echo "PASS: Component system + new nav"
```
*(Live strip `<select>` uses `id="project-filter"` in `layout.ts`; grep `project-selector` would false-fail.)*

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-400** | Create component library | **[x] COMPLETE** — created 9 component files in `src/server/components/`: `metric-card.ts` (heroMetricCard, kpiCard, kpiStrip), `badges.ts` (dataFreshnessBadge, estimateBadge, confidenceBadge, sourceBadge, projectBadge), `charts.ts` (gaugeSvg, sparklineSvg, barChartSvg, heatmapCell, trendArrow), `empty-state.ts` (emptyState), `tabs.ts` (tabBar, tabPanel), `nav.ts` (navItem, navGroup, sidebarNav), `project-selector.ts` (projectSelector, projectCard), `system-reveal.ts` (activationSection — inline activation panel, not overlay). Plus `index.ts` re-exports. 18+ exported pure functions, all typed interfaces, zero dependencies. **Verified 2026-04-22:** all implementations are real HTML/SVG generators with correct typing, zero TODOs. **Tracker 2026-04-23:** consolidated `test/server/components/components.test.ts` holds **37** `it()` blocks covering every chart export (`barChartSvg`), `tabPanel`, `navItem` / `navGroup` / `sidebarNav`, and `activationSection` | `src/server/components/*.ts` |
| **UF-401** | Update `layout.ts` navigation | **[x] COMPLETE** — restructured from flat 15-item nav (7 primary + 8 secondary) to 4-layer model: Observe (Home, **Projects**, Live, Distill), Understand (Intelligence, Decisions, Coach), Identity (Profile, Cards), System (Integrations, Logs — collapsed by default). Portfolio and Search removed from sidebar; Decisions is first-class. Live strip: `<select id="project-filter">` + `window.__unfade.setProject`. **`http.ts`:** removed `portfolioPage` / `repoDetailPage`; `GET /portfolio` → `/`; `GET /search` → `/decisions`; `GET /repos/:id` → `/?project=<id>`. **⚠ Sprint 15H modifies layout.ts further:** removes CDN script/link tags (UF-470/471/472), replaces with local asset references, adds React island mount script (UF-476) | `src/server/pages/layout.ts`, `src/server/http.ts` |
| **UF-402** | Route restructure for new pages | **[x] COMPLETE** — existing pages preserved and functional. Portfolio route redirects to `/`. `/repos/:id` redirects to `/?project=<id>` (merged into Home). `/decisions` is a real page (Sprint 15C). `/search` redirects to `/decisions`. Phase 7 standalone intelligence pages (`/efficiency`, `/cost`, `/coach`, `/velocity`, `/alerts`, `/comprehension`) redirect to Intelligence Hub tabs. 3 test assertions updated for new nav structure. **Verified 2026-04-22:** all redirects confirmed in `http.ts` | `src/server/http.ts`, `test/server/pages/*.test.ts` |
| **UF-403** | Shared client-side module | **[x] COMPLETE** — `window.__unfade` object in layout provides: SSE singleton (`.initSSE()` called once, callbacks via `.onSummary[]`, `.onEvent[]`, `.onHealth[]`), project context (`.projectId` from localStorage), API helper (`.fetch(path)` auto-injects `?project=`), project switcher (`.setProject(id)` updates localStorage + reloads). Project selector populated dynamically from `/api/repos` on page load. **⚠ Sprint 15H UF-475 extracts this into `public/js/unfade-core.js`** — a standalone module replacing the inline `<script>` block. Adds pub/sub for cross-tab state sync and standardized error handling | `src/server/pages/layout.ts` |

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
| **Data consumed** | Manages singleton `EventSource('/api/stream')`. Provides `fetch(path)` that auto-injects `?project=` when a project is selected (see `public/js/unfade-core.js`) |
| **Data lineage** | SSE stream: summary-writer atomically updates `summary.json` → **`eventBus.emitBus({ type: 'summary' })`** → `stream.ts` listener → SSE `summary` event → browser (`unfade-core.js`). No mtime polling loop on `summary.json` |
| **Presentation** | No visual rendering — shared data layer. Pages register callbacks |
| **User question answered** | N/A — infrastructure |
| **Action enabled** | Consistent data across all pages. Project switching works everywhere automatically |

---

### Sprint 15B — Project Selector + Global Data Views

**Objective:** Project selector is functional. Home shows global portfolio view when "All Projects" selected. Client and tab routes use `?project=` (alias `?projectId=` on `GET /api/summary` only). Per-project **metric** filtering depends on `project_id` rollups in the materializer/analyzers (ongoing); until then APIs remain honest about global scope.

**Acid test (tracker-aligned, 2026-04):**
```bash
curl -sf "http://localhost:7654/api/summary" | jq -e '.schemaVersion' >/dev/null && \
  curl -sf "http://localhost:7654/" | grep -q 'All Projects' && \
  echo "PASS: summary + live strip selector present"
# Optional — use a real registry id; expect 200 + X-Unfade-Metrics-Scope: global until per-project summaries exist:
# curl -sI "http://localhost:7654/api/summary?project=<repo-id>" | grep -i X-Unfade-Metrics-Scope
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-404** | Implement `projectSelector()` component | **[x] COMPLETE** — `src/server/components/project-selector.ts` exports `projectSelector()` and `projectCard()` for SSR fragments/tests. **Live UI:** Live strip `#project-filter` in `layout.ts` is populated by `public/js/unfade-core.js` (`initProjectSelector` → `GET /api/repos`). Exports wired in `components/index.ts` | `src/server/components/project-selector.ts`, `src/server/components/index.ts`, `src/server/pages/layout.ts`, `public/js/unfade-core.js` |
| **UF-405** | Home: dual-mode rendering | **[ ] PENDING** — **Spec not implemented in `home.ts`.** Current Home is **activation vs dashboard** (`#home-root` / `.home-layer-act` / `.home-layer-dash`). **Portfolio / multi-repo management** is the dedicated **`/projects`** page (`src/server/pages/projects.ts`). Next step: either merge portfolio KPIs/cards into Home behind a single toggle **or** keep `/projects` as the canonical portfolio surface and revise this row to "superseded by `/projects`" (pick one path — no duplicate portfolio UIs) | `src/server/pages/home.ts`, `src/server/pages/projects.ts` |
| **UF-406** | API routes: `?project=` support | **[~] PARTIAL** — **`GET /api/summary`:** accepts `project` or `projectId`; unknown id → **404**; known id → same body as global `~/.unfade/state/summary.json` with headers **`X-Unfade-Metrics-Scope: global`** and **`X-Unfade-Requested-Project-Id`** (metrics not yet per-repo). **`GET /api/repos`:** one `readSummary()` for all rows (global snapshot). **Intelligence tab partials** forward `project` into `fetch('/api/intelligence/...')`. Endpoints that ignore `project` today should be extended when DuckDB/SQLite queries gain consistent `project_id` filters | `src/server/routes/summary.ts`, `src/server/routes/repos.ts`, `src/server/routes/intelligence-tabs.ts` |
| **UF-407** | SSE: project context | **[x] COMPLETE** — `public/js/unfade-core.js`: singleton `EventSource('/api/stream')`, `projectId` + `localStorage`, `setProject` (syncs `?project=` in URL), `fetch()` appends `?project=` when a project is selected. Layout provides `#project-filter` | `public/js/unfade-core.js`, `src/server/pages/layout.ts` |

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

**Tracker status (2026-04-23):** UF-408–UF-411 **[x] COMPLETE** in tree; T-411–T-414 covered by new Vitest files below.

**Objective:** Merge Intelligence, Cost, Comprehension, Velocity, Coach, Alerts into Intelligence Hub with htmx tabs. Create Decisions page (replaces Search). Remove 5 standalone pages.

**Acid test (2026-04):**
```bash
curl -s http://localhost:7654/intelligence | grep -q 'id="tab-comprehension"' && \
  curl -s "http://localhost:7654/intelligence/tab/cost" | grep -q 'estimate' && \
  curl -s http://localhost:7654/decisions | grep -q 'dec-search' && \
  echo "PASS: Intelligence Hub + Decisions"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-408** | Intelligence Hub page | **[x] COMPLETE** — `intelligence.ts`: five-tab shell (`tab-*` ids for verification). **Overview** is a full navigation `<a href="/intelligence?tab=overview">` (avoids injecting a full-page redirect into `#tab-content`). **Other tabs** use htmx `hx-get="/intelligence/tab/<name>"` + `hx-push-url`. Overview AES block uses `window.__unfade.fetch('/api/intelligence/efficiency')` when present so `?project=` matches live strip. Title: "Intelligence Hub" | `src/server/pages/intelligence.ts` |
| **UF-409** | Intelligence Hub tab routes | **[x] COMPLETE** — `intelligence-tabs.ts`: partials for comprehension, velocity, cost, patterns; `/intelligence/tab/overview` returns **302** to `/intelligence?tab=overview` (legacy htmx path; primary UX uses the Overview `<a>`). Partials append `project` to API fetches where applicable | `src/server/routes/intelligence-tabs.ts` |
| **UF-410** | Decisions page | **[x] COMPLETE** — `decisions.ts`: search (`#dec-search`, debounced 300ms), period (`7d`/`30d`/`90d`), optional **domain** `<select>` (options rebuilt when viewing **All**). `loadDecisions()` uses `window.__unfade.fetch` for `/unfade/decisions` so `project` query is injected consistently. **Scope badge** (`#dec-scope-badge`): "All projects" vs `Project: <id>`. **API:** `GET /unfade/decisions` supports `q`, `period`, `domain`, `project` (project reserved for future path scoping; list remains global distill/graph). **Removed** non-functional Git/AI/Terminal source chips (no capture-sourced decision rows yet). HTML escaping for user-visible distill strings | `src/server/pages/decisions.ts`, `src/server/routes/decisions.ts`, `src/tools/unfade-decisions.ts`, `src/schemas/mcp.ts` |
| **UF-411** | Remove standalone pages | **[x] COMPLETE** — `http.ts`: standalone Phase-7 intelligence/search routes removed; **302** redirects from `/efficiency`, `/cost`, `/coach`, `/velocity`, `/alerts`, `/comprehension`, `/search` → Intelligence Hub tabs or `/decisions`. `intelligenceTabRoutes` + `decisionsPage` registered | `src/server/http.ts`, `test/server/pages/search.test.ts`, `test/services/distill/personalized-search.test.ts` |

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

##### Maturity Tab (`?tab=maturity`) — Phase 16 Addition

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/intelligence/maturity-assessment?projectId=` → `{ phase: 1-4, phaseLabel: string, overallScore: number, dimensions: { direction: { score, trend, history }, modificationDepth, contextLeverage, promptEffectiveness, domainConsistency, loopResilience, decisionDurability }, bottleneck: { dimension, score, nextPhaseThreshold }, trajectory: Array<{ date, phase, score }>, phaseTransitions: Array<{ from, to, date }> }`. (2) `GET /api/intelligence/maturity-ownership?projectId=` → `{ byDomain: Record<string, { phase, genuineness: 'genuine'|'mixed'|'hollow', expertiseScore, maturityScore }>, riskAreas: Array<{ domain, reason }> }` |
| **Data lineage** | maturity-model analyzer → evaluates 7 dimensions from incremental analyzer outputs (efficiency.aes, velocity.turnsToAcceptance, comprehension.overall, etc.) → Bayesian-smoothed dimension scores → phase determination (Phase 1: ≤35, Phase 2: 36-55, Phase 3: 56-75, Phase 4: >75) → maturity-ownership cross-analyzer fuses with expertise-map to classify genuineness |
| **Transformation** | 7 raw dimension values → Bayesian smoothing (handles low data) → weighted composite → phase classification → Mann-Kendall trend on history → bottleneck = lowest dimension relative to next phase thresholds → genuineness = expertise ownership vs maturity level |
| **Presentation** | **Phase Gauge** — 4-segment arc (like a car dashboard) with filled portion showing current phase + progress within phase. Phase labels: "1: Discovering", "2: Responsive", "3: Fluent", "4: Masterful". **Radar Chart** — 7-axis SVG showing dimension scores, with area fill. Weakest dimension highlighted in red. **Trajectory Sparkline** — weekly phase score over last 30 days. Phase transitions marked with milestone dots. **Bottleneck Card** — "Advance to Phase 3 by improving loop-resilience from 42% to >60%". **Ownership Table** — per-domain rows: domain, phase, genuineness badge (green genuine / yellow mixed / red hollow), risk flag |
| **User question answered** | "Where am I on the AI collaboration maturity journey? What's holding me back? Is my expertise genuine or am I over-relying on AI?" |
| **Developer value** | Self-assessment: "I'm Phase 2 (Responsive) overall but Phase 3 in auth and Phase 1 in payments. My loop-resilience is the bottleneck — I need to stop iterating on abandoned approaches." The radar chart reveals specific strengths and weaknesses. Genuineness flags prevent false confidence: "My 85% comprehension in payments is hollow — I'm accepting AI suggestions without deep understanding" |
| **Executive value** | Team maturity distribution: "40% at Phase 2, 35% at Phase 3, 25% at Phase 1." Investment ROI: "After 3 months, average maturity improved from 1.8 to 2.6." Risk identification: "Two engineers have hollow maturity in the payments domain — needs code review process change." The 4-phase model gives executives a simple, defensible framework |

---

##### Git & Expertise Tab (`?tab=git-expertise`) — Phase 16 Addition

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/intelligence/commit-analysis?projectId=` → `{ frequency: { daily: number[], weekly: number[] }, messageQuality: { avgScore, distribution }, sizeDistribution: { small, medium, large, percentages }, branchPatterns: Record<string, { commits, lifespan }>, commitVelocity: { daily, trend } }`. (2) `GET /api/intelligence/file-churn?projectId=` → `{ hotFiles: Array<{ path, churnRate, changeCount, lastModified }>, churnHeatmap: Array<{ path, day, changes }> }`. (3) `GET /api/intelligence/expertise-map?projectId=` → `{ byFile: Record<string, { ownership: 'deep'|'familiar'|'ai-dependent', expertiseScore, aiSessionCount, gitCommitCount }> }`. (4) `GET /api/intelligence/ai-git-links?projectId=` → `{ links: Array<{ sessionId, commitHash, timeDelta, filesOverlap }>, translationRate: number }` |
| **Data lineage** | git-commit-analyzer → git log parsing → commit frequency, size, message quality. git-file-churn → git log --stat → per-file change frequency. git-expertise-map → fuses git commit authorship + AI session file references → ownership classification. ai-git-linker → temporal correlation of AI sessions with subsequent commits (window: 2h) |
| **Transformation** | Git log → structured commit data → frequency/size distributions. AI sessions + commits → temporal overlap → link detection. Per-file: git contributions / total touches → ownership ratio → classification thresholds (deep: >70% manual, familiar: 30-70%, ai-dependent: <30%) |
| **Presentation** | **Commit Calendar** — GitHub-style contribution calendar heatmap (365 days). **Message Quality** — hero metric with score distribution. **File Churn Heatmap** — treemap or list of hottest files with churn sparklines. **Expertise Map** — directory tree with color-coded ownership (green deep, yellow familiar, red ai-dependent). Click file → detail panel with commit history + AI session references. **AI-Git Timeline** — paired timeline: AI sessions (top) and commits (bottom), lines connecting correlated pairs. Translation rate hero metric. |
| **User question answered** | "How does my AI coding translate to actual shipped code? Where do I own the code vs rely on AI?" |
| **Developer value** | "My AI sessions produce commits 78% of the time within 2 hours — good translation. But the payments module is entirely AI-dependent — I need to understand it better." File churn reveals which areas are unstable. Expertise map reveals true ownership |
| **Executive value** | "Team ships 82% of AI-assisted work within 2 hours. 15% of codebase is AI-dependent — potential bus factor risk." File churn in critical paths = stability concern. Expertise gaps inform pair programming, code reviews, and hiring |

---

##### Narratives Tab (`?tab=narratives`) — Phase 16 Addition

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | (1) `GET /api/intelligence/narratives?projectId=` → `{ diagnostics: Array<{ id, template, severity: 'info'|'warning'|'critical', headline, detail, timestamp }>, prescriptions: Array<{ id, priority: number, action, estimatedImpact, relatedDiagnostic }>, progress: Array<{ id, milestone, description, achievedAt }>, executiveSummary: string }`. (2) `GET /api/intelligence/maturity-assessment?projectId=` → phase context for narrative framing |
| **Data lineage** | narrative-engine analyzer → reads from maturity-assessment, efficiency, loop-detector, velocity, cost-attribution, comprehension, cross-source outputs → applies 20 template rules → produces diagnostics (10 types: engine-problems, oil-change, misaligned, running-rich, redlining, rough-gear-shifts, etc.), prescriptions (6 types), progress (4 types). Zero LLM cost — all template-driven. Executive summary = structured concatenation of top diagnostic + maturity phase + key metric + top prescription |
| **Transformation** | Intelligence analyzer outputs → template rule matching (condition functions evaluate thresholds) → narrative generation with slot-filling from actual data → priority ranking → executive summary synthesis |
| **Presentation** | **Executive Summary Card** — prominent callout at top: "Phase 2 Responsive. Direction density strong at 73%. Loop resilience needs attention — 3 abandoned iteration cycles this week. Priority: decompose complex prompts before engaging AI." Copy button for status reports. **Diagnostics Section** — cards with vehicle-analogy icons (wrench, gauge, warning). Severity-colored borders. Each card: headline + detail paragraph + related metrics. **Prescriptions Section** — numbered priority cards. Each: action description + estimated impact badge + "Apply" button (links to relevant Coach rule or Intelligence tab). **Progress Timeline** — milestones with dates and descriptions, connecting into a narrative arc. "Apr 15: Crossed to Phase 2", "Apr 18: Loop resilience improved 15%", "Apr 21: First cross-project pattern transfer" |
| **User question answered** | "What is the story of my AI collaboration? Give me something I can share with my team." |
| **Developer value** | "Running rich" is immediately understandable — more so than "iteration ratio: 0.35 with context overhead: 0.62." The vehicle analogy translates abstract metrics into actionable intuition. Prescriptions tell you exactly what to do next. Progress timeline gives a sense of journey |
| **Executive value** | Executive summary is the single most valuable output for non-technical stakeholders: a ready-made paragraph for weekly updates, performance reviews, or board presentations. No interpretation needed — the system tells the story |

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

**Tracker status (2026-04-23):** UF-412–UF-414 **[x] COMPLETE** as **inline activation** (not a `fixed inset-0` overlay). Long-form phase tables below remain the **target narrative**; Phase D2 / substrate lines are Phase 16.

**Objective:** First-run experience that progressively reveals each subsystem **inside the Home shell** — activation layer vs dashboard layer (`home-mode-activation` / `home-mode-dashboard`), same global layout as the rest of the app.

**Acid test:**
```bash
curl -s http://localhost:7654/ | grep -q 'id="home-activation"' && \
  curl -s http://localhost:7654/ | grep -q 'unfade-activation-seen' && \
  echo "PASS: Inline system activation present"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-412** | System Reveal component | **[x] COMPLETE** — `src/server/components/system-reveal.ts` exports **`activationSection()`** (inline `<section id="home-activation">`, not `systemRevealOverlay`). Includes: four subsystem rows (real-time / capture / materializer / intelligence) with `ua-dot` states, captured-events panel (`#ha-events`), progress bar toward first insights, optional **Early signals** metrics grid (`#ha-metrics`), **Skip to dashboard** (`#ha-skip`). **No** full-screen overlay (`fixed inset-0` absent). Exported from `components/index.ts` | `src/server/components/system-reveal.ts`, `src/server/components/index.ts` |
| **UF-413** | Integrate with Home | **[x] COMPLETE** — `home.ts` renders `activationSection()` inside `.home-layer-act`; server picks `home-mode-activation` vs `home-mode-dashboard` from summary warmth + setup grace window. Client **`transitionToDashboard()`** toggles classes on `#home-root`; persistence via **`localStorage['unfade-activation-seen']`** plus session id key to reset on new `setup-status` session | `src/server/pages/home.ts` |
| **UF-414** | SSE subsystem events | **[x] COMPLETE** — **`home.ts`** inline script registers `window.__unfade.onHealth`, `onSummary`, `onEvent` to drive activation dots, event feed, progress, and early metrics (direction %, comprehension, events 24h). Uses live **`summary.json`** fields from SSE payloads (same lineage as dashboard). Auto-transition toward dashboard when thresholds / `firstRunComplete` satisfied; skip remains user-controlled | `src/server/pages/home.ts` |

#### 15D — System Reveal Phase-by-Phase Data Contracts

---

##### Phase A — CONNECTING (0-5 seconds)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `subsystem` events: `{ subsystem: 'daemon'|'materializer'|'intelligence'|'sse', status: 'starting'|'ready'|'error' }`. Initial `health` event with current system state |
| **Data lineage** | Server emits during startup: HTTP bind → SSE ready, Go daemon spawn → daemon starting/ready, materializer loop start → ready, first intelligence tick → ready |
| **Presentation** | **Shipped (15D):** inline activation panel inside Home (`#home-activation`, `ua-dot` rows). **Spec option:** full-screen overlay (`position:fixed; inset:0; z-50`) — not the current build. Subsystem rows: ○ (waiting) → pulse (starting) → ● green (ready) → ● red (error) |
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
| **Data lineage** | Intelligence engine runs 25 DAG-scheduled IncrementalAnalyzers (Phase 16 upgrade from 8 monolithic analyzers). Each writes to `~/.unfade/intelligence/<file>.json`. Substrate entities ingested into CozoDB graph. Some need ≥5 data points |
| **Presentation** | Intelligence cards populate one by one. First insight highlighted: "First insight: You iterate 2.3x faster on auth than payments." Overlay fully dissolved. "calibrating..." on analyzers still waiting for data |
| **User question answered** | "What has Unfade learned about me?" |
| **Developer value** | First actionable intelligence from passive observation |
| **Executive value** | "After 2 minutes, Unfade identified where the team needs training" |

---

##### Phase D2 — GRAPH BUILDING (Phase 16 addition, ~3 minutes)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `substrate` events: `{ entityCount, edgeCount, maturityPhase, firstNarrative }`. Triggered when substrate engine completes first ingestion cycle and first narrative is synthesized |
| **Data lineage** | Intelligence engine's `contributeEntities()` → substrate-engine CozoDB ingestion → propagation rules run → maturity-model evaluates → narrative-engine synthesizes first diagnostic. Entity count = work-units + decisions + features + patterns from analyzer outputs. Maturity phase from dimension evaluation. Narrative from template matching |
| **Presentation** | Entity count animates in: "12 decisions, 5 features, 3 patterns identified". First causal link visualized as a simple node→edge→node mini-diagram. Maturity phase reveals with vehicle-analogy: "Phase 1: Discovering — your transmission is engaging." First narrative diagnostic appears in a subtle callout |
| **User question answered** | "How does Unfade understand relationships, not just numbers?" |
| **Developer value** | Understanding that the system tracks causal connections between decisions, features, and patterns — not just isolated metrics. The graph is visible, the relationships are real |
| **Executive value** | "Within 3 minutes, Unfade built a knowledge graph of the team's AI decisions." Enterprise-grade capability demonstration |

---

##### Phase E — LIVE (steady state)

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | Full dashboard mode. All APIs return live data. Intelligence refreshes per materializer tick (~5-10s). Substrate updates per propagation cycle |
| **Data lineage** | Continuous loop: daemon captures → materializer ingests → classification → DAG-scheduled analyzers → substrate entity ingestion → propagation → narrative synthesis → summary updates → SSE pushes → DOM updates. Typical action-to-dashboard latency: 5-15s |
| **Presentation** | Dashboard layer shown (`home-mode-dashboard`). `localStorage('unfade-activation-seen')` set when user completes or skips activation. Live strip continues to show freshness from SSE |
| **User question answered** | All questions — full tool access |
| **Developer value** | Context from the reveal means they understand every number. Much better than landing on unexplained dashboard |
| **Executive value** | Professional onboarding: "Nobody needed training — the system revealed itself" |

---

### Sprint 15E — Event-Driven SSE + Polish + Cleanup

**Tracker status (2026-04-23):** UF-415–UF-418 **[x] COMPLETE** for **push-based summary SSE** (`eventBus` + `stream.ts` + `summary-writer`), **Vitest coverage** for stream + responsive shells, and **layout/CSS** polish. There is **no** separate `src/server/sse-hub.ts` — transport lives in **`stream.ts`**. **T-420** remains the CI umbrella (not a single file).

**Objective:** Event-driven SSE (no hot-loop mtime polling on `summary.json`). Responsive polish. Dead page removal. Automated verification of the above.

**Acid test:**
```bash
pnpm exec vitest run test/server/routes/stream.test.ts test/server/pages/responsive.test.ts && \
  echo "PASS: SSE transport + responsive shell tests"
# Full gate (T-420): pnpm build && pnpm test && pnpm typecheck && pnpm lint
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-415** | SSE Hub | **[x] COMPLETE** — **Client:** `public/js/unfade-core.js` singleton `EventSource('/api/stream')`, `onSummary` / `onEvent` / `onHealth` / `onIntelligence` arrays; loaded from `layout.ts`. **Server:** `src/server/routes/stream.ts` subscribes **`eventBus.onBus`** and forwards `summary` / `event` / `intelligence` bus payloads over SSE; **initial** `summary.json` read on connect; **push** on `writeSummaryAtomically` via **`eventBus.emitBus`** in `summary-writer.ts`. **Health** heartbeat `setInterval` **30s** (not summary polling). `statSync` remains for **one-shot** JSONL tail sizing, not a summary mtime loop | `public/js/unfade-core.js`, `src/server/pages/layout.ts`, `src/server/routes/stream.ts`, `src/services/event-bus.ts`, `src/services/intelligence/summary-writer.ts` |
| **UF-416** | Component tests | **[x] COMPLETE** — `test/server/components/components.test.ts`: **37** `it()` blocks. Covers metrics, badges, charts, tabs, nav, `activationSection`. Run: `pnpm exec vitest run test/server/components/components.test.ts` | `test/server/components/components.test.ts` |
| **UF-417** | Remove dead pages | **[x] COMPLETE** — orphan pages removed from `http.ts` imports; **`portfolio.ts`**, **`repo-detail.ts`**, **`velocity-page.ts`**, legacy **`costs`** page paths gone (redirects in `http.ts` where applicable). No duplicate portfolio/detail routes | `src/server/http.ts` |
| **UF-418** | Responsive + a11y | **[x] COMPLETE** — `src/styles/input.css`: `@media (max-width: 1023px)` narrows sidebar labels; `@media (max-width: 767px)` drawer sidebar + **`.mobile-menu-btn`**. `layout.ts`: viewport meta, `h-screen overflow-hidden`, main **`min-w-0`**, content **`max-w-[1200px]`** | `src/styles/input.css`, `src/server/pages/layout.ts` |

#### 15E — Infrastructure & Remaining Pages

---

##### SSE transport — `src/server/routes/stream.ts` + `src/services/event-bus.ts`

| Aspect | Specification |
|--------|---------------|
| **Previous pattern (removed)** | Hot-loop `setInterval` + `statSync(summary.json)` every ~2s to detect mtime changes |
| **Current architecture (2026-04)** | **`eventBus`** (`emitBus` / `onBus`): `summary-writer` emits **`summary`** after each atomic write. **`stream.ts`** subscribes per SSE client and forwards bus events. Connect-time backfill: read `summary.json` once + tail recent JSONL. **Health** events on **30s** interval. Optional future: materializer `tick` → additional bus types without reviving summary mtime polling |
| **Event types** | `summary` (metrics), `intelligence` (analyzer outputs), `health` (system status), `event` (raw event preview for Live page), `subsystem` (startup phases for System Reveal), `substrate` [P16] (entity/edge counts, maturity phase), `narrative` [P16] (active diagnostics, prescriptions) |
| **User question answered** | N/A — infrastructure enabling real-time across all pages |
| **Developer value** | Dashboard feels truly live — changes appear within milliseconds of materializer processing |
| **Executive value** | Responsive, professional tool. Real-time, not periodic reports |

---

##### Live Page (`/live`) — Event Stream

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | SSE `event` payloads: `{ id, type, source, timestamp, content: { summary, files?, branch? }, projectId }`. Historical: `GET /api/repos/:id/events?limit=50` for initial load |
| **Data lineage** | Go daemon → JSONL → `fs.watch` → SSE Hub → browser (~500ms). Historical from SQLite `events` table ORDER BY ts DESC |
| **Presentation** | Full-height scrolling stream. Each event: colored left border (green=git, blue=AI, gray=terminal), timestamp, type badge, source icon, summary, files (collapsible), branch badge. Auto-scroll with lock on manual scroll-up. Project badge in "All Projects" mode. Filter bar: source checkboxes, type filter. **Phase 16 additions:** Each AI session event gains a prompt type badge (e.g., "implementation", "debugging", "architecture") from the classification pipeline. Session clusters show chain pattern label (e.g., "iterative-refinement", "exploratory-convergent"). Feature target badge when resolved (e.g., "→ auth module"). This transforms the Live page from a raw event log into a classified, annotated stream |
| **User question answered** | "What exactly is Unfade capturing right now, and how is it being classified?" |
| **Developer value** | Real-time verification and debugging. Flow awareness — seeing your own activity stream is engaging. **Phase 16:** Classification badges provide immediate feedback: "My last prompt was classified as 'architecture' with 0.89 confidence — the system understands what I'm doing" |
| **Executive value** | Capture fidelity demonstration. Audit capability: "Show all AI events in payments this week" |

> **Community-validated upgrade — Session Autonomy Indicator (addresses pain point #4: skill atrophy):**
> Each active AI session in the event stream gains a `sessionAutonomyBadge()` displaying real-time autonomy level:
>
> ```
> ┌─ AI Session: auth-refactor ────────────────────────────────┐
> │  [implementation] [→ auth module] [Autonomy: HIGH ●]       │
> │  Direction: 72%  │  Loop risk: LOW  │  Turns: 8            │
> │  "You're steering this session with strong direction"       │
> └────────────────────────────────────────────────────────────┘
> ```
>
> Three levels: **HIGH** (HDS >0.6, loop risk low, modification rate >30% — green), **MED** (HDS 0.3-0.6 or moderate loop risk — yellow), **LOW** (HDS <0.3, high acceptance, possible cognitive drift — red with subtle pulse). **Data source:** `GET /api/intelligence/sessions/active?projectId=` (existing Phase 16 endpoint) → `{ sessions: [{ sessionId, hds, loopRisk, directionTrend, turnCount, suggestedAction }] }`. **User question answered:** "Am I driving this session, or is the AI driving me?" — real-time feedback loop that builds awareness without interrupting flow.

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

> **Community-validated upgrade — Knowledge Retained Section (addresses pain point #1: knowledge evaporation):**
> After the distill summary markdown, add a `knowledgeRetainedCard()` section that reframes the distill as **tomorrow's context**, not just today's summary:
>
> ```
> ┌──────────────────────────────────────────────────────────────┐
> │  KNOWLEDGE RETAINED TODAY                                     │
> │                                                               │
> │  ✓ 4 decisions lodged (available via MCP tomorrow)            │
> │  ✓ 2 dead ends explored (AI won't suggest these again)        │
> │  ✓ Comprehension: auth ↑3%, payments ↓1%                     │
> │  ✓ 3 trade-offs documented                                    │
> │  ────────────────────────────────────────────────────────── │
> │  Context available for tomorrow:                              │
> │  "When you start your next auth session, Unfade will inject   │
> │   today's 4 decisions and 2 dead ends — no re-explaining."   │
> └──────────────────────────────────────────────────────────────┘
> ```
>
> **Data sources:** Distill output (`decisions.length`, `deadEnds.length`, `tradeOffs.length`), comprehension movements from `GET /api/intelligence/comprehension?projectId=` (diff vs yesterday), MCP injection availability from `GET /api/summary?projectId=` (`contextLeveragePct`). **User question answered:** "Will my reasoning be lost overnight, or is it preserved?" — direct counter to the "50 First Dates" fear. **Action enabled:** Confidence to close the laptop knowing tomorrow picks up where today left off.

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

> **Phase 16 Profile upgrade:** The Profile page is the deepest beneficiary of Phase 16's maturity model and semantic substrate. The following additions transform it from a static pattern list into a living growth narrative:
>
> | Addition | Data Source | Presentation |
> |----------|------------|-------------|
> | **Maturity Journey** | `maturity-assessment.json` history + phase transitions | Timeline visualization: Phase 1→2→3→4 with transition dates, duration at each phase, and key milestones. "You entered Phase 2 on Apr 15 after 12 days in Phase 1. At this rate, Phase 3 expected by May 8." |
> | **Learning Trajectories** | Semantic substrate `computeTrajectories()` | Per-capability growth curves: "Your auth expertise: exposure→familiarity→competence (3 weeks). Your payments expertise: exposure→familiarity (stalled 2 weeks)." |
> | **Capability Map** | Semantic substrate entities of type `capability` | Radar chart showing discovered capabilities (e.g., "architectural reasoning", "debugging efficiency", "prompt crafting") with strength scores from evidence accumulation |
> | **Cross-Project Identity** | Cross-project analyzer + substrate `cross-project trajectories` | "Your strongest pattern transfer: caching strategies from unfade-cli → unerr-cli (87% similarity). Growth pattern: you improve fastest when switching between familiar and new domains." |
> | **Narrative Self-Portrait** | `narratives.json` executive summary + maturity + profile | A paragraph that synthesizes the developer's identity: "You're a Phase 2 Responsive developer with strong direction density (73%) and a tendency toward incremental refactoring. Your auth expertise is deep and genuine; payments is a growth area where loop resilience needs attention. Your decisions hold 87% of the time, and your AI-git translation rate is 78%." |
>
> The Profile page transitions from "who am I" to "who am I becoming" — a dynamic growth narrative powered by the semantic substrate's entity relationships and the narrative engine's template synthesis.

> **Community-validated upgrade — Identity Narrative Block (addresses pain point #3: "just a prompter"):**
> Replace the raw Decision Style section (currently: 4 cards showing `avgAlternativesEvaluated`, `medianAlternatives`, `aiAcceptanceRate`, `aiModificationRate` as bare numbers) with an `identityNarrative()` component that frames the same data as evidence of engineering identity:
>
> ```
> ┌──────────────────────────────────────────────────────────────┐
> │  YOUR ENGINEERING IDENTITY                                    │
> │                                                               │
> │  "You evaluated 4.2 alternatives per decision this week —     │
> │   that's architectural thinking, not prompting. You modified   │
> │   38% of AI suggestions before accepting, and your decisions  │
> │   held 87% of the time. You're not a prompter — you're an    │
> │   engineer who uses AI as one tool among many."               │
> │                                                               │
> │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
> │  │ 4.2 alt  │ │ 38% mod  │ │ 87% held │ │ Phase 2  │       │
> │  │ evaluated│ │ rate     │ │ rate     │ │ Responsive│       │
> │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
> └──────────────────────────────────────────────────────────────┘
> ```
>
> **Data sources:** `GET /unfade/profile` (decisionStats), `GET /api/intelligence/maturity-assessment` (phase). **Narrative template:** Generated locally (no LLM) using conditional sentence construction based on metric values. Key thresholds: `avgAlternatives >= 3` → "architectural thinking"; `modificationRate >= 25%` → "active steering"; `heldRate >= 80%` → "high-durability decisions". **User question answered:** "Am I still an engineer, or am I just a prompter?" — answered with evidence.

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

### Sprint 15F — Community-Validated UI Upgrades (Diagnostic-First Surfaces)

**Tracker status (2026-04-23):** **[ ] NOT IMPLEMENTED IN TREE** — repo audit: **no** `src/server/components/narrative-card.ts`, **no** `autonomy-viz.ts`, **no** `GET /api/intelligence/autonomy`, **no** `/intelligence/tab/autonomy`, Intelligence Hub remains **5 tabs** (`intelligence.ts`), Home KPI strip has **four** cards (direction, events, comprehension, cost). Spec + data contracts below stay the **single** target design (no duplicate implementations).

**Objective:** Implement the 7 community-validated UI upgrades identified through Reddit/HN/X research and Transmission Thesis cross-reference. These upgrades shift the UI from "dashboard" to "diagnostic mechanic" — every surface gains a narrative + action pair, not just another chart. **Depends:** Sprint 15C (tabs shell) **done**; several items also need **Phase 16** JSON/API paths (`maturity-assessment`, `sessions/active`, etc.) before UI can be truthful.

**Acid test (when Sprint 15F ships):**
```bash
pnpm build && pnpm test && \
  curl -s http://localhost:7654/ | grep -q 'vehicle-health' && \
  curl -s http://localhost:7654/ | grep -q 'context-leverage' && \
  curl -s "http://localhost:7654/intelligence?tab=autonomy" | grep -q 'independence-index' && \
  curl -s http://localhost:7654/profile | grep -q 'identity-narrative' && \
  echo "PASS: Community-validated diagnostic surfaces"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-420** | `vehicleHealthSummary()` component | **[ ] PENDING** — add `narrative-card.ts` (or agreed module) with typed props; read `maturity-assessment.json` + narratives payloads per Data Contracts §15F | `src/server/components/narrative-card.ts` (to create) |
| **UF-421** | Home: Vehicle Health Summary card | **[ ] PENDING** — wire component on Home when project-scoped + maturity files exist | `src/server/pages/home.ts` |
| **UF-422** | Home: Context Leverage KPI card | **[ ] PENDING** — 5th KPI; extend `SummaryJson` + writer/materializer only if metric is defined in one place | `src/server/pages/home.ts`, `src/services/intelligence/summary-writer.ts` |
| **UF-423** | Autonomy viz components | **[ ] PENDING** — `independenceGauge`, `skillTrajectoryChart`, `dependencyHeatmap` in new `autonomy-viz.ts` | `src/server/components/autonomy-viz.ts` (to create) |
| **UF-424** | Intelligence Hub: Autonomy tab | **[ ] PENDING** — `intelligence-tabs.ts` partial + 6th tab in `intelligence.ts` | `src/server/pages/intelligence.ts`, `src/server/routes/intelligence-tabs.ts` |
| **UF-425** | `GET /api/intelligence/autonomy` | **[ ] PENDING** — new route; compose from existing intelligence JSON where possible | `src/server/routes/intelligence.ts` |
| **UF-426** | `identityNarrative()` | **[ ] PENDING** — template narrative from `ReasoningModelV2` / decision stats | `src/server/components/narrative-card.ts` |
| **UF-427** | Profile: Identity Narrative block | **[ ] PENDING** | `src/server/pages/profile.ts` |
| **UF-428** | `knowledgeRetainedCard()` | **[ ] PENDING** | `src/server/components/narrative-card.ts` |
| **UF-429** | Distill: Knowledge Retained section | **[ ] PENDING** | `src/server/pages/distill.ts` |
| **UF-430** | `sessionAutonomyBadge()` | **[ ] PENDING** | `src/server/components/badges.ts` |
| **UF-431** | Live: Session Autonomy indicator | **[ ] PENDING** — needs `GET /api/intelligence/sessions/active` + Live stream wiring | `src/server/pages/live.ts` |
| **UF-432** | Intelligence Overview: prescription slot | **[ ] PENDING** | `src/server/pages/intelligence.ts` |
| **UF-433** | Tab count + route registration | **[ ] PENDING** — today: **5** Hub tabs; post-15F: **6** with Autonomy (+ docs) | `src/server/pages/intelligence.ts`, `src/server/http.ts` |

#### 15F — Component Data Contracts

---

##### `vehicleHealthSummary()` — `src/server/components/narrative-card.ts`

```typescript
interface VehicleHealthSummaryProps {
  phase: number;                    // 1-4
  phaseLabel: string;               // "Responsive", "Precision", etc.
  phaseProgress: number;            // 0-100 within current phase
  bottleneck: { dimension: string; score: number };
  topPrescription?: { action: string; estimatedImpact: string };
  activeDiagnosticCount: number;
  pendingPrescriptionCount: number;
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `maturity-assessment.json` (phase, dimensions, bottleneck) + `narratives.json` (prescriptions, diagnostics) |
| **Data lineage** | Maturity model analyzer → 7 dimension scores → phase classification → bottleneck detection. Narrative engine → template matching → prescriptions ranked by impact |
| **Transformation** | Phase score (0-1) → progress bar percentage. Bottleneck = lowest dimension. Top prescription = highest-priority narrative |
| **Presentation** | Card with phase progress bar, bottleneck dimension + score, prescription text, diagnostic/prescription counts. Vehicle-analogy language throughout |
| **User question answered** | "What's wrong with my setup and what should I fix first?" |
| **Action enabled** | Focus on bottleneck dimension. Follow prescription. Understand diagnostic count for urgency |

---

##### `independenceGauge()` — `src/server/components/autonomy-viz.ts`

```typescript
interface IndependenceGaugeProps {
  index: number;          // 0-100 composite
  breakdown: {
    hds: number;          // 0-100 (30% weight)
    modificationRate: number;  // 0-100 (25% weight)
    alternativesEval: number;  // 0-100 (20% weight)
    comprehensionTrend: number; // 0-100 (25% weight, positive = improving)
  };
  trend: 'improving' | 'stable' | 'declining';
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/intelligence/autonomy?projectId=` → `{ independenceIndex, breakdown, trend }` |
| **Data lineage** | HDS from `efficiency.json` direction sub-score. Modification rate from efficiency.json `modificationDepth`. Alternatives from `profile/reasoning_model.json` decision stats. Comprehension trend from `comprehension.json` 7-day delta |
| **Transformation** | Weighted composite: `(hds × 0.3) + (modRate × 0.25) + (altEval × 0.2) + (compTrend × 0.25)` → 0-100 |
| **Presentation** | 200px SVG ring (same pattern as AES gauge). Center: index value + trend arrow. Below: 4 breakdown bars. Color: green (>70), yellow (40-70), red (<40) |
| **User question answered** | "Am I growing as an engineer or becoming dependent on AI?" |
| **Action enabled** | Low index → identify weakest component. Declining trend → behavioral intervention needed |

---

##### `sessionAutonomyBadge()` — `src/server/components/badges.ts`

```typescript
interface SessionAutonomyBadgeProps {
  level: 'HIGH' | 'MED' | 'LOW';
  directionPct: number;    // HDS as percentage
  loopRisk: 'low' | 'moderate' | 'high';
  turnCount: number;
  narrative?: string;      // e.g., "You're steering this session with strong direction"
}
```

| Aspect | Specification |
|--------|---------------|
| **Data consumed** | `GET /api/intelligence/sessions/active` → per-session HDS, loop risk, turn count |
| **Data lineage** | Go AI daemon → session events → session materializer → HDS computation → loop detector → active session state |
| **Transformation** | HDS >0.6 + low loop risk → HIGH. HDS 0.3-0.6 or moderate risk → MED. HDS <0.3 → LOW |
| **Presentation** | Pill badge: green "HIGH ●" / yellow "MED ●" / red pulsing "LOW ●". Inline with session event card on Live page |
| **User question answered** | "Am I driving this session or is the AI driving me?" |

---

### Sprint 15G — Phase 16 Intelligence Integration (Post-Phase-16 UI Wiring)

**Tracker status (2026-04-23):** **[ ] NOT IMPLEMENTED IN TREE** — audit: **no** `maturity-assessment` / `commit-analysis` / `expertise-map` / `dual-velocity` / `efficiency-survival` / `file-churn` / `ai-git-links` / `sessions/active` / `diagnostics/active` / `cross-project` routes in `intelligence.ts`; **no** `src/server/routes/substrate.ts` or `/api/substrate/*` in `http.ts`; Intelligence Hub tabs remain **comprehension / velocity / cost / patterns** (+ overview) — **no** `maturity`, `git-expertise`, or `narratives` htmx tabs. **Prerequisite:** Phase 16 analyzer JSON + optional **UF-476** islands for heavy charts (`src/server/components/island-container.ts` exists as infrastructure only).

**Objective:** Wire Phase 16's new analyzer outputs into the Phase 15 UI shell. Each task adds API + htmx partial (or page integration) per Section 4.7 **15C+** rows. Sprint 15F surfaces remain a separate sprint.

**Acid test (when Sprint 15G ships):**
```bash
pnpm build && pnpm test && \
  curl -s "http://localhost:7654/intelligence?tab=maturity" | grep -q 'maturity-phase' && \
  curl -s "http://localhost:7654/intelligence?tab=git-expertise" | grep -q 'expertise-map' && \
  curl -s "http://localhost:7654/intelligence?tab=narratives" | grep -q 'narrative-diagnostic' && \
  curl -s http://localhost:7654/api/intelligence/maturity-assessment | jq '.phase' && \
  curl -s http://localhost:7654/api/substrate/topology | jq '.hubs' && \
  echo "PASS: Phase 16 intelligence surfaces wired"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-440** | `GET /api/intelligence/maturity-assessment` | **[ ] PENDING** — add route + `readIntelligenceFile('maturity-assessment.json')` + `?project=` when filtering exists | `src/server/routes/intelligence.ts` |
| **UF-441** | `GET /api/intelligence/narratives` | **[~] PARTIAL** — route **exists** but reads **`narratives.jsonl`** and returns `{ narratives, count }`; Sprint 15G spec targets **`narratives.json`** + structured diagnostics/prescriptions — align or add second path intentionally (**one** canonical contract) | `src/server/routes/intelligence.ts` |
| **UF-442** | `GET /api/intelligence/commit-analysis` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-443** | `GET /api/intelligence/expertise-map` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-444** | `GET /api/intelligence/dual-velocity` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-445** | `GET /api/intelligence/efficiency-survival` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-446** | `file-churn` + `ai-git-links` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-447** | `GET /api/intelligence/sessions/active` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-448** | `GET /api/intelligence/diagnostics/active` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-449** | `GET /api/intelligence/cross-project` | **[ ] PENDING** | `src/server/routes/intelligence.ts` |
| **UF-450** | `GET /api/substrate/*` (3 routes) | **[ ] PENDING** — create `substrate.ts` + register in `http.ts` | `src/server/routes/substrate.ts`, `src/server/http.ts` |
| **UF-451** | `GET /intelligence/tab/maturity` | **[ ] PENDING** | `intelligence.ts`, `intelligence-tabs.ts` |
| **UF-452** | `GET /intelligence/tab/git-expertise` | **[ ] PENDING** | `intelligence.ts`, `intelligence-tabs.ts` |
| **UF-453** | `GET /intelligence/tab/narratives` | **[ ] PENDING** | `intelligence.ts`, `intelligence-tabs.ts` |
| **UF-454** | Overview maturity badge | **[ ] PENDING** | `src/server/pages/intelligence.ts` |
| **UF-455** | Comprehension expertise overlay | **[ ] PENDING** | `src/server/routes/intelligence-tabs.ts` |
| **UF-456** | Velocity dual-velocity panel | **[ ] PENDING** | `src/server/routes/intelligence-tabs.ts` |
| **UF-457** | Cost efficiency-survival quadrant | **[ ] PENDING** | `src/server/routes/intelligence-tabs.ts` |
| **UF-458** | Profile maturity journey | **[ ] PENDING** | `src/server/pages/profile.ts` |
| **UF-459** | Profile learning trajectories | **[ ] PENDING** | `src/server/pages/profile.ts` |
| **UF-460** | Live active sessions panel | **[ ] PENDING** | `src/server/pages/live.ts` |
| **UF-461** | Live classification badges | **[ ] PENDING** | `src/server/pages/live.ts` |
| **UF-462** | Decisions causal chain | **[ ] PENDING** | `src/server/pages/decisions.ts` |
| **UF-463** | Home global narrative headline | **[ ] PENDING** | `src/server/pages/home.ts` |
| **UF-464** | Home maturity badges on cards | **[ ] PENDING** | `src/server/pages/home.ts` |
| **UF-465** | Home insight prescriptions | **[ ] PENDING** | `src/server/pages/home.ts` |

---

## 6. Tests (T-400 → T-480)

| Sprint | ID | Test | File |
|--------|----|------|------|
| 15H | **T-470** | Layout HTML contains no `cdn.tailwindcss.com` script tag | `test/server/pages/layout.test.ts` |
| 15H | **T-471** | Layout HTML contains no `unpkg.com/htmx` script tag | `test/server/pages/layout.test.ts` |
| 15H | **T-472** | Layout HTML contains no `fonts.googleapis.com` link tag | `test/server/pages/layout.test.ts` |
| 15H | **T-473** | Layout HTML references local `/public/css/tailwind.css` | `test/server/pages/layout.test.ts` |
| 15H | **T-474** | Layout HTML references local `/public/js/htmx.min.js` | `test/server/pages/layout.test.ts` |
| 15H | **T-475** | `stream.ts` has no `setInterval` that polls `summary.json` by mtime; uses `eventBus` subscription | `test/server/routes/stream.test.ts` (**2026-04**) |
| 15H | **T-476** | `summary-writer` emits a `summary` bus event after each atomic `summary.json` write | `test/server/routes/stream.test.ts` (**2026-04**) |
| 15H | **T-477** | `public/js/unfade-core.js` exports project context + fetch wrapper | `test/server/client/unfade-core.test.ts` |
| 15H | **T-478** | Static assets include `Cache-Control` headers | `test/server/http.test.ts` |
| 15A | **T-400** | `heroMetricCard()` returns HTML with value and label | `test/server/components/metric-card.test.ts` |
| 15A | **T-401** | `kpiCard()` includes delta when provided | `test/server/components/metric-card.test.ts` |
| 15A | **T-402** | `dataFreshnessBadge()` shows correct tier icon | `test/server/components/badges.test.ts` |
| 15A | **T-403** | `estimateBadge()` wraps content in proxy background | `test/server/components/badges.test.ts` |
| 15A | **T-404** | Layout includes 4-layer navigation groups | `test/server/pages/layout.test.ts` |
| 15A | **T-405** | Layout includes `window.__unfade` initialization script | `test/server/pages/layout.test.ts` |
| 15B | **T-406** | Project selector dropdown renders repo list from `/api/repos` | `test/server/components/project-selector.test.ts` |
| 15B | **T-407** | Home HTML includes dashboard KPI placeholder `#dash-dir` | `test/server/pages/home.test.ts` (**2026-04**) |
| 15B | **T-408** | Home renders distinct project hero when `?project=` set | **[ ] PENDING** — server-rendered Home is not yet project-scoped; selector is client-side | `src/server/pages/home.ts` |
| 15B | **T-409** | `/api/summary?project=<id>`: 404 for unknown id; for known id, 200 + global body + `X-Unfade-Metrics-Scope: global` until filtered summaries exist | `test/server/routes/summary.test.ts` |
| 15B | **T-410** | `/api/intelligence/efficiency?projectId=abc` returns scoped data | `test/server/routes/intelligence.test.ts` |
| 15C | **T-411** | Intelligence Hub renders tab bar with 5 tabs + stable `id="tab-*"` | `test/server/pages/intelligence.test.ts` (**2026-04**) |
| 15C | **T-412** | `/intelligence/tab/cost` returns HTML partial with estimate affordance | `test/server/routes/intelligence-tabs.test.ts` (**2026-04**) |
| 15C | **T-413** | Decisions page includes `#dec-search` | `test/server/pages/decisions.test.ts` (**2026-04**) |
| 15C | **T-414** | Decisions page includes `#dec-scope-badge` pre-rendered "All projects" (JS upgrades when a project is selected) | `test/server/pages/decisions.test.ts` (**2026-04**) |
| 15D | **T-415** | Home includes inline `#home-activation` + activation wiring markers | `test/server/pages/home.test.ts` (**2026-04**) |
| 15D | **T-416** | Home script registers `__unfade.onSummary` / `onHealth` for activation | `test/server/pages/home.test.ts` (**2026-04**) |
| 15E | **T-417** | `stream.ts` uses `eventBus` (no summary mtime interval); `summary-writer` emits `summary` on write | `test/server/routes/stream.test.ts` (**2026-04**) |
| 15E | **T-418** | No orphan imports after page removal | CI gate (`pnpm build && pnpm typecheck`) |
| 15E | **T-419** | Viewport + `min-w-0`/`overflow-hidden` on shell routes; source CSS has 1023px/767px breakpoints | `test/server/pages/responsive.test.ts` (**2026-04**) |
| 15E | **T-420** | Full CI passes: `pnpm build && pnpm test && pnpm typecheck && pnpm lint` | CI gate |
| 15F | **T-421** | `vehicleHealthSummary()` renders phase progress bar and bottleneck | **[ ] PENDING** — add `narrative-card.test.ts` with implementation |
| 15F | **T-422** | `independenceGauge()` renders SVG ring with correct index value | **[ ] PENDING** — add `autonomy-viz.test.ts` |
| 15F | **T-423** | `skillTrajectoryChart()` renders 3 overlaid trend lines from 30-day data | **[ ] PENDING** — `autonomy-viz.test.ts` |
| 15F | **T-424** | `dependencyHeatmap()` flags red cells when acceptance >80% and comprehension <40% | **[ ] PENDING** — `autonomy-viz.test.ts` |
| 15F | **T-425** | `identityNarrative()` high-autonomy narrative | **[ ] PENDING** — `narrative-card.test.ts` |
| 15F | **T-426** | `identityNarrative()` low-autonomy narrative | **[ ] PENDING** — `narrative-card.test.ts` |
| 15F | **T-427** | `knowledgeRetainedCard()` decision count + comprehension movements | **[ ] PENDING** — `narrative-card.test.ts` |
| 15F | **T-428** | `sessionAutonomyBadge()` HIGH/MED/LOW colors | **[ ] PENDING** — extend `badges.test.ts` |
| 15F | **T-429** | `/intelligence/tab/autonomy` partial | **[ ] PENDING** — extend `intelligence-tabs.test.ts` |
| 15F | **T-430** | `/api/intelligence/autonomy` JSON | **[ ] PENDING** — extend `intelligence.test.ts` |
| 15F | **T-431** | Home includes Vehicle Health block | **[ ] PENDING** — extend `home.test.ts` |
| 15F | **T-432** | Home 5th KPI (context leverage) | **[ ] PENDING** — `home.test.ts` |
| 15F | **T-433** | Profile identity narrative | **[ ] PENDING** — `profile.test.ts` |
| 15F | **T-434** | Distill Knowledge Retained | **[ ] PENDING** — `distill.test.ts` |
| 15F | **T-435** | Live session autonomy badges | **[ ] PENDING** — add `live.test.ts` or extend existing |
| 15G | **T-440** | `/api/intelligence/maturity-assessment` | **[ ] PENDING** — extend `intelligence.test.ts` when route exists |
| 15G | **T-441** | `/api/intelligence/narratives` contract | **[ ] PENDING** — assert `jsonl` **or** unified `narratives.json` once canonical |
| 15G | **T-442** | `/api/intelligence/commit-analysis` | **[ ] PENDING** |
| 15G | **T-443** | `/api/intelligence/expertise-map` | **[ ] PENDING** |
| 15G | **T-444** | `/api/intelligence/sessions/active` | **[ ] PENDING** |
| 15G | **T-445** | `/api/substrate/entity/:id/neighborhood` | **[ ] PENDING** — add `substrate.test.ts` |
| 15G | **T-446** | `/api/substrate/trajectories` | **[ ] PENDING** — `substrate.test.ts` |
| 15G | **T-447** | `/api/substrate/topology` | **[ ] PENDING** — `substrate.test.ts` |
| 15G | **T-448** | `/intelligence/tab/maturity` | **[ ] PENDING** — `intelligence-tabs.test.ts` |
| 15G | **T-449** | `/intelligence/tab/git-expertise` | **[ ] PENDING** |
| 15G | **T-450** | `/intelligence/tab/narratives` | **[ ] PENDING** |
| 15G | **T-451** | Overview maturity badge | **[ ] PENDING** — `intelligence.test.ts` |
| 15G | **T-452** | Velocity dual-velocity panel | **[ ] PENDING** |
| 15G | **T-453** | Cost efficiency-survival quadrant | **[ ] PENDING** |
| 15G | **T-454** | Profile Maturity Journey | **[ ] PENDING** — `profile.test.ts` |
| 15G | **T-455** | Profile Learning Trajectories | **[ ] PENDING** |
| 15G | **T-456** | Live session intelligence panel | **[ ] PENDING** — add `live.test.ts` |
| 15G | **T-457** | Decisions causal chain | **[ ] PENDING** — `decisions.test.ts` |
| 15G | **T-458** | Home maturity badges on cards | **[ ] PENDING** — `home.test.ts` |
| 15G | **T-459** | Home global narrative headline | **[ ] PENDING** — `home.test.ts` |
| 15G | **T-460** | Phase 16 APIs `jsonOr202` when missing files | **[ ] PENDING** — `intelligence.test.ts` |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **10-second active reveal** | New user sees system coming alive within 10s | Manual test: clear localStorage, open localhost:7654 |
| **Project switching** | Switching project updates all visible data in <500ms | Measure: click project, time until DOM updated |
| **Navigation items** | 9 visible + 3 collapsed (from 15 flat) | Count sidebar items |
| **Component reuse** | 0 duplicate HTML patterns across pages | Grep for inline card/badge HTML outside `components/` |
| **Intelligence Hub** | 9 intelligence surfaces in 1 page (5 base + 4 community-validated/P16) | Count tabs on `/intelligence` |
| **SSE event-driven** | No mtime polling anywhere | Verify no `statSync` calls in stream.ts |
| **Phase 14 alignment** | All API routes accept `?projectId=` | Integration test suite |
| **Zero external CDN dependencies** | No `cdn.tailwindcss.com`, `unpkg.com`, or `fonts.googleapis.com` in rendered HTML | `curl localhost:7654 \| grep -c 'cdn\|unpkg\|googleapis'` = 0 |
| **First paint < 200ms** | Pre-compiled CSS (~30KB) vs JIT compiler (~300KB) — 10× reduction | Chrome DevTools DOMContentLoaded |
| **Offline-capable UI** | All assets served locally — UI renders without internet | Disconnect network, load page |
| **True push SSE** | No `statSync` or mtime polling in stream.ts | `grep -c statSync src/server/routes/stream.ts` = 0 |
| **Test coverage** | Current + 51 new tests (21 base + 21 Phase 16 + 9 Sprint 15H), all passing | `pnpm test` |
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
| **Sprint 15G blocked indefinitely by Phase 16 delays** | Medium | Medium | Sprint 15F community-validated surfaces (autonomy, vehicle health, identity) can ship independently using existing data sources. Sprint 15G surfaces gracefully degrade via `jsonOr202()` — they render "warming up" until Phase 16 data arrives. No hard runtime dependency |
| **Sprint 15H Tailwind migration breaks existing styles** | Medium | High | Run visual regression: screenshot each page before/after CSS migration. Tailwind utility classes are deterministic — same class = same CSS. The only risk is classes used in inline `<script>` DOM manipulation that Tailwind's scanner misses. Mitigation: add `safelist` in config for dynamically generated classes |
| **React islands add bundle complexity** | Low | Low | Islands are opt-in per component — no mandatory migration. Only complex interactive surfaces (graph exploration, real-time panels) use React. Simple pages stay as SSR string templates. React is already in `package.json` (Satori), so no new dependency weight |

---

## 9. Dependency Graph

```
                    ┌──────────────────────────────────────────────────┐
                    │  EXECUTION ORDER (Sprint 15H is the foundation) │
                    └──────────────────────────────────────────────────┘

Sprint 15H (UI Architecture Hardening)  ← FIRST — no external dependency
  │  UF-470: Tailwind CDN → local compiled CSS
  │  UF-471: htmx bundled locally
  │  UF-472: Google Fonts self-hosted
  │  UF-473: True push SSE (replaces mtime polling)
  │  UF-474: Async file reads (no readFileSync on request path)
  │  UF-475: Shared client-side state module
  │  UF-476: React islands infrastructure
  │  UF-477: Cache-Control headers
  │  UF-478: Build pipeline (CSS + assets)
  │
  └── Sprint 15A (Components + Nav) ← builds on hardened layout.ts
        └── Sprint 15B (Project Selector) [DEPENDS: Phase 14A]
              └── Sprint 15C (Intelligence Hub + Decisions) [SOFT DEPENDS: Phase 14C]
                    └── Sprint 15D (System Reveal)
                          └── Sprint 15E (SSE + Polish) [DEPENDS: Phase 14B + 15H UF-473]
                                └── Sprint 15F (Community-Validated Upgrades)
                                      └── Sprint 15G (Phase 16 Intelligence Integration) [BLOCKED on Phase 16]

Phase 14 (Global-First Storage)
  ├── Sprint 14A (projectId on events + SQLite)
  │     └── Sprint 15B (Project selector + global views) [DEPENDS]
  ├── Sprint 14B (Single daemon + global paths)
  │     └── Sprint 15E (Event-driven SSE) [DEPENDS]
  └── Sprint 14C (Intelligence pipeline update)
        └── Sprint 15C (Intelligence Hub with project scoping) [SOFT DEPENDS]

Phase 16 (Intelligence System Redesign)
  ├── Maturity model analyzer ──┬── Sprint 15F UF-420/421 (Vehicle Health Summary)
  │                             └── Sprint 15G UF-440/451/454/458/464 (maturity endpoints + tab + badges)
  ├── Narrative engine ─────────┬── Sprint 15F UF-420/426/428/432 (prescriptions, identity, knowledge)
  │                             └── Sprint 15G UF-441/453/463/465 (narratives endpoint + tab + home)
  ├── Session materializer ─────┬── Sprint 15F UF-430/431 (session autonomy)
  │                             └── Sprint 15G UF-447/460/461 (sessions endpoint + live panels)
  ├── Efficiency analyzer (HDS) → Sprint 15F UF-423/424/425 (autonomy tab)
  ├── Commit analyzer ──────────→ Sprint 15G UF-442/452 (commit-analysis endpoint + git tab)
  ├── Expertise map ────────────→ Sprint 15G UF-443/452/455 (expertise endpoint + git tab + comprehension overlay)
  ├── File churn + AI-git linker → Sprint 15G UF-446/452 (churn endpoints + git tab)
  ├── Dual velocity ────────────→ Sprint 15G UF-444/456 (dual-velocity endpoint + velocity tab)
  ├── Efficiency survival ──────→ Sprint 15G UF-445/457 (efficiency-survival endpoint + cost tab)
  ├── Diagnostic stream ────────→ Sprint 15G UF-448 (active diagnostics endpoint)
  ├── Cross-project analyzer ───→ Sprint 15G UF-449 (cross-project endpoint)
  └── Substrate engine ─────────→ Sprint 15G UF-450/459/462 (substrate endpoints + profile + decisions)
```

**Sprint 15H must execute first** — it eliminates the ~300KB Tailwind CDN JIT compiler, bundles htmx/fonts locally, replaces mtime-polling SSE with true push, and creates the React islands infrastructure. Every subsequent sprint (15A–15G) builds on this hardened foundation. Without 15H, every page built in 15A–15G would need to be revisited to fix CDN dependencies and SSE architecture.

**Sprint 15A follows 15H** — it builds the component library and navigation on the hardened layout.ts. Sprint 15B requires Phase 14A (projectId exists). **Sprint 15E:** push SSE via `eventBus` + `stream.ts` (**2026-04**). **Sprint 15F:** spec documented; **not implemented**. **Sprint 15G:** spec + UF table updated (**2026-04**); **UF-440–465 not implemented** — no substrate HTTP routes, no extra Hub tabs; Phase 16 JSON + writers must land before UI wiring.

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
| **Phase 16 Traceability** | |
| Maturity tab + Home badge | [PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN](./PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md) — maturity-model analyzer, 7-dimension scoring |
| Narratives tab + Home headline | [PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN](./PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md) — narrative-engine, 20 templates, vehicle analogies |
| Git & Expertise tab | [PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN](./PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md) — git intelligence pipeline (Sprint 16M) |
| Efficiency-survival + dual velocity | [PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN](./PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md) — cross-source integration (Sprint 16N) |
| Causal chains in Decisions | [PHASE_16_SUBSTRATE_INVESTIGATION](./PHASE_16_SUBSTRATE_INVESTIGATION.md) — CozoDB entity→edge traversal |
| Profile maturity journey + trajectories | [PHASE_16_SUBSTRATE_INVESTIGATION](./PHASE_16_SUBSTRATE_INVESTIGATION.md) — learning trajectories, entity resolution |
| Classification badges on Live page | [PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN](./PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md) — prompt-classifier, feature-registry (Sprint 16B) |
| System Reveal Phase D2 (graph building) | [PHASE_16_SUBSTRATE_INVESTIGATION](./PHASE_16_SUBSTRATE_INVESTIGATION.md) — substrate-engine first ingestion |
| **Sprint 15H UI Architecture Hardening Traceability** | |
| Tailwind CDN → local (UF-470) | Performance audit 2026-04-23: `cdn.tailwindcss.com` loads ~300KB JIT compiler on every page. Industry standard is pre-compiled CSS at build time |
| htmx + fonts bundled locally (UF-471/472) | Same audit: 3 external CDN dependencies = 3 DNS lookups + TLS handshakes per page load. Zero-dependency principle for local-first tool |
| True push SSE (UF-473) | `stream.ts` uses `statSync()` mtime polling every 2s. Industry standard (Grafana, PostHog) is event-driven push. Prerequisite for Sprint 15E SSE consumers |
| React islands infrastructure (UF-476) | Industry survey: every CLI dashboard with interactive analytics uses React/Vue. Hybrid approach validated by Astro, Fresh, Remix partial hydration patterns |
| **Sprint 15G Phase 16 Integration Traceability** | |
| Maturity API + tab + badges (UF-440/451/454/458/464) | Phase 16 maturity-model analyzer → maturity-assessment.json → API → Maturity tab, Overview badge, Profile journey, Home project cards |
| Narratives API + tab + home (UF-441/453/463/465) | Phase 16 narrative-engine → narratives.json → API → Narratives tab, Home headline, insight stream prescriptions |
| Git & Expertise tab (UF-442/443/446/452) | Phase 16 commit-analyzer + expertise-map + file-churn + ai-git-linker → 4 JSON files → 4 API endpoints → Git & Expertise tab |
| Sessions API + live panels (UF-447/460/461) | Phase 16 session-intelligence analyzer → sessions/active endpoint → Live page active sessions + classification badges |
| Substrate endpoints (UF-450/459/462) | Phase 16 substrate-engine (CozoDB) → 3 substrate API routes → Profile trajectories, Decisions causal chains, topology |
| Cross-source surfaces (UF-444/445/449/455/456/457) | Phase 16 cross-analyzers → dual-velocity, efficiency-survival, cross-project, expertise overlay → Velocity/Cost/Comprehension tabs |
| **Sprint 15F Community-Validated Traceability** | |
| Autonomy tab + Independence Index | Community research (Reddit/HN/X Apr 2025) — pain points #3 (identity crisis), #4 (skill atrophy). Cross-ref: Transmission Thesis §5 (Driver Development Program) |
| Vehicle Health Summary | Community research — pain point #5 (decision context loss). Cross-ref: Transmission Thesis §4 (Dashboard → Mechanic shift) |
| Context Leverage metric | Community research — pain point #2 ("50 First Dates"). Cross-ref: Transmission Thesis Gap A (real-time transmission) |
| Identity Narrative block | Community research — pain point #3 ("just a prompter"). Cross-ref: Transmission Thesis §5 (identity affirmation through evidence) |
| Knowledge Retained section | Community research — pain point #1 (knowledge evaporation). Cross-ref: Transmission Thesis Gap A |
| Session Autonomy indicator | Community research — pain point #4 (cognitive dependency). Cross-ref: Transmission Thesis §4 (Phase 1 detection) |

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
| **Phase 16 Additions** | | | |
| `~/.unfade/intelligence/maturity-assessment.json` | maturity-model analyzer | `GET /api/intelligence/maturity-assessment` | Home (badge), Intelligence Hub → Maturity, Profile (journey) |
| `~/.unfade/intelligence/narratives.json` | narrative-engine analyzer | `GET /api/intelligence/narratives` | Home (headline), Intelligence Hub → Narratives, Patterns (prescriptions), Profile (self-portrait) |
| `~/.unfade/intelligence/commit-analysis.json` | git-commit-analyzer | `GET /api/intelligence/commit-analysis` | Intelligence Hub → Git & Expertise |
| `~/.unfade/intelligence/file-churn.json` | git-file-churn analyzer | `GET /api/intelligence/file-churn` | Intelligence Hub → Git & Expertise |
| `~/.unfade/intelligence/expertise-map.json` | git-expertise-map analyzer | `GET /api/intelligence/expertise-map` | Intelligence Hub → Git & Expertise, Comprehension (overlay) |
| `~/.unfade/intelligence/ai-git-links.json` | ai-git-linker analyzer | `GET /api/intelligence/ai-git-links` | Intelligence Hub → Git & Expertise |
| `~/.unfade/intelligence/efficiency-survival.json` | cross-efficiency-survival | `GET /api/intelligence/efficiency-survival` | Intelligence Hub → Cost (quadrant chart) |
| `~/.unfade/intelligence/maturity-ownership.json` | cross-maturity-ownership | `GET /api/intelligence/maturity-ownership` | Intelligence Hub → Maturity (ownership table) |
| `~/.unfade/intelligence/dual-velocity.json` | cross-dual-velocity | `GET /api/intelligence/dual-velocity` | Intelligence Hub → Velocity (dual panel) |
| `~/.unfade/intelligence/cross-project.json` | cross-project analyzer | `GET /api/intelligence/cross-project` | Home (global narrative), Profile (cross-project identity) |
| `~/.unfade/intelligence/session-intelligence.json` | session-intelligence analyzer | `GET /api/intelligence/sessions/active` | Live page (active sessions panel) |
| `~/.unfade/intelligence/causality.json` | causality analyzer | `GET /api/substrate/causal-chains` | Decisions (causal chain drill-through) |
| `~/.unfade/substrate/graph.db` | substrate-engine (CozoDB) | `GET /api/substrate/*` endpoints + MCP enrichment + Decisions causal chains | Decisions (causal chains), Profile (trajectories), Intelligence Hub → Overview (topology), entity drill-through drawers |
| **Sprint 15F Community-Validated Additions** | | | |
| (computed on-the-fly) | autonomy route handler | `GET /api/intelligence/autonomy` | Intelligence Hub → Autonomy tab |
| `~/.unfade/state/summary.json` (new field) | summary-writer | `GET /api/summary` → `contextLeveragePct` | Home → Context Leverage KPI |

### Appendix D — UI Pattern Reference Library & Data Presentation Standards

> This appendix is the developer-facing reference system. Every UI implementation task must explicitly align with a pattern from this library. When building a new surface, find the matching pattern below, follow its rules, and cite it in the PR description.

#### D.1 Proven UI Pattern Library (When / Why / How)

| # | Pattern | When to Use | Reference Product | Rules |
|---|---------|-------------|-------------------|-------|
| **P-1** | **Hero Metric + Interpretation** | A page needs a single primary number that answers "how am I doing?" | Stripe (revenue hero), Datadog (service overview) | One number, 48-60px monospace. Always paired with: (a) human-readable interpretation ("You steer confidently"), (b) trend arrow + delta vs prior period, (c) `dataFreshnessBadge`, (d) `confidenceBadge`. Never show a raw number without context. The interpretation transforms data into insight |
| **P-2** | **KPI Strip (3-5 cards)** | Secondary metrics that provide peripheral awareness alongside a hero | Vercel (deployment overview), GitHub Copilot metrics | Max 5 cards in a single horizontal row. Each card: one number + one label + optional delta. Cards are clickable → navigate to the detail page for that metric. Never exceed 5 — if more metrics exist, use progressive disclosure (collapsible "More" section) |
| **P-3** | **Tabbed Intelligence Hub** | Multiple related data views that share a conceptual parent | Datadog (APM tabs), PostHog (dashboard tabs) | Max 5-6 tabs. First tab pre-rendered server-side. Other tabs loaded via htmx partial. Tab label + optional badge count. URL updates for bookmarkability. Each tab follows the same internal layout: hero → strip → detail. Prevents "dashboard soup" by constraining one hero + 4 KPI max per tab |
| **P-4** | **Chronological Timeline** | Displaying events, decisions, or activities ordered by time | Linear (activity feed), GitHub (commit history) | Most recent first. Each item: timestamp (monospace, fixed-width column) + source icon + type badge + summary (single line, truncated). Drill arrow "→" opens evidence drawer. Supports search + filter (source, domain, period). When showing cross-project data: project badge on each item |
| **P-5** | **Evidence Drawer (Right Slide)** | User wants to see supporting detail for a metric or insight without leaving the page | Datadog (trace detail), Linear (issue drawer) | 480px or 40% viewport width. Slides from right with overlay backdrop. Contains: evidence events (table), raw JSON toggle, related distill excerpt, MCP equivalent hint. Click backdrop or press Escape to close. Never navigates away — context is preserved |
| **P-6** | **Progressive System Reveal** | First-run experience that builds user understanding of the tool | Raycast (onboarding rail), Vercel (deploy first experience) | Subsystems animate online one by one. Each phase answers one user question. Always includes "Skip" option. Auto-advances when ready. `localStorage` flag prevents re-showing. Transitions to normal dashboard via dissolve animation — never an abrupt state switch |
| **P-7** | **Empty State with CTA** | A data surface has no content yet | Raycast (empty extensions), Linear (empty project) | Centered illustration (120x120 SVG). Title explaining why empty. Description of what's needed. Single CTA button pointing to the action that produces data. Never show a blank page or error-like state for normal "not yet populated" conditions |
| **P-8** | **Global → Project Drill-Down** | User switches between aggregate (all projects) and per-project views | Vercel (project switcher), Datadog (environment selector) | Single selector in persistent UI (live strip). "All Projects" = default. Selection persists in `localStorage`. All API calls auto-inject project filter. Project cards in global view are clickable to set the selector. Never require a separate "portfolio" page |
| **P-9** | **Metric + Comparison Baseline** | A number needs context to be meaningful | Stripe (vs prior period), PostHog (funnel comparisons) | Every metric should answer "compared to what?" Options: (a) vs prior period (↑8% vs last week), (b) vs cross-project average (12% above your average), (c) vs threshold (healthy >70%, concerning <40%). Raw numbers without comparison are noise, not insight |
| **P-10** | **Cost with Honesty Badge** | Displaying estimated financial data | Stripe (balance with footnotes) | ALL estimated USD wrapped in `estimateBadge()`. Tooltip: "Proxy estimate based on session metadata." Never present an estimate as an invoice. Dashed border visual treatment distinguishes from exact figures. Adds trust by being transparent about precision |
| **P-11** | **Narrative Insight Card** | Surfacing a machine-generated observation that connects data points | Spotify Wrapped (stat reveal), PostHog (insight suggestions) | Short claim sentence ("You iterate 2.3x faster on auth than payments"). Source attribution. Confidence indicator. Actionable framing: what to do about it. Appearing progressively in insight streams, not as static dashboard elements. Creates "aha" moments through specificity |
| **P-12** | **Pattern Card (Coach)** | Showing behavioral patterns with actionable guidance | GitHub Copilot (suggestion patterns) | Card with colored left border (green=effective, red=anti-pattern). Domain badge. Occurrence count + acceptance/rejection rate. Example snippet. Actionable button ("Copy as CLAUDE.md rule"). Anti-patterns include "Suggestion" field. Sorted by impact, not alphabetically |
| **P-13** | **Maturity Phase Gauge** [P16] | Showing user's position on a 4-phase progression | Duolingo (skill levels), Stripe (risk assessment tiers) | 4-segment arc gauge (like car dashboard). Current phase filled with accent color. Phase labels are encouraging: "Discovering", "Responsive", "Fluent", "Masterful". Progress within phase shown by arc fill. Bottleneck dimension highlighted. Always accompanied by "Advance to Phase N by improving X" callout. The gauge gives users a mental model for their AI collaboration journey |
| **P-14** | **Dimension Radar Chart** [P16] | Showing multi-dimensional scores (maturity, expertise) | GitHub Copilot (skill radar), Figma (design review scores) | 7-axis SVG radar with area fill. Weakest dimension highlighted in red. Each axis labeled with dimension name. Hover shows exact score + trend. Used for maturity dimensions and capability maps. Provides "shape of competence" at a glance |
| **P-15** | **Narrative Diagnostic Card** [P16] | Surfacing a vehicle-analogy diagnostic that explains system state | Spotify Wrapped (stat reveal), Apple Health (health summary) | Card with vehicle-analogy icon (wrench, gauge, warning). Severity-colored border (info=blue, warning=yellow, critical=red). Headline uses analogy language ("Running rich"). Detail paragraph explains in concrete terms. Related metric badges. Always actionable: links to the prescription that addresses the diagnostic |
| **P-16** | **Executive Summary Block** [P16] | Providing a copy-paste-ready paragraph for non-technical stakeholders | Stripe (financial summary), Datadog (executive report) | Prominent callout card. Single paragraph synthesizing: maturity phase + key metric + top diagnostic + primary prescription. Copy button. Professional language (not vehicle-analogy — that's for developer diagnostics). Serves as the bridge between technical depth and executive communication |
| **P-17** | **Causal Chain Visualization** [P16] | Showing entity→edge→entity relationships from semantic substrate | GitHub (commit ancestry graph), Neo4j (graph browser) | Horizontal node→edge→node mini-diagram. Nodes are entity types (decision, feature, pattern) with type-colored borders. Edges labeled with relationship type. Click node → Evidence Drawer. Used in Decisions page for decision impact chains. Never show more than 5 connected nodes inline — "Expand" link for deeper traversal |
| **P-18** | **Quadrant Chart** [P16] | Plotting 2-dimensional classification (efficiency-survival, velocity alignment) | BCG Matrix, Gartner Magic Quadrant | 2×2 scatter plot with labeled quadrants. Each point represents a session or feature. Quadrant labels use descriptive language: "effective-durable" (green), "effective-fragile" (yellow), "inefficient-durable" (blue), "inefficient-fragile" (red). Hover shows session detail. Distribution percentages per quadrant |

#### D.2 Data Presentation Standards

**The Five Rules of Data Presentation (every component must follow ALL five):**

| # | Rule | Violation Example | Correct Example |
|---|------|-------------------|-----------------|
| **R-1** | **Never show a number without interpretation** | "Direction Density: 0.73" | "Direction Density: 73% — You steer confidently" |
| **R-2** | **Never show a number without comparison** | "AES: 64" | "AES: 64 (↑ 8% vs last week)" |
| **R-3** | **Never show a number without freshness** | "Events: 142" | "Events: 142 · live · 4s ago" |
| **R-4** | **Never show a number without confidence** | "Comprehension: 68" | "Comprehension: 68 (High — 42 sessions)" |
| **R-5** | **Never show an insight without action** | "Auth comprehension is declining" | "Auth comprehension declining 3 weeks → Review module (link)" |

**The "Aha" Moment Checklist (validate every new surface delivers at least one):**

- [ ] Does this surface show the user something about their behavior they didn't know before?
- [ ] Is the insight specific to THEIR data, not a generic statement?
- [ ] Is the comparison meaningful (vs their own history, not an abstract benchmark)?
- [ ] Can the user act on what they see without leaving the page?
- [ ] Would this surface make a user say "I didn't realize that" or "I should change this"?
- [ ] **Phase 16:** Does this surface explain "why" (causal reasoning), not just "what" (metrics)?
- [ ] **Phase 16:** Does this surface tell a story (narrative), not just present data (dashboard)?
- [ ] **Phase 16:** Does this surface show where the user is on their journey (maturity), not just current state?
- [ ] **Phase 16:** Is the language diagnostic ("running rich") rather than technical ("iteration ratio 0.35")?
- [ ] **Community-validated:** Does this surface counter the "just a prompter" narrative with evidence?
- [ ] **Community-validated:** Does this surface show growth over time (not just current state)?
- [ ] **Community-validated:** Does this surface confirm context preservation (fighting knowledge evaporation)?

**Visual Hierarchy Rules:**

| Level | Typography | Color | Spacing | Use |
|-------|-----------|-------|---------|-----|
| **L1: Hero** | `font-mono text-5xl font-bold` | `var(--accent)` or `var(--cyan)` | `p-6`, `mb-6` | One per page. The single most important number. Draws the eye instantly |
| **L2: KPI** | `font-mono text-3xl font-bold` | `var(--foreground)` | `p-4`, grid gap-4 | 3-5 per page. Secondary metrics supporting the hero. Scanned peripherally |
| **L3: Label/Caption** | `font-body text-xs text-muted` | `var(--muted)` | `mt-1` | Beneath every number. Interpretation, freshness, confidence. Always present |
| **L4: Detail** | `font-body text-sm` | `var(--foreground)` | `p-4` within cards | Expandable sections, table rows, evidence items. One click away from L1/L2 |
| **L5: System** | `font-mono text-[11px]` | `var(--muted)` | minimal | Timestamps, IDs, debug info. Visible but never dominant. In drawers and logs |

**Progressive Disclosure Layers:**

```
Layer 0: Live Strip (always visible) — "Is it alive? Which project?"
Layer 1: Page Hero + KPIs (first scroll) — "What's the one key number?"
Layer 2: Detail Sections (scroll down) — "What are the supporting details?"
Layer 3: Evidence Drawer (click) — "What specific events support this?"
Layer 4: Raw Data (toggle in drawer) — "Show me the underlying JSON/SQL"
```

Each layer is accessed by a deliberate user action: scroll, click, toggle. Data NEVER leaks from a deeper layer to a shallower one (e.g., raw JSON never appears in the KPI strip).

#### D.3 Unfade Feature → Pattern Mapping

| Unfade Feature / Page | Primary Pattern | Supporting Patterns | Hero Metric |
|----------------------|----------------|--------------------|----|
| **Home (All Projects)** | P-8 (Global→Project Drill-Down) | P-2 (KPI Strip), P-11 (Insight Cards) | Active project count |
| **Home (Single Project)** | P-1 (Hero Metric) | P-2 (KPI Strip), P-4 (Timeline via insights) | Direction Density % |
| **Intelligence Hub → Overview** | P-1 (Hero Metric) + P-3 (Tabbed Hub) | P-2 (KPI Strip — 5 sub-metrics), P-9 (Comparison) | AES score (0-100) |
| **Intelligence Hub → Comprehension** | P-1 (Hero Metric) | P-7 (Empty State), P-5 (Evidence Drawer) | Overall comprehension % |
| **Intelligence Hub → Velocity** | P-1 (Hero Metric) | P-9 (Comparison — current vs previous), P-4 (Domain timeline) | Trend direction (accelerating/stable/decelerating) |
| **Intelligence Hub → Cost** | P-1 (Hero Metric) + P-10 (Cost Honesty) | P-9 (Comparison — waste ratio, projected monthly) | Total estimated spend |
| **Intelligence Hub → Patterns** | P-12 (Pattern Cards) | P-7 (Empty State), P-11 (Alert insights) | Effective pattern count |
| **Decisions** | P-4 (Chronological Timeline) | P-5 (Evidence Drawer), P-8 (Project Drill-Down) | Decision count |
| **Live** | P-4 (Chronological Timeline) | P-6 (System Reveal on first run) | Event stream |
| **Distill** | P-4 (Chronological Timeline — by date) | P-5 (Rendered markdown) | Today's distill |
| **Profile** | P-1 (Hero Metric — reasoning style) | P-12 (Pattern Cards — strengths/growth) | Held decision rate |
| **Cards** | Standalone (gallery) | P-7 (Empty State) | Latest card preview |
| **Intelligence Hub → Maturity** [P16] | P-13 (Maturity Phase Gauge) + P-14 (Dimension Radar) | P-9 (Comparison — phase requirements), P-11 (Bottleneck insight) | Maturity phase (1-4) |
| **Intelligence Hub → Git & Expertise** [P16] | P-1 (Hero Metric — translation rate) | P-4 (Commit timeline), P-18 (Quadrant — expertise levels) | AI→git translation % |
| **Intelligence Hub → Narratives** [P16] | P-15 (Narrative Diagnostic Card) + P-16 (Executive Summary) | P-4 (Progress timeline), P-12 (Prescription cards) | Active narrative count |
| **Entity Drill-Through** [P16] | P-17 (Causal Chain Viz) + P-5 (Evidence Drawer) | P-4 (Revision history timeline) | Connected entity count |
| **Live → Active Sessions** [P16] | P-11 (Insight Card — session risk) | P-9 (Loop risk threshold comparison) | Active session count |
| **Home → Cross-Project Insights** [P16] | P-11 (Insight Cards) | P-9 (Cross-project comparison) | Cross-project insight count |
| **First Run** | P-6 (Progressive System Reveal) | P-7 (Empty State per subsystem) | Subsystem activation count |
| **Home → Vehicle Health Summary** [15F] | P-15 (Narrative Diagnostic Card) + P-13 (Maturity Gauge) | P-11 (Prescription insight) | Phase progress % within current phase |
| **Home → Context Leverage KPI** [15F] | P-2 (KPI Strip) + P-9 (Comparison) | P-11 (Insight — leverage trend) | Context leverage % (sessions with prior context) |
| **Intelligence Hub → Autonomy** [15F] | P-1 (Hero Metric — Independence Index) + P-14 (Dimension breakdown) | P-9 (Comparison — 30-day trend), P-18 (Dependency heatmap quadrant) | Independence Index (0-100) |
| **Profile → Identity Narrative** [15F] | P-16 (Executive Summary Block — identity framing) | P-2 (Evidence KPIs below narrative) | Engineering identity narrative |
| **Distill → Knowledge Retained** [15F] | P-11 (Insight Card — context preservation) | P-9 (Comprehension vs yesterday) | Decisions lodged + context available for tomorrow |
| **Live → Session Autonomy** [15F] | P-11 (Insight Card — per-session) | P-9 (HDS vs threshold) | Session autonomy level (HIGH/MED/LOW) |

#### D.4 Component → Pattern → Data Source Cross-Reference

| Component Function | Pattern Used | Data Source (API) | SQLite Origin | "Aha" Moment Delivered |
|-------------------|-------------|------------------|--------------|----------------------|
| `heroMetricCard()` (Home) | P-1 | `/api/summary` → `directionDensity24h` | `AVG(hds) FROM events WHERE ts > -24h` | "I'm steering 73% of AI interactions — that's high" |
| `heroMetricCard()` (Intelligence) | P-1 | `/api/intelligence/efficiency` → `aes` | 5 weighted sub-scores from events + sessions | "My AI efficiency is 64 — iteration ratio is dragging it down" |
| `kpiStrip()` (Home global) | P-2 | `/api/summary` + `/api/repos` | `COUNT(DISTINCT project_id)`, `COUNT(*)`, etc. | "3 active projects, 342 events — I've been busy across repos" |
| `gaugeSvg()` | P-1 | `/api/intelligence/efficiency` → `aes` | Composite of 5 analyzer queries | "The gauge shows 64 and it's been trending up for 2 weeks" |
| `projectCard()` | P-8 | `/api/repos` + per-repo summary | Registry + `events WHERE project_id = ?` | "unfade-cli is active (3m ago) but my-saas-app hasn't had events in 2h" |
| `heatmapCell()` | P-1 variant | `/api/intelligence/comprehension` → `byModule` | `comprehension_by_module WHERE project_id = ?` | "Auth module is green (82%) but payments is red (32%) — I'm a black box in payments" |
| `estimateBadge()` | P-10 | Any USD from `costs.json` | `token_proxy_spend` × pricing config | "~$12.40 today (estimate) — transparent, I know it's a proxy" |
| `emptyState()` | P-7 | 202 response from intelligence API | N/A (data absent) | "No data yet — keep working, patterns emerge after 10 sessions" |
| `tabBar()` (Intelligence) | P-3 | Static config + `alerts.json.alerts.length` | Blind-spot-detector output | "Patterns tab has a red badge (2) — something needs my attention" |
| `dataFreshnessBadge()` | R-3 | `summary.json.updatedAt` | Materializer tick timestamp | "Data is live (4s ago) — I can trust these numbers right now" |
| `confidenceBadge()` | R-4 | Analyzer `.confidence` + qualifying event count | `COUNT(*) FROM events WHERE source IN (...)` | "High confidence (42 sessions) — this AES score is statistically meaningful" |
| Pattern card (effective) | P-12 | `/api/intelligence/prompt-patterns` → `effectivePatterns[]` | Clustered prompts correlated with direction scores | "Including schema + constraints gets 0.87 direction — I should always do that" |
| Insight row (Home) | P-11 | `/api/insights/recent` | Narrative generator from correlation engine | "unfade-cli auth comprehension dropped 12% — never noticed that" |
| Decision row (Decisions) | P-4 | `/api/decisions?projectId=` | `decisions WHERE project_id = ?` | "I chose JWT over sessions on Apr 21 — 85% confidence, 3 files changed" |
| **Sprint 15F Community-Validated Additions** | | | | |
| `vehicleHealthSummary()` (Home) | P-15 + P-13 | `/api/intelligence/maturity-assessment` + `/api/intelligence/narratives` | Maturity model analyzer + narrative engine | "Phase 2 at 55% — bottleneck is loop resilience. Rx: reduce iteration loops in auth" |
| `independenceGauge()` (Autonomy tab) | P-1 | `/api/intelligence/autonomy` → `independenceIndex` | Weighted composite: HDS + modRate + altEval + compTrend | "Independence: 68 — I'm steering AI effectively, not dependent on it" |
| `skillTrajectoryChart()` (Autonomy tab) | P-9 | `/api/intelligence/autonomy` → `hdsHistory, modificationHistory, comprehensionTrend` | 30-day event history aggregated by day | "My comprehension trend is up 12% this month — I'm actually learning" |
| `dependencyHeatmap()` (Autonomy tab) | P-18 variant | `/api/intelligence/autonomy` → `dependencyMap` | Per-domain: acceptance rate × comprehension score | "Red in payments — 92% acceptance, 28% comprehension. I'm rubber-stamping AI in this domain" |
| `identityNarrative()` (Profile) | P-16 | `/unfade/profile` → `decisionStats` + `/api/intelligence/maturity-assessment` | Profile + maturity model | "4.2 alternatives per decision, 38% modification rate — that's architectural thinking, not prompting" |
| `knowledgeRetainedCard()` (Distill) | P-11 | Distill output + `/api/intelligence/comprehension` (diff vs yesterday) | Distill pipeline + comprehension delta | "4 decisions lodged, 2 dead ends explored. Tomorrow starts with this context" |
| `sessionAutonomyBadge()` (Live) | P-11 | `/api/intelligence/sessions/active` → per-session state | Session materializer + loop detector | "Autonomy: HIGH — direction 72%, no loops. I'm driving this session" |
| Context Leverage KPI (Home) | P-2 | `/api/summary` → `contextLeveragePct` | `COUNT(DISTINCT session_id) WHERE source='mcp-active' / total sessions` | "72% of sessions used prior context — my past reasoning is being reused" |
| **Sprint 15G Phase 16 Integration Additions** | | | | |
| Maturity tab (Intelligence Hub) | P-1 + P-9 | `/api/intelligence/maturity-assessment` → phase + dimensions + trajectory | Maturity model analyzer (Phase 16) | "Phase 2: Responsive — 7 dimensions scored, bottleneck is loop resilience" |
| Git & Expertise tab (Intelligence Hub) | P-18 + P-4 | `/api/intelligence/commit-analysis` + `expertise-map` + `file-churn` + `ai-git-links` | 4 git intelligence analyzers (Phase 16) | "I own auth deeply but payments is AI-dependent — 3 files churning" |
| Narratives tab (Intelligence Hub) | P-11 + P-16 | `/api/intelligence/narratives` → diagnostics + prescriptions + executive summary | Narrative engine (Phase 16) | "Priority 1: Decompose prompts — est. 15% AES improvement" |
| Maturity phase badge (Overview tab) | P-1 | `/api/intelligence/maturity-assessment` → phase + phaseLabel | Maturity model analyzer (Phase 16) | "Phase 2: Responsive alongside AES 64 — both numbers tell the same story" |
| Dual velocity panel (Velocity tab) | P-9 | `/api/intelligence/dual-velocity` → AI vs git velocity | Cross-dual-velocity (Phase 16) | "78% of AI sessions resulted in commits within 2h — high translation efficiency" |
| Efficiency-survival quadrant (Cost tab) | P-18 variant | `/api/intelligence/efficiency-survival` → AES × survival scatter | Cross-efficiency-survival (Phase 16) | "High AES but low survival in payments — my efficient AI code isn't lasting" |
| Expertise overlay (Comprehension tab) | P-18 | `/api/intelligence/expertise-map` → ownership per file | Git-expertise-map (Phase 16) | "High comprehension but AI-dependent — I understand it but can't write it" |
| Maturity Journey timeline (Profile) | P-9 | `/api/intelligence/maturity-assessment` → trajectory + transitions | Maturity model analyzer history (Phase 16) | "Entered Phase 2 on Apr 15, projected Phase 3 by May 8" |
| Learning Trajectories chart (Profile) | P-9 | `/api/substrate/trajectories` → slope per capability | Substrate engine + learning-trajectories (Phase 16) | "Auth comprehension slope: +0.3/week — measurable skill growth" |
| Active sessions panel (Live) | P-11 | `/api/intelligence/sessions/active` → session states | Session-intelligence analyzer (Phase 16) | "3 active sessions — loop risk elevated in payments debugging" |
| Classification badges (Live) | P-10 | Event metadata → domain + confidence | Prompt-classifier (Phase 16) | "Last prompt classified as 'architecture' (0.89) — the system gets it" |
| Causal chain drill-through (Decisions) | P-4 | `/api/substrate/entity/:id/neighborhood` → graph | Substrate engine CozoDB (Phase 16) | "This JWT decision led to 4 downstream features — high causal impact" |
| Global narrative headline (Home) | P-11 | `/api/intelligence/narratives` → executiveSummary | Narrative engine (Phase 16) | "Overall: balanced AI collaboration with room for prompt decomposition" |
| Maturity badges on project cards (Home) | P-8 + P-1 | `/api/intelligence/maturity-assessment?projectId=` → phase per project | Maturity model analyzer (Phase 16) | "unfade-cli: Phase 2 🔧, my-saas: Phase 1 🔑 — different maturity per project" |
| Narrative prescriptions in insight stream (Home) | P-11 | `/api/intelligence/narratives` → prescriptions | Narrative engine (Phase 16) | "Prescription: reduce iteration loops — saves ~$2/day" |

### Appendix E — Component → Data Source Quick Reference (Legacy — see D.4 for expanded version)

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

## 11. UI Architecture Evaluation (RRVV)

> **Purpose:** Rigorous analysis of whether the current SSR + htmx stack should evolve, and how. Performed 2026-04-23 after observing inconsistent page load performance across the Phase 15 UI.

### 11.1 Rigorous Research: Current Architecture Audit

**Stack:** Hono v4.12.14 SSR → HTML template literals → htmx 2.0.4 (CDN) → Tailwind CSS (CDN JIT) → vanilla JS (inline IIFEs) → SSE (mtime polling)

| Layer | Implementation | File(s) | Finding |
|-------|---------------|---------|---------|
| **Layout shell** | `layout()` wraps every page in `<html>` with sidebar, live strip, scripts | `layout.ts` | Loads 3 external CDNs: `cdn.tailwindcss.com` (~300KB JIT compiler), `unpkg.com/htmx.org`, `fonts.googleapis.com` (3 font families). **This is the #1 performance bottleneck** — the Tailwind JIT compiler parses and compiles CSS client-side on every page load |
| **Page rendering** | Each page is a function returning a string via `layout(title, content)` | `home.ts`, `intelligence.ts`, etc. | Pure string concatenation. No JSX, no virtual DOM. Components like `heroMetricCard()` return `string`. Works well for static content but cannot support interactive state (hover tooltips, click-to-drill, cross-component updates) |
| **Tab partials** | htmx swaps HTML fragments via `hx-get="/intelligence/tab/{id}"` | `intelligence-tabs.ts` | Each tab includes its own inline `<script>` IIFE that independently fetches data and manipulates DOM. No shared state between tabs — switching tabs loses any client-side context |
| **Charts** | Pure SVG string generators: `gaugeSvg()`, `sparklineSvg()`, `barChartSvg()` | `charts.ts` | Returns SVG markup as strings. No interactivity (no hover, click, zoom, tooltip). Adequate for static visualizations but insufficient for graph exploration (substrate topology) or time-series drill-down |
| **Real-time** | SSE endpoint polls `summary.json` mtime every 2 seconds via `statSync()` | `stream.ts` | Not true push — 2-second latency floor. Filesystem polling on every tick. Should be replaced with in-process event emitter from materializer |
| **Data loading** | Home page uses `readFileSync()` on request path | `home.ts` | Synchronous I/O blocks the event loop. Every concurrent request waits for file I/O to complete |
| **Client state** | `window.__unfade` object with SSE singleton + project context | `layout.ts` | Minimal shared state. Each page/tab duplicates fetch logic, error handling, and DOM manipulation patterns |

**Critical bottleneck identified:** The ~300KB Tailwind CDN JIT compiler (`cdn.tailwindcss.com`) is downloaded and executed on every page load. It parses the entire DOM, identifies utility classes, and generates CSS at runtime. This is a development convenience that should never ship to production. Pre-compiling Tailwind CSS at build time produces ~15-30KB of optimized CSS — a **10-20× reduction** in payload and eliminates client-side CSS compilation entirely.

### 11.2 Rigorous Research: Industry Survey

| Product | Architecture | Frontend Framework | Startup | Complexity Level |
|---------|-------------|-------------------|---------|-----------------|
| **Grafana** | Go server + SPA | React + Redux + custom plugin system | `grafana-server` | Very High — 100+ dashboard panels, real-time streaming, plugin ecosystem |
| **PostHog** | Django + SPA | React + Kea (Redux-like) | Docker / `./bin/start` | Very High — analytics, feature flags, session replay, A/B testing |
| **Sentry** | Python + SPA | React + Reflux → Redux | `sentry devserver` | High — error tracking, performance monitoring, release management |
| **Langfuse** | Next.js | React (Next.js SSR + client) | `docker compose up` | Medium-High — LLM observability, traces, scoring, prompt management |
| **Gitea** | Go + SSR | Go templates + htmx + vanilla JS | `gitea web` | Medium — git hosting, issues, PRs, wiki. **Closest analog to Unfade** |
| **n8n** | Node.js + SPA | Vue 3 + Pinia | `n8n start` | Medium-High — workflow automation, node editor, executions |
| **Metabase** | Clojure + SPA | React + Redux | `java -jar metabase.jar` | High — SQL queries, dashboards, collections, embedding |
| **Directus** | Node.js + SPA | Vue 3 + Pinia | `npx directus start` | Medium — headless CMS, data studio, RBAC |
| **Plane** | Python + SPA | React (Next.js) | Docker | Medium — project management, issues, cycles, modules |
| **Memos** | Go + SPA | React + Zustand | `./memos` | Low-Medium — note-taking, timeline, tags |

**Key insight:** Every CLI-launched product with more than basic CRUD complexity has migrated to or started with React (or Vue). The only SSR + htmx product in this category (Gitea) handles structured, form-based workflows (git hosting, issues) — not analytical dashboards with real-time data, interactive charts, and cross-component state.

### 11.3 Reason: Separating Concerns

The observed "some pages load fast, others don't" is caused by **three independent problems**, not one:

| Concern | Root Cause | Solution Domain |
|---------|-----------|----------------|
| **Rendering architecture** | String-based HTML generation works fine for simple pages. Breaks down for interactive surfaces (graph exploration, real-time session panels, cross-tab state). No way to do client-side updates without full re-fetch + DOM replacement | Component framework (React islands) |
| **Asset pipeline** | Tailwind CDN JIT (~300KB) + external htmx + external fonts = 3 DNS lookups + 3 TLS handshakes + 300KB JS parsing on every navigation. This is the dominant cause of perceived slowness | Build tooling (pre-compile CSS, bundle locally) |
| **Data pipeline** | Synchronous file reads (`readFileSync`) on request path. SSE uses mtime polling with 2s latency floor. No in-memory caching of frequently-read data (summary.json). Each tab independently fetches its own data | Server-side optimization (async I/O, event-driven SSE, caching) |

**Critical reasoning:** The asset pipeline problem (Concern 2) affects every page equally and is the easiest to fix. It accounts for the majority of the perceived slowness. The rendering architecture problem (Concern 1) only matters for a subset of complex surfaces. The data pipeline problem (Concern 3) is independent of the rendering framework.

### 11.4 Reason: Three Approaches Evaluated

#### Approach A: Enhance SSR + htmx (status quo, optimized)

- Fix Tailwind CDN → local pre-compiled CSS
- Bundle htmx and fonts locally
- Replace mtime polling with true push SSE
- Fix synchronous file reads
- Keep string-based rendering for all pages

**Pros:** Minimal change, fast to implement, no new framework to learn.
**Cons:** Cannot support interactive visualizations (substrate graph, causal chain explorer, real-time session panels). Each tab remains an isolated mini-app with no shared state. Adding interactivity requires increasingly complex vanilla JS that duplicates what React provides. Gitea is the only precedent — and Gitea doesn't have analytical dashboards.
**Verdict:** Necessary but not sufficient. Fixes performance but leaves an interactivity ceiling.

#### Approach B: Hybrid SSR shell + React islands (recommended)

- **Keep** Hono SSR for layout shell, navigation, simple pages (setup, settings, logs)
- **Keep** htmx for simple partial swaps (tab switching, search results)
- **Add** React islands for complex interactive surfaces only:
  - Substrate topology graph (nodes, edges, hover, zoom)
  - Causal chain drill-through (connected entity visualization)
  - Real-time session intelligence panel (live updates, expandable)
  - Learning trajectory charts (interactive time-series with tooltips)
  - Dependency heatmap (click-to-drill by domain)
- Fix all asset pipeline issues (Tailwind, htmx, fonts)
- Fix all data pipeline issues (async I/O, push SSE, caching)

**Pros:** Surgical — only pays the React cost where it's needed. Simple pages stay as fast SSR strings. React is already in `package.json` (v19.2.5 for Satori). Islands hydrate independently — one slow island doesn't block the page. SSR shell handles layout, auth, navigation without client-side JS.
**Cons:** Two rendering models to maintain. Need to define clear criteria for "when does a surface become an island?" Island boundaries must be well-defined.
**Island criteria:** A surface becomes a React island when it needs: (a) client-side state that persists across user interactions, OR (b) real-time updates from SSE that modify specific DOM elements, OR (c) interactive data visualization (hover, click, zoom, drill-down).

#### Approach C: Full React migration (SPA)

- Replace all Hono SSR with React SPA
- Client-side routing with React Router
- Full component tree with shared state (Zustand or similar)
- Server becomes pure API (JSON only, no HTML rendering)

**Pros:** Industry standard for analytical dashboards. Maximum flexibility for interactivity. Single mental model for all UI development.
**Cons:** Massive rewrite — every page, component, and test needs conversion. Loses SSR benefits (fast first paint, SEO-irrelevant but good for perceived performance). Adds build complexity (Vite/webpack, HMR, code splitting). Overkill for simple pages (setup, settings, logs). Sprints 15A–15E work would need significant revision.
**Verdict:** Not justified. The hybrid approach (B) captures 90% of the benefit at 20% of the cost. Revisit only if the number of React islands exceeds 10+ surfaces.

### 11.5 Validate: Against System Requirements

| Requirement | Approach A (Enhanced SSR) | Approach B (Hybrid Islands) | Approach C (Full React) |
|-------------|--------------------------|---------------------------|------------------------|
| **1. First paint < 500ms** | ✅ Pre-compiled CSS fixes the 300KB penalty. SSR delivers complete HTML | ✅ Same SSR shell + pre-compiled CSS. Islands hydrate after first paint | ⚠️ SPA requires JS bundle download + parse + render before first content |
| **2. Offline-capable** | ✅ All assets local | ✅ All assets local | ✅ All assets local (but larger bundle) |
| **3. Interactive intelligence surfaces** | ❌ Cannot support graph exploration, real-time drill-down, or cross-component state without complex vanilla JS | ✅ React islands handle all interactive surfaces naturally | ✅ Full React handles everything |
| **4. Single-user local tool** | ✅ No unnecessary complexity | ✅ Minimal added complexity — islands are opt-in | ⚠️ SPA infrastructure is designed for multi-user web apps |
| **5. Maintainability** | ⚠️ Inline scripts grow increasingly complex as surfaces become interactive | ✅ Clear boundary: SSR for simple, React for complex | ✅ Single model, but much more code to maintain |

**Result:** Approach B (Hybrid Islands) satisfies all 5 requirements. Approach A fails requirement 3. Approach C is overkill for requirement 4.

### 11.6 Execute: Recommendation + Sprint 15H

**Recommendation: Approach B — Hybrid SSR shell + React islands.**

Sprint 15H (UI Architecture Hardening) is defined as the **first sprint** in the execution sequence, positioned before Sprint 15A. It delivers:

1. **Asset pipeline fixes** (UF-470→472): Eliminate all CDN dependencies. Pre-compile Tailwind CSS, bundle htmx locally, self-host fonts. Immediate 10× payload reduction.
2. **Data pipeline fixes** (UF-473→474): True push SSE, async file reads. Eliminate 2s latency floor and request-path blocking.
3. **Client architecture foundation** (UF-475→476): Shared state module, React islands infrastructure. Foundation for interactive surfaces in later sprints.
4. **Production hardening** (UF-477→478): Cache-Control headers, build pipeline integration.

**Execution order:** 15H → 15A → 15B → 15C → 15D → 15E → 15F → 15G

Sprint 15H has **no external dependencies** — it modifies only `layout.ts`, `stream.ts`, `home.ts`, `http.ts`, `package.json`, and adds static assets. It can begin immediately.

### 11.7 Sprint Impact on 15A–15G

Sprint 15H changes the foundation that Sprints 15A–15G build on. Key impacts per sprint:

| Sprint | Impact from 15H | Modification Required |
|--------|----------------|----------------------|
| **15A** | Layout.ts no longer has CDN scripts → component tests must not assert CDN URLs. Components use pre-compiled Tailwind classes (same utility classes, just pre-compiled). `window.__unfade` may expand to include 15H's shared state module | Update T-404/T-405 test assertions for local asset paths instead of CDN URLs |
| **15B** | Project selector uses shared fetch wrapper from `unfade-core.js` (UF-475) instead of inline fetch | UF-406 project selector can use `window.__unfade.fetch()` from shared module |
| **15C** | Intelligence Hub tabs can share state via pub/sub (UF-475) — switching tabs preserves context. Tabs that need interactivity (graph, heatmap click-through) can use React islands (UF-476) | Tab partials can optionally mount React islands for interactive visualizations |
| **15D** | System reveal animations unaffected — pure CSS + htmx. Benefits from faster first paint (no JIT delay) | No changes needed |
| **15E** | **UF-473** landed in `stream.ts` + `eventBus` + `summary-writer` (push `summary`, no mtime loop). Sprint 15E tracker documents transport + consumers + responsive shell tests | `test/server/routes/stream.test.ts` locks bus wiring; clients stay in `unfade-core.js` |
| **15F** | Complex visualizations (dependency heatmap, skill trajectory) can be React islands. Vehicle health summary stays SSR (simple enough) | `dependencyHeatmap()` and `skillTrajectoryChart()` are candidates for React islands. `vehicleHealthSummary()` stays as SSR string |
| **15G** | Phase 16 surfaces requiring interactivity (substrate topology graph, causal chain explorer, learning trajectories) use React islands infrastructure from UF-476 | UF-451 maturity radar chart, UF-459 learning trajectories, UF-462 causal chain → React islands. Other surfaces stay SSR |

---

*End of document.*

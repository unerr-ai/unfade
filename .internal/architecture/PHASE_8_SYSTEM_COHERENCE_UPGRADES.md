# Phase 8 — System Coherence & Observability Upgrades

> **Purpose:** Post-implementation audit remediation — evolving Unfade from a "technically working but opaque" system into a self-explanatory, always-on product experience. Tracks all iterations, implementation progress, and design decisions in one place.
>
> **Method:** RRVV (Rigorous Research → Reason → Validate → Execute)
>
> **Status:** ACTIVE
>
> **Created:** 2026-04-20
>
> **Last updated:** 2026-04-20

---

## Table of Contents

1. [Iteration Log](#1-iteration-log)
2. [Implementation Tracker](#2-implementation-tracker)
3. [Fix 1: Configuration Lifecycle](#3-fix-1-configuration-lifecycle)
4. [Fix 2: Daemon + Server Runtime Observability](#4-fix-2-daemon--server-runtime-observability)
5. [Fix 3: Deterministic Data Processing Pipeline](#5-fix-3-deterministic-data-processing-pipeline)
6. [Fix 4: UI System State Visibility](#6-fix-4-ui-system-state-visibility)
7. [Fix 5: Idempotent Rerun Behavior](#7-fix-5-idempotent-rerun-behavior)
8. [Fix 6: System Logs UI](#8-fix-6-system-logs-ui)
9. [Data Flow Architecture — Complete Pipeline Map](#9-data-flow-architecture--complete-pipeline-map)
10. [Fix 7: Data Lineage & Provenance Tracking](#10-fix-7-data-lineage--provenance-tracking)
11. [OSS Infrastructure Integration Plan](#11-oss-infrastructure-integration-plan)
12. [Zero-Friction Redesign](#12-zero-friction-redesign)

---

## 1. Iteration Log

| Date | Iteration | Summary |
|------|-----------|---------|
| 2026-04-20 | v0 — Initial Audit | Full RRVV audit of post-Phase-7 system. Identified 5 critical gaps: silent LLM degradation, missing onboarding in primary path, invisible ingest, disconnected UI health chips, opaque resume. Added Fix 6 (System Logs UI) for daemon/processing observability. |
| 2026-04-20 | v1 — Data Flow Deep Dive | Complete end-to-end pipeline mapping: Go daemon capture → JSONL events → materializer cursor → SQLite cache → intelligence engine → summary/distill → API/SSE. Identified critical lineage gap: insights cannot be traced back to source events. Added Fix 7 (Data Lineage & Provenance). Documented all 10 SQLite tables, transformation schemas, and architectural invariants. |
| 2026-04-20 | v2 — OSS Infrastructure Audit | RRVV evaluation of build-vs-integrate decisions across all subsystems. Analyzed 10 categories: event streaming, pipeline orchestration, SQLite driver, observability, scheduling, SSE, checkpointing, file watching, process management, UI. Recommended 4 high-impact replacements (better-sqlite3+Drizzle, Pino, Croner, chokidar) and validated 6 keep-custom decisions. Added Section 11 (OSS Integration Plan) with phased migration strategy. |
| 2026-04-21 | v3 — Dead Code & Version Cruft Audit | Full audit of migration infrastructure and unused modules. Found: 2 migration files never imported from src/, v1 profile still written alongside v2 on every distill (immediately superseded), 3 entire modules never imported, no-op autostart stubs, config accepting dead v1 format. Added Section 13 (Dead Code Elimination) with 10-step removal plan. ~600+ lines to delete. |

---

## 2. Implementation Tracker

### Priority Order

| # | Fix | Scope | Status | Notes |
|---|-----|-------|--------|-------|
| 1 | Config default `"ollama"` → `"none"` | `src/schemas/config.ts` | DONE | Prevents silent failure when Ollama absent |
| 2 | Expose materializer global | `src/server/unfade-server.ts` | DONE | 1-line fix, unblocks live page health chips |
| 3 | `GET /unfade/settings/status` | `src/server/routes/settings.ts` | DONE | Enables UI to gate on config completeness |
| 4 | `GET /api/ingest/status` + idempotent guard | New route + `unfade-server.ts` | DONE | Crash recovery + skip-if-completed logic in triggerIngestWhenReady |
| 5 | Home page 5-state machine | `src/server/pages/home.ts` | DONE | setup → ingesting → calibrating → live → stale |
| 6 | Persistent live strip in layout | `src/server/pages/layout.ts` | DONE | SSE-driven live strip in layout header |
| 7 | `GET /api/system/health` | `src/server/routes/system-health.ts` | DONE | Unified health endpoint for UI + CLI |
| 8 | LLM connectivity validation on save | `src/server/routes/settings.ts` | DONE | Trust signal after config change |
| 9 | Write `resume.json` on startup | `src/services/cache/materializer-daemon.ts` | DONE | Materializer writes resume.json when resuming from checkpoint |
| 10 | Relax first-run-report gate | `src/services/intelligence/first-run-trigger.ts` | DONE | Triggers on ingest completed OR ≥10 events via countAllEvents() |
| 11 | System Logs UI page | New page + route + ring buffer | DONE | Ring buffer + SSE stream + /logs page + nav item + component wiring |
| 12 | Data lineage: `sourceEventIds` in insights | Intelligence engine + distiller | DONE | All 8 analyzers return sourceEventIds; engine writes lineage mappings |
| 13 | `/api/lineage/:id` endpoint | New route | DONE | Bidirectional lookup (event→insights + insight→events) at /api/lineage/:id |
| 14 | Provenance metadata in API responses | All routes + MCP tools | DONE | ProvenanceSchema in tool-response + mcp.ts; 4 intelligence tools emit provenance |
| 15 | Event-to-insight bidirectional index | Materializer + intelligence | DONE | event_insight_map table + lineage.ts with insert/query helpers |
| 16 | Replace sql.js → better-sqlite3 + Drizzle | `src/services/cache/` | DONE | Native better-sqlite3 with WAL mode + Drizzle schema; DbLike wrapper for compat |
| 17 | Replace custom logger → Pino | `src/utils/logger.ts` + all consumers | DONE | Pino sync to fd 2; same external API preserved for all consumers |
| 18 | Replace custom scheduler → Croner | `src/services/scheduler/scheduler.ts` | DONE | Croner-based scheduler with named jobs, stop/status support |
| 19 | Add chokidar for reactive materialization | `src/services/cache/materializer-daemon.ts` | DONE | chokidar v5 file watcher + 100ms debounce + 30s heartbeat fallback |
| 20 | Remove `unfade init` command | cli.ts, commands/init.ts, services/init/* | DONE | Deleted command, wizard, fingerprint, llm-detect, llm-wizard, enterprise/. Kept autostart.ts (no-op stubs for reset.ts) |
| 21 | Auto-open browser on first run | cli.ts, utils/open.ts | DONE | Fire-and-forget openBrowser() on firstRun |
| 22 | Setup Guide page | pages/setup.ts | DONE | 3-step guided setup: engine → integrations → LLM. Home redirects to /setup when unconfigured |
| 23 | One-click MCP integration API | routes/integrations.ts | DONE | POST /api/integrations/install + GET /api/integrations/status |
| 24 | Integrations dashboard page | pages/integrations.ts, layout.ts, http.ts | DONE | Nav item with iconPlug, status badges, one-click install |
| 25 | Refactor Settings page (MCP → Integrations) | pages/settings.ts | DONE | Removed 4 MCP config blocks, replaced with link to /integrations |
| 26 | Update all `unfade init` references | README, CHANGELOG, terminology, commands, portfolio | DONE | All "unfade init" → "unfade" in source + docs |

### Completion Criteria

- All fixes independently deployable (no ordering dependency except #3 before #5 — #3 now done)
- Each fix includes: implementation, manual verification, and (where applicable) test coverage
- Final state: a user running `unfade` for the first time sees a guided, visible, trustworthy flow

---

## 3. Fix 1: Configuration Lifecycle — DONE

> **Implemented:** 2026-04-20. All 4 components shipped: config default → `"none"`, `GET /unfade/settings/status` with connectivity validation, POST connectivity check, `setup-status.json` written by `ensureInit()`. All 587 tests pass. Files changed: `src/schemas/config.ts`, `src/server/routes/settings.ts`, `src/server/pages/settings.ts`, `src/services/init/lightweight-init.ts`, + 4 test files updated.

### Problem

When `unfade` starts bare (the primary path), `ensureInit()` skips the LLM wizard. Config schema defaults `provider` to `"ollama"`, so if Ollama isn't running, distillation fails silently. No error, no explanation, no call-to-action in the UI.

### Root Cause Chain

1. `src/schemas/config.ts:22` — default is `"ollama"` (optimistic)
2. `src/services/init/lightweight-init.ts:25` — explicitly non-interactive, no LLM setup
3. `src/entrypoints/cli.ts:178` — firstRun prints one-liner to stderr, no web redirect
4. `src/server/pages/home.ts` — onboarding card is event-count-driven, not config-driven

### Remediation

1. **Change config default** from `"ollama"` to `"none"` in `src/schemas/config.ts` — makes unconfigured state explicit

2. **New endpoint: `GET /api/settings/status`** in `src/server/routes/settings.ts`:
   - Returns `{ configured: boolean, provider: string, validated: boolean, reason?: string }`
   - `configured` = provider !== "none" AND (if ollama, apiBase is reachable)
   - Used by home page to decide setup-required state

3. **Settings page validation** — on `POST /settings/llm`, perform lightweight connectivity check:
   - Ollama: `fetch(apiBase + "/tags")`
   - OpenAI/Anthropic: attempt minimal API call
   - Return "Connected" or "Unreachable — check URL/key" badge

4. **Setup status file** — `ensureInit()` writes `.unfade/state/setup-status.json`:
   - `{ configuredAt: null, llmValidated: false, ingestTriggered: false }`
   - Gives web UI a single file to check for onboarding state

---

## 4. Fix 2: Daemon + Server Runtime Observability — DONE

> **Implemented:** 2026-04-20. All 4 components shipped: (1) `__unfade_materializer` global exposed for primary repo, (2) SSE health events enhanced with daemon PID/alive/restartCount/repoCount, (3) new `GET /api/system/health` unified endpoint, (4) `EmbeddedDaemon` `onRestart` callback emits system insight on crash recovery. Files changed: `src/server/unfade-server.ts`, `src/server/routes/stream.ts`, `src/server/routes/system-health.ts` (new), `src/services/daemon/embedded-daemon.ts`, `src/services/daemon/repo-manager.ts`, `src/server/http.ts`. All 587 tests pass.

### Problem

Materializer lag never reaches UI (wrong global reference). Health chips in live page check `__unfade_materializer` which is never set. Daemon crash/recovery is invisible.

### Root Cause Chain

1. `src/server/unfade-server.ts:80` sets `__unfade_repo_manager` but NOT `__unfade_materializer`
2. `src/server/routes/stream.ts:57` reads `__unfade_materializer` — always undefined
3. `EmbeddedDaemon` crash recovery (exponential backoff) logs to stderr only

### Remediation

1. **Expose materializer global** in `unfade-server.ts` after `repoManager.addRepo()`:
   - For primary repo: `(globalThis).__unfade_materializer = managed.materializer`

2. **Structured health event in SSE** — every 15 ticks (~30s):
   - `{ event: "health", data: { daemonPid, daemonAlive, materializerLagMs, ingestStatus, configuredProvider, intelligenceReady } }`

3. **New: `GET /api/system/health`** — aggregates:
   - All repo manager entries, daemon PIDs + alive checks
   - Materializer lag per repo
   - Ingest status, LLM config validation, intelligence readiness percentage

4. **Crash recovery visibility** — on daemon auto-restart, append to `insights/recent.jsonl`:
   - `{ type: "system", message: "Capture engine restarted (attempt N)", timestamp: "..." }`
   - Surfaces in home page insights feed

---

## 5. Fix 3: Deterministic Data Processing Pipeline

### Problem

Ingest triggered silently with hardcoded 7d; progress invisible; first-run report gated on daemon-side state that may never complete.

### Root Cause Chain

1. `src/server/unfade-server.ts:70` — `triggerIngestWhenReady` with hardcoded `{ days: 7 }`, no completion check
2. No HTTP endpoint for ingest status — only IPC-based CLI access
3. `src/services/intelligence/first-run-trigger.ts:31` — requires `ingest.json` status === "completed"
4. If daemon crashes mid-ingest, `ingest.json` is never written complete → permanent block

### Remediation

1. **Idempotent ingest trigger** — check `ingest.json` before IPC send:
   - Skip if `status === "completed"` or `status === "running"`
   - Only trigger on `"idle"`, `"failed"`, or missing

2. **New route: `src/server/routes/ingest.ts`**:
   - `GET /api/ingest/status` → reads daemon IPC or `.unfade/state/ingest.json` directly
   - `POST /api/ingest/start` → accepts `{ days }`, triggers via IPC

3. **Home page ingest widget** — when ingest is running, show determinate progress bar in onboarding card; driven by SSE health events

4. **Relax first-run-report gate**:
   - Trigger if `isIngestCompleted(cwd)` OR `countExistingEvents(cwd) >= 10`
   - Handles: daemon crash before completion, manual event addition

5. **Progressive analyzer triggers** — materializer `onTick` callback checks thresholds after each batch, runs qualifying analyzers immediately (not waiting for ingest completion)

---

## 6. Fix 4: UI System State Visibility — DONE

> **Implemented:** 2026-04-20. Home page rewritten with 5-state machine (setup-required → ingesting → calibrating → live → stale). Client JS checks `/unfade/settings/status` first, then `/api/summary`, then drives state from SSE. Live strip already in layout.ts header (SSE-driven). Files changed: `src/server/pages/home.ts`.

### Problem

Home page has 3 states (loading/onboarding/live) but doesn't correctly map to actual system state. No persistent system health indicator.

### Remediation

1. **5-state home page machine:**

   | State | Condition | UI |
   |---|---|---|
   | `setup-required` | LLM provider === "none" or unreachable | Full-screen setup card + Settings CTA |
   | `ingesting` | Ingest running AND < 10 events materialized | Progress bar + "Bootstrapping reasoning profile..." |
   | `calibrating` | Events exist but < 3 intelligence metrics ready | Onboarding checklist showing readiness per capability |
   | `live` | >= 3 intelligence metrics active | Full dashboard |
   | `stale` | Last event > 24h ago | Dashboard + amber "No recent activity" notice |

2. **Home page client JS flow:**
   - Mount → `GET /api/settings/status` → setup-required?
   - Then → `GET /api/ingest/status` → ingesting?
   - Then → SSE → drive calibrating/live/stale from summary + onboarding data

3. **Persistent live strip** — 32px fixed footer on every page (rendered in `layout.ts`):
   ```
   ◆ Daemon: active | Materializer: 1.2s lag | Last event: 3m ago | 847 events today
   ```
   Server-rendered with initial values, updated by SSE on each tick.

4. **Intelligence readiness on home** — compact inline checklist from `/api/intelligence/onboarding` showing "AI Efficiency: Ready" / "Velocity: 8 more days needed"

---

## 7. Fix 5: Idempotent Rerun Behavior — DONE

> **Implemented:** 2026-04-20. Three components: (1) `resume.json` written by materializer on startup when resuming from checkpoint, (2) `isDistillFresh()` in scheduler prevents redundant LLM calls by comparing distill mtime vs events mtime, (3) ingest crash recovery in `triggerIngestWhenReady()` detects stale "running" state (>1h) and marks as failed for re-trigger. Files changed: `src/services/cache/materializer-daemon.ts`, `src/services/scheduler/scheduler.ts`, `src/server/unfade-server.ts`.

### Problem

Materializer resume is functionally correct but invisible. Edge cases around incomplete ingest block downstream features permanently.

### Remediation

1. **Resume state file** — materializer writes `.unfade/state/resume.json` on startup when resuming:
   - `{ resumedAt: "...", fromBytes: 12340, estimatedEvents: 61, streamCount: 3 }`
   - Home page shows "Resumed from checkpoint (61 events already processed)"

2. **Startup detection in UI** — SSE first event includes `{ resumed: true, fromCheckpoint: N }` flag

3. **Distill deduplication** — scheduler checks: if distill for today exists AND no new events since its mtime, skip. Prevents redundant LLM calls on restart.

4. **Ingest crash recovery** — if `ingest.json` has `status: "running"` but `startedAt` is > 1 hour ago with no daemon process alive, mark as `"failed"` and allow re-trigger

---

## 8. Fix 6: System Logs UI — DONE

> **Implemented:** 2026-04-20. Full stack: (1) `src/services/logs/types.ts` — LogEntry interface + source/level types, (2) `src/services/logs/ring-buffer.ts` — in-memory 500/source ring buffer singleton with subscribe pattern, (3) `src/server/routes/logs.ts` — GET /api/logs + SSE /api/logs/stream, (4) `src/server/pages/logs.ts` — filterable log viewer with source colors + auto-scroll, (5) mounted in http.ts + layout.ts nav. Component wiring: EmbeddedDaemon stderr → ring buffer, MaterializerDaemon tick → ring buffer, Scheduler events → ring buffer. Duplicate `/unfade/health` removed (redirects to unified `/api/system/health`). All 587 tests pass.

### Problem

Users have no visibility into what the daemon, materializer, intelligence engine, and server are doing. Debugging requires SSH-ing into log files or reading stderr. For a self-explanatory product, processing activity must be visible directly in the browser.

### Design

A dedicated **Logs** page (`/logs`) in the web UI that shows real-time, filterable log output from all system components. This is the "what is happening under the hood" view — complementary to the Live page (which shows captured events) and the Home page (which shows interpreted results).

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Ring Buffer (in-memory, per component, 500 lines each)         │
│                                                                 │
│  Sources:                                                       │
│    • daemon (stderr piped from EmbeddedDaemon child process)    │
│    • materializer (tick count, rows upserted, errors)           │
│    • intelligence (analyzer runs, thresholds, write paths)      │
│    • server (HTTP requests, SSE connections, route errors)       │
│    • scheduler (next trigger time, distill attempts, skips)      │
│    • ingest (progress, sources scanned, events extracted)        │
│                                                                 │
│  Storage: NOT persisted to disk (memory-only ring buffer)        │
│  Capacity: 500 entries per source × 6 sources = 3,000 max       │
└───────��────────────────────────┬────────────────────────────────┘
                                 │
                    ��────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
            GET /api/logs   SSE /api/logs/stream   GET /logs (page)
            (snapshot)      (real-time tail)        (HTML shell)
```

### Log Entry Schema

```typescript
interface LogEntry {
  id: number;           // monotonic sequence
  timestamp: string;    // ISO 8601
  source: "daemon" | "materializer" | "intelligence" | "server" | "scheduler" | "ingest";
  level: "debug" | "info" | "warn" | "error";
  message: string;      // single-line summary
  detail?: string;      // optional multi-line (stack traces, JSON payloads)
  repoId?: string;      // which repo (for multi-repo)
}
```

### Ring Buffer Implementation

- New file: `src/services/logs/ring-buffer.ts`
- In-memory circular buffer, fixed capacity per source
- Global singleton accessed by all components
- Methods: `append(entry)`, `query(filter)`, `tail(n)`, `stream()` (async iterator)
- No disk I/O — this is ephemeral session-scoped observability

### Integration Points

| Component | What to log | Where to hook |
|---|---|---|
| **Daemon** | stderr lines, start/stop/crash/restart events | `EmbeddedDaemon.spawn()` — pipe stderr to ring buffer |
| **Materializer** | tick count, rows upserted, rebuild triggers, cursor saves | `MaterializerDaemon.tick()` return handler |
| **Intelligence** | analyzer name + duration + result count, threshold checks, write paths | `IntelligenceEngine.run()` per-analyzer |
| **Server** | request method + path + status + latency, SSE connect/disconnect | Hono middleware |
| **Scheduler** | next trigger ISO, distill attempts, skip reasons | `startScheduler()` callbacks |
| **Ingest** | sources discovered, events extracted per source, completion | Daemon IPC relay or direct observation |

### HTTP Endpoints

1. **`GET /api/logs`** �� Query parameters:
   - `source` — filter by component (comma-separated)
   - `level` — minimum level (default: "info")
   - `since` — ISO timestamp or relative ("5m", "1h")
   - `limit` — max entries (default: 100, max: 500)
   - Returns: `{ entries: LogEntry[], total: number, oldestAvailable: string }`

2. **`GET /api/logs/stream`** — SSE endpoint:
   - Emits new log entries as they arrive
   - Supports same `source` and `level` filters as query params
   - Event format: `{ event: "log", data: JSON.stringify(entry) }`

### Page Design (`/logs`)

```
┌──────────────────────────────────────────────────────────────┐
│  Logs                                                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ [All] [Daemon] [Materializer] [Intelligence] [Server]   │ │
│  │ [Scheduler] [Ingest]                                    │ │
│  │                                                         │ │
│  │ Level: [Debug] [Info] [Warn] [Error]     [ ] Auto-scroll│ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 12:04:01.123 [materializer] INFO  Tick #847: 3 new rows │ │
│  │ 12:04:01.125 [intelligence] INFO  Efficiency analyzer    │ ���
│  │              ran (12ms, 1 result written)                │ │
│  │ 12:04:03.001 [daemon]       INFO  Event captured:       │ ��
│  │              ai-session/ai-conversation (unfade-cli)     │ │
│  │ 12:04:05.200 [server]       INFO  GET /api/summary 200  │ │
���  │              (4ms)                                       │ │
│  │ 12:04:30.010 [scheduler]    INFO  Next distill trigger:  │ │
│  │              2026-04-20T18:03:22+05:30                   │ │
│  │ 12:04:31.500 [materializer] WARN  Cursor drift detected │ │
│  │              (file truncated?), rebuilding stream...     │ │
│  │                                                         │ │
│  │ ─── stream ───                                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ System Summary ────────────────────────────────────────┐ │
│  │ Daemon: PID 42301 (uptime 2h 14m) | Materializer: 847  �� │
│  │ ticks | Intelligence: 6/8 analyzers active | Server:    │ │
│  │ 234 requests served                                     │ │
│  └────────────────────────────────���────────────────────────┘ │
└─���──────────────────────────────��─────────────────────────────┘
```

### Key Design Decisions

1. **Memory-only** — logs are ephemeral and don't accumulate on disk. The existing `.unfade/logs/` directory is for daemon file logs (rotated); the UI ring buffer is a separate, lightweight stream.

2. **Source-colored** — each source gets a distinct color in the log viewer for scanability:
   - daemon: cyan
   - materializer: green
   - intelligence: purple
   - server: gray
   - scheduler: yellow
   - ingest: orange

3. **Expandable detail** — click a log line to expand `detail` field (stack traces, full JSON payloads). Collapsed by default for density.

4. **Level filtering is additive** — selecting "Warn" shows warn + error. Selecting "Debug" shows everything.

5. **No persistence toggle** — if users want persistent logs, they use the file-based daemon logs in `.unfade/logs/`. The UI log viewer is for "what is happening right now" observability only.

### Navigation

- Add "Logs" to the sidebar navigation, grouped under a "System" section alongside Settings
- Icon: terminal/console icon
- Badge: show count of WARN/ERROR entries in last 5 minutes (if > 0)

### Implementation Files

| File | Action |
|---|---|
| `src/services/logs/ring-buffer.ts` | NEW — ring buffer singleton |
| `src/services/logs/types.ts` | NEW — LogEntry interface + source enum |
| `src/server/routes/logs.ts` | NEW — GET /api/logs + SSE /api/logs/stream |
| `src/server/pages/logs.ts` | NEW — /logs page with filters + stream |
| `src/server/http.ts` | MODIFY — register logs routes + page |
| `src/server/pages/layout.ts` | MODIFY — add Logs nav item |
| `src/services/daemon/embedded-daemon.ts` | MODIFY — pipe stderr to ring buffer |
| `src/services/cache/materializer-daemon.ts` | MODIFY — log tick results to ring buffer |
| `src/services/intelligence/engine.ts` | MODIFY — log analyzer runs to ring buffer |
| `src/services/daemon/repo-manager.ts` | MODIFY — log scheduler events to ring buffer |

---

## Appendix: Audit Findings Summary

### Architecture Map (Intended vs Actual)

```
���─────────────────────────────────────────────────────────────┐
│  `unfade` (bare command) — src/entrypoints/cli.ts:171       │
│                                                             │
│  1. ensureInit(cwd) — lightweight, non-interactive          │
│  2. startUnfadeServer(cwd) — HTTP + MCP + materializer      │
│  3. Signal handler (SIGINT/SIGTERM → graceful shutdown)      │
└────────────────────┬────────────────────────────────────────┘
                     │
    ┌────────────────┼────────────────────────┐
    ▼                ▼                        ▼
┌────────┐   ┌──────────────┐   ┌──────────────────────┐
│ HTTP   │   │ RepoManager  │   │ Registry Poller      │
│ :7654  │   │ (per repo):  │   │ (60s interval)       │
│ Hono   │   │  - Daemon    │   └───────────��──────────┘
│ + MCP  │   │  - Material. │
│ + SSE  │   │  - Scheduler │
└────────┘   └────────���─────┘
```

### Data Flow (Implemented)

```
Go Daemon (EmbeddedDaemon)
  └─ writes → .unfade/events/YYYY-MM-DD.jsonl

MaterializerDaemon (every N ms)
  └─ tail-reads JSONL past cursor byte_offset
  └─ upserts → SQLite (unfade.db)
  └─ writeSummary() → .unfade/state/summary.json

SSE stream.ts polls summary.json mtime (2s)
  └─ pushes → connected browsers

Intelligence Engine (throttled, 10s minimum)
  └─ analyzers write → .unfade/intelligence/*.json

Scheduler (cron-like, default 18:00)
  └─ triggers distill() → .unfade/distills/YYYY-MM-DD.md
```

### Validation Matrix

| Expectation | Pre-Fix Status | Post-Fix Status |
|---|---|---|
| Configure LLM once, then autonomous | PARTIAL — silent failure if Ollama absent | FIXED — explicit "none" default + validation |
| UI shows processing/processed/insights | BROKEN — materializer global wrong, ingest invisible | FIXED — 5-state machine + live strip + logs page |
| Auto-detect missing config and guide | MISSING — no web redirect on first run | FIXED — setup-required state gates dashboard |
| Historical processing visible immediately | PARTIAL — ingest triggered but invisible | FIXED — progress bar + `/api/ingest/status` |
| Subsequent runs incremental and clear | CORRECT but opaque | FIXED — resume.json + UI indicator |
| System internals observable | NOT AVAILABLE | NEW — Logs page with real-time component streams |
| Insight-to-source traceability | NOT AVAILABLE — lineage lost at aggregation | NEW — provenance tracking + lineage endpoint |

---

## 9. Data Flow Architecture — Complete Pipeline Map

### 9.1 Overview: End-to-End Data Lifecycle

This section documents the complete, verified data flow from the moment a user types a prompt through to when an insight appears in the dashboard. Every stage is mapped with its input/output schema, storage location, and connection to adjacent stages.

### 9.2 Ingestion Layer (Go Daemon)

The Go daemon (`daemon/cmd/unfaded/`) is a managed child process spawned per registered repo. It watches three categories of sources:

#### Source 1: AI Sessions (Primary)

| Watched Path | Tool | Detection Method |
|---|---|---|
| `~/.claude/projects/**` | Claude Code | File watcher on conversation JSONL |
| `~/.cursor/ai-tracking/**` | Cursor | File watcher on session files |
| `~/.codex/sessions/**` | Codex CLI | File watcher on session dirs |
| `.aider.chat.history.md` | Aider | File watcher on markdown history |

**Capture logic** (`daemon/internal/capture/ai_session.go`):
- Watches for file modifications via fsnotify
- On change: parses conversation structure, classifies turns
- Emits one `CaptureEvent` per classified conversation window
- Attaches `direction_signals`: human_direction_score (0-1), rejection_count, prompt_specificity, modification_after_accept, domain_injection, alternative_evaluation, course_correction

#### Source 2: Git Events

| Signal | Detection |
|---|---|
| Commits | Post-commit hook (installed during setup) |
| Branch changes | File watcher on `.git/HEAD` |
| Rebases | Post-rewrite hook |

**Capture path**: Git hooks invoke `unfade-send` binary → daemon IPC → event written to JSONL

#### Source 3: Terminal Activity

| Signal | Detection |
|---|---|
| Command execution | Shell hook (bash/zsh precmd/preexec) |
| Long-running commands | Duration tracking via hook pairs |

**Capture path**: Shell hooks call `unfade-send <event-json>` → daemon IPC socket → JSONL append

#### Source 4: Historical Ingest (On-Demand)

Triggered via IPC command `{ cmd: "ingest", args: { days: N } }`:
- Scans all known AI tool history directories
- Processes files by modification date (newest first within window)
- Extracts conversation structure using tool-specific parsers
- Emits CaptureEvents with same schema as live capture
- Writes progress to `.unfade/state/ingest.json`: `{ status, totalEvents, startedAt, completedAt }`

### 9.3 Event Schema (Single Source of Truth)

Every captured signal becomes a `CaptureEvent` — defined in both Go (`daemon/internal/capture/event.go`) and TypeScript (`src/schemas/event.ts`):

```
CaptureEvent {
  id: string              // UUID v4
  timestamp: string       // ISO 8601
  source: "git" | "ai-session" | "terminal" | "mcp-active"
  type: string            // e.g. "ai-conversation", "commit", "command"
  content: {
    summary: string       // 1-line human-readable
    detail?: string       // Full payload (conversation text, diff, etc.)
  }
  gitContext?: {
    repo: string          // Repo name
    branch: string        // Current branch
  }
  metadata: Record<string, unknown>  // Source-specific fields:
    // AI sessions: ai_tool, session_id, conversation_id, turn_count, direction_signals, model
    // Git: files_changed, insertions, deletions, message
    // Terminal: command, exit_code, duration_ms
}
```

**Storage**: Appended to `.unfade/events/YYYY-MM-DD.jsonl` (one file per day, append-only, O_APPEND for atomicity)

### 9.4 Materialization Layer (JSONL → SQLite)

#### Cursor Mechanism (`src/services/cache/cursor.ts`)

```
MaterializerCursor {
  schemaVersion: 1
  streams: {
    "events": { file: string, byteOffset: number, lastLineHash: string }
    "decisions": { file: string, byteOffset: number, lastLineHash: string }
    "metrics": { file: string, byteOffset: number, lastLineHash: string }
  }
}
```

- `byteOffset`: UTF-8 byte position in file (Buffer.byteLength per line + 1 for newline)
- `lastLineHash`: SHA-256 truncated to 16 chars of the last processed line
- **Validation**: On resume, reads bytes at cursor position, re-hashes → if mismatch, triggers full rebuild
- **Persistence**: `.unfade/cursor.json` via atomic tmp+rename

#### Incremental Processing (`src/services/cache/materializer.ts`)

On each tick:
1. For each stream (events, decisions, metrics):
   - Open file, seek to `byteOffset`
   - Read remaining bytes as UTF-8 text
   - Split by newline, parse each as JSON
   - Stop on parse error (partial final line from concurrent daemon write)
   - Update cursor byteOffset += Buffer.byteLength(line) + 1 per successful line
2. Upsert parsed rows into SQLite tables (ON CONFLICT REPLACE)
3. Refresh FTS5 index after events batch
4. Save cursor atomically

#### SQLite Schema (10 tables, `src/services/cache/manager.ts`)

| Table | PK | Purpose | Source Stream |
|---|---|---|---|
| `events` | id | Normalized capture events | events/*.jsonl |
| `events_fts` | — | Full-text search index (FTS5) | Mirrors events |
| `decisions` | id | Decision graph nodes | graph/decisions.jsonl |
| `decision_edges` | composite | Decision relationships | graph/decisions.jsonl |
| `metric_snapshots` | date | Daily metric recordings | metrics/daily.jsonl |
| `direction_windows` | window_size+end | Rolling direction aggregates | Computed from events |
| `comprehension_proxy` | event_id | Per-event comprehension scores | Computed from events |
| `comprehension_by_module` | module | Module-level comprehension | Aggregated from proxy |
| `direction_by_file` | path | Per-file direction density | Computed from events |
| `token_proxy_spend` | date+model | Estimated token spend | Computed from events |

### 9.5 Intelligence Pipeline (SQLite → Insights)

#### MaterializerDaemon Tick Loop (`src/services/cache/materializer-daemon.ts`)

```
Every intervalMs:
  1. materializeIncremental(cache, cwd) → newRows count
  2. if newRows > 0:
     a. writeSummary(db, cwd, { pricing }) → state/summary.json
     b. onTick(newRows) → triggers intelligence engine
```

#### Intelligence Engine (`src/services/intelligence/engine.ts`)

- Throttled: minimum 10s between runs
- Registered analyzers (each with minDataPoints threshold):

| Analyzer | Output File | Min Data | What It Computes |
|---|---|---|---|
| Efficiency | `efficiency.json` | 5 events | AI Efficiency Score (acceptance, modification, direction) |
| Cost Attribution | `costs.json` | 3 events | Token spend proxy per model/tool |
| Comprehension Radar | `comprehension.json` | 5 events | Per-module engagement depth |
| Prompt Patterns | `prompt-patterns.json` | 10 events | Recurring prompt structures + outcomes |
| Loop Detector | `rejections.idx.json` | 5 events | Stuck-loop detection (repeated low-direction patterns) |
| Velocity Tracker | `velocity.json` | 14 days | Reasoning velocity trends over time |
| Blind Spots | `alerts.json` | 14 days | Domains with declining engagement |
| Decision Replay | `replays.json` | 30 days | Cross-temporal decision pattern matching |

Each analyzer:
1. Checks event count >= minDataPoints (skip if insufficient)
2. Runs with error isolation (one failure doesn't cascade)
3. Writes result atomically to `.unfade/intelligence/{outputFile}`

#### Window Aggregator (`src/services/intelligence/window-aggregator.ts`)

Computes rolling windows from `events` table:
- Windows: 1h, 8h, 24h, 7d
- Per window: directionDensity (avg HDS × 100), eventCount, toolMix
- Stored in `direction_windows` table (max 4 historical rows per size)

#### Comprehension Scoring (`src/services/intelligence/comprehension.ts`)

Per-event composite score:
```
composite = modDepth × 0.4 + specificity × 0.3 + rejection × 0.3

modDepth = modification_after_accept(+0.4) + course_correction(+0.3) 
         + domain_injection(+0.2) + alternative_evaluation(+0.1)  [cap 1.0]

rejection = count >= 3 → 1.0 | >= 2 → 0.7 | >= 1 → 0.4 | 0
```

Module aggregation: groups by 2-level path prefix, averages scores → 0-100 scale

#### Summary Writer (`src/services/intelligence/summary-writer.ts`)

The **P2 heartbeat** — called every materializer tick with newRows > 0:

```
SummaryJson {
  schemaVersion: 1
  updatedAt: ISO8601
  freshnessMs: 0
  directionDensity24h: number (0-100)
  eventCount24h: number
  comprehensionScore: number | null (0-100)
  topDomain: string | null
  toolMix: Record<string, number>
  reasoningVelocityProxy: number | null (% change 7d)
  firstRunComplete: boolean
  costPerDirectedDecision?: number | null
  costQualityTrend?: "improving" | "stable" | "declining" | null
  todaySpendProxy?: number
  todayDirectedDecisions?: number
}
```

Written atomically to `.unfade/state/summary.json` (< 4KB). This single file powers the dashboard first-paint.

#### Recent Insights (`src/services/intelligence/recent-insights.ts`)

Ring-buffer FIFO (max 100 lines) at `.unfade/insights/recent.jsonl`:
```
{ ts, severity: "info"|"nudge"|"warning", insight_type, claim, metrics }
```

### 9.6 Distillation Pipeline (Daily Synthesis)

Triggered by scheduler (default 18:00) or manual `unfade distill`:

```
Stage 1: Signal Fusion
  → Read events for date, validate non-empty
  → Extract direction signals: averageHDS, classifications, toolBreakdown

Stage 2: Context Linking
  → Parse decisions from graph/decisions.jsonl
  → Link top-5 events per decision as evidenceEventIds (keyword matching)

Stage 3: LLM Synthesis (or structured fallback)
  → Generate narrative: decisions, trade-offs, dead ends, breakthroughs, patterns

Stage 4: Personalization
  → Compute direction style (Architectural Thinker / Collaborative Builder / AI Accelerator)
  → Extract domain depth, detect blind spots

Stage 5: Graph Updates
  → Append decisions to graph/decisions.jsonl with evidenceEventIds
  → Update graph/domains.json with frequency counts

Stage 6: Output
  → Write .unfade/distills/YYYY-MM-DD.md
  → Update metric_snapshots table
  → Append nudge to recent.jsonl (max 1 per distill)
```

### 9.7 Data Surfacing Layer (HTTP + SSE + MCP)

#### SSE Stream (`/api/stream`)
- Polls `state/summary.json` mtime every 2s
- On change: pushes full SummaryJson as `event: summary`
- Every 30 ticks: pushes `event: health` with system metrics

#### HTTP API Endpoints

| Endpoint | Reads From | Returns |
|---|---|---|
| `GET /api/summary` | `state/summary.json` | SummaryJson |
| `GET /api/intelligence/onboarding` | `.unfade/intelligence/*.json` existence | Per-capability readiness |
| `GET /api/insights` | `insights/recent.jsonl` | Recent insight entries |
| `GET /api/distill/:date` | `.unfade/distills/YYYY-MM-DD.md` | Parsed distill content |
| `GET /api/decisions` | SQLite `decisions` table | Decision list with filters |
| `GET /api/decisions/:id` | SQLite + graph files | Decision detail + evidence |
| `GET /api/context` | SQLite events + profile | Contextual reasoning for MCP |
| `GET /api/query` | SQLite FTS5 | Full-text search across events |
| `GET /api/profile` | `state/profiles/v2.json` | Reasoning model + patterns |
| `GET /api/repos` | `registry.v1.json` | Multi-repo status |
| `POST /settings/llm` | Reads + writes `config.json` | LLM config update |

#### MCP Tools (IDE Integration)

| Tool | Data Source | Purpose |
|---|---|---|
| `unfade_query` | SQLite FTS5 | Search reasoning history |
| `unfade_context` | SQLite + profile | Inject prior reasoning into AI tools |
| `unfade_decisions` | Decision graph | List decisions with filters |
| `unfade_comprehension` | Comprehension tables | Module-level understanding |
| `unfade_profile` | Profile JSON | Developer reasoning model |
| `unfade_distill` | Distill files | Daily synthesis content |
| `unfade_costs` | Token proxy table | Spend estimates |
| `unfade_velocity` | Metric snapshots | Reasoning velocity trends |
| `unfade_card` | Multiple sources | Identity card generation |

### 9.8 Checkpointing & Resume Summary

| Component | State File | Resume Behavior |
|---|---|---|
| Materializer | `.unfade/cursor.json` | Byte-offset resume; hash validation; full rebuild on mismatch |
| Ingest | `.unfade/state/ingest.json` | Status-based gate (idle/running/completed/failed) |
| First-run report | `.unfade/state/first-run-report.json` | Existence check — generate once |
| Intelligence engine | `.unfade/intelligence/*.json` | File existence per analyzer; re-runs produce same output |
| Scheduler | In-memory timer | Recomputes next trigger on restart |
| SQLite cache | `.unfade/cache/unfade.db` | Events count check: 0 → rebuild; >0 → incremental |

### 9.9 Architectural Invariants

1. **Idempotency**: All writes use ON CONFLICT REPLACE; re-running for same date/window overwrites safely
2. **Atomic Persistence**: All file writes use tmp+rename (prevents corruption on crash)
3. **Graceful Degradation**: Falls back to JSONL reads if SQLite unavailable; continues on per-analyzer failures
4. **Bounded Cardinality**: Direction windows keep max 4 historical rows; recent insights keep max 100 lines
5. **Error Isolation**: Intelligence engine catches per-analyzer exceptions; materializer skips partial lines
6. **Lazy Initialization**: SQLite loads only on first access; event store parses only requested dates
7. **Single Writer Per File**: Go daemon owns `events/`; TypeScript owns everything else — no cross-write corruption
8. **UTF-8 Correctness**: Buffer.byteLength + 1 per line for accurate cursor positioning with multibyte chars
9. **Schema Versioning**: `schemaVersion` fields in cursor, summary, config enable forward compatibility
10. **Append-Only Source of Truth**: JSONL files are authoritative; SQLite is a derived read cache

---

## 10. Fix 7: Data Lineage & Provenance Tracking

### Problem

**Insights cannot be traced back to their source events.** The pipeline is a one-way funnel: events → aggregation → insights → UI. At each aggregation step, individual event references are lost. A user seeing "Your architecture prompts produce 3x better outcomes" cannot click through to see which specific prompts contributed to that conclusion.

### Root Cause Chain

1. **Window aggregator** computes statistics (avg, count) without retaining contributing event IDs
2. **Intelligence analyzers** produce summary metrics but don't store `sourceEventIds` in output
3. **Distiller Stage 2** links `evidenceEventIds` to decisions — but this is the ONLY place lineage is preserved
4. **API responses** return computed data without provenance metadata
5. **MCP tools** return tool responses without trace-back links
6. **Recent insights** store `claim` + `metrics` but not `derivedFromEvents[]`

### What Currently Works (Partial Lineage)

- Distiller's `evidenceEventIds` links decisions → source events (keyword matching, top 5)
- SQLite `events` table preserves all original event data (queryable by ID)
- FTS5 enables text-based search to manually correlate insights with events
- Timestamps allow temporal correlation (same day, same hour)

### What's Missing (Critical Gaps)

| Gap | Impact |
|---|---|
| Analyzer outputs lack `sourceEventIds` | Cannot explain why an efficiency score changed |
| Comprehension scores lack event references | Cannot show which interactions improved module understanding |
| Window aggregates are pure statistics | Cannot drill into "which 12 events made up the 73% direction density" |
| Recent insights lack provenance | "Loop detected" without pointing to the specific stuck interactions |
| Cost attribution lacks event mapping | "You spent $14 today" without showing which sessions cost what |

### Remediation

#### 1. Provenance Schema Extension

Add to all intelligence output files:
```typescript
interface ProvenanceMetadata {
  computedAt: string;           // ISO 8601
  windowStart: string;          // Time range start
  windowEnd: string;            // Time range end
  sourceEventCount: number;     // How many events contributed
  sourceEventIds: string[];     // Up to 20 most relevant event IDs
  confidence: number;           // 0-1 confidence in the computation
  algorithm: string;            // Which computation produced this
}
```

#### 2. Analyzer Output Extension

Every analyzer in `src/services/intelligence/analyzers/` must include:
- `_provenance: ProvenanceMetadata` in its output JSON
- Top-N event IDs that most influenced the result (N=20 max for bounded size)

Selection heuristic per analyzer:
- **Efficiency**: Events with highest/lowest HDS (show the range)
- **Comprehension**: Events with highest composite scores per module
- **Cost**: Events with `metadata.model` field (cost-bearing interactions)
- **Loop Detector**: Events matching the stuck pattern
- **Velocity**: Events at trend inflection points

#### 3. Lineage Endpoint

New route: `GET /api/lineage/:insightId`

```typescript
// Response:
{
  insight: { type, claim, metrics, computedAt },
  sourceEvents: CaptureEvent[],       // Full event objects (up to 20)
  transformationChain: [
    { stage: "capture", timestamp: "...", source: "ai-session" },
    { stage: "materialize", timestamp: "...", cursor: "byte 12340" },
    { stage: "analyze", timestamp: "...", analyzer: "efficiency" },
    { stage: "insight", timestamp: "...", claim: "..." }
  ],
  relatedInsights: string[]           // Other insights from same event set
}
```

#### 4. Bidirectional Index

New SQLite table: `event_insight_map`
```sql
CREATE TABLE event_insight_map (
  event_id TEXT NOT NULL,
  insight_id TEXT NOT NULL,
  analyzer TEXT NOT NULL,
  contribution_weight REAL,  -- 0-1 how much this event contributed
  computed_at TEXT,
  PRIMARY KEY (event_id, insight_id)
);
CREATE INDEX idx_eim_insight ON event_insight_map(insight_id);
```

Written by each analyzer after computing results. Enables:
- Forward query: "What insights did this event contribute to?"
- Reverse query: "What events produced this insight?"

#### 5. UI Integration

**Insight cards** (home page, intelligence page) gain a "View sources" affordance:
- Click → drawer slides from right (50% width, per RRVV UI spec)
- Shows transformation chain as vertical timeline
- Lists source events with expandable detail (prompt text, response summary)
- Highlights the specific signal that triggered the insight (e.g., "HDS dropped to 0.2 in this interaction")

**Event stream** (live page) gains reverse indicators:
- Events that contributed to active insights show a small badge: "Used in: Efficiency Score, Loop Detection"
- Click badge → links to the insight page

#### 6. MCP Tool Provenance

All MCP tool responses gain optional `_provenance` in `_meta`:
```typescript
{
  data: { ... },
  _meta: {
    tool: "unfade_context",
    durationMs: 12,
    _provenance: {
      sourceEventCount: 8,
      windowRange: "2026-04-13 to 2026-04-20",
      confidence: 0.85
    }
  }
}
```

This allows AI tools consuming Unfade context to assess confidence and freshness.

### Implementation Files

| File | Action |
|---|---|
| `src/schemas/provenance.ts` | NEW — ProvenanceMetadata schema |
| `src/services/cache/manager.ts` | MODIFY — add `event_insight_map` table |
| `src/services/intelligence/engine.ts` | MODIFY — pass provenance to analyzer outputs |
| `src/services/intelligence/analyzers/*.ts` | MODIFY — collect and return sourceEventIds |
| `src/server/routes/lineage.ts` | NEW — `/api/lineage/:id` endpoint |
| `src/server/http.ts` | MODIFY — register lineage route |
| `src/services/mcp/tools.ts` | MODIFY — add `_provenance` to `_meta` |
| `src/services/intelligence/recent-insights.ts` | MODIFY — include sourceEventIds in entries |

### Validation Criteria

After implementation, a user must be able to:
1. See an insight on the home page (e.g., "Direction density: 73%")
2. Click "View sources" → see the 12 specific AI interactions that contributed
3. Click any source event → see the full prompt/response text
4. Understand why the number is 73% (which events were high-direction, which were low)
5. From any event in the live stream, see what insights it has contributed to

---

## 11. OSS Infrastructure Integration Plan

> **Method:** RRVV (Rigorous Research → Reason → Validate → Execute)
>
> **Goal:** Replace fragile custom implementations with proven, production-grade open-source tools — improving reliability, observability, and development velocity while preserving full transparency and local-first architecture.

### 11.1 Current State Assessment

#### Dependency Inventory

**Node.js runtime (`package.json`):**

| Category | Current Tool | Limitation |
|---|---|---|
| SQLite | `sql.js` (WASM) | 5-10x slower than native; no prepared statements; async overhead for sync operations; 500KB WASM bundle |
| Logging | Custom 79-line Logger class | No structured output (human-colored only); no child loggers; no context propagation; no JSON mode for machine parsing |
| Scheduling | Custom setTimeout chain (138 lines) | Manual cron parsing; manual jitter; manual reschedule; no timezone handling; no missed-fire detection |
| File watching | `setInterval` polling in MaterializerDaemon | Latency = poll interval (currently ~2s); CPU waste when idle; no debouncing |
| HTTP/SSE | Hono + `@hono/node-server` | ✅ Correct choice — lightweight, fast, TypeScript-native |
| Process management | Custom `EmbeddedDaemon` class | ✅ Correct choice — exponential backoff, graceful shutdown |
| Event streaming | JSONL + cursor-based tailing | ✅ Correct choice — inspectable, greppable, crash-safe |
| CLI framework | Commander.js | ✅ Correct choice — mature, typed |
| AI/LLM | Vercel AI SDK + provider packages | ✅ Correct choice — provider-agnostic, streaming |
| Prompts | @clack/prompts | ✅ Correct choice — beautiful interactive prompts |

**Go daemon (`daemon/go.mod`):**

| Category | Current Tool | Status |
|---|---|---|
| File watching | `fsnotify/fsnotify` | ✅ Correct — standard Go file watcher |
| SQLite | `modernc.org/sqlite` (pure Go) | ✅ Correct — no CGo, cross-compiles cleanly |
| UUIDs | `google/uuid` | ✅ Correct |
| Terminal | `mattn/go-isatty` | ✅ Correct |

#### Architecture Constraints

Any replacement must satisfy:

1. **Local-first**: No cloud services, no network dependencies, no external databases
2. **Single binary distribution**: Node.js bundle (`dist/cli.mjs`) + Go binaries per platform
3. **stdout is sacred**: Logging MUST go to stderr (MCP JSON-RPC owns stdout)
4. **< 5MB install footprint** (excluding node_modules)
5. **No native addon complexity** unless prebuilt binaries are available for darwin-arm64, darwin-x64, linux-x64, linux-arm64
6. **Works in daemon mode**: Must support long-running always-on process, not request-response

### 11.2 Build vs. Integrate Decision Matrix

| Subsystem | Current | Verdict | Rationale |
|---|---|---|---|
| **Event streaming** | JSONL + cursor | **KEEP CUSTOM** | The file-as-IPC pattern is a core architectural decision, not a limitation. Go writes JSONL, Node reads — inspectable, no IPC complexity, crash-safe append-only semantics. No library improves on this for the specific use case. |
| **Pipeline orchestration** | Sequential function calls | **KEEP CUSTOM** | The pipeline (materialize → analyze → summarize) is 3 steps with no branching, no parallelism, no retries needed. A workflow engine (Temporal, Inngest) would add 100MB+ for zero functional benefit. |
| **SQLite driver** | sql.js (WASM) | **REPLACE → better-sqlite3 + Drizzle ORM** | Highest-impact upgrade. WASM is 5-10x slower on bulk upserts (materializer ticks). Drizzle gives typed queries, schema-as-code, and auto-migrations — aligning with Zod-as-source-of-truth convention. |
| **Logging** | Custom class | **REPLACE → Pino** | Structured JSON logging, child loggers with context, 6x faster writes, native stderr destination, log-level filtering — all things the current 79-line class lacks. Direct enabler of Fix 6 (System Logs UI). |
| **Scheduling** | Custom setTimeout chain | **REPLACE → Croner** | Zero-dependency cron library. Replaces 138 lines of manual parsing, jitter, and rescheduling with 3 lines. Better timezone handling, missed-fire detection. |
| **File watching** | setInterval polling | **ADD → chokidar v5** | Enables reactive materialization (process events within milliseconds of write) instead of waiting for next poll tick. Reduces latency and CPU waste. |
| **SSE** | Hono streamSSE() | **KEEP** | Already correct. Built-in, lightweight, spec-compliant. |
| **Process management** | Custom EmbeddedDaemon | **KEEP** | Well-engineered. Exponential backoff, crash counter, graceful shutdown. No library improves on this for managing a single Go child process. |
| **Checkpointing** | Custom cursor.ts | **KEEP** | Production-grade. Byte offset + SHA-256 hash validation + atomic persistence. No off-the-shelf library handles this specific JSONL-tailing-with-resume pattern. |
| **UI components** | Server-rendered HTML | **KEEP + ENHANCE** | No frontend framework needed. For log viewer, use plain SSE + server-rendered HTML (already working). Add uPlot for lightweight charts if needed. |

### 11.3 Recommended Replacements — Detailed

---

#### Upgrade 1: sql.js → better-sqlite3 + Drizzle ORM (Tracker #16)

**What changes:**

| Aspect | Before | After |
|---|---|---|
| SQLite engine | WASM (sql.js, 500KB) | Native C++ (better-sqlite3, prebuilt binaries) |
| Query style | Raw SQL strings | Type-safe Drizzle queries |
| Schema management | Hand-written `CREATE TABLE` in manager.ts | `drizzle-kit` migrations from TypeScript schema |
| Performance | Async WASM calls, no prepared statements | Synchronous, prepared statement cache, 5-10x faster |
| Type safety | Cast `result[0]?.values[0]?.[0] as number` | Inferred types from schema: `db.select().from(events).where(...)` |

**Why better-sqlite3 over sql.js:**
- The materializer does bulk INSERT OR REPLACE on every tick (every ~2s). Synchronous better-sqlite3 with prepared statements handles this in <1ms vs sql.js's 5-15ms WASM overhead.
- `better-sqlite3` ships prebuilt binaries for all 4 target platforms via `prebuild-install` — no native compilation needed at install time.
- Every Node.js application at scale (Obsidian, Linear local cache, Notion offline, Bun's SQLite) uses better-sqlite3, not sql.js.

**Why Drizzle ORM:**
- Schema-as-code aligns with the project's "Zod schemas are source of truth" convention
- Type inference eliminates the unsafe `result[0]?.values[0]?.[0] as number` pattern
- `drizzle-kit generate` produces versioned SQL migration files (deterministic, inspectable)
- Zero runtime overhead — queries compile to raw SQL at build time
- Integrates directly with better-sqlite3 via `drizzle-orm/better-sqlite3`

**Migration path:**
1. Add `better-sqlite3` + `drizzle-orm` + `drizzle-kit` to dependencies
2. Define schema in `src/services/cache/schema.ts` using Drizzle's table definitions
3. Generate initial migration from existing hand-written schema
4. Replace `CacheManager` internals: swap `sql.js` database instance for `drizzle(betterSqlite3(path))`
5. Update `materializer.ts` to use Drizzle insert/upsert syntax
6. Update all analyzer queries to use Drizzle select syntax
7. Remove `sql.js` dependency

**Risk assessment:**
- Medium risk: `better-sqlite3` requires prebuilt binaries per platform. If a platform lacks a prebuilt, fallback to sql.js WASM.
- Mitigation: Ship both drivers, select at runtime: `const driver = hasNativeAddon ? betterSqlite3 : sqlJs`
- Testing: Run full materializer test suite against both drivers during transition

**Packages:**
```
dependencies:
  better-sqlite3: ^11.0.0
  drizzle-orm: ^0.36.0

devDependencies:
  drizzle-kit: ^0.28.0
  @types/better-sqlite3: ^7.6.0
```

---

#### Upgrade 2: Custom Logger → Pino (Tracker #17)

**What changes:**

| Aspect | Before | After |
|---|---|---|
| Output format | Human-colored (chalk) | Structured JSON (machine-parseable) + pino-pretty for dev |
| Performance | ~36K ops/sec (process.stderr.write) | ~222K ops/sec (Pino's sonic-boom writer) |
| Context | Flat `data` object per call | Child loggers with inherited context: `logger.child({ component: 'materializer', repo: name })` |
| Levels | Basic 4 levels | Same 4 + `trace` + `fatal` |
| Destinations | stderr only | stderr + ring buffer integration for UI logs page |
| Machine parsing | Requires regex to parse colored output | JSON by default — direct feed to ring buffer as structured LogEntry objects |

**Why Pino:**
- The highest-throughput Node.js logger (benchmarked at 6x Winston, 200x Bunyan)
- `pino.destination(2)` writes to fd 2 (stderr) — satisfies "stdout is sacred" invariant
- Child loggers propagate component context without manual concatenation
- JSON output enables Fix 6 (System Logs UI) — ring buffer receives pre-structured entries instead of parsing colored strings
- `pino-pretty` as dev transport gives the same human-readable colored output during development

**Migration path:**
1. Add `pino` + `pino-pretty` dependencies
2. Rewrite `src/utils/logger.ts` to create Pino instance with stderr destination
3. Export same API shape: `logger.info(message, data)` → `pino.info(data, message)` (note: Pino swaps arg order)
4. Add `Logger.child()` method for component-scoped loggers
5. Add ring buffer integration: custom Pino transport that also writes to in-memory ring buffer
6. Remove `chalk` dependency (Pino handles its own formatting via pino-pretty)

**Integration with Fix 6 (System Logs UI):**
```typescript
// Custom Pino destination that also feeds ring buffer
import { ringBuffer } from '../services/logs/ring-buffer.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      { target: 'pino-pretty', options: { destination: 2 } },  // stderr (dev)
      { target: './pino-ring-transport', options: {} }           // ring buffer
    ]
  }
});
```

**Risk assessment:**
- Low risk: API is nearly 1:1 with current logger. Biggest change is argument order.
- `chalk` may still be needed for CLI output (spinners, banners) — keep as dependency but remove from logger path.

**Packages:**
```
dependencies:
  pino: ^9.0.0

devDependencies:
  pino-pretty: ^13.0.0
```

---

#### Upgrade 3: Custom Scheduler → Croner (Tracker #18)

**What changes:**

| Aspect | Before | After |
|---|---|---|
| Implementation | 138-line custom setTimeout chain | 3-line Croner invocation |
| Cron parsing | Hand-written regex (partial cron support) | Full cron syntax including seconds, @yearly, etc. |
| Timezone | Implicit (local) | Explicit timezone parameter |
| Missed fires | Not detected (if server was down at trigger time) | `startAt` option + interval check on resume |
| Jitter | Custom ±5min random offset | Pre-delay in callback (keep existing approach) |
| Stop/resume | Custom `clearTimeout` handle | `job.stop()` / `job.resume()` |

**Why Croner:**
- Zero dependencies (crucial for CLI tool bundle size)
- < 20KB minified
- TypeScript types built-in
- Used by PM2 (80K+ stars), Uptime Kuma, and other production tools
- Handles edge cases (DST transitions, leap seconds) that the custom parser doesn't

**Migration path:**
1. Add `croner` dependency
2. Replace `src/services/scheduler/scheduler.ts` with Croner-based implementation:
   ```typescript
   import { Cron } from 'croner';
   
   export function startScheduler(cwd: string, config: UnfadeConfig): SchedulerHandle {
     const schedule = config.distill?.schedule || '0 18 * * *';
     const job = new Cron(schedule, { timezone: 'local' }, async () => {
       const jitter = Math.random() * JITTER_RANGE_MS * 2 - JITTER_RANGE_MS;
       await new Promise(r => setTimeout(r, Math.max(0, jitter)));
       
       const today = new Date().toISOString().slice(0, 10);
       const events = countEvents(cwd, today);
       if (events === 0) { logger.debug('Skip distill: zero events'); return; }
       
       await distill(today, config, { cwd });
     });
     
     return { stop: () => job.stop(), nextTrigger: job.nextRun()?.toISOString() ?? '' };
   }
   ```
3. Remove `parseScheduleTime()`, `computeNextTrigger()`, `scheduleNext()` helper functions (now handled by Croner)
4. Keep `SchedulerHandle` interface unchanged for consumers

**Risk assessment:**
- Very low risk. Drop-in replacement with identical external behavior.
- Fallback: If Croner has issues, revert to custom (git revert).

**Package:**
```
dependencies:
  croner: ^9.0.0
```

---

#### Upgrade 4: Polling → chokidar for Reactive Materialization (Tracker #19)

**What changes:**

| Aspect | Before | After |
|---|---|---|
| Trigger mechanism | `setInterval` every N ms | File change event (fsevents on macOS, inotify on Linux) |
| Latency | 0–2000ms (depends on where in polling cycle) | < 50ms (OS-level notification) |
| CPU when idle | Constant wake-ups every tick | Zero CPU when no events arriving |
| Debouncing | N/A (processes whatever accumulated since last tick) | Built-in debounce: batch rapid writes into single materialization pass |

**Why chokidar v5:**
- ESM-only (matches project's ESM-first approach)
- Node 20+ (matches project's engine requirement)
- Uses native OS watchers (fsevents on macOS — already in Go daemon's fsnotify)
- 30M+ weekly downloads, battle-tested
- Minimal: no polling by default (only falls back to polling on NFS/network mounts)

**Architecture:**
```
MaterializerDaemon (current):
  setInterval(tick, 2000)  →  tick()  →  materializeIncremental()

MaterializerDaemon (proposed):
  chokidar.watch('.unfade/events/')
    .on('change', debounce(tick, 100))  // 100ms debounce for rapid writes
    .on('add', debounce(tick, 100))     // new daily JSONL file created
  
  // Keep setInterval as fallback heartbeat (30s) for:
  //   - Health checks (summary.json freshness)
  //   - Missed watcher events (rare but possible)
  //   - Intelligence engine throttle enforcement
```

**Migration path:**
1. Add `chokidar` dependency
2. In `MaterializerDaemon.start()`:
   - Initialize chokidar watcher on events directory
   - On `change`/`add` events → debounced `tick()` call
   - Keep a slow heartbeat interval (30s) for health/freshness
3. In `MaterializerDaemon.close()`:
   - `await watcher.close()` before cursor save
4. Keep the existing `tick()` function unchanged — only the trigger mechanism changes

**Risk assessment:**
- Low risk: chokidar is the most battle-tested Node.js file watcher
- Edge case: If watcher fails (permissions, NFS), the 30s heartbeat fallback ensures processing still happens
- The existing cursor mechanism guarantees no data loss regardless of trigger timing

**Package:**
```
dependencies:
  chokidar: ^5.0.0
```

### 11.4 Validated "Keep Custom" Decisions

These components were evaluated and deliberately retained:

#### JSONL + Cursor Event Streaming

**Alternatives considered:** BullMQ (requires Redis), embedded NATS (requires separate binary), ZeroMQ (native addon complexity), LevelDB-backed queue

**Why keep:**
- The `.unfade/` directory as communication bus is a core architectural decision, not a hack
- JSONL is inspectable (`cat`, `grep`, `jq`), debuggable, and corruption-resistant (append-only, O_APPEND)
- The cursor system (`cursor.ts`) is production-grade: byte offset + SHA-256 hash + atomic persistence
- No message broker adds value when the communication is between exactly 2 processes on one machine via filesystem
- Users can read their own data without any special tooling

#### EmbeddedDaemon Process Management

**Alternatives considered:** PM2 programmatic API, execa, node-clinic, pidtree

**Why keep:**
- 172 lines, single-purpose, well-tested behavior
- Exponential backoff with stable-threshold reset is exactly right for crash recovery
- `execa` would be a lateral move (different API, same functionality)
- PM2 is a 50MB install designed for production server fleets, not a single child process

#### Hono + streamSSE

**Alternatives considered:** Express + better-sse, Fastify + @fastify/sse, raw http module

**Why keep:**
- Hono is the lightest full-featured web framework for Node.js
- `streamSSE()` is built-in and spec-compliant
- The current SSE implementation is 73 lines and functionally correct
- Switching frameworks would rewrite 17+ page routes for zero functional gain

#### Server-Rendered HTML (No Frontend Framework)

**Alternatives considered:** React (already a dependency), Preact, htmx, SolidJS

**Why keep:**
- Zero frontend build step = zero frontend build bugs
- HTML is served once, then SSE pushes data updates (progressive enhancement)
- React is only used for `satori` (server-side image generation for cards), not UI rendering
- Adding a frontend framework would require: bundler config, hydration, state management — all for a localhost tool

### 11.5 Phased Migration Strategy

```
Phase A: Foundation (Week 1-2)
├── A.1: Add better-sqlite3 + Drizzle alongside existing sql.js
├── A.2: Define Drizzle schema mirroring current 10 tables
├── A.3: Run dual-driver tests (both produce identical results)
└── A.4: Switch default driver to better-sqlite3 (keep sql.js as fallback)

Phase B: Observability (Week 2-3)
├── B.1: Replace custom logger with Pino (stderr + JSON)
├── B.2: Add child loggers to materializer, intelligence, daemon
├── B.3: Create ring buffer transport (Pino → in-memory LogEntry[])
└── B.4: Implement Fix 6 (System Logs UI page) using ring buffer

Phase C: Reactivity (Week 3-4)
├── C.1: Add chokidar watcher on events directory
├── C.2: Convert MaterializerDaemon from polling to event-driven
├── C.3: Keep 30s heartbeat as fallback
└── C.4: Measure latency improvement (target: < 100ms event-to-dashboard)

Phase D: Cleanup (Week 4)
├── D.1: Replace custom scheduler with Croner
├── D.2: Remove sql.js (after confirming better-sqlite3 stable on all platforms)
├── D.3: Remove chalk from logger path (keep for CLI spinners only)
└── D.4: Final bundle size comparison
```

#### Dependencies Between Phases

```
A ─────────────────→ D.2 (remove sql.js after stable switch)
B.1 ──→ B.3 ──→ B.4 (logger before ring buffer before UI)
C is independent (can run in parallel with B)
D.1 is independent (can run anytime)
```

### 11.6 Interface Boundaries

Each upgrade introduces a clean interface boundary to ensure modularity:

```typescript
// 1. Database layer — consumers never import better-sqlite3 directly
// File: src/services/cache/db.ts
export interface UnfadeDb {
  select<T>(query: DrizzleQuery): T[];
  insert(table: TableRef, values: Record<string, unknown>): void;
  upsert(table: TableRef, values: Record<string, unknown>, conflictTarget: string): void;
  transaction<T>(fn: (tx: UnfadeDb) => T): T;
  raw(sql: string, params?: unknown[]): unknown[][];  // escape hatch
  close(): void;
}

// 2. Logger — consumers import from utils/logger.ts (unchanged API surface)
// File: src/utils/logger.ts
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;  // NEW
}

// 3. Scheduler — consumers get same SchedulerHandle (unchanged)
// File: src/services/scheduler/scheduler.ts
export interface SchedulerHandle {
  stop: () => void;
  nextTrigger: string;
}

// 4. File watcher — internal to materializer (not exposed)
// MaterializerDaemon consumers are unaffected by trigger mechanism change
```

### 11.7 Bundle Impact Analysis

| Change | Added | Removed | Net |
|---|---|---|---|
| better-sqlite3 (prebuilt binary) | ~8MB per platform (shipped in optional deps) | sql.js WASM (~500KB) | +7.5MB per platform ¹ |
| drizzle-orm | ~50KB | Raw SQL strings (0KB lib) | +50KB |
| Pino + pino-pretty | ~350KB | chalk usage in logger (~100KB shared) | +250KB |
| Croner | ~20KB | 138 lines custom (~5KB) | +15KB |
| chokidar v5 | ~30KB | — | +30KB |
| **Total runtime bundle change** | | | **+345KB** (excl. native binaries) |

¹ Native binaries are in `optionalDependencies` (platform-specific packages), same pattern already used for Go daemon binaries.

### 11.8 Risk Assessment & Fallbacks

| Upgrade | Risk Level | Failure Mode | Fallback |
|---|---|---|---|
| better-sqlite3 | Medium | Missing prebuilt for exotic platform | Keep sql.js as runtime fallback; feature-detect at startup |
| Drizzle ORM | Low | Query builder bug | Drizzle supports `.sql\`raw query\`` escape hatch; can mix raw SQL |
| Pino | Low | Log format breaks existing parsers | None — no existing parsers depend on format (logs go to stderr) |
| Croner | Very Low | Scheduling bug | Trivial to revert (single file change) |
| chokidar | Low | Watcher fails silently | 30s heartbeat interval ensures processing continues; alert on watcher error |

### 11.9 Tools Explicitly Rejected

| Tool | Category | Reason for Rejection |
|---|---|---|
| **Temporal** | Workflow engine | 100MB+ runtime. Overkill for a 3-step sequential pipeline. Requires separate server process. |
| **BullMQ** | Job queue | Requires Redis. Unfade is local-first — no external services. |
| **Embedded NATS** | Event bus | No official embedded Node server. Would add another child process to manage. |
| **ZeroMQ** | IPC | Native addon with complex build matrix. JSONL is simpler and inspectable. |
| **Winston** | Logger | 3-8x slower than Pino. Heavier. No compelling advantage for this use case. |
| **Agenda** | Scheduler | Requires MongoDB. Local-first violation. |
| **PM2** | Process mgmt | 50MB install. Designed for fleets, not a single managed child process. |
| **Express** | HTTP | Heavier than Hono, slower, more middleware overhead. Already on Hono. |
| **React (for UI)** | Frontend | Would require build step, hydration, state management. Localhost tool doesn't need SPA complexity. |
| **OpenTelemetry** | Tracing | ~2MB of packages, significant setup. Valuable later, but Pino structured logging solves the immediate need. |
| **Bree** | Scheduler | Worker threads add complexity. Daily distill is a single async function, not an isolated job. |
| **@parcel/watcher** | File watching | Native C++ addon overkill for watching a single directory with ~5 files. |
| **xterm.js** | Log viewer | 400KB+ bundle for terminal emulation. Plain HTML log viewer with SSE is sufficient. |
| **Tremor** | Dashboard | 500KB+ Tailwind-based charts. Server-rendered HTML + uPlot (~35KB) if charts needed later. |

### 11.10 Validation Criteria

After all 4 upgrades are implemented, the system must satisfy:

| Criterion | Measurement |
|---|---|
| **Performance**: Materializer tick time | < 5ms for 100-event batch (currently 15-30ms with sql.js WASM) |
| **Latency**: Event write → dashboard update | < 200ms (currently 0-2000ms polling) |
| **Observability**: Structured logs parseable | `JSON.parse(logLine)` succeeds for every non-pretty log entry |
| **Observability**: Log viewer functional | System Logs page shows live, filterable component logs |
| **Scheduling**: Distill triggers reliably | Croner fires within ±5min of configured time including jitter |
| **Resilience**: Watcher failure recovery | Materialization continues via heartbeat if chokidar fails |
| **Compatibility**: All platforms work | better-sqlite3 prebuilds exist for darwin-arm64, darwin-x64, linux-x64, linux-arm64 |
| **Bundle size**: Acceptable growth | < 500KB increase to main bundle (excluding platform-specific native addons) |
| **API stability**: No consumer breakage | All existing `logger.info()`, `SchedulerHandle`, and `CacheManager` consumers work without changes |
| **Data integrity**: Zero-loss migration | Running materializer with Drizzle produces byte-identical SQLite state as sql.js for same input |

---

## 12. Zero-Friction Redesign

> **Implemented:** 2026-04-20. Tracker items #20–26. Removes `unfade init`, introduces browser-first onboarding, one-click MCP integration, and dedicated Integrations page.

### 12.1 Problem Statement

The system had **two parallel initialization paths** creating decision paralysis:
1. `lightweight-init.ts` — auto-called by bare `unfade` (non-interactive, fast)
2. `runner.ts` via `unfade init` — interactive 4-step wizard doing the **same scaffolding** plus an LLM wizard

The ONLY additional value of `unfade init` was the interactive LLM wizard, which the dashboard Settings page already provided. MCP integration required 6+ manual steps (read snippet → find file → open → paste → save → restart IDE).

### 12.2 Design Principles

1. **Single command philosophy** — `unfade` is the entire product
2. **System knows what you need** — first run auto-opens browser, shows contextual setup
3. **Progressive disclosure** — Setup Guide on first run → Integrations page for ongoing → Settings for advanced
4. **Zero copy-paste** — MCP integration is button-click, not documentation reading
5. **No dead-end states** — every screen has a clear next action

### 12.3 New First-Run Flow

```
User types: unfade
  → lightweight-init.ts scaffolds .unfade/ (unchanged)
  → Server starts on :7654
  → First run: auto-open browser to localhost:7654
  → Dashboard shows Setup Guide (/setup):
      Step 1: "Your capture engine is running ✓" (automatic)
      Step 2: "Connect your AI tools" → one-click MCP buttons
      Step 3: "Configure intelligence" → LLM provider form (inline)
  → After setup complete: redirects to Home with live data
```

### 12.4 One-Click MCP Integration

When user clicks "Add to Cursor":
1. Backend reads `~/.cursor/mcp.json` (or creates it)
2. Merges the unfade MCP server config into it
3. Returns success/failure to UI
4. UI shows green checkmark + "Restart Cursor to activate"

**Supported tools and config paths:**

| Tool | Config Path | Key |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `mcpServers.unfade` |
| Cursor | `~/.cursor/mcp.json` | `mcpServers.unfade` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers.unfade` |

**API:** `POST /api/integrations/install` (body: `{ tool }`) + `GET /api/integrations/status`

### 12.5 Files Changed

| Action | Files |
|---|---|
| Deleted | `src/commands/init.ts`, `src/services/init/runner.ts`, `src/services/init/progress.ts`, `src/services/init/renderer.ts`, `src/services/init/llm-wizard.ts`, `src/services/init/llm-detect.ts`, `src/services/init/fingerprint.ts`, `src/services/init/enterprise/` |
| Created | `src/utils/open.ts`, `src/server/pages/setup.ts`, `src/server/routes/integrations.ts`, `src/server/pages/integrations.ts` |
| Modified | `src/entrypoints/cli.ts`, `src/server/http.ts`, `src/server/pages/layout.ts`, `src/server/pages/settings.ts`, `src/server/icons.ts`, `src/constants/terminology.ts`, `src/commands/ingest.ts`, `src/commands/export.ts`, `src/commands/publish.ts`, `src/commands/daemon.ts`, `src/server/pages/portfolio.ts` |

### 12.6 Comparison with Industry Standard

| Product | Entry Command | Init Behavior |
|---|---|---|
| Next.js | `next dev` | Self-creates if missing |
| Vercel CLI | `vercel` | Detects project, links, deploys — no separate init |
| Turborepo | `turbo` | Auto-detects workspace |
| **Unfade** | `unfade` | Auto-scaffolds, starts server, opens guided setup |

---

## 13. Dead Code & Version Cruft Elimination

> **Purpose:** Remove all migration infrastructure, v1 compatibility code, and unused modules. Since Unfade is pre-release with no external users, there is no data to migrate — only the current (latest) version of each schema should exist.
>
> **Status:** PLANNED
>
> **Created:** 2026-04-21

### 13.1 Problem Statement

The codebase carries migration infrastructure and dual-version handling from a time when backwards compatibility was anticipated. Since no external users exist and `.unfade/` data can be regenerated at will, this code is pure dead weight:

- **Two migration files** that are never imported from production code
- **v1 profile format** (`ReasoningProfile`) still written alongside v2 on every distill
- **Config schema accepts `version: 1`** even though nothing produces it
- **Entire files** that are never imported from `src/` (only from tests)
- **No-op stubs** left over from deleted features

### 13.2 Audit Findings

#### Category A: Migration Infrastructure (completely dead)

| File | What It Does | Evidence It's Dead |
|---|---|---|
| `src/config/config-migrations.ts` | Config v1→v2 migration runner | Zero imports from `src/` — only test files import it |
| `src/config/migrations.ts` | Profile v1→v2 migration (180 lines) | Zero imports from `src/` — only test files import it |
| `test/config/config-migrations.test.ts` | Tests for dead migration code | Tests dead code |
| `test/config/migrations.test.ts` | Tests for dead migration code | Tests dead code |

#### Category B: v1 Profile Code (still called, but unnecessary)

| Location | What | Why Dead |
|---|---|---|
| `src/services/personalization/profile-builder.ts:28-55` | `ReasoningProfile` interface (v1) + `defaultProfile()` | Only exists so `updateProfile()` can write v1 alongside v2 |
| `src/services/personalization/profile-builder.ts:56-76` | `loadProfile()` — reads v1 format | Only used by v1 `updateProfile()` |
| `src/services/personalization/profile-builder.ts:88-141` | `detectPatternsV1()` — v1 pattern detection | Only used by v1 `updateProfile()` |
| `src/services/personalization/profile-builder.ts:147-237` | `updateProfile()` — writes v1 profile to disk | Called from `distiller.ts:127` but immediately superseded by v2 write on next line |
| `src/services/distill/distiller.ts:127` | `updateProfile(result, signals, cwd)` | Writes v1 file that is never read by any live code path |
| `src/tools/unfade-profile.ts:43-50` | `v1ToProfileData()` — handles v1 profile reads | Fallback path that should never trigger if we only write v2 |
| `src/services/personalization/context-shaper.ts` | Entire file — uses `ReasoningProfile` (v1 only) | Zero imports from `src/`. Only test imports it. Never actually used. |

#### Category C: Unused Modules (never imported from src/)

| File | Lines | Evidence |
|---|---|---|
| `src/services/init/scaffold.ts` | 127 | Zero imports from `src/`. Superseded by `lightweight-init.ts:scaffoldMinimal()` |
| `src/services/otel/exporter.ts` | ~50 | Zero imports from anywhere in `src/`. Config field `otel` exists but nothing reads it |
| `src/services/personalization/context-shaper.ts` | ~100 | Zero imports from `src/`. Only test file imports it |

#### Category D: No-op Stubs

| File | What | Why |
|---|---|---|
| `src/services/init/autostart.ts` | 4 exported functions that all return false/no-op | Leftover from daemon-based model. `reset.ts` calls them but they do nothing. |

#### Category E: Schema Cruft

| Location | What | Fix |
|---|---|---|
| `src/schemas/config.ts:58` | `version: z.union([z.literal(1), z.literal(2)]).default(2)` | Should be `z.literal(2).default(2)` — no v1 configs exist |
| `src/schemas/config.ts:64` | `otel: OtelSchema.optional()` | Config field for unused otel module |
| `src/schemas/profile.ts:4` | Comment: "v1 interface lives in profile-builder.ts for backward compatibility" | Remove reference |

### 13.3 Implementation Plan

#### Step 1: Remove migration infrastructure

```
DELETE src/config/config-migrations.ts
DELETE src/config/migrations.ts
DELETE test/config/config-migrations.test.ts
DELETE test/config/migrations.test.ts
```

No code in `src/` imports these. Only tests reference them.

#### Step 2: Remove v1 profile writer from distiller

```
In src/services/distill/distiller.ts:
  - Remove import of `updateProfile` (keep `updateProfileV2`)
  - Remove line: updateProfile(result, signals, cwd)
  - The v2 writer already does everything v1 did, plus more
```

#### Step 3: Remove v1 code from profile-builder.ts

```
In src/services/personalization/profile-builder.ts:
  - Delete `ReasoningProfile` interface (lines 28-38)
  - Delete `defaultProfile()` v1 function
  - Delete `loadProfile()` v1 function
  - Delete `detectPatternsV1()` function
  - Delete `updateProfile()` v1 export
  - Delete `updateAverage()` helper (used only by v1)
  - Keep: DomainEntry interface (exported, used by migrations.ts — but that's deleted too)
    → Actually DELETE DomainEntry too since migrations.ts is gone
  - Keep: ALL v2 code (updateProfileV2, defaultProfileV2, loadProfileV2, etc.)
  - Rename `updateProfileV2` → `updateProfile` for clarity (single version = no suffix needed)
```

#### Step 4: Remove v1 handling from unfade-profile tool

```
In src/tools/unfade-profile.ts:
  - Remove `ReasoningProfile` import
  - Remove `v1ToProfileData()` function
  - Remove the v1 branch in the profile-loading logic (version !== 2 → return degraded)
  - Simplify: only parse as ReasoningModelV2, error if not v2
```

#### Step 5: Delete unused modules

```
DELETE src/services/init/scaffold.ts
DELETE test/services/init/scaffold.test.ts (if exists)
DELETE src/services/otel/exporter.ts
DELETE src/services/otel/ (directory, if empty after)
DELETE src/services/personalization/context-shaper.ts
DELETE test/services/personalization/context-shaper.test.ts (if exists)
```

#### Step 6: Simplify autostart stubs

```
In src/commands/reset.ts:
  - Remove imports of autostart functions
  - Remove calls to removeAutostartEntirely() / removeAutostartIfOwnedByProject()
  - These are no-ops anyway

DELETE src/services/init/autostart.ts
DELETE test/services/init/autostart.test.ts (if exists)
```

#### Step 7: Clean config schema

```
In src/schemas/config.ts:
  - Change: version: z.union([z.literal(1), z.literal(2)]).default(2)
       To: version: z.literal(2).default(2)
  - Remove: OtelSchema definition
  - Remove: otel: OtelSchema.optional() from UnfadeConfigSchema
```

#### Step 8: Update context-shaper consumers (if any remain)

```
After deleting context-shaper.ts, verify no runtime code path breaks.
The only consumer was tests — no production code imported it.
```

#### Step 9: Clean up CLAUDE.md references

```
In CLAUDE.md:
  - Remove mention of config-migrations.ts
  - Remove mention of profile migrations (src/config/migrations.ts)
  - Remove "Config migration" section (section 8)
  - Simplify: "Config version is always 2. No migration infrastructure needed."
```

#### Step 10: Verify

```
pnpm typecheck    → no type errors
pnpm test         → all passing tests still pass (deleted test files don't count)
pnpm build        → clean bundle
```

### 13.4 Estimated Impact

| Metric | Before | After |
|---|---|---|
| Files deleted | 0 | ~10 files |
| Lines removed | 0 | ~600+ lines |
| v1 compatibility paths | 5+ | 0 |
| Migration infrastructure | 2 files + 2 test files | None |
| Unused modules | 3 files | 0 |
| Config schema complexity | Accepts v1 or v2 | Only v2 |

### 13.5 Principles Applied

1. **No users = no migration needed** — data can be regenerated by re-running `unfade`
2. **Single version** — every schema is at its latest version, no dual-format handling
3. **Dead code deletion > deprecation** — no `@deprecated` annotations, just delete
4. **Tests for dead code are dead tests** — delete them alongside the code they test
5. **If a function is a no-op stub, delete it and inline `false` at call sites** (or remove the call entirely)

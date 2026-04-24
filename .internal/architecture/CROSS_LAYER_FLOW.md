# Cross-Layer Flow: How Layers 0–4 Coordinate

How data moves from raw developer activity to rendered UI. Each section traces a complete flow across layer boundaries, showing which component owns each step.

---

## 1. Layer Map

```
Layer 0: Foundation
  Build pipeline, Zod schemas, paths, logger, config, CLI entry, Go scaffold, event bus

Layer 1: Go Daemon (unfaded)
  Passive capture: git watchers, AI session watchers, terminal hooks
  Writes: ~/.unfade/events/YYYY-MM-DD.jsonl

Layer 2: Dual-Database Materializer
  Tails JSONL → dual-writes SQLite (FTS, point lookups) + DuckDB (analytics, typed columns)
  Writes: ~/.unfade/cache/unfade.db, ~/.unfade/cache/unfade.duckdb

Layer 3: Intelligence Pipeline & CozoDB Substrate
  25 DAG-ordered analyzers read DuckDB → produce intelligence JSON + entity graph
  Writes: ~/.unfade/intelligence/*.json, ~/.unfade/intelligence/graph.db

Layer 4: UI, HTTP API & SSE
  Hono serves API routes + React SPA. SSE pushes real-time. TanStack Query caches.
  Reads: everything above. Writes: nothing persistent.
```

---

## 2. Startup Flow

The `unfade` command (no args) triggers a coordinated startup across all layers. Order matters — each step depends on the previous.

```
USER RUNS: unfade

Layer 0 — CLI Entry (src/entrypoints/cli.ts)
  │  Commander parses flags (--verbose, --quiet, --json, --config)
  │  preAction hook configures logger
  │  Default action (no subcommand) calls startUnfadeServer()
  │
  ▼
Layer 0 — Config + Registry (src/config/manager.ts, src/services/registry/registry.ts)
  │  loadConfig(): env vars → project config → global config → Zod defaults
  │  registerRepo(cwd): ensure current dir is in registry.v1.json
  │  loadRegistry(): read all tracked repos
  │
  ▼
Layer 4 — HTTP Server (src/server/http.ts)
  │  createApp(): build Hono instance with middleware chain
  │    CORS → static cache headers → request logging → setup enforcement → error handler
  │  findAvailablePort(7654–7660)
  │  serve({ hostname: "127.0.0.1", port })
  │  writeServerJson() → ~/.unfade/state/server.json (atomic)
  │  mountMcpHttp(app) → /mcp endpoint
  │  SPA fallback: dist/ui/index.html for non-API routes
  │
  │  WHY HTTP STARTS FIRST: Dashboard must be available during daemon startup.
  │  Users can watch progress in the browser while daemons initialize.
  │
  ▼
Layer 0 — Setup Gate Check (src/server/setup-state.ts)
  │  isSetupComplete() → reads ~/.unfade/state/setup-status.json
  │
  ├── IF setup NOT complete:
  │     Server ready, but daemons deferred.
  │     Browser hits / → middleware redirects to /setup.
  │     Setup wizard (React) calls POST /api/setup/complete when done.
  │     That endpoint calls startCapturePipeline() (continues below).
  │
  └── IF setup IS complete:
        │
        ▼
Layer 1 — Go Daemons (src/services/daemon/repo-manager.ts)
  │  RepoManager.startGlobalAICapture()
  │    → spawn "unfaded --capture-mode=ai-global"
  │    → watches ~/.claude/, ~/.cursor/logs/, etc.
  │
  │  FOR EACH repo in registry:
  │    RepoManager.addRepo(entry)
  │      → spawn "unfaded --capture-mode=git-only --project-dir=<root>"
  │      → daemon acquires flock, starts IPC server, begins git watching
  │    waitForDaemonIPCReady(root)
  │    sendIPCCommand({ cmd: "ingest" })  → triggers historical backfill
  │
  │  Daemons start writing to ~/.unfade/events/YYYY-MM-DD.jsonl
  │
  ▼
Layer 2 — Materializer (src/services/daemon/repo-manager.ts → MaterializerDaemon)
  │  MaterializerDaemon created per repo, intervalMs: 2000 (ticks every 2s)
  │  Each tick:
  │    materializeIncremental(cache)
  │      → tail-reads JSONL past cursor byte offsets
  │      → dual-writes: SQLite (events table + FTS) + DuckDB (37 typed columns)
  │      → saves cursor to ~/.unfade/state/materializer.json
  ��    Updates synthesis progress banner (percent complete)
  │    Emits eventBus({ type: "summary", data }) for SSE push
  │
  ▼
Layer 3 — Intelligence (triggered inside materializer tick)
  │  IF newRows > 0 (new events materialized):
  │    IntelligenceScheduler.processEvents(ctx)
  │      → topological sort of 25 analyzers
  │      → each analyzer: update(state, batch) → derive(output) → write JSON
  │      → output: ~/.unfade/intelligence/*.json
  │    Cross-analyzer correlation discovery
  │    SubstrateEngine.ingest(entityContributions) → CozoDB graph
  │    SubstrateEngine.propagate() → edge weight updates
  │    Generation depth computation
  │    eventBus({ type: "intelligence", data }) for SSE push
  │
  ▼
Layer 4 — SSE Push (src/server/routes/stream.ts → src/ui/lib/sse.ts)
      Browser's EventSource at /api/stream receives:
        "summary" → queryClient.setQueryData(["summary"], data)
        "intelligence" → queryClient.invalidateQueries(["intelligence"])
        "event" → append to live event ring buffer
      React components re-render with fresh data.
```

---

## 3. Event Lifecycle: From Git Commit to Rendered Metric

A single git commit traces through all five layers:

```
DEVELOPER: git commit -m "refactor auth middleware"

Layer 1 — Go Daemon
  │  fsnotify detects .git/refs/heads/<branch> change
  │  Git collector reads: commit hash, message, diff, files, branch
  │  Constructs CaptureEvent:
  │    { id: UUID, projectId: "proj-1", source: "git", type: "commit",
  │      content: { summary: "refactor auth middleware", files: [...], branch: "main" },
  │      gitContext: { repo: "/path", branch: "main", commitHash: "abc123" } }
  │  Appends to ~/.unfade/events/2026-04-24.jsonl (O_APPEND, atomic)
  │
  ▼
Layer 2 — Materializer (next tick, ≤2s later)
  │  Reads new bytes from 2026-04-24.jsonl past cursor
  │  Parses JSON line, validates (loose — skips malformed lines)
  │  SQLite INSERT:
  │    events table (id, ts, source, type, content_summary, metadata JSON blob)
  │    events_fts table (full-text index on summary + detail)
  │  DuckDB INSERT:
  │    events table (37 typed columns: human_direction_score, ai_tool,
  │    token_count, files_changed, domain, etc.)
  │  Updates cursor: { streams: { "2026-04-24.jsonl": { byteOffset: N } } }
  │  eventBus.emitBus({ type: "event", data: parsedEvent })
  │
  ▼
Layer 3 — Intelligence (same tick, after materialization)
  │  IntelligenceScheduler builds event batch from DuckDB (events after watermark)
  │  Relevant analyzers fire (filtered by eventFilter):
  │
  │  velocity-analyzer:      Updates commit velocity, rolling 7-day window
  │  efficiency-analyzer:    Recalculates human direction score (HDS)
  │  comprehension-analyzer: Updates acceptance/modification rates
  │  file-churn-analyzer:    Tracks file change frequency
  │  commit-analysis:        Analyzes commit patterns, message quality
  │  expertise-map:          Updates domain expertise from file paths
  │
  │  Each writes: ~/.unfade/intelligence/<name>.json
  │  contributeEntities() produces EntityContributions:
  │    { type: "work-unit", id: "commit-abc123", attributes: { ... } }
  │  SubstrateEngine.ingest() → CozoDB: new entity + edges
  │  summary-writer updates ~/.unfade/state/summary.json
  │  eventBus.emitBus({ type: "intelligence", data: { analyzer: "velocity" } })
  │
  ▼
Layer 4 — UI Update
  │  SSE stream receives "intelligence" event
  │  sse.ts listener: queryClient.invalidateQueries({ queryKey: ["intelligence"] })
  │  TanStack Query refetches GET /api/intelligence/velocity (and others)
  │  Hono route reads ~/.unfade/intelligence/velocity.json → returns JSON
  │  useVelocity() hook receives fresh data
  │  Hook enrichment: interpretation (R-1), comparison (R-2), freshness (R-3)
  │  MetricDisplay re-renders with updated velocity number + trend arrow
  │
  ▼
USER SEES: Velocity metric updates on Intelligence page within ~3s of commit.
```

---

## 4. Real-Time Push Chain: EventBus → SSE → React

The event bus is the coordination point between Layer 2/3 (producers) and Layer 4 (consumer).

```
PRODUCERS (server-side):

  Materializer (Layer 2):
    ON new events materialized:
      eventBus.emitBus({ type: "event", data: captureEvent })
    ON summary.json updated:
      eventBus.emitBus({ type: "summary", data: summaryJson })

  Intelligence (Layer 3):
    ON analyzer output updated:
      eventBus.emitBus({ type: "intelligence", data: { analyzer: name } })

TRANSPORT (Layer 4 server):

  GET /api/stream  (src/server/routes/stream.ts)
    ON connect:
      → send current summary.json (backfill)
      → send last 20 events from JSONL (backfill)
    SUBSCRIBE eventBus.onBus(listener):
      ON { type: "summary" }:       stream.writeSSE({ event: "summary", data })
      ON { type: "event" }:         stream.writeSSE({ event: "event", data })
      ON { type: "intelligence" }:  stream.writeSSE({ event: "intelligence", data })
    Every 30s: health tick with daemon/materializer status
    ON client disconnect: offBus(listener), cleanup

CONSUMER (Layer 4 client):

  connectSSE()  (src/ui/lib/sse.ts)
    EventSource at /api/stream
    ON "summary":       queryClient.setQueryData(["summary"], data)
    ON "health":        queryClient.setQueryData(["health"], data) + toast
    ON "event":         append to ring buffer (LivePage)
    ON "intelligence":  queryClient.invalidateQueries(["intelligence"])
    ON error:           auto-reconnect after 3s

  useSSE()  (src/ui/hooks/useSSE.ts)
    mounted in AppShell → connectSSE() on mount, disconnectSSE() on unmount
    SSE connection lives for the entire browser session
```

---

## 5. Data Flow Diagram

```
                          Layer 0 (Foundation)
                    ┌─────────────────────────────┐
                    │  Schemas  Paths  Config      │
                    │  Logger   CLI    EventBus    │
                    └──────────────┬───────────────┘
                                   │ (used by all layers)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
  Layer 1 (Go)              Layer 2 (Materializer)     Layer 4 (HTTP)
  ┌────────────┐            ┌─────────────────┐        ┌─────���───────┐
  │  unfaded    │            │  Tail JSONL      │        │  Hono server │
  │  git watch  │ ─JSONL──▶ │  → SQLite + Duck │        │  API routes  │
  │  AI watch   │            │  cursor tracking │        │  SSE stream  │
  └────────────┘            └────────┬─────────┘        └──────┬──────┘
                                     │                         │
                                     │ eventBus                │ reads JSON files
                                     │                         │ reads databases
                                     ▼                         │
                              Layer 3 (Intelligence)           │
                              ┌──────────────────┐             │
                              │  25 analyzers     │             │
                              │  DAG scheduler    │ ──JSON──▶  │
                              │  CozoDB graph     │             │
                              └──────────────────┘             │
                                     │                         │
                                     │ eventBus                │
                                     ▼                         ▼
                              ┌─────────────────────────────────┐
                              │         SSE Transport            │
                              │  eventBus → streamSSE → browser  │
                              └──────────────���──────────────────┘
                                             │
                                             ▼
                              ┌─────────────────────────────────┐
                              │      React SPA (Browser)         │
                              │  TanStack Query ← SSE injection  │
                              │  Zustand state                   │
                              │  Hook enrichment (RRVV)          │
                              │  Component rendering             │
                              └─────────────────────────────────┘
```

---

## 6. Shutdown Flow

Coordinated reverse-order teardown. Each layer cleans up before the next starts.

```
USER: Ctrl+C (SIGINT)

Layer 4 — unfade-server.ts shutdown handler
  │
  │  1. Stop registry poll timer (clearInterval)
  │
  │  2. Stop schedulers (intelligence tick timers)
  │     FOR EACH managed repo:
  │       managed.scheduler.stop()
  │
  │  3. Final materialization + save cursors
  │     FOR EACH managed repo:
  │       materializer.getCursorState() → log final byte offsets
  │       materializer.close() → final tick + cursor save + DB close
  │
  ▼
Layer 1 — Stop all Go daemons
  │  FOR EACH managed repo:
  │    daemon.stop() → send SIGTERM → wait 5s → SIGKILL if stuck
  │  repoManager.stopGlobalAICapture()
  │
  ▼
Layer 4 — Close HTTP server
  │  server.close()
  │  unlink ~/.unfade/state/server.json
  │
  ▼
  Done. Process exits.

KEY INVARIANT: Materializer closes BEFORE daemons stop.
  This ensures all events written by daemons are materialized before shutdown.
  No data loss between JSONL and databases.
```

---

## 7. Rebuild / Recovery Flows

When things go wrong, `unfade doctor` provides repair paths that replay data through layers.

### Cache Rebuild (Layer 1 → Layer 2)

```
unfade doctor --rebuild-cache

  Source of truth: ~/.unfade/events/*.jsonl (Layer 1 output)
  
  1. CacheManager opens both databases
  2. rebuildAll(cache):
     DELETE all rows from SQLite events + FTS tables
     DELETE all rows from DuckDB events table
     FOR EACH .jsonl file in ~/.unfade/events/:
       FOR EACH line:
         parse JSON → validate → INSERT into both databases
     Reset cursor to end-of-all-files
  3. cache.flushDuckDb() → ensure DuckDB writes are durable
  4. cache.close()

  Result: Both databases match JSONL exactly.
```

### Intelligence Rebuild (Layer 2 → Layer 3)

```
unfade doctor --rebuild-intelligence

  Source of truth: DuckDB events table (Layer 2 output)
  
  1. CacheManager opens databases
  2. coldStartIntelligence(analyticsDb, operationalDb):
     Clear all ~/.unfade/intelligence/state/*.state.json
     Clear all ~/.unfade/intelligence/*.json
     Initialize all 25 analyzers from scratch
     Process all events from DuckDB through DAG
     Write fresh output files
  3. Result: All intelligence JSON files regenerated.
```

### Graph Rebuild (Layer 3 → CozoDB)

```
unfade doctor --rebuild-graph

  Source of truth: DuckDB events + analyzer states (Layer 2+3)
  
  1. Drop and recreate CozoDB relations
  2. Replay all analyzer states through entity contribution pipeline
  3. SubstrateEngine.ingest() + propagate() for all entities
  4. Result: CozoDB graph matches current intelligence state.
```

### Full Recovery Chain

```
unfade doctor --rebuild-cache && unfade doctor --rebuild-intelligence && unfade doctor --rebuild-graph

  JSONL → SQLite + DuckDB → 25 analyzers → intelligence JSON → CozoDB graph

  This is the ultimate repair path. JSONL files are never modified by any layer —
  they are the immutable source of truth that every downstream store derives from.
```

---

## 8. Cross-Layer Ownership Rules

Each file or directory has exactly one writer. Readers are many; writers are one.

| Resource | Writer (Layer) | Readers |
|---|---|---|
| `~/.unfade/events/*.jsonl` | Layer 1 (Go daemon) | Layer 2 (materializer) |
| `~/.unfade/cache/unfade.db` | Layer 2 (materializer) | Layer 3 (operational queries), Layer 4 (lineage API) |
| `~/.unfade/cache/unfade.duckdb` | Layer 2 (materializer) | Layer 3 (all analytics), Layer 4 (via Layer 3 JSON) |
| `~/.unfade/intelligence/*.json` | Layer 3 (analyzers) | Layer 4 (HTTP routes read files) |
| `~/.unfade/intelligence/graph.db` | Layer 3 (SubstrateEngine) | Layer 4 (substrate API routes) |
| `~/.unfade/state/summary.json` | Layer 3 (summary-writer) | Layer 4 (SSE backfill, /api/summary) |
| `~/.unfade/state/registry.v1.json` | Layer 0 (registry module) | Layer 1 (daemon manager reads repos) |
| `~/.unfade/state/server.json` | Layer 4 (HTTP server) | External tools (port discovery) |
| `~/.unfade/state/materializer.json` | Layer 2 (cursor module) | Layer 2 (resume from offset) |
| `~/.unfade/config.json` | Layer 0 (config manager) | All layers |
| `~/.unfade/distills/*.md` | Layer 3 (distiller) | Layer 4 (distill page) |
| `~/.unfade/profile/` | Layer 3 (profile updater) | Layer 4 (profile page) |
| Event bus (in-memory) | Layer 2 + 3 (emitBus) | Layer 4 (SSE route subscribes) |

---

## 9. Layer Boundary Contracts

Each boundary has a well-defined interface. If you change a contract, you must update both sides.

### Layer 1 → Layer 2: JSONL

```
Contract:   CaptureEventSchema (src/schemas/event.ts)
Format:     One JSON object per line, UTF-8, newline-terminated
Location:   ~/.unfade/events/YYYY-MM-DD.jsonl
Append:     O_APPEND (atomic on POSIX)
Cursor:     Byte offset per file (materializer.json)
Validation: Loose — materializer skips malformed lines, logs warning
```

### Layer 2 → Layer 3: DuckDB Tables

```
Contract:   37 typed columns in DuckDB events table (src/services/cache/duckdb-schema.ts)
Interface:  AnalyzerContext { analytics: DbLike (DuckDB), operational: DbLike (SQLite) }
Batching:   buildEventBatch() queries events after global watermark
Filtering:  Each analyzer's eventFilter selects relevant rows
```

### Layer 3 → Layer 4: JSON Files + Event Bus

```
Contract:   Each analyzer writes ~/.unfade/intelligence/<outputFile>.json
Interface:  HTTP routes read JSON files; return 202 "warming_up" if not yet written
Push:       eventBus({ type: "intelligence" }) triggers SSE → client query invalidation
Freshness:  File mtime determines freshness badge in UI (R-3 compliance)
```

### Layer 4 Internal: HTTP → SSE → React

```
Contract:   API response shapes defined in src/ui/types/ and src/ui/lib/api.ts
SSE:        4 event types: summary, health, event, intelligence
Caching:    TanStack Query with staleTime 30s; SSE injects/invalidates cache
State:      Zustand store persisted to localStorage
```

---

## 10. Timing & Latency Budget

End-to-end latency from developer action to rendered UI update:

```
Git commit → fsnotify detection:         ~100ms   (Layer 1)
Event construction + JSONL write:        ~10ms    (Layer 1)
Materializer tick interval:              ≤2000ms  (Layer 2, worst case)
JSONL parse + dual-DB insert:            ~50ms    (Layer 2)
Intelligence DAG processing:             ~200ms   (Layer 3, 25 analyzers)
EventBus emit → SSE write:              ~1ms     (Layer 4 server)
SSE → EventSource → cache injection:    ~10ms    (Layer 4 client)
React re-render:                         ~16ms    (Layer 4 client)
                                         ─────
Typical end-to-end:                      ~2.5s    (dominated by materializer interval)
Worst case:                              ~4s      (tick just missed + full DAG)
```

The materializer's 2-second tick interval is the primary latency contributor. This is intentional — batching amortizes DuckDB insert cost (columnar format prefers batch over single-row writes).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context Management

**NEVER read an entire document in one shot.** Architecture docs, design specs, and phase documents in `.internal/` are large (1000–4000+ lines). Reading them whole will overload context and degrade response quality.

- **Read in chunks** — use `offset` + `limit` params (100–200 lines per read). Start with the table of contents or top-level summary, then drill into the specific section you need.
- **Read only what you need** — if you need Sprint 15F status, read the Sprint 15F section, not the entire Phase 15 doc. If you need a schema, read the schema file, not the architecture doc that references it.
- **Prefer code over docs** — the codebase is the source of truth. Read the actual `.ts`/`.go` files to verify implementation rather than trusting doc claims. Use Grep/Glob to find what you need.
- **Don't stack large reads** — if you've already read 200+ lines of a doc in this conversation, avoid reading another large chunk unless the prior content has been compressed. Summarize findings before moving on.

## Project Overview

**Unfade** is an open-source CLI tool that passively captures engineering reasoning from developer workflows (git, AI sessions, terminal), distills it into queryable knowledge, and builds a compounding developer identity profile.

### Global-First Architecture (Phase 14)

- **`unfade` command** — Single long-running Node server. Bare `unfade` starts everything: HTTP dashboard, MCP server, single global materializer, one Go git-capture daemon per repo, and one global AI-capture daemon. Ctrl+C stops cleanly.
- **Go Capture Engines** (`daemon/`) — Two modes: `--capture-mode=git-only` (one per repo, watches `.git/`) and `--capture-mode=ai-global` (one global instance, watches `~/.claude/`, Cursor, Codex, Aider). All write to `~/.unfade/events/`.
- **`~/.unfade/`** — Single global home. All events, cache, intelligence, profile, graph live here. `projectId` is a dimension on every event and SQLite table. `<repo>/.unfade` is a marker file (not a directory).
- **`~/.unfade/state/registry.v1.json`** — Global registry of all tracked repos.

### Core Value Propositions
- **Passive reasoning capture** from git commits, AI sessions, and terminal activity
- **Cross-tool context injection** via MCP server — makes every AI tool aware of prior reasoning without re-explaining
- **Daily Distill** — auto-generated reasoning summaries (decisions, trade-offs, dead ends)
- **Thinking Graph / Unfade Cards** — visual developer identity based on reasoning patterns, not commit counts
- **Local-first, privacy-first** — all data stays local, plain text, inspectable

## Engineering Conventions

### 1. stdout is Sacred

**stdout is ONLY for MCP JSON-RPC.** All logging, progress indicators, TUI rendering, debug output, and user messages MUST go to stderr.

- Use `logger.info()` / `logger.error()` etc. from `src/utils/logger.ts` — writes to `process.stderr`
- NEVER use `console.log()` — it writes to stdout and breaks MCP
- NEVER write to `process.stdout` directly (except MCP transport)
- **Exception:** `--json` flag output writes structured JSON to stdout via `process.stdout.write()`

### 2. Zod Schemas are the Single Source of Truth

All data contracts live in `src/schemas/`. Runtime validation, TypeScript types, MCP tool schemas, and documentation all derive from Zod schemas.

- Every schema file exports BOTH the Zod schema AND the inferred TypeScript type
- Example: `export const FooSchema = z.object({...}); export type Foo = z.infer<typeof FooSchema>;`
- `CaptureEventSchema` (TypeScript) mirrors `CaptureEvent` Go struct in `daemon/internal/capture/event.go` — they MUST stay in sync

### Key Data Contracts

| Schema | File | Purpose |
|---|---|---|
| `UnfadeConfigSchema` | `src/schemas/config.ts` | Config v1/v2 with defaults, `z.union([z.literal(1), z.literal(2)]).default(2)` |
| `CaptureEventSchema` | `src/schemas/event.ts` | JSONL event format: id, timestamp, source, type, content, gitContext |
| `DailyDistillSchema` | `src/schemas/distill.ts` | Distill output: summary, decisions, tradeOffs, deadEnds, domains |
| `ReasoningModelV2Schema` | `src/schemas/profile.ts` | Developer reasoning profile with patterns, domains, decision stats |
| MCP tool schemas | `src/schemas/mcp.ts` | QueryInput, ContextInput, DecisionsInput, etc. |

### 3. Response Envelope Pattern

Every tool response (MCP and `--json` CLI output) wraps data in a `ToolResponse` envelope with `_meta`:

```typescript
{ data: ..., _meta: { tool, durationMs, degraded, degradedReason, personalizationLevel } }
```

### 4. Global-First Storage (`~/.unfade/`)

- **All data lives under `~/.unfade/`** — global-first model (Phase 14). No per-project silos.
- **`projectId` is a queryable dimension** — every event, decision, and metric is tagged with `projectId`. SQLite indexes on `project_id` for efficient per-project or cross-project queries.
- **One writer per file** — Go daemon owns `events/`, TypeScript owns everything else.
- **`<repo>/.unfade`** — marker file (not a directory). Contains `{ "projectId": "..." }`.
- Use `src/utils/paths.ts` functions — never hardcode paths. Set `UNFADE_HOME` env var for test isolation.

Directory structure:
```
~/.unfade/                    # Global Unfade home (single source of truth)
├── config.json               # User config (v2)
├── events/                   # ALL events, ALL projects (date-partitioned JSONL)
├── cache/unfade.db           # SQLite operational cache (FTS, point lookups, lineage)
├── cache/unfade.duckdb       # DuckDB analytical cache (time-series, intelligence, typed columns)
├── distills/                 # Daily reasoning summaries
├── profile/                  # Global reasoning model (cross-project identity)
├── graph/                    # decisions.jsonl (project-tagged), domains.json
├── intelligence/             # Analyzer outputs (8 analyzers)
├── amplification/            # Cross-project connections
├── state/                    # Registry, server PID, materializer cursor
│   ├── registry.v1.json      # All registered repos
│   └── daemons/<id>/         # Per-project daemon PID, socket, logs
├── insights/                 # Ring-buffered live insights
├── metrics/                  # Daily metric snapshots
├── bin/                      # Shared Go binaries (unfaded, unfade-send)
├── cards/                    # Generated PNG Unfade Cards
├── site/                     # Generated Thinking Graph
└── logs/                     # Server + global logs
```

### 5. Dual-Database Architecture (Layer 2)

- **DuckDB** (`~/.unfade/cache/unfade.duckdb`) is for **all analytics**: time-series aggregations, intelligence queries, typed-column scans. Use `CacheManager.analytics` handle. All 8 intelligence analyzers, window aggregator, token proxy, session materializer, comprehension scorer, and file direction read/write here.
- **SQLite** (`~/.unfade/cache/unfade.db`) is for **FTS, point lookups, and operational data**: event-by-ID retrieval, full-text search (`events_fts`), lineage (`event_insight_map`), feature boundaries (`features`, `event_features`), event links. Use `CacheManager.operational` or `CacheManager.getDb()` handle.
- **Never cross the streams**: analytical queries go to DuckDB, operational queries go to SQLite. The materializer writes to both (SQLite events + DuckDB typed columns).
- **JSONL is the source of truth**: both databases are derived caches. `unfade doctor --rebuild-cache` replays all JSONL into both.
- DuckDB events table has **37 typed columns** (no `json_extract()`). SQLite events table keeps `metadata` as a JSON blob for backward compat.
- `AnalyzerContext` carries `analytics: DbLike` (DuckDB) and `operational: DbLike` (SQLite).

### 6. User-Facing Terminology

- Say **"capture engine"**, not "daemon" — users don't need to know it's a background process
- Say **"reasoning"**, not "data" or "logs"
- Say **"distill"**, not "summarize"

### 7. Test Naming

Tests mirror source structure: `test/<path>/<name>.test.ts` mirrors `src/<path>/<name>.ts`.
Integration tests live in `test/integration/`.

### 8. Imports

- All imports MUST use `.js` extensions (ESM requirement)
- Use `node:` prefix for Node.js built-ins (`node:path`, `node:fs`, `node:os`)

### 9. Config Migration

Config migrations live in `src/config/config-migrations.ts`. Each migration is `{ from: number, to: number, up: (config) => config }`. Migrations run sequentially, backup as `.backup.json`. Current version: 2.

Profile migrations (reasoning_model.json v1→v2) are in `src/config/migrations.ts`.

### 10. CLI Error Handling

All CLI commands use `handleCliError(err, commandName)` from `src/utils/cli-error.ts`. It:
- Logs a user-friendly message to stderr
- Shows hints for common failures (ECONNREFUSED, missing .unfade/, permissions)
- Logs stack trace at debug level
- Sets `process.exitCode = 1`

### 11. Distill Pipeline

`src/services/distill/distiller.ts` orchestrates: events → signals → context linking → synthesis → profile update → graph update → write markdown → notify.

- `distill(date, config, options)` — single date
- `backfill(days, config, options)` — N past days, throttled at 10s
- Pass `provider: null` to use fallback synthesizer (no LLM) — useful for tests
- Idempotent: re-running overwrites existing distill

### 12. MCP Server

9 tools (see `src/services/mcp/tools.ts`), 5 resources, 3 prompts. All tools return the response envelope pattern. Degraded mode returns `degraded: true` with reason when `.unfade/` is missing.

## Frontend Architecture (React 19 + Vite 8 + shadcn/ui)

- **SPA** served as static files from `dist/` (built by Vite). Backend serves `dist/index.html` as SPA fallback for all non-API routes (`src/server/http.ts`).
- **API** at `/api/*` and `/unfade/*` — Hono routes, same process as the SPA server.
- **TanStack Query v5** for all data fetching (`useQuery`, `useMutation`, `queryClient`). SSE via `EventSource` in custom hooks.
- **Zustand** for client state (active project, persona, theme).
- **shadcn/ui** components with custom theme tokens defined in `src/ui/index.css`.
- **All UI code lives in `src/ui/`**:
  - `src/ui/pages/` — 12 lazy-loaded page components (Home, Live, Distill, Intelligence, Decisions, Profile, Cards, Projects, Settings, Integrations, Logs, Setup)
  - `src/ui/components/` — shared components (`shared/`) and shadcn primitives (`ui/`)
  - `src/ui/hooks/` — custom React hooks (useHealth, useEvents, useSummary, etc.)
  - `src/ui/lib/` — API client (`api.ts`), query client, utilities
  - `src/ui/stores/` — Zustand stores
  - `src/ui/types/` — TypeScript interfaces for API responses
  - `src/ui/router.tsx` — React Router with lazy imports and code splitting

### Phase 15 Design System

- **MetricDisplay** (`src/ui/components/shared/MetricDisplay.tsx`) enforces R-1→R-4 on every numeric display: interpretation (R-1), comparison with delta/direction (R-2), freshness badge (R-3), confidence indicator (R-4).
- **18 patterns** (P-1 through P-18) from Phase 15 spec, referenced in component implementation. Key patterns: P-6 System Reveal (ActiveSessionPanel, daemon status), P-7 Progressive Disclosure (LiveStrip → Hero → Detail → Evidence → Raw).
- **Transmission Thesis diagnostic language** — vehicle analogies for system status (e.g., "engines running", "transmission lag"). Implemented in diagnostic message generators across LivePage, LogsPage.
- **FreshnessBadge** (`src/ui/components/shared/FreshnessBadge.tsx`) — R-3 compliance: shows data age on every data-bearing component.
- **EvidenceDrawer** (`src/ui/components/shared/EvidenceDrawer.tsx`) — slide-over panel for raw data inspection (progressive disclosure layer 4).
- **Information Architecture** — 4 layers: Pulse (sidebar status), Observe (Home + Live), Understand (Intelligence + Decisions + Distill), Identity (Profile + Cards).

## Build Commands

```bash
pnpm build        # pnpm build:ui && tsdown — builds Vite SPA + CLI bundle
pnpm build:ui     # Vite production build → dist/ (43 chunks, code-split)
pnpm lint         # Biome check (lint + format)
pnpm lint:fix     # Biome auto-fix
pnpm test         # Vitest run
pnpm typecheck    # tsc --noEmit
pnpm dev          # tsx watch mode (backend)
pnpm dev:ui       # Vite dev server with HMR (frontend)
```

## Go Daemon Commands

```bash
cd daemon
make all          # Build unfaded + unfade-send
make test         # Run Go tests
make clean        # Remove binaries
```

## Key Documents

### Product
- `.internal/product/unfade.md` — Full product strategy
- `.internal/product/unfade_support.md` — Competitive analysis and prioritization

### Architecture — Layer Docs (current truth)
- `.internal/architecture/LAYER_0_FOUNDATION.md` — Build pipeline, schemas, paths, logger, CLI entry, config, Go scaffold
- `.internal/architecture/LAYER_1_GO_DAEMON.md` — Go capture engine: git-only + ai-global modes, IPC, JSONL output
- `.internal/architecture/LAYER_2_DUAL_DB_MATERIALIZER.md` — SQLite + DuckDB materializer, incremental ingest, cursor tracking
- `.internal/architecture/LAYER_3_INTELLIGENCE_AND_SUBSTRATE.md` — 25 DAG-ordered analyzers, SubstrateEngine/CozoDB, profile accumulator
- `.internal/architecture/LAYER_4_UI_HTTP_SSE.md` — React 19 + Vite 8 SPA, Hono API, SSE push, TanStack Query
- `.internal/architecture/CROSS_LAYER_FLOW.md` — Startup/shutdown flow, event lifecycle, ownership rules, timing budget

### Architecture — Active Phase Docs
- `.internal/architecture/PHASE_10_SYSTEM_HARDENING.md` — Logging, onboarding, project discovery, daemon control
- `.internal/architecture/PHASE_14_GLOBAL_FIRST_STORAGE_ARCHITECTURE.md` — Global-first storage: `~/.unfade/` with `projectId` dimension
- `.internal/architecture/PHASE_15_RRVV_UI_UX_SYSTEM_REDESIGN.md` — UI/UX redesign: component library, Intelligence Hub, system reveal
- `.internal/architecture/PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md` — Intelligence pipeline: DAG scheduler, incremental state, diagnostics
- `.internal/architecture/PHASE_16_SUBSTRATE_INVESTIGATION.md` — CozoDB semantic substrate design investigation
- `.internal/architecture/PHASE_16_VALIDATION_ANALYSIS.md` — Phase 16 + substrate cross-reference against user pain
- `.internal/architecture/UI_FRAMEWORK_RRVV_ANALYSIS.md` — Current UI audit: template strings → React migration analysis

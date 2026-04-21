# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
├── cache/unfade.db           # Global SQLite cache (project_id indexed)
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

### 5. User-Facing Terminology

- Say **"capture engine"**, not "daemon" — users don't need to know it's a background process
- Say **"reasoning"**, not "data" or "logs"
- Say **"distill"**, not "summarize"

### 6. Test Naming

Tests mirror source structure: `test/<path>/<name>.test.ts` mirrors `src/<path>/<name>.ts`.
Integration tests live in `test/integration/`.

### 7. Imports

- All imports MUST use `.js` extensions (ESM requirement)
- Use `node:` prefix for Node.js built-ins (`node:path`, `node:fs`, `node:os`)

### 8. Config Migration

Config migrations live in `src/config/config-migrations.ts`. Each migration is `{ from: number, to: number, up: (config) => config }`. Migrations run sequentially, backup as `.backup.json`. Current version: 2.

Profile migrations (reasoning_model.json v1→v2) are in `src/config/migrations.ts`.

### 9. CLI Error Handling

All CLI commands use `handleCliError(err, commandName)` from `src/utils/cli-error.ts`. It:
- Logs a user-friendly message to stderr
- Shows hints for common failures (ECONNREFUSED, missing .unfade/, permissions)
- Logs stack trace at debug level
- Sets `process.exitCode = 1`

### 10. Distill Pipeline

`src/services/distill/distiller.ts` orchestrates: events → signals → context linking → synthesis → profile update → graph update → write markdown → notify.

- `distill(date, config, options)` — single date
- `backfill(days, config, options)` — N past days, throttled at 10s
- Pass `provider: null` to use fallback synthesizer (no LLM) — useful for tests
- Idempotent: re-running overwrites existing distill

### 11. MCP Server

9 tools (see `src/services/mcp/tools.ts`), 5 resources, 3 prompts. All tools return the response envelope pattern. Degraded mode returns `degraded: true` with reason when `.unfade/` is missing.

## Build Commands

```bash
pnpm build        # Bundle → dist/cli.mjs (single ESM file with shebang)
pnpm lint         # Biome check (lint + format)
pnpm lint:fix     # Biome auto-fix
pnpm test         # Vitest run
pnpm typecheck    # tsc --noEmit
pnpm dev          # tsx watch mode
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

### Architecture
- `.internal/architecture/VERTICAL_SLICING_PLAN.md` — Overall build sequencing (if present)
- `.internal/architecture/UNFADE_CLI_RESEARCH_AND_DESIGN.md` — Shared foundation, data ownership, contracts
- `.internal/architecture/PHASE_0_FOUNDATION.md` — Scaffolding, config, paths, logger
- `.internal/architecture/PHASE_1_CAPTURE_AND_INTELLIGENCE.md` — Events, distillation, LLM providers
- `.internal/architecture/PHASE_2_CONTEXT_AND_INTEGRATION.md` — MCP server, HTTP API, hooks
- `.internal/architecture/PHASE_3_IDENTITY_AND_PERSONALIZATION.md` — Profile v2, patterns, amplification
- `.internal/architecture/PHASE_4_PLATFORM_AND_LAUNCH.md` — Platform, continuous intelligence, launch, registry/SSE
- `.internal/architecture/PHASE_6_POST_LAUNCH.md` — Windows, cloud distill, team/enterprise prep
- `.internal/architecture/PHASE_7_BREAKTHROUGH_INTELLIGENCE.md` — Active intelligence layer (roadmap)
- `.internal/architecture/PHASE_7_WEB_UI_UX_ARCHITECTURE.md` — Web UI re-architecture (localhost:7654), RRVV spec
- `.internal/architecture/PHASE_13_GAP_REMEDIATION_AND_COHERENCE.md` — U2D audit: gap analysis + remediation sprints (13A–13E)
- `.internal/architecture/PHASE_14_GLOBAL_FIRST_STORAGE_ARCHITECTURE.md` — Global-first storage: `~/.unfade/` with `projectId` dimension (14A–14F)
- `.internal/architecture/PHASE_15_RRVV_UI_UX_SYSTEM_REDESIGN.md` — UI/UX redesign: component library, Intelligence Hub, project selector, system reveal (15A–15E)
- `.internal/architecture/PHASE_10_SYSTEM_HARDENING.md` — System hardening: logging, onboarding + project discovery, daemon control, monitoring lifecycle (§7–§10 added post-Phase 14/15)

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Unfade** is an open-source CLI tool that passively captures engineering reasoning from developer workflows (git, AI sessions, terminal), distills it into queryable knowledge, and builds a compounding developer identity profile.

### Hybrid Architecture

- **TypeScript CLI** (`src/`) — All user-facing features: CLI commands, TUI dashboard, MCP server, web UI, distillation, personalization, site generation
- **Go Capture Engine** (`daemon/`) — Invisible background process that watches git, AI sessions, and terminal. Writes events to `.unfade/events/`
- **`.unfade/` directory** — The communication bus. Go writes events, TypeScript reads them. Plain text, inspectable, greppable

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

### 4. `.unfade/` Workspace Convention

- **One writer per file** — prevents corruption. Go daemon owns `events/`, TypeScript owns `distills/`, `profile/`, `graph/`
- `~/.unfade/` — user-level global config and state
- `.unfade/` (project-level) — relative to nearest `.git` root
- Use `src/utils/paths.ts` functions — never hardcode paths

Directory structure:
```
.unfade/
├── config.json          # User config (v2)
├── events/              # JSONL capture events (Go daemon writes)
├── distills/            # Markdown daily distills (TypeScript writes)
├── profile/             # reasoning_model.json (v2), personalization data
├── state/               # Daemon PID, lock files
├── graph/               # decisions.jsonl, domains.json
├── cache/               # LLM response cache
├── logs/                # Daemon logs
├── bin/                 # Downloaded Go binaries
├── cards/               # Generated PNG Unfade Cards
├── site/                # Generated Thinking Graph static site
└── amplification/       # Cross-session connections
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

7 tools, 5 resources, 3 prompts. Registered in `src/mcp/server.ts`. All tools return the response envelope pattern. Degraded mode returns `degraded: true` with reason when `.unfade/` is missing.

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
- `docs/product/unfade.md` — Full product strategy
- `docs/product/unfade_support.md` — Competitive analysis and prioritization

### Architecture
- `docs/architecture/VERTICAL_SLICING_PLAN.md` — Overall build sequencing
- `docs/architecture/cli/PHASE_0_SCAFFOLDING.md` — Scaffolding, config, paths, logger
- `docs/architecture/cli/PHASE_1_CAPTURE_AND_DISTILL.md` — Events, distillation, LLM providers
- `docs/architecture/cli/PHASE_2_HOOKS_API_AND_MCP.md` — MCP server, HTTP API, git hooks
- `docs/architecture/cli/PHASE_3_CARDS_AND_TERMINAL.md` — Unfade Cards, TUI dashboard, web UI
- `docs/architecture/cli/PHASE_4_PERSONALIZATION_AND_AMPLIFICATION.md` — Profile v2, patterns, amplification
- `docs/architecture/cli/PHASE_5_ECOSYSTEM_LAUNCH.md` — Config migration, error handling, E2E, launch prep

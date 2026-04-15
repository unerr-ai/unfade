# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Unfade** is an open-source CLI tool that passively captures engineering reasoning from developer workflows (git, AI sessions, terminal), distills it into queryable knowledge, and builds a compounding developer identity profile.

### Hybrid Architecture

- **TypeScript CLI** (`src/`) — All user-facing features: CLI commands, TUI dashboard, MCP server, web UI, distillation, personalization
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

### 2. Zod Schemas are the Single Source of Truth

All data contracts live in `src/schemas/`. Runtime validation, TypeScript types, MCP tool schemas, and documentation all derive from Zod schemas.

- Every schema file exports BOTH the Zod schema AND the inferred TypeScript type
- Example: `export const FooSchema = z.object({...}); export type Foo = z.infer<typeof FooSchema>;`
- `CaptureEventSchema` (TypeScript) mirrors `CaptureEvent` Go struct in `daemon/internal/capture/event.go` — they MUST stay in sync

### 3. Response Envelope Pattern

Every tool response wraps data in a `ToolResponse` envelope with `_meta`:

```typescript
{ data: ..., _meta: { tool, durationMs, degraded, degradedReason, personalizationLevel } }
```

### 4. `.unfade/` Workspace Convention

- **One writer per file** — prevents corruption. Go daemon owns `events/`, TypeScript owns `distills/`, `profile/`, `graph/`
- `~/.unfade/` — user-level global config
- `.unfade/` (project-level) — relative to nearest `.git` root
- Use `src/utils/paths.ts` functions — never hardcode paths

### 5. User-Facing Terminology

- Say **"capture engine"**, not "daemon" — users don't need to know it's a background process
- Say **"reasoning"**, not "data" or "logs"
- Say **"distill"**, not "summarize"

### 6. Test Naming

Tests mirror source structure: `test/<path>/<name>.test.ts` mirrors `src/<path>/<name>.ts`.

### 7. Imports

- All imports MUST use `.js` extensions (ESM requirement)
- Use `node:` prefix for Node.js built-ins (`node:path`, `node:fs`, `node:os`)

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

## Key Product Documents
- `docs/product/unfade.md` — Full product strategy
- `docs/product/unfade_support.md` — Competitive analysis and prioritization
- `docs/architecture/cli/PHASE_0_SCAFFOLDING.md` — Phase 0 scaffolding plan
- `docs/architecture/VERTICAL_SLICING_PLAN.md` — Overall build sequencing

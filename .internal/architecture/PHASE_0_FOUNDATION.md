# Phase 0 — Foundation

> **Feature Statement:** Every file, config, schema, and convention that every subsequent phase depends on is established once. The project is buildable, lintable, testable, and runnable from day one. No phase ever starts by asking "how do we set up TypeScript?" -- Phase 0 answers that permanently.

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. Problem Statement](#2-problem-statement)
- [3. Research: Technology Decisions](#3-research-technology-decisions)
- [4. Architecture](#4-architecture)
- [5. Core Schemas (Single Source of Truth)](#5-core-schemas-single-source-of-truth)
- [6. Command Surface](#6-command-surface)
- [7. Design Principles](#7-design-principles)
- [8. Implementation Summary](#8-implementation-summary)
- [9. Success Metrics](#9-success-metrics)
- [10. Risk Assessment](#10-risk-assessment)

---

## 1. Business Justification

Every Phase 1-4 task assumes a working build pipeline, a linting standard, a test runner, a CLI entry point, and validated schemas. Without Phase 0:

- Phase 1 (Capture & Intelligence) starts with "how do we configure TypeScript?" instead of "how do we capture git events"
- Every contributor makes independent, conflicting tooling choices
- Schema drift between the Go capture engine and the TypeScript CLI starts on Day 1 instead of being prevented by Day 1

> **Decide tooling once. Enforce via config. Every phase after this writes features, not infrastructure.**

---

## 2. Problem Statement

### Before Phase 0

An empty repository with only product strategy documents and architecture plans. No `package.json`, no build pipeline, no source files.

### After Phase 0

| Concern | State |
|---|---|
| **Build** | `pnpm build` produces `dist/cli.mjs` (single ESM bundle via tsdown with shebang) |
| **Lint** | `pnpm lint` runs Biome checks (formatting + lint rules), zero warnings |
| **Test** | `pnpm test` runs Vitest, all tests passing |
| **Typecheck** | `pnpm typecheck` runs `tsc --noEmit` with strict mode |
| **Run** | `./dist/cli.mjs` starts the Unfade server; `./dist/cli.mjs --help` shows command list |
| **Schemas** | `src/schemas/` contains Zod schemas for events, config, profile, distill, tool response, MCP |
| **Logger** | `src/utils/logger.ts` -- structured logger, always stderr, never stdout |
| **Paths** | `src/utils/paths.ts` -- `~/.unfade/` and `.unfade/` resolution via `node:path` |
| **Conventions** | `CLAUDE.md` -- project rules for AI-assisted development |
| **Go Capture Engine** | `daemon/` -- Go module with `unfaded` and `unfade-send` binaries |

---

## 3. Research: Technology Decisions

### Reference CLI Analysis

Phase 0 decisions were informed by studying two production TypeScript CLIs: Claude Code (Anthropic's internal CLI, Bun-based) and unerr-cli (Node 20, ESM). Where both reference projects agreed on a tool, Unfade adopted it. Where they diverged, the lighter-weight option was chosen.

### Technology Stack

| Decision | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (ESM, strict mode) | Both reference CLIs use TS. MCP SDK is TS-first. `npx` distribution. Proven at scale |
| **Runtime** | Node.js 20+ | ESM support, widest ecosystem, `npx` works. No Bun dependency |
| **CLI framework** | Commander + @commander-js/extra-typings | Type-safe command definitions. Both reference CLIs use Commander |
| **Bundler** | tsdown | Rolldown-powered ESM bundling. Actively maintained successor to tsup. Single entry produces `dist/cli.mjs` with shebang |
| **Linting** | Biome 2.x | Replaces ESLint + Prettier as a single tool. Recommended rules, space indentation (width 2), import organization via assist |
| **Validation** | Zod (v4) | Type-safe schema contracts for all data boundaries. Both references use Zod |
| **Testing** | Vitest 4.x | ESM-native, fast. Test pattern: `test/**/*.test.ts` mirroring `src/` |
| **Capture engine** | Go binary (`unfaded`) | Separate Go binary for passive capture (git, AI sessions, terminal). Uses `fsnotify` for file watching. Managed as a child process per repo |
| **MCP** | @modelcontextprotocol/sdk | Universal agent protocol for cross-tool context injection |
| **LLM integration** | Vercel AI SDK (`ai`) + provider adapters (ollama, openai, anthropic) | Local-first via Ollama. `generateObject()` for structured output via Zod. Single SDK abstracts all providers |
| **HTTP server** | Hono + @hono/node-server | Lightweight web framework for the dashboard. `overrideGlobalObjects: false` avoids MCP SDK conflict |
| **Card rendering** | satori + @resvg/resvg-js | JSX to SVG to PNG. No browser dependency |
| **Local storage** | Markdown + JSONL + JSON | Plain text, inspectable, greppable. No database for v1 |
| **IPC** | Filesystem-as-IPC (`.unfade/` directory) | Go writes to `.unfade/events/`, TypeScript reads. One writer per file prevents corruption |

---

## 4. Architecture

### Server-First Runtime Model

Bare `unfade` starts a single long-running Node server that manages everything: HTTP dashboard, MCP server, materializer, and one Go capture engine per registered repo. Ctrl+C stops cleanly. All other commands (`init`, `distill`, `query`, etc.) are run-and-exit.

### Project Layout

```
unfade-cli/
├── package.json              # name: unfade, type: module, bin: ./dist/cli.mjs
├── tsconfig.json             # strict, ES2022, Node16 module, NodeNext resolution
├── biome.json                # Biome 2.x, recommended rules, spaces, width 2
├── vitest.config.ts          # test/**/*.test.ts, v8 coverage
├── tsdown.config.ts          # single entry → dist/cli.mjs, ESM, node20, shebang
├── CLAUDE.md                 # Engineering conventions for AI-assisted development
│
├── src/
│   ├── entrypoints/
│   │   └── cli.ts            # Commander entry point, global flags, command registration
│   │
│   ├── commands/             # Run-and-exit command implementations
│   │   ├── init.ts           # Initialize .unfade/, configure LLM, install shell hooks
│   │   ├── query.ts          # Semantic search across reasoning history
│   │   ├── distill.ts        # Trigger manual distillation
│   │   ├── export.ts         # Export .unfade/ as portable .tar.gz
│   │   ├── card.ts           # Generate Reasoning Card PNG
│   │   ├── status.ts         # Show today's reasoning metrics
│   │   ├── publish.ts        # Generate Thinking Graph static site
│   │   ├── doctor.ts         # Diagnose paths, processes, registry health
│   │   ├── ingest.ts         # Ingest historical AI session data
│   │   ├── mcp.ts            # Start MCP stdio server (hidden, IDE integration)
│   │   ├── add.ts            # Register additional repos
│   │   └── reset.ts          # Remove .unfade/, stop capture
│   │
│   ├── schemas/              # Zod schemas — single source of truth
│   │   ├── event.ts          # CaptureEvent (mirrors Go struct)
│   │   ├── config.ts         # UnfadeConfig v1/v2 with full defaults
│   │   ├── profile.ts        # ReasoningModel v2, patterns, domains
│   │   ├── distill.ts        # DailyDistill, decisions, trade-offs, dead ends
│   │   ├── tool-response.ts  # ToolResponse envelope with _meta
│   │   ├── mcp.ts            # MCP tool input schemas
│   │   ├── card.ts           # Card generation schemas
│   │   ├── metrics.ts        # Reasoning metrics schemas
│   │   └── init-progress.ts  # Init wizard progress tracking
│   │
│   ├── config/               # Configuration management
│   │   ├── manager.ts        # Load/save config, auto-create defaults
│   │   ├── config-migrations.ts  # v1 → v2 config migration
│   │   └── migrations.ts     # Profile reasoning_model.json v1 → v2
│   │
│   ├── utils/                # Shared utilities
│   │   ├── logger.ts         # Structured stderr-only logger (debug/info/warn/error)
│   │   ├── paths.ts          # ~/.unfade/ and .unfade/ path resolution
│   │   ├── cli-error.ts      # handleCliError() with user-friendly hints
│   │   └── ipc.ts            # Inter-process communication helpers
│   │
│   ├── server/               # Unfade server (bare `unfade` starts this)
│   ├── services/             # Core service modules (distill, capture, mcp, etc.)
│   ├── mcp/                  # MCP server (7 tools, 5 resources, 3 prompts)
│   └── tools/                # Unified tool definitions (CLI + MCP)
│
├── test/                     # Mirrors src/ structure
│   ├── schemas/
│   ├── utils/
│   ├── services/
│   └── commands/
│
└── daemon/                   # Go capture engine
    ├── go.mod                # github.com/unfade-io/unfade-cli/daemon
    ├── Makefile              # build, test, clean targets
    ├── cmd/
    │   ├── unfaded/main.go   # Main capture engine binary
    │   └── unfade-send/main.go  # Event sender utility
    └── internal/
        └── capture/          # Git, AI session, terminal capture logic
```

### `.unfade/` Workspace Convention

The `.unfade/` directory (relative to nearest `.git` root) is the communication bus between Go and TypeScript. One writer per file prevents corruption.

```
.unfade/
├── config.json      # User config (UnfadeConfig v2)
├── events/          # JSONL capture events (Go daemon writes, TypeScript reads)
├── distills/        # Markdown daily distills (TypeScript writes)
├── profile/         # reasoning_model.json, personalization data (TypeScript writes)
├── state/           # Daemon PID, lock files
├── graph/           # decisions.jsonl, domains.json
├── cache/           # LLM response cache
├── logs/            # Daemon and service logs
├── metrics/         # Daily metric snapshots (append-only JSONL)
├── insights/        # Ring-buffered LiveInsight lines for dashboard/API
├── cards/           # Generated Reasoning Card PNGs
├── site/            # Generated Thinking Graph static site
└── amplification/   # Cross-session connections
```

Global user state lives at `~/.unfade/` with `state/registry.v1.json` tracking all registered repos.

---

## 5. Core Schemas (Single Source of Truth)

All data contracts live in `src/schemas/`. Every schema file exports both the Zod schema object and the inferred TypeScript type. Runtime validation, TypeScript types, MCP tool schemas, and documentation all derive from these schemas.

### CaptureEvent (`src/schemas/event.ts`)

The universal event format. Cross-language contract: mirrors the Go struct in `daemon/internal/capture/event.go`. The Go capture engine writes `CaptureEvent` JSON to `.unfade/events/YYYY-MM-DD.jsonl`; the TypeScript CLI reads and validates them with this schema.

- **id**: UUID
- **timestamp**: ISO datetime
- **source**: `git | ai-session | terminal | browser | manual | mcp-active`
- **type**: `commit | diff | branch-switch | revert | stash | merge-conflict | ai-conversation | ai-completion | ai-rejection | command | error | retry | bookmark | tab-visit | annotation`
- **content**: `{ summary, detail?, files?, branch?, project? }`
- **gitContext**: optional `{ repo, branch, commitHash? }`
- **metadata**: optional record

### UnfadeConfig (`src/schemas/config.ts`)

Configuration schema with full defaults. An empty object `{}` parsed through this schema produces a complete valid config. Supports version 1 and 2 (default: 2). Sections: `capture`, `distill`, `mcp`, `notification`, `site`, `otel`, `pricing`, `export`.

### ToolResponse (`src/schemas/tool-response.ts`)

Envelope schema for every tool response (MCP and `--json` CLI output):
```
{ data: ..., _meta: { tool, durationMs, degraded, degradedReason, personalizationLevel } }
```

Degraded mode returns `degraded: true` with a reason when `.unfade/` is missing or services are unavailable.

### Other Schemas

- **ReasoningModel v2** (`src/schemas/profile.ts`) -- Developer reasoning identity with patterns (decision style, trade-offs, domain expertise, AI interaction, exploration habits), confidence scores, and observation history
- **DailyDistill** (`src/schemas/distill.ts`) -- Distillation output with decisions, trade-offs, dead ends, and extracted/linked signals for the three-stage pipeline
- **MCP tool schemas** (`src/schemas/mcp.ts`) -- QueryInput, ContextInput, DecisionsInput, etc.
- **Card schemas** (`src/schemas/card.ts`) -- Card generation data
- **Metrics schemas** (`src/schemas/metrics.ts`) -- Reasoning metrics

---

## 6. Command Surface

### Server Command (bare `unfade`)

Running `unfade` with no arguments starts the long-running server. This is the primary experience. It performs a lightweight idempotent init (scaffolds `.unfade/` if missing), then starts the HTTP dashboard, MCP server, materializer, and capture engines for all registered repos. Ctrl+C shuts everything down cleanly.

### Run-and-Exit Commands

| Command | Purpose |
|---|---|
| `unfade status` | Show today's reasoning metrics and identity (no server needed) |
| `unfade query "..."` | Semantic search across reasoning history |
| `unfade distill` | Trigger manual distillation (`--date`, `--backfill`, `--provider` flags) |
| `unfade card` | Generate a Reasoning Card PNG (`--v3` for full anti-vibe certificate) |
| `unfade export` | Export `.unfade/` as portable `.tar.gz` (`--leadership` for aggregate-only) |
| `unfade publish` | Generate Thinking Graph static site |
| `unfade doctor` | Diagnose paths, processes, and registry health |
| `unfade ingest` | Ingest historical AI session data (Claude Code, Cursor, Codex, Aider) |
| `unfade add <path>` | Register an additional repo for tracking |
| `unfade reset` | Remove `.unfade/`, stop capture (`--global` for full cleanup) |
| `unfade mcp` | Start MCP stdio server (hidden, used by IDE integrations) |
| `unfade prompt` | Metric badge for shell prompt integration |

### Global Flags

`--verbose`, `--quiet`, `--json`, `--config <path>`

---

## 7. Design Principles

1. **Decide once per concern.** One linter (Biome), one test runner (Vitest), one bundler (tsdown), one schema system (Zod). No committee debates per phase.

2. **Schemas are the source of truth.** `src/schemas/` defines every data contract. Runtime validation, TypeScript types, MCP tool schemas, and documentation all derive from Zod schemas.

3. **stdout is sacred.** MCP JSON-RPC uses stdout. All logging, progress, debug output, and user messages go to stderr via `logger.info()` / `logger.error()`. Never `console.log()`. Never write to `process.stdout` directly (except MCP transport and `--json` output).

4. **Paths are resolved, not hardcoded.** `src/utils/paths.ts` handles `~/.unfade/` (user) and `.unfade/` (project) resolution using `node:path` join and `os.homedir()`. Every service uses path utilities.

5. **Build produces one file.** tsdown bundles `src/entrypoints/cli.ts` into `dist/cli.mjs`. Single ESM output with shebang. `npx unfade` works out of the box.

6. **Tests mirror source.** `test/schemas/event.test.ts` tests `src/schemas/event.ts`. No creative directory structures.

7. **Conventions in CLAUDE.md.** Every project convention (stdout sacred, stderr only, response envelope, schema-first, `.unfade/` workspace, user-facing terminology) is documented so AI-assisted development follows the rules automatically.

8. **One writer per file.** In the `.unfade/` workspace, each file has exactly one owning process that writes to it. Go owns `events/`, TypeScript owns `distills/`, `profile/`, `graph/`. This prevents corruption without needing locks.

---

## 8. Implementation Summary

Phase 0 is **complete**. All foundation infrastructure is in place and actively used by Phases 1-4.

### What Was Built

**Build Pipeline:**
- `package.json` -- name `unfade`, `type: "module"`, bin `./dist/cli.mjs`, Node 20+ engine requirement
- `tsconfig.json` -- strict mode, ES2022 target, Node16 module resolution, JSX support (react-jsx)
- `tsdown.config.ts` -- single ESM entry, node20 target, clean output, shebang banner injection
- `biome.json` -- Biome 2.x with recommended rules, space indentation (width 2), line width 100, import organization, JSON formatting
- `vitest.config.ts` -- ESM-native tests at `test/**/*.test.ts`, v8 coverage provider, 80% statement threshold

**CLI Entry Point (`src/entrypoints/cli.ts`):**
- Commander with `@commander-js/extra-typings` for type-safe commands
- Global flags (`--verbose`, `--quiet`, `--json`, `--config`) with `preAction` hook for logger configuration
- Bare `unfade` starts the long-running server (lightweight init, then HTTP + MCP + capture engines)
- All other commands are run-and-exit with lazy imports for fast startup

**Logger (`src/utils/logger.ts`):**
- Singleton `Logger` class with `debug`, `info`, `warn`, `error` methods
- Writes exclusively to `process.stderr.write()` -- never stdout
- Configurable verbosity: `--verbose` enables debug, `--quiet` suppresses info
- Timestamped output with chalk color-coded level labels (DBG, INF, WRN, ERR)

**Path Utilities (`src/utils/paths.ts`):**
- `getUserConfigDir()` -- `~/.unfade/` via `os.homedir()`
- `getProjectDataDir()` -- `.unfade/` relative to nearest `.git` root (walks up directory tree), falls back to cwd
- `getDaemonProjectRoot()` -- repo root for capture engine `--project-dir` flag
- Subdirectory helpers: `getEventsDir()`, `getDistillsDir()`, `getProfileDir()`, `getStateDir()`, `getGraphDir()`, `getInsightsDir()`, `getMetricsDir()`, `getAmplificationDir()`, `getCacheDir()`, `getLogsDir()`, `getBinDir()`, `getCardsDir()`, `getSiteDir()`, `getUserStateDir()`

**Schemas (`src/schemas/`):**
- `event.ts` -- CaptureEventSchema with cross-language Go struct mirror
- `config.ts` -- UnfadeConfigSchema v1/v2 with full defaults, nested sections (capture, distill, mcp, notification, site, otel, pricing, export)
- `profile.ts` -- ReasoningModelV2Schema with pattern categories, domain tracking, decision stats
- `distill.ts` -- DailyDistillSchema with decisions, trade-offs, dead ends, signal extraction pipeline types
- `tool-response.ts` -- ToolResponseSchema envelope with `_meta`
- `mcp.ts` -- MCP tool input schemas
- `card.ts`, `metrics.ts`, `init-progress.ts` -- additional domain schemas

**Config System (`src/config/`):**
- `manager.ts` -- load/save config with auto-creation of defaults
- `config-migrations.ts` -- sequential v1 to v2 migration with `.backup.json` safety
- `migrations.ts` -- reasoning_model.json v1 to v2 profile migration

**Error Handling (`src/utils/cli-error.ts`):**
- `handleCliError()` for all CLI commands
- User-friendly messages with hints for common failures (ECONNREFUSED, missing `.unfade/`, permissions)
- Debug-level stack traces, sets `process.exitCode = 1`

**Go Capture Engine (`daemon/`):**
- Go module at `github.com/unfade-io/unfade-cli/daemon`
- Two binaries: `unfaded` (main capture engine) and `unfade-send` (event sender)
- `internal/capture/` with event struct mirroring TypeScript CaptureEventSchema
- AI session parsers for Claude Code, Cursor, Codex, and Aider
- Heuristic classifier for event categorization
- Makefile with build, test, clean targets

**CI Pipeline (`.github/workflows/`):**
- TypeScript job: install, build, lint, typecheck, test
- Go job: build both binaries, vet

### Key Files

| File | Purpose |
|---|---|
| `src/entrypoints/cli.ts` | Commander entry point, all commands registered |
| `src/utils/logger.ts` | Structured stderr-only logger |
| `src/utils/paths.ts` | `.unfade/` and `~/.unfade/` path resolution |
| `src/utils/cli-error.ts` | CLI error handling with user-friendly hints |
| `src/schemas/event.ts` | CaptureEvent schema (cross-language contract) |
| `src/schemas/config.ts` | Config schema with full defaults |
| `src/schemas/tool-response.ts` | Response envelope with `_meta` |
| `src/config/config-migrations.ts` | Config v1 to v2 migration |
| `daemon/internal/capture/event.go` | Go CaptureEvent struct (mirrors TypeScript) |
| `CLAUDE.md` | Engineering conventions |

---

## 9. Success Metrics

| Metric | Target | Status |
|---|---|---|
| **Build success** | `pnpm build` exits 0, produces `dist/cli.mjs` | Achieved |
| **Lint pass** | Zero warnings, zero errors from Biome | Achieved |
| **Typecheck pass** | `pnpm typecheck` exits 0 with strict mode | Achieved |
| **Test pass rate** | All tests pass | Achieved |
| **CLI runs** | `./dist/cli.mjs --help` shows banner, version, all commands | Achieved |
| **Schema coverage** | Schemas for event, config, profile, distill, tool response, MCP, card, metrics | Achieved |
| **Logger stderr guarantee** | Logger never writes to stdout | Achieved (tested) |
| **Config defaults** | Empty `{}` produces valid config with all defaults | Achieved (tested) |
| **Go capture engine build** | `make all` in `daemon/` produces both binaries | Achieved |
| **Cross-language contract** | CaptureEvent Go struct and Zod schema stay in sync | Achieved |

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Zod major version drift** | Low | Medium | Pinned to Zod v4. Schema exports are stable across minor versions. Migration path documented if needed |
| **tsdown breaking changes** | Low | Low | tsdown config is minimal (5 lines). Fallback: switch to tsup or esbuild with minimal effort |
| **Node 20 ESM edge cases** | Low | Medium | Using `moduleResolution: "NodeNext"` and `.js` extensions in imports. Both reference CLIs validated this pattern |
| **Go/TypeScript schema drift** | Medium | High | CaptureEvent is the only cross-language schema. CI tests validate both sides. CLAUDE.md documents the sync requirement |
| **CLAUDE.md drift from code** | Medium | Low | CLAUDE.md is updated with each phase. Serves as living documentation for AI-assisted development |
| **Dependency version conflicts** | Low | Low | `pnpm-lock.yaml` pins exact versions. `pnpm.onlyBuiltDependencies` limits native builds to Biome, resvg-js, esbuild |

---

> **Next phase:** Phase 1: Capture & Intelligence -- Event capture, distillation engine, personalization seed, query, Reasoning Cards.

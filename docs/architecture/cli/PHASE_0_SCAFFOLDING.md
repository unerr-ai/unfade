# Phase 0 — Project Scaffolding: Foundation for Every Phase

> **Feature Statement:** _"Every file, config, schema, and convention that every subsequent phase depends on is established in a single 2-3 day sprint. The project is buildable, lintable, testable, and runnable from day one. No phase ever starts by asking 'how do we set up TypeScript?' — Phase 0 answers that once, permanently."_
>
> **Prerequisites:** None — this is the starting point.
>
> **Status:** AWAITING REVIEW
>
> **Inspired by:** unerr-cli scaffolding (tsup + Commander + Biome + Vitest), Claude Code's service isolation pattern, Stripe's "one decision per concern" infrastructure philosophy
>
> **Foundation doc:** [Research & Design](./UNFADE_CLI_RESEARCH_AND_DESIGN.md)
>
> **Last updated:** 2026-04-14

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem: Starting From Zero](#2-the-problem-starting-from-zero)
- [3. Research: What Reference CLIs Chose](#3-research-what-reference-clis-chose)
- [4. Architecture: Project Layout](#4-architecture-project-layout)
- [5. Technology Decisions](#5-technology-decisions)
- [6. Core Schemas (Single Source of Truth)](#6-core-schemas-single-source-of-truth)
- [7. Command Hierarchy](#7-command-hierarchy)
- [8. Design Principles](#8-design-principles)
- [9. Implementation Plan (Sprint 0)](#9-implementation-plan-sprint-0)
- [10. Dependency List](#10-dependency-list)
- [11. Success Metrics](#11-success-metrics)
- [12. Risk Assessment](#12-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Exists

Every Phase 1–5 task assumes a working build pipeline, a linting standard, a test runner, a CLI entry point, and validated schemas. Without Phase 0:

- Sprint 1 (Capture Foundation) starts with "how do we configure TypeScript?" instead of "how do we capture git events"
- Every contributor makes independent, conflicting tooling choices
- Schema drift between services starts on Day 1 instead of being prevented by Day 1

### 1.2 The Principle

> **Decide tooling once. Enforce via config. Every sprint after this writes features, not infrastructure.**

---

## 2. The Problem: Starting From Zero

### Current state

An empty repository with only product strategy documents (`docs/product/`) and architecture plans (`docs/architecture/cli/`). No `package.json`, no build pipeline, no source files.

### After Phase 0

| Concern | State |
|---|---|
| **Build** | `pnpm build` → `dist/cli.js` (single ESM bundle via tsup) |
| **Lint** | `pnpm lint` → Biome checks pass (formatting + lint rules) |
| **Test** | `pnpm test` → Vitest runs 11+ tests, all passing |
| **Run** | `./dist/cli.js --help` → Unfade banner + command list |
| **Schemas** | `src/schemas/` → Zod schemas for events, config, profile |
| **Logger** | `src/utils/logger.ts` → structured logger, always stderr |
| **Paths** | `src/utils/paths.ts` → `~/.unfade/` and `.unfade/` resolution |
| **Conventions** | `CLAUDE.md` → project rules for AI-assisted development |

---

## 3. Research: What Reference CLIs Chose

| Decision | Claude Code | unerr-cli | Unfade Choice | Rationale |
|---|---|---|---|---|
| **Language** | TypeScript (Bun) | TypeScript (Node 20, ESM) | TypeScript (Node 20+, ESM, strict) | Widest ecosystem, `npx` support, both references validate TS |
| **Bundler** | Custom Bun scripts | tsup (single entry → ESM) | tsup | Proven in unerr, minimal config, fast |
| **CLI framework** | @commander-js/extra-typings | commander ^12 | @commander-js/extra-typings | Type-safe command definitions, used by both |
| **Linting** | Biome ^1.9 | Biome ^1.9 | Biome ^1.9 | Fast, replaces ESLint + Prettier, both references agree |
| **Validation** | Zod ^3.24 | Zod ^3.24 | Zod ^3.24 | Type-safe schemas, both references agree |
| **Testing** | (internal) | Vitest | Vitest | ESM-native, fast, excellent DX |
| **Terminal UI** | Custom Ink fork (50+ files) | Stock Ink 6.x | Stock Ink 6.x | Avoid maintenance burden, Unfade needs lighter UI |
| **Config layout** | `~/.claude/` + `.claude/` | `~/.unerr/` + `.unerr/` | `~/.unfade/` + `.unfade/` | Proven convention, layered (user → project) |

---

## 4. Architecture: Project Layout

> **Hybrid architecture:** The daemon (`unfaded`) is a Go binary that handles all passive capture (git hooks, shell hooks, AI session watching via `fsnotify`). The CLI and all user-facing features are TypeScript. The `.unfade/` directory is the communication bus — Go writes events, TypeScript reads them. The daemon binary is downloaded and verified during `unfade init`.

```
unfade-cli/
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── tsup.config.ts
├── CLAUDE.md
│
├── src/
│   ├── entrypoints/
│   │   └── cli.ts                    # Commander entry point
│   │
│   ├── commands/                     # CLI command implementations
│   │   ├── init.ts                   # Phase 1 — init wizard, daemon download, fingerprinting
│   │   ├── open.ts                   # Phase 1 — open web UI (localhost:7654)
│   │   ├── query.ts                  # Phase 1 — semantic search across reasoning history
│   │   ├── distill.ts                # Power user — trigger manual distillation
│   │   ├── export.ts                 # Power user — export .unfade/ as portable .tar.gz
│   │   └── daemon.ts                 # Power user — `unfade daemon stop`
│   │
│   ├── tui/                          # Ink TUI dashboard (bare `unfade` with no args)
│   │   └── dashboard.tsx             # Status, today's distill, quick actions
│   │
│   ├── server/                       # Web UI server (localhost:7654)
│   │   └── pages/                    # htmx server-rendered HTML templates
│   │
│   ├── services/                     # Core service modules
│   │   ├── capture/                  # Phase 1
│   │   │   ├── event-store.ts        # Read-side: reads events written by Go daemon
│   │   │   └── sources/
│   │   │       └── types.ts
│   │   │
│   │   ├── shell/                    # Shell hook installer
│   │   │   └── installer.ts          # Detects zsh/bash/PowerShell, installs capture hooks
│   │   │
│   │   ├── daemon/                   # Go daemon binary management
│   │   │   └── binary.ts             # Download/verify Go daemon binary during init
│   │   │
│   │   ├── distill/                  # Phase 1
│   │   │   ├── distiller.ts
│   │   │   ├── signal-extractor.ts
│   │   │   ├── context-linker.ts
│   │   │   ├── synthesizer.ts
│   │   │   ├── amplifier.ts          # Phase 2
│   │   │   └── providers/
│   │   │       ├── types.ts
│   │   │       ├── ollama.ts
│   │   │       ├── openai.ts
│   │   │       └── anthropic.ts
│   │   │
│   │   ├── personalization/          # Phase 1
│   │   │   ├── profile-builder.ts
│   │   │   ├── pattern-detector.ts
│   │   │   ├── domain-tracker.ts
│   │   │   └── context-shaper.ts     # Phase 2
│   │   │
│   │   ├── mcp/                      # Phase 2
│   │   │   ├── server.ts
│   │   │   ├── resources.ts
│   │   │   ├── tools.ts
│   │   │   └── prompts.ts
│   │   │
│   │   ├── http/                     # Phase 2
│   │   │   ├── server.ts
│   │   │   └── routes.ts
│   │   │
│   │   ├── card/                     # Phase 1
│   │   │   ├── generator.ts
│   │   │   └── templates.ts
│   │   │
│   │   ├── scheduler/                # Phase 1
│   │   │   └── scheduler.ts
│   │   │
│   │   └── notification/             # Phase 1
│   │       └── notifier.ts
│   │
│   ├── tools/                        # Unified Tool definitions (CLI + MCP)
│   │   ├── types.ts                  # Phase 0 (interface only)
│   │   ├── unfade-query.ts           # Phase 1
│   │   ├── unfade-context.ts         # Phase 2
│   │   ├── unfade-amplify.ts         # Phase 2
│   │   ├── unfade-similar.ts         # Phase 2
│   │   ├── unfade-distill.ts         # Phase 1
│   │   ├── unfade-profile.ts         # Phase 1
│   │   ├── unfade-decisions.ts       # Phase 1
│   │   └── unfade-ask.ts             # Phase 5
│   │
│   ├── state/                        # Phase 0 (types), Phase 1 (impl)
│   │   ├── detector.ts
│   │   └── pid.ts
│   │
│   ├── config/                       # Phase 0 (defaults), Phase 1 (manager)
│   │   ├── manager.ts
│   │   ├── defaults.ts
│   │   └── migrations.ts
│   │
│   ├── schemas/                      # Phase 0 — single source of truth
│   │   ├── event.ts
│   │   ├── distill.ts
│   │   ├── profile.ts
│   │   ├── config.ts
│   │   ├── decision.ts
│   │   └── mcp.ts
│   │
│   ├── components/                   # Ink terminal UI components
│   │   ├── DistillView.tsx           # Phase 1
│   │   ├── ProgressBar.tsx           # Phase 1
│   │   └── InitWizard.tsx            # Phase 1
│   │
│   └── utils/                        # Phase 0 — shared utilities
│       ├── logger.ts
│       ├── paths.ts
│       ├── git.ts                    # Phase 1
│       ├── time.ts                   # Phase 1
│       └── ipc.ts                    # Phase 1
│
├── test/                             # Mirrors src/ structure
│   ├── schemas/
│   ├── utils/
│   ├── services/
│   ├── tools/
│   └── commands/
│
└── .unfade/                          # Created by `unfade init` (Phase 1)
    ├── config.json
    ├── state/
    │   ├── daemon.pid
    │   └── daemon.sock
    ├── events/                       # Written by Go daemon, read by TypeScript
    │   └── YYYY-MM-DD.jsonl
    ├── distills/
    │   └── YYYY-MM-DD.md
    ├── graph/
    │   ├── decisions.jsonl
    │   └── domains.json
    ├── profile/
    │   ├── reasoning_model.json
    │   └── preferences.json
    ├── amplification/
    │   └── connections.jsonl
    ├── cache/
    └── logs/
        └── daemon.log
```

---

## 5. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (ESM, strict mode) | Both reference CLIs. MCP SDK is TS-first. `npx` distribution. Proven at scale (Claude Code: 512K LOC, unerr: 18.6K LOC) |
| **Runtime** | Node.js 20+ | ESM support, widest ecosystem, `npx` works. Bun optional but not required |
| **CLI framework** | Commander + @commander-js/extra-typings | Type-safe commands. Both references use it |
| **Terminal UI** | Ink 6.x + React 19 | Stock Ink (no custom fork). TUI dashboard (`unfade` with no args: status, today's distill, quick actions) |
| **Web UI** | htmx (~14KB) | Server-rendered HTML pages on localhost:7654 via `unfade open`. Lightweight, no SPA framework needed |
| **Daemon** | Go binary (`unfaded`) | Separate Go binary for passive capture. Uses `fsnotify` for file watching. Downloaded during `unfade init` |
| **Bundler** | tsup | Single entry → single ESM output. Used by unerr-cli. Fast, minimal config |
| **Linting** | Biome | Both references. Replaces ESLint + Prettier. Single tool |
| **Validation** | Zod 3.x | Both references. Type-safe schema contracts for all data boundaries |
| **Testing** | Vitest | ESM-native. Fast. Used by unerr-cli |
| **File watching** | fsnotify (Go daemon) | Handled by the Go daemon binary, not the TypeScript CLI |
| **MCP** | @modelcontextprotocol/sdk (latest) | Universal agent protocol. Both references |
| **Git operations** | isomorphic-git | Pure JS. No native deps. Used for `unfade init` fingerprinting (not the daemon — the Go daemon handles git event capture) |
| **Local storage** | Markdown + JSONL + JSON | Plain text, inspectable, greppable. Core to trust model. No database for v1 |
| **LLM integration** | Ollama (default) + OpenAI-compatible API | Local-first. Provider-agnostic interface |
| **IPC (daemon)** | Filesystem-as-IPC (`.unfade/` directory) | Go daemon writes to `.unfade/events/`, TypeScript reads. No sockets needed for primary data flow. Unix domain socket retained for daemon lifecycle commands (stop/status) |
| **Notifications** | node-notifier | Cross-platform system notifications |
| **Process management** | PID file + proper-lockfile | Single-instance daemon guarantee |

---

## 6. Core Schemas (Single Source of Truth)

### 6.1 CaptureEvent — the universal event format

Every signal captured by the daemon (git commit, AI session fragment, terminal command, manual annotation) is stored as a `CaptureEvent` in daily JSONL files.

> **Cross-language contract:** This Zod schema mirrors the Go struct in the `unfaded` daemon. The Go daemon writes `CaptureEvent` JSON to `.unfade/events/YYYY-MM-DD.jsonl`; the TypeScript CLI reads and validates them with this schema. Any schema changes must be synchronized between both codebases.

```typescript
// src/schemas/event.ts
import { z } from 'zod';

export const CaptureEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  source: z.enum(['git', 'ai-session', 'terminal', 'browser', 'manual']),
  type: z.enum([
    'commit', 'diff', 'branch-switch', 'revert', 'stash', 'merge-conflict',
    'ai-conversation', 'ai-completion', 'ai-rejection',
    'command', 'error', 'retry',
    'bookmark', 'tab-visit',
    'annotation'
  ]),
  content: z.object({
    summary: z.string(),
    detail: z.string().optional(),
    files: z.array(z.string()).optional(),
    branch: z.string().optional(),
    project: z.string().optional(),
  }),
  gitContext: z.object({
    repo: z.string(),
    branch: z.string(),
    commitHash: z.string().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CaptureEvent = z.infer<typeof CaptureEventSchema>;
```

### 6.2 UnfadeTool — the unified tool interface

Every Unfade capability (query, distill, profile, amplify, similar) is a Tool with typed input/output. Serves both CLI commands and MCP tools through the same interface.

```typescript
// src/tools/types.ts
import { z } from 'zod';

export interface UnfadeTool<TInput extends z.ZodType, TOutput extends z.ZodType> {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  execute(input: z.infer<TInput>): Promise<z.infer<TOutput>>;
}

// Response envelope — every tool response includes meta
export const ToolResponseSchema = z.object({
  data: z.unknown(),
  _meta: z.object({
    tool: z.string(),
    durationMs: z.number(),
    degraded: z.boolean().default(false),
    degradedReason: z.string().optional(),
    personalizationLevel: z.enum(['none', 'seed', 'basic', 'deep']).default('none'),
  }),
});
```

### 6.3 UnfadeState — state detector types

```typescript
// src/state/detector.ts
export type UnfadeState =
  | 'not_initialized'       // No .unfade/ directory
  | 'initialized'           // .unfade/ exists but daemon not running
  | 'daemon_running'        // Daemon active, capturing
  | 'no_llm'                // Daemon running but no LLM configured
  | 'no_git'                // Not in a git repository
  | 'first_distill_pending' // Has events, no distill yet
  | 'ready';                // Fully operational

export async function detectState(): Promise<UnfadeState> {
  // Check conditions in priority order
  // Returns the most actionable state
}
```

### 6.4 UnfadeConfig — configuration schema

```typescript
// src/schemas/config.ts
import { z } from 'zod';

export const UnfadeConfigSchema = z.object({
  version: z.literal(1),

  capture: z.object({
    sources: z.object({
      git: z.boolean().default(true),
      aiSession: z.boolean().default(true),
      terminal: z.boolean().default(false),
      browser: z.boolean().default(false),
    }),
    aiSessionPaths: z.array(z.string()).default([
      '~/.cursor/logs/',
      '~/.claude/sessions/',
    ]),
    ignore: z.array(z.string()).default([
      'node_modules', '.git', 'dist', 'build',
    ]),
  }).default({}),

  distill: z.object({
    schedule: z.string().default('0 18 * * *'), // 6 PM daily
    provider: z.enum(['ollama', 'openai', 'anthropic', 'custom']).default('ollama'),
    model: z.string().default('llama3.2'),
    apiKey: z.string().optional(),
    apiBase: z.string().optional(),
  }).default({}),

  mcp: z.object({
    enabled: z.boolean().default(true),
    transport: z.enum(['stdio', 'http']).default('stdio'),
    httpPort: z.number().default(7654),
  }).default({}),

  notification: z.object({
    enabled: z.boolean().default(true),
    sound: z.boolean().default(false),
  }).default({}),
});

export type UnfadeConfig = z.infer<typeof UnfadeConfigSchema>;
```

### 6.5 CaptureSource — modular source interface

```typescript
// src/services/capture/sources/types.ts
import type { CaptureEvent } from '../../../schemas/event.js';

export interface CaptureSource {
  name: string;
  description: string;

  /** Check if this source is available (e.g., is this a git repo?) */
  isAvailable(): Promise<boolean>;

  /** Start watching for events */
  start(onEvent: (event: CaptureEvent) => void): Promise<void>;

  /** Stop watching */
  stop(): Promise<void>;

  /** Backfill historical events (e.g., git history) */
  backfill(since: Date): AsyncGenerator<CaptureEvent>;
}
```

### 6.6 LLMProvider — provider-agnostic LLM interface

```typescript
// src/services/distill/providers/types.ts
export interface LLMProvider {
  name: string;
  isAvailable(): Promise<boolean>;

  /** Generate a completion from a prompt */
  complete(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
  }): Promise<string>;
}
```

---

## 7. Command Hierarchy

> **Collapsed command surface:** The CLI has been reduced from 13 commands to 4 core + 3 power user commands. Most functionality is accessed through the TUI dashboard (`unfade` with no args) or the web UI (`unfade open`).

### 7.1 Core Commands (4)

```bash
unfade                    # TUI dashboard: status, today's distill, quick actions (Ink)
unfade init              # Initialize .unfade/, download Go daemon, configure LLM, install shell hooks, backfill 30 days
unfade open              # Open web UI in browser (localhost:7654, htmx server-rendered pages)
unfade query "..."       # Semantic search across reasoning history
```

### 7.2 Power User Commands (3)

```bash
unfade export            # Export .unfade/ as portable .tar.gz
unfade distill           # Trigger manual distillation
unfade daemon stop       # Gracefully stop the Go daemon
```

### 7.3 Global Flags

```bash
--json                   # JSON output for piping/scripting
--format=markdown|json|plain  # Output format
--verbose                # Debug-level output
--quiet                  # Suppress non-essential output
--config <path>          # Custom config file path
--data-dir <path>        # Custom .unfade/ directory path
```

---

## 8. Design Principles

1. **Decide once per concern.** One linter (Biome), one test runner (Vitest), one bundler (tsup), one schema system (Zod). No committee debates per sprint.

2. **Schemas are the source of truth.** `src/schemas/` defines every data contract. Runtime validation, TypeScript types, MCP tool schemas, and documentation all derive from Zod schemas.

3. **Logger writes to stderr. Always.** MCP JSON-RPC uses stdout. All diagnostics, progress, and debug output goes to stderr. No exceptions. This is enforced by the logger utility from day one.

4. **Paths are resolved, not hardcoded.** `src/utils/paths.ts` handles `~/.unfade/` (user) and `.unfade/` (project) resolution. Every service uses path utilities instead of string concatenation.

5. **Build produces one file.** `tsup` bundles `src/entrypoints/cli.ts` → `dist/cli.js`. Single ESM output. `npx unfade` works out of the box.

6. **Tests mirror source.** `test/schemas/event.test.ts` tests `src/schemas/event.ts`. No creative directory structures.

7. **Conventions in CLAUDE.md.** Every project convention (stdout sacred, stderr only, response envelope, schema-first) is documented in `CLAUDE.md` so AI-assisted development follows the rules automatically.

---

## 8b. Execution Guide (Day: Pre-Day 1)

> **Sourced from:** Master Execution Blueprint — consolidated tasks with acid tests, strict contracts, and agent directives for AI-agent-driven execution.

### Acid Test

```
npm run build          → produces dist/cli.js (empty commander app)
npm run lint           → biome passes
npm run test           → vitest runs (0 tests, 0 failures)
cd daemon && go build ./cmd/unfaded   → produces unfaded binary
cd daemon && go build ./cmd/unfade-send → produces unfade-send binary
```

### Repository Structure (Canonical)

```
unfade-cli/
├── src/                              # TypeScript CLI + server (unfade)
│   ├── cli.ts                        # Commander entry point
│   ├── commands/                     # CLI command handlers
│   ├── server/                       # Hono HTTP + MCP server
│   │   ├── routes/                   # JSON API endpoints
│   │   └── pages/                    # htmx server-rendered HTML
│   ├── services/                     # Business logic (fingerprint, distill, cards, etc.)
│   ├── schemas/                      # Zod schemas (shared source of truth)
│   ├── mcp/                          # MCP resources, tools, prompts
│   ├── tui/                          # Ink TUI components
│   └── utils/                        # Helpers (git, file I/O)
├── daemon/                           # Go daemon (unfaded + unfade-send)
│   ├── cmd/
│   │   ├── unfaded/                  # Main daemon entry point
│   │   │   └── main.go
│   │   └── unfade-send/              # Tiny shell hook companion
│   │       └── main.go
│   ├── internal/
│   │   ├── capture/                  # CaptureSource implementations
│   │   ├── platform/                 # PlatformManager (launchd, systemd)
│   │   ├── health/                   # Health reporter
│   │   └── state/                    # PID, socket, repos.json management
│   └── go.mod
├── package.json                      # CLI package + scripts + daemon optional deps
├── tsconfig.json
├── tsup.config.ts
├── biome.json
├── vitest.config.ts
└── docs/
```

### Consolidated Tasks (4) with Agent Directives

#### Task 0.1: TypeScript Project Scaffold

Set up the Node.js ESM project with all dependencies, build tooling, and an empty Commander CLI entry point.

**Agent directive:** "Initialize a TypeScript ESM project in the repo root. Use Commander with extra-typings as the CLI framework. Configure tsup for ESM bundling, biome for linting+formatting, vitest for testing. The entry point is `src/cli.ts` — register a single placeholder `init` command that prints 'not implemented'. Add `bin.unfade` to package.json pointing to `dist/cli.js`. Ensure `npm run build && npm run lint` passes."

**Dependencies to install:**
- Runtime: `commander`, `@commander-js/extra-typings`, `zod`, `ink`, `react`, `hono`, `isomorphic-git`, `@modelcontextprotocol/sdk`, `satori`, `@resvg/resvg-js`, `ollama-ai-provider`
- Dev: `typescript`, `tsup`, `@biomejs/biome`, `vitest`, `@types/react`, `@types/node`

**Key config decisions:**
- `package.json`: `"type": "module"`, `"bin": { "unfade": "./dist/cli.js" }`
- `tsconfig.json`: `"strict": true`, `"target": "ES2022"`, `"module": "Node16"`
- `tsup.config.ts`: `entry: ["src/cli.ts"]`, `format: ["esm"]`, `shims: true`
- `biome.json`: default rules, `"indentStyle": "space"`, `"indentWidth": 2`

#### Task 0.2: Go Daemon Scaffold

Set up the Go module with the daemon and unfade-send entry points. Both compile to zero-logic binaries.

**Agent directive:** "Create a Go module at `daemon/` with `go mod init github.com/anthropics/unfade-cli/daemon`. Create two commands: `cmd/unfaded/main.go` (prints 'unfaded: not implemented') and `cmd/unfade-send/main.go` (prints 'unfade-send: not implemented'). Create empty package directories: `internal/capture/`, `internal/platform/`, `internal/health/`, `internal/state/`. Add fsnotify dependency: `go get github.com/fsnotify/fsnotify`. Ensure both `go build ./cmd/unfaded` and `go build ./cmd/unfade-send` produce binaries."

#### Task 0.3: Shared Schema Definitions

Define all Zod schemas (TypeScript) and corresponding Go structs. These are the contracts between the two processes. Define them ONCE, here, before any business logic.

**Agent directive:** "Create Zod schemas in `src/schemas/` and matching Go structs in `daemon/internal/capture/`. These schemas are the canonical data contracts — every reader and writer in the system validates against them. Do NOT add any business logic — only type definitions and validation."

**Schemas to define (TypeScript — Zod):**

File `src/schemas/event.ts`:
```
CaptureEventSchema {
  version: z.number().int().default(1)
  timestamp: z.string().datetime()
  source: z.enum(["git", "ai_session", "terminal", "manual"])
  type: z.string()
  content: z.record(z.unknown())
  git_context: z.object({
    repo: z.string(),
    branch: z.string(),
    sha: z.string()
  }).optional()
}
```

File `src/schemas/decision.ts`:
```
DecisionSchema {
  date: z.string()
  decision: z.string()
  rationale: z.string()
  alternatives_evaluated: z.number().int()
  domain: z.string()
  dead_end: z.boolean()
  ai_modified: z.boolean()
  sources: z.array(z.string())
}
```

File `src/schemas/profile.ts`:
```
ReasoningModelSchema {
  version: z.number().int().default(1)
  updated_at: z.string().datetime()
  decision_style: z.object({
    avg_alternatives_evaluated: z.number(),
    convergence_speed: z.enum(["quick", "deliberate", "exhaustive"]),
    prototype_vs_analyze: z.number()
  })
  trade_off_weights: z.record(z.number())
  domain_depth: z.record(z.object({
    decision_count: z.number().int(),
    depth: z.enum(["shallow", "moderate", "deep"])
  }))
  exploration_habits: z.object({
    avg_dead_ends_per_major_decision: z.number(),
    dead_end_tolerance_minutes: z.number(),
    ai_acceptance_rate: z.number(),
    ai_modification_rate: z.number()
  })
  blind_spots: z.array(z.string())
  failure_patterns: z.array(z.string())
}
```

File `src/schemas/config.ts`:
```
ConfigSchema {
  version: z.number().int().default(1)
  llm: z.object({
    provider: z.enum(["ollama", "openai", "anthropic"]).default("ollama"),
    model: z.string().default("llama3.2"),
    apiKey: z.string().nullable().default(null)
  })
  capture: z.object({
    git: z.boolean().default(true),
    ai_sessions: z.boolean().default(true),
    terminal: z.boolean().default(true),
    ai_session_paths: z.array(z.string()),
    ignorePatterns: z.array(z.string()).default(["*.env", "*.secret"])
  })
  distillation: z.object({
    schedule: z.string().default("18:00"),
    timezone: z.string().default("America/New_York")
  })
  server: z.object({
    port: z.number().int().default(7654),
    host: z.string().default("127.0.0.1")
  })
  fingerprint: z.object({
    scanMonths: z.number().int().default(12),
    maxCommits: z.number().int().default(5000)
  })
}
```

**Go structs to define (daemon/internal/capture/event.go):**

```
CaptureEvent struct:
  Version    int
  Timestamp  string
  Source     string    // "git" | "ai_session" | "terminal" | "manual"
  Type       string
  Content    map[string]interface{}
  GitContext *GitContext   // nullable

CaptureSource interface:
  Name() string
  Initialize(config CaptureConfig) error
  Start(ctx context.Context) error
  Stop() error
  Events() <-chan CaptureEvent
```

#### Task 0.4: CI & Dev Scripts

Set up npm scripts, Makefile for Go, and a basic GitHub Actions workflow.

**Agent directive:** "Add npm scripts: `build`, `dev`, `lint`, `test`, `typecheck`. Add a Makefile in `daemon/` with targets: `build`, `test`, `clean`, `build-send` (for unfade-send). Create `.github/workflows/ci.yml` that runs TypeScript build+lint+test and Go build+test on push. Add `.gitignore` entries for `dist/`, `node_modules/`, `daemon/unfaded`, `daemon/unfade-send`, `.unfade/`."

---

## 9. Implementation Plan (Sprint 0)

> **Goal:** Buildable, lintable, testable project skeleton. 2-3 days.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-001** | Initialize `package.json` with name (`unfade`), version (`0.1.0`), type (`module`), bin (`./dist/cli.js`), scripts (`build`, `test`, `lint`, `dev`), all production and dev dependencies | `package.json` | [ ] |
| **UF-002** | Configure TypeScript — ESM, strict mode, `moduleResolution: "NodeNext"`, `target: "ES2022"`, `outDir: "dist"`, path aliases if needed | `tsconfig.json` | [ ] |
| **UF-003** | Configure Biome — lint rules (recommended), formatter (tabs → spaces, 2 width), organize imports, JSON formatting | `biome.json` | [ ] |
| **UF-004** | Configure Vitest — ESM support, `src/` root, coverage thresholds, test file pattern `test/**/*.test.ts` | `vitest.config.ts` | [ ] |
| **UF-005** | Configure tsup — single entry (`src/entrypoints/cli.ts`), format ESM, target node20, dts generation, clean output, shebang injection (`#!/usr/bin/env node`) | `tsup.config.ts` or `package.json` scripts | [ ] |
| **UF-006** | Create Commander entry point — bare skeleton with program name, version, description, `--help` output. Register placeholder commands: core (`init`, `open`, `query`) and power user (`export`, `distill`, `daemon stop`). Smart default: bare `unfade` launches Ink TUI dashboard | `src/entrypoints/cli.ts` | [ ] |
| **UF-007** | Create logger utility — structured logger that writes exclusively to stderr. Levels: debug, info, warn, error. Supports `--verbose` and `--quiet` flags. Never writes to stdout (MCP compatibility) | `src/utils/logger.ts` | [ ] |
| **UF-008** | Create path utilities — `getUserConfigDir()` → `~/.unfade/`, `getProjectDataDir()` → `.unfade/`, `getEventsDir()`, `getDistillsDir()`, `getProfileDir()`, `getStateDir()`. Cross-platform (macOS, Linux, Windows) | `src/utils/paths.ts` | [ ] |
| **UF-009** | Create Zod schemas — `CaptureEventSchema`, `UnfadeConfigSchema`, `ToolResponseSchema`, `ReasoningProfileSchema` (stub), `DailyDistillSchema` (stub), `DecisionSchema` (stub). Each exports both schema and inferred type | `src/schemas/event.ts`, `src/schemas/config.ts`, `src/schemas/profile.ts`, `src/schemas/distill.ts`, `src/schemas/decision.ts` | [ ] |
| **UF-010** | Create Tool interface types — `UnfadeTool<TInput, TOutput>` generic interface, `ToolResponseSchema` with `_meta` envelope | `src/tools/types.ts` | [ ] |
| **UF-011** | Write CLAUDE.md with project conventions — stdout sacred rule, stderr logging, schema-first development, response envelope pattern, graceful degradation modes, `.unfade/` workspace convention, test naming, commit message style | `CLAUDE.md` | [ ] |

### Tests for Sprint 0

| Test | What It Validates | File |
|---|---|---|
| **T-001** | CLI entry point: `--help` flag returns exit code 0 and includes "unfade" in output | `test/entrypoints/cli.test.ts` |
| **T-002** | Logger: info-level message writes to stderr, not stdout | `test/utils/logger.test.ts` |
| **T-003** | Logger: debug-level message suppressed when verbose is false | `test/utils/logger.test.ts` |
| **T-004** | Paths: `getUserConfigDir()` returns path ending in `.unfade` | `test/utils/paths.test.ts` |
| **T-005** | Paths: `getProjectDataDir()` returns `.unfade` relative to cwd | `test/utils/paths.test.ts` |
| **T-006** | Paths: `getEventsDir()` returns `<projectDir>/events` | `test/utils/paths.test.ts` |
| **T-007** | Schema: valid CaptureEvent passes validation | `test/schemas/event.test.ts` |
| **T-008** | Schema: CaptureEvent with missing `source` fails validation | `test/schemas/event.test.ts` |
| **T-009** | Schema: valid UnfadeConfig with defaults fills all fields | `test/schemas/config.test.ts` |
| **T-010** | Schema: empty object produces valid config with all defaults | `test/schemas/config.test.ts` |
| **T-011** | Schema: ToolResponseSchema validates envelope with `_meta` | `test/schemas/tool.test.ts` |

---

## 10. Dependency List

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.82.0",
    "@commander-js/extra-typings": "^13.1.0",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "hono": "^4.0.0",
    "htmx.org": "^2.0.0",
    "ignore": "^6.0.0",
    "ink": "^6.0.0",
    "isomorphic-git": "^1.37.0",
    "node-notifier": "^10.0.0",
    "ollama": "^0.5.0",
    "openai": "^4.0.0",
    "picocolors": "^1.1.0",
    "proper-lockfile": "^4.1.0",
    "react": "^19.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/node": "^22.0.0",
    "@types/proper-lockfile": "^4.1.0",
    "@types/react": "^19.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

---

## 11. Success Metrics

| Metric | Current | Target | How to Measure |
|---|---|---|---|
| **Build success** | N/A (no project) | `pnpm build` exits 0, produces `dist/cli.js` | CI / manual |
| **Test pass rate** | N/A | 11/11 tests pass | `pnpm test` |
| **Lint pass** | N/A | Zero warnings, zero errors | `pnpm lint` |
| **CLI help output** | N/A | Shows banner, version, all command stubs | `./dist/cli.js --help` |
| **Schema coverage** | N/A | 5 schemas (event, config, profile, distill, decision) with Zod + inferred types | File count + type check |
| **Logger stderr guarantee** | N/A | Logger never writes to stdout | Test T-002 |
| **Bundle size** | N/A | < 500KB (skeleton only) | `ls -la dist/cli.js` |
| **Time to scaffold** | N/A | < 3 days | Calendar |

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Ink 6.x + React 19 compatibility** | Medium | Medium | Both are used together in unerr-cli. Pin exact versions. If issues arise, defer Ink components to Phase 1 and use plain stderr output in Sprint 0 |
| **tsup shebang injection** | Low | Low | tsup supports `banner` config for shebang. If not, post-build script prepends `#!/usr/bin/env node` |
| **Node 20 ESM edge cases** | Low | Medium | Use `moduleResolution: "NodeNext"` and `.js` extensions in imports. Both reference CLIs handle this pattern |
| **Dependency version conflicts** | Low | Low | Lock file (`pnpm-lock.yaml`) pins exact versions. No floating ranges for critical deps |
| **CLAUDE.md drift from code** | Medium | Low | CLAUDE.md is a Sprint 0 deliverable AND a Sprint 7 update target. Review in every phase |

---

> **Next phase:** [Phase 1: The Core Loop](./PHASE_1_CORE_LOOP.md) — Capture foundation, daemon, distillation engine, personalization seed, query, Unfade Card.

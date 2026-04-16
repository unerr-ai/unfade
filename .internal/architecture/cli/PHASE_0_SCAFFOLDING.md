# Phase 0 — Project Scaffolding: Foundation for Every Phase

> **Feature Statement:** _"Every file, config, schema, and convention that every subsequent phase depends on is established in a single 2-3 day sprint. The project is buildable, lintable, testable, and runnable from day one. No phase ever starts by asking 'how do we set up TypeScript?' — Phase 0 answers that once, permanently."_
>
> **Prerequisites:** None — this is the starting point.
>
> **Status:** COMPLETE (Sprint 0A ✓, Sprint 0B ✓, Sprint 0C ✓ — all 13 tasks done, 13/13 tests passing)
>
> **Inspired by:** unerr-cli scaffolding (tsdown + Commander + Biome + Vitest), Claude Code's service isolation pattern, Stripe's "one decision per concern" infrastructure philosophy
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
- [9. Execution Plan — Micro-Sprints](#9-execution-plan--micro-sprints)
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
| **Build** | `pnpm build` → `dist/cli.js` (single ESM bundle via tsdown) |
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
| **Bundler** | Custom Bun scripts | tsup (single entry → ESM) | tsdown | Actively maintained successor to tsup, Rolldown-powered, compatible config |
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
├── tsdown.config.ts
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
│   │   │       └── ai.ts              # Vercel AI SDK integration (generateObject + provider adapters)
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
| **Bundler** | tsdown | Rolldown-powered ESM bundling. Actively maintained successor to tsup. Compatible config format |
| **Linting** | Biome | Both references. Replaces ESLint + Prettier. Single tool |
| **Validation** | Zod 3.x | Both references. Type-safe schema contracts for all data boundaries |
| **Testing** | Vitest | ESM-native. Fast. Used by unerr-cli |
| **File watching** | fsnotify (Go daemon) | Handled by the Go daemon binary, not the TypeScript CLI |
| **MCP** | @modelcontextprotocol/sdk (latest) | Universal agent protocol. Both references |
| **Git operations** | simple-git | Wraps system `git` binary — faster, lower memory than pure JS. Used for `unfade init` fingerprinting (not the daemon — the Go daemon handles git event capture) |
| **Local storage** | Markdown + JSONL + JSON | Plain text, inspectable, greppable. Core to trust model. No database for v1 |
| **LLM integration** | Vercel AI SDK (`ai`) + `ai-sdk-ollama` (default) + `@ai-sdk/openai` + `@ai-sdk/anthropic` | Local-first via Ollama. `generateObject()` for structured output via Zod. Single SDK abstracts all providers |
| **IPC (daemon)** | Filesystem-as-IPC (`.unfade/` directory) | Go daemon writes to `.unfade/events/`, TypeScript reads. No sockets needed for primary data flow. Unix domain socket retained for daemon lifecycle commands (stop/status) |
| **Interactive prompts** | @clack/prompts | Beautiful prompts for `unfade init` wizard flow. Lightweight alternative to inquirer |
| **Subprocess management** | execa | Clean subprocess spawning (daemon lifecycle, system git calls). ESM-native, better error handling than child_process |
| **HTTP server** | Hono + @hono/node-server | Lightweight web framework for localhost web UI. Use `overrideGlobalObjects: false` in `getRequestListener()` to avoid MCP SDK conflict |
| **Card rendering** | satori + resvg-js | Generate Unfade Card images from JSX → SVG → PNG. No browser dependency |
| **Notifications** | node-notifier | Cross-platform system notifications |
| **Process management** | PID file + proper-lockfile | Single-instance daemon guarantee |
| **Testing (fs)** | memfs | Virtual filesystem for unit tests — fast, isolated, no disk I/O |

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

### 6.6 LLM Integration — Vercel AI SDK

```typescript
// src/services/distill/providers/ai.ts
// Uses Vercel AI SDK — no custom LLMProvider interface needed
import { generateObject } from 'ai';
import { ollama } from 'ai-sdk-ollama';       // Default: local, offline
import { openai } from '@ai-sdk/openai';       // Opt-in: cloud
import { anthropic } from '@ai-sdk/anthropic'; // Opt-in: cloud

// Structured output via generateObject() + Zod schemas
// Provider selection from config.json, switchable per run with --provider flag
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

1. **Decide once per concern.** One linter (Biome), one test runner (Vitest), one bundler (tsdown), one schema system (Zod). No committee debates per sprint.

2. **Schemas are the source of truth.** `src/schemas/` defines every data contract. Runtime validation, TypeScript types, MCP tool schemas, and documentation all derive from Zod schemas.

3. **Logger writes to stderr. Always.** MCP JSON-RPC uses stdout. All diagnostics, progress, and debug output goes to stderr. No exceptions. This is enforced by the logger utility from day one.

4. **Paths are resolved, not hardcoded.** `src/utils/paths.ts` handles `~/.unfade/` (user) and `.unfade/` (project) resolution. Every service uses path utilities instead of string concatenation.

5. **Build produces one file.** `tsdown` bundles `src/entrypoints/cli.ts` → `dist/cli.js`. Single ESM output. `npx unfade` works out of the box.

6. **Tests mirror source.** `test/schemas/event.test.ts` tests `src/schemas/event.ts`. No creative directory structures.

7. **Conventions in CLAUDE.md.** Every project convention (stdout sacred, stderr only, response envelope, schema-first) is documented in `CLAUDE.md` so AI-assisted development follows the rules automatically.

---

## 9. Execution Plan — Micro-Sprints

> **Goal:** Buildable, lintable, testable project skeleton — TypeScript CLI + Go daemon. 2-3 days, split into 3 micro-sprints of max 5 tasks each. Each sprint is a self-contained unit with its own acid test.
>
> **Total:** 13 tasks (UF-001 → UF-011b) | 13 tests (T-001 → T-013)

---

### 9.1 Sprint 0A — TypeScript Build Pipeline (Day -2)

**Objective:** A TypeScript ESM project that compiles, lints, and runs an empty test suite. No source logic — only tooling configs.

**Acid Test:**
```bash
pnpm install && pnpm build && pnpm lint && pnpm test
# All four commands exit 0. dist/cli.js exists. No lint warnings. 0 tests, 0 failures.
```

| Task | Description | Output Files | Status |
|---|---|---|---|
| **UF-001** | Initialize `package.json` — name: `unfade`, version: `0.1.0`, type: `module`, bin: `./dist/cli.mjs`, scripts: `build`, `test`, `lint`, `dev`, `typecheck`. Install all production and dev dependencies (see Section 10) | `package.json`, `pnpm-lock.yaml` | `COMPLETE` |
| **UF-002** | Configure TypeScript — ESM, `strict: true`, `moduleResolution: "NodeNext"`, `module: "Node16"`, `target: "ES2022"`, `outDir: "dist"`, `rootDir: "src"`. Use `.js` extensions in all imports | `tsconfig.json` | `COMPLETE` |
| **UF-003** | Configure Biome 2.x — recommended lint rules, formatter: spaces, indent width 2, organize imports via assist, JSON formatting enabled | `biome.json` | `COMPLETE` |
| **UF-004** | Configure Vitest 4.x — ESM support, root: `./`, test file pattern `test/**/*.test.ts`, coverage thresholds (statements: 80%) | `vitest.config.ts` | `COMPLETE` |
| **UF-005** | Configure tsdown — single entry `src/entrypoints/cli.ts`, format: `esm`, target: `node20`, clean output, shebang injection (`#!/usr/bin/env node`). Create minimal `src/entrypoints/cli.ts` that just imports commander and calls `program.parse()` | `tsdown.config.ts`, `src/entrypoints/cli.ts` (stub) | `COMPLETE` |

**Agent Directive (Sprint 0A):**

> "Initialize a TypeScript ESM project in the repo root. Use pnpm as the package manager. Create `package.json` with `"type": "module"`, `"bin": { "unfade": "./dist/cli.js" }`, and scripts: `build` (tsup), `dev` (tsx watch), `lint` (biome check), `test` (vitest run), `typecheck` (tsc --noEmit). Install all dependencies from Section 10. Create `tsconfig.json` with strict mode, ES2022 target, Node16 module resolution. Create `biome.json` with recommended rules, space indentation (width 2). Create `vitest.config.ts` with ESM support. Create `tsdown.config.ts` with entry `src/entrypoints/cli.ts`, ESM format, node20 target, shebang banner. Create a minimal `src/entrypoints/cli.ts` that imports Commander, sets name/version/description, and calls `program.parse()`. Verify: `pnpm install && pnpm build && pnpm lint` all exit 0."

**Strict Contracts:**
- `package.json` MUST have `"type": "module"` — no CommonJS
- `tsconfig.json` MUST have `"strict": true` — no opt-out
- All imports MUST use `.js` extensions (ESM requirement)
- `dist/cli.js` MUST start with `#!/usr/bin/env node`

---

### 9.2 Sprint 0B — Core TypeScript + Go Scaffold (Day -1)

**Objective:** A runnable CLI with `--help` output, a stderr-only logger, path resolution utilities, and a Go daemon that compiles to two binaries.

**Acid Test:**
```bash
pnpm build && ./dist/cli.js --help
# Shows: "unfade" banner, version, command list (init, open, query, export, distill, daemon)

cd daemon && go build ./cmd/unfaded && go build ./cmd/unfade-send
# Both produce binaries without errors
```

| Task | Description | Output Files | Status |
|---|---|---|---|
| **UF-006** | Create Commander entry point — program name (`unfade`), version (from `package.json`), description. Register placeholder commands: `init`, `open`, `query` (core) and `export`, `distill`, `daemon stop/status` (power user). Each prints "not implemented" to stderr. Bare `unfade` (no args) prints help. Global flags: `--verbose`, `--quiet`, `--json`, `--config`, `--data-dir` | `src/entrypoints/cli.ts` | `COMPLETE` |
| **UF-007** | Create logger utility — structured logger that writes exclusively to stderr via `process.stderr.write()`. Levels: `debug`, `info`, `warn`, `error`. Respects `--verbose` (shows debug) and `--quiet` (suppresses info). Timestamped, color-coded with picocolors. NEVER writes to stdout | `src/utils/logger.ts` | `COMPLETE` |
| **UF-008** | Create path utilities — `getUserConfigDir()` → `~/.unfade/`, `getProjectDataDir()` → `.unfade/` (relative to nearest `.git`, falls back to cwd), `getEventsDir()`, `getDistillsDir()`, `getProfileDir()`, `getStateDir()`, `getGraphDir()`, `getCacheDir()`, `getLogsDir()`. Cross-platform via `node:os`, `node:path`, `node:fs` | `src/utils/paths.ts` | `COMPLETE` |
| **UF-011a** | Go daemon scaffold — `daemon/` directory with Go module (`github.com/unfade-io/unfade-cli/daemon`), Go 1.25.7. Two entry points: `cmd/unfaded/main.go`, `cmd/unfade-send/main.go`. Empty packages: `internal/capture/`, `internal/platform/`, `internal/health/`, `internal/state/`. fsnotify v1.9.0. Both binaries compile | `daemon/go.mod`, `daemon/cmd/unfaded/main.go`, `daemon/cmd/unfade-send/main.go` | `COMPLETE` |

**Agent Directive (Sprint 0B):**

> "Expand the CLI entry point from Sprint 0A into a full Commander skeleton. Register 6 placeholder commands: `init`, `open`, `query` (core), `export`, `distill` (power user), and a `daemon` command with `stop` subcommand. Each handler prints 'not implemented' to stderr and exits 0. Create `src/utils/logger.ts` — a structured logger with levels (debug, info, warn, error) that writes ONLY to stderr via `console.error()`. Export a singleton `logger` instance with methods: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`. The logger must accept a `verbose: boolean` and `quiet: boolean` config. Create `src/utils/paths.ts` with functions: `getUserConfigDir()` (returns `~/.unfade/`), `getProjectDataDir()` (returns `.unfade/` relative to cwd), `getEventsDir()`, `getDistillsDir()`, `getProfileDir()`, `getStateDir()`, `getGraphDir()` (all subdirectories of project data dir). Use `node:os` and `node:path` for cross-platform support. Then create the Go daemon scaffold: `daemon/go.mod`, `daemon/cmd/unfaded/main.go`, `daemon/cmd/unfade-send/main.go`. Both Go binaries just print a placeholder message and exit. Create empty directories with `.gitkeep` files: `daemon/internal/capture/`, `daemon/internal/platform/`, `daemon/internal/health/`, `daemon/internal/state/`. Run `go get github.com/fsnotify/fsnotify` in the daemon directory. Verify: `pnpm build && ./dist/cli.js --help` shows all commands, and `cd daemon && go build ./cmd/unfaded && go build ./cmd/unfade-send` both succeed."

**Strict Contracts:**
- Logger MUST write to stderr (`console.error`) — never `console.log` or `process.stdout`
- Path functions MUST use `node:path` join — no string concatenation with `/`
- `getUserConfigDir()` MUST use `os.homedir()` — no hardcoded `~`
- Go module path: `github.com/unfade-io/unfade-cli/daemon`
- Go daemon entry points are zero-logic — `fmt.Println()` only

---

### 9.3 Sprint 0C — Schemas, Contracts & CI (Day 0)

**Objective:** All cross-language data contracts defined, tool interface established, project conventions documented, CI pipeline green, all tests passing.

**Acid Test:**
```bash
pnpm test
# 13/13 tests pass (T-001 → T-013)

pnpm build && pnpm lint && pnpm typecheck
# All exit 0

cd daemon && go build ./cmd/unfaded && go build ./cmd/unfade-send && go vet ./...
# All exit 0
```

| Task | Description | Output Files | Status |
|---|---|---|---|
| **UF-009** | Zod 4 schemas — `CaptureEventSchema`, `UnfadeConfigSchema` (empty `{}` → full defaults via factory functions), `ReasoningModelSchema`, `DailyDistillSchema`, `DecisionSchema`, `ToolResponseSchema`. Go struct `CaptureEvent` with camelCase JSON tags mirroring TypeScript field-for-field | `src/schemas/event.ts`, `src/schemas/config.ts`, `src/schemas/profile.ts`, `src/schemas/distill.ts`, `src/schemas/decision.ts`, `src/schemas/tool-response.ts`, `daemon/internal/capture/event.go` | `COMPLETE` |
| **UF-010** | `UnfadeTool<TInput, TOutput>` generic interface + `ToolResponseSchema` re-export with `_meta` envelope (tool, durationMs, degraded, degradedReason, personalizationLevel) | `src/tools/types.ts` | `COMPLETE` |
| **UF-011** | CLAUDE.md rewritten with 7 engineering conventions: stdout sacred, Zod schemas as source of truth, response envelope, `.unfade/` workspace (one writer per file), "capture engine" terminology, test mirroring, ESM import rules. Build + daemon commands documented | `CLAUDE.md` | `COMPLETE` |
| **UF-011b** | CI pipeline (GitHub Actions: TS build+lint+typecheck+test, Go build+vet), `.gitignore` (comprehensive for hybrid TS+Go project), `daemon/Makefile` (build, build-send, test, clean). All 13 tests (T-001 → T-013) passing | `.github/workflows/ci.yml`, `.gitignore`, `daemon/Makefile`, `test/**/*.test.ts` | `COMPLETE` |

**Agent Directive (Sprint 0C):**

> "Create all Zod schemas in `src/schemas/`. For `event.ts`: define `CaptureEventSchema` with fields: `version` (int, default 1), `timestamp` (datetime string), `source` (enum: git, ai_session, terminal, manual), `type` (string), `content` (record of unknown), `git_context` (optional object: repo, branch, sha). Export `type CaptureEvent = z.infer<typeof CaptureEventSchema>`. For `config.ts`: define `UnfadeConfigSchema` matching Section 6.4 — all fields have defaults so an empty object produces a valid config. For `profile.ts`: define `ReasoningModelSchema` with decision_style, trade_off_weights, domain_depth, exploration_habits, blind_spots, failure_patterns. For `decision.ts`: define `DecisionSchema` with date, decision, rationale, alternatives_evaluated, domain, dead_end, ai_modified, sources. For `distill.ts`: create a stub `DailyDistillSchema` with date, summary, decisions (array), events_processed (int). Each file exports both schema and inferred type. Create `daemon/internal/capture/event.go` with a Go struct mirroring `CaptureEventSchema` — use `json` tags matching the TypeScript field names exactly. Create `src/tools/types.ts` with the `UnfadeTool` interface and `ToolResponseSchema` from Section 6.2. Update `CLAUDE.md` with project conventions: (1) stdout is sacred — only MCP JSON-RPC, (2) all logging to stderr, (3) Zod schemas are single source of truth, (4) response envelope with `_meta`, (5) one writer per `.unfade/` file (reference File Ownership Map in UNFADE_CLI_RESEARCH_AND_DESIGN.md), (6) user-facing terminology: 'capture engine' not 'daemon', (7) test files mirror source at `test/<path>/<name>.test.ts`. Create `.github/workflows/ci.yml` that runs on push and PR: job 1 runs `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test`, job 2 runs `cd daemon && go build ./cmd/unfaded && go build ./cmd/unfade-send && go vet ./...`. Create `.gitignore` with: dist/, node_modules/, daemon/unfaded, daemon/unfade-send, .unfade/, *.tgz. Create `daemon/Makefile` with targets: build (unfaded), build-send (unfade-send), test, clean. Write all 13 tests — see Section 9.4 for the full test matrix."

**Strict Contracts:**
- Zod schemas MUST export both the schema object AND the inferred type
- Go struct field names MUST use `json` tags matching TypeScript field names (snake_case)
- `CaptureEventSchema` TypeScript and Go `CaptureEvent` struct MUST be field-for-field identical
- `UnfadeConfigSchema` parsed with `{}` (empty object) MUST produce a fully populated config with all defaults
- CI workflow MUST test both TypeScript AND Go on every push
- CLAUDE.md MUST use "capture engine" terminology, not "daemon", in user-facing contexts (per Zero-Knowledge UX Plan)

---

### 9.4 Test Matrix (13 tests)

| Test | What It Validates | File | Sprint |
|---|---|---|---|
| **T-001** | CLI entry point: `--help` flag returns exit code 0 and includes "unfade" in output | `test/entrypoints/cli.test.ts` | 0C |
| **T-002** | Logger: info-level message writes to stderr, not stdout | `test/utils/logger.test.ts` | 0C |
| **T-003** | Logger: debug-level message suppressed when verbose is false | `test/utils/logger.test.ts` | 0C |
| **T-004** | Paths: `getUserConfigDir()` returns path ending in `.unfade` | `test/utils/paths.test.ts` | 0C |
| **T-005** | Paths: `getProjectDataDir()` returns `.unfade` relative to cwd | `test/utils/paths.test.ts` | 0C |
| **T-006** | Paths: `getEventsDir()` returns `<projectDir>/events` | `test/utils/paths.test.ts` | 0C |
| **T-007** | Schema: valid CaptureEvent passes validation | `test/schemas/event.test.ts` | 0C |
| **T-008** | Schema: CaptureEvent with missing `source` fails validation | `test/schemas/event.test.ts` | 0C |
| **T-009** | Schema: valid UnfadeConfig with defaults fills all fields | `test/schemas/config.test.ts` | 0C |
| **T-010** | Schema: empty object produces valid config with all defaults | `test/schemas/config.test.ts` | 0C |
| **T-011** | Schema: ToolResponseSchema validates envelope with `_meta` | `test/schemas/tool.test.ts` | 0C |
| **T-012** | Schema: DecisionSchema validates a complete decision record | `test/schemas/decision.test.ts` | 0C |
| **T-013** | Schema: ReasoningModelSchema validates a complete profile | `test/schemas/profile.test.ts` | 0C |

---

## 10. Dependency List

```json
{
  "dependencies": {
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@clack/prompts": "^0.9.0",
    "@commander-js/extra-typings": "^13.1.0",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "ai": "^4.0.0",
    "ai-sdk-ollama": "^0.2.0",
    "execa": "^9.0.0",
    "@hono/node-server": "^1.0.0",
    "hono": "^4.0.0",
    "htmx.org": "^2.0.0",
    "ignore": "^6.0.0",
    "ink": "^6.0.0",
    "node-notifier": "^10.0.0",
    "picocolors": "^1.1.0",
    "proper-lockfile": "^4.1.0",
    "react": "^19.0.0",
    "resvg-js": "^2.0.0",
    "satori": "^0.12.0",
    "simple-git": "^3.27.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/node": "^22.0.0",
    "@types/proper-lockfile": "^4.1.0",
    "@types/react": "^19.0.0",
    "memfs": "^4.0.0",
    "tsdown": "^0.9.0",
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
| **Go daemon build** | N/A | `go build ./cmd/unfaded` and `go build ./cmd/unfade-send` exit 0 | CI / manual |
| **Bundle size** | N/A | < 500KB (skeleton only) | `ls -la dist/cli.js` |
| **Time to scaffold** | N/A | < 3 days | Calendar |

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Ink 6.x + React 19 compatibility** | Medium | Medium | Both are used together in unerr-cli. Pin exact versions. If issues arise, defer Ink components to Phase 1 and use plain stderr output in Sprint 0 |
| **tsdown shebang injection** | Low | Low | tsdown supports `banner` config for shebang. If not, post-build script prepends `#!/usr/bin/env node` |
| **Node 20 ESM edge cases** | Low | Medium | Use `moduleResolution: "NodeNext"` and `.js` extensions in imports. Both reference CLIs handle this pattern |
| **Dependency version conflicts** | Low | Low | Lock file (`pnpm-lock.yaml`) pins exact versions. No floating ranges for critical deps |
| **CLAUDE.md drift from code** | Medium | Low | CLAUDE.md is a Sprint 0 deliverable AND a Sprint 7 update target. Review in every phase |

---

> **Next phase:** [Phase 1: Capture & Distill](./PHASE_1_CAPTURE_AND_DISTILL.md) — Capture foundation, daemon, distillation engine, personalization seed, query, Unfade Card.

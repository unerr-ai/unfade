# Layer 0: Foundation (Build, Schemas, Config, Paths, CLI)

Everything every other layer depends on: TypeScript toolchain, Zod schemas as single source of truth, global-first path resolution, structured stderr-only logging, Commander CLI entry point, Go daemon scaffold, and the conventions that prevent every subsequent layer from reinventing infrastructure.

---

## 1. Build Pipeline

Two independent build targets — one for the CLI backend, one for the React SPA — unified by a single `pnpm build` command.

### TypeScript CLI Bundle

`tsdown.config.ts` — Rolldown-powered ESM bundler. Single entry, single output:

```
src/entrypoints/cli.ts  →  tsdown  →  dist/cli.mjs

Config:
  entry:   ["src/entrypoints/cli.ts"]
  format:  "esm"
  target:  "node20"
  banner:  "#!/usr/bin/env node"     # Makes dist/cli.mjs directly executable
  clean:   false                      # Vite build writes dist/ui/ first
```

The shebang banner means `npx unfade` works out of the box. `package.json` maps `"bin": { "unfade": "./dist/cli.mjs" }`.

### React SPA Bundle

`vite.config.ts` — Vite 8 with React plugin and Tailwind CSS:

```
src/ui/  →  vite build  →  dist/ui/

Config:
  plugins:   [react(), tailwindcss()]
  root:      "."
  publicDir: false
  outDir:    "dist/ui"
  emptyOutDir: true
  resolve.alias:  "@" → "src/ui"      # Clean imports: @/components/...

Dev server (vite dev):
  port: 5173
  proxy:
    /api/*     → http://localhost:7654
    /unfade/*  → http://localhost:7654
    /mcp       → http://localhost:7654
```

The proxy config means `vite dev` + `pnpm dev` (tsx watch) gives full HMR for UI changes while API calls hit the real backend.

### Go Daemon Binaries

`daemon/Makefile` — two binaries, no build system complexity:

```
make all        →  go build -o unfaded ./cmd/unfaded
                   go build -o unfade-send ./cmd/unfade-send

make test       →  go test ./...
make clean      →  rm -f unfaded unfade-send
```

Platform-specific daemon packages (`@unfade/daemon-darwin-arm64`, etc.) are optional dependencies in `package.json` for binary distribution.

### Build Orchestration

```
pnpm build      =  pnpm build:ui && tsdown
                    (1) Vite builds SPA → dist/ui/
                    (2) tsdown bundles CLI → dist/cli.mjs
                    Order matters: tsdown's clean:false preserves dist/ui/

pnpm build:ui   =  vite build
pnpm lint       =  biome check .
pnpm lint:fix   =  biome check --write .
pnpm test       =  vitest run
pnpm typecheck  =  tsc --noEmit
pnpm dev        =  tsx watch src/entrypoints/cli.ts     # Backend dev
pnpm dev:ui     =  vite                                  # Frontend dev with HMR
```

### TypeScript Configuration

`tsconfig.json`:

| Setting | Value | Why |
|---|---|---|
| `target` | ES2022 | Modern JS features, Node 20+ |
| `module` | Node16 | ESM with `.js` extension requirement |
| `moduleResolution` | NodeNext | Matches Node's actual resolution algorithm |
| `strict` | true | Full type safety |
| `jsx` | react-jsx | React 19 JSX transform (no `import React` needed) |
| `verbatimModuleSyntax` | true | Forces explicit `type` imports |
| `isolatedModules` | true | Required for tsdown/esbuild compatibility |

### Linting

`biome.json` — Biome 2.x replaces ESLint + Prettier as a single tool:

```
formatter:  spaces, width 2, line width 100
linter:     recommended rules + explicit overrides
  suspicious.noExplicitAny: warn (not error — pragmatic)
  style.noNonNullAssertion: warn
  a11y: warn-level (accessibility matters but doesn't block)
assist:     organizeImports: on (auto-sort on save)
css:        tailwindDirectives: true, linting/formatting disabled (Tailwind handles it)
includes:   everything except dist/, node_modules/, daemon/, .unfade/
```

### Testing

`vitest.config.ts`:

```
include:     test/**/*.test.ts, test/**/*.test.tsx
coverage:    v8 provider, 80% statement threshold
passWithNoTests: true    # New test files don't break CI
```

Test files mirror source structure: `test/schemas/event.test.ts` tests `src/schemas/event.ts`.

---

## 2. Zod Schemas: The Single Source of Truth

Every data contract lives in `src/schemas/`. Each file exports both the Zod schema object and the inferred TypeScript type. Runtime validation, TypeScript types, MCP tool schemas, and error messages all derive from these schemas.

### CaptureEvent (`src/schemas/event.ts`)

The universal event format. Cross-language contract — mirrors Go struct in `daemon/internal/capture/event.go`. The Go daemon writes these; every TypeScript layer reads and validates them.

```
CaptureEventSchema:
  id:          UUID
  projectId:   string              # Global-first: every event tagged with project
  timestamp:   ISO 8601 datetime
  source:      "git" | "ai-session" | "terminal" | "browser" | "manual" | "mcp-active"
  type:        "commit" | "diff" | "branch-switch" | "revert" | "stash" |
               "merge-conflict" | "ai-conversation" | "ai-completion" |
               "ai-rejection" | "command" | "error" | "retry" |
               "bookmark" | "tab-visit" | "annotation"
  content:
    summary:   string              # Human-readable one-liner
    detail?:   string              # Full content (diff body, conversation text)
    files?:    string[]            # Affected file paths
    branch?:   string
    project?:  string
  gitContext?:
    repo:      string
    branch:    string
    commitHash?: string
  metadata?:   Record<string, unknown>   # Extensible key-value bag
```

**Cross-language sync**: This schema and the Go `CaptureEvent` struct in `daemon/internal/capture/event.go` MUST match. The Go daemon writes JSONL; TypeScript parses it with this schema. Drift = silent data loss.

### UnfadeConfig (`src/schemas/config.ts`)

Configuration with full defaults. An empty `{}` parsed through this schema produces a complete valid config.

```
UnfadeConfigSchema:
  version:       literal(2), default 2
  capture:
    sources:     { git: true, aiSession: true, terminal: false, browser: false }
    aiSessionPaths: ["~/.cursor/logs/", "~/.claude/sessions/"]
    ignore:      ["node_modules", ".git", "dist", "build"]
  distill:
    schedule:    "0 18 * * *"       # 6 PM daily
    provider:    "ollama" | "openai" | "anthropic" | "custom" | "none"  (default: "none")
    model:       "llama3.2"
    apiKey?:     string
    apiBase?:    string
  mcp:
    enabled:     true
    transport:   "stdio" | "http"   (default: "stdio")
    httpPort:    7654
  notification:  { enabled: true, sound: false }
  site:          { outputDir: ".unfade/site" }
  pricing:       { "claude-code": 0.01, "cursor": 0.005, ... }  # $/1K tokens
  actions:
    enabled: false, autoRules: false, ruleTarget: null,
    sessionContext: false, weeklyDigest: false, digestDay: "monday"
  export:
    requireConsent: true
    redactionPolicy: "aggregates-only" | "with-labels" | "with-names"
```

**Key design**: Every section has a `.default(() => SectionSchema.parse({}))` wrapper. This means partial configs (e.g., user only sets `distill.provider`) get all other defaults filled automatically.

### ToolResponse (`src/schemas/tool-response.ts`)

Envelope for every tool response — MCP, CLI `--json` output, and HTTP API responses:

```
ToolResponseSchema:
  data:          unknown              # The actual payload
  _meta:
    tool:        string               # Which tool/endpoint produced this
    durationMs:  number               # Processing time
    degraded:    boolean (default false)
    degradedReason?: string           # Why degraded (missing .unfade/, no LLM, etc.)
    personalizationLevel: "none" | "seed" | "basic" | "deep"
    provenance?:
      sourceEventIds: string[]        # Lineage back to capture events
      lineageUrl?:    string
```

**Degraded mode**: When `.unfade/` is missing or services are unavailable, tools return `degraded: true` with a human-readable reason instead of throwing. Every consumer knows to check `_meta.degraded`.

### Other Schemas

| Schema | File | Purpose |
|---|---|---|
| `ReasoningModelV2` | `src/schemas/profile.ts` | Developer reasoning identity: patterns, domains, decision stats, confidence scores |
| `DailyDistill` | `src/schemas/distill.ts` | Distillation output: decisions, trade-offs, dead ends, extracted signals |
| MCP tool inputs | `src/schemas/mcp.ts` | `QueryInput`, `ContextInput`, `DecisionsInput`, etc. |
| Card schemas | `src/schemas/card.ts` | Card generation data contracts |
| Metrics schemas | `src/schemas/metrics.ts` | Daily metric snapshot format |

---

## 3. Path Resolution (`src/utils/paths.ts`)

Global-first: all data lives under `~/.unfade/`. No per-project silos. Every path function accepts an optional `override` parameter for test isolation.

### Resolution Order

```
getUnfadeHome(override?):
  1. override provided     →  join(override, '.unfade')     # Test isolation
  2. UNFADE_HOME env var   →  use as-is                     # Docker, CI
  3. default               →  join(homedir(), '.unfade')    # ~/.unfade/
```

### Directory Functions

Every subdirectory of `~/.unfade/` has a dedicated function. No path string construction outside this file.

```
getUnfadeHome()         →  ~/.unfade/
getUserConfigDir()      →  ~/.unfade/                  (alias for config loader)
getEventsDir()          →  ~/.unfade/events/           (JSONL, date-partitioned)
getCacheDir()           →  ~/.unfade/cache/            (SQLite + DuckDB)
getStateDir()           →  ~/.unfade/state/            (registry, materializer cursor, server.json)
getProfileDir()         →  ~/.unfade/profile/          (reasoning_model.json)
getGraphDir()           →  ~/.unfade/graph/            (decisions.jsonl, domains.json)
getAmplificationDir()   →  ~/.unfade/amplification/    (cross-project connections)
getMetricsDir()         →  ~/.unfade/metrics/          (daily snapshots)
getInsightsDir()        →  ~/.unfade/insights/         (ring-buffered live insights)
getLogsDir()            →  ~/.unfade/logs/             (server + global logs)
getBinDir()             →  ~/.unfade/bin/              (shared Go binaries)
getCardsDir()           →  ~/.unfade/cards/            (generated PNGs)
getSiteDir()            →  ~/.unfade/site/             (Thinking Graph static site)
getUserStateDir()       →  ~/.unfade/state/            (registry.v1.json lives here)
getProjectDataDir()     →  ~/.unfade/projects/<id>/    (per-project overrides)
getDaemonProjectRoot()  →  repo root (walks up to nearest .git)
```

### `~/.unfade/` Directory Layout

```
~/.unfade/                        # Global home (single source of truth)
├── config.json                   # User config (UnfadeConfigSchema v2)
├── events/                       # ALL events, ALL projects (Go daemon writes)
│   └── YYYY-MM-DD.jsonl          # Date-partitioned, O_APPEND atomic writes
├── cache/
│   ├── unfade.db                 # SQLite — FTS, point lookups, lineage
│   └── unfade.duckdb             # DuckDB — analytics, 37 typed columns
├── intelligence/
│   ├── *.json                    # Analyzer output files (Layer 3 writes)
│   ├── state/*.state.json        # Analyzer watermark state
│   └── graph.db                  # CozoDB — entity graph, HNSW vectors
├── distills/                     # Markdown daily reasoning summaries
├── profile/                      # reasoning_model.json (global identity)
├── graph/                        # decisions.jsonl, domains.json
├── amplification/                # Cross-project reasoning connections
├── state/
│   ├── registry.v1.json          # All registered repos
│   ├── server.json               # Running server port/PID
│   ├── materializer.json         # JSONL cursor offsets
│   ├── setup-status.json         # Onboarding completion state
│   └── daemons/<id>/             # Per-daemon PID, socket, logs
├── insights/                     # Ring-buffered live insights
├── metrics/                      # Daily metric snapshots
├── logs/                         # Server + global logs
├── cards/                        # Generated Reasoning Card PNGs
├── site/                         # Generated Thinking Graph site
├── bin/                          # Shared Go binaries
└── projects/<id>/                # Per-project config overrides
```

**One writer per file**: Go daemon owns `events/`. Materializer owns `cache/`. Intelligence owns `intelligence/`. Distiller owns `distills/`. No locks needed when each file has exactly one writer.

---

## 4. Structured Logger (`src/utils/logger.ts`)

**stdout is sacred** — reserved exclusively for MCP JSON-RPC. All logging goes to stderr via Pino.

```
Logger (singleton):
  backend:     Pino → pino.destination({ dest: 2, sync: true })   # fd 2 = stderr
  levels:      debug, info, warn, error
  methods:     logger.debug(msg, data?), logger.info(msg, data?), ...
  child:       logger.child({ reqId, component }) → bound context fields
  configure:   logger.configure({ verbose?, quiet? })

Level resolution:
  --verbose flag  →  "debug"   (shows everything)
  --quiet flag    →  "warn"    (suppresses info)
  default         →  "info"

NEVER:
  console.log()           # Writes to stdout → breaks MCP
  process.stdout.write()  # Same problem (except MCP transport + --json output)
```

### Why Pino

Structured JSON output. Child loggers with bound fields (e.g., `reqId` per HTTP request). Sync writes to stderr prevent interleaving. `PINO_PRETTY=1` env var enables human-readable output for development.

---

## 5. CLI Error Handling (`src/utils/cli-error.ts`)

Every CLI command wraps its action in `handleCliError(err, commandName)`. Pattern-matched hints for common failures:

```
handleCliError(err, commandName):
  FOR EACH hint IN ERROR_HINTS:
    IF hint.match(err):
      logger.error(hint.message + "\n  " + hint.suggestion)
      logger.debug(stack trace)
      process.exitCode = 1
      RETURN
  # Fallback: generic error message
  logger.error(commandName + " failed: " + err.message)
  process.exitCode = 1

ERROR_HINTS:
  ECONNREFUSED          →  "Could not connect to the Unfade server."
                            'Run "unfade server" to start it.'
  ollama / port 11434   →  "Ollama does not appear to be running."
                            'Install from https://ollama.com and run "ollama serve".'
  .unfade + ENOENT      →  "No .unfade/ directory found."
                            'Run "unfade" to set up your project.'
  not a git repository  →  "This directory is not a git repository."
                            "Run this command from inside a git repository."
  EACCES / EPERM        →  "Permission denied."
                            "Check file permissions for the .unfade/ directory."
```

---

## 6. CLI Entry Point (`src/entrypoints/cli.ts`)

Commander with `@commander-js/extra-typings` for type-safe commands. Bare `unfade` starts the long-running server (like `next dev`). All other commands are run-and-exit.

### Command Registration

```
program = Command("unfade")
  .version("0.1.0")
  .description("Capture engineering reasoning...")
  .option("--verbose")
  .option("--quiet")
  .option("--json")
  .option("--config <path>")
  .hook("preAction", configure logger from flags)

Server (default action, no subcommand):
  unfade               →  startUnfadeServer()    # Long-running: HTTP + MCP + daemons

Setup:
  unfade add <path>    →  registerRepo(path)
  unfade reset         →  stop daemons, remove .unfade/

Run-and-exit:
  unfade status        →  show today's metrics
  unfade distill       →  trigger manual distillation (--date, --backfill, --provider)
  unfade query <q>     →  semantic search across reasoning history (--from, --to, --limit)
  unfade card          →  generate Reasoning Card PNG (--v3)
  unfade export        →  export .unfade/ as .tar.gz (--leadership, --output)
  unfade doctor        →  diagnose paths, processes, registry health
                          --rebuild-cache, --rebuild-intelligence, --verify-pipeline, --rebuild-graph
  unfade publish       →  generate Thinking Graph static site
  unfade ingest        →  ingest historical AI session data
  unfade mcp           →  start MCP stdio server (hidden, IDE integration)
  unfade prompt        →  metric badge for shell prompt
```

### Lazy Imports

All run-and-exit commands use `await import("../commands/...")` inside their action handler. Only the Commander framework loads at startup — individual command modules load on demand. This keeps `unfade --help` fast.

### Global Flags

`preAction` hook runs before every command, configuring the logger:

```
ON preAction(command):
  opts = command.opts()
  logger.configure({ verbose: opts.verbose, quiet: opts.quiet })
```

---

## 7. Configuration System (`src/config/manager.ts`)

Three-layer config merge: environment variables override project config, which overrides global config, which overrides Zod defaults.

### Load Order

```
loadConfig():
  env    = readEnvConfig()                     # UNFADE_CAPTURE__SOURCES__GIT=false
  global = readConfigFile(~/.unfade/config.json)
  project = readConfigFile(<projectDataDir>/config.json)
  merged = deepMerge(global, project, env)     # env wins
  return UnfadeConfigSchema.parse(merged)      # Zod fills all defaults
```

### Environment Variable Convention

`UNFADE_` prefix, double-underscore nesting separator, camelCase conversion:

```
UNFADE_CAPTURE__SOURCES__GIT=false    →  { capture: { sources: { git: false } } }
UNFADE_DISTILL__PROVIDER=anthropic    →  { distill: { provider: "anthropic" } }
UNFADE_MCP__HTTP_PORT=8080            →  { mcp: { httpPort: 8080 } }
```

Value coercion: `"true"/"false"` → boolean, numeric strings → number, everything else → string.

### Atomic Writes

All config saves use the tmp+rename pattern to prevent corruption:

```
writeConfig(data, dir):
  tmpPath = join(dir, "config.json.tmp.<pid>")
  writeFileSync(tmpPath, JSON.stringify(data, null, 2))
  renameSync(tmpPath, join(dir, "config.json"))    # Atomic on POSIX
```

---

## 8. Project Registry (`src/services/registry/registry.ts`)

Canonical list of all tracked repos at `~/.unfade/state/registry.v1.json`. Auto-migrates from legacy `repos.json`.

```
RegistryV1:
  schemaVersion: 1
  repos: RepoEntry[]

RepoEntry:
  id:           UUID
  root:         string              # Canonical git root path
  label:        string              # Display name (dirname)
  lastSeenAt:   ISO 8601
  addedVia:     "cli" | "ui" | "auto-discovery"
  monitoring:   "active" | "paused"
  capabilities: { daemon: boolean, git: boolean }
  paths:        { data: string }    # Project-specific data dir
```

### Operations

```
loadRegistry()       →  read registry.v1.json, auto-migrate from repos.json if needed
registerRepo(root)   →  add entry if not exists, update lastSeenAt if exists
                        writes atomically (tmp + rename)
```

The registry is the source of truth for which repos the daemon manager should spawn capture engines for.

---

## 9. Inter-Process Communication (`src/utils/ipc.ts`)

TypeScript ↔ Go daemon communication over Unix domain sockets. One JSON line request, one JSON line response, then close.

```
Protocol:
  Client sends:    { cmd: "ingest" | "stop" | "status", args?: {...} }\n
  Daemon responds: { ok: boolean, data?: {...}, error?: string }\n
  Connection closes.

sendIPCCommand(request, cwd?, timeoutMs=3000):
  socket = connect(~/.unfade/state/daemons/<id>/daemon.sock)
  write(JSON.stringify(request) + "\n")
  read response line
  parse JSON
  return IPCResponse

waitForDaemonIPCReady(socketPath, maxWaitMs):
  poll until socket accepts connections
  used during daemon startup to confirm ready state

Retryable errors:
  "Capture engine is not running"
  "Connection to capture engine timed out"
  "Capture engine closed connection without response"
```

---

## 10. Event Bus (`src/services/event-bus.ts`)

Process-wide push mechanism. The materializer and intelligence pipeline emit events; the SSE route and other consumers subscribe.

```
UnfadeEventBus extends EventEmitter:
  emitBus(event: BusEvent)     # Publish
  onBus(listener)               # Subscribe
  offBus(listener)              # Unsubscribe
  maxListeners = 100            # Multiple browser tabs

BusEvent:
  { type: "summary",      data: SummaryJson }
  { type: "event",        data: CaptureEvent }
  { type: "intelligence", data: { analyzer: string } }

Singleton:
  export const eventBus = new UnfadeEventBus()
```

This is the bridge between Layer 2 (materializer writes) and Layer 4 (SSE pushes to browser). No polling, no filesystem mtime checks.

---

## 11. Go Daemon Scaffold (`daemon/`)

The Go side of the cross-language boundary. Two binaries, one Go module.

### Module Structure

```
daemon/
├── go.mod                         # github.com/unfade-io/unfade-cli/daemon
├── Makefile                       # build, test, clean
├── cmd/
│   ├── unfaded/main.go            # Main capture engine
│   └── unfade-send/main.go        # Event sender utility
└── internal/
    ├── capture/                   # Git, AI session, terminal capture
    │   └── event.go               # CaptureEvent struct (mirrors TypeScript)
    ├── coordinator/               # Multi-repo coordination (enterprise)
    ├── health/                    # Health reporter goroutine
    └── platform/                  # Platform-specific (macOS, Linux)
```

### `unfaded` Startup Sequence

```
1. Parse flags:
     --project-dir     path to git repo root
     --capture-mode    "git-only" | "ai-global" | "full"
     --verbose         debug logging
     --coordinator     multi-repo mode (enterprise only)

2. Resolve daemon identity:
     daemonId = hash(projectDir + captureMode)
     stateDir = ~/.unfade/state/daemons/<daemonId>/

3. Acquire flock on PID file  →  exit if another instance holds lock
4. Start IPC server on Unix domain socket (daemon.sock)
5. Start health reporter goroutine
6. Start resource budget monitor
7. Register SIGTERM/SIGINT handlers for graceful shutdown
8. Begin capture (git watcher or AI session watcher depending on mode)
```

### Cross-Language Contract

The Go `CaptureEvent` struct and TypeScript `CaptureEventSchema` must stay in sync. Both define the same fields with the same types. The serialization boundary is `~/.unfade/events/YYYY-MM-DD.jsonl` — Go writes, TypeScript reads.

---

## 12. UI Foundation

The React SPA foundation provides the client-side infrastructure that Layer 4's page components build on.

### Entry Point (`src/ui/main.tsx`)

```
createRoot(document.getElementById("root"))
  .render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>
  )
```

Three concerns bootstrapped: React strict mode (dev checks), TanStack Query provider (data fetching), and the App component (routing).

### Query Client (`src/ui/lib/query-client.ts`)

```
QueryClient:
  staleTime:            30_000ms     # Data considered fresh for 30s
  retry:                1            # One retry on failure
  refetchOnWindowFocus: false        # SSE handles real-time updates
```

### Client State Store (`src/ui/stores/app.ts`)

```
Zustand store (persisted to localStorage as "unfade-app"):
  theme:            "dark" | "light"      # Toggles <html> classList
  sidebarCollapsed: boolean
  activeProjectId:  string                # "" = all projects
  persona:          "developer" | "lead" | "executive"

Actions:
  setTheme(t)        →  update classList + state
  toggleTheme()      →  dark ↔ light
  toggleSidebar()    →  collapse/expand
  setActiveProject() →  filter dashboard by project
  setPersona(p)      →  adjust metric display depth
```

### Path Alias

Vite resolve alias `@` → `src/ui/` enables clean imports across the SPA:

```typescript
import { App } from "@/App";
import { queryClient } from "@/lib/query-client";
import { useAppStore } from "@/stores/app";
```

---

## 13. Design Decisions

### Why tsdown over tsup/esbuild?

tsdown is the Rolldown-powered successor to tsup. Same minimal config pattern (5 lines), faster builds, actively maintained. If tsdown breaks, fallback to tsup or esbuild is trivial — the config surface is identical.

### Why Biome over ESLint + Prettier?

Single tool replaces two. Faster (Rust-based). Recommended rules are sensible defaults. Import organization built in (no `eslint-plugin-import`). The tradeoff: fewer community plugins. Acceptable for this project.

### Why Pino over Winston/console?

Structured JSON output by default. Child loggers with bound context fields. Sync writes to stderr prevent interleaving with MCP JSON on stdout. Zero-overhead level filtering (debug calls are no-ops when level is info).

### Why Zod for everything?

Single source of truth. Schema → TypeScript type → runtime validation → MCP tool schema → error messages. Alternatives (io-ts, typebox, effect/schema) require more boilerplate for the same outcome. Zod's `.default()` system is uniquely suited to Unfade's "empty config produces valid config" requirement.

### Why global-first (`~/.unfade/`) over per-project (`.unfade/`)?

Cross-project intelligence requires a single store. Per-project silos prevent the system from seeing patterns across repos. `projectId` as a dimension on every event provides per-project filtering when needed. `<repo>/.unfade` is a marker file (not a directory) pointing back to the global home.

### Why two Go binaries?

`unfaded` is the long-running daemon. `unfade-send` is a fire-and-forget utility for shell hooks to emit events without starting a daemon. Separate binaries mean shell hooks don't pay the daemon's startup cost.

---

## 14. File Map

```
# Build Configuration
package.json              # name: unfade, type: module, bin: ./dist/cli.mjs, node >=20
tsconfig.json             # ES2022, Node16 module, strict, react-jsx
tsdown.config.ts          # Single ESM entry → dist/cli.mjs with shebang
vite.config.ts            # React + Tailwind → dist/ui/, dev proxy to :7654
vitest.config.ts          # test/**/*.test.{ts,tsx}, v8 coverage, 80% threshold
biome.json                # Biome 2.x: spaces, width 2, recommended rules

# Foundation Source
src/entrypoints/cli.ts    # Commander entry: global flags, command registration, lazy imports
src/utils/logger.ts       # Pino singleton → stderr only (fd 2)
src/utils/paths.ts        # ~/.unfade/ path resolution, 15+ directory functions
src/utils/cli-error.ts    # handleCliError() with pattern-matched hints
src/utils/ipc.ts          # Unix socket JSON-RPC client for daemon communication
src/config/manager.ts     # Three-layer config merge: env → project → global → Zod defaults
src/services/event-bus.ts # Process-wide EventEmitter: summary, event, intelligence

# Schemas
src/schemas/event.ts      # CaptureEvent — cross-language contract with Go
src/schemas/config.ts     # UnfadeConfig v2 — full defaults, 8 sections
src/schemas/tool-response.ts  # ToolResponse envelope with _meta
src/schemas/profile.ts    # ReasoningModel v2 — patterns, domains, confidence
src/schemas/distill.ts    # DailyDistill — decisions, trade-offs, dead ends
src/schemas/mcp.ts        # MCP tool input schemas
src/schemas/card.ts       # Card generation schemas
src/schemas/metrics.ts    # Daily metric snapshot format

# Registry
src/services/registry/registry.ts  # registry.v1.json CRUD, auto-migrate from repos.json

# UI Foundation
src/ui/main.tsx           # React root: StrictMode + QueryClientProvider + App
src/ui/lib/query-client.ts   # QueryClient singleton: staleTime 30s, retry 1
src/ui/stores/app.ts      # Zustand: theme, sidebar, activeProjectId, persona
src/ui/styles/globals.css  # Tailwind base + design tokens

# Go Daemon
daemon/go.mod             # Go module definition
daemon/Makefile           # build, test, clean targets
daemon/cmd/unfaded/main.go       # Daemon entry: flags, flock, IPC, capture
daemon/cmd/unfade-send/main.go   # Fire-and-forget event sender
daemon/internal/capture/event.go # CaptureEvent struct (mirrors TypeScript)
```

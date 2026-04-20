# Unfade CLI: Research & Design Foundations

> **What this document is:** The RRVV (Rigorous Research, Reason, Validate) foundation that informs all phase-level implementation plans. Every design decision in the phase docs traces back to patterns extracted here.
>
> **Reference implementations analyzed:**
> - **Claude Code** — Anthropic's CLI (1,900+ files, 512K+ LOC TypeScript). Patterns: Ink-based terminal UI, Tool abstraction, services architecture, hooks system, MCP integration, multi-agent orchestration, feature flags, daemon/background modes.
> - **unerr-cli** — Local-first code intelligence CLI (18.6K LOC TypeScript). Patterns: Commander entry point, 9-state detector, MCP proxy, CozoDB local graph, Ink components, dual-mode (interactive + headless), query router, Zod schema contracts, `.unerr/` workspace convention.
>
> **Product strategy source:** `docs/product/unfade.md` (canonical), `docs/product/unfade_support.md` (competitive analysis)
>
> **Last updated:** 2026-04-14

---

## Table of Contents

- [Part I: Rigorous Research — Pattern Extraction](#part-i-rigorous-research--pattern-extraction)
  - [1. Claude Code Patterns](#1-claude-code-patterns)
  - [2. Unerr-CLI Patterns](#2-unerr-cli-patterns)
  - [3. Cross-Cutting Patterns](#3-cross-cutting-patterns)
- [Part II: Reason — Design Decisions for Unfade](#part-ii-reason--design-decisions-for-unfade)
  - [4. What to Adopt](#4-what-to-adopt)
  - [5. What to Avoid](#5-what-to-avoid)
  - [6. What to Reimagine](#6-what-to-reimagine)
  - [7. The Unfade CLI Architecture](#7-the-unfade-cli-architecture)
- [Part III: Validate — Against Developer Workflows](#part-iii-validate--against-developer-workflows)
  - [8. Workflow Validation Matrix](#8-workflow-validation-matrix)
  - [9. DX Principles Checklist](#9-dx-principles-checklist)
  - [10. Extensibility Validation](#10-extensibility-validation)
- [11. Cross-Phase Reference: File Ownership Map](#11-cross-phase-reference-file-ownership-map)

---

# Part I: Rigorous Research — Pattern Extraction

## 1. Claude Code Patterns

Extracted from analysis of Claude Code's source (1,900+ files, Bun-based TypeScript, React/Ink terminal UI).

### 1.1 Entry Point & Command Structure

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Single TSX entry point** | `src/entrypoints/cli.tsx` — Commander with extra-typings | High — proven pattern for type-safe CLI routing |
| **Subcommand routing** | Commander program with `.command()` chaining. Subcommands: `mcp`, `init`, daemon workers, background sessions (`--bg`, `ps`, `logs`, `attach`, `kill`) | Medium — Unfade needs fewer subcommands initially |
| **Feature-gated commands** | GrowthBook feature flags control availability of daemon, coordinator, voice, x402 payment commands | Low for v1 — useful for phased rollout later |
| **Dual-mode entry** | Interactive (full Ink UI) vs. headless (JSON output, `--print` flag) | High — Unfade needs interactive + daemon modes |

### 1.2 Tool System Architecture

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Unified Tool interface** | `src/Tool.ts` — single abstract class. Each tool (Bash, FileRead, FileEdit, Glob, Grep, etc.) extends it. Tools define `name`, `description`, `parameters` (JSON Schema), `execute()` | Very High — Unfade's MCP tools should follow this |
| **Tool directory convention** | `src/tools/{ToolName}/` — each tool in its own directory with index, implementation, and tests | High — clean separation |
| **Deferred tool loading** | Tools loaded on-demand, not at startup. Schema fetched via `ToolSearch` | Medium — useful for MCP tool discovery |
| **Permission model** | Tools classified by risk level. User approves/denies. Permission modes (auto, ask, deny) | Low for v1 — Unfade tools are read-only initially |

### 1.3 Services Architecture

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Service modules** | `src/services/` — isolated services: `autoDream/`, `compact/`, `extractMemories/`, `mcp/`, `oauth/`, `plugins/`, `analytics/`, `lsp/`, `tips/` | Very High — clean service isolation |
| **Memory consolidation** | `autoDream/` — 24-hour cycle, forked subagent, prompt caching. Memory in `.claude/` as Markdown | Very High — direct analog to Unfade's Daily Distill |
| **MCP server** | `src/services/mcp/` — full MCP SDK integration. Resources, Tools, Prompts. Stdio + HTTP transports | Very High — Unfade's MCP server follows this |
| **Plugin system** | `src/services/plugins/` — type definitions in `src/types/plugin.ts` | Medium — Unfade's connector SDK in Phase 4 |
| **Hooks system** | `src/hooks/` — event-driven hooks for tool permissions, notifications, suggestions, background tasks | High — Unfade Hooks API is similar in spirit |

### 1.4 Terminal UI (Ink)

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **React/Ink rendering** | Full React reconciler for terminal. Components: text input, message list, status line, tool progress, markdown rendering | Medium — Unfade needs lighter UI initially |
| **Custom Ink fork** | `src/ink/` — Claude Code maintains its own Ink implementation with optimizations (render batching, ANSI handling, focus management, hit testing) | Low — use stock Ink for Unfade v1 |
| **Vim keybindings** | `src/vim/` — full vim motion support (motions, operators, text objects) | Low — not relevant for Unfade |

### 1.5 Background & Daemon Patterns

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Daemon mode** | `--daemon-worker` flag, supervisor process, lightweight worker init | Very High — Unfade capture daemon follows this |
| **Background sessions** | `--bg` spawns background tasks. `ps`, `logs`, `attach`, `kill` for lifecycle management | High — Unfade daemon management needs these |
| **Sleep tool** | `SleepTool` — agent can wait between tasks | Low — not relevant |
| **Cron scheduling** | `src/utils/cronScheduler.ts` — local cron with jitter, locks, missed task recovery | High — Unfade's distillation schedule |
| **PID management** | Proper lockfile (`proper-lockfile`) for single-instance enforcement | High — daemon needs single-instance guarantee |

### 1.6 Configuration & State

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Layered config** | `~/.claude/` (global) + `.claude/` (project) + env vars + feature flags | High — Unfade needs similar layering |
| **Settings sync** | `src/services/settingsSync/` — cloud settings synchronization | Low — Unfade is local-first |
| **Migration system** | `src/migrations/` — versioned migrations for settings evolution | High — settings will evolve |

---

## 2. Unerr-CLI Patterns

Extracted from unerr-cli (18.6K LOC TypeScript, pnpm monorepo, Commander + Ink).

### 2.1 Entry Point & State Machine

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Commander entry** | `src/entrypoints/cli.ts` — single entry, ESM, tsdown-bundled | Very High — adopt directly |
| **9-state detector** | `src/state-detector.ts` — checks credentials, git repo, PID lock, graph freshness → determines startup flow | Very High — Unfade needs state-aware startup |
| **Smart Serve Model** | `unerr` with no args intelligently detects context and executes appropriate action | High — consider for `unfade` bare command |
| **Three-Act startup** | Instant Competence (0-2s) → Revelation (2-5s) → Invitation (5s+) | High — proven UX staging |

### 2.2 MCP Proxy Architecture

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Stdio MCP server** | `src/proxy/proxy.ts` — boot: PID lock → credentials → DB init → MCP stdio server → file watchers | Very High — Unfade MCP server follows this boot sequence |
| **Query router** | `src/intelligence/query-router.ts` — 15 tools split: 11 local (<5ms), 4 cloud | Very High — Unfade will have local + LLM tools |
| **stdout sacred** | MCP JSON-RPC only on stdout. All logging to stderr | Critical — must adopt for MCP compatibility |
| **Response envelope** | Every response has `_meta` (structured errors, degradation status) + `_context` | High — professional error handling |

### 2.3 Local Intelligence

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **CozoDB graph** | Embedded Datalog graph via NAPI bindings. Sub-5ms queries | Medium — Unfade may use simpler storage initially |
| **File watchers** | `chokidar` for filesystem monitoring with auto-save noise filtering | Very High — Unfade capture daemon uses watchers |
| **Tree-sitter AST** | WASM-based code parsing for rule evaluation | Low — Unfade captures reasoning, not code structure |
| **Health grading** | Computed scores from graph data, displayed as badges | Medium — reasoning profile scoring analog |

### 2.4 Configuration & Storage

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Workspace convention** | `.unerr/` with subdirs: `config.json`, `state/`, `ledger/`, `drift/`, `graph/`, `cache/`, `logs/` | Very High — `.unfade/` follows this pattern |
| **Zod schemas** | Every API endpoint validated with Zod. Single source of truth | Very High — adopt for type safety |
| **Dynamic imports** | Heavy modules (cozo-node, tree-sitter) lazy-loaded | High — Vercel AI SDK provider adapters should lazy-load |
| **Dual config levels** | `~/.unerr/settings.json` (user) + `.unerr/settings.json` (project) | High — same pattern for Unfade |

### 2.5 Developer Experience

| Pattern | Implementation | Relevance to Unfade |
|---|---|---|
| **Ink components** | ProgressBar, GradeBadge, HealthCard, StatusLine — all output to stderr | Medium — Unfade needs status components |
| **Graceful degradation** | Cloud down → local still works. Graph stale → warn but respond | Very High — LLM unavailable → raw summaries |
| **Deep links** | CLI output includes URLs to web dashboard | High — link to Thinking Graph |
| **Zero-install friction** | `npx @unerr/unerr` — no native binaries to manage | Very High — Unfade must be `npx unfade` |

### 2.6 Design Principles (from unerr CLAUDE.md)

1. Zero extra commands — dev runs `unerr` or IDE auto-starts
2. MCP stdout sacred — all logging to stderr
3. Never return unstructured errors — every response has `_meta`
4. Tool is enhancement, not dependency — graceful fallback
5. Clean commit history — non-invasive integration
6. First useful output in 5 seconds
7. Local tools <5ms
8. Every display includes deep link

---

## 3. Cross-Cutting Patterns

Patterns observed in **both** Claude Code and unerr-cli that represent proven conventions:

| Pattern | Claude Code | unerr-cli | Unfade Adoption |
|---|---|---|---|
| **TypeScript + ESM** | Bun-based, ESM | Node 20+, ESM, tsup | Adopt: TypeScript + ESM + tsdown (actively maintained successor to tsup) |
| **Ink for terminal UI** | Full custom fork | Stock Ink 6.x | Adopt: Stock Ink initially |
| **Commander for CLI routing** | @commander-js/extra-typings | commander ^12 | Adopt: commander with extra-typings |
| **Zod for validation** | zod ^3.24 | zod ^3.24 | Adopt: Zod for all schemas |
| **MCP SDK** | @modelcontextprotocol/sdk ^1.12 | @modelcontextprotocol/sdk ^1.0 | Adopt: latest MCP SDK |
| **Biome for linting** | biome ^1.9 | biome ^1.9 | Adopt: Biome (no ESLint) |
| **chokidar for watchers** | chokidar ^4.0 | chokidar ^4.0 | N/A — Go daemon uses fsnotify instead; no Node.js file watching needed |
| **React 19 + Ink** | react ^19, custom reconciler | react ^19, ink ^6 | Adopt: react ^19 + ink ^6 |
| **Layered config** | ~/.claude/ + .claude/ | ~/.unerr/ + .unerr/ | Adopt: ~/.unfade/ + .unfade/ |
| **Service isolation** | src/services/ with subdirs | src/intelligence/, src/tracking/, etc. | Adopt: domain-organized services |
| **PID lock for daemon** | proper-lockfile | custom PID in .unerr/state/ | Adopt: PID lock in .unfade/state/ |

---

# Part II: Reason — Design Decisions for Unfade

## 4. What to Adopt

These patterns are directly aligned with Unfade's philosophy and should be adopted with minimal modification.

### 4.1 From Claude Code

| Pattern | Why Adopt | How It Maps to Unfade |
|---|---|---|
| **Unified Tool interface** | Clean abstraction for MCP tool exposure. Single interface serves both CLI commands and MCP tools | Each Unfade capability (query, amplify, similar, distill) is a Tool |
| **Service module isolation** | Services like `autoDream/` (memory consolidation), `mcp/`, `compact/` map directly to Unfade subsystems | `src/services/capture/`, `src/services/distill/`, `src/services/mcp/`, `src/services/personalization/` |
| **Daemon/background architecture** | Unfade's capture daemon is architecturally identical to Claude Code's daemon mode | Background process with PID lock, watchdog, graceful shutdown |
| **Cron scheduling** | Distillation runs on a schedule (default: end of day). Cron with jitter prevents thundering herd in team deployments | `src/services/scheduler.ts` — configurable distill schedule |
| **Migration system** | Config and storage schemas will evolve. Migrations prevent breaking upgrades | `src/migrations/` — versioned, sequential |

### 4.2 From unerr-cli

| Pattern | Why Adopt | How It Maps to Unfade |
|---|---|---|
| **State-aware startup** | `unfade` with no args should detect context (daemon running? initialized? first run?) and do the right thing | `src/state-detector.ts` — checks init status, daemon PID, config presence |
| **Workspace convention** | `.unfade/` as the single local data directory. Plain text, inspectable, greppable — core to Unfade's trust model | Exactly as specified in product strategy §15 |
| **Stdout sacred for MCP** | Any MCP mode must keep stdout clean for JSON-RPC. All diagnostics to stderr | Hard constraint, enforced by convention |
| **Response envelope** | Every tool response includes `_meta` with error/degradation status and `_context` with reasoning profile hints | Consistent error handling across CLI and MCP |
| **Three-Act startup** | Instant value → deeper capability → invitation to explore. Proven to reduce abandonment | `unfade init` → immediate git history backfill → first distill within 5 minutes |
| **Graceful degradation** | LLM unavailable → fall back to structured signal extraction without synthesis. Network down → local data still queryable | Three modes: FULL (LLM + local), LOCAL (local signals only), OFFLINE (cached data only) |
| **Zod schema contracts** | Type-safe validation for every API surface. Catches contract drift early | `src/schemas/` — MCP tool inputs/outputs, config, event formats |

## 5. What to Avoid

These patterns, while appropriate for their source projects, conflict with Unfade's core philosophy.

### 5.1 From Claude Code

| Pattern | Why Avoid | Unfade Alternative |
|---|---|---|
| **Custom Ink fork** | Massive maintenance burden (50+ files). Claude Code needs it for vim bindings and custom rendering. Unfade doesn't. | Stock Ink 6.x with thin wrapper components |
| **Feature flag sprawl** | 50+ GrowthBook flags create complexity. Unfade is open-source — features are either shipped or not | Simple boolean config flags for opt-in features (e.g., `capture.terminal`, `capture.browser`) |
| **Multi-agent swarm** | Coordinator, team creation, mailbox system — architecturally brilliant but irrelevant for a personal reasoning tool | Not applicable. Unfade is single-agent, single-user |
| **Cloud platform services** | OAuth, Teleport, remote sessions, x402 payments — enterprise platform concerns | Local-first. No cloud services in v1. Hosted Thinking Graph is a future concern |
| **Voice mode** | WebSocket STT, CoreAudio bindings — complex, platform-specific | Optional voice memo via system microphone API (Phase 3+) |
| **Heavyweight Ink UI** | Message lists, tool progress, markdown rendering — interactive conversation UI | Unfade CLI is mostly non-interactive. Status displays, not conversations |

### 5.2 From unerr-cli

| Pattern | Why Avoid | Unfade Alternative |
|---|---|---|
| **CozoDB dependency** | Native NAPI binding. Cross-platform compilation pain. Unfade doesn't need a Datalog graph engine for v1 | SQLite via `better-sqlite3` for structured data + JSONL for event streams + JSON for profiles. Upgrade path to embedded vector store later |
| **Cloud proxy architecture** | unerr proxies between local CozoDB and cloud ArangoDB. Unfade has no cloud data store | No proxy. Local daemon serves MCP directly from `.unfade/` data |
| **Overlay merge architecture** | Immutable base + drift overlay merged at read time — complex, designed for cloud sync | Direct local reads. No overlay. Data is authoritative on disk |
| **Heavy graph intelligence** | Community detection, blast radius, entity relationships — structural code analysis | Unfade analyzes reasoning signals, not code structure. Different intelligence domain |

## 6. What to Reimagine

These patterns need to be rethought for Unfade's unique requirements.

### 6.1 Daemon Architecture: Invisible Capture vs. Interactive CLI

Neither Claude Code nor unerr-cli has a passive background daemon that runs independently of user interaction. Claude Code's daemon is an always-on coding agent. unerr's proxy starts when an MCP client connects.

**Unfade's daemon is fundamentally different:** It runs in the background *even when the developer isn't interacting with Unfade*. It watches git, reads AI session logs, monitors terminal output — all passively. The developer should forget it exists until the Daily Distill arrives.

**Design decision:** The daemon is a separate, lightweight process spawned by `unfade init` or `unfade daemon start`. It has its own PID lock, its own log file, and a resource budget (<50MB RAM, <1% CPU idle). The CLI communicates with the daemon via a local Unix socket (macOS/Linux) or named pipe (Windows) for status checks and manual triggers.

```
┌───────────────────────────────────────────────────────────────┐
│                     Unfade Process Model                      │
│                                                               │
│  ┌─────────────────┐         ┌────────────────────────────┐  │
│  │  unfade CLI      │  socket │  unfade daemon (background) │  │
│  │  (user commands) │◄───────►│                             │  │
│  │                  │         │  ┌─────────┐ ┌───────────┐ │  │
│  │  unfade status   │         │  │ Git      │ │ AI Session│ │  │
│  │  unfade query    │         │  │ Watcher  │ │ Reader    │ │  │
│  │  unfade distill  │         │  ├─────────┤ ├───────────┤ │  │
│  │  unfade profile  │         │  │ Terminal │ │ Scheduler │ │  │
│  │  unfade card     │         │  │ Watcher  │ │ (distill) │ │  │
│  └─────────────────┘         │  └─────────┘ └───────────┘ │  │
│                               │                             │  │
│  ┌─────────────────┐         │  ┌───────────────────────┐ │  │
│  │  MCP Server      │  stdio  │  │ .unfade/ data store    │ │  │
│  │  (agent-facing)  │◄───────►│  │  events/ distills/     │ │  │
│  │                  │         │  │  graph/ profile/        │ │  │
│  └─────────────────┘         │  └───────────────────────┘ │  │
│                               └────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### 6.2 MCP Server: Dual-Transport, Read-Heavy

Both Claude Code and unerr-cli implement MCP servers, but both are primarily tool-execution oriented. Unfade's MCP server is read-heavy — agents mostly query context, not execute actions.

**Design decision:** Unfade's MCP server exposes:
- **5 Resources** (read-only context agents query automatically)
- **5 Tools** (executable queries and triggers)
- **3 Prompts** (reusable reasoning frameworks)

The server reads directly from `.unfade/` files. No database. No cache layer for v1. File reads are fast enough for local-only operation.

### 6.3 Distillation: Scheduled Background Job, Not Interactive

Claude Code's `autoDream` runs as a forked subagent within the main process. unerr has no analog.

**Design decision:** Distillation runs as a scheduled task within the daemon process:
1. Daemon's scheduler triggers distillation at configured time (default: 6 PM local)
2. Distillation reads today's events from `.unfade/events/YYYY-MM-DD.jsonl`
3. Processes through signal extraction → context linking → LLM synthesis → personalization update
4. Writes outputs: `distills/YYYY-MM-DD.md`, `graph/decisions.jsonl`, `profile/reasoning_model.json`
5. Sends notification: "Your Unfade is ready"

Fallback: If no LLM is configured, produce a structured signal summary without AI synthesis.

### 6.4 Configuration: Trust-First, Minimal

Both reference CLIs have complex config systems. Unfade's philosophy demands minimal configuration that "just works."

**Design decision:** Three config sources, in priority order:
1. **Environment variables** — `UNFADE_LLM_PROVIDER`, `UNFADE_LLM_MODEL`, `UNFADE_DISTILL_TIME`
2. **User config** — `~/.unfade/config.json` — global preferences (LLM provider, notification settings)
3. **Project config** — `.unfade/config.json` — per-project overrides (capture sources, ignore patterns)

Default config on `unfade init`: zero required configuration. Git capture works out of the box. LLM defaults to Ollama if available, otherwise prompts for provider.

---

## 7. The Unfade CLI Architecture

### 7.1 Architectural Principles

Derived from the intersection of both reference CLIs and Unfade's product philosophy:

| # | Principle | Source | Rationale |
|---|---|---|---|
| 1 | **Zero friction by default** | Unfade philosophy + unerr's "zero extra commands" | `unfade init` → daemon starts → capture begins. No config required for core functionality |
| 2 | **Passive first, interactive second** | Unfade philosophy (unique) | The daemon captures reasoning passively. CLI commands are for querying and reviewing, not for primary data input |
| 3 | **Stdout sacred in MCP mode** | Both CLIs | MCP JSON-RPC only on stdout. All diagnostics to stderr. Non-negotiable |
| 4 | **Local-first, plain-text, inspectable** | Unfade philosophy | `.unfade/` is Markdown + JSONL + JSON. No proprietary formats. Human-readable. Greppable |
| 5 | **Graceful degradation** | Both CLIs | No LLM → structured summaries. No network → local data. Daemon down → CLI reads files directly |
| 6 | **Tool-as-contract** | Claude Code's Tool interface | Every capability is a Tool with typed input/output schema. Serves both CLI and MCP |
| 7 | **First value in under 5 minutes** | unerr's "first useful output in 5 seconds" (adapted) | `unfade init` backfills 30 days of git history. First distill generates within minutes, not hours |
| 8 | **Composable, not monolithic** | Both CLIs' service isolation | Services are independent modules. Capture, distillation, personalization, MCP are separable concerns |

### 7.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           UNFADE CLI                                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  src/entrypoints/cli.ts                                      │   │
│  │  Commander entry point → state detection → command routing   │   │
│  └───────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│  ┌───────────┐  ┌────────────▼───────────┐  ┌──────────────────┐   │
│  │ Commands   │  │ State Detector          │  │ Config Manager   │   │
│  │            │  │                         │  │                  │   │
│  │ init       │  │ - Is initialized?       │  │ ~/.unfade/       │   │
│  │ status     │  │ - Is daemon running?    │  │ .unfade/         │   │
│  │ distill    │  │ - Is LLM configured?    │  │ env vars         │   │
│  │ query      │  │ - Is git repo?          │  │                  │   │
│  │ ask        │  │ - Has events today?     │  │ Zod-validated    │   │
│  │ profile    │  │                         │  │                  │   │
│  │ card       │  └─────────────────────────┘  └──────────────────┘   │
│  │ similar    │                                                      │
│  │ serve      │                                                      │
│  │ daemon     │                                                      │
│  │ export     │                                                      │
│  └───────────┘                                                      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Services                                                     │   │
│  │                                                               │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  ┌────────┐  │   │
│  │  │ Capture   │  │ Distill  │  │ Personalize   │  │ MCP    │  │   │
│  │  │           │  │          │  │               │  │ Server │  │   │
│  │  │ git       │  │ extract  │  │ profile model │  │        │  │   │
│  │  │ ai-session│  │ link     │  │ pattern learn │  │ stdio  │  │   │
│  │  │ terminal  │  │ synthesize│ │ amplify       │  │ http   │  │   │
│  │  │ browser   │  │ amplify  │  │ blind spots   │  │        │  │   │
│  │  └──────────┘  └──────────┘  └───────────────┘  └────────┘  │   │
│  │                                                               │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐              │   │
│  │  │ Daemon   │  │ Scheduler│  │ Notification  │              │   │
│  │  │          │  │          │  │               │              │   │
│  │  │ process  │  │ cron     │  │ system notify │              │   │
│  │  │ PID lock │  │ distill  │  │ terminal bell │              │   │
│  │  │ socket   │  │ backfill │  │               │              │   │
│  │  └──────────┘  └──────────┘  └───────────────┘              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Tools (Unified Interface — CLI + MCP)                        │   │
│  │                                                               │   │
│  │  unfade_query    unfade_amplify    unfade_similar              │   │
│  │  unfade_context  unfade_distill    unfade_ask                  │   │
│  │  unfade_profile  unfade_decisions                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Storage (.unfade/)                                           │   │
│  │                                                               │   │
│  │  events/YYYY-MM-DD.jsonl    distills/YYYY-MM-DD.md           │   │
│  │  graph/decisions.jsonl      graph/domains.json               │   │
│  │  profile/reasoning_model.json  profile/preferences.json      │   │
│  │  amplification/connections.jsonl                              │   │
│  │  config.json    state/daemon.pid    state/daemon.sock         │   │
│  │  cache/    logs/                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

# Part III: Validate — Against Developer Workflows

## 8. Workflow Validation Matrix

Each row validates a real developer workflow (from product strategy §10) against the CLI design.

| Workflow | What Happens | CLI Involvement | Validated? |
|---|---|---|---|
| **Morning start** | Developer opens terminal. Daemon is already running. No action needed. | None — daemon is background | Yes: zero-friction passive capture |
| **During coding** | AI tool (Cursor/Claude Code) queries Unfade MCP server for context. Automatic, invisible. | None — MCP server handles it | Yes: MCP server reads `.unfade/` directly |
| **Quick voice memo** | Developer hits hotkey, speaks annotation. Daemon captures. | `unfade capture "note text"` or hotkey integration | Yes: optional enrichment path |
| **End of day** | Notification: "Your Unfade is ready." Developer reviews distill. | `unfade distill` (manual) or auto-triggered. View via `unfade distill --today` | Yes: habit trigger + review command |
| **Query past reasoning** | "What did I decide about caching?" | `unfade query "caching strategy"` | Yes: semantic search command |
| **Share achievement** | Generate and share an Unfade Card | `unfade card` → generates OG image + shareable URL | Yes: card generation command |
| **Check reasoning profile** | View personalization model | `unfade profile` | Yes: profile display command |
| **First-time setup** | Install and start capturing | `npx unfade init` → creates `.unfade/`, starts daemon, backfills git history | Yes: <5 minute time-to-value |
| **Daemon management** | Check daemon status, restart | `unfade daemon status/start/stop/restart/logs` | Yes: full daemon lifecycle |
| **Export data** | Portable archive of all reasoning data | `unfade export` → `.unfade/` as tarball | Yes: data portability |

## 9. DX Principles Checklist

Validated against the "it just works" standard:

| Principle | How Unfade Achieves It | Status |
|---|---|---|
| **Minimal setup** | `npx unfade init` — one command. Zero config for git capture. | Validated |
| **Intuitive commands** | Verb-first naming: `query`, `profile`, `distill`, `card`, `export`. No jargon. | Validated |
| **Clear feedback** | Ink-based status display for `unfade status`. Progress indicators for distillation. Notification for daily distill. | Validated |
| **Discoverable** | `unfade --help` lists all commands with descriptions. Each command has `--help`. | Validated |
| **Non-destructive** | All data operations are append-only. `unfade export` doesn't delete. No destructive commands. | Validated |
| **Offline-capable** | All core functionality works without network. LLM synthesis degrades gracefully to structured summaries. | Validated |
| **Composable** | Output formats: `--json` for piping, `--format=markdown` for reading. MCP for programmatic access. | Validated |
| **Transparent** | `unfade status` shows exactly what's being captured, what's pending distillation, personalization level. | Validated |

## 10. Extensibility Validation

| Extension Point | How It Works | When It Ships |
|---|---|---|
| **MCP server** | Any MCP-compatible agent auto-discovers Unfade. Stdio + Streamable HTTP transports. | Phase 2 (Sprint 4-5) |
| **Capture connectors** | Modular `src/services/capture/sources/` — each source (git, ai-session, terminal, browser) is an independent module with a standard interface | Phase 1 (git + ai-session), Phase 2 (terminal), Phase 3 (browser) |
| **LLM providers** | `src/services/distill/providers/` — Ollama (default), OpenAI, Anthropic, any OpenAI-compatible API | Phase 1 — provider interface with Ollama default |
| **Unfade Hooks API** | Local HTTP server (`localhost:7654`) for custom integrations | Phase 2 |
| **Plugin/Connector SDK** | Documented interfaces for community-built capture sources and output sinks | Phase 4 |
| **Amplification Lenses** | Community-created reasoning frameworks applied to user's data | Phase 4 |

---

## 11. Cross-Phase Reference: File Ownership Map

Every file in `.unfade/` has exactly ONE writer. This table is the concurrency Bible — if two components ever write to the same file, there is a bug.

| File | Writer | Readers | Write Semantics |
|---|---|---|---|
| `config.json` | TypeScript (init, web UI settings) | Go daemon (ConfigWatcher) | Atomic: tmp + rename |
| `events/YYYY-MM-DD.jsonl` | Go daemon (EventWriter) | TypeScript (distill, query) | O_APPEND, <4KB per write |
| `distills/YYYY-MM-DD.md` | TypeScript (distill pipeline) | TypeScript (server, query, cards) | Atomic: tmp + rename |
| `distills/.distill.lock` | TypeScript (distill pipeline) | TypeScript (distill pipeline) | PID-based file lock |
| `graph/decisions.jsonl` | TypeScript (distill pipeline) | TypeScript (server, amplifier) | O_APPEND |
| `graph/decisions_index.json` | TypeScript (amplifier) | TypeScript (amplifier, query) | Atomic: tmp + rename |
| `graph/domains.json` | TypeScript (distill pipeline) | TypeScript (server, query) | Atomic: tmp + rename |
| `profile/reasoning_model.json` | TypeScript (distill pipeline, personalization engine) | TypeScript (server, query, cards), Go daemon (none) | Atomic: tmp + rename |
| `amplification/connections.jsonl` | TypeScript (amplifier) | TypeScript (server, query) | O_APPEND |
| `amplification/feedback.jsonl` | TypeScript (HTTP /feedback) | TypeScript (amplifier) | O_APPEND |
| `cards/YYYY-MM-DD.png` | TypeScript (card generator) | TypeScript (server, web UI) | Overwrite (idempotent) |
| `state/daemon.pid` | Go daemon | TypeScript (status check), Go daemon (startup) | flock() on file |
| `state/daemon.sock` | Go daemon (listener) | Shell hook (via unfade-send) | Unix socket |
| `state/health.json` | Go daemon | TypeScript (status, TUI) | Atomic: tmp + rename |
| `state/server.json` | TypeScript (server startup) | TypeScript (CLI commands) | Atomic: tmp + rename |
| `state/init_progress.json` | TypeScript (init command) | TypeScript (init command) | Atomic: tmp + rename |
| `~/.unfade/state/repos.json` | TypeScript (init, deinit) | Go daemon (startup, ConfigWatcher) | Atomic: tmp + rename |
| `~/.unfade/state/daemon.pid` | Go daemon | TypeScript, Go daemon | flock() on file |
| `~/.unfade/state/daemon.sock` | Go daemon | unfade-send | Unix socket |

---

> **This document is the shared foundation. See phase-specific implementation plans:**
> - [Phase 0: Foundation](./PHASE_0_FOUNDATION.md)
> - [Phase 1: Capture & Intelligence](./PHASE_1_CAPTURE_AND_INTELLIGENCE.md)
> - [Phase 2: Context & Integration](./PHASE_2_CONTEXT_AND_INTEGRATION.md)
> - [Phase 3: Identity & Personalization](./PHASE_3_IDENTITY_AND_PERSONALIZATION.md)
> - [Phase 4: Platform & Launch](./PHASE_4_PLATFORM_AND_LAUNCH.md) (includes ecosystem / continuous-intelligence scope formerly split across later phase docs)
> - [Phase 6: Post-Launch & Enterprise Prep](./PHASE_6_POST_LAUNCH.md)
> - [Phase 7: Breakthrough Intelligence](./PHASE_7_BREAKTHROUGH_INTELLIGENCE.md)

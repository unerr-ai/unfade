# Unfade — Vertical Slicing Architecture Plan

> **Each slice ships a single, end-to-end testable value proposition.**
> No slice depends on future slices to be useful. Every slice produces a working feature a developer can interact with in under 5 minutes.
>
> **Product strategy:** [`docs/product/unfade.md`](../product/unfade.md) (canonical), [`docs/product/unfade_support.md`](../product/unfade_support.md) (competitive analysis)
>
> **Implementation plans:** [`docs/architecture/cli/`](./cli/) (phase-level task breakdowns)
>
> **Last updated:** 2026-04-16

---

## Table of Contents

- [System Overview](#system-overview)
- [Storage & Data Substrate](#storage--data-substrate)
- [Framework Decisions](#framework-decisions)
  - [Hybrid Architecture: Go Daemon + TypeScript CLI](#hybrid-architecture-go-daemon--typescript-cli)
  - [RRVV Analysis: Why Go Daemon](#rrvv-analysis-why-go-daemon-not-everything-nodejs)
  - [Why Go Over Rust for the Daemon](#why-go-over-rust-for-the-daemon)
- [Cross-Cutting Concerns](#cross-cutting-concerns)
  - [8. Three-Surface UI Architecture & Collapsed Command Surface](#8-three-surface-ui-architecture--collapsed-command-surface)
- [Vertical Slice Index](#vertical-slice-index)
- [Slice 1: Instant Fingerprint — The 5-Minute Wow](#slice-1-instant-fingerprint--the-5-minute-wow)
- [Slice 2: Daily Distill — The Habit Loop](#slice-2-daily-distill--the-habit-loop)
- [Slice 3: Dual-Protocol Server — The Memory Layer](#slice-3-dual-protocol-server--the-memory-layer)
- [Slice 4: Cards & Terminal — The Viral Artifacts](#slice-4-cards--terminal--the-viral-artifacts)
- [Slice 5: Personalization & Amplification — The Moat](#slice-5-personalization--amplification--the-moat)
- [MCP & Agent Synergy Analysis](#mcp--agent-synergy-analysis)
- [Documentation Evolution Strategy](#documentation-evolution-strategy)

---

## System Overview

```
Developer's Machine (Everything Local)
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   Developer Workflow                   Unfade System                        │
│   ┌───────────┐                       ┌─────────────────────────────────┐  │
│   │ Git       │──filesystem events───►│ unfaded (Go binary, ~12MB)      │  │
│   │ .git/     │                       │   ├─ Git watcher (fsnotify)     │  │
│   └───────────┘                       │   ├─ AI session watcher (tail)  │  │
│   ┌───────────┐                       │   ├─ Terminal receiver (socket) │  │
│   │ AI Tools  │──log file tailing────►│   └─ Event writer (JSONL)      │  │
│   │ Cursor    │                       └──────────┬──────────────────────┘  │
│   │ Claude    │                                  │ writes                   │
│   └───────────┘                                  ▼                         │
│   ┌───────────┐                       ┌─────────────────────────────────┐  │
│   │ Terminal  │──preexec/precmd──────►│ .unfade/ Data Substrate         │  │
│   │ zsh/bash  │   (Unix socket /      │   ├─ events/     (JSONL)       │  │
│   └───────────┘    named pipe Win)    │   ├─ distills/   (Markdown)    │  │
│                                       │   ├─ graph/      (JSONL+JSON)  │  │
│                                       │   ├─ profile/    (JSON)        │  │
│                                       │   ├─ amplification/ (JSONL)    │  │
│                                       │   ├─ cards/      (PNG)         │  │
│                                       │   └─ state/      (PID, health) │  │
│                                       └──────────┬──────────────────────┘  │
│                                                  │ reads                    │
│                                                  ▼                         │
│                                       ┌─────────────────────────────────┐  │
│   MCP Consumers                       │ Unfade Server (TypeScript)      │  │
│   ┌───────────┐                       │   ┌───────────────────────────┐ │  │
│   │ Cursor    │◄──MCP stdio──────────►│   │ MCP Server               │ │  │
│   │ Claude    │                       │   │ (stdio / Streamable HTTP) │ │  │
│   │ OpenClaw  │                       │   │ 5 Resources, 5 Tools,    │ │  │
│   │ Windsurf  │                       │   │ 3 Prompts                │ │  │
│   └───────────┘                       │   └───────────────────────────┘ │  │
│                                       │   ┌───────────────────────────┐ │  │
│   HTTP Consumers                      │   │ HTTP API                 │ │  │
│   ┌───────────┐                       │   │ (localhost:7654)         │ │  │
│   │ CLI       │◄──HTTP───────────────►│   │ /context, /query,       │ │  │
│   │ Web UI    │                       │   │ /profile, /amplify,     │ │  │
│   │ Scripts   │                       │   │ /decisions, /similar    │ │  │
│   └───────────┘                       │   └───────────────────────────┘ │  │
│                                       └─────────────────────────────────┘  │
│                                                                             │
│   Distillation Engine (TypeScript, runs on-demand)                         │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  LLM Provider (user-configurable)                                   │  │
│   │    ├─ Ollama (default — fully local, no network)                   │  │
│   │    ├─ OpenAI (opt-in cloud)                                         │  │
│   │    └─ Anthropic (opt-in cloud)                                      │  │
│   │                                                                     │  │
│   │  Pipeline: events/ → signal extraction → context linking            │  │
│   │            → LLM synthesis → distills/ + graph/ + profile/          │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### The Three-Layer Architecture (Strategic)

Each layer serves a different strategic function. All layers share the `.unfade/` data substrate.

```
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 3: THINKING GRAPH + CARDS              (Identity — Spread)    │
│  Unfade Cards (OG images), Thinking Graph (static site),             │
│  Decision Density Heatmap, domain evolution, hiring signal.          │
│  WHY people talk about Unfade.                                       │
├──────────────────────────────────────────────────────────────────────┤
│  LAYER 2: DAILY DISTILL                       (Ritual — Habit)       │
│  Auto-generated reasoning summary, 2-min review,                     │
│  decisions, trade-offs, dead ends, breakthroughs,                    │
│  personalization observations.                                       │
│  WHY people return every day.                                        │
├──────────────────────────────────────────────────────────────────────┤
│  LAYER 1: REASONING SUBSTRATE                 (Foundation — Moat)    │
│  Passive capture, .unfade/ data substrate, Hooks API,                │
│  MCP server, cross-tool context injection,                           │
│  personalization engine, amplification engine.                       │
│  WHY every AI tool gets smarter. WHY people can't leave.             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Storage & Data Substrate

All data is local, plain-text, human-readable, and inspectable. No proprietary database. No cloud dependency.

```
.unfade/
├── config.json                          # User preferences, LLM provider, capture sources
├── events/
│   └── YYYY-MM-DD.jsonl                 # Raw capture events (append-only)
├── distills/
│   └── YYYY-MM-DD.md                    # Daily Distill (Markdown)
├── graph/
│   ├── decisions.jsonl                  # Structured decision data (feeds Thinking Graph)
│   └── domains.json                     # Domain expertise map (updated per distillation)
├── profile/
│   └── reasoning_model.json             # Evolving personalization model
├── amplification/
│   └── connections.jsonl                # Cross-temporal/cross-domain reasoning connections
├── cards/
│   └── YYYY-MM-DD.png                   # Generated Unfade Cards (OG images)
└── state/
    ├── daemon.pid                       # unfaded process ID
    ├── daemon.sock                      # Unix socket for terminal capture (macOS/Linux)
    └── health.json                      # Daemon health status (for `unfade status`)
```

| Directory | Format | Purpose | Growth Rate |
|---|---|---|---|
| `events/` | JSONL | Raw capture signals — one file per day, append-only | ~50KB–500KB/day |
| `distills/` | Markdown | Daily reasoning summaries — human-readable, greppable | ~5KB/day |
| `graph/` | JSONL + JSON | Structured decision data + domain expertise map | ~2KB/day |
| `profile/` | JSON | Personalization model — updated incrementally per distill | Single file, ~10KB |
| `amplification/` | JSONL | Detected cross-temporal connections | ~1KB/day |
| `cards/` | PNG | Generated card images (1200x630, OG-compatible) | ~300KB/card |
| `state/` | PID + socket + JSON | Daemon lifecycle + health — ephemeral, excluded from exports | N/A |

**Git integration:** `.unfade/` lives inside the project root (alongside `.git/`) for inspectability. To prevent polluting `git status` in shared repositories:

- `unfade init` adds `.unfade/` to **`.git/info/exclude`** (local-only, never committed). This avoids modifying the shared `.gitignore` in someone else's repo.
- If `.gitignore` already contains `.unfade/`, respect it and skip the exclude step.
- `unfade init --global` stores data in `$HOME/.unfade/projects/<repo-hash>/` instead of inside the repo — useful for developers who don't want any project-local files. The daemon resolves the correct data directory by checking for local `.unfade/` first, then the global path.

### Configuration Schema

```
// .unfade/config.json — created by `unfade init`, editable via web UI /settings
// Written by: TypeScript CLI + web UI.  Read by: Go daemon (ConfigWatcher via fsnotify).
// Cross-boundary contract — schema changes require updates in both Go and TypeScript.
{
  "version": 1,
  "llm": {
    "provider": "ollama",              // "ollama" | "openai" | "anthropic"
    "model": "llama3.2",              // Model name (provider-specific default)
    "apiKey": null                     // Cloud providers only. Never committed to git.
  },
  "capture": {
    "git": true,                       // Enable git event capture
    "ai_sessions": true,              // Enable AI session log tailing
    "terminal": true,                 // Enable terminal preexec/precmd capture
    "ai_session_paths": [             // Auto-detected by `unfade init`, user-overridable
      "~/.cursor/logs/",
      "~/.claude/"
    ],
    "ignorePatterns": [               // Glob patterns — matching commands/files are never captured
      "*.env",
      "*.secret"
    ]
  },
  "distillation": {
    "schedule": "18:00",              // 24h local time. "manual" disables auto-distillation.
    "timezone": "America/New_York"    // IANA timezone for schedule interpretation
  },
  "server": {
    "port": 7654,                     // Preferred port (fallback: 7655–7660 on conflict)
    "host": "127.0.0.1"              // Bind address — never 0.0.0.0 by default (local-only)
  },
  "fingerprint": {
    "scanMonths": 12,                 // Git history depth for fingerprint (overridable via --months N)
    "maxCommits": 5000                // Cap for large repos
  }
}
```

**Cross-boundary read contract:** The Go daemon watches `config.json` via fsnotify (see §2 concurrency rules — atomic write via tmp + rename). On change, the daemon re-reads the entire file and updates its in-memory config. Fields the daemon consumes: `capture.*` (which sources to watch, which paths to tail, ignore patterns) and `server.port` (to pass to the spawned TypeScript server). All other fields (`llm.*`, `distillation.*`, `fingerprint.*`) are consumed by the TypeScript CLI/server only — the daemon ignores them. Zod schema in TypeScript and Go struct must agree on the `capture` and `server` sub-schemas.

### Event Schema (Canonical)

```
// .unfade/events/YYYY-MM-DD.jsonl — each line is one event
{
  "timestamp": "ISO-8601",
  "source": "git" | "ai_session" | "terminal" | "manual",
  "type": "commit" | "diff" | "branch_switch" | "revert" | "stash"
       | "conversation" | "completion" | "suggestion_accepted" | "suggestion_modified"
       | "command" | "error" | "retry"
       | "annotation",
  "content": { ... },              // Source-specific payload
  "git_context": {                  // Present when derivable
    "repo": "string",
    "branch": "string",
    "sha": "string"
  }
}
```

### Decision Schema (Distillation Output)

```
// .unfade/graph/decisions.jsonl — each line is one decision
{
  "date": "YYYY-MM-DD",
  "decision": "Chose write-behind caching over write-through",
  "rationale": "Latency constraints outweigh consistency for this use case",
  "alternatives_evaluated": 3,
  "domain": "database",
  "dead_end": false,
  "ai_modified": true,                 // Was AI suggestion accepted as-is or modified?
  "sources": ["git:abc123", "ai:cursor-session-42"]
}
```

### Personalization Model Schema

```
// .unfade/profile/reasoning_model.json
{
  "version": 1,
  "updated_at": "ISO-8601",
  "decision_style": {
    "avg_alternatives_evaluated": 3.2,
    "convergence_speed": "deliberate",  // "quick" | "deliberate" | "exhaustive"
    "prototype_vs_analyze": 0.4         // 0 = pure prototyper, 1 = pure analyzer
  },
  "trade_off_weights": {
    "simplicity_vs_flexibility": 0.72,  // Higher = favors simplicity
    "performance_vs_readability": 0.45,
    "convention_vs_optimization": 0.60
  },
  "domain_depth": {
    "authentication": { "decision_count": 34, "depth": "deep" },
    "database": { "decision_count": 22, "depth": "deep" },
    "frontend": { "decision_count": 8, "depth": "shallow" }
  },
  "exploration_habits": {
    "avg_dead_ends_per_major_decision": 2.1,
    "dead_end_tolerance_minutes": 40,
    "ai_acceptance_rate": 0.36,          // 36% accepted as-is, 64% modified
    "ai_modification_rate": 0.64
  },
  "blind_spots": [],                     // Populated after Month 2+
  "failure_patterns": []                 // Populated after Month 2+
}
```

---

## Framework Decisions

### Hybrid Architecture: Go Daemon + TypeScript CLI

Unfade uses a **two-binary hybrid architecture**: a Go daemon (`unfaded`) for 24/7 capture, and a TypeScript CLI (`unfade`) for everything else.

```
Distribution:
  unfade     → npm install -g unfade    (TypeScript, ~5MB)
  unfaded    → platform-specific npm optional dependency (Go, ~12MB)
```

**Binary distribution strategy (esbuild pattern):** The Go daemon binary ships as platform-specific npm optional dependencies — the same pattern used by `esbuild`, `swc`, and `lightningcss`. The npm package declares optional deps like `@unfade/daemon-darwin-arm64`, `@unfade/daemon-linux-x64`, etc. npm automatically installs only the matching platform package. This avoids:

- **macOS Gatekeeper** — binaries from npm are already trusted (no "unverified developer" dialog)
- **Windows SmartScreen** — no unknown binary downloaded from a CDN
- **Corporate proxies** — npm registry is typically whitelisted; arbitrary CDN downloads are not
- **Apple code signing costs** — not needed for npm-distributed binaries in v1
- **Network dependency during init** — the binary is already present from `npm install`, no separate download step

`unfade init` detects the pre-installed binary at `node_modules/@unfade/daemon-{platform}-{arch}/unfaded` and copies it to `.unfade/bin/unfaded`. Fallback: if the optional dep wasn't installed (e.g., unsupported platform), offer a direct download with checksum verification.

| Concern | Binary | Language | Why |
|---|---|---|---|
| **Capture daemon** | `unfaded` | Go | Runs 24/7 — must be invisible (<15MB RAM, <1% CPU). Single binary, no runtime dependency. Cross-platform daemonization (launchd/systemd/Task Scheduler) |
| **CLI commands** | `unfade` | TypeScript | On-demand execution. Needs Ink (TUI), satori (cards), MCP SDK, Zod. Ecosystem advantage where it matters |
| **HTTP API + Web UI** | Unfade Server (auto-starts) | TypeScript | Hono + htmx. JSON API + server-rendered HTML pages. Auto-starts with daemon via `unfade init` |
| **MCP Server** | Unfade Server (auto-starts) | TypeScript | `@modelcontextprotocol/sdk` is the canonical implementation. stdio + Streamable HTTP |
| **Distillation** | `unfade distill` | TypeScript | Needs LLM SDKs (Ollama, OpenAI, Anthropic). Runs on-demand, not 24/7 |
| **Card rendering** | Web UI `/cards` + API | TypeScript | satori (JSX → SVG) + resvg-js (SVG → PNG). React stack |

### Technology Choices

**Go (daemon — `unfaded`):**

| Concern | Choice | Why |
|---|---|---|
| **Language** | Go 1.22+ | Single binary, trivial cross-compilation (`GOOS`/`GOARCH`), well-established daemon patterns, accessible to contributors |
| **File watching** | fsnotify | Cross-platform (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows). More efficient watch consolidation than Node.js chokidar |
| **Concurrency** | Goroutines | Perfect fit for "watch N things, write to one place". No async/await complexity |
| **IPC** | Unix socket (macOS/Linux), Named pipe (Windows) | Platform-native, zero-dependency. Receives terminal capture events |
| **Serialization** | encoding/json | Writes JSONL to `.unfade/events/`. No external dependencies |
| **Process management** | os/signal + context | Graceful shutdown, PID file management, health reporting |
| **Release** | goreleaser | Multi-platform binary builds + checksums in CI. One command |

**TypeScript (CLI + server — `unfade`):**

| Concern | Choice | Why |
|---|---|---|
| **Runtime** | Node.js (ESM) | Matches AI tool ecosystem (MCP SDK, Cursor plugins). CLI + server only — not the daemon |
| **Language** | TypeScript (strict) | Type safety, Zod integration, React/Ink compatibility for TUI |
| **CLI framework** | Commander + extra-typings | Lightweight, well-documented, type-safe command definitions |
| **Terminal UI** | Ink 6.x + React 19 | TUI dashboard (`unfade` no args): status, today's distill, quick actions. Same JSX model as card templates |
| **Validation** | Zod | Schema-first validation for events, decisions, profile model. Shared between CLI and server |
| **Bundler** | tsdown | Rolldown-powered ESM bundling (actively maintained successor to tsup) |
| **Linting** | Biome | Faster than ESLint+Prettier combined. Single tool for format + lint |
| **Testing** | Vitest | Jest-compatible API, native ESM, fast watch mode |
| **Git operations** | simple-git | Wraps system `git` binary — faster, lower memory than pure JS implementations |
| **HTTP server** | Hono | Lightweight, fast, middleware-friendly. Runs on `localhost:7654`. Serves both JSON API and HTML pages |
| **Web UI** | htmx (~14KB) | Server-rendered HTML with htmx for interactivity. No JS build step. Hono renders templates, htmx handles `hx-get`/`hx-post` for dynamic updates |
| **MCP** | @modelcontextprotocol/sdk | Official SDK. Resources, Tools, Prompts primitives. stdio + Streamable HTTP transports |
| **LLM** | Ollama (default), OpenAI, Anthropic | Ollama = fully local, zero cost. Cloud = opt-in for higher quality distillation |
| **Card rendering** | satori + resvg-js | JSX → SVG → PNG without a browser. Matches our React stack. Fast, small dependency |

### RRVV Analysis: Why Go Daemon (Not Everything Node.js)

The daemon runs **24/7**. It is the one component where "invisible" is a hard requirement — a developer who notices Unfade consuming resources will `kill -9` it and never restart it.

**Runtime resource comparison:**

| Runtime | Idle Memory | Binary Size | Startup Time |
|---------|------------|-------------|--------------|
| **Node.js** | 50–80 MB | ~40–60 MB (bundled + runtime) | ~500ms |
| **Go** | 8–15 MB | 10–15 MB | ~10ms |
| **Rust** | 3–8 MB | 3–5 MB | ~5ms |
| **Product spec** | **< 50 MB** | Single binary | Invisible |

Node.js technically meets the <50MB spec at idle — but add chokidar watchers, a Unix socket listener, and event buffering under real workload, and it reaches 80–120 MB. That breaks the spec.

#### RRVV: Everything Node.js (Rejected)

| Dimension | Assessment |
|---|---|
| **Rewards** | Single language (TypeScript), faster initial development, lower contributor barrier, MCP SDK native |
| **Risks** | Memory 5–10x higher for 24/7 process. Node.js not designed for long-lived daemons — uncaught exceptions, memory leaks, GC pauses are operational concerns. "Extract later" requires designing IPC protocol post-hoc with a running system to migrate. Requires Node.js runtime installed — not a single binary. On Windows: no native Unix sockets |
| **Viability** | Works technically. But "can do it" ≠ "should do it" for a 24/7 background process |
| **Velocity** | Fast in weeks 1–8. Slows when daemon reliability issues surface (memory leaks in long-running Node, chokidar inotify limits on Linux, Windows compatibility) |

#### RRVV: Go Daemon + TypeScript CLI (Selected)

| Dimension | Assessment |
|---|---|
| **Rewards** | Daemon meets product spec trivially (<15 MB). True single binary — no runtime dependency. Daemon reliability: no GC-pause or memory-leak patterns for long-lived processes. Clean separation: daemon writes `.unfade/events/`, CLI reads. Cross-platform distribution via goreleaser. CLI still gets Ink, satori, MCP SDK — ecosystem advantages where they matter (on-demand, not 24/7) |
| **Risks** | Two languages = two build systems, two test suites. Release pipeline more complex (two binaries per platform). Contributor pool narrower for daemon. IPC design between daemon and CLI (mitigated — filesystem IS the IPC, see below) |
| **Viability** | Proven pattern. Docker (Go daemon + CLI), Tailscale (Go daemon), Syncthing (Go daemon), watchman (C++ daemon + JS client) |
| **Velocity** | Slower in weeks 1–4 (two build systems). Faster from week 5+ because daemon bugs don't cascade into CLI bugs |

#### RRVV: Everything Rust/Go (Considered, Deferred)

| Dimension | Assessment |
|---|---|
| **Rewards** | Single language, smallest footprint, fastest startup, true single binary for everything |
| **Risks** | No Ink (TUI rendering) — would need tui-rs/bubbletea. No satori — card rendering needs different approach. MCP SDK in Rust/Go less mature than TypeScript canonical. Much slower iteration on UI features |
| **Viability** | Possible but fights the ecosystem. MCP world is TypeScript-first. Card rendering is JSX-first |
| **Velocity** | Slowest. Every UI feature takes 3–5x longer |

### Why Go Over Rust for the Daemon

| Factor | Go | Rust | Winner |
|--------|-----|------|--------|
| **Cross-compilation** | `GOOS=windows GOARCH=amd64 go build` — one command | `cross` or `cargo-zigbuild` — works but more setup | Go |
| **Daemon patterns** | Well-established (`os/signal`, `context`, graceful shutdown are stdlib) | Requires more boilerplate (`tokio`, `signal-hook`) | Go |
| **Concurrency model** | Goroutines — perfect for "watch N things, write to one place" | async/await with tokio — more powerful but more complex | Go |
| **Memory for this workload** | ~10–15 MB idle | ~3–8 MB idle | Rust (but Go meets spec easily) |
| **Contributor accessibility** | Moderate — Go is widely known | Lower — Rust has a steep learning curve | Go |
| **Build speed** | Fast (~2–5s) | Slow (~30–60s) | Go |
| **The workload itself** | I/O-bound file watching + socket listening — Go's sweet spot | Same — Rust's zero-cost abstractions don't help for I/O-bound work | Tie |

**The deciding factor:** Unfade's daemon is I/O-bound. It watches files, reads diffs, accepts socket messages, writes JSONL. This is Go's sweet spot. Rust's advantages (zero-cost abstractions, no GC, predictable latency) matter for CPU-bound or latency-critical systems — neither describes a file watcher.

**Rust extraction criteria (if ever needed):**
- Go daemon consistently exceeds 30MB in production
- OR: daemon needs to do CPU-bound work (e.g., local distillation without LLM)
- OR: a Rust contributor joins the project and champions the rewrite

---

## Cross-Cutting Concerns

These architectural patterns span multiple slices and are referenced throughout.

### 1. Local-First Privacy Architecture

**Principle:** All raw data stays on the developer's machine. Nothing leaves without explicit user action. This is a structural guarantee, not a configuration option.

**What is captured (exhaustive list):**
- Git: commit messages, diffs, branch names, SHAs, timestamps
- AI sessions: conversation logs from known tool paths (`~/.cursor/logs/`, `~/.claude/`)
- Terminal: command strings and exit codes only — **never command output**

**What is never captured:**
- Screen content, keystrokes, clipboard
- Command output (stdout/stderr) — only the command string and its exit code
- Files outside configured watch paths
- Network traffic

**Enforcement:**
- All capture source implementations receive a `CaptureConfig` that whitelists watched paths
- Terminal capture uses fire-and-forget via Unix socket — if the socket is unavailable, the event is silently dropped (no buffering, no retry)
- The `.unfade/` directory is plain text — a developer can `grep` or `cat` any file to verify exactly what was captured
- `unfade export` creates a portable archive — the developer owns their data completely
- Open source = the capture logic is auditable by anyone

**Per-command opt-out for terminal capture:**

```
# Append to any command to suppress terminal capture
ssh production-server  # unfade:ignore
```

### 2. Two-Process Architecture & Cross-Platform Daemonization

**Problem:** Unfade needs a long-running process to watch filesystem events and accept terminal capture events, PLUS an on-demand server for HTTP API and MCP. A single Node.js process doing both runs 24/7 at 80–120MB — violating the "invisible" requirement.

**Solution:** Two binaries, clean separation. The filesystem is the communication bus.

```
unfaded (Go binary, ~12MB, runs 24/7)
  ├─ FileWatcher
  │     ├─ GitWatcher        → watches .git/ via fsnotify
  │     ├─ AISessionWatcher  → tails ~/.cursor/logs/, ~/.claude/
  │     └─ ConfigWatcher     → watches .unfade/config.json for changes
  ├─ TerminalReceiver
  │     ├─ Unix socket listener (macOS/Linux)
  │     └─ Named pipe listener (Windows)
  ├─ EventWriter
  │     └─ Append-only JSONL → .unfade/events/YYYY-MM-DD.jsonl
  ├─ PlatformManager
  │     ├─ launchd integration (macOS)
  │     ├─ systemd integration (Linux)
  │     └─ Task Scheduler integration (Windows)
  └─ HealthReporter
        └─ Writes .unfade/state/health.json, responds to status queries

Unfade Server (TypeScript, managed by daemon as child process)
  ├─ HTTP API (Hono on localhost:7654, dynamic port fallback)
  ├─ MCP Server (stdio or Streamable HTTP on localhost:7654/mcp)
  └─ Distillation Scheduler (cron-like — triggers daily at configured time)

  Lifecycle: The Go daemon spawns `unfade server` as a child process
  and monitors its PID. If the server crashes (OOM, uncaught exception),
  the daemon restarts it automatically with exponential backoff (1s, 2s, 4s,
  max 30s). This eliminates the gap where launchd/systemd manages the daemon
  but nobody manages the server.
```

**Communication: The `.unfade/` Directory IS the IPC**

The daemon writes. The CLI reads. No RPC, no shared memory, no message queues.

```
unfaded (Go)                    .unfade/                    unfade (TypeScript)

writes →  events/2026-04-14.jsonl  ← reads (distill, query)
writes →  state/daemon.pid        ← reads (status check)
listens → state/daemon.sock       ← sends (terminal events via shell hook)
writes →  state/health.json       ← reads (unfade status)

                                  Events are the interface.
                                  The filesystem is the bus.
```

The only direct communication is:
1. **Terminal shell hook → daemon socket** (shell sends command events)
2. **CLI → daemon health** (`unfade status` reads `state/health.json`)

Both are simple. No complex IPC protocol needed.

**Filesystem concurrency rules (non-negotiable):**

The "filesystem is the bus" design requires explicit concurrency guarantees. Without these, race conditions are inevitable across two independent processes:

| File | Writer | Reader | Concurrency Rule |
|---|---|---|---|
| `events/YYYY-MM-DD.jsonl` | Go daemon (append) | TypeScript (distill, query) | `O_APPEND` is atomic for writes <4KB on POSIX. Large events (big diffs) must be written as single `write()` calls, not streamed. **Reader must tolerate a partial last line** (incomplete JSON) — skip it, it will be complete on next read. |
| `state/health.json` | Go daemon (overwrite) | TypeScript (status check) | **Atomic write required:** write to `health.json.tmp`, then `rename()`. A reader that opens mid-write gets partial JSON otherwise. |
| `state/daemon.pid` | Go daemon (create/delete) | TypeScript (status check), Go daemon (startup) | **`flock()` on the PID file itself.** Standard daemon pattern. Prevents TOCTOU race between "check if PID alive" and "remove stale PID." On Windows: `LockFileEx()`. |
| `config.json` | TypeScript (web UI settings) | Go daemon (ConfigWatcher) | **Atomic write** (write `.tmp` + rename). Daemon uses fsnotify on the file — rename triggers a clean re-read. |
| `distills/`, `graph/`, `profile/` | TypeScript (distill pipeline) | TypeScript (server, query) | Single-writer (distill pipeline). No lock needed — reads tolerate slightly stale data. |

**NFS warning:** If `$HOME` is on NFS (common in enterprise/university environments), `flock()` does not work. The daemon should detect NFS mounts on Linux (`statfs()` → `NFS_SUPER_MAGIC`) and warn during `unfade init`. This is a known limitation, not a blocker.

**Daemon lifecycle:**

```
unfade daemon start            # Start unfaded as background process via platform manager
unfade daemon start --foreground  # Start unfaded in foreground (development/debugging)
unfade status                  # Check daemon health: PID alive? watchers active? event count?
unfade daemon stop             # Graceful shutdown: SIGTERM → flush pending events → exit
```

**PID management:**
- On startup: check `.unfade/state/daemon.pid`. If PID exists and process is alive → exit with "already running" message. If PID exists but process is dead → remove stale PID file → start.
- On shutdown: remove PID file, close socket/pipe, flush any pending events to `events/` JSONL.

#### Cross-Platform Daemon Mechanics

A daemon behaves fundamentally differently on each OS. The Go daemon handles this via its `PlatformManager`:

**macOS — launchd (preferred):**

```
Auto-start plist (installed by `unfade init`):
  Path:  ~/Library/LaunchAgents/dev.unfade.daemon.plist
  Label: dev.unfade.daemon
  ProgramArguments: [/usr/local/bin/unfaded]
  KeepAlive: true
  RunAtLoad: true
  StandardOutPath: ~/.unfade/logs/daemon.log
  StandardErrorPath: ~/.unfade/logs/daemon.err
```

Why launchd matters: macOS aggressively kills background processes not registered with launchd. A `nohup` process gets killed on sleep/wake cycles, memory pressure, or OS updates. launchd-registered native binaries survive all of these — much easier with a Go binary than pointing launchd at a Node.js runtime + script.

**Linux — systemd user service (preferred):**

```
Unit file (installed by `unfade init`):
  Path: ~/.config/systemd/user/unfade-daemon.service
  [Unit]
  Description=Unfade Capture Daemon
  [Service]
  ExecStart=/usr/local/bin/unfaded
  Restart=on-failure
  [Install]
  WantedBy=default.target
```

The inotify trap: Linux has a default limit of 8192 inotify watches per user. VS Code alone uses ~5000. Go's `fsnotify` is more efficient about watch consolidation than Node.js `chokidar` (watches directories, not individual files), but large monorepos may still require `fs.inotify.max_user_watches` tuning. `unfade status` reports inotify usage to help diagnose.

**Windows — Task Scheduler + Named Pipes:**

```
Auto-start task (installed by `unfade init`):
  Task name: UnfadeDaemon
  Trigger: At logon
  Action: Start unfaded.exe
  IPC: Named pipe (\\.\pipe\unfade-daemon) — NOT Unix sockets

Terminal capture hook uses PowerShell:
  $json | Out-File \\.\pipe\unfade-daemon  # instead of nc -U
```

Windows is where Node.js hurts the most: no Unix sockets (terminal capture hook requires completely different code path), no `nohup`/`setsid` (backgrounding requires `node-windows` or hand-rolled Windows Service). Go handles named pipes natively via `net.Pipe()` and abstracts the platform difference.

**Cross-platform summary:**

| Concern | macOS | Linux | Windows |
|---------|-------|-------|---------|
| **File watching API** | FSEvents | inotify | ReadDirectoryChangesW |
| **IPC mechanism** | Unix socket | Unix socket | Named pipe |
| **Auto-start** | launchd plist | systemd user unit | Task Scheduler |
| **Process management** | launchd KeepAlive | systemd Restart | Task Scheduler recovery |
| **Go handles natively** | Yes | Yes | Yes |

All three platforms are handled by the Go daemon's `PlatformManager`. `unfade init` detects the OS and installs the appropriate auto-start configuration. Reinstallable from web UI `/settings`.

#### Multi-Repo Daemon Architecture

A developer may run `unfade init` in multiple repositories. The daemon is a single process that watches all initialized repos — NOT one daemon per repo.

**Repo registry:** Each `unfade init` registers the repo in `~/.unfade/state/repos.json`:

```
// ~/.unfade/state/repos.json — global registry of all unfade-initialized repos
{
  "repos": [
    {
      "path": "/Users/dev/projects/backend",
      "initializedAt": "2026-04-14T09:00:00Z",
      "active": true
    },
    {
      "path": "/Users/dev/projects/frontend",
      "initializedAt": "2026-04-15T10:30:00Z",
      "active": true
    }
  ]
}
```

**On startup,** the daemon reads `repos.json` and starts a `GitWatcher` + `AISessionWatcher` for each active repo. Adding a new repo (via `unfade init` in another directory) writes to `repos.json` — the daemon watches this file via fsnotify and hot-adds the new repo's watchers without restart.

**Data isolation:** Each repo has its own `.unfade/` directory. Events from repo A are written to `/path/to/A/.unfade/events/`, not to a global location. Distills, profile, and cards are per-repo. The `unfade://context/recent` MCP resource serves context from the repo where the agent is running (detected via working directory).

**Global state (`~/.unfade/`):**
- `~/.unfade/state/repos.json` — repo registry
- `~/.unfade/state/daemon.pid` — single daemon PID
- `~/.unfade/state/daemon.sock` — single socket for terminal events (the daemon routes events to the correct repo based on the `cwd` field in the terminal event JSON)
- `~/.unfade/logs/` — daemon logs

**Removing a repo:** `unfade deinit` (or deleting `.unfade/`) sets `active: false` in `repos.json`. The daemon stops watchers for that repo. No data is deleted — the developer can re-init to resume.

### 3. Capture Source Interface

**Principle:** Every capture source (git, AI sessions, terminal) implements the same interface inside the Go daemon. New sources are added without modifying existing code.

```
// Go interface in unfaded
type CaptureSource interface {
    Name() string                        // "git", "ai_session", "terminal"
    Initialize(config CaptureConfig) error
    Start(ctx context.Context) error     // Begin watching/listening
    Stop() error                         // Graceful shutdown
    Events() <-chan CaptureEvent         // Channel of structured events
}

type CaptureEvent struct {
    Version    int                       // Schema version (currently 1). Readers MUST ignore unknown fields and unknown event types — forward-compatibility rule.
    Timestamp  string                    // ISO-8601
    Source     string                    // Matches CaptureSource.Name()
    Type       string                    // Source-specific event type
    Content    map[string]interface{}    // Source-specific payload
    GitContext *GitContext               // Present when derivable
}
```

The TypeScript CLI reads the **output** of capture sources (JSONL files in `.unfade/events/`), not the sources themselves. The Zod schema for CaptureEvent in TypeScript mirrors the Go struct — both validate against the same [RFC_001_EVENT_SCHEMA](./RFC_001_EVENT_SCHEMA.md).

**Source priority and signal quality:**

| Source | Signal Type | Privacy Sensitivity | Capture Method (in Go daemon) |
|---|---|---|---|
| **Git** (primary) | Decisions, explorations, dead ends, reverts | Low — developer chose to commit | fsnotify on `.git/` + `os/exec` shelling out to system `git` for parsing |
| **AI sessions** (primary) | Reasoning conversations, suggestion acceptance/modification | Medium — conversation content | File tailing on known log paths |
| **Terminal** (secondary) | Commands, errors, retry patterns, debugging sessions | Medium — command strings only | preexec/precmd shell hooks via Unix socket (macOS/Linux) or named pipe (Windows) |

**Event schema versioning rules:**
- Every `CaptureEvent` includes a `version` field (integer, starting at 1).
- **Forward-compatibility:** Readers (TypeScript distill pipeline, query engine) MUST silently ignore unknown fields and unknown event types. A v1 reader encountering a v2 event with extra fields processes the fields it knows and skips the rest.
- **Backward-compatibility:** New versions never remove or rename existing fields — only add new ones. If a field's semantics change, a new field is introduced instead.
- **Migration:** No runtime migration. Old events stay as-written in JSONL. The TypeScript reader uses a Zod discriminated union keyed on `version` — each version gets its own schema, and the reader coerces older versions forward by applying defaults for missing fields.
- **Version bumps:** Documented in `RFC_001_EVENT_SCHEMA.md` with the exact diff and rationale.

### 4. Distillation Pipeline Design

**The distillation pipeline converts raw events into structured reasoning artifacts.** It runs once daily (configurable) or on-demand via `unfade distill`.

```
.unfade/events/YYYY-MM-DD.jsonl
        │
        ▼
┌──────────────────────────┐
│ Stage 1: Signal Extraction│     No LLM needed
│                          │
│ Parse JSONL events       │     - Commits → decision candidates
│ Classify by type         │     - Branch switches → context shifts
│ Detect patterns          │     - Reverts → dead ends
│ Group by time window     │     - Retries → debugging sessions
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ Stage 2: Context Linking │     No LLM needed
│                          │
│ Attach git context       │     - Which files, which branch, which project
│ Cross-reference sources  │     - AI conversation about same file as commit
│ Build temporal chains    │     - Sequential commits on same module
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ Stage 3: LLM Synthesis   │     LLM required (Ollama / cloud)
│                          │
│ Structured prompt chain  │     Input: extracted signals + context links
│ Generate Daily Distill   │     Output: decisions, trade-offs, dead ends,
│ Extract domain tags      │             breakthroughs, thinking patterns
│ Update personalization   │
│ Detect amplification     │     Update: profile/reasoning_model.json
│   connections            │     Update: graph/decisions.jsonl
└──────────┬───────────────┘     Update: amplification/connections.jsonl
           │
           ▼
  .unfade/distills/YYYY-MM-DD.md
```

**Key design constraint:** Stages 1 and 2 run without an LLM. This means `unfade init` can produce a Reasoning Fingerprint from git history alone — the 5-Minute Wow does not require Ollama to be installed. The LLM is only needed for the synthesis stage (natural language distillation).

**Distillation scheduler resilience:**

The distillation scheduler (inside the TypeScript server) triggers daily at a configured time (default: 6 PM local). Two edge cases need explicit handling:

**Catch-up on restart:** If the server was down when distillation was scheduled (laptop was closed, daemon crashed), the scheduler checks on startup: "Is there a `events/YYYY-MM-DD.jsonl` for any date that has no corresponding `distills/YYYY-MM-DD.md`?" If yes, it queues catch-up distillations for missed dates, processing them oldest-first. Catch-up runs are throttled (max 1 per minute) to avoid overwhelming a local LLM.

**Concurrent trigger mutex:** Multiple triggers can fire simultaneously — the scheduler fires at 6 PM, and the developer runs `unfade distill` manually at the same time, or the TUI `[d]` action fires while a scheduled distill is in progress. A file-based mutex (`distills/.distill.lock`) prevents concurrent distillation of the same date. The lock file contains the PID of the distilling process. If the lock exists but the PID is dead, the lock is stale — remove it and proceed. If the lock is held by a live process, the second trigger returns "Distillation already in progress for this date" instead of queuing a duplicate.

**Partial distillation recovery:** If the pipeline crashes mid-distillation (e.g., OOM during LLM synthesis), the partial output is written to `distills/YYYY-MM-DD.partial.md`. On the next run for that date, the pipeline detects the partial file, discards it, and starts fresh. The `.partial.md` suffix ensures it is never served as a complete distill.

### 5. MCP Protocol Design

**Unfade exposes itself as a first-class MCP server.** The MCP surface is the ecosystem multiplier — one implementation serves every MCP-compatible AI tool automatically.

**MCP Resources (read-only context — agents query these):**

| Resource URI | What It Provides |
|---|---|
| `unfade://context/recent` | Last 2 hours of reasoning signals — decisions, files, errors, approaches |
| `unfade://context/for/{file}` | All reasoning context related to a specific file path |
| `unfade://profile` | Developer's reasoning profile — decision style, domain strengths, trade-off preferences |
| `unfade://decisions/recent` | Recent decisions with alternatives considered and rationale |
| `unfade://domains` | Domain expertise map with depth indicators |

**MCP Tools (executable — agents invoke these):**

| Tool Name | What It Does |
|---|---|
| `unfade_query` | Semantic search across full reasoning history |
| `unfade_amplify` | Returns proactive insights — related past decisions, recurring patterns, blind spots |
| `unfade_similar` | Finds analogous past reasoning for a given decision or problem context |
| `unfade_ask` | Conversational query against accumulated reasoning (Slice 5+) |
| `unfade_distill` | Triggers manual distillation of current session signals |

**MCP Prompts (templates — reusable reasoning frameworks):**

| Prompt URI | What It Does |
|---|---|
| `unfade://prompts/with-context` | "Answer using my reasoning context: {query}" — prepends relevant history |
| `unfade://prompts/evaluate` | "Evaluate this decision using my past patterns" — analyzes against historical reasoning |
| `unfade://prompts/lens/{name}` | Apply a community Amplification Lens (e.g., `lens/security`) |

**Transports — two different process models:**

stdio and Streamable HTTP are NOT two modes of the same server. They have fundamentally different lifecycles:

| | **stdio** | **Streamable HTTP** |
|---|---|---|
| **Binary** | `unfade mcp-stdio` | Part of `unfade server` |
| **Who spawns it** | The AI agent (Cursor, Claude Code) spawns it as a child process | The Go daemon spawns `unfade server` which binds `/mcp` |
| **Lifecycle** | Born with the agent session, dies when agent disconnects | Long-running, survives agent sessions |
| **Multiplexing** | 1:1 — one process per agent connection | N:1 — many agents connect to one server |
| **When to use** | Local agents that manage their own MCP processes (most common) | Remote dev environments, multiple concurrent agents, or agents that don't support stdio |

```
Agent-spawned (stdio):                  Daemon-managed (Streamable HTTP):

┌─────────┐  spawns   ┌──────────────┐  ┌──────────┐  spawns   ┌──────────────┐
│ Cursor   │─────────►│ unfade        │  │ unfaded   │─────────►│ unfade server│
│ Claude   │  stdin/  │ mcp-stdio     │  │ (Go)      │  child   │ (TypeScript) │
│ OpenClaw │  stdout  │ (TypeScript)  │  └──────────┘  process  │ :7654/mcp    │
└─────────┘◄─────────│ reads .unfade/│                          │ reads .unfade/│
            response  └──────────────┘                          └──────────────┘
                      Dies with agent                           Survives agents
```

Both read from the same `.unfade/` data substrate. Both expose the same 5 Resources, 5 Tools, 3 Prompts. The difference is purely lifecycle and transport.

**`unfade mcp-stdio`** is a thin wrapper: it instantiates the MCP SDK with stdio transport, wires up the same resource/tool/prompt handlers as the HTTP server, and exits when stdin closes. It shares code with the server but is a separate entry point.

**Authentication:** Local-only by default — bound to `127.0.0.1`. MCP stdio is inherently local (spawned as child process). Optional token auth for Streamable HTTP in advanced configurations.

**MCP Degradation Contract — what agents get when things are broken:**

| Failure State | Resource Behavior | Tool Behavior |
|---|---|---|
| **Daemon not running** (no `.unfade/state/daemon.pid` or PID not alive) | All resources return empty content with `"status": "daemon_offline"` metadata. Never error — agents must not crash because Unfade is unavailable. | Tools return `{ "error": "daemon_offline", "message": "Unfade daemon is not running. Run `unfade start` to begin capturing." }` |
| **`.unfade/` directory missing** (tool never initialized) | Resources return `"status": "not_initialized"` with setup instructions in content: "Run `npx unfade init` to set up Unfade." | Tools return `{ "error": "not_initialized", "message": "Run `npx unfade init` to set up." }` |
| **Server running but no distills yet** (fresh install, no day has passed) | `unfade://context/recent` returns fingerprint data only. `unfade://decisions/recent` returns empty list. `unfade://profile` returns seed fingerprint from `unfade init`. | `unfade_query` returns `{ "results": [], "note": "No distilled reasoning yet. Unfade is capturing — your first Daily Distill will be available tomorrow." }` |
| **Stale context** (daemon running but server restarted, cache cold) | Resources serve from filesystem directly (`.unfade/distills/`, `.unfade/profile/`). May be minutes stale — include `"last_updated": "<timestamp>"` in metadata so agents can judge freshness. | Tools operate normally — all queries hit filesystem, not in-memory cache. |
| **LLM unavailable** (Ollama down, no API key) | `unfade://profile` still works (no LLM needed). `unfade://context/*` still works (Stage 1+2 signals). | `unfade_distill` returns `{ "status": "partial", "message": "Distilled without LLM synthesis (Ollama not available). Structured signals extracted, natural language summary skipped." }` |

**Design rule:** MCP resources NEVER throw errors or return error status codes. They always return valid content — even if that content is "no data available yet." Agents that include Unfade resources in their context window must never have their workflow disrupted by Unfade being unavailable.

### 6. LLM Provider Abstraction

**Principle:** The developer chooses their LLM provider. Unfade never forces a cloud dependency.

```
// Uses Vercel AI SDK (ai) with provider adapters
import { generateObject } from 'ai';
import { ollama } from 'ai-sdk-ollama';       // Local default
import { openai } from '@ai-sdk/openai';       // Cloud opt-in
import { anthropic } from '@ai-sdk/anthropic'; // Cloud opt-in

// Structured output via generateObject() + Zod schemas
// No custom LLMProvider interface needed — Vercel AI SDK handles provider abstraction
```

| Provider | When Used | Network | Cost |
|---|---|---|---|
| **Ollama** via `ai-sdk-ollama` (default) | Local model, fully offline | None | $0 |
| **OpenAI** via `@ai-sdk/openai` (opt-in) | Higher quality distillation | Cloud API call | Usage-based |
| **Anthropic** via `@ai-sdk/anthropic` (opt-in) | Higher quality distillation | Cloud API call | Usage-based |

**Graceful degradation:** If no LLM is available (Ollama not running, no API key configured), `unfade distill` produces a reduced distill from Stage 1+2 output only — structured signals without natural language synthesis. The developer gets value from the raw extraction even without an LLM.

**Ollama readiness check (3-step, before Stage 3):**

1. **Running?** — `GET http://localhost:11434/api/version`. If connection refused → "Ollama is not running. Install: https://ollama.com or run `ollama serve`. Falling back to Stage 1+2 only."
2. **Model available?** — `GET http://localhost:11434/api/tags`, check if configured model (default: `llama3.2`) is in the list. If missing → "Model `llama3.2` is not downloaded. Run `ollama pull llama3.2` (4.7GB). Falling back to Stage 1+2 only." **Never auto-download a model** — downloading gigabytes without explicit consent violates the "passive observer" principle.
3. **Model responsive?** — `POST http://localhost:11434/api/generate` with a trivial prompt, 5-second timeout. If timeout → "Ollama is running but the model is not responding (may still be loading). Retry in a few seconds or run `unfade distill` again."

All three checks produce actionable messages with exact commands. Failure at any step falls back to Stage 1+2 output — never blocks or errors out.

### 7. Error Handling Philosophy

**Principle:** Unfade is a passive observer. It must never interfere with the developer's workflow.

- **Capture failures are silent.** If fsnotify can't watch a path, if an AI session log is malformed, if the socket/pipe is unavailable — log the error, skip the event, continue. No user-facing errors for capture failures.
- **Distillation failures are recoverable.** If the LLM call fails, the raw events are preserved in `events/`. The developer can retry with `unfade distill --date YYYY-MM-DD`.
- **Server failures are visible and self-healing.** If the HTTP API or MCP server can't start due to a port conflict, it uses dynamic port fallback: try `7654`, then `7655`, `7656`, up to `7660`. The active port is written to `.unfade/state/server.json`. All CLI commands and `unfade open` read the port from `server.json` — never hardcoded. If all ports are taken, report clearly with the conflicting process name (`lsof -i :7654`). The daemon auto-restarts the server on crash (see §2 lifecycle).

**`server.json` coordination schema:**

```
// .unfade/state/server.json — written atomically by `unfade server` on startup
{
  "port": 7654,                          // Actual bound port (after fallback)
  "pid": 12345,                          // Server process PID
  "startedAt": "2026-04-14T09:00:00Z",  // ISO-8601 startup timestamp
  "version": "0.1.0",                   // CLI version that started the server
  "transport": {
    "http": "http://127.0.0.1:7654",    // Base URL for HTTP API
    "mcp": "http://127.0.0.1:7654/mcp"  // Streamable HTTP MCP endpoint
  }
}
```

**Consumers of `server.json`:** `unfade open` reads `port` to construct the URL. `unfade query` reads `transport.http` to hit the API. `unfade status` reads `pid` + `startedAt` to report server health. MCP agent configs can point to `transport.mcp`. Written via atomic write (tmp + rename) — readers never see partial JSON.
- **Resource budget is enforced.** The Go daemon monitors its own memory usage via `runtime.ReadMemStats()`. If it exceeds the configured ceiling (default: 30MB), it drops the oldest in-memory events and logs a warning. The JSONL files on disk are the durable store. Go's predictable memory behavior makes this ceiling reliable — unlike Node.js, there is no V8 heap growth or GC unpredictability.

### 8. Three-Surface UI Architecture & Collapsed Command Surface

**Problem:** The original architecture has 13 CLI commands. A developer needs to memorize 7-8 for regular use. Most successful dev tools have 3-4 core commands covering 90% of usage. More commands = more friction = lower adoption.

**Solution:** Three UI surfaces, each serving a distinct context. No feature duplication — each surface has a clear job.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   SURFACE 1: TUI (unfade, no args)              Context: In terminal    │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Quick glance. Don't leave the terminal.                        │   │
│   │                                                                 │   │
│   │  • Daemon status (running/stopped, event count today)          │   │
│   │  • Today's distill summary (top 3 decisions, one-liners)       │   │
│   │  • Personalization level indicator (Week 1, Month 1, etc.)     │   │
│   │  • Quick actions: [d]istill now  [c]ard  [o]pen web UI         │   │
│   │  • Keyboard-driven: j/k navigate, enter to expand, q to quit  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   SURFACE 2: Web UI (localhost:7654)           Context: Want to explore │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Rich visual experience. Cards, graphs, search, settings.      │   │
│   │                                                                 │   │
│   │  /               → Dashboard (status, today's distill, stats)  │   │
│   │  /distill        → Distill viewer + history + re-generate      │   │
│   │  /profile        → Reasoning profile visualization             │   │
│   │  /cards          → Card preview, generate, download             │   │
│   │  /search         → Query reasoning history, similar decisions   │   │
│   │  /settings       → Daemon control, shell hooks, LLM provider,  │   │
│   │                    capture sources, auto-start config           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   SURFACE 3: CLI commands                      Context: Scripting/pipe │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Power user shortcuts. Piping. Automation. CI.                  │   │
│   │                                                                 │   │
│   │  unfade query "..."    → stdout, pipeable                       │   │
│   │  unfade export         → .tar.gz archive                        │   │
│   │  unfade distill        → manual trigger from cron/script        │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   SURFACE 4: MCP / HTTP API                   Context: AI agents       │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Unchanged — protocol layer for agent ecosystem.                │   │
│   │  Agents query via MCP tools/resources or HTTP endpoints.        │   │
│   │  This is how most "query" and "similar" usage actually happens. │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**The rule: no surface duplicates another.** The TUI doesn't try to render cards (that's the web UI). The web UI doesn't replace `unfade query` for piping (that's the CLI). Each surface is the *best* way to do its job.

#### Collapsed Command Surface

**Before (13 commands):**

```
unfade init                    unfade daemon start
unfade setup-daemon            unfade daemon stop
unfade setup-shell             unfade status
unfade serve                   unfade distill
unfade card                    unfade query "..."
unfade profile                 unfade similar "..."
unfade export
```

**After (4 core + 3 power user):**

```
CORE (what 95% of users need):
  unfade init          # One-time: scaffold, fingerprint, setup daemon, setup shell hooks,
                       #           install auto-start, start daemon + server. Everything.
  unfade               # TUI dashboard — status, today's distill, quick actions
  unfade open          # Open web UI in browser (localhost:7654)
  unfade query "..."   # Search reasoning history (terminal, pipeable)

POWER USER (available, rarely needed):
  unfade export        # Archive .unfade/ data
  unfade distill       # Manual re-distill (usually triggered from TUI/web)
  unfade daemon stop   # Manual daemon control (usually managed from web UI settings)
```

**What was eliminated:**

| Old Command | Where It Went |
|---|---|
| `unfade setup-daemon` | Folded into `unfade init` |
| `unfade setup-shell` | Folded into `unfade init` (with interactive shell detection) |
| `unfade serve` | Auto-starts with daemon. `unfade init` starts both. |
| `unfade daemon start` | Auto-starts on login via platform manager. Manual start from web UI settings |
| `unfade status` | TUI dashboard (`unfade` no args) shows status inline |
| `unfade card` | Web UI `/cards` page. TUI quick action `[c]`. API endpoint unchanged |
| `unfade profile` | Web UI `/profile` page. TUI shows summary. API endpoint unchanged |
| `unfade similar "..."` | Web UI `/search` page. MCP tool `unfade_similar` for agents. CLI `unfade query` handles both |

#### `unfade init` — The One Setup Command

`unfade init` does everything a new user needs in a single command:

```
$ npx unfade init

⟐ Unfade — Your AI knows how you think.

[1/5] Scaffolding .unfade/ directory...                    ✓
[2/5] Scanning git history... 847 commits across 14 months
      ━━━ Your Reasoning Fingerprint ━━━
      Decision Style:      Deep Explorer (3.4 alt/decision)     ●●●○
      Top Domains:         Auth (34%), Database (22%), API (18%) ●●●●
      Trade-off Profile:   Favors simplicity (72%)               ●●○○
      Dead End Tolerance:  High (2.1 per major decision)         ●●●○
      AI Collaboration:    Modifier (edits 64% of AI suggestions) ●●●○
                                                      confidence ─┘

[3/5] Installing unfaded daemon (darwin-arm64, 12MB)...    ✓
      Auto-start: launchd (~/Library/LaunchAgents/)
[4/5] Detecting shell... zsh
      Installing capture hooks in ~/.zshrc                 ✓
[5/5] Starting daemon + server...                          ✓
      Daemon: unfaded (PID 42813, watching .git/)
      Server: localhost:7654

━━━ First Unfade Card Generated ━━━
  → .unfade/cards/first-unfade.png
  → Open card: unfade open

Ready. Your AI now knows how you think.
  unfade        — quick dashboard
  unfade open   — full web UI
  localhost:7654 — always available
```

Every setup step is one command. The developer never needs to learn `setup-daemon`, `setup-shell`, `serve`, or `daemon start`.

#### Web UI Technology Choice

The HTTP server (Hono on `localhost:7654`) already exists for the API. Adding a web UI is incremental — serve HTML alongside JSON.

| Option | Bundle Size | Build Step | Why (Not) |
|---|---|---|---|
| **htmx + server-rendered HTML** | ~14KB | None — Hono renders HTML | **Selected.** Zero JS build step. Hono renders templates. htmx handles interactivity (re-distill button, search, navigation). Matches local-first philosophy: server renders everything, browser is just a viewport |
| **Preact** | ~3KB | Vite/esbuild | Good but adds JS build complexity for a local tool |
| **React (full)** | ~40KB | Vite | Overkill for a local dashboard |
| **Svelte** | ~5KB | Vite/rollup | Fast but new framework = new contributor barrier |

**htmx is the right fit because:**
- Hono already returns HTTP responses. Adding `text/html` alongside `application/json` is trivial
- No JS build step — no Vite, no webpack, no `npm run build` for the UI
- htmx handles all interactivity with HTML attributes: `hx-get`, `hx-post`, `hx-trigger`
- "Heavy" rendering (cards, graphs) uses the same satori pipeline server-side
- ~14KB total JS. The web UI loads in <100ms on localhost
- Proven pattern for local tools: Syncthing, Ollama Web UI, pgAdmin

**Server-side rendering flow:**

```
Browser request                    Hono Server (localhost:7654)
GET /profile         ──────────►   Read .unfade/profile/reasoning_model.json
                                   Render HTML template with data
                     ◄──────────   Return complete HTML page

htmx interaction
hx-post="/distill"   ──────────►   Trigger distillation pipeline
                     ◄──────────   Return HTML fragment (new distill content)
                                   htmx swaps it into the page — no full reload
```

#### TUI Design (Ink)

The TUI is a **control panel**, not a feature mirror. It shows what you need at a glance and provides quick actions for common tasks.

```
┌────────────────────────────────────────────────────────┐
│ ⟐ UNFADE                                    14 Apr 26 │
├────────────────────────────────────────────────────────┤
│                                                        │
│ Daemon: ● running (PID 42813)    Events today: 23     │
│ Server: ● localhost:7654         Uptime: 6h 12m       │
│                                                        │
├────────────────────────────────────────────────────────┤
│ TODAY'S DISTILL                                        │
│                                                        │
│  ● Chose refresh-ahead over clock tolerance for JWT    │
│  ● Migrated session store from in-memory to Redis      │
│  ● Abandoned custom WebSocket auth (40 min dead end)   │
│                                                        │
│  Decisions: 3  Trade-offs: 2  Dead ends: 1             │
│  Reasoning depth: ████████░░ 3.2 alt/decision          │
│                                                        │
├────────────────────────────────────────────────────────┤
│ PERSONALIZATION                      Level: Week 2     │
│  Decision style: Deep Explorer                         │
│  Top domain: Authentication (34%)                      │
│  AI collab: Modifier (edits 64%)                       │
│                                                        │
├────────────────────────────────────────────────────────┤
│ [d] distill now  [c] card  [o] open web  [q] quit     │
└────────────────────────────────────────────────────────┘
```

**TUI ≠ Web UI.** The TUI intentionally does NOT include:
- Card rendering/preview (that's the web UI — needs pixel-level rendering)
- Full search interface (that's the web UI — needs text input, results list)
- Settings/configuration (that's the web UI — needs forms, toggles)
- Historical distill browsing (that's the web UI — needs pagination, date picker)

The TUI answers one question: **"What's happening right now?"** Quick actions let you trigger common operations without memorizing commands.

---

## Vertical Slice Index

| Slice | Name | User Value | UI Surfaces Added | Dependency | Implementation Plan |
|---|---|---|---|---|---|
| **1** | Instant Fingerprint | `unfade init` → full setup + Reasoning Fingerprint in <60s | TUI dashboard (`unfade`), `unfade open` | None | [Phase 0](./cli/PHASE_0_SCAFFOLDING.md), [Phase 1](./cli/PHASE_1_CAPTURE_AND_DISTILL.md) |
| **2** | Daily Distill | Work for a day → auto-generated reasoning summary with personalization seed | `unfade distill` (power user CLI) | Slice 1 | [Phase 1](./cli/PHASE_1_CAPTURE_AND_DISTILL.md) |
| **3** | Dual-Protocol Server | MCP + HTTP API + Web UI → every AI tool gets persistent reasoning context | Web UI (`/`, `/distill`, `/profile`, `/settings`), `unfade query` CLI | Slice 2 | [Phase 2](./cli/PHASE_2_HOOKS_API_AND_MCP.md) |
| **4** | Cards & Terminal | Shareable Unfade Cards + terminal debugging capture | Web UI (`/cards`), `unfade export` CLI | Slice 3 | [Phase 3](./cli/PHASE_3_CARDS_AND_TERMINAL.md) |
| **5** | Personalization & Amplification | Reasoning profile drives distill quality + cross-temporal insights | Web UI (`/search`), MCP tools | Slice 3 | [Phase 4](./cli/PHASE_4_PERSONALIZATION_AND_AMPLIFICATION.md), [Phase 5](./cli/PHASE_5_ECOSYSTEM_LAUNCH.md) |

```
Slice 1 ──► Slice 2 ──► Slice 3 ──┬──► Slice 4
                                   │
                                   └──► Slice 5
```

Each slice is self-contained. A developer using only Slice 1 gets value. Slices 4 and 5 are independent of each other — they can be developed in parallel after Slice 3.

---

## Slice 1: Instant Fingerprint — The 5-Minute Wow

> _"I ran `unfade init` and in 30 seconds it showed me how I think. I didn't know I evaluate 3.4 alternatives per decision. I didn't know 72% of my trade-offs favor simplicity. I shared the fingerprint card before I even understood what the tool does."_

### What Ships

- `unfade init` — the single setup command. Does everything:
  1. Scaffolds `.unfade/` directory
  2. Scans git history (default: last 12 months, configurable via `--months N`), generates Reasoning Fingerprint without an LLM
  3. Downloads + installs `unfaded` Go daemon binary for current platform
  4. Detects shell (zsh/bash/PowerShell), installs capture hooks
  5. Installs platform auto-start (launchd/systemd/Task Scheduler)
  6. Starts daemon + HTTP server (`localhost:7654`)
- Reasoning Fingerprint v0 — computed from git signals alone, **with confidence levels per metric:**
  - **Decision style:** alternatives evaluated per decision (estimated from branch count, revert frequency, commit density per feature). Confidence: ●●●○ for repos with 200+ commits, ●●○○ for 50-200, ●○○○ for <50.
  - **Top domains:** classified from file paths and commit message keywords. Confidence: ●●●● (file paths are reliable signal).
  - **Trade-off profile:** simplicity vs. flexibility indicator (estimated from diff size patterns, refactor frequency). Confidence: ●●○○ (indirect signal — correlation, not causation).
  - **Dead end tolerance:** measured from reverts, branch deletions, stash frequency. Confidence: ●●●○ (reverts are strong signal; stash frequency is workflow-dependent).
  - **AI collaboration rate:** estimated from `Co-authored-by` lines, known AI commit message patterns (e.g., "Generated by Cursor"), and diff signatures. Confidence: ●○○○ to ●●●○ depending on signal availability. Shows "Insufficient data" rather than guessing when signal is weak.
  - **Edge case handling:**
    - **Squash-merge workflows:** branch history is flattened. Fingerprint detects squash-merge patterns (single-commit branches with large diffs) and adjusts decision-style estimate, noting reduced confidence.
    - **Monorepos:** per-developer filtering via `git log --author` before analysis. Fingerprint reflects the individual's commits, not the whole repo.
    - **Trunk-based development:** fewer branches ≠ fewer alternatives evaluated. Fingerprint adjusts by weighting commit message analysis (alternatives mentioned in messages) over branch count.
    - **Shallow clones / partial histories:** detected via `simple-git`. Fingerprint notes "analyzed N of M total commits" and adjusts confidence accordingly.
    - **Empty repos (<10 commits):** fingerprint shows "Not enough history yet — check back after your first week" instead of nonsensical statistics.
    - **Large repos (>5000 commits in scan window):** capped at 5000 most recent commits. Uses batched commit walking via simple-git (process 500 commits at a time, extract stats) to keep peak memory under 200MB. Progress bar shows "Scanning git history... 2500/5000 commits" so the developer knows it's working. Fingerprint notes "analyzed 5000 of N total commits (last 12 months)" when capped.
- `unfade` (no args) — TUI dashboard (Ink): daemon status, today's summary, quick actions `[d]istill [c]ard [o]pen web [q]uit`
- `unfade open` — opens web UI in browser (`localhost:7654`)
- First Unfade Card — auto-generated from the fingerprint (no LLM, no Ollama dependency)
- `.unfade/` substrate initialized with `config.json`, empty `events/`, seed `profile/reasoning_model.json`

**`unfade init` state machine — failure recovery:**

Each step is idempotent. Re-running `unfade init` detects completed steps and skips them. A progress marker is written to `.unfade/state/init_progress.json` after each step so that a crash mid-init resumes from the last completed step.

```
State Machine:

  [start] ──► [1. scaffold] ──► [2. git_scan] ──► [3. download_daemon] ──► [4. install_hooks] ──► [5. install_autostart] ──► [6. start_services] ──► [done]
                   │                  │                   │                      │                        │                        │
                   ▼                  ▼                   ▼                      ▼                        ▼                        ▼
              (fail: report     (fail: report       (fail: report          (fail: report             (fail: report            (fail: report
               + stop.           + continue.          + continue.            + continue.               + continue.              + continue.
               Can't proceed     Fingerprint          Daemon features        Terminal capture           Auto-start               Services can
               without dir)      skipped)             deferred)              deferred)                  deferred)                start manually)
```

| Step | On Failure | Recovery |
|---|---|---|
| **1. Scaffold `.unfade/`** | Cannot create directory (permissions, disk full) | Fatal — report error, exit. No partial state to clean up. |
| **2. Git history scan** | Not a git repo, or repo too shallow | Non-fatal — skip fingerprint, show "No git history found. Fingerprint will be generated after your first commits." Continue to step 3. |
| **3. Download daemon binary** | Network error, platform not supported | Non-fatal — skip daemon. Show "Daemon download failed. Run `unfade init` again when online. Capture features will be available after daemon is installed." Continue to step 4. |
| **4. Install shell hooks** | Shell not detected, config file not writable | Non-fatal — skip hooks. Show "Shell hooks not installed. Terminal capture will be unavailable. Run `unfade hooks --install` to retry." Continue to step 5. |
| **5. Install auto-start** | launchd/systemd/Task Scheduler failure | Non-fatal — skip auto-start. Show "Auto-start not configured. Run `unfade daemon start` manually after login." Continue to step 6. |
| **6. Start daemon + server** | Port conflict, binary not found (step 3 failed) | Non-fatal — show "Services not started. Run `unfade daemon start` when ready." Init still succeeds. |

**Non-git directory handling:** `unfade init` works in non-git directories. Step 2 (git scan) is skipped. The daemon watches for `.git/` to appear (e.g., after `git init`). Terminal and AI session capture work immediately. Fingerprint is generated on the first `unfade distill` that has git events.

**Idempotent re-run:** Each step checks its own completion state before executing. Re-running `unfade init` in an already-initialized repo skips completed steps, retries failed steps, and reports what changed. Never destroys existing data — existing `events/`, `distills/`, `profile/` are preserved.

### Why This Slice First

The product strategy identifies a fatal flaw in the original build sequence: **24-hour delay to first value**. The original flow — install → start daemon → work for a day → get distill tomorrow — violates every viral growth law.

The Instant Fingerprint solves this. `unfade init` parses existing git history (which every developer already has) and produces a Reasoning Fingerprint within 60 seconds. This is the Spotify Wrapped reveal: a mirror reflecting something true about you that you didn't know. No daemon needed. No LLM needed. No waiting.

### Data Flow

```
.git/ (existing history)
        │
        ▼
┌──────────────────────────┐
│ Git History Analyzer      │    simple-git: walk commits, branches, tags
│                          │
│ For each commit:         │    - Count files changed (scope indicator)
│   - Parse diff stats     │    - Detect reverts (dead ends)
│   - Classify domain      │    - Detect branch patterns (exploration)
│   - Detect AI signatures │    - Detect refactor commits (trade-off signal)
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ Fingerprint Calculator   │    Pure computation — no LLM
│                          │
│ Aggregate statistics     │    - Alternatives/decision (branch/revert ratio)
│ Classify decision style  │    - Domain distribution from file paths
│ Compute trade-off profile│    - AI collaboration from diff signatures
│ Generate domain map      │
└──────────┬───────────────┘
           │
           ▼
  .unfade/profile/reasoning_model.json  (seed)
  .unfade/cards/first-unfade.png        (first card)
```

### CLI Output (Target Experience)

```
$ npx unfade init

⟐ Unfade — Your AI knows how you think.

[1/5] Scaffolding .unfade/ directory...                    ✓
[2/5] Scanning git history... 847 commits across 14 months
      ━━━ Your Reasoning Fingerprint ━━━
      Decision Style:      Deep Explorer (3.4 alt/decision)     ●●●○
      Top Domains:         Auth (34%), Database (22%), API (18%) ●●●●
      Trade-off Profile:   Favors simplicity (72%)               ●●○○
      Dead End Tolerance:  High (2.1 per major decision)         ●●●○
      AI Collaboration:    Modifier (edits 64% of AI suggestions) ●●●○
                                                      confidence ─┘

[3/5] Installing unfaded daemon (darwin-arm64, 12MB)...    ✓
      Auto-start: launchd (~/Library/LaunchAgents/)
[4/5] Detecting shell... zsh
      Installing capture hooks in ~/.zshrc                 ✓
[5/5] Starting daemon + server...                          ✓
      Daemon: unfaded (PID 42813, watching .git/)
      Server: localhost:7654

━━━ First Unfade Card Generated ━━━
  → .unfade/cards/first-unfade.png
  → Open card: unfade open

Ready. Your AI now knows how you think.
  unfade        — quick dashboard
  unfade open   — full web UI
  localhost:7654 — always available
```

### New Files (Slice 1)

```
src/
├── cli.ts                              # Commander entry point (unfade, unfade init, unfade open, unfade query, etc.)
├── commands/
│   ├── init.ts                         # unfade init — full setup: scaffold, fingerprint, daemon, shell hooks, auto-start, start
│   └── open.ts                         # unfade open — opens localhost:7654 in browser
├── tui/
│   └── dashboard.tsx                   # Ink TUI — unfade (no args): status, today's distill, quick actions
├── services/
│   ├── daemon/
│   │   └── binary.ts                   # Download + verify unfaded binary for current platform
│   ├── fingerprint/
│   │   └── calculator.ts              # Reasoning Fingerprint from git history (simple-git)
│   ├── card/
│   │   ├── generator.ts               # Card data extraction + rendering pipeline
│   │   └── templates.ts               # JSX templates for satori
│   ├── shell/
│   │   └── installer.ts              # Detect shell (zsh/bash/PowerShell), install capture hooks
│   └── substrate/
│       └── initializer.ts             # .unfade/ directory scaffolding
├── schemas/
│   ├── event.ts                        # CaptureEvent Zod schema (mirrors Go struct)
│   ├── decision.ts                     # Decision Zod schema
│   └── profile.ts                      # ReasoningModel Zod schema
└── utils/
    └── git.ts                          # simple-git helpers (for init, not for daemon)
```

### Tests (Slice 1)

| Test | What It Validates |
|---|---|
| `unfade init` scaffolds `.unfade/` with correct directory structure | Substrate integrity |
| `unfade init` downloads correct platform daemon binary | Binary management |
| `unfade init` detects shell and installs capture hooks | Shell hook setup |
| `unfade init` installs platform auto-start (launchd/systemd/Task Scheduler) | Auto-start |
| `unfade init` starts daemon + server after setup | Full lifecycle |
| Git history analyzer extracts commits, branches, reverts from a test repo | Signal extraction |
| Fingerprint calculator produces valid reasoning model from git stats | Computation correctness |
| Domain classification maps file paths to correct domains | Domain accuracy |
| AI collaboration rate detection from known diff signatures | AI signal detection |
| Card generator produces valid PNG from fingerprint data | Card rendering pipeline |
| TUI dashboard renders daemon status and today's summary | TUI rendering |
| TUI quick actions trigger correct operations | TUI interaction |
| `unfade init` completes in <60s for a repo with 1000 commits | Performance budget |
| `unfade init` handles empty repo gracefully (no commits) | Edge case |
| `unfade init` is idempotent (re-running doesn't destroy existing data) | Safety |

### Success Metrics

| Metric | Target |
|---|---|
| Time from `npx unfade init` to Reasoning Fingerprint displayed | < 60 seconds for 1000 commits |
| Card file size | < 500KB PNG |
| Card dimensions | 1200x630 (OG-compatible) |
| Memory usage during git scan | < 200MB peak |

---

## Slice 2: Daily Distill — The Habit Loop

> _"I worked all day. At 6 PM, Unfade said 'Your Unfade is ready.' I reviewed 3 decisions, 2 trade-offs, 1 dead end I'd already forgotten about. The distill told me I evaluated 4 alternatives today — highest this month. Took 2 minutes. I want to see tomorrow's."_

### What Ships

- `unfaded` (Go binary): git watcher (fsnotify on `.git/`) + AI session log reader (file tailing on `~/.cursor/logs/`, `~/.claude/`). Auto-downloaded and started by `unfade init` (Slice 1), auto-starts on login via platform manager
- Event pipeline: raw signals → `.unfade/events/YYYY-MM-DD.jsonl` (written by Go daemon)
- Distillation engine (TypeScript): events → signal extraction → context linking → LLM synthesis → Daily Distill
- `unfade distill` command (power user): trigger manual distillation from terminal/scripts. Also accessible via TUI quick action `[d]` and web UI re-generate button
- Daemon control via web UI settings page (`/settings`): start/stop/restart, view logs, configure auto-start. Power user fallback: `unfade daemon stop`
- Daily Distill format with **personalization seed observations:**
  - Not just "you made 3 decisions" (that's DevDaily)
  - Rather: "you made 3 decisions — you evaluated 2 alternatives for the first, 4 for the second, and accepted the AI's suggestion without evaluation for the third"
- Incremental updates to `profile/reasoning_model.json` with each distillation cycle

### Why Personalization Ships Here (Not Later)

The competitive analysis is unambiguous: 11 tools capture decisions, 5 MCP servers store memory, zero learn how you think. If the Daily Distill launches as activity reporting ("you made 3 decisions today"), Unfade is one of 16 capture/memory tools. If it launches with personalization observations — even rough — it is the only tool that signals "I am learning how you think."

The personalization seed in the first Daily Distill converts casual interest into commitment. The developer thinks: "This tool is already building a model of me. I want to see what it learns after a week."

### Data Flow

```
Developer works normally (git commits, AI conversations)
        │
        ▼
┌──────────────────────────┐
│ unfaded (Go daemon)       │    fsnotify: .git/ events
│                          │    File tail: ~/.cursor/logs/, ~/.claude/
│ Events → .unfade/events/ │    Append-only JSONL, one file per day
└──────────┬───────────────┘
           │
           ▼ (at configured time, or on `unfade distill`)
┌──────────────────────────┐
│ Distillation Pipeline    │    See Cross-Cutting Concern §4
│                          │
│ Stage 1: Extract signals │    No LLM — pattern matching, classification
│ Stage 2: Link context    │    No LLM — cross-reference sources
│ Stage 3: LLM synthesis   │    Ollama/cloud — generate Daily Distill
│ Stage 4: Update profile  │    No LLM — statistical update to reasoning_model.json
└──────────┬───────────────┘
           │
           ▼
  .unfade/distills/YYYY-MM-DD.md       (Daily Distill)
  .unfade/graph/decisions.jsonl        (structured decisions)
  .unfade/graph/domains.json           (updated domain map)
  .unfade/profile/reasoning_model.json (incrementally updated)
```

### Daily Distill Format (Target)

```markdown
━━━ Daily Distill — Tuesday, April 12, 2026 ━━━

DECISIONS (3)
● Chose refresh-ahead over clock tolerance for JWT handling
  — Latency benchmarks showed 4ms overhead vs 200ms+ on cold refresh
● Migrated session store from in-memory to Redis
  — Horizontal scaling blocked without shared state
● Used zod v4 .refine() over .email() for validation
  — Build compatibility with stricter v4 parser

TRADE-OFFS (2)
● Redis vs Memcached for session store
  — Redis selected: persistence + pub/sub outweigh throughput delta
● Evaluated moving to edge auth (Cloudflare Workers)
  — Deferred: requires rearchitecting middleware chain

DEAD ENDS (1)
● Spent 45 min attempting to fix JWT validation by adjusting
  clock tolerance — abandoned when root cause identified as
  validation order, not clock skew

BREAKTHROUGHS (1)
● JWT library validates expiry *before* checking refresh window
  — reversing the order eliminates the entire clock skew class of bugs

PATTERNS (personalization seed)
Today: 3 decisions, 2 trade-offs, 1 dead end explored
This week: 14 decisions (avg 12), 6 trade-offs (avg 5)
Alternatives evaluated: 2, 4, 1 (you accepted the third without evaluation)
Exploration depth: Above your baseline ↑
```

### New Files (Slice 2, incremental to Slice 1)

**Go daemon (`unfaded/`):**

```
daemon/
├── main.go                             # Entry point, signal handling, graceful shutdown
├── capture/
│   ├── source.go                       # CaptureSource interface
│   ├── git.go                          # Git watcher (fsnotify + os/exec to system git)
│   ├── ai_session.go                   # AI session log tailer
│   └── event.go                        # CaptureEvent struct, JSONL serialization
├── platform/
│   ├── manager.go                      # PlatformManager interface
│   ├── launchd.go                      # macOS launchd plist generation + install
│   ├── systemd.go                      # Linux systemd unit generation + install
│   └── windows.go                      # Windows Task Scheduler + named pipe
├── health/
│   └── reporter.go                     # Writes state/health.json periodically
└── go.mod
```

**TypeScript CLI (`src/`):**

```
src/
├── commands/
│   ├── daemon.ts                       # unfade daemon stop (power user — start/restart via web UI settings)
│   └── distill.ts                      # unfade distill [--date YYYY-MM-DD] (power user — also via TUI [d] / web UI)
├── services/
│   ├── daemon/
│   │   └── manager.ts                  # Daemon lifecycle management (download binary, check PID)
│   ├── distill/
│   │   ├── pipeline.ts                 # Three-stage distillation pipeline
│   │   ├── extractor.ts               # Stage 1: signal extraction
│   │   ├── linker.ts                   # Stage 2: context linking
│   │   └── synthesizer.ts             # Stage 3: LLM synthesis
│   └── llm/
│       └── ai.ts                       # Vercel AI SDK integration (generateObject + provider adapters)
└── schemas/
    └── distill.ts                      # DailyDistill Zod schema
```

### Tests (Slice 2)

| Test | What It Validates |
|---|---|
| Go daemon starts, creates PID file, writes health.json | Daemon lifecycle |
| Go daemon git watcher emits event on new commit → JSONL written | Git capture |
| Go daemon AI session watcher emits event from Cursor log → JSONL written | AI session capture |
| Signal extractor classifies commit as decision/dead-end/exploration | Extraction accuracy |
| Context linker cross-references AI conversation with related commit | Cross-source linking |
| Distillation pipeline produces valid DailyDistill from test events | End-to-end pipeline |
| `unfade distill --date` reprocesses a specific day | Manual trigger |
| Profile model updates incrementally after each distillation | Personalization accumulation |
| Go daemon respects PID file (no duplicate instances) | Process safety |
| Go daemon cross-platform: writes events on macOS/Linux (socket) and Windows (named pipe) | Platform coverage |
| Daemon stop via CLI (`unfade daemon stop`) performs graceful shutdown | Manual control |
| Graceful degradation when no LLM is available (reduced distill) | Resilience |

### Success Metrics

| Metric | Target |
|---|---|
| Event capture latency (git commit → event in JSONL) | < 500ms |
| Distillation time (full pipeline for a typical day) | < 30 seconds with Ollama |
| Go daemon memory usage (idle, watching 2 sources) | < 15MB |
| Go daemon CPU usage (idle) | < 1% |
| Go daemon binary size | < 15MB |
| Go daemon startup time | < 50ms |

---

## Slice 3: Dual-Protocol Server — The Memory Layer

> _"I told Cursor 'continue the auth refactoring from yesterday' and it just... knew. No pasting. No re-explaining. Every AI tool I use now remembers how I think."_

### What Ships

- HTTP API on `localhost:7654` — `/context`, `/query`, `/decisions`, `/profile`, `/amplify`, `/similar` endpoints (JSON)
- Web UI on `localhost:7654` — htmx + server-rendered HTML pages: `/` (dashboard), `/distill` (viewer + history), `/profile` (reasoning profile visualization), `/settings` (daemon control, LLM config, capture sources)
- MCP Server (stdio transport + Streamable HTTP on `localhost:7654/mcp`) — 5 Resources, 5 Tools, 3 Prompts
- `unfade query "..."` command — semantic search across reasoning history from CLI (pipeable, scriptable)
- Profile visualization via web UI `/profile` page (replaces standalone `unfade profile` command). TUI shows profile summary inline
- Cross-day reasoning graph — decisions linked across days by domain, file, and keyword
- MCP Registry entry (`server.json`) — standard metadata for ecosystem discovery
- ClawHub skill manifest (`unfade-memory`) — discoverable by OpenClaw's 354K-star community

### Why the Dual-Protocol Architecture

**HTTP** serves direct consumers: the web UI (htmx, server-rendered HTML on same port), the CLI, and custom scripts. RESTful, simple, familiar. The web UI is the primary visual interface — profile, cards, search, settings all live here (see Cross-Cutting Concern §8).

**MCP** serves the agent ecosystem: Cursor, Claude Code, OpenClaw, Windsurf, and any future MCP-compatible tool. The MCP server auto-discovery means zero per-tool integration work — one implementation serves every tool.

Both protocols read from the same `.unfade/` data substrate. The server is a thin read layer over plain-text files, not a separate data store.

### MCP Integration Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Unfade Dual-Protocol Server                               │
│                                                          │
│  .unfade/ ──► Query Engine ──┬──► HTTP API (Hono)        │
│              (read .unfade/) │    localhost:7654          │
│                              │                            │
│                              └──► MCP Server              │
│                                   stdio (local agents)    │
│                                   Streamable HTTP (/mcp)  │
│                                                          │
│  Query Engine capabilities:                               │
│  - Recent context retrieval (time-windowed)               │
│  - File-scoped context (all reasoning about a file)       │
│  - Keyword search across decisions.jsonl                  │
│  - Profile retrieval (reasoning_model.json)               │
│  - Domain map retrieval (domains.json)                    │
│  - Amplification retrieval (connections.jsonl)             │
└──────────────────────────────────────────────────────────┘

**Query Engine consistency model:**

The Query Engine reads from multiple files (`events/`, `distills/`, `graph/`, `profile/`, `amplification/`) that are written by different processes at different times. Cross-file consistency is NOT guaranteed — and that is acceptable for this use case.

| Guarantee | How |
|---|---|
| **Single-file consistency** | Each file is written atomically (tmp + rename for JSON, O_APPEND for JSONL). A reader never sees a torn write. |
| **Cross-file eventual consistency** | After a distillation completes, all files are updated within seconds. Between distillations, files reflect the state of the last completed distill. |
| **Staleness tolerance** | Every query response includes a `last_updated` timestamp (the mtime of the most recently modified file read). Consumers (MCP agents, HTTP clients) can judge freshness. |
| **No read locks** | The Query Engine never locks files. It reads whatever is on disk. If a distillation is in progress, the reader may see the old distill — this is acceptable. The next read will see the new one. |

**Snapshot reads:** For queries that span multiple files (e.g., `unfade_amplify` reads `decisions.jsonl` + `connections.jsonl` + `reasoning_model.json`), the Query Engine reads all files at query time and assembles the response. There is no transaction or snapshot isolation — if a distillation writes `decisions.jsonl` but hasn't yet written `connections.jsonl`, the query returns new decisions with old connections. This is a brief inconsistency window (seconds) that self-heals on the next query.
```

### Agent Experience (What the Developer Sees)

**Before Unfade (every AI session):**

```
Developer: "Fix the auth token refresh bug I was debugging yesterday"
Agent: "I don't have context about what you were doing yesterday.
        Can you describe the issue?"
Developer: [pastes error message, explains 3 approaches tried,
           re-derives the context from memory]
```

**After Unfade (Slice 3):**

```
Developer: "Fix the auth token refresh bug I was debugging yesterday"
Agent: [queries unfade://context/recent → gets yesterday's context automatically]
Agent: "Based on your recent work: you tried adjusting clock tolerance
        (abandoned after 45 min — root cause was validation order, not
        clock skew) and were considering refresh-ahead strategy.
        The fix should reverse the JWT validation order. Here's the change..."
```

### New Files (Slice 3, incremental)

```
src/
├── commands/
│   └── query.ts                        # unfade query "..." (CLI, pipeable)
├── server/
│   ├── http.ts                         # Hono HTTP API setup (JSON + HTML routes)
│   ├── mcp.ts                          # MCP server setup (Resources, Tools, Prompts)
│   ├── routes/
│   │   ├── context.ts                  # /context, /context/for (JSON API)
│   │   ├── query.ts                    # /query (JSON API)
│   │   ├── decisions.ts                # /decisions (JSON API)
│   │   ├── profile.ts                  # /profile (JSON API)
│   │   ├── amplify.ts                  # /amplify (JSON API)
│   │   └── similar.ts                  # /similar (JSON API)
│   ├── pages/                          # Web UI — htmx + server-rendered HTML
│   │   ├── layout.ts                   # Base HTML layout (htmx script, nav, dark theme CSS)
│   │   ├── dashboard.ts                # GET / → dashboard page (status, today's distill, stats)
│   │   ├── distill.ts                  # GET /distill → distill viewer + history + re-generate button
│   │   ├── profile.ts                  # GET /profile → reasoning profile visualization
│   │   └── settings.ts                 # GET /settings → daemon control, LLM config, capture sources
│   └── query-engine.ts                 # Reads .unfade/ files, provides structured results
├── mcp/
│   ├── resources.ts                    # 5 MCP Resources
│   ├── tools.ts                        # 5 MCP Tools
│   └── prompts.ts                      # 3 MCP Prompts
└── ecosystem/
    ├── server.json                     # MCP Registry entry
    └── clawhub-manifest.json           # OpenClaw skill manifest
```

### Tests (Slice 3)

| Test | What It Validates |
|---|---|
| HTTP `/context` returns recent reasoning signals (time-windowed) | Context retrieval |
| HTTP `/context/for?file=...` returns file-scoped reasoning | File-scoped query |
| HTTP `/query?q=...` returns keyword-matched decisions | Search |
| HTTP `/profile` returns current reasoning model | Profile delivery |
| MCP Resource `unfade://context/recent` matches HTTP `/context` | Protocol parity |
| MCP Tool `unfade_query` matches HTTP `/query` | Protocol parity |
| MCP stdio transport connects and responds | Transport |
| MCP Streamable HTTP transport connects and responds | Transport |
| Query engine handles empty `.unfade/` gracefully | Edge case |
| Server starts on configured port, rejects duplicate | Lifecycle |
| `unfade query "caching"` returns relevant decisions from CLI | CLI integration |
| Web UI GET `/` returns HTML with dashboard content | Web UI rendering |
| Web UI GET `/distill` returns HTML with distill viewer | Web UI rendering |
| Web UI GET `/profile` returns HTML with reasoning profile | Web UI rendering |
| Web UI GET `/settings` returns HTML with daemon controls | Web UI rendering |
| Web UI `hx-post="/distill"` triggers re-distill and returns HTML fragment | htmx interaction |

### Success Metrics

| Metric | Target |
|---|---|
| Context retrieval latency (HTTP + MCP) | < 100ms for typical `.unfade/` size |
| MCP server discovery time (from agent perspective) | < 2 seconds |
| Memory overhead of server (TypeScript process, independent of Go daemon) | < 50MB |

---

## Slice 4: Cards & Terminal — The Viral Artifacts

> _"I generated my Unfade Card — dark theme, 3 decisions, domain tags, reasoning depth 3.2 alternatives/decision. Shared it on X. 40 likes in an hour. Three people asked 'what is this tool?' The card is the marketing."_

### What Ships

- Card rendering pipeline: parse distill → extract data → JSX template → satori (SVG) → resvg-js (PNG)
- Web UI `/cards` page — card preview, generate for any date, download PNG. Also accessible via TUI quick action `[c]`
- Card generation API endpoint: `POST /cards/generate` (used by web UI and TUI, also available to scripts)
- Terminal capture: zsh/bash preexec/precmd hooks → Go daemon's Unix socket (macOS/Linux) or named pipe (Windows) → CaptureEvents in JSONL
- Shell hooks installed by `unfade init` (Slice 1). Web UI `/settings` shows hook status and provides reinstall option
- Debugging session detection (in Go daemon): retry patterns (same command, different args, within 10-minute window) → enriched events
- `unfade export` command (power user) — portable `.tar.gz` archive of `.unfade/` (excluding `state/daemon.sock`, `state/daemon.pid`)

### Card Visual Design

```
┌──────────────────────────────────────────────────┐
│                                                   │
│  UNFADE                          2026-04-14       │
│  ─────────────────────────────────────────        │
│                                                   │
│  ● Chose Redis over Memcached for session cache   │
│  ● Refactored auth middleware to use JWT refresh   │
│  ● Abandoned custom WebSocket auth (40 min)       │
│                                                   │
│  ┌─────┐  ┌──────────┐  ┌──────┐                │
│  │ auth │  │ database │  │ perf │                │
│  └─────┘  └──────────┘  └──────┘                │
│                                                   │
│  Reasoning Depth: ████████░░ 3.2 alt/decision    │
│  Dead Ends: 1    Decisions: 3    AI Modified: 60% │
│                                                   │
│  unfade.dev                                       │
└──────────────────────────────────────────────────┘
```

**Dimensions:** 1200x630 (OG-compatible for X, LinkedIn, Discord previews).
**Theme:** Dark-first, developer-native aesthetic. Generative accent color derived from domain distribution.

### Terminal Capture Architecture

```
Developer's Shell                    unfaded (Go daemon)
┌──────────────┐                    ┌──────────────────┐
│              │                    │                    │
│  preexec()   │                    │  TerminalReceiver  │
│  captures    │──JSON over sock───►│  Unix socket       │
│  command +   │   (non-blocking,   │  (macOS/Linux)     │
│  start time  │    fire-and-forget)│  Named pipe        │
│              │                    │  (Windows)         │
│  precmd()    │                    │                    │
│  captures    │──JSON over sock───►│  Parse → CaptureEvent
│  exit code + │                    │  Detect patterns:  │
│  duration    │                    │  - Retries         │
│              │                    │  - Debugging sess. │
│              │                    │  - Error sequences │
│              │                    │  Write → events/   │
└──────────────┘                    └──────────────────┘
```

**Shell hook (installed by `unfade init`, reinstallable from web UI `/settings`):**

```
# zsh: preexec captures command before execution
unfade_preexec() {
  _unfade_cmd="$1"
  _unfade_cmd_start=$(date +%s)
}

# zsh: precmd captures result after execution
unfade_precmd() {
  local exit_code=$?
  if [[ -n "$_unfade_cmd" ]]; then
    ~/.unfade/bin/unfade-send '{"cmd":"'"$_unfade_cmd"'","exit":'$exit_code',"duration":'$(($(date +%s)-_unfade_cmd_start))',"cwd":"'"$PWD"'"}' &
    unset _unfade_cmd _unfade_cmd_start
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec unfade_preexec
add-zsh-hook precmd unfade_precmd
```

**Windows PowerShell hook (installed by `unfade init` on Windows):**

```powershell
# PowerShell: uses named pipe instead of Unix socket
function Unfade-PreCommand {
    $script:_unfade_cmd = $MyInvocation.HistoryId
    $script:_unfade_start = Get-Date
}

function Unfade-PostCommand {
    if ($script:_unfade_cmd) {
        $last = Get-History -Count 1
        $duration = ((Get-Date) - $script:_unfade_start).TotalSeconds
        $json = @{ cmd=$last.CommandLine; exit=$LASTEXITCODE; duration=[int]$duration } | ConvertTo-Json -Compress
        try {
            $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", "unfade-daemon", "Out")
            $pipe.Connect(100)
            $writer = New-Object System.IO.StreamWriter($pipe)
            $writer.WriteLine($json)
            $writer.Flush()
            $pipe.Close()
        } catch { }  # Silent failure — same as Unix 2>/dev/null
        $script:_unfade_cmd = $null
    }
}

Set-PSReadLineOption -AddToHistoryHandler { Unfade-PreCommand; return $true }
Register-EngineEvent PowerShell.OnIdle -Action { Unfade-PostCommand }
```

**Design constraints:**
- **Zero latency.** Event delivery is fire-and-forget. The developer never notices.
- **Failure is silent.** If the socket/pipe is unavailable, errors are silently dropped.
- **Privacy.** Only the command string and exit code are captured. Never stdout/stderr.
- **Interactive opt-in.** `unfade init` shows the exact lines that will be added to `~/.zshrc` (or equivalent) and asks for confirmation (Y/n). Modifying shell config is trust-sensitive — the developer must see what's being added. Reinstallable from web UI `/settings`. Never silently added.
- **Cross-platform.** Same capture semantics on macOS/Linux (Unix socket) and Windows (named pipe). The Go daemon abstracts the transport.
- **Hook management.** `unfade hooks --status` shows installed hooks and their health. `unfade hooks --remove` cleanly removes hooks from shell config. Web UI `/settings` provides the same controls.

**Transport: replacing `nc -U`.**

The shell hook example uses `nc -U` (netcat with Unix socket support) to send events to the daemon. This has a hidden dependency problem: not all systems have `nc` installed, and busybox `nc` does not support `-U`. Instead, `unfade init` installs a tiny companion binary alongside `unfaded` called `unfade-send` (~500KB Go binary) that handles socket/pipe communication. The shell hook becomes:

```bash
# Instead of: echo "$json" | nc -U ~/.unfade/state/daemon.sock 2>/dev/null &
~/.unfade/bin/unfade-send "$json" &
```

`unfade-send` is a single-purpose binary: parse one JSON argument, write to socket/pipe, exit. <1ms execution. No runtime dependency. Cross-platform (same binary handles Unix socket or named pipe based on OS).

**Hook conflict avoidance.** The hooks use `add-zsh-hook` (zsh) and `PROMPT_COMMAND` chaining (bash) — both play well with other hook systems (atuin, starship, powerlevel10k). Unfade's hooks append, never replace. `unfade hooks --status` reports if any known conflicting hooks are detected.

### Terminal Event Pattern Detection

| Pattern | Detection Rule | Signal Value |
|---|---|---|
| **Command** | Any preexec/precmd pair | What tools/commands used |
| **Error** | Non-zero exit code | What went wrong |
| **Retry** | Same base command, different args, after error | Debugging exploration |
| **Debugging session** | 3+ retries within 10-minute window on related commands (see definition below) | Time invested, approaches tried, eventual resolution |

**"Related commands" definition (for debugging session detection):**

Two commands are "related" if ANY of these conditions hold:
1. **Same base binary:** e.g., `npm test`, `npm run build`, `npm install` all share base binary `npm`
2. **Same target file:** e.g., `python app.py`, `cat app.py`, `vim app.py` all reference `app.py`
3. **Same working directory + time proximity:** commands in the same directory within a 10-minute window, even if different binaries (e.g., `cargo build` → `./target/debug/myapp` → `cargo build` is a build-test-fix cycle)

The Go daemon extracts the base binary (first token) and scans arguments for file-path-like tokens (contains `/` or `.` with a known extension). These are lightweight heuristics — false positives (grouping unrelated commands) are harmless, while false negatives (missing a debugging session) lose signal.

### New Files (Slice 4, incremental)

**Go daemon (`daemon/`) — terminal capture additions:**

```
daemon/
├── capture/
│   ├── terminal.go                     # Terminal event receiver (Unix socket / named pipe)
│   └── patterns/
│       └── debugging.go                # Debugging session detection (retries, error sequences)
└── platform/
    └── shell_hook.go                   # Shell hook script generation (zsh/bash/PowerShell)
```

**TypeScript (`src/`) — cards, export, web UI card page:**

```
src/
├── commands/
│   └── export.ts                       # unfade export (power user — .tar.gz archive)
├── server/
│   ├── pages/
│   │   └── cards.ts                    # GET /cards → card preview, generate, download
│   └── routes/
│       └── cards.ts                    # POST /cards/generate → generate card PNG (used by web UI + TUI)
└── services/
    └── card/
        ├── generator.ts                # Card data extraction + rendering pipeline
        └── templates.ts                # JSX templates for satori (dark theme)
```

### Tests (Slice 4)

| Test | What It Validates |
|---|---|
| Card generator extracts top 3 decisions from distill | Data extraction |
| Card generator extracts domain tags | Domain tag extraction |
| Card generator calculates reasoning depth score | Score computation |
| Card generator handles distill with no decisions | Edge case |
| Card rendering produces valid PNG | Rendering pipeline |
| Card PNG dimensions are 1200x630 | OG compatibility |
| Go daemon receives terminal event via Unix socket (macOS/Linux) | Socket communication |
| Go daemon receives terminal event via named pipe (Windows) | Platform coverage |
| Go daemon parses terminal command with exit code → JSONL | Event parsing |
| Go daemon detects retry pattern (same command, different args) | Pattern detection |
| Go daemon detects debugging session (3+ retries in 10 min) | Session detection |
| Shell hook installer detects zsh and generates correct hook | Shell detection |
| Shell hook installer detects bash and generates correct hook | Shell detection |
| Shell hook installer generates PowerShell hook for Windows | Platform coverage |
| Shell hook installer does not duplicate if already installed | Idempotency |
| Web UI GET `/cards` returns HTML with card preview | Web UI rendering |
| Web UI `POST /cards/generate` returns PNG for given date | Card API |
| TUI quick action `[c]` triggers card generation via API | TUI integration |
| `unfade export` creates valid .tar.gz | Archive creation |
| `unfade export` excludes daemon.sock, daemon.pid, health.json | Ephemeral state exclusion |

### Success Metrics

| Metric | Target |
|---|---|
| Card generation time | < 3 seconds |
| Card file size | < 500KB PNG |
| Terminal capture latency (preexec → socket send) | < 10ms (user-imperceptible) |
| Debugging session detection accuracy | 80%+ of actual debugging sessions |

---

## Slice 5: Personalization & Amplification — The Moat

> _"Unfade told me: 'You evaluated Redis vs Memcached today. On Feb 8, you made a similar evaluation and chose Memcached for throughput — but noted you'd pick Redis if you ever needed pub/sub. This project needs pub/sub.' I'd forgotten that trade-off from 2 months ago. The connection saved me 30 minutes of re-research."_

### What Ships

- Personalization engine v1: reasoning profile drives distill quality + context shape
  - Decision style learned from 4+ weeks of data
  - Trade-off preferences extracted from decision patterns
  - Domain depth model with decision density per domain
  - Exploration habit indicators
- Amplification engine v1: cross-temporal and cross-domain connection surfacing
  - When today's decision has a keyword/domain overlap with a past decision → surface the connection
  - "You evaluated X today. On [date], you made a similar evaluation and chose Y" format
  - Conservative matching (same domain + similar keywords) — no false positives over relevance
- Web UI `/search` page — query reasoning history + find similar past decisions. Replaces standalone `unfade similar` command. Also accessible via `unfade query "..."` CLI for piping
- `unfade_amplify` and `unfade_similar` MCP tools — proactive insight surfacing for AI agents (primary consumption path for "similar" is via MCP, not CLI)
- Amplification section in Daily Distill — connections appended to each distill automatically
- Blind spot detection seed — domains where the developer decides quickly but shallowly

### Why This Is the Moat

The competitive analysis (35+ tools, April 2026) reveals a dumbbell pattern:

```
CAPTURE         →  PERSONALIZATION  →  AMPLIFICATION   →  IDENTITY
██████████████     ░░░░░░░░░░░░░░     ░░░░░░░░░░░░░░     ░░░░░░░░░░░░░░
CROWDED            EMPTY               EMPTY               EMPTY
(11 tools)         (0 tools at         (2 tools,           (5 tools, all
                    reasoning level)    partial)            output-based)
```

Capture is heading toward commodity. Cross-tool memory (MCP servers) solves an immediate pain. **The empty middle — personalization, amplification, identity — is where Unfade's structural moat lives.** A competitor can replicate capture in weeks. They cannot produce 6 months of *your* reasoning patterns without 6 months of observation.

### Amplification Architecture

```
Today's distill (new decisions)
        │
        ▼
┌──────────────────────────┐
│ Connection Detector       │
│                          │
│ For each new decision:   │
│  1. Extract domain + keywords
│  2. Search graph/decisions.jsonl for:
│     - Same domain within last 6 months
│     - Keyword overlap > threshold
│     - Same file path touched
│  3. Score connection confidence
│  4. Surface top connections (high-confidence only)
└──────────┬───────────────┘
           │
           ▼
  .unfade/amplification/connections.jsonl  (new connections)
  .unfade/distills/YYYY-MM-DD.md          (amplification section appended)
```

**Matching strategy (conservative v1):**
- **Same domain + keyword overlap:** "Redis" appears in both today's decision and a past decision → strong signal
- **Same file path:** today's decision touches `src/auth/middleware.ts`, past decision also touched it → strong signal
- **Threshold:** Require ≥2 matching signals (domain + keyword, or keyword + file path) to surface a connection
- **Confidence score:** Connections below threshold are stored but not surfaced (available for future model improvement)
- **"Not helpful" feedback:** Every surfaced connection includes a mechanism to mark it as unhelpful → trains the matching model

**Index strategy (avoiding O(n) linear search):**

As `decisions.jsonl` grows (hundreds of decisions over months), linear search becomes expensive. The amplifier maintains a lightweight inverted index:

```
// .unfade/graph/decisions_index.json — rebuilt on each distillation
{
  "byDomain": {
    "auth": [0, 3, 7, 12, ...],       // Line offsets into decisions.jsonl
    "database": [1, 5, 8, ...],
    "api": [2, 4, 9, ...]
  },
  "byKeyword": {
    "redis": [1, 8],
    "jwt": [0, 3, 7],
    "cache": [1, 5, 12],
    ...
  },
  "byFile": {
    "src/auth/middleware.ts": [0, 3, 7],
    ...
  },
  "totalDecisions": 42,
  "lastRebuilt": "2026-04-14T18:00:00Z"
}
```

For a new decision with domain "auth" and keywords ["jwt", "refresh"], the lookup is: `intersect(byDomain["auth"], byKeyword["jwt"] ∪ byKeyword["refresh"])` — a set operation on small integer arrays, not a full file scan. The index is rebuilt after each distillation (incremental — only new decisions are added). Total size stays small (a few KB even after a year).

**Blind spot quantification:**

A "blind spot" is a domain where the developer makes decisions frequently but explores shallowly. Quantitatively:

- **Blind spot candidate:** A domain with ≥5 decisions AND average alternatives-per-decision < 1.5 (i.e., the developer usually picks the first option without evaluating alternatives)
- **Severity:** `decision_count × (1 / avg_alternatives)` — more decisions with less exploration = higher severity
- **Surfacing:** Blind spots are included in the Daily Distill amplification section: "Blind spot: You've made 12 decisions in the `database` domain but evaluated only 1.2 alternatives on average. Consider whether you're defaulting to familiar patterns."
- **Not a judgment:** Blind spots may be intentional (the developer is an expert and knows the right answer). The surfacing is informational, not prescriptive. The developer can dismiss or acknowledge via feedback.

### Personalization Depth Over Time

| Time | What Unfade Knows | What It Changes |
|---|---|---|
| **Week 1** | Raw decisions, basic domain distribution | Distills include personalization observations |
| **Month 1** | Decision style (alternatives/decision), exploration depth | Context injection shaped by decision style |
| **Month 3** | Trade-off preferences, domain depth model, failure patterns emerging | Distills noticeably improve — "it knows me" |
| **Month 6** | Relationships between decisions, blind spot map, cross-project patterns | Amplification becomes genuinely valuable |
| **Year 1** | Comprehensive cognitive profile. Every AI interaction personalized. | Switching cost is absolute — going back to generic AI feels like losing a colleague |

### New Files (Slice 5, incremental)

```
src/
├── services/
│   ├── distill/
│   │   └── amplifier.ts               # Cross-temporal connection detection
│   └── personalization/
│       ├── engine.ts                   # Personalization engine (profile updating)
│       └── matcher.ts                  # Connection matching + scoring
├── tools/
│   ├── unfade-amplify.ts              # MCP tool: proactive insight surfacing
│   └── unfade-similar.ts              # MCP tool: analogous decision search
└── server/
    ├── pages/
    │   └── search.ts                   # GET /search → reasoning history search + similar decisions (htmx)
    └── routes/
        └── amplify.ts                  # HTTP /amplify endpoint (enriched)
```

### Tests (Slice 5)

| Test | What It Validates |
|---|---|
| Amplifier detects similar past decision by keyword overlap | Connection detection |
| Amplifier surfaces connection with date and context | Output format |
| Amplifier produces no false positives on unrelated decisions | Precision |
| Amplifier respects confidence threshold | Quality gate |
| Similar tool finds analogous decision from history | Search relevance |
| Similar tool returns empty for genuinely novel decisions | False positive prevention |
| Personalization engine updates profile incrementally | Model accumulation |
| Personalization engine handles first-ever distill (cold start) | Edge case |
| Blind spot detector identifies shallow-decision domains | Pattern detection |

### Success Metrics

| Metric | Target |
|---|---|
| Amplification precision (surfaced connections that are genuinely relevant) | 80%+ (manual review of 10 suggestions) |
| Connection detection time | < 5 seconds per distill |
| Profile model file size after 6 months of use | < 50KB |

---

## MCP & Agent Synergy Analysis

### The Strategic Position

Unfade occupies a unique structural position in the agent ecosystem: it is the **missing memory layer** that the MCP protocol was designed to serve but that nobody has built.

```
Agent Ecosystem (April 2026)

AGENT LAYER (the hands)
├── OpenClaw (354K stars, 5700+ skills)
├── Cursor (1M+ DAU)
├── Claude Code
├── Windsurf
├── SWE-agent, mini-swe-agent
└── Custom MCP agents

PROTOCOL LAYER (the nervous system)
└── MCP (13K+ servers, Linux Foundation, universal)

MEMORY LAYER (the brain)
└── ??? ← UNFADE GOES HERE
    No persistent reasoning memory server exists
    among 13,000+ MCP servers
```

### Why MCP-Native Beats Custom Integrations

| Dimension | Custom Plugin Approach | MCP-Native Approach |
|---|---|---|
| **Per-tool effort** | Each tool requires a custom plugin (API learning, maintenance) | One MCP server serves every MCP-compatible tool |
| **Discovery** | Users must find the plugin for their specific tool | Tools auto-discover via MCP Registry + ClawHub |
| **Ecosystem leverage** | Unfade community builds plugins | Entire MCP/OpenClaw community builds on Unfade's surface |
| **Future-proofing** | Every new AI tool requires a new plugin | Every new MCP-compatible tool works automatically |
| **Network effects** | Linear: N plugins serve N tools | Combinatorial: one server serves all current + future hosts |

### OpenClaw Integration (Highest-Leverage)

OpenClaw is the highest-leverage first integration:
1. **354K stars** — largest open-source agent community
2. **MCP-native** — every ClawHub skill is an MCP server
3. **Zero memory/reasoning skills on ClawHub** — the gap is visible and waiting

**Developer experience after installing `unfade-memory`:**

```
Developer: "Continue the auth refactoring I started yesterday"
OpenClaw agent: [queries unfade://context/recent]
Agent: "Based on your recent work — you were refactoring the JWT
        validation middleware. You tried clock tolerance first
        (abandoned after 45 min) and were moving toward
        refresh-ahead strategy. Continuing from there..."
```

### Community Skill Ecosystem (Enabled by MCP Surface)

| Skill Type | Example | Depends On |
|---|---|---|
| **Amplification Lenses** | `unfade-lens-security` — re-analyze reasoning through threat-modeling | Unfade MCP Resources + Prompts |
| **Domain Knowledge Packs** | `unfade-pack-database-scaling` — expert reasoning overlays | Unfade MCP Resources |
| **Workflow Skills** | `unfade-standup-bot` — auto-generate standup from distill | Unfade MCP Tools |
| **Export Skills** | `unfade-to-adr` — convert decisions into Architecture Decision Records | Unfade MCP Tools |

Each community skill creates a dependency on Unfade's MCP surface — deepening the ecosystem moat while being maintained by the community, not the Unfade team.

### IDE Vendor Structural Lock-Out

No IDE vendor can build what Unfade provides:

| Vendor | What They Could Add | What They Structurally Cannot |
|---|---|---|
| **Cursor** | Better memories, preference learning | Cross-tool memory (won't share with Claude Code). Identity. Ecosystem MCP server. |
| **Claude Code** | Better AutoDream, deeper session memory | Cross-tool memory (won't share with Cursor). Identity. |
| **OpenClaw** | Agent-level memory improvements | Reasoning distillation from non-OpenClaw tools. Identity. |
| **Entire.io** | Could add reasoning distillation | Would need to pivot from infrastructure to social/identity — different product DNA. |

The cross-tool constraint is the key barrier: **no IDE vendor will share memory with competitors**, so the cross-tool reasoning layer must be a third-party product. Unfade is that product.

---

## Documentation Evolution Strategy

### What Exists Now

| Document | Purpose | Status |
|---|---|---|
| `docs/product/unfade.md` | Canonical product strategy — problem, research, architecture, competitive landscape, build sequencing | Complete |
| `docs/product/unfade_support.md` | Competitive analysis, theme scoring, gap analysis, growth strategy | Complete |
| `docs/architecture/VERTICAL_SLICING_PLAN.md` | This document — architectural triage, vertical slices, cross-cutting concerns | Complete |
| `docs/architecture/cli/PHASE_0_SCAFFOLDING.md` | Phase 0 tasks (UF-001 → UF-011b), tests (T-001 → T-013) | Complete |
| `docs/architecture/cli/PHASE_1_CAPTURE_AND_DISTILL.md` | Phase 1 tasks (UF-012 → UF-041, UF-086a/c/g), tests (T-012 → T-102), 7 micro-sprints (1A–1G), Zero-Knowledge UX integrated | Complete |
| `docs/architecture/cli/PHASE_2_HOOKS_API_AND_MCP.md` | Phase 2 tasks (UF-042 → UF-057, UF-086d/e), tests (T-103 → T-155), 5 micro-sprints (2A–2E), Zero-Knowledge UX integrated | Complete |
| `docs/architecture/cli/PHASE_3_CARDS_AND_TERMINAL.md` | Phase 3 tasks (UF-058 → UF-069), tests (T-156 → T-185), 4 micro-sprints (3A–3D), Go/TypeScript domain isolation | Complete |
| `docs/architecture/cli/PHASE_4_PERSONALIZATION_AND_AMPLIFICATION.md` | Phase 4 tasks (UF-070 → UF-079), tests (T-186 → T-210), 3 micro-sprints (4A–4C), algorithm/pipeline/UI isolation | Complete |
| `docs/architecture/cli/PHASE_5_ECOSYSTEM_LAUNCH.md` | Phase 5 tasks (UF-080 → UF-093, excl. UF-086), tests (T-211 → T-232), 4 micro-sprints (5A–5D), SSG/ecosystem/polish/launch isolation | Complete |
| `docs/architecture/cli/PHASE_6_POST_LAUNCH.md` | Phase 6 tasks (UF-094 → UF-097), tests (T-233 → T-246), 2 micro-sprints (6A–6B), implementation/specification isolation | Complete |
| `docs/architecture/cli/UNFADE_CLI_RESEARCH_AND_DESIGN.md` | Pattern extraction, design decisions, architecture rationale, file ownership map | Complete |

### What Needs to Be Written Next

| Document | Purpose | When Needed | Priority |
|---|---|---|---|
| **`docs/architecture/RFC_001_EVENT_SCHEMA.md`** | Formal specification of the CaptureEvent schema — field semantics, validation rules, versioning strategy, migration path | Before Slice 1 implementation begins | **Critical** |
| **`docs/architecture/RFC_002_DISTILLATION_PROMPTS.md`** | LLM prompt chain design for the distillation pipeline — prompt templates, few-shot examples, output schemas, quality evaluation criteria | Before Slice 2 implementation begins | **Critical** |
| **`docs/architecture/RFC_003_MCP_SERVER_SPEC.md`** | Complete MCP server specification — resource URIs, tool schemas, prompt templates, transport configuration, error handling, versioning | Before Slice 3 implementation begins | **Critical** |
| **`docs/architecture/RFC_004_PERSONALIZATION_MODEL.md`** | Reasoning model specification — how each dimension is computed, update rules, convergence behavior, cold-start handling, correction feedback loop | Before Slice 5 implementation begins | **High** |
| **`docs/architecture/RFC_005_AMPLIFICATION_MATCHING.md`** | Connection detection algorithm — matching rules, scoring, confidence thresholds, false positive prevention, feedback integration | Before Slice 5 implementation begins | **High** |
| **`docs/architecture/ADR_001_GO_DAEMON_HYBRID.md`** | Architecture Decision Record — why Go daemon + TypeScript CLI (hybrid architecture), RRVV analysis, cross-platform daemon mechanics, Rust extraction criteria | Before Slice 2 implementation begins | **Critical** |
| **`docs/architecture/ADR_002_CROSS_PLATFORM_DAEMON.md`** | Architecture Decision Record — launchd (macOS) vs systemd (Linux) vs Task Scheduler (Windows), named pipe vs Unix socket abstraction, PlatformManager design | Before Slice 2 implementation begins | **Critical** |
| **`docs/ecosystem/CLAWHUB_SKILL_GUIDE.md`** | Developer guide for building community skills on Unfade's MCP surface — tutorial, examples, best practices | Before Slice 5 ecosystem launch | **Medium** |
| **`docs/architecture/server/THINKING_GRAPH_SPEC.md`** | Thinking Graph renderer specification — static site architecture, component design, deployment targets, data flow from `.unfade/` | Before Thinking Graph implementation (Phase 5+) | **Low** |

### Documentation Principles

1. **RFCs before implementation.** Critical schemas (events, MCP, personalization model) must be specified before code is written. The schema is the contract — changing it after adoption is expensive.
2. **ADRs with the decision.** Architecture Decision Records for trade-off decisions (Go daemon vs. Node.js, cross-platform daemon mechanics) are written when the decision is made, with the reasoning and criteria for revisiting. The Go daemon hybrid architecture (ADR_001) and cross-platform daemon design (ADR_002) are decided upfront — they are structural decisions that shape every subsequent slice.
3. **Phase docs are living documents.** Task statuses (`[ ]` → `[x]`) are updated as implementation progresses. Phase docs are the implementation tracker, not just the plan.
4. **This document is the architectural north star.** When a phase doc or RFC conflicts with a slice definition here, this document takes precedence. Update this document when architectural decisions change.

---

> **The single-sentence architectural thesis:** Unfade is a local-first, plain-text reasoning substrate powered by an invisible Go daemon and a TypeScript intelligence layer, with a dual-protocol server (HTTP + MCP) that makes every AI tool aware of how you think — and the personalization engine at its core creates a temporal moat that no competitor can shortcut.

# Phase 1 — Capture Daemon & First Distill

> **Feature Statement:** _"A developer installs Unfade, works for a day, gets their first Daily Distill — and it doesn't just say 'you made 3 decisions today.' It says: 'you made 3 decisions today — you evaluated 2 alternatives for the first, 4 for the second, and accepted the AI's suggestion without evaluation for the third. Your exploration depth is emerging.' That single reframe — from activity reporting to reasoning reflection — is the moment the developer realizes this tool is different."_
>
> **Prerequisites:** [Phase 0 — Scaffolding](./PHASE_0_SCAFFOLDING.md) complete (build pipeline, schemas, CLI entry point, logger, paths)
>
> **Status:** AWAITING REVIEW
>
> **Inspired by:** Claude Code's `autoDream` memory consolidation, unerr-cli's state detector, Hermes agent's journal compression
>
> **Foundation doc:** [Research & Design](./UNFADE_CLI_RESEARCH_AND_DESIGN.md)
>
> **Last updated:** 2026-04-15

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan (Micro-Sprints 1A–1G)](#6-implementation-plan-micro-sprints-1a1g)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 1 delivers the **complete core loop**: install → capture → distill → personalization seed. This is the minimum product that proves Unfade is not another activity logger. The personalization seed in the first Daily Distill is the signal that tells the developer: "This is something no other tool does."

### 1.2 The Principle

> **The two highest-signal sources (git + AI sessions) with the least privacy concern, combined with the core differentiator (personalization seed), ship together. The first Distill must feel like Unfade, not DevDaily.**

### 1.3 Why Personalization Ships Here, Not Later

The competitive analysis reveals that 11 tools capture decisions and 5 MCP servers store memory — but zero learn how you think. If Unfade launches without personalization, it is one of 16 capture/memory tools. If it launches *with* personalization — even rough — it is the only tool in the market that feels like it's building an understanding of you. The personalization seed is the core differentiator that must be present from first contact.

---

## 2. The Problem

### Current State (after Phase 0)

A buildable, lintable, testable skeleton with schemas, logger, and path utilities — but no capture, no daemon, no distillation. `./dist/cli.js --help` shows command stubs. Nothing actually works.

### After Phase 1

| Concern | State |
|---|---|
| **Init** | `npx unfade` (bare command) detects first run → scaffolds `.unfade/`, fingerprints project, downloads capture engine binary, installs shell hooks (no confirmation prompt), installs platform auto-start (launchd/systemd/Task Scheduler), starts daemon + web server, triggers git backfill, **triggers immediate first distill from backfill data** (no LLM prompt — defaults to Ollama if available, structured summaries if not), shows TUI dashboard with first distill result |
| **Capture — Git** | Real-time git watcher: commits, diffs, branch switches, reverts, stashes, merge conflicts → structured events |
| **Capture — AI Sessions** | AI session log reader: scans `~/.cursor/logs/`, `~/.claude/sessions/` for conversation transcripts → reasoning events |
| **Event Storage** | Append-only JSONL at `.unfade/events/YYYY-MM-DD.jsonl` — plain text, inspectable, greppable |
| **Daemon** | Go binary (`unfaded`) — background process with PID lock, Unix socket IPC (macOS/Linux) / named pipe (Windows), graceful shutdown, resource budget (<50MB RAM, <1% CPU idle). Downloaded during `unfade init`, auto-starts on login via platform manager |
| **Distillation** | LLM synthesis of the day's reasoning: Decisions Made, Trade-offs Navigated, Dead Ends Explored, Breakthroughs |
| **Personalization Seed** | PATTERNS section in distill: alternatives evaluated per decision, domain distribution, AI acceptance rate |
| **Backfill** | `unfade distill --backfill 7` retroactively distills past days from git history |
| **Self-Healing State** | Every `unfade` invocation checks daemon health, shell hook status, auto-start registration — silently fixes any issues before showing TUI |
| **TUI Dashboard** | `unfade` (no args) shows: capture engine status, today's distill summary, personalization level, quick actions `[d]istill now [c]ard [o]pen web [s]earch [e]xport [q]uit` |
| **Web UI** | `unfade open` opens web UI in browser (localhost:7654) |
| **Notification** | "Your Unfade is ready" system notification when distillation completes — click opens web UI distill viewer |
| **Terminology** | All user-facing strings use "capture engine" not "daemon" — "daemon" is reserved for code, logs, and developer docs |

---

## 3. Research

### 3.1 Daemon Architecture Patterns

| Pattern | Claude Code | unerr-cli | Unfade Choice | Rationale |
|---|---|---|---|---|
| **Daemon model** | `--daemon-worker` flag, supervisor process | MCP proxy starts on client connect | Independent background daemon, always-on | Passive capture requires daemon running even when CLI is not |
| **PID management** | `proper-lockfile` | Custom PID in `.unerr/state/` | PID file + `proper-lockfile` | Single-instance guarantee, stale PID detection |
| **IPC** | — | — | Unix domain socket (macOS/Linux) + named pipe (Windows), handled by Go daemon | Low-overhead, no port conflicts, secure by default |
| **Process lifecycle** | Background sessions (`--bg`, `ps`, `logs`, `attach`, `kill`) | — | Auto-start on login (launchd/systemd/Task Scheduler), `daemon stop` power user command, status shown in TUI dashboard | Always-on via platform manager, minimal CLI surface |
| **Resource budget** | — | — | <50MB RAM, <1% CPU idle | Daemon must be invisible to developer |

### 3.2 Capture Source Patterns

| Pattern | Claude Code | unerr-cli | Unfade Choice | Rationale |
|---|---|---|---|---|
| **File watching** | chokidar ^4.0 | chokidar ^4.0 | `fsnotify` (Go, in daemon) | Go daemon handles all file watching; cross-platform, no Node.js dependency at runtime |
| **Git operations** | — | isomorphic-git | simple-git | Wraps system `git` binary — faster, lower memory, reads history/diffs/branches |
| **Event format** | — | — | Structured JSONL with `CaptureEventSchema` (Zod) | Type-safe, append-only, human-readable |
| **Auto-save filtering** | — | chokidar with noise filtering | Debounce + ignore patterns | Prevent event spam from auto-save |

### 3.3 Distillation Patterns

| Pattern | Claude Code | unerr-cli | Unfade Choice | Rationale |
|---|---|---|---|---|
| **Memory consolidation** | `autoDream/` — 24-hour cycle, forked subagent, prompt caching | — | Scheduled daemon task with LLM prompt chain | Runs within daemon process, not forked subagent |
| **LLM integration** | Anthropic SDK | — | Ollama (default) + OpenAI-compatible API | Local-first, provider-agnostic |
| **Fallback** | — | Graceful degradation (cloud down → local) | No LLM → structured signal summary without synthesis | Never block core functionality |
| **Output format** | Markdown memory files in `.claude/` | — | Markdown distill in `.unfade/distills/YYYY-MM-DD.md` | Plain text, inspectable, greppable |

---

## 4. Architecture

### 4.1 Process Model

```
┌──────────────────────────────────────────────────────────────────┐
│                      Unfade Process Model                        │
│                                                                  │
│  ┌──────────────────┐         ┌─────────────────────────────┐   │
│  │  unfade CLI (TS)  │  socket │  unfaded (Go daemon binary)  │   │
│  │  (user commands)  │◄───────►│                              │   │
│  │                   │         │  ┌──────────┐ ┌───────────┐ │   │
│  │  unfade (TUI)     │         │  │ Git      │ │ AI Session│ │   │
│  │  unfade init      │         │  │ Watcher  │ │ Reader    │ │   │
│  │  unfade distill   │         │  │(fsnotify)│ │           │ │   │
│  │  unfade open      │         │  ├──────────┤ ├───────────┤ │   │
│  │  unfade daemon    │         │  │ Event    │ │ Scheduler │ │   │
│  │    stop           │         │  │ Store    │ │ (distill) │ │   │
│  └──────────────────┘         │  └──────────┘ └───────────┘ │   │
│                                │                              │   │
│                                │  ┌────────────────────────┐ │   │
│                                │  │ .unfade/ data store     │ │   │
│                                │  │  events/ distills/      │ │   │
│                                │  │  profile/ state/        │ │   │
│                                │  └────────────────────────┘ │   │
│                                └─────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Platform Auto-Start                                      │   │
│  │  macOS: launchd  │  Linux: systemd  │  Windows: Task Sch. │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Event Flow

```
Git commit / AI session change
        │
        ▼
┌──────────────────┐
│ CaptureSource    │  (Go daemon: capture/git.go, capture/ai_session.go)
│ .Start(onEvent)  │  file watching via fsnotify
└────────┬─────────┘
         │ CaptureEvent
         ▼
┌──────────────────┐
│ EventStore       │  (Go daemon: capture/event_store.go)
│ .Append(event)   │  → .unfade/events/YYYY-MM-DD.jsonl
└────────┬─────────┘
         │ (on schedule or manual trigger)
         ▼
┌──────────────────┐
│ Distiller        │  (distiller.ts)
│ extract → link   │
│ → synthesize     │  → .unfade/distills/YYYY-MM-DD.md
│ → personalize    │  → .unfade/profile/reasoning_model.json
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Notifier         │  "Your Unfade is ready"
└──────────────────┘
```

### 4.3 Git Signal Parser — Event Types

| Git Event | How Detected | CaptureEvent Type | What It Captures |
|---|---|---|---|
| **Commit** | `.git/` HEAD change → `simple-git` log | `commit` | Message, files changed, diff summary, branch |
| **Diff** | Pre-commit working tree diff | `diff` | Changed lines, file list |
| **Branch switch** | HEAD ref change | `branch-switch` | From branch, to branch |
| **Revert** | Revert commit message pattern | `revert` | Reverted commit hash, reason |
| **Stash** | Stash ref change | `stash` | Stashed files |
| **Merge conflict** | Conflict markers in working tree | `merge-conflict` | Conflicting files, branches |

### 4.4 AI Session Parser — Event Types

| AI Event | Source | CaptureEvent Type | What It Captures |
|---|---|---|---|
| **Conversation** | Cursor logs, Claude Code sessions | `ai-conversation` | Question asked, context provided |
| **Completion** | AI response accepted | `ai-completion` | What was accepted, modifications made |
| **Rejection** | AI response rejected/modified | `ai-rejection` | What was rejected, why (if captured) |

### 4.5 Daily Distill Structure

```markdown
# Daily Distill — 2026-04-14

## Decisions Made
- **Decision 1:** Chose Redis over Memcached for session caching
  - Alternatives evaluated: Redis, Memcached, in-memory Map
  - Reasoning: Redis persistence + pub/sub for cache invalidation
  - Files: src/services/cache.ts, config/redis.ts

## Trade-offs Navigated
- **Performance vs. Simplicity:** Accepted O(n) scan over adding index for <1000 items

## Dead Ends Explored
- **Tried:** Custom WebSocket auth middleware
  - **Abandoned because:** express-ws handles this natively
  - **Time spent:** ~40 minutes

## Breakthroughs
- **Insight:** JWT refresh can be handled in middleware, not per-route

## Patterns (Personalization Seed)
- Alternatives evaluated per decision: 3.0 (this session)
- Domains touched: backend infrastructure, authentication
- AI acceptance rate: 60% (modified 2 of 5 suggestions)
- Exploration depth: spent 2.1x longer on infrastructure than auth decisions
```

### 4.6 Personalization Seed — `reasoning_model.json`

```typescript
// .unfade/profile/reasoning_model.json
interface ReasoningModel {
  version: 1;
  lastUpdated: string; // ISO datetime

  decisionStyle: {
    avgAlternativesEvaluated: number;   // Running average
    explorationDepthByDomain: Record<string, number>; // minutes per domain
    aiAcceptanceRate: number;           // 0-1, running average
    aiModificationRate: number;         // 0-1, running average
  };

  domainDistribution: {
    domain: string;
    frequency: number;    // Count of decisions
    lastSeen: string;     // ISO date
    depth: 'shallow' | 'moderate' | 'deep';
  }[];

  patterns: {
    pattern: string;      // Human-readable description
    confidence: number;   // 0-1
    observedSince: string; // ISO date
    examples: number;     // Count of supporting observations
  }[];
}
```

---

## 5. Design Principles

1. **Daemon is invisible.** The developer should forget the daemon exists until the Daily Distill arrives. <50MB RAM, <1% CPU idle, no terminal output, no prompts.

2. **Events are append-only.** JSONL files are never modified after write. Backfill adds events, distillation reads events. No event is ever deleted or mutated.

3. **Capture is modular.** Each source (git, ai-session, terminal, browser) implements `CaptureSource` interface independently. Adding a new source never touches existing sources.

4. **Distillation is idempotent.** Running `unfade distill` twice for the same day overwrites the distill file. No side effects beyond file write.

5. **Personalization is transparent.** Every pattern observation includes confidence level and supporting example count. The developer can inspect `reasoning_model.json` directly.

6. **Backfill is the cold-start solution.** Users shouldn't wait a day to see value. `unfade init` backfills 30 days of git history. `unfade distill --backfill 7` retroactively distills past days.

7. **Graceful degradation is mandatory.** No LLM → structured summary. No git → AI session only. No AI sessions → git only. No daemon → CLI reads files directly.

### 5.1 File Tree — TypeScript CLI (`src/`)

```
src/
├── commands/
│   ├── init.ts              # Expanded: scaffold + fingerprint + daemon download + shell hooks + auto-start + start
│   ├── distill.ts
│   ├── daemon.ts            # Only `stop` subcommand (power user)
│   └── open.ts              # Open web UI in browser (localhost:7654)
├── tui/
│   └── dashboard.tsx        # TUI dashboard — `unfade` with no args
├── components/
│   ├── InitWizard.tsx        # 5-step init wizard (scaffold, fingerprint, daemon, shell, start)
│   ├── DashboardView.tsx     # Daemon status, distill summary, personalization level, quick actions
│   └── DistillView.tsx
├── services/
│   ├── capture/
│   │   ├── event-store.ts    # Read-side: reads JSONL events written by Go daemon
│   │   ├── sources/
│   │   │   └── git.ts        # Read-only client for git events (Go daemon does actual watching)
│   │   └── watcher.ts        # Orchestrator stub — delegates to Go daemon via IPC
│   ├── daemon/
│   │   └── binary.ts         # Download + verify Go daemon binary (platform-specific)
│   ├── shell/
│   │   └── installer.ts      # Detect shell (bash/zsh/fish), install capture hooks
│   ├── distill/
│   │   ├── providers/
│   │   │   ├── types.ts
│   │   │   └── ai.ts        # Vercel AI SDK integration (generateObject + provider adapters)
│   │   ├── signal-extractor.ts
│   │   ├── context-linker.ts
│   │   ├── synthesizer.ts
│   │   └── distiller.ts
│   ├── scheduler/
│   │   └── scheduler.ts
│   ├── notification/
│   │   └── notifier.ts
│   └── personalization/
│       └── profile-builder.ts
├── config/
│   ├── manager.ts
│   └── defaults.ts
├── state/
│   └── detector.ts
└── utils/
    ├── ipc.ts                # IPC client (TypeScript side — connects to Go daemon socket)
    └── logger.ts
```

### 5.2 File Tree — Go Daemon (`daemon/`)

```
daemon/
├── main.go                   # Entry point — starts capture sources, IPC server, health reporter
├── capture/
│   ├── git.go                # Git watcher via fsnotify + os/exec to system git, backfill support
│   ├── ai_session.go         # AI session log scanner (Cursor, Claude Code)
│   ├── event_store.go        # Append CaptureEvent to daily JSONL files
│   └── watcher.go            # Orchestrates capture sources, routes events
├── platform/
│   ├── pid.go                # PID file management (create, check, stale detection, cleanup)
│   ├── ipc.go                # IPC server: Unix socket (macOS/Linux), named pipe (Windows)
│   └── logger.go             # Structured logging + log rotation (>10MB, keep 3)
└── health/
    ├── reporter.go           # Health reporting: uptime, memory, CPU, event rates
    └── budget.go             # Resource budget enforcement (<50MB RSS, <1% CPU idle)
```

---

## 6. Implementation Plan (Micro-Sprints 1A–1G)

> **Execution model:** Each micro-sprint contains max 4–5 tasks. Each sprint has its own Objective, Acid Test, Task table, Agent Directive, and Strict Contracts. Sprints are sequential — each sprint's acid test must pass before starting the next.
>
> **Zero-Knowledge UX integration:** Changes from the [Zero-Knowledge UX Plan](./ZERO_KNOWLEDGE_UX_PLAN.md) are integrated directly into the relevant sprints. New tasks (UF-086a through UF-086g) are woven into the sprint where they naturally belong, not bolted on at the end.
>
> **IPC boundary (the ONE rule that governs the entire system):**
>
> ```
> Go daemon WRITES to:    .unfade/events/YYYY-MM-DD.jsonl  (O_APPEND, <4KB per write)
>                          .unfade/state/daemon.pid
>                          .unfade/state/health.json       (atomic: tmp + rename)
>                          ~/.unfade/state/daemon.sock     (Unix socket listener)
>
> TypeScript READS from:  .unfade/events/YYYY-MM-DD.jsonl  (tolerates partial last line)
>                          .unfade/state/daemon.pid         (PID existence check)
>                          .unfade/state/health.json        (status display)
>
> TypeScript WRITES to:   .unfade/config.json              (atomic: tmp + rename)
>                          .unfade/distills/YYYY-MM-DD.md
>                          .unfade/graph/decisions.jsonl
>                          .unfade/graph/domains.json
>                          .unfade/profile/reasoning_model.json
>                          .unfade/state/server.json        (atomic: tmp + rename)
>                          .unfade/state/init_progress.json
>                          ~/.unfade/state/repos.json
> ```

---

### 6.1 Sprint 1A — TypeScript Foundation

**Objective:** Config, state detection, event reading, and terminology constants — the infrastructure every subsequent sprint depends on.

**Acid Test:**
```bash
pnpm test -- --grep "config|state|event-store|terminology"
# All tests pass

# In code:
import { loadConfig } from './config/manager'
const config = loadConfig()          # → valid UnfadeConfig with defaults
detectState()                        # → 'not_initialized' (no .unfade/)
readEvents('2026-04-14')             # → [] (no events yet)
USER_TERMS.daemon                    # → 'capture engine'
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-012** | Config manager: load from env → user (`~/.unfade/config.json`) → project (`.unfade/config.json`), merge with defaults, Zod-validate. Empty input → valid config with all defaults | `src/config/manager.ts`, `src/config/defaults.ts` | [ ] |
| **UF-013** | State detector with self-healing: check init status, daemon PID (alive?), shell hook status (installed?), auto-start registration (present?), LLM availability, git repo, pending distill — return most actionable state. **Self-healing:** silently fix any repairable issues (restart daemon, reinstall hooks, re-register auto-start) before returning state. _(Integrates UF-086b from Zero-Knowledge UX Plan)_ | `src/state/detector.ts` | [ ] |
| **UF-014** | Event store (TypeScript read-side): read `CaptureEvent` from daily JSONL files, read events by date range, count events per day. Tolerates partial last lines (daemon may be mid-write). _Write-side lives in Go daemon_ | `src/services/capture/event-store.ts` | [ ] |
| **UF-086g** | User-facing terminology constants: define `USER_TERMS` map — `daemon` → `capture engine`, `daemon running` → `Capturing`, `daemon stopped` → `Capture paused`, `daemon crashed` → `Capture engine stopped unexpectedly`. All user-facing strings in subsequent sprints import from this module. "Daemon" remains in code identifiers, logs, and developer docs | `src/constants/terminology.ts` | [ ] |

**Agent Directive (Sprint 1A):**

> "Build 4 modules. (1) `src/config/manager.ts`: export `loadConfig()` that reads env vars → `~/.unfade/config.json` → `.unfade/config.json`, deep-merges with defaults from `src/config/defaults.ts`, Zod-validates against `UnfadeConfigSchema`. Return validated config. Throw on invalid config. (2) `src/state/detector.ts`: export `detectState()` that checks in order: `.unfade/` exists? → PID file exists and process alive? → shell hooks in `.zshrc`/`.bashrc`? → auto-start plist/unit registered? → LLM available? → git repo? → events exist but no distill? For each failed check, attempt silent repair (restart daemon via IPC, reinstall hooks, re-register auto-start). Return enum: `not_initialized | initialized | daemon_running | daemon_stopped | no_llm | no_git | first_distill_pending`. (3) `src/services/capture/event-store.ts`: export `readEvents(date: string): CaptureEvent[]` that reads `.unfade/events/YYYY-MM-DD.jsonl`, parses each line, skips malformed lines (tolerates partial last line). Export `countEvents(date: string): number` and `readEventRange(from: string, to: string): CaptureEvent[]`. (4) `src/constants/terminology.ts`: export `USER_TERMS` object mapping internal terms to user-facing strings. All user-facing output in the project must use these constants."

**Strict Contracts:**
- Config manager MUST produce valid config from empty input (all defaults)
- State detector MUST attempt self-healing before returning degraded state
- Event store MUST tolerate partial last line (daemon may be mid-write) — never throw on read
- `USER_TERMS` is the single source of truth for user-facing terminology

---

### 6.2 Sprint 1B — Go Daemon Core

**Objective:** A running Go daemon with PID management, IPC server, health reporting, log rotation, and resource budgets. No capture sources yet — just the shell.

**Acid Test:**
```bash
cd daemon && go build ./cmd/unfaded && go build ./cmd/unfade-send
./unfaded --project-dir /tmp/test-unfade &
# PID file created at ~/.unfade/state/daemon.pid
# Unix socket listening at ~/.unfade/state/daemon.sock
# health.json written every 30 seconds

cat ~/.unfade/state/health.json     # → valid JSON with status, pid, uptime
echo '{"cmd":"status"}' | nc -U ~/.unfade/state/daemon.sock  # → health response
kill $(cat ~/.unfade/state/daemon.pid)  # → graceful shutdown, PID file removed
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-022** | PID file management (Go daemon): create PID file on daemon start with flock, check for existing daemon, remove on shutdown, detect and clean stale PIDs (process no longer running) | `daemon/platform/pid.go` | [ ] |
| **UF-023** | IPC server (Go daemon) + IPC client (TypeScript): Unix domain socket (macOS/Linux) / named pipe (Windows) for CLI ↔ daemon communication — status queries, manual distill triggers, shutdown signals. TypeScript client connects and sends JSON commands | `daemon/platform/ipc.go`, `src/utils/ipc.ts` (client only) | [ ] |
| **UF-024** | Daemon process lifecycle (Go daemon): main loop, register signal handlers (SIGTERM, SIGINT), graceful shutdown sequence (flush pending events, remove PID, close socket), health reporting to `health.json` every 30 seconds. Auto-restart handled by platform manager, not daemon | `daemon/main.go`, `daemon/health/reporter.go` | [ ] |
| **UF-027** | Daemon log rotation (Go daemon): structured logging to `daemon.log`, rotate when >10MB, keep last 3 rotated files | `daemon/platform/logger.go` | [ ] |
| **UF-028** | Resource budget enforcement (Go daemon): monitor RSS memory and CPU usage, log warning if exceeding budget (<50MB RAM, <1% CPU idle), reduce watcher frequency if necessary | `daemon/health/budget.go` | [ ] |

**Agent Directive (Sprint 1B):**

> "Build the Go daemon shell at `daemon/cmd/unfaded/main.go`. The daemon does 4 things at startup: (1) Acquires flock on `~/.unfade/state/daemon.pid`, writes PID — exit if another instance holds the lock. (2) Starts IPC server on Unix socket at `~/.unfade/state/daemon.sock` — accepts JSON-line commands (`status`, `stop`, `distill`), responds with JSON. (3) Starts health reporter goroutine — writes `health.json` (status, pid, uptime_seconds, memory_mb, version) every 30 seconds via atomic tmp+rename. (4) Registers SIGTERM/SIGINT handlers — on signal: flush pending writes, remove PID file, close socket, exit 0. Build `daemon/platform/pid.go` for PID file create/check/remove/stale-detect. Build `daemon/platform/ipc.go` for Unix socket server. Build `daemon/health/reporter.go` for health JSON writing. Build `daemon/health/budget.go` for RSS/CPU monitoring with configurable thresholds. Build `daemon/platform/logger.go` for structured stderr logging + file rotation (>10MB, keep 3). Build `src/utils/ipc.ts` — TypeScript IPC client that connects to daemon socket, sends JSON command, reads JSON response. Handle connection refused gracefully (daemon not running)."

**Strict Contracts:**
- PID file uses `flock` — not just write-and-check
- IPC protocol: one JSON line per request, one JSON line per response, then close connection
- Health reporting: atomic write via tmp file + rename — never partial JSON
- Resource budget: log warning only, never kill self — let platform manager handle restarts
- Go daemon entry point: `daemon/cmd/unfaded/main.go` (not `daemon/main.go`)

**health.json schema (written by Go daemon):**
```json
{
  "status": "running",
  "pid": 42813,
  "uptime_seconds": 22320,
  "watchers": { "git": [], "ai_session": [] },
  "events_today": 0,
  "memory_mb": 11.2,
  "version": "0.1.0"
}
```

---

### 6.3 Sprint 1C — Capture Sources

**Objective:** Git and AI session events flowing into `.unfade/events/`. The daemon watches `.git/` for commits and tails AI session logs.

**Acid Test:**
```bash
# Start daemon with a git repo registered
./unfaded --project-dir /path/to/repo &

# Make a git commit in the repo
cd /path/to/repo && git commit --allow-empty -m "test commit"
sleep 2
cat .unfade/events/$(date +%Y-%m-%d).jsonl
# → JSON line with source:"git", type:"commit", content.summary:"test commit"

# Verify AI session detection (if Cursor/Claude Code logs exist)
ls ~/.cursor/logs/ 2>/dev/null && cat .unfade/events/$(date +%Y-%m-%d).jsonl | grep ai-session
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-015** | Git capture source (Go daemon): implement `CaptureSource` interface — watch `.git/` HEAD changes via `fsnotify`, parse commits by shelling out to system `git` via `os/exec`, extract structured events (commit, branch-switch, revert, stash, merge-conflict). Debounce rapid changes (auto-save noise filtering). _TypeScript side has read-only client_ | `daemon/capture/git.go`, `src/services/capture/sources/git.ts` (read-only client) | [ ] |
| **UF-016** | Git backfill: `backfill(since time.Time)` — parse last 30 days of git log into CaptureEvents, write to daily JSONL files progressively. _Triggered via IPC from `unfade init`_ | `daemon/capture/git.go` | [ ] |
| **UF-017** | Watcher orchestrator (Go daemon): manage active capture sources, start/stop lifecycle, route events from all sources to single EventWriter goroutine. EventWriter appends to `.unfade/events/YYYY-MM-DD.jsonl` using `O_APPEND` | `daemon/capture/watcher.go` | [ ] |
| **UF-025** | AI session capture source (Go daemon): implement `CaptureSource` — scan Cursor logs (`~/.cursor/logs/`), Claude Code sessions (`~/.claude/sessions/`), parse conversations into reasoning events (ai-conversation, ai-completion, ai-rejection), detect format changes gracefully, handle missing/empty directories | `daemon/capture/ai_session.go` | [ ] |

**Agent Directive (Sprint 1C):**

> "Build 4 Go packages in the daemon. (1) `daemon/capture/git.go`: GitWatcher struct implementing CaptureSource interface. On start: register fsnotify watcher on `.git/` directory. On `.git/HEAD` or `.git/refs/` change: debounce 500ms, then shell out to `git log -1 --format='%H|%s|%an|%ae|%ai'` via os/exec. Parse output into CaptureEvent with source:'git', type:'commit'. Detect branch switches (HEAD ref change), reverts (commit message pattern), stashes (stash ref change). Export `Backfill(since time.Time, eventCh chan<- CaptureEvent)` that walks `git log --after=<since>` and emits events for each commit. (2) `daemon/capture/watcher.go`: WatcherOrchestrator that starts GitWatcher + AISessionWatcher, collects events from all source channels into a single EventWriter goroutine. EventWriter opens daily JSONL file with O_APPEND, writes one JSON line per event, flushes after each write. (3) `daemon/capture/ai_session.go`: AISessionWatcher that tails known log directories. For Cursor: watch `~/.cursor/logs/` for new log files, parse JSON entries for conversation/completion/rejection patterns. For Claude Code: watch `~/.claude/sessions/` or `~/.claude/projects/` for JSONL session files. Gracefully skip directories that don't exist. (4) `src/services/capture/sources/git.ts`: thin TypeScript read-only client — just re-exports event reading from event-store.ts filtered by source:'git'. No watching logic."

**Strict Contracts:**
- All event writes use `O_APPEND` — concurrent-safe, no file locking needed
- Each JSON line < 4KB — large diffs are truncated in `content.detail`
- Debounce git events by 500ms — prevent spam from rapid commits
- AI session parser MUST handle unknown log formats gracefully (skip + log warning, never crash)
- Backfill writes to the same `events/YYYY-MM-DD.jsonl` files as live capture

**Terminal event JSON (shell hook → unfade-send → daemon socket):**
```json
{
  "cmd": "npm test",
  "exit": 0,
  "duration": 12,
  "cwd": "/Users/dev/project"
}
```

---

### 6.4 Sprint 1D — Init Command + Shell Hooks

**Objective:** `npx unfade` on a fresh repo scaffolds everything, starts daemon, triggers backfill, and produces an immediate first distill from backfill data. Zero-Knowledge UX: no LLM prompt, no confirmation prompts, "capture engine" terminology in all output.

**Acid Test:**
```bash
cd /path/to/git-repo-with-history
npx unfade
# → "Welcome to Unfade" banner
# → ✓ Created .unfade/ directory
# → ✓ Downloaded capture engine
# → ✓ Installed shell hooks (zsh)
# → ✓ Registered auto-start (launchd)
# → ✓ Started capture engine
# → ✓ Backfilling 30 days of git history...
# → ✓ Generating your first reasoning summary...
# → TUI dashboard appears with first distill result

ls .unfade/events/                  # → JSONL files from backfill
ls .unfade/distills/                # → at least one .md file (first distill)
cat .unfade/state/daemon.pid        # → valid PID of running daemon
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-018** | `unfade init` command (zero-knowledge, 8-step): (1) scaffold `.unfade/` directory tree + `config.json` with defaults + add `.unfade/` to `.git/info/exclude`, (2) fingerprint project via simple-git, (3) download + verify Go daemon binary (`unfaded` + `unfade-send` to `.unfade/bin/`), (4) detect shell and install shell hooks (NO confirmation prompt — inform with single line: "Installed shell hooks for command capture. Disable anytime: unfade open → Settings"), (5) install platform auto-start (launchd plist/systemd unit/Task Scheduler), (6) detect LLM silently (Ollama if `ollama list` succeeds, else no-LLM mode — NO prompt for API keys), (7) start daemon + web server, register repo in `~/.unfade/state/repos.json`, (8) trigger git backfill via IPC. Track progress in `init_progress.json`. Each step idempotent. Only step 1 is fatal. Display: "capture engine" not "daemon" in all output | `src/commands/init.ts`, `src/services/daemon/binary.ts`, `src/services/shell/installer.ts` | [ ] |
| **UF-020** | InitWizard Ink component: 8-step first-run UX flow with progress indicators. Uses `USER_TERMS` from terminology constants. Exit message: "Unfade is running. Your first distill arrives at 6:00 PM. Open your dashboard: `unfade` (terminal) / `unfade open` (browser)" | `src/components/InitWizard.tsx` | [ ] |
| **UF-086a** | Immediate first distill: after backfill completes in init flow, call distiller for the most recent day with events. If no LLM configured, produce structured signal summary (decision count, files changed, domains, time invested). Display result in TUI dashboard. Show progress: "Generating your first reasoning summary..." with spinner. _(From Zero-Knowledge UX Plan)_ | `src/commands/init.ts`, `src/services/distill/distiller.ts` | [ ] |
| **UF-026** | `unfade daemon` command: only `stop` subcommand (SIGTERM via PID, power user command). Not shown in primary help — listed under `unfade --help-all` or similar. Daemon start is handled by init + platform auto-start. Status shown in TUI dashboard | `src/commands/daemon.ts` | [ ] |

**Agent Directive (Sprint 1D):**

> "Build `src/commands/init.ts` with zero-knowledge UX. The command executes 8 steps sequentially, each idempotent. Track progress in `.unfade/state/init_progress.json` — on re-run, skip completed steps. Step 1 (scaffold): create `.unfade/` directory tree (events/, distills/, graph/, profile/, state/, cache/, logs/, bin/) + `config.json` with defaults + add `.unfade/` to `.git/info/exclude`. Step 2 (fingerprint): walk git log with simple-git, compute domain distribution and initial reasoning model seed, write to `profile/reasoning_model.json`. Step 3 (download): resolve `unfaded` + `unfade-send` binaries from `@unfade/daemon-{platform}-{arch}` optional dep, copy to `.unfade/bin/`, verify checksum. Step 4 (shell hooks): detect shell (zsh/bash/fish), append preexec/precmd hooks to rc file WITHOUT asking for confirmation. Print single info line: 'Installed shell hooks for command capture. Disable anytime: unfade open → Settings'. Step 5 (auto-start): generate launchd plist (macOS) / systemd unit (Linux) / Task Scheduler entry (Windows), install it. Step 6 (LLM detect): try `ollama list` — if succeeds, set provider to ollama in config. If fails, set provider to 'none' (structured summaries mode). NEVER prompt for API keys. Step 7 (start): spawn `unfaded`, register repo in `~/.unfade/state/repos.json`. Step 8 (backfill): send backfill command via IPC, show progress bar. After backfill, trigger immediate first distill (UF-086a): call distiller for the most recent day with events, display result when ready. Build `src/components/InitWizard.tsx` — Ink component rendering each step with ✓/✗/spinner. All user-facing text uses `USER_TERMS` constants. Build `src/commands/daemon.ts` with only `stop` subcommand."

**Shell hook template (zsh):**
```bash
unfade_preexec() {
  _unfade_cmd="$1"
  _unfade_cmd_start=$(date +%s)
}
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

**Strict Contracts:**
- Init MUST NOT prompt for LLM provider or API keys — silent detection only
- Shell hooks installed WITHOUT confirmation — inform, don't ask
- All user-facing output uses `USER_TERMS` — "capture engine" not "daemon", "Capturing" not "Daemon running"
- Immediate first distill runs async — show TUI immediately with "generating..." placeholder, update when ready
- Each init step is idempotent — re-running `unfade` after partial init resumes from last completed step

---

### 6.5 Sprint 1E — Distillation Pipeline

**Objective:** Three-stage pipeline (extract → link → synthesize) that produces Daily Distill markdown from events. Fallback mode when no LLM available.

**Acid Test:**
```bash
# Given events exist in .unfade/events/2026-04-14.jsonl
node -e "
  const { distill } = await import('./dist/services/distill/distiller.js');
  const result = await distill('2026-04-14');
  console.log(result);
"
# → .unfade/distills/2026-04-14.md exists with Decisions, Trade-offs, Dead Ends, Breakthroughs, Patterns sections

# Without LLM:
UNFADE_LLM_PROVIDER=none node -e "..."
# → .unfade/distills/2026-04-14.md exists with structured signal summary (no AI synthesis)
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-029** | LLM integration via Vercel AI SDK: configure provider adapters (`ai-sdk-ollama` default, `@ai-sdk/openai`, `@ai-sdk/anthropic`), implement `generateObject()` calls with Zod schemas for structured output (DailyDistill, Decision[]), provider selection from config with `--provider` override. Ollama readiness check: 3-step (version API → model list → test prompt with 5s timeout) | `src/services/distill/providers/ai.ts` | [ ] |
| **UF-032** | Signal extractor (Stage 1): parse day's JSONL events into structured reasoning signals — decisions (with alternatives count from branch/merge patterns), trade-offs (from AI rejection events), dead ends (reverts + time spent), breakthroughs. Skip malformed lines. No LLM | `src/services/distill/signal-extractor.ts` | [ ] |
| **UF-033** | Context linker (Stage 2): cross-reference extracted signals to git context — which files, which branch, which project, related commits. Find AI conversation about same file as commit. Build temporal chains (sequential commits on same module). No LLM | `src/services/distill/context-linker.ts` | [ ] |
| **UF-034** | Synthesizer (Stage 3): LLM prompt chain that takes linked signals → Daily Distill markdown with Decisions, Trade-offs, Dead Ends, Breakthroughs, Patterns sections. Uses `generateObject()` with Zod schemas | `src/services/distill/synthesizer.ts` | [ ] |
| **UF-039** | Fallback synthesizer: when no LLM is available (`provider: 'none'`), produce structured signal summary — decision count, files changed, domains touched, time invested, AI acceptance rate — without AI synthesis. Output is still valid Daily Distill markdown, just less narrative | `src/services/distill/synthesizer.ts` | [ ] |

**Agent Directive (Sprint 1E):**

> "Build the 3-stage distillation pipeline. (1) `src/services/distill/providers/ai.ts`: export `createLLMProvider(config)` that returns a Vercel AI SDK provider. Support `ai-sdk-ollama` (default), `@ai-sdk/openai`, `@ai-sdk/anthropic`. Export `checkOllamaReady(): Promise<{ready: boolean, reason?: string}>` — 3-step check: GET `http://localhost:11434/api/version` (running?), GET `/api/tags` (model available?), POST `/api/generate` with trivial prompt + 5s timeout (responsive?). All failures return `{ready: false, reason: '...'}`. (2) `src/services/distill/signal-extractor.ts`: export `extractSignals(events: CaptureEvent[]): ExtractedSignals`. Classify events: commits with multiple branch refs → decision candidates (count alternatives from branches), AI rejections → trade-offs, reverts → dead ends (compute time spent from timestamps), rapid commits with fix messages → debugging sessions. (3) `src/services/distill/context-linker.ts`: export `linkContext(signals: ExtractedSignals, events: CaptureEvent[]): LinkedSignals`. Attach git context (files, branch, repo), find AI conversations referencing same files as commits, build temporal chains. (4) `src/services/distill/synthesizer.ts`: export `synthesize(linked: LinkedSignals, provider): Promise<DailyDistill>`. If LLM available: build structured prompt, call `generateObject()` with `DailyDistillSchema`, return result. If no LLM (fallback): compute structured summary — decision count, file list, domain tags from file paths, time estimates, AI acceptance rate from ai-completion/ai-rejection counts. Both paths produce valid DailyDistill markdown."

**Strict Contracts:**
- Vercel AI SDK only — no custom LLMProvider interface
- `generateObject()` with Zod schemas — structured output, not string parsing
- Fallback synthesizer MUST produce valid Daily Distill markdown — same file format, less narrative
- Ollama readiness check: 5-second timeout on test prompt — never block init
- Signal extractor: skip malformed event lines, never throw

**LLM integration pattern:**
```typescript
import { generateObject } from 'ai';
import { ollama } from 'ai-sdk-ollama';
// Provider selection from config: ollama (default), openai, anthropic
// Structured output via generateObject() + Zod schemas (DailyDistill, Decision[])
```

---

### 6.6 Sprint 1F — Distill Command, Scheduling & Notification

**Objective:** Manual and scheduled distillation with system notifications and personalization seed. The habit loop is complete: events accumulate → scheduled distill fires → notification pulls user back.

**Acid Test:**
```bash
unfade distill                      # → triggers distillation, displays result
unfade distill --backfill 7         # → processes 7 past days, throttled 1 per 10s
unfade distill --date 2026-04-10   # → distills specific date

# After distill completes:
# → system notification "Your Unfade is ready — 3 decisions, 1 dead end explored"
# → clicking notification opens localhost:7654 in browser

cat .unfade/profile/reasoning_model.json
# → updated with latest personalization patterns
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-035** | Distiller orchestrator: pipeline of extract → link → synthesize → write distill → update profile → notify. Handles backfill mode (multiple past dates, throttled 1 per 10 seconds). Handles no-activity days (skip, don't generate empty distill). Idempotent — running twice overwrites | `src/services/distill/distiller.ts` | [ ] |
| **UF-036** | Scheduler: cron-like distillation trigger, configurable time (default 6 PM local), jitter ±5 min to prevent thundering herd in team deployments. Runs within daemon process. Weekend/no-activity handling: skip if zero events for the day | `src/services/scheduler/scheduler.ts` | [ ] |
| **UF-037** | `unfade distill` command: manual trigger (`unfade distill`), view by date (`--date YYYY-MM-DD`), backfill (`--backfill N` days), provider override (`--provider ollama|openai|anthropic`). Displays DistillView on completion | `src/commands/distill.ts` | [ ] |
| **UF-040** | Notification service: system notification "Your Unfade is ready" via `node-notifier` when distillation completes. Includes preview ("3 decisions, 1 dead end explored"). Click handler opens web UI distill viewer in default browser. Configurable (enabled/disabled). Respects notification tiers from Zero-Knowledge UX Plan. _(Integrates UF-086f click handler)_ | `src/services/notification/notifier.ts` | [ ] |
| **UF-041** | Personalization seed / profile builder: after distillation, extract patterns — alternatives evaluated per decision (running average), domain distribution (frequency, depth), AI acceptance rate, AI modification rate — write to `.unfade/profile/reasoning_model.json`. Initialize on first run, incrementally update on subsequent runs | `src/services/personalization/profile-builder.ts` | [ ] |

**Agent Directive (Sprint 1F):**

> "Build 5 modules. (1) `src/services/distill/distiller.ts`: export `distill(date: string, options?: {backfill?: number}): Promise<DailyDistill>`. Orchestrates: read events via event-store → extractSignals → linkContext → synthesize → write `distills/YYYY-MM-DD.md` → append decisions to `graph/decisions.jsonl` → update `graph/domains.json` → call profileBuilder.update() → call notifier.notify(). For backfill: loop over N past days, throttle 1 per 10 seconds. Skip days with zero events (don't generate empty distills). Idempotent: re-running for same date overwrites the distill file. (2) `src/services/scheduler/scheduler.ts`: export `startScheduler(config)`. Compute next trigger time from `config.distill.schedule` (default '18:00'). Add jitter ±5 min. Use `setTimeout` to schedule. On trigger: call `distill(today)`. Reschedule for next day. If zero events today, skip silently. (3) `src/commands/distill.ts`: Commander command with options: `--date YYYY-MM-DD`, `--backfill N`, `--provider <name>`. Default (no args): distill today. Show progress spinner during distillation, then render DistillView. (4) `src/services/notification/notifier.ts`: export `notify(distill: DailyDistill)`. Use `node-notifier` to send system notification. Title: 'Your Unfade is ready'. Message: summarize distill (decision count, dead end count). On click (macOS): `open http://localhost:7654/distill`. Read `config.notification.enabled` — respect it. (5) `src/services/personalization/profile-builder.ts`: export `updateProfile(distill: DailyDistill, signals: ExtractedSignals)`. Read existing `reasoning_model.json` or create default. Update running averages: avgAlternativesEvaluated, aiAcceptanceRate, aiModificationRate. Update domainDistribution array. Detect patterns (e.g., 'explores 3+ alternatives for infrastructure decisions'). Write back atomically (tmp + rename)."

**Strict Contracts:**
- Distiller is idempotent — running twice for same date produces identical output
- Scheduler: no distill on zero-event days — silence is correct
- Backfill throttle: max 1 distill per 10 seconds — don't overwhelm Ollama
- Notification click MUST open web UI — not terminal
- Profile builder: atomic write (tmp + rename) — never partial JSON
- All notification text uses `USER_TERMS` — "Your Unfade is ready" not "Distillation complete"

---

### 6.7 Sprint 1G — TUI Dashboard

**Objective:** `unfade` (no args) shows a rich TUI with capture engine status, distill summary, personalization level, and expanded quick actions covering all common operations.

**Acid Test:**
```bash
unfade
# → TUI dashboard appears:
#   - Capture engine status (● Capturing / ⚠ Paused)
#   - Today's event count + decision count
#   - Latest distill summary (top 3 decisions as one-liners)
#   - Personalization level indicator
#   - Quick actions: [d]istill now [c]ard [o]pen web [s]earch [e]xport [q]uit

# Press [d] → triggers distillation, shows progress, displays result
# Press [o] → opens localhost:7654 in browser
# Press [s] → inline search prompt appears, enter query, see results
# Press [q] → exits cleanly
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-019** | TUI dashboard (`unfade` with no args): state detection → if not initialized, run init; if daemon stopped, silently restart; then show dashboard. The TUI is the single entry point for all common actions | `src/tui/dashboard.tsx` | [ ] |
| **UF-019b** | `unfade open` command: open web UI in browser (`localhost:7654`) via `open` (macOS) / `xdg-open` (Linux) / `start` (Windows) | `src/commands/open.ts` | [ ] |
| **UF-021** | DashboardView Ink component: capture engine status badge (uses `USER_TERMS`), today's event count, latest distill summary (top 3 decisions), personalization level indicator, quick action bar | `src/components/DashboardView.tsx` | [ ] |
| **UF-038** | DistillView Ink component: formatted markdown display of Daily Distill in terminal — section headers (Decisions, Trade-offs, Dead Ends, Breakthroughs, Patterns), decision cards, pattern highlights | `src/components/DistillView.tsx` | [ ] |
| **UF-086c** | TUI quick actions expansion: add `[s]earch`, `[e]xport` to dashboard. `[s]` opens inline search input (equivalent to `unfade query "..."`), displays results in TUI. `[e]` triggers export with y/n confirmation. `[d]` labeled "Distill now" (clear it GENERATES, not views). `[c]` generates card AND opens in browser. _(From Zero-Knowledge UX Plan)_ | `src/components/DashboardView.tsx` | [ ] |

**Agent Directive (Sprint 1G):**

> "Build the TUI entry point and components. (1) `src/tui/dashboard.tsx`: the main TUI orchestrator. On mount: call `detectState()`. If `not_initialized` → render InitWizard (Sprint 1D). If `daemon_stopped` → silently restart daemon, then render DashboardView. If `daemon_running` → render DashboardView. (2) `src/components/DashboardView.tsx`: Ink component using React 19. Reads: `.unfade/state/health.json` (status, event count), `.unfade/distills/YYYY-MM-DD.md` (latest distill — find most recent file, not just today's, parse top 3 decisions), `.unfade/profile/reasoning_model.json` (personalization level). Display: status badge using `USER_TERMS` ('● Capturing' / '⚠ Capture paused'), event count, distill summary, personalization indicator. Quick action bar: `[d]istill now`, `[c]ard`, `[o]pen web`, `[s]earch`, `[e]xport`, `[q]uit`. Handle keypresses: `d` → call distiller, show DistillView. `c` → call card generator + open in browser. `o` → `open http://localhost:7654`. `s` → show TextInput, on submit call query tool, show results. `e` → show confirmation, on yes trigger export. `q` → exit. (3) `src/components/DistillView.tsx`: renders DailyDistill markdown as formatted terminal output. Section headers in bold. Decision summaries as bullet points. Pattern metrics with bar indicators. (4) `src/commands/open.ts`: detect platform, exec `open`/`xdg-open`/`start` with `http://localhost:7654`. Handle errors (server not running → start it, then open)."

**Strict Contracts:**
- TUI shows LATEST distill (most recent file), not just today's — covers Day 2 user journey
- Status badge uses `USER_TERMS` — "● Capturing" not "● Daemon running"
- `[d]` labeled "Distill now" — makes clear this GENERATES, not views
- `[c]` generates card AND opens in browser — not just terminal confirmation
- TUI is a control panel — no card rendering, no settings editing, no full search UI

### Tests

| Test | What It Validates | File |
|---|---|---|
| **T-012** | Config manager: env vars override project config override user config | `test/config/manager.test.ts` |
| **T-013** | Config manager: empty input produces valid config with all defaults | `test/config/manager.test.ts` |
| **T-014** | Config manager: invalid config throws Zod validation error | `test/config/manager.test.ts` |
| **T-015** | State detector: no `.unfade/` → `not_initialized` | `test/state/detector.test.ts` |
| **T-016** | State detector: `.unfade/` exists, no PID → `initialized` | `test/state/detector.test.ts` |
| **T-017** | State detector: daemon PID active → `daemon_running` | `test/state/detector.test.ts` |
| **T-018** | State detector: daemon running, no LLM → `no_llm` | `test/state/detector.test.ts` |
| **T-019** | State detector: not a git repo → `no_git` | `test/state/detector.test.ts` |
| **T-020** | State detector: has events, no distill → `first_distill_pending` | `test/state/detector.test.ts` |
| **T-021** | Event store: append event creates JSONL file with correct date name | `test/services/capture/event-store.test.ts` |
| **T-022** | Event store: read by date range returns only events in range | `test/services/capture/event-store.test.ts` |
| **T-023** | Event store: append multiple events preserves order | `test/services/capture/event-store.test.ts` |
| **T-024** | Event store: read from non-existent date returns empty array | `test/services/capture/event-store.test.ts` |
| **T-025** | Git source: `isAvailable()` returns true in a git repo | `test/services/capture/sources/git.test.ts` |
| **T-026** | Git source: `isAvailable()` returns false outside git repo | `test/services/capture/sources/git.test.ts` |
| **T-027** | Git source: commit event captured with correct schema | `test/services/capture/sources/git.test.ts` |
| **T-028** | Git source: branch-switch event captured | `test/services/capture/sources/git.test.ts` |
| **T-029** | Git source: backfill yields events for past commits | `test/services/capture/sources/git.test.ts` |
| **T-030** | Git source: backfill respects `since` date parameter | `test/services/capture/sources/git.test.ts` |
| **T-031** | Git source: event includes correct gitContext (repo, branch, hash) | `test/services/capture/sources/git.test.ts` |
| **T-032** | Git source: auto-save noise filtered (debounce rapid changes) | `test/services/capture/sources/git.test.ts` |
| **T-033** | Watcher: starts multiple sources, routes events to store | `test/services/capture/watcher.test.ts` |
| **T-034** | Watcher: stops all sources on shutdown | `test/services/capture/watcher.test.ts` |
| **T-035** | Watcher: handles source failure gracefully (other sources continue) | `test/services/capture/watcher.test.ts` |
| **T-036** | PID: Go daemon creates PID file with correct process ID | `test/state/pid.test.ts` |
| **T-037** | PID: detects running Go daemon via PID file | `test/state/pid.test.ts` |
| **T-038** | PID: detects stale PID (daemon process no longer running) | `test/state/pid.test.ts` |
| **T-039** | PID: PID file removed on daemon shutdown | `test/state/pid.test.ts` |
| **T-040** | PID: prevents second daemon instance from starting | `test/state/pid.test.ts` |
| **T-041** | IPC: client connects to server via Unix socket | `test/utils/ipc.test.ts` |
| **T-042** | IPC: client sends command, server responds | `test/utils/ipc.test.ts` |
| **T-043** | IPC: client handles server unavailable gracefully | `test/utils/ipc.test.ts` |
| **T-044** | IPC: server handles multiple concurrent clients | `test/utils/ipc.test.ts` |
| **T-045** | Daemon: Go binary starts with PID file created | `test/services/daemon/binary.test.ts` |
| **T-046** | Daemon: graceful shutdown on SIGTERM via `daemon stop` | `test/services/daemon/binary.test.ts` |
| **T-047** | Daemon: platform auto-start plist/service/task created during init | `test/services/daemon/binary.test.ts` |
| **T-048** | Daemon: survives terminal close (managed by platform manager) | `test/services/daemon/binary.test.ts` |
| **T-049** | Daemon: health reporting via IPC returns memory/CPU/uptime | `test/services/daemon/binary.test.ts` |
| **T-050** | AI session: detects Cursor log directory | `test/services/capture/sources/ai-session.test.ts` |
| **T-051** | AI session: detects Claude Code session directory | `test/services/capture/sources/ai-session.test.ts` |
| **T-052** | AI session: parses conversation into ai-conversation event | `test/services/capture/sources/ai-session.test.ts` |
| **T-053** | AI session: detects accepted vs rejected AI suggestions | `test/services/capture/sources/ai-session.test.ts` |
| **T-054** | AI session: handles missing/empty log directory gracefully | `test/services/capture/sources/ai-session.test.ts` |
| **T-055** | AI session: handles unknown log format gracefully | `test/services/capture/sources/ai-session.test.ts` |
| **T-056** | Ollama provider: `isAvailable()` returns true when Ollama running | `test/services/distill/providers/ollama.test.ts` |
| **T-057** | Ollama provider: `isAvailable()` returns false when Ollama not running | `test/services/distill/providers/ollama.test.ts` |
| **T-058** | Ollama provider: `complete()` returns string response | `test/services/distill/providers/ollama.test.ts` |
| **T-059** | OpenAI provider: `complete()` with valid API key returns response | `test/services/distill/providers/openai.test.ts` |
| **T-060** | Anthropic provider: `complete()` with valid API key returns response | `test/services/distill/providers/anthropic.test.ts` |
| **T-061** | Signal extractor: extracts decisions from commit events | `test/services/distill/signal-extractor.test.ts` |
| **T-062** | Signal extractor: counts alternatives evaluated per decision | `test/services/distill/signal-extractor.test.ts` |
| **T-063** | Signal extractor: identifies dead ends (reverts, retries) | `test/services/distill/signal-extractor.test.ts` |
| **T-064** | Signal extractor: identifies trade-offs from AI rejection events | `test/services/distill/signal-extractor.test.ts` |
| **T-065** | Signal extractor: handles empty event list gracefully | `test/services/distill/signal-extractor.test.ts` |
| **T-066** | Context linker: connects signals to git context (files, branch) | `test/services/distill/context-linker.test.ts` |
| **T-067** | Context linker: groups related signals by project | `test/services/distill/context-linker.test.ts` |
| **T-068** | Synthesizer: produces valid Daily Distill Markdown | `test/services/distill/synthesizer.test.ts` |
| **T-069** | Synthesizer: includes all required sections (Decisions, Trade-offs, Dead Ends, Breakthroughs, Patterns) | `test/services/distill/synthesizer.test.ts` |
| **T-070** | Synthesizer: fallback produces structured summary when no LLM | `test/services/distill/synthesizer.test.ts` |
| **T-071** | Distiller: full pipeline extract → link → synthesize → write | `test/services/distill/distiller.test.ts` |
| **T-072** | Distiller: writes distill to correct date-named file | `test/services/distill/distiller.test.ts` |
| **T-073** | Distiller: backfill mode processes multiple past dates | `test/services/distill/distiller.test.ts` |
| **T-074** | Distiller: idempotent — running twice overwrites, no side effects | `test/services/distill/distiller.test.ts` |
| **T-075** | Scheduler: triggers distillation at configured time | `test/services/scheduler/scheduler.test.ts` |
| **T-076** | Scheduler: jitter prevents exact-time clustering | `test/services/scheduler/scheduler.test.ts` |
| **T-077** | Notification: sends system notification on distill completion | `test/services/notification/notifier.test.ts` |
| **T-078** | Notification: respects enabled/disabled config | `test/services/notification/notifier.test.ts` |
| **T-079** | Profile builder: initializes reasoning_model.json on first run | `test/services/personalization/profile-builder.test.ts` |
| **T-080** | Profile builder: updates running averages on subsequent distills | `test/services/personalization/profile-builder.test.ts` |
| **T-081** | Profile builder: tracks domain distribution | `test/services/personalization/profile-builder.test.ts` |
| **T-082** | `unfade init`: creates .unfade/ directory structure | `test/commands/init.test.ts` |
| **T-083** | `unfade init`: triggers git backfill | `test/commands/init.test.ts` |
| **T-084** | `unfade init`: downloads Go daemon binary and starts daemon | `test/commands/init.test.ts` |
| **T-084b** | `unfade init`: installs shell hooks for detected shell (bash/zsh/fish) | `test/commands/init.test.ts` |
| **T-084c** | `unfade init`: installs platform auto-start (launchd plist on macOS, systemd unit on Linux, Task Scheduler on Windows) | `test/commands/init.test.ts` |
| **T-084d** | Go daemon binary download: verifies checksum after download | `test/services/daemon/binary.test.ts` |
| **T-084e** | Shell hook installer: detects current shell correctly | `test/services/shell/installer.test.ts` |
| **T-084f** | Shell hook installer: appends hook to shell rc file | `test/services/shell/installer.test.ts` |
| **T-085** | TUI dashboard: shows daemon running state | `test/tui/dashboard.test.ts` |
| **T-086** | TUI dashboard: shows today's distill summary and event count | `test/tui/dashboard.test.ts` |
| **T-086b** | TUI dashboard: shows personalization level | `test/tui/dashboard.test.ts` |
| **T-086c** | TUI dashboard: quick actions respond to keypress (`d`, `c`, `o`, `q`) | `test/tui/dashboard.test.ts` |
| **T-086d** | `unfade open`: opens browser to localhost:7654 | `test/commands/open.test.ts` |
| **T-087** | `unfade distill`: triggers manual distillation | `test/commands/distill.test.ts` |
| **T-088** | `unfade distill --backfill 7`: processes 7 past days | `test/commands/distill.test.ts` |
| **T-089** | State detector: self-healing restarts stopped daemon silently | `test/state/detector.test.ts` |
| **T-090** | State detector: self-healing reinstalls missing shell hooks | `test/state/detector.test.ts` |
| **T-091** | Terminology: `USER_TERMS.daemon` returns "capture engine" | `test/constants/terminology.test.ts` |
| **T-092** | `unfade init`: does NOT prompt for LLM provider or API keys | `test/commands/init.test.ts` |
| **T-093** | `unfade init`: installs shell hooks WITHOUT confirmation prompt | `test/commands/init.test.ts` |
| **T-094** | `unfade init`: triggers immediate first distill after backfill | `test/commands/init.test.ts` |
| **T-095** | `unfade init`: defaults to no-LLM mode when Ollama unavailable | `test/commands/init.test.ts` |
| **T-096** | TUI dashboard: shows latest distill (not just today's) | `test/tui/dashboard.test.ts` |
| **T-097** | TUI dashboard: `[s]earch` quick action opens inline search | `test/tui/dashboard.test.ts` |
| **T-098** | TUI dashboard: `[e]xport` quick action triggers export with confirmation | `test/tui/dashboard.test.ts` |
| **T-099** | Notification: click handler opens web UI in browser | `test/services/notification/notifier.test.ts` |
| **T-100** | Notification: includes distill preview in message body | `test/services/notification/notifier.test.ts` |
| **T-101** | Distiller: skips days with zero events (no empty distill) | `test/services/distill/distiller.test.ts` |
| **T-102** | Scheduler: skips distill on zero-event days | `test/services/scheduler/scheduler.test.ts` |

---

## 7. Success Metrics

| Metric | Current | Target | How to Measure |
|---|---|---|---|
| **Time to first distill** | N/A | < 2 minutes from `npx unfade` | Manual testing — init → backfill → immediate first distill (zero-knowledge flow) |
| **Daemon memory usage** | N/A | < 50 MB RSS | TUI dashboard reports RSS via Go daemon health |
| **Daemon CPU (idle)** | N/A | < 1% | TUI dashboard reports CPU via Go daemon health |
| **Event capture latency** | N/A | < 1 second from git commit to JSONL write | Timestamp comparison: commit time vs event timestamp |
| **Git backfill speed** | N/A | 30 days of history in < 30 seconds | Timer in backfill method |
| **Distillation time** | N/A | < 60 seconds with local LLM | Timer in distiller `_meta.durationMs` |
| **Distill quality** | N/A | Sections match actual work (qualitative) | Manual review of 5 consecutive distills |
| **Personalization seed accuracy** | N/A | Domain distribution matches reality (qualitative) | Developer self-assessment after 3 days |
| **Test count** | 13 (Phase 0) | 102+ tests, all passing | `pnpm test` |
| **Daemon uptime** | N/A | Survives 8-hour workday without crash | Run daemon, check PID after 8 hours |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Ollama not installed** | High | Medium — degrades distillation to structured summaries | Silent detection during init (no prompt). Default to structured summaries (no-LLM mode). Show banner in web UI: "Enhance your distills with AI — configure in Settings". Never block core functionality |
| **AI session log format changes** | Medium | Medium — breaks ai-session capture | Modular source architecture. Version-specific parsers. Graceful degradation: skip unparseable logs, log warning |
| **Daemon crashes** | Medium | Medium — stops capture | Platform manager (launchd/systemd/Task Scheduler) handles auto-restart. Go daemon reports health via IPC. TUI dashboard detects stale PID |
| **Large git history** | Low | Low — slow backfill | Backfill is async with progress indicator. Cap at 30 days default (configurable). Stream events, don't buffer in memory |
| **Disk space from JSONL growth** | Low | Low — accumulates slowly | Events are small (~200 bytes each). 1000 events/day = ~200KB/day. Rotation at 90 days default |
| **Multiple git repos** | Medium | Medium — daemon scope unclear | Global daemon watches multiple `.git/` directories. Events tagged with repo context in `gitContext.repo` |
| **Cross-platform IPC** | Medium | Medium — Unix sockets don't exist on Windows | Go daemon handles IPC abstraction: Unix socket (macOS/Linux), named pipe (Windows). TypeScript CLI uses IPC client only. Fallback: TCP on localhost with random port in PID file |
| **Go daemon binary distribution** | Medium | Medium — multiple OS/arch targets | Pre-built binaries for macOS (arm64, amd64), Linux (amd64, arm64), Windows (amd64). Checksum verification on download during `unfade init`. Fallback: prompt user to build from source |
| **Personalization seed feels generic** | Medium | Medium — fails to differentiate | Invest in signal extraction quality. Count actual alternatives from git history (branches, reverts). Track actual AI acceptance from session logs. Even rough personalization > none |

---

> **Next phase:** [Phase 2: Hooks API & MCP Server](./PHASE_2_HOOKS_API_AND_MCP.md) — HTTP API, MCP server, context injection for every AI tool.

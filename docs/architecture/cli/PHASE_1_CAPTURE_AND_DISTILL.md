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
> **Last updated:** 2026-04-14

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [5b. Execution Guide](#5b-execution-guide-day-1-instant-fingerprint-daemon--distill)
- [6. Implementation Plan](#6-implementation-plan)
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
| **Init** | `unfade init` scaffolds `.unfade/`, fingerprints project, downloads Go daemon binary, installs shell hooks, installs platform auto-start (launchd/systemd/Task Scheduler), configures LLM, starts daemon + web server, triggers git backfill |
| **Capture — Git** | Real-time git watcher: commits, diffs, branch switches, reverts, stashes, merge conflicts → structured events |
| **Capture — AI Sessions** | AI session log reader: scans `~/.cursor/logs/`, `~/.claude/sessions/` for conversation transcripts → reasoning events |
| **Event Storage** | Append-only JSONL at `.unfade/events/YYYY-MM-DD.jsonl` — plain text, inspectable, greppable |
| **Daemon** | Go binary (`unfaded`) — background process with PID lock, Unix socket IPC (macOS/Linux) / named pipe (Windows), graceful shutdown, resource budget (<50MB RAM, <1% CPU idle). Downloaded during `unfade init`, auto-starts on login via platform manager |
| **Distillation** | LLM synthesis of the day's reasoning: Decisions Made, Trade-offs Navigated, Dead Ends Explored, Breakthroughs |
| **Personalization Seed** | PATTERNS section in distill: alternatives evaluated per decision, domain distribution, AI acceptance rate |
| **Backfill** | `unfade distill --backfill 7` retroactively distills past days from git history |
| **TUI Dashboard** | `unfade` (no args) shows: daemon status, today's distill summary, personalization level, quick actions `[d]istill [c]ard [o]pen web [q]uit` |
| **Web UI** | `unfade open` opens web UI in browser (localhost:7654) |
| **Notification** | "Your Unfade is ready" system notification when distillation completes |

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
| **Git operations** | — | isomorphic-git | isomorphic-git | Pure JS, no native deps, reads history/diffs/branches |
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
| **Commit** | `.git/` HEAD change → `isomorphic-git` log | `commit` | Message, files changed, diff summary, branch |
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
│   │   │   ├── ollama.ts
│   │   │   ├── openai.ts
│   │   │   └── anthropic.ts
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
│   ├── git.go                # Git watcher via fsnotify + go-git, backfill support
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

## 5b. Execution Guide (Day 1: Instant Fingerprint, Daemon & Distill)

> **Sourced from:** Master Execution Blueprint — consolidated tasks with acid tests, strict contracts, and agent directives for AI-agent-driven execution.

### Acid Test

```
npx unfade init                    → fingerprint displayed, daemon running, server on :7654
ls .unfade/events/                 → JSONL file exists (or appears after next git commit)
unfade distill --backfill 7        → 7 daily distills generated from git history
unfade                             → TUI dashboard shows daemon status + today's distill summary
```

### Strict Contracts

**IPC boundary (the ONE rule that governs the entire system):**

```
Go daemon WRITES to:    .unfade/events/YYYY-MM-DD.jsonl  (O_APPEND, <4KB per write)
                         .unfade/state/daemon.pid
                         .unfade/state/health.json       (atomic: tmp + rename)
                         ~/.unfade/state/daemon.sock     (Unix socket listener)

TypeScript READS from:  .unfade/events/YYYY-MM-DD.jsonl  (tolerates partial last line)
                         .unfade/state/daemon.pid         (PID existence check)
                         .unfade/state/health.json        (status display)

TypeScript WRITES to:   .unfade/config.json              (atomic: tmp + rename)
                         .unfade/distills/YYYY-MM-DD.md
                         .unfade/graph/decisions.jsonl
                         .unfade/graph/domains.json
                         .unfade/profile/reasoning_model.json
                         .unfade/state/server.json        (atomic: tmp + rename)
                         .unfade/state/init_progress.json
                         ~/.unfade/state/repos.json
```

**Terminal event JSON (shell hook → unfade-send → daemon socket):**

```json
{
  "cmd": "npm test",
  "exit": 0,
  "duration": 12,
  "cwd": "/Users/dev/project"
}
```

**health.json schema (written by Go daemon):**

```json
{
  "status": "running",
  "pid": 42813,
  "uptime_seconds": 22320,
  "watchers": {
    "git": ["/Users/dev/project"],
    "ai_session": ["~/.cursor/logs/", "~/.claude/"]
  },
  "events_today": 23,
  "memory_mb": 11.2,
  "version": "0.1.0"
}
```

### Consolidated Tasks (5) with Agent Directives

#### Task 1.1: Go Daemon Core

Build the daemon: main loop, signal handling, PID management, health reporter, and the GitWatcher + AISessionWatcher capture sources. The daemon writes events to JSONL and health to JSON. It also listens on a Unix socket for terminal events (basic receive + store — no pattern detection yet).

**Agent directive:** "Build the Go daemon at `daemon/cmd/unfaded/main.go`. The daemon does 5 things: (1) Acquires a flock on `~/.unfade/state/daemon.pid`, writes its PID. (2) Reads `~/.unfade/state/repos.json` to discover watched repos. (3) Starts a GitWatcher (fsnotify on each repo's `.git/`) and AISessionWatcher (file tailing on configured paths) for each active repo. (4) Starts a TerminalReceiver (Unix socket at `~/.unfade/state/daemon.sock` — reads JSON lines, writes CaptureEvents to the correct repo's events/ based on the `cwd` field). (5) Writes health.json every 30 seconds. On SIGTERM: flush pending events, remove PID file, close socket, exit."

**Critical boundaries:**
- GitWatcher: on `.git/` change → run `git log -1 --format=json` equivalent (use go-git or shell out) → emit CaptureEvent with type "commit"
- AISessionWatcher: tail known log files → parse last N lines on change → emit CaptureEvent with type "conversation"
- EventWriter: single goroutine consumes from all CaptureSource channels → appends to `.unfade/events/YYYY-MM-DD.jsonl` using `O_APPEND`
- TerminalReceiver: accept connection → read one JSON line → parse → emit CaptureEvent with type "command" → close connection
- All writes are to the per-repo `.unfade/events/` directory, EXCEPT terminal events which are routed by `cwd`

#### Task 1.2: `unfade init` Command

The single setup command. Scaffold `.unfade/`, scan git, download daemon, install shell hooks, install auto-start, start daemon + server. Each step is idempotent with progress tracked in `init_progress.json`.

**Agent directive:** "Build `src/commands/init.ts`. The command executes 6 steps sequentially, each idempotent. Track progress in `.unfade/state/init_progress.json`. Step 1 (scaffold): create `.unfade/` directory tree + `config.json` with defaults + add `.unfade/` to `.git/info/exclude`. Step 2 (git scan): run the fingerprint calculator (Task 1.3). Step 3 (download daemon): resolve the `unfaded` binary from node_modules optional dep (`@unfade/daemon-{platform}-{arch}`) or fall back to bundled binary. Copy `unfaded` and `unfade-send` to `.unfade/bin/`. Step 4 (install hooks): detect shell (zsh/bash), append preexec/precmd hooks to shell config that use `~/.unfade/bin/unfade-send`. Show the exact lines and ask Y/n. Step 5 (install auto-start): generate and install launchd plist (macOS) or systemd unit (Linux). Step 6 (start services): spawn `unfaded` in background, register repo in `~/.unfade/state/repos.json`. Only step 1 is fatal on failure — all others log warnings and continue."

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

#### Task 1.3: Fingerprint Calculator

Walk git history with isomorphic-git, compute the Reasoning Fingerprint, write seed `reasoning_model.json`. No LLM required.

**Agent directive:** "Build `src/services/fingerprint/calculator.ts`. Input: a git repo path + config (scanMonths, maxCommits). Output: a `ReasoningModel` object (matching the Zod schema). Walk commits using isomorphic-git. For each commit: count files changed, detect reverts (commit message starts with 'Revert'), classify domain from file paths (map path prefixes to domain names — e.g., `src/auth/` → 'auth', `db/migrations/` → 'database'), detect AI signatures (Co-authored-by lines, known patterns). Aggregate into: avg alternatives per decision (estimate from branch count / merge commits), domain distribution, trade-off profile (diff size patterns), dead end tolerance (revert frequency), AI collaboration rate. Stream commits in batches of 500 to keep memory under 200MB. Output confidence levels per metric (●●●● for strong signal, ●○○○ for weak). Handle edge cases: <10 commits → 'not enough history', squash-merge detection, shallow clones."

#### Task 1.4: Distillation Pipeline + Backfill

Three-stage pipeline: extract signals → link context → LLM synthesis. Plus `unfade distill` command with `--backfill N` for retroactive distillation.

**Agent directive:** "Build `src/services/distill/pipeline.ts` (orchestrator), `extractor.ts` (Stage 1), `linker.ts` (Stage 2), `synthesizer.ts` (Stage 3). Build `src/commands/distill.ts` for the CLI command."

**Stage definitions:**
- **Stage 1 (extractor.ts):** Read `events/YYYY-MM-DD.jsonl`, parse each line as CaptureEvent (skip malformed lines), classify events: commits → decision candidates, branch switches → context shifts, reverts → dead ends, retries → debugging sessions. Output: `ExtractedSignals` object with categorized events. No LLM.
- **Stage 2 (linker.ts):** Cross-reference signals: attach git context, find AI conversation about same file as commit, build temporal chains (sequential commits on same module). Output: `LinkedSignals` with cross-references. No LLM.
- **Stage 3 (synthesizer.ts):** Send linked signals to LLM (Ollama default, cloud opt-in). Structured prompt → DailyDistill markdown + Decision[] + domain tags + personalization observations. Write outputs: `distills/YYYY-MM-DD.md`, append to `graph/decisions.jsonl`, update `graph/domains.json`, incrementally update `profile/reasoning_model.json`.

**LLM provider interface (`src/services/llm/provider.ts`):**
```
LLMProvider interface:
  name: string
  synthesize(signals: LinkedSignals): Promise<DailyDistill>
  extractDecisions(content: string): Promise<Decision[]>
  isAvailable(): Promise<boolean>
```

**Ollama readiness check:** 3-step: (1) `GET http://localhost:11434/api/version` — running? (2) `GET /api/tags` — model available? (3) `POST /api/generate` with trivial prompt, 5s timeout — responsive? All failures → fall back to Stage 1+2 output only, with actionable error messages.

**`--backfill N`:** Walk git log for the last N days. For each day, generate synthetic `events/YYYY-MM-DD.jsonl` from git commits, then run the full pipeline. Throttle: max 1 distill per 10 seconds to avoid overwhelming Ollama.

#### Task 1.5: TUI Dashboard

`unfade` (no args) opens an Ink TUI showing daemon status, today's distill summary, and quick actions.

**Agent directive:** "Build `src/tui/dashboard.tsx` using Ink 6.x + React 19. The TUI reads: `.unfade/state/health.json` (daemon status), `.unfade/distills/YYYY-MM-DD.md` (today's distill — parse top 3 decisions), `.unfade/profile/reasoning_model.json` (personalization level). Display: daemon status (running/stopped + PID + event count), today's top 3 decisions as one-liners, personalization level indicator, quick actions: [d]istill now, [c]ard, [o]pen web, [q]uit. The TUI is a control panel, not a feature mirror — no card rendering, no search, no settings."

---

## 6. Implementation Plan

### Sprint 1: Capture Foundation

> **Goal:** Config manager, state detector, event store, git capture source (Go daemon), `unfade init` (expanded), TUI dashboard. Events flowing to `.unfade/events/`.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-012** | Config manager: load from env → user (`~/.unfade/config.json`) → project (`.unfade/config.json`), merge with defaults, Zod-validate | `src/config/manager.ts`, `src/config/defaults.ts` | [ ] |
| **UF-013** | State detector: check init status, daemon PID, LLM availability, git repo, pending distill — return most actionable state | `src/state/detector.ts` | [ ] |
| **UF-014** | Event store: append `CaptureEvent` to daily JSONL file, read events by date range, count events per day. _Note: event store logic runs in the Go daemon; this TypeScript module reads events for CLI display and distillation triggers_ | `src/services/capture/event-store.ts` | [ ] |
| **UF-015** | Git capture source: implement `CaptureSource` interface in Go daemon — watch `.git/` HEAD changes via `fsnotify`, parse commits with go-git, extract structured events. _TypeScript side only reads resulting events_ | `daemon/capture/git.go`, `src/services/capture/sources/git.ts` (read-only client) | [ ] |
| **UF-016** | Git backfill: `backfill(since: Date)` — parse last 30 days of git log into CaptureEvents, yield progressively. _Runs in Go daemon, triggered via IPC from `unfade init`_ | `daemon/capture/git.go` | [ ] |
| **UF-017** | Watcher orchestrator: manage active capture sources, start/stop lifecycle, route events to event store. _Runs in Go daemon_ | `daemon/capture/watcher.go` | [ ] |
| **UF-018** | `unfade init` command (expanded 5-step): (1) scaffold `.unfade/` directory structure, (2) fingerprint project, (3) download + verify Go daemon binary, (4) detect shell and install shell hooks, (5) install platform auto-start (launchd/systemd/Task Scheduler), run LLM detection, start daemon + web server, trigger git backfill, show progress | `src/commands/init.ts`, `src/services/daemon/binary.ts`, `src/services/shell/installer.ts` | [ ] |
| **UF-019** | TUI dashboard (`unfade` with no args): show daemon status, today's distill summary, personalization level, quick actions `[d]istill [c]ard [o]pen web [q]uit`. _Replaces standalone `unfade status` command_ | `src/tui/dashboard.tsx` | [ ] |
| **UF-019b** | `unfade open` command: open web UI in browser (localhost:7654) | `src/commands/open.ts` | [ ] |
| **UF-020** | InitWizard Ink component: 5-step first-run UX flow — scaffold, fingerprint, daemon download, shell hook installation, platform auto-start installation, LLM configuration, backfill progress | `src/components/InitWizard.tsx` | [ ] |
| **UF-021** | DashboardView Ink component: TUI dashboard with daemon status badge, today's distill summary, event counts, personalization level, quick action bar `[d]istill [c]ard [o]pen web [q]uit` | `src/components/DashboardView.tsx` | [ ] |

### Sprint 2: Daemon & AI Session Capture

> **Goal:** Go daemon (`unfaded`) running independently. AI session logs captured. Daemon lifecycle via platform manager + CLI stop command.
>
> _Note: Tasks UF-022 through UF-028 describe Go daemon behavior. TypeScript provides only the `daemon stop` CLI command (UF-026) and daemon binary download/management (handled in UF-018)._

| Task | Description | File | Status |
|---|---|---|---|
| **UF-022** | PID file management (Go daemon): create PID file on daemon start, check for existing daemon, remove on shutdown, detect stale PIDs | `daemon/platform/pid.go` | [ ] |
| **UF-023** | IPC server (Go daemon) + IPC client (TypeScript): Unix domain socket (macOS/Linux) / named pipe (Windows) for CLI ↔ daemon communication — status queries, manual distill triggers, shutdown signals | `daemon/platform/ipc.go`, `src/utils/ipc.ts` (client only) | [ ] |
| **UF-024** | Daemon process lifecycle (Go daemon): register signal handlers (SIGTERM, SIGINT), graceful shutdown sequence, health reporting. Auto-restart handled by platform manager (launchd/systemd/Task Scheduler), not by the daemon itself | `daemon/main.go`, `daemon/health/reporter.go` | [ ] |
| **UF-025** | AI session capture source (Go daemon): implement `CaptureSource` — scan Cursor logs (`~/.cursor/logs/`), Claude Code sessions (`~/.claude/sessions/`), parse conversations into reasoning events, detect format changes gracefully | `daemon/capture/ai_session.go` | [ ] |
| **UF-026** | `unfade daemon` command: only `stop` subcommand (SIGTERM via PID, power user command). Daemon start is handled by `unfade init` initially and platform auto-start on login. Daemon status is shown in TUI dashboard. Daemon logs are available via web UI `/settings` page | `src/commands/daemon.ts` | [ ] |
| **UF-027** | Daemon log rotation (Go daemon): rotate `daemon.log` when >10MB, keep last 3 rotated files | `daemon/platform/logger.go` | [ ] |
| **UF-028** | Resource budget enforcement (Go daemon): monitor RSS memory and CPU usage, log warning if exceeding budget, reduce watcher frequency if necessary | `daemon/health/budget.go` | [ ] |

### Sprint 3: Distillation Engine

> **Goal:** Daily Distill generated from events. LLM synthesis with Ollama default. Personalization seed in output.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-029** | LLM provider interface + Ollama provider: `LLMProvider` interface with `isAvailable()` and `complete()`, Ollama implementation using `ollama` npm package | `src/services/distill/providers/types.ts`, `src/services/distill/providers/ollama.ts` | [ ] |
| **UF-030** | OpenAI-compatible provider: implement `LLMProvider` for any OpenAI-compatible API (OpenAI, Together, Groq, local alternatives) | `src/services/distill/providers/openai.ts` | [ ] |
| **UF-031** | Anthropic provider: implement `LLMProvider` using `@anthropic-ai/sdk` | `src/services/distill/providers/anthropic.ts` | [ ] |
| **UF-032** | Signal extractor: parse day's events into structured reasoning signals — decisions (with alternatives count), trade-offs, dead ends (with time spent), breakthroughs | `src/services/distill/signal-extractor.ts` | [ ] |
| **UF-033** | Context linker: connect extracted signals to git context — which files, which branch, which project, related commits | `src/services/distill/context-linker.ts` | [ ] |
| **UF-034** | Synthesizer: LLM prompt chain that takes signals + context → Daily Distill Markdown with Decisions, Trade-offs, Dead Ends, Breakthroughs, Patterns sections | `src/services/distill/synthesizer.ts` | [ ] |
| **UF-035** | Distiller orchestrator: pipeline of extract → link → synthesize → write distill → update profile → notify. Handles backfill mode for past dates | `src/services/distill/distiller.ts` | [ ] |
| **UF-036** | Scheduler: cron-like distillation trigger within daemon, configurable time (default 6 PM), jitter to prevent thundering herd in team deployments | `src/services/scheduler/scheduler.ts` | [ ] |
| **UF-037** | `unfade distill` command: manual trigger (`unfade distill`), view today's (`--today`), view by date (`--date YYYY-MM-DD`), backfill (`--backfill N` days) | `src/commands/distill.ts` | [ ] |
| **UF-038** | DistillView Ink component: formatted markdown display of Daily Distill in terminal with section headers, decision cards, pattern highlights | `src/components/DistillView.tsx` | [ ] |
| **UF-039** | Fallback synthesizer: when no LLM is available, produce structured signal summary (counts, categories, file lists) without AI synthesis | `src/services/distill/synthesizer.ts` | [ ] |
| **UF-040** | Notification service: system notification "Your Unfade is ready" via `node-notifier` when distillation completes. Configurable (enabled/disabled, sound) | `src/services/notification/notifier.ts` | [ ] |
| **UF-041** | Personalization seed: after distillation, extract patterns from signals — alternatives evaluated, domain distribution, AI acceptance rate — write to `.unfade/profile/reasoning_model.json` | `src/services/personalization/profile-builder.ts` | [ ] |

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

---

## 7. Success Metrics

| Metric | Current | Target | How to Measure |
|---|---|---|---|
| **Time to first distill** | N/A | < 5 minutes from `unfade init` | Manual testing — init → backfill → distill |
| **Daemon memory usage** | N/A | < 50 MB RSS | TUI dashboard reports RSS via Go daemon health |
| **Daemon CPU (idle)** | N/A | < 1% | TUI dashboard reports CPU via Go daemon health |
| **Event capture latency** | N/A | < 1 second from git commit to JSONL write | Timestamp comparison: commit time vs event timestamp |
| **Git backfill speed** | N/A | 30 days of history in < 30 seconds | Timer in backfill method |
| **Distillation time** | N/A | < 60 seconds with local LLM | Timer in distiller `_meta.durationMs` |
| **Distill quality** | N/A | Sections match actual work (qualitative) | Manual review of 5 consecutive distills |
| **Personalization seed accuracy** | N/A | Domain distribution matches reality (qualitative) | Developer self-assessment after 3 days |
| **Test count** | 11 (Phase 0) | 96+ tests, all passing | `pnpm test` |
| **Daemon uptime** | N/A | Survives 8-hour workday without crash | Run daemon, check PID after 8 hours |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Ollama not installed** | High | High — blocks distillation | Detect on `unfade init`. Offer: install Ollama, use cloud LLM, or run without synthesis (structured summaries only). Never block core functionality |
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

# Phase 1 — Capture & Intelligence

> **Feature Statement:** _"A developer installs Unfade, works for a day, and gets their first Daily Distill. It doesn't just say 'you made 3 decisions today.' It says: 'you made 3 decisions today — you evaluated 2 alternatives for the first, rejected the LLM's singleton suggestion in favor of dependency injection for the second, and accepted the AI's suggestion without evaluation for the third. Your Human Direction Score is 0.72 — Architectural Thinker.' That single reframe — from activity reporting to reasoning reflection, from what-you-shipped to how-you-think — is the moment the developer realizes this tool is different."_
>
> **Prerequisites:** [Phase 0 — Foundation](./PHASE_0_FOUNDATION.md) complete (build pipeline, schemas, CLI entry point, logger, paths)
>
> **Consolidates:** Original Phase 1 (Capture & Distill) + Phase 5.5 (AI Reasoning Engine)

---

## Table of Contents

- [1. Feature Statement](#1-feature-statement)
- [2. Business Justification](#2-business-justification)
- [3. Problem Statement](#3-problem-statement)
- [4. Research](#4-research)
- [5. Architecture](#5-architecture)
- [6. Design Principles](#6-design-principles)
- [7. Implementation Summary](#7-implementation-summary)
- [8. Success Metrics](#8-success-metrics)
- [9. Risk Assessment](#9-risk-assessment)

---

## 1. Feature Statement

Phase 1 delivers the **complete intelligence loop**: install, capture reasoning from every source, classify human vs. AI direction, distill into queryable knowledge, and seed the developer's reasoning identity. This is not an activity logger — it is a reasoning analyzer that distinguishes what the developer decided from what the LLM decided, and surfaces that distinction from day one.

The phase ships three capabilities together because they form a single coherent experience:

1. **Capture Engine** — Go binary that passively watches git, AI sessions, and terminal, writing structured events to `.unfade/events/`
2. **Intelligence Pipeline** — Heuristic classifier that computes a Human Direction Score for every AI conversation, plus signal extraction and context linking
3. **Distill & Identity** — LLM-enhanced synthesis that produces Daily Distills with direction summaries, decision records, and a personalization seed that bootstraps the developer's reasoning identity

---

## 2. Business Justification

### 2.1 The Signal Hierarchy Inversion

Unfade inverts the traditional signal hierarchy. Most developer tools treat git commits as the primary signal. This is architecturally backwards:

| Source | What It Contains | Signal Priority |
|---|---|---|
| **AI conversation logs** | Actual reasoning — prompts, rejections, alternatives, direction changes | **P0** — the raw decision-making process |
| **Terminal commands** | Execution artifacts — build/test/deploy actions | **P1** — shows behavioral patterns |
| **Git commits** | Outcomes — what was shipped | **P2** — confirms a decision was made, but not why |

A commit message says "Refactored auth to use JWT." The AI conversation that produced it shows: the developer considered OAuth2 first, rejected it because of session management complexity, evaluated 3 JWT libraries, directed the LLM away from a stateless approach because of specific infrastructure constraints, and manually corrected the token expiry logic the LLM generated. That conversation contains 10x the reasoning signal of the commit.

### 2.2 The Differentiator: Human Direction Classification

No tool in the market classifies whether a developer is **directing** AI decisions or **accepting** them blindly. This is the single biggest indicator of engineering skill in the AI-assisted era:

- **Human-Directed decisions:** Developer rejects LLM suggestion, provides domain knowledge, steers toward a specific approach
- **Collaborative decisions:** Developer and LLM iteratively refine together with substantive input from both
- **LLM-Directed decisions:** Developer accepts suggestions without evaluation, uses generic prompts

This classification transforms Unfade from "what did you do today" to "how do you think — and how effectively do you direct AI tools."

### 2.3 Why Personalization Ships Here, Not Later

The competitive analysis reveals that 11 tools capture decisions and 5 MCP servers store memory — but zero learn how you think. If Unfade launches without personalization, it is one of 16 capture/memory tools. If it launches *with* personalization — even rough — it is the only tool in the market that feels like it's building an understanding of you.

### 2.4 Community Validation

| Signal | Evidence | Implication |
|---|---|---|
| **AI adoption scale** | Stack Overflow 2025: 76% of developers use AI tools, up from 44% in 2023 | Massive addressable market for AI reasoning capture |
| **Privacy as deal-breaker** | #1 concern in developer surveys | Local-first architecture is a competitive moat |
| **Reasoning as hiring signal** | Engineering managers want to see *how* candidates think with AI | Unfade Cards / Thinking Graph become hiring artifacts |
| **Context engineering emergence** | New discipline focused on persistent context across AI sessions | First-mover advantage in an emerging category |
| **Developer identity gap** | GitHub contribution graphs measure activity, not reasoning quality | Human Direction Score fills a market gap |

### 2.5 Why Now

The data already exists on every developer's machine. Claude Code stores full conversation transcripts at `~/.claude/projects/`. Cursor maintains a 113MB SQLite database with AI percentage per commit. Codex CLI writes structured session JSONL. This data is sitting unused — the first tool to analyze it meaningfully wins.

---

## 3. Problem Statement

### Current State (after Phase 0)

A buildable, lintable, testable skeleton with schemas, logger, and path utilities — but no capture, no daemon, no distillation. `./dist/cli.js --help` shows command stubs. Nothing actually works.

### After Phase 1

| Concern | State |
|---|---|
| **Capture — Git** | Real-time git watcher: commits, diffs, branch switches, reverts, stashes, merge conflicts as structured events |
| **Capture — AI Sessions** | Deep parsing of Claude Code JSONL (conversation trees via parentUuid chains), Cursor SQLite (AI percentage, conversation summaries), Codex CLI (structured sessions), Aider (markdown history) |
| **Capture — Terminal** | Shell hook integration capturing command execution with exit codes and duration |
| **Signal Hierarchy** | AI conversations = P0, terminal = P1, git commits = P2. Distill pipeline weights accordingly |
| **Human Direction Classification** | Hybrid heuristic + LLM engine. Heuristics handle 80%+ of classifications. LLM reserved for ambiguous cases |
| **Historical Ingest** | Background processing of past 1 week of AI session data by default. Extended timelines via `unfade ingest --since 30d` |
| **Event Storage** | Append-only JSONL at `.unfade/events/YYYY-MM-DD.jsonl` — plain text, inspectable, greppable |
| **Distillation** | Three-stage pipeline (extract, link, synthesize) producing Daily Distills with direction summaries |
| **Personalization Seed** | Running averages for alternatives evaluated, AI acceptance rate, domain distribution, HDS trend |
| **Intelligence Metrics** | Reasoning Depth Index (RDI) computed from existing distill data, identity labels, metric snapshots |
| **Init** | `npx unfade` scaffolds `.unfade/`, resolves capture engine binaries, installs shell hooks, starts daemon, triggers backfill + historical ingest, produces immediate first distill |

---

## 4. Research

### 4.1 Signal Hierarchy

| Source | What It Contains | Signal Quality |
|---|---|---|
| **Git commits** | Outcomes — what was shipped | **P2** — confirms a decision was made, but not why or what was considered |
| **AI conversation logs** | Actual reasoning — prompts, rejections, alternatives, direction changes | **P0** — the raw decision-making process |
| **Terminal commands** | Execution artifacts — build/test/deploy actions | **P1** — shows behavioral patterns |

The distill pipeline weights signals by priority. AI conversation turns showing decision-making (rejections, alternatives, direction changes) are weighted 3x over git commit messages. Git commits serve as **confirmation artifacts** — they validate that a decision was shipped, not that it was reasoned about.

### 4.2 AI Tool Data Inventory

Research conducted on a real developer machine (2026-04-17). All paths verified, schemas extracted from actual files.

#### Claude Code (`~/.claude/`)

| Aspect | Detail |
|---|---|
| **Session data** | `~/.claude/projects/<mangled-path>/<session-uuid>.jsonl` (4-24 MB per session) |
| **Format** | JSONL — one JSON object per line |
| **Key fields** | `type` (user/assistant/permission-mode), `message.role`, `message.content`, `uuid`, `parentUuid`, `timestamp`, `cwd`, `gitBranch`, `sessionId` |
| **Conversation structure** | `parentUuid` to `uuid` chains form conversation trees. `isSidechain` flag marks branched reasoning |
| **Reasoning signal** | HIGH — full user prompts, full assistant responses, tool use records, permission decisions, file diffs |

#### Cursor (`~/.cursor/`)

| Aspect | Detail |
|---|---|
| **Primary DB** | `~/.cursor/ai-tracking/ai-code-tracking.db` (SQLite, ~113 MB) |
| **Key tables** | `conversation_summaries` (HIGH — pre-summarized conversations), `scored_commits` (CRITICAL — `humanLinesAdded`, `composerLinesAdded`, `v2AiPercentage` per commit), `ai_code_hashes` (links code to conversations) |
| **Reasoning signal** | MEDIUM-HIGH — conversation summaries, AI percentage per commit, code attribution |

Cursor's `scored_commits` table already computes human vs. AI line percentages per commit. This is free Human Direction Classification data — no LLM needed.

#### Codex CLI (`~/.codex/`)

| Aspect | Detail |
|---|---|
| **Session data** | `~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<session-id>.jsonl` |
| **Key fields** | `type` (session_meta/response_item/event_msg), `timestamp`, `payload` |
| **Reasoning signal** | HIGH — full conversation transcripts with git context per session |

#### Aider (`.aider.chat.history.md`)

| Aspect | Detail |
|---|---|
| **Location** | Per-project: `.aider.chat.history.md` in project root |
| **Format** | Markdown — `#### <user prompt>` followed by assistant response blocks |
| **Reasoning signal** | MEDIUM — conversation text but no structured metadata |

#### Deferred Tools

- **Cline:** Task history in VS Code extension storage. DEFERRED — add parser when format stabilizes.
- **Windsurf:** Proprietary binary/encrypted session storage. WATCH — monitor for public API.
- **GitHub Copilot, Devin, SWE-Agent:** No local data. Use MCP Active Instrumentation (`unfade_log`) for these.

### 4.3 Data Volume Estimates

| Tool | Typical Size (1 week) | Events Extractable | Processing Time (est.) |
|---|---|---|---|
| Claude Code | 20-100 MB JSONL | 500-5000 conversation turns | 5-30s (stream parse) |
| Cursor | 113 MB SQLite (cumulative) | 100-1000 scored commits | 2-10s (SQL queries) |
| Codex CLI | 1-10 MB JSONL | 50-500 conversation turns | 1-5s (stream parse) |
| Aider | 0.5-5 MB Markdown | 20-200 conversation turns | 1-3s (regex parse) |

Total estimated ingest time for 1 week: 10-60 seconds background processing, no LLM calls required for raw extraction.

### 4.4 Capture Architecture Patterns

| Pattern | Choice | Rationale |
|---|---|---|
| **Process model** | Go capture engine as managed child process of TypeScript server | Server-first architecture: `unfade` starts HTTP server + MCP + one Go engine per registered repo. Ctrl+C stops cleanly |
| **File watching** | `fsnotify` (Go) | Cross-platform, no Node.js dependency at runtime |
| **Git operations** | `os/exec` to system `git` | Faster, lower memory than embedded git libraries |
| **Event format** | Structured JSONL with `CaptureEventSchema` (Zod) / `CaptureEvent` (Go struct) | Type-safe, append-only, human-readable |
| **IPC** | Unix domain socket (macOS/Linux) + named pipe (Windows) | Low-overhead, no port conflicts |
| **Resource budget** | <50MB RAM, <1% CPU idle | Capture engine must be invisible to developer |

### 4.5 Distillation Patterns

| Pattern | Choice | Rationale |
|---|---|---|
| **LLM integration** | Vercel AI SDK with `generateObject()` + Zod schemas | Provider-agnostic structured output |
| **Default provider** | Ollama (local-first) | Privacy-first, no API key required |
| **Fallback** | No LLM = structured signal summary without synthesis | Never block core functionality |
| **Output format** | Markdown in `.unfade/distills/YYYY-MM-DD.md` | Plain text, inspectable, greppable |

### 4.6 Ecosystem Standards

| Standard | Relationship to Unfade |
|---|---|
| **OpenTelemetry GenAI Conventions (v1.37+)** | Complementary — OTel instruments the AI system; Unfade instruments the human reasoning layer above it |
| **Cursor Agent Trace (v0.1.0)** | Complementary input — Agent Trace data enriches HDS scoring as another signal source |

---

## 5. Architecture

### 5.1 Process Model

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Unfade Server-First Architecture                    │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  unfade (TypeScript Server)                                    │   │
│  │  Bare `unfade` starts everything. Ctrl+C stops cleanly.       │   │
│  │                                                                │   │
│  │  ┌─────────────┐ ┌──────────┐ ┌─────────────┐ ┌──────────┐  │   │
│  │  │ HTTP Server  │ │ MCP      │ │ Materializer│ │ Distill  │  │   │
│  │  │ (Dashboard)  │ │ Server   │ │ (SQLite)    │ │ Pipeline │  │   │
│  │  └─────────────┘ └──────────┘ └─────────────┘ └──────────┘  │   │
│  └─────────────────────────┬──────────────────────────────────────┘   │
│                             │ spawns + manages                        │
│  ┌──────────────────────────▼─────────────────────────────────────┐   │
│  │  Go Capture Engine (managed child process, one per repo)       │   │
│  │                                                                │   │
│  │  ┌──────────┐ ┌────────────────┐ ┌──────────────────────────┐ │   │
│  │  │ Git      │ │ AISession      │ │ Terminal                 │ │   │
│  │  │ Watcher  │ │ Watcher        │ │ Receiver                 │ │   │
│  │  │(fsnotify)│ │(deep parsers)  │ │(shell hooks)             │ │   │
│  │  └────┬─────┘ └───────┬────────┘ └────────────┬─────────────┘ │   │
│  │       └───────────┬───┴───────────────────────┘               │   │
│  │                   ▼                                            │   │
│  │         ┌──────────────────┐                                   │   │
│  │         │ Heuristic        │  Pre-classifies direction signals │   │
│  │         │ Classifier (Go)  │  before writing to disk           │   │
│  │         └────────┬─────────┘                                   │   │
│  │                  ▼                                              │   │
│  │         ┌──────────────┐                                       │   │
│  │         │ EventWriter   │ → .unfade/events/YYYY-MM-DD.jsonl   │   │
│  │         └──────────────┘                                       │   │
│  │                                                                │   │
│  │  ┌──────────────────────────────────────────────────────────┐ │   │
│  │  │ HistoricalIngestor (background goroutine)                │ │   │
│  │  │ Runs once on init, 1 week default, rate-limited          │ │   │
│  │  └──────────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  .unfade/ is the communication bus:                                   │
│  Go writes events/  ←→  TypeScript reads events/                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Go Capture Engine

```
daemon/
├── cmd/
│   ├── unfaded/main.go              # Entry point — starts sources, IPC, health
│   └── unfade-send/main.go          # Shell hook helper binary
├── internal/
│   ├── capture/
│   │   ├── source.go                # CaptureSource interface
│   │   ├── event.go                 # CaptureEvent struct
│   │   ├── git.go                   # Git watcher (fsnotify + os/exec)
│   │   ├── ai_session.go            # AI session watcher (pluggable parsers)
│   │   ├── terminal.go              # Terminal event receiver
│   │   ├── orchestrator.go          # WatcherOrchestrator: sources → channels → writer
│   │   ├── writer.go                # EventWriter: append JSONL with O_APPEND
│   │   ├── debugging.go             # DebuggingDetector middleware
│   │   ├── historical.go            # HistoricalIngestor (background, rate-limited)
│   │   ├── ingest_state.go          # Resumable ingest progress tracking
│   │   ├── parsers/
│   │   │   ├── types.go             # AIToolParser interface, ConversationTurn, DirectionSignals
│   │   │   ├── claude_code.go       # JSONL parser, parentUuid tree builder
│   │   │   ├── cursor.go            # SQLite parser (pure Go, read-only)
│   │   │   ├── codex.go             # Session JSONL parser
│   │   │   └── aider.go             # Markdown regex parser
│   │   └── classifier/
│   │       ├── heuristic.go         # 8-signal weighted HDS computation
│   │       ├── patterns.go          # Negation/redirection pattern dictionary
│   │       ├── specificity.go       # Prompt specificity scorer
│   │       └── domain.go            # Domain knowledge injection detector
│   ├── platform/                    # PID, IPC, logger, health
│   └── health/                      # Resource budget enforcement
```

### 5.3 Deep AI Parsers

Each AI tool gets a dedicated parser implementing the `AIToolParser` interface:

```go
type AIToolParser interface {
    Name() string
    Discover() []DataSource
    Parse(source DataSource, since time.Time) ([]ConversationTurn, error)
    Tail(source DataSource, offset int64) ([]ConversationTurn, int64, error)
}
```

All parsers output normalized `ConversationTurn` structs — the classification engine works on the normalized form and does not care which tool produced the data.

**ConversationTurn** is the normalized intermediate representation shared by all parsers. It carries SessionID, ConversationID, TurnIndex, TotalTurns, Role, Content, Timestamp, GitBranch, ProjectPath, and ParentID.

### 5.4 Human Direction Classification Engine

The heuristic classifier computes a Human Direction Score (HDS) from conversation turns using 8 weighted signals:

| Signal | Detection Method | Weight |
|---|---|---|
| **Rejection count** | Negation patterns ("no", "don't", "instead", "not that") after assistant response | 0.20 |
| **Modification after acceptance** | User accepts then follows up with specific changes | 0.15 |
| **Prompt specificity** | Character count + technical term density in user prompts | 0.15 |
| **Domain knowledge injection** | Project-specific terms not present in prior assistant messages | 0.15 |
| **Conversation length** | Number of turns with substantive user input | 0.10 |
| **Alternative evaluation** | User explicitly compares approaches or evaluates trade-offs | 0.10 |
| **Course correction** | User changes direction mid-conversation | 0.10 |
| **AI percentage (Cursor-specific)** | `scored_commits.v2AiPercentage` — free data, already computed | 0.05 |

**Composite HDS:** Weighted sum normalized to 0.0-1.0.

| Range | Classification | Meaning |
|---|---|---|
| 0.0-0.3 | LLM-Directed | Developer accepted without steering |
| 0.3-0.6 | Collaborative | Meaningful back-and-forth |
| 0.6-1.0 | Human-Directed | Developer drove the decisions |

**Hybrid pipeline:** The heuristic pass runs in the Go daemon at ingest time (free, instant, deterministic). Cases with confidence "low" (HDS between 0.2 and 0.8) are queued for a batched LLM pass during daily distill — estimated 10-20% of decisions, yielding ~80% token reduction vs. an all-LLM approach.

### 5.5 Event Flow

```
Git commit / AI session change / Terminal command
        │
        ▼
┌──────────────────┐
│ CaptureSource    │  (Go: git.go, ai_session.go, terminal.go)
│ .Start(eventCh)  │  File watching via fsnotify + poll
└────────┬─────────┘
         │ CaptureEvent
         ▼
┌──────────────────┐
│ ingestCh         │  Buffered channel (256)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Middleware       │  DebuggingDetector for terminal events
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ EventWriter      │  O_APPEND to .unfade/events/YYYY-MM-DD.jsonl
└────────┬─────────┘
         │ (on schedule or manual trigger)
         ▼
┌──────────────────┐
│ Distill Pipeline │  (TypeScript)
│ extract → link   │
│ → classify → syn │  → .unfade/distills/YYYY-MM-DD.md
│ → profile → snap │  → .unfade/profile/reasoning_model.json
│ → notify         │  → .unfade/metrics/daily.jsonl
└──────────────────┘
```

### 5.6 Data Flow: AI Session to Reasoning Event

```
Claude Code JSONL                    CaptureEvent
┌─────────────────┐                 ┌────────────────────────────────┐
│ type: "user"     │                │ source: "ai-session"           │
│ message.content  │  ──parse──►   │ type: "ai-conversation"        │
│ uuid/parentUuid  │                │ content.summary: <extracted>   │
│ timestamp        │                │ content.detail: <conversation> │
│ gitBranch        │                │ gitContext: { branch, repo }   │
│ cwd              │                │ metadata: {                    │
└─────────────────┘                │   ai_tool: "claude-code",      │
                                    │   session_id: "...",           │
                                    │   direction_signals: {         │
                                    │     human_direction_score: 0.7,│
                                    │     confidence: "high"         │
                                    │   }                            │
                                    │ }                              │
                                    └────────────────────────────────┘
```

### 5.7 Historical Ingest Pipeline

The HistoricalIngestor runs as a background goroutine, triggered automatically on first start (1 week default). It discovers all AI tool data on disk, processes files via each parser's `Parse(since)` method, and writes events through the standard `ingestCh` channel. Rate-limited at 100 events/second to prevent I/O spikes. Progress is tracked in `.unfade/state/ingest.json` and is resumable — skips already-processed files.

Extended ingest (beyond 1 week) is available via `unfade ingest --since 30d` with an interactive prompt showing data discovery results, estimated time, and token cost (zero for extraction).

### 5.8 Git Signal Parser — Event Types

| Git Event | How Detected | CaptureEvent Type |
|---|---|---|
| **Commit** | `.git/` HEAD change via fsnotify | `commit` |
| **Branch switch** | HEAD ref change | `branch-switch` |
| **Revert** | Revert commit message pattern | `revert` |
| **Stash** | Stash ref change | `stash` |
| **Merge conflict** | Conflict markers in working tree | `merge-conflict` |

### 5.9 Distill Pipeline

```
src/services/distill/
├── distiller.ts               # Orchestrator: events → signals → link → synthesize → profile → metrics → notify
├── signal-extractor.ts        # Stage 1: events → ExtractedSignals (3x weight for AI sessions)
├── context-linker.ts          # Stage 2: attach git context, find AI conversations referencing same files
├── direction-classifier.ts    # LLM pass for ambiguous HDS cases (batched, 10-20%)
├── signal-fusion.ts           # Merge active (unfade_log) + passive (parser) signals
├── synthesizer.ts             # Stage 3: LLM synthesis or structured fallback
├── decision-records.ts        # Auto-generate lightweight ADRs for significant decisions
├── first-distill.ts           # Immediate first distill from backfill (no LLM required)
├── amplifier.ts               # Cross-session pattern detection
├── providers/
│   ├── types.ts
│   └── ai.ts                  # Vercel AI SDK (Ollama default, OpenAI, Anthropic)
```

### 5.10 Daily Distill Output

```markdown
# Daily Distill — 2026-04-14

## Decisions Made
- **Decision 1:** Chose Redis over Memcached for session caching
  - Alternatives evaluated: Redis, Memcached, in-memory Map
  - HDS: 0.82 (Human-Directed)
  - Evidence: Rejected LLM's Memcached suggestion, injected pub/sub requirement

## Trade-offs Navigated
- **Performance vs. Simplicity:** Accepted O(n) scan over adding index for <1000 items

## Dead Ends Explored
- **Tried:** Custom WebSocket auth middleware
  - **Abandoned because:** express-ws handles this natively
  - **Time spent:** ~40 minutes

## Breakthroughs
- **Insight:** JWT refresh can be handled in middleware, not per-route

## Human Direction Summary
- Average HDS: 0.72 (Human-Directed)
- Human-Directed: 5 decisions | Collaborative: 3 | LLM-Directed: 1
- Top human-directed: "Rejected singleton, steered toward DI for testability"

## AI Collaboration Summary
- Primary tool: Claude Code (12 sessions) | Secondary: Cursor (3 sessions)
- Direction style: Architectural Thinker

## Patterns (Personalization Seed)
- Alternatives evaluated per decision: 3.0
- Domains touched: backend infrastructure, authentication
- AI acceptance rate: 60% (modified 2 of 5 suggestions)
```

### 5.11 .unfade/ Communication Bus

The `.unfade/` directory is the communication bus between Go and TypeScript. One writer per file prevents corruption.

**Go daemon writes to:**
- `.unfade/events/YYYY-MM-DD.jsonl` (O_APPEND, <4KB per write)
- `.unfade/state/daemon.pid`
- `.unfade/state/health.json` (atomic: tmp + rename)
- `.unfade/state/ingest.json` (atomic: tmp + rename)

**TypeScript reads from events, writes to:**
- `.unfade/distills/YYYY-MM-DD.md`
- `.unfade/profile/reasoning_model.json`
- `.unfade/graph/decisions.jsonl`, `.unfade/graph/domains.json`
- `.unfade/metrics/daily.jsonl`
- `.unfade/decisions/DR-{date}-{seq}.md` (auto-generated decision records)

### 5.12 Key Data Contracts

The `CaptureEvent` Go struct in `daemon/internal/capture/event.go` mirrors the `CaptureEventSchema` Zod schema in `src/schemas/event.ts` — they MUST stay in sync.

AI session events carry standardized metadata:
- `ai_tool`: "claude-code" | "cursor" | "codex" | "aider"
- `session_id`, `conversation_id`, `turn_index`, `total_turns`
- `direction_signals`: rejection_count, modification_after_accept, prompt_specificity, domain_injection, alternative_evaluation, course_correction, human_direction_score, confidence

---

## 6. Design Principles

1. **AI conversations are the primary reasoning source.** Git commits confirm outcomes. Terminal shows behavior. AI conversations show thinking. Weight signals accordingly: AI sessions 3x, terminal 1.5x, git commits 1x.

2. **Heuristics first, LLM second.** Every classification starts with pattern matching. LLM is reserved for ambiguous cases. This is not a cost optimization — it is a reliability and speed optimization. Heuristics are instant, deterministic, and offline-capable.

3. **Capture engine is invisible.** The developer should forget the capture engine exists until the Daily Distill arrives. <50MB RAM, <1% CPU idle, no terminal output, no prompts.

4. **Events are append-only.** JSONL files are never modified after write. Backfill adds events, distillation reads events. No event is ever deleted or mutated.

5. **Capture is modular.** Each source (git, ai-session, terminal) implements `CaptureSource` interface independently. Each AI tool gets its own parser implementing `AIToolParser`. Adding a new source or parser never touches existing ones.

6. **Tool-specific parsers, normalized events.** Each AI tool has a dedicated parser that understands its format. All parsers output normalized `ConversationTurn` structs. The classification engine works on the normalized form.

7. **Distillation is idempotent.** Running `unfade distill` twice for the same day overwrites the distill file. No side effects beyond file write.

8. **Historical data is a gift, not a burden.** The first week of reasoning history already exists on disk. Process it automatically in the background. The user never waits for processing.

9. **Personalization is transparent.** Every pattern observation includes confidence level and supporting example count. The developer can inspect `reasoning_model.json` directly.

10. **Graceful degradation is mandatory.** No LLM = structured summary. No git = AI session only. No AI sessions = git only. No capture engine = CLI reads files directly.

11. **Non-blocking always.** Historical ingest runs in a background goroutine. Init completes immediately. Progress is tracked in a file and visible via `unfade` status.

12. **Scores inform, never punish.** Every metric is framed as a mode ("reflex mode," "exploration mode"), not a judgment. Low scores are paired with actionable improvement pathways.

---

## 7. Implementation Summary

### 7.1 Go Capture Engine Components

| Component | File | Purpose |
|---|---|---|
| **CaptureSource interface** | `daemon/internal/capture/source.go` | Common interface for all capture sources |
| **CaptureEvent struct** | `daemon/internal/capture/event.go` | Cross-language event contract (mirrors TypeScript Zod schema) |
| **GitWatcher** | `daemon/internal/capture/git.go` | fsnotify on `.git/`, os/exec to system git, backfill support |
| **AISessionWatcher** | `daemon/internal/capture/ai_session.go` | Pluggable parser dispatch, fsnotify + poll, offset tracking |
| **TerminalReceiver** | `daemon/internal/capture/terminal.go` | Unix socket receiver for shell hook events |
| **WatcherOrchestrator** | `daemon/internal/capture/orchestrator.go` | Manages sources, routes events through channels to EventWriter |
| **EventWriter** | `daemon/internal/capture/writer.go` | O_APPEND to daily JSONL files |
| **DebuggingDetector** | `daemon/internal/capture/debugging.go` | Middleware detecting debugging sessions from terminal events |
| **HistoricalIngestor** | `daemon/internal/capture/historical.go` | Background goroutine, rate-limited at 100 events/sec, resumable |
| **IngestStateManager** | `daemon/internal/capture/ingest_state.go` | Persists ingest progress atomically |
| **ClaudeCodeParser** | `daemon/internal/capture/parsers/claude_code.go` | JSONL parser, builds conversation trees from parentUuid chains |
| **CursorParser** | `daemon/internal/capture/parsers/cursor.go` | SQLite read-only queries for scored_commits + conversation_summaries |
| **CodexParser** | `daemon/internal/capture/parsers/codex.go` | Session JSONL parser with git context |
| **AiderParser** | `daemon/internal/capture/parsers/aider.go` | Markdown regex parser for chat history |
| **HeuristicClassifier** | `daemon/internal/capture/classifier/heuristic.go` | 8-signal weighted HDS computation |
| **Pattern dictionary** | `daemon/internal/capture/classifier/patterns.go` | Negation/redirection pattern matching |
| **Specificity scorer** | `daemon/internal/capture/classifier/specificity.go` | Prompt specificity analysis |
| **Domain detector** | `daemon/internal/capture/classifier/domain.go` | Domain knowledge injection detection |

### 7.2 TypeScript Distill Pipeline Components

| Component | File | Purpose |
|---|---|---|
| **Distiller** | `src/services/distill/distiller.ts` | Orchestrator: extract, link, classify, synthesize, profile, metrics, notify |
| **Signal extractor** | `src/services/distill/signal-extractor.ts` | Events to ExtractedSignals with 3x AI session weighting |
| **Context linker** | `src/services/distill/context-linker.ts` | Attach git context, find AI conversations for same files |
| **Direction classifier** | `src/services/distill/direction-classifier.ts` | Batched LLM pass for ambiguous HDS cases |
| **Signal fusion** | `src/services/distill/signal-fusion.ts` | Merge active (unfade_log) + passive (parser) signals |
| **Synthesizer** | `src/services/distill/synthesizer.ts` | LLM synthesis or structured fallback |
| **Decision records** | `src/services/distill/decision-records.ts` | Auto-generate lightweight ADRs |
| **First distill** | `src/services/distill/first-distill.ts` | Immediate distill from backfill (no LLM) |
| **Amplifier** | `src/services/distill/amplifier.ts` | Cross-session pattern detection |
| **Profile builder** | `src/services/personalization/profile-builder.ts` | Running averages, domain distribution, direction patterns |
| **RDI engine** | `src/services/intelligence/rdi.ts` | Reasoning Depth Index computation |
| **Identity labels** | `src/services/intelligence/identity.ts` | Pattern-to-label mapping |
| **Metric snapshots** | `src/services/intelligence/snapshot.ts` | Daily append-only metric history |
| **Nudge engine** | `src/services/intelligence/nudges.ts` | Rule-based post-distill insights |
| **LLM providers** | `src/services/distill/providers/ai.ts` | Vercel AI SDK (Ollama, OpenAI, Anthropic) |

---

## 8. Success Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **Time to first distill** | < 2 minutes from `npx unfade` | Init, backfill, immediate first distill |
| **Capture engine memory** | < 50 MB RSS | Go daemon health reporting |
| **Capture engine CPU (idle)** | < 1% | Go daemon health reporting |
| **Event capture latency** | < 1 second from git commit to JSONL write | Timestamp comparison |
| **AI session events captured** | 50+ per active day | Event count with `source: "ai-session"` |
| **Conversation structure** | Multi-turn conversations reconstructed | Events with valid `conversation_id` + `turn_index` |
| **HDS accuracy** | >80% agreement with manual classification | Manual review of 50 classified decisions |
| **LLM token reduction** | <20% of decisions use LLM for classification | Token count logging |
| **Historical ingest (1 week)** | 100+ events, <60s processing | Timer in ingest progress |
| **Distillation time** | < 60 seconds with local LLM | Timer in distiller |
| **Distill quality** | Sections match actual work | Manual review of 5 consecutive distills |
| **RDI computed** | Score on every distill | `uifMetrics.rdi` in profile |
| **Identity labels** | 2+ labels after 2 weeks | `identityLabels` array in profile |
| **Decision records** | 2-5 per active day | File count in `.unfade/decisions/` |
| **Daemon uptime** | Survives 8-hour workday | PID check after 8 hours |

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Ollama not installed** | High | Medium | Silent detection during init. Default to structured summaries. Never block core functionality |
| **AI tool log format changes** | Medium | High | Each tool has its own parser — format change affects only one. Version-check on known formats, fallback to raw extraction |
| **Cursor SQLite locked by Cursor** | Medium | Medium | Open in read-only mode (`?mode=ro`). SQLite WAL allows concurrent readers. Retry with backoff |
| **Claude Code JSONL files are large (4-24MB)** | High | Low | Stream parsing (line-by-line), never load full file. Offset tracking prevents re-processing |
| **Heuristic classifier false positives** | Medium | Medium | Conservative thresholds — high confidence only at extremes (HDS < 0.2 or > 0.8). Middle ground goes to LLM pass |
| **Capture engine crashes** | Medium | Medium | Platform manager (launchd/systemd) handles auto-restart. Health reporting via IPC. TUI detects stale PID |
| **Large git history** | Low | Low | Backfill is async with progress. Cap at 30 days default. Stream events, don't buffer |
| **Disk space from JSONL growth** | Low | Low | Events ~200 bytes each. 1000/day = ~200KB/day. Rotation at 90 days |
| **Multiple git repos** | Medium | Medium | Single daemon watches all registered repos. Events tagged with `gitContext.repo` |
| **Cross-platform IPC** | Medium | Medium | Go daemon abstracts: Unix socket (macOS/Linux), named pipe (Windows). Fallback: TCP on localhost |
| **Go binary distribution** | Medium | Medium | Pre-built binaries for macOS/Linux (arm64, amd64). Checksum verification. Fallback: build from source |
| **Personalization seed feels generic** | Medium | Medium | Invest in signal extraction quality. Count actual alternatives from branches/reverts. Track actual AI acceptance from session logs |
| **Aider history files scattered** | Medium | Low | Only scan registered project directories from registry |
| **Pure Go SQLite performance** | Low | Low | Read-only queries on small result sets. Eliminates CGo cross-compilation headaches |

---

> **Next phase:** Phase 2 — Context & Integration (HTTP API, MCP server, context injection for every AI tool)

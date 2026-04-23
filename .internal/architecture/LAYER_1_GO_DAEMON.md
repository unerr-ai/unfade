# Layer 1: Go Daemon (`unfaded`)

Pure data fetcher. Discovers developer activity (git, AI sessions, terminal), reads raw data, writes structured JSONL events to `~/.unfade/events/`. Zero analysis — all intelligence lives downstream.

---

## 1. Lifecycle: Launch, Run, Kill, Consume

### Who Launches It

`unfade-server.ts` → `RepoManager` → `EmbeddedDaemon` spawns Go binaries as child processes.

```
ON "unfade" command:
    unfade-server.ts starts
    → RepoManager created
    → FOR EACH repo in registry.v1.json:
          spawn "unfaded --capture-mode=git-only --project-dir=<root>"
    → ONCE globally:
          spawn "unfaded --capture-mode=ai-global"
    → FOR EACH daemon:
          send IPC { cmd: "ingest" }     # Triggers historical backfill
```

**Spawn mode**: Non-detached child process. stderr piped for logging. Lifecycle tied to parent Node process.

**Crash recovery**: Exponential backoff (1s, 2s, 4s… cap 30s). Resets after 60s stable uptime.

### What Happens on Launch

```
FIRST RUN (no ingest.json exists):
    State = "idle"
    → Collect ALL available history (since epoch)
    → Live watchers start from current EOF (no duplicates)

SUBSEQUENT RUN (ingest.json has "completed"):
    → Collect data since last CompletedAt timestamp
    → Live watchers resume from current EOF

SUBSEQUENT RUN (ingest.json has "failed"):
    → Retry full collection (since epoch)
```

### Who Kills It

1. **Ctrl+C on `unfade`**: Server catches SIGINT → calls `EmbeddedDaemon.stop()` → sends SIGTERM → waits 5s → SIGKILL if stuck
2. **IPC stop**: `{ cmd: "stop" }` over Unix socket → daemon self-terminates
3. **Parent exit**: Non-detached child dies with parent

**Shutdown order**: IPC server → orchestrator (drains pipeline) → health reporter → PID lock release

### Where It Writes

```
~/.unfade/events/YYYY-MM-DD.jsonl          # Date-partitioned event files (O_APPEND atomic writes)
~/.unfade/state/daemons/<id>/daemon.pid    # PID lock (flock)
~/.unfade/state/daemons/<id>/daemon.sock   # IPC Unix socket
~/.unfade/state/daemons/<id>/daemon.log    # Rotating log (10MB, 3 copies)
~/.unfade/state/ingest.json                # Historical ingest state machine
```

### Who Reads Its Output

**Materializer** (TypeScript, `src/services/materializer/`):
- Tails `~/.unfade/events/*.jsonl` using cursor offsets (`~/.unfade/state/materializer.json`)
- Ingests into SQLite (`~/.unfade/cache/unfade.db`) with `project_id` indexes
- Respects `.ingest.lock` — defers processing during bulk historical ingest

---

## 2. Capture Modes

| Mode | Flag | Sources | Instances | Purpose |
|---|---|---|---|---|
| `git-only` | `--capture-mode=git-only` | GitWatcher + TerminalReceiver | One per repo | Watches single repo's `.git/` |
| `ai-global` | `--capture-mode=ai-global` | AISessionWatcher | One per machine | Watches all AI tool dirs globally |
| `full` | `--capture-mode=full` | All sources | Testing only | Integration tests |

**Why split**: One git watcher per repo (scoped), but AI tools store data globally — a single AI watcher prevents duplicate capture.

---

## 3. Event Pipeline

```
Sources (goroutines)        Middleware (goroutine)      Writer (goroutine)
┌─────────────┐
│ GitWatcher   │──┐
├─────────────┤  │      ┌─────────────┐      ┌─────────────┐
│ AISession    │──┼──→   │ ingestCh    │──→   │ writerCh    │──→  ~/.unfade/events/YYYY-MM-DD.jsonl
├─────────────┤  │      │ (buf: 256)  │      │ (buf: 256)  │
│ Terminal     │──┘      │ stamp       │      │ JSON marshal│
├─────────────┤         │ ProjectID   │      │ O_APPEND    │
│ Historical   │──┘      └─────────────┘      └─────────────┘
└─────────────┘
```

**Middleware**: Reads ingestCh → stamps `event.ProjectID` via ProjectMatcher → forwards to writerCh. Drains remaining events on shutdown.

**Writer**: Single goroutine. `O_APPEND | O_CREATE | O_WRONLY` — atomic appends, no locks. Materializer safely tails concurrently (read-only).

---

## 4. Capture Sources

### 4.1 GitWatcher

**Watches**: `<repo>/.git/`, `refs/heads/`, `refs/stash` via fsnotify (debounced 500ms).

**Detects**: commits (diff stat + changed files), branch switches, merge conflicts, stashes.

**Backfill**: `since=zero` → `git log --reverse` (ALL history, no --after flag). `since=<time>` → `git log --after=<time>`.

**Events**: source=`"git"`, types: `commit`, `branch-switch`, `merge-conflict`, `stash`.

### 4.2 AISessionWatcher

**Architecture**: Holds N parsers (one per AI tool). Each parser implements Discover/Tail/Parse.

**Startup**: Discover all data sources → seek to EOF (live starts from NOW) → set up fsnotify on parent dirs.

**Watch loop**: Combines fsnotify events (debounced 1s) + polling fallback (10s interval).

```
scanAndEmit():
    FOR EACH parser:
        sources = parser.Discover()    # Re-discover (new sessions appear)
        FOR EACH source:
            turns, new_offset = parser.Tail(source, stored_offset)
            events = TurnsToEvents(turns, parser.Name())
            Send each event to ingestCh
```

**TurnsToEvents**: Groups turns by ConversationID → builds raw CaptureEvent per conversation. No classification.

**Event assembly** (per conversation):
- `content.summary` = first user prompt (200 chars)
- `content.detail` = concatenated "role: content" for all turns
- `metadata.conversation_title` = parser-provided title (Cursor), or first user prompt truncated to 200 chars (fallback)
- `metadata.turns` = raw turn array [{role, content, turn_index, timestamp, tool_use}]
- `metadata.prompt_full` = first user prompt (up to 10KB)
- `metadata.prompts_all` = all user prompts (max 20, 5KB each)
- `metadata.files_referenced` / `files_modified` / `tool_calls_summary` = extracted from tool_use blocks

### 4.3 TerminalReceiver

**Listens**: Unix socket at `<terminal-socket-path>`. Shell hooks send `{cmd, exit, duration, cwd}` JSON after each command.

**Events**: source=`"terminal"`, type=`"command"`. 5s read deadline per connection.

---

## 5. AI Tool Parsers

All implement: `Discover() → []DataSource`, `Tail(source, offset) → turns, new_offset`, `Parse(source, since) → turns, offset`.

| Parser | Data Location | Format | Incremental Key | Special |
|---|---|---|---|---|
| **Claude Code** | `~/.claude/projects/<mangled-path>/*.jsonl` | JSONL | byte offset | Builds conversation trees from `parentUuid`/`uuid` chains. Decodes project path from mangled dir name. Filters out non-conversation types (permission-mode, file-history-snapshot). |
| **Cursor** | `~/.cursor/ai-tracking/ai-code-tracking.db` | SQLite | rowid watermark | Reads `conversation_summaries` + `scored_commits` tables. `WHERE rowid > ?` for incremental. |
| **Codex** | `~/.codex/sessions/<id>/response_item.jsonl` | JSONL | byte offset | Flat JSONL, no tree building needed. |
| **Aider** | `<project>/.aider.chat.history.md` | Markdown | byte offset | Project-scoped (not global). `####`/`>` delimit turn boundaries. |

**Zero-since behavior** (all parsers): `since=time.Time{}` (epoch) → read ALL data, no timestamp filter. Enables full history capture on first run.

---

## 6. Historical Ingest

**Purpose**: Collects data created *before* the daemon started watching. Fills in the past on first install.

### State Machine

```
idle/failed  ──[start]──→  running  ──[success]──→  completed
                              │                         │
                           [error]                 [next launch]
                              │                         │
                              ▼                         ▼
                           failed              ingest since CompletedAt
```

Persisted to `~/.unfade/state/ingest.json` via atomic temp-file + rename.

### Execution

```
Run(since):
    IF already running: no-op
    Set state = "running"
    Write .ingest.lock to events dir    # Tells materializer to defer

    FOR EACH parser:
        FOR EACH source in parser.Discover():
            IF already processed (in state.processed map): skip
            turns = parser.Parse(source, since)
            events = TurnsToEvents(turns)
            FOR EACH event:
                Rate limit: 100 events/sec
                Send to ingestCh
            Mark source as processed, persist state

    ON success: state = "completed", remove .ingest.lock
    ON error: state = "failed", remove .ingest.lock
```

**Rate limit (100/sec)**: Prevents flooding the channel during bulk ingest, leaving headroom for concurrent live events.

**Crash recovery**: `state.processed` map tracks per-file completion. On restart, already-processed files are skipped.

---

## 7. Project Matching

**Purpose**: Maps filesystem paths to projectIds from `~/.unfade/state/registry.v1.json`.

**Algorithm**: Longest-prefix match. Entries sorted by path length descending → first match wins (most specific project).

**Fallback**: No match → `"unregistered:<path>"`.

**Applied in**: Middleware, using `event.Content.Project` (from AI tools) or `--project-dir` (git-only mode).

---

## 8. IPC Protocol

Unix socket at `~/.unfade/state/daemons/<id>/daemon.sock`. Single request-response per connection.

| Command | Args | Response | Notes |
|---|---|---|---|
| `status` | — | uptime, events_today, sources | Server polls for health |
| `stop` | — | `{"status":"stopping"}` | Triggers full shutdown |
| `backfill` | `days?` (optional) | event count | Zero/omitted = all git history |
| `ingest` | `days?` (optional) | ok | Zero/omitted = state-machine decides |
| `ingest-status` | — | state, total_events, sources | Dashboard shows progress |
| `terminal-event` | cmd, exit, duration, cwd | ok | Alternative to TerminalReceiver socket |
| `distill` | date | ok | Forwarded to Node.js server |

---

## 9. Event Schema & Dimensions

```
CaptureEvent:
    id         : UUID v4
    projectId  : from ProjectMatcher
    timestamp  : RFC3339
    source     : "git" | "ai-session" | "terminal"
    type       : "commit" | "branch-switch" | "merge-conflict" | "stash" |
                 "ai-conversation" | "command"
    content    : { summary, detail, files[], branch, project }
    gitContext  : { repo, branch, commitHash }     # git events only
    metadata   : source-specific key-value map
```

### 9.1 Common Dimensions (all events)

| Dimension | Field | Description |
|---|---|---|
| Event ID | `id` | UUID v4 — unique per event |
| Project | `projectId` | Resolved by ProjectMatcher from registry |
| Project path | `content.project` | Raw filesystem path to repo root |
| Time | `timestamp` | RFC3339 — when the activity occurred |
| Source tool | `source` | `"git"`, `"ai-session"`, `"terminal"` |
| Event type | `type` | Subtype within source (see Section 4) |
| Summary | `content.summary` | Short description (commit subject / first prompt / command) |
| Detail | `content.detail` | Extended content (diff stat / full conversation / exit+duration) |
| Files | `content.files[]` | Affected file paths |
| Branch | `content.branch` | Git branch name (if available) |

### 9.2 Git Dimensions

| Dimension | Field |
|---|---|
| Repo name | `gitContext.repo` |
| Branch | `gitContext.branch` |
| Commit hash | `gitContext.commitHash` |
| Is backfill | `metadata.backfill` (boolean, only on backfilled commits) |

### 9.3 AI Session Dimensions

| Dimension | Field | Description |
|---|---|---|
| AI tool | `metadata.ai_tool` | Which tool: `"claude-code"`, `"cursor"`, `"codex"`, `"aider"` |
| Session ID | `metadata.session_id` | Tool-specific session/window identifier |
| Conversation ID | `metadata.conversation_id` | Unique conversation within a session |
| Conversation title | `metadata.conversation_title` | Human-readable name for the chat window (see below) |
| Turn count | `metadata.turn_count` | Total turns (user + assistant) |
| Model | `metadata.model_id` | AI model used (e.g., `"claude-sonnet-4-6-20250514"`) |
| Environment | `metadata.environment` | IDE/environment info |
| Repo root | `metadata.repo_root` | Full filesystem path to repo |
| Repo name | `metadata.repo_name` | Basename of repo |
| Sequence | `metadata.sequence_id` | Ordering within session |
| First prompt | `metadata.prompt_full` | First user prompt (up to 10KB) |
| All prompts | `metadata.prompts_all` | All user prompts (max 20, 5KB each) |
| Prompt count | `metadata.prompt_count` | Number of user turns |
| Prompt times | `metadata.prompt_timestamps` | RFC3339 timestamps per user turn |
| Files read | `metadata.files_referenced` | From Read/Grep/Glob tool call inputs |
| Files written | `metadata.files_modified` | From Edit/Write tool call inputs |
| Tool usage | `metadata.tool_calls_summary` | Tool name + target summaries |
| Raw turns | `metadata.turns[]` | Full conversation: `[{role, content, turn_index, timestamp, tool_use}]` |

**`conversation_title` source by tool**:

| Tool | Title Source | Notes |
|---|---|---|
| Cursor | Native `title` column from `conversation_summaries` table | Real title set by Cursor UI |
| Claude Code | First user prompt, truncated to 200 chars | No native title — sessions are UUID-named JSONL files |
| Codex | First user prompt, truncated to 200 chars | No native title concept |
| Aider | First user prompt, truncated to 200 chars | No native title — one markdown file per project |

### 9.4 Terminal Dimensions

Terminal events are minimal: `source="terminal"`, `type="command"`, with command text, exit code, duration, and cwd in content fields. No extra metadata.

---

## 10. Key Design Decisions

| Decision | Why |
|---|---|
| **Pure fetcher, zero analysis** | Keyword heuristics on prompt content produce false positives. Analysis belongs in materializer where conversation *structure* is available. |
| **Channels over mutexes** | ingestCh/writerCh naturally serialize access. No deadlocks, no data races. |
| **Dual pipeline (live + historical)** | Live needs speed; historical needs crash recovery. Both feed same ingestCh. |
| **State-driven ingest** | First run = all history. Restart = since CompletedAt. No hardcoded time windows. |
| **O_APPEND atomic writes** | OS-level guarantee. No file locks. Materializer safely tails concurrently. |
| **Ingest lock file** | Prevents materializer from processing partial bulk ingest. |
| **Non-detached child process** | Daemon dies with parent Node server. No orphan processes. |
| **Exponential backoff restart** | 1s→2s→4s…30s cap. Resets after 60s stable. Handles transient failures without thrashing. |

---

## Appendix: File Map

| File | Purpose |
|---|---|
| `daemon/cmd/unfaded/main.go` | Entry point, flags, PID lock, IPC server, signal handler |
| `daemon/internal/capture/orchestrator.go` | Mode-based source selection, middleware, state-driven ingest |
| `daemon/internal/capture/git.go` | fsnotify watcher, commit detection, backfill |
| `daemon/internal/capture/ai_session.go` | AI tool discovery, tailing, TurnsToEvents |
| `daemon/internal/capture/terminal.go` | Unix socket listener for shell hooks |
| `daemon/internal/capture/writer.go` | Single-goroutine JSONL writer |
| `daemon/internal/capture/historical.go` | Background bulk ingest, rate limiting |
| `daemon/internal/capture/ingest_state.go` | State machine persistence, crash recovery |
| `daemon/internal/capture/project_matcher.go` | Registry path → projectId resolution |
| `daemon/internal/capture/event.go` | CaptureEvent struct definitions |
| `daemon/internal/capture/parsers/*.go` | Per-tool parsers (claude_code, cursor, codex, aider) |
| `src/services/daemon/embedded-daemon.ts` | TypeScript side: spawn, crash recovery, SIGTERM/SIGKILL |
| `src/services/daemon/repo-manager.ts` | Orchestrates per-repo + global daemon lifecycle |
| `src/server/unfade-server.ts` | Server startup: spawns all daemons, triggers ingest |

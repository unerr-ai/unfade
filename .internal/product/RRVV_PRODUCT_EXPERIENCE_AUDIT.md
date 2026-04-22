# RRVV Product Experience Audit & Redesign Strategy

## Reference: What Unfade Actually Does (Grounded in Code)

Before the audit, here is what the system actually does as built — not aspirational, but as-shipped code.

### The 5-Layer Pipeline (Actual Implementation)

**Layer 1 — Capture (Go daemon: `daemon/`)**
Two binaries (`unfaded`, `unfade-send`). Two capture modes:
- `git-only` (one per repo): fsnotify on `.git/`, `.git/refs/heads/`, `.git/refs/stash/`. 500ms debounce. Emits: `commit`, `revert`, `branch-switch`, `merge-conflict`, `stash`. Backfill walks `git log --after=<date>`. (`daemon/internal/capture/git.go`)
- `ai-global` (one global instance): 10s poll on `~/.claude/`, Cursor, Codex, Aider directories. Monotonic session sequence counters persisted to `sequences.json`. Parses AI tool conversation files into structured events with `intent_summary`, `outcome`, `model`, `tokens_in/out`. (`daemon/internal/capture/ai_session.go`)

All events written as date-partitioned JSONL to `~/.unfade/events/`. Each event: `{id, projectId, timestamp, source, type, content: {summary, detail, files, branch, project}, gitContext, metadata}`.

**Layer 2 — Materialization (`src/services/cache/materializer.ts`)**
Incremental tail-read of JSONL past cursor byte offset into SQLite. 13 tables: `events`, `decisions`, `decisionEdges`, `metricSnapshots`, `directionWindows`, `comprehensionProxy`, `comprehensionByModule`, `directionByFile`, `tokenProxySpend`, `eventInsightMap`, `features`, `eventFeatures`, `eventLinks`. Runs on tick, writes cursor state for crash recovery.

**Layer 3 — Intelligence (`src/services/intelligence/engine.ts`)**
8 analyzers run after materializer tick, throttled to 10s:
- **Efficiency** (AES): Composite 0-100 = Direction(30%) + TokenEfficiency(20%) + IterationRatio(20%) + ContextLeverage(15%) + ModificationDepth(15%). Phase-normalized, outcome-adjusted.
- **Comprehension Radar**: Per-module comprehension with blind spot detection (threshold 40, min 5 events).
- **Cost Attribution**: Token spend tracking, cost-per-directed-decision.
- **Loop Detector**: Cosine similarity (0.7 threshold) on low-direction sessions. Stuck loops = 3+ similar failures on same approach.
- **Velocity Tracker**: Turns-to-acceptance per domain, midpoint split, trend detection.
- **Prompt Patterns**: Domain-specific effective/anti-patterns from AI interactions.
- **Blind Spots**: Sustained low-comprehension modules over 2+ weeks.
- **Decision Replay**: Resurfaces past decisions when new contradictory evidence appears.

**Layer 4 — Distill Pipeline (`src/services/distill/distiller.ts`)**
events → extractSignals → linkContext → synthesize → write markdown → update profile → update graph → notify. Two paths: LLM-powered (Anthropic/OpenAI/Ollama) and heuristic fallback. Outputs: `DailyDistill` with `summary, decisions[], tradeOffs[], deadEnds[], breakthroughs[], patterns[], domains[]`.

**Layer 5 — Surfaces**
- **HTTP Server** (Hono on localhost:7654): 19 page routes, 26+ API routes, SSE stream. Server-rendered HTML + htmx + inline JS. (`src/server/http.ts`)
- **MCP Server**: 7 tools (`unfade_query`, `unfade_context`, `unfade_decisions`, `unfade_profile`, `unfade_distill`, `unfade_amplify`, `unfade_log`) for IDE integration.
- **CLI**: 15 commands (`add`, `reset`, `status`, `distill`, `query`, `card`, `export`, `doctor`, `publish`, `prompt`, `ingest`, `history`, `savings`, `daemon`, `mcp`).

### What Makes Unfade Novel

Unlike Datadog (monitors infrastructure health), Unfade monitors **engineering reasoning health**:
- It captures the *why* behind code changes — not just that a commit happened, but the AI conversation that led to it, the alternatives considered, the trade-offs made
- It detects patterns in *how you think* — your decision style, your domain depth, your AI collaboration efficiency
- It compounds over time — today's captured reasoning becomes tomorrow's queryable context that any AI tool can access via MCP
- The "Direction" metric (HDS) measures how much *you* are directing vs. passively accepting AI output — a metric that doesn't exist anywhere else

---

## What Unfade Actually Does — Grounded in Code (Original Analysis)

> *This is the original response to the prompt "understand the current codebase by going through the recent phase 11, 12, 13, 14, 15 — and necessary code we have developed what unfade does and how?" with the Datadog comparison context. Recovered from conversation transcript.*

### The Core Idea

Unfade passively watches your developer workflows (git, AI tools, terminal) and builds a **reasoning profile** — not what code you wrote, but *why* you made the decisions you did. Think of it as Datadog for your engineering thinking, not your infrastructure.

### Layer 1: Capture (Go daemon — `daemon/`)

**What actually exists:** Two Go binaries (`unfaded`, `unfade-send`) with 48 `.go` files.

The daemon runs in two modes (`orchestrator.go:26-27`):
- **`git-only`** — one per repo. Watches `.git/` via fsnotify for commits, branch switches, reverts, stashes, merge conflicts (`git.go`). Debounces at 500ms.
- **`ai-global`** — one global instance. Watches `~/.claude/`, Cursor, Codex, Aider session files (`ai_session.go`). Has parsers for each tool (`parsers/claude_code.go`, `parsers/cursor.go`, `parsers/aider.go`, `parsers/codex.go`).

**Output:** Every captured event becomes a `CaptureEvent` JSON line (`event.go:10-18`) written to `~/.unfade/events/YYYY-MM-DD.jsonl`. Each event has: `id`, `projectId`, `timestamp`, `source` (git/ai-session/terminal), `type` (commit/diff/branch-switch), `content` (summary + detail + files), and optional `gitContext`.

The daemon also has a `classifier/` package that heuristically tags events with domains and computes a "specificity" score — how much human direction an event shows vs. pure AI generation.

### Layer 2: Materialization (TypeScript — `src/services/cache/`)

**What actually exists:** `materializer.ts` does incremental JSONL tail-reads past a cursor byte offset, upserting into SQLite (`unfade.db`).

**13 SQLite tables** (`schema.ts`):
- `events` — raw events indexed by timestamp and source
- `decisions` — extracted decisions with domain, rationale, alternatives count, HDS (Human Direction Score), direction class
- `decision_edges` — graph edges between related decisions
- `metric_snapshots` — daily RDI, DCS, AQ, CWI, API scores
- `direction_windows` — rolling direction density windows (24h, 7d, etc.)
- `comprehension_proxy` / `comprehension_by_module` — per-event and per-module comprehension scores
- `direction_by_file` — direction density per file path
- `token_proxy_spend` — estimated AI token costs per model per day
- `event_insight_map` — bidirectional event↔insight lineage
- `features` / `event_features` — detected feature boundaries
- `event_links` — temporal chains between events

The materializer also handles `decisions.jsonl` from the graph dir and daily metric snapshots.

### Layer 3: Distillation (`src/services/distill/`)

**The actual pipeline** (`distiller.ts:4`):
```
events → extractSignals → linkContext → synthesize → write distill → update graph → update profile → notify
```

**What gets produced** (`distill.ts` schema): A `DailyDistill` containing:
- `summary` — narrative of the day
- `decisions[]` — each with decision text, rationale, domain, alternatives considered
- `tradeOffs[]` — what you chose vs. rejected and why
- `deadEnds[]` — things you tried that didn't work, with time spent
- `breakthroughs[]` — unexpected insights
- `directionSummary` — how much was human-directed vs. collaborative vs. LLM-directed
- `aiCollaborationSummary` — tool breakdown per AI tool

Two synthesis paths: LLM-powered (uses configurable provider — Anthropic/OpenAI/Ollama) or `provider: null` fallback synthesizer (heuristic-only, zero cost). `distillIncremental()` runs the fallback path immediately; the scheduled LLM run overwrites with higher quality.

### Layer 4: Intelligence (8 Analyzers — `src/services/intelligence/analyzers/`)

The `IntelligenceEngine` (`engine.ts`) runs all 8 analyzers after each materializer tick, throttled to every 10s. Each writes a JSON file to `~/.unfade/intelligence/`. They are:

1. **`efficiency`** — AES (AI Efficiency Score) 0-100. Composite of Direction Density (30%), Token Efficiency (20%), Iteration Ratio (20%), Context Leverage (15%), Modification Depth (15%). Phase-normalized so debugging sessions aren't penalized.

2. **`comprehension-radar`** — Per-module comprehension scoring with blind spot detection. Uses phase baselines so low HDS during debugging doesn't false-positive.

3. **`cost-attribution`** — Token spend proxy per model per day, estimated costs.

4. **`loop-detector`** — Finds stuck patterns: 3+ similar low-direction sessions on the same approach. Uses cosine similarity (threshold 0.7) against past rejections.

5. **`velocity-tracker`** — Turns-to-acceptance per domain over time. Detects acceleration/deceleration trends.

6. **`prompt-patterns`** — Analyzes how you interact with AI tools.

7. **`blind-spots`** — Detects under-explored areas of the codebase.

8. **`decision-replay`** — Indexes decisions for replay and cross-referencing.

**Additional intelligence services** (not analyzers but computed on demand):
- `narrative-synthesizer.ts` — generates plain-language insight claims
- `lineage.ts` — bidirectional event↔insight mapping (the "Why?" drillthrough)
- `summary-writer.ts` — writes `summary.json` on every materializer tick (the heartbeat that powers the dashboard first-paint)
- `domain-tagger.ts`, `rdi.ts`, `methodology.ts`, `identity.ts`, `nudges.ts`

### Layer 5: API + Dashboard (`src/server/`)

**HTTP server** (`http.ts`): Hono on `localhost:7654`. Server-rendered HTML + htmx + SSE. No SPA framework.

**Actual pages that exist** (21 page files):
- `/` — Home: system health dots (SSE/Capture/Materializer/Intelligence), live event stream, 4 metric cards (Direction %, Events 24h, Comprehension, Cost est.), recent narratives, quick action links
- `/setup` — First-run onboarding with setup wizard
- `/intelligence` — Intelligence Hub with tabs: overview, cost, patterns, velocity, comprehension (merged from previously separate pages)
- `/distill` — Daily distill viewer
- `/decisions` — Decision browser
- `/profile` — Reasoning profile/identity
- `/cards` — Unfade Cards (visual reasoning identity)
- `/live` — Real-time event stream
- `/logs` — System logs
- `/projects` — Multi-project view
- `/settings` — Configuration
- `/integrations` — MCP/tool integration status
- `/coach` — Coaching insights (redirects to intelligence?tab=patterns)
- `/alerts` — Alert patterns (redirects to intelligence?tab=patterns)
- `/search` — Redirects to /decisions

**26 API route files** under `src/server/routes/` including: summary, stream (SSE), intelligence, decisions, distill, profile, lineage, heatmap, system-health, insights, projects, etc.

**The SSE stream** (`routes/stream.ts`) pushes real-time events to the browser. The home page hooks into `window.__unfade.onEvent`, `window.__unfade.onSummary`, `window.__unfade.onHealth` callbacks.

### Layer 6: MCP Server (`src/services/mcp/`)

7 MCP tools exposed for IDE integration:
1. `unfade_query` — semantic search across reasoning history
2. `unfade_context` — recent reasoning context (last 2h / today / this week)
3. `unfade_decisions` — list decisions with rationale
4. `unfade_profile` — reasoning profile
5. `unfade_distill` — trigger manual distillation
6. `unfade_amplify` — cross-temporal connection detection
7. `unfade_log` — log a reasoning event from an external tool

Plus 5 resources and 3 prompts. All return the `{ data, _meta }` envelope with degraded mode.

### Layer 7: CLI Commands (`src/commands/`)

15 commands total: `unfade` (bare — starts server), `add`, `reset`, `status`, `distill`, `query`, `card`, `export`, `doctor`, `publish`, `prompt`, `ingest`, `history`, `savings`, `daemon` (status/stop/restart/update), `mcp` (hidden).

### Developer Profile (`src/schemas/profile.ts`)

The profile built over time includes:
- **Patterns** — detected reasoning patterns with confidence (categories: decision_style, trade_off, domain, ai_interaction, exploration)
- **Domain distributions** — which areas you work in, with depth level (shallow/moderate/deep) and trend (stable/deepening/broadening)
- **Trade-off preferences** — consistent choices you make (e.g., "prefers simplicity over configurability")
- **Identity labels** — behavioral traits surfaced from patterns

### How It All Connects (actual startup sequence)

When you run `unfade` (`cli.ts:214`):
1. `ensureInit(cwd)` — creates `~/.unfade/` structure, writes `.unfade` marker file
2. `startUnfadeServer(cwd)` — starts HTTP server on :7654, starts `RepoManager`
3. RepoManager starts a global AI capture daemon + one git-only daemon per registered repo
4. Each repo gets a materializer (JSONL → SQLite) running on a tick interval
5. Intelligence engine runs 8 analyzers after each materializer tick
6. `summary-writer.ts` computes `summary.json` (the heartbeat) each tick
7. SSE pushes events + summary to the browser
8. Backfill distill runs for any event dates missing distills
9. Ctrl+C triggers orderly shutdown: stop schedulers → final materialization → save cursors → stop daemons → close server

### What It Does NOT Do (vs. Datadog)

- **No infrastructure monitoring** — doesn't watch CPU, memory, containers, or network
- **No APM traces** — doesn't instrument your application code
- **No RUM/session replay** — doesn't watch end users
- **No uptime monitoring** — no synthetic tests
- **No security scanning** — no vulnerability detection

**What it does that Datadog doesn't:** Captures the *reasoning layer* — why decisions were made, what alternatives were considered, where you got stuck, how you interact with AI tools, and how your engineering thinking patterns evolve over time. It's observability for the developer's mind, not the system.

---

## Comprehensive Code Analysis: What Was Built (Full Detail)

This section is the deep, code-grounded analysis of every layer of Unfade — file paths, line numbers, struct definitions, formulas, thresholds, and architectural decisions. This is what the system *actually does*, traced through the source code.

---

### Layer 1: Capture Engine (Go Daemon)

The capture layer is written entirely in Go for performance. Two binaries are built from `daemon/`:

#### 1.1 Entry Point — `daemon/cmd/unfaded/main.go` (551 lines)

The main binary `unfaded` is a long-running daemon with:

- **Capture modes** (flag `--capture-mode`):
  - `git-only` — one per repo, watches `.git/` directory for changes
  - `ai-global` — one global instance, watches `~/.claude/`, Cursor, Codex, Aider directories
  - `full` — both modes combined (rarely used; the server spawns separate processes)

- **Singleton enforcement**: PID file locking prevents duplicate daemons per project. PID file stored at `~/.unfade/state/daemons/<projectId>/daemon.pid`.

- **IPC server**: Unix domain socket at `~/.unfade/state/daemons/<projectId>/daemon.sock`. Accepts 7 commands:
  - `status` — returns daemon state, uptime, event counts
  - `stop` — graceful shutdown
  - `backfill` — re-process git history for N days
  - `ingest` — trigger full re-scan of events directory
  - `ingest-status` — check ingest progress
  - `terminal-event` — inject a terminal event from external source
  - `distill` — trigger distill for a given date

- **Event output**: All events are written as JSONL to `~/.unfade/events/YYYY-MM-DD.jsonl`, date-partitioned. One file per calendar day.

#### 1.2 Git Capture — `daemon/internal/capture/git.go` (487 lines)

Watches the `.git/` directory tree using `fsnotify`:

- **Watched paths**: `.git/`, `.git/refs/heads/`, `.git/refs/stash`
- **Debounce**: 500ms (`gitDebounceDelay`). After any fs event, waits 500ms for the burst to settle, then processes once.
- **Event types emitted**:
  - `commit` — new commit detected (via HEAD change + `git log -1`). Extracts: message, author, files changed, insertions/deletions, branch.
  - `revert` — detected when commit message starts with "Revert "
  - `branch-switch` — detected when `.git/HEAD` changes to a different ref
  - `merge-conflict` — detected when `.git/MERGE_HEAD` exists
  - `stash` — detected when `.git/refs/stash` changes
- **Backfill**: `git log --after=<date> --reverse --format=...` walks history. Default `backfillDays=30`.
- **Detail truncation**: `maxDetailLen=2000` characters to prevent bloated events from huge diffs.
- **Content structure per event**:
  ```
  Content{
    Summary: "Committed: <first line of message>",
    Detail:  "<full commit message + diff stat>",
    Files:   ["src/auth/jwt.ts", "src/auth/middleware.ts"],
    Branch:  "feature/auth-refactor",
    Project: "unfade-cli"
  }
  ```

#### 1.3 AI Session Capture — `daemon/internal/capture/ai_session.go` (864 lines)

The most complex capture module. Supports four AI tools:

- **Claude Code**: Reads `~/.claude/projects/*/sessions/*/conversation.jsonl`
- **Cursor**: Reads `~/.cursor/workspaces/*/conversations/*.json`
- **Codex**: Reads `~/.codex/sessions/*.jsonl`
- **Aider**: Reads `~/.aider/history/*.jsonl`

**Polling strategy**: Hybrid 10s poll + 1s debounce.
- Every 10 seconds, scan all known directories for new/modified session files
- When a change is detected, debounce for 1 second to let the AI tool finish writing
- Then parse the new content

**Monotonic sequence tracking** (`sequences.json`):
- Each AI tool session gets a monotonic sequence counter
- Persisted to `~/.unfade/state/sequences.json`
- Prevents duplicate events on restart — the daemon picks up where it left off by comparing sequence numbers

**Metadata extraction** — 20+ fields per AI session event:

```
metadata: {
  ai_tool:           "claude-code" | "cursor" | "codex" | "aider"
  session_id:        "<unique session identifier>"
  conversation_id:   "<conversation within session>"
  turn_count:        <number of human↔AI turns>
  direction_signals: {
    human_initiated:   <bool>,
    specific_request:  <bool>,
    constraints_given: <bool>,
    modifications:     <number of times human modified AI output>,
    rejections:        <number of times human rejected AI output>
  }
  execution_phase:   "planning" | "implementing" | "debugging" | "reviewing" | "exploring"
  intent_summary:    "<what the human was trying to accomplish>"
  outcome:           "accepted" | "accepted_with_modifications" | "rejected" | "abandoned"
  model:             "claude-sonnet-4-20250514" | etc.
  tokens_in:         <estimated input tokens>
  tokens_out:        <estimated output tokens>
  files_referenced:  ["src/auth/jwt.ts"]
  files_modified:    ["src/auth/middleware.ts"]
  prompt_full:       "<the full human prompt text>"
  prompts_all:       ["<prompt 1>", "<prompt 2>", ...]
  tool_calls_summary: ["Read src/auth/jwt.ts", "Edit src/auth/middleware.ts"]
}
```

The `direction_signals` sub-object is critical — it feeds the Human Direction Score (HDS) calculation downstream. A session where the human gave specific constraints, initiated the conversation, and modified the AI output scores higher on direction than one where the human accepted a generic suggestion.

#### 1.4 CaptureEvent Struct — `daemon/internal/capture/event.go` (36 lines)

The universal event format shared between Go and TypeScript:

```go
type CaptureEvent struct {
    ID         string            `json:"id"`
    ProjectID  string            `json:"projectId"`
    Timestamp  string            `json:"timestamp"`
    Source     string            `json:"source"`      // git, ai-session, terminal, browser, manual, mcp-active
    Type       string            `json:"type"`        // 15 types (see schema below)
    Content    EventContent      `json:"content"`
    GitContext *GitContext        `json:"gitContext,omitempty"`
    Metadata   map[string]any    `json:"metadata,omitempty"`
}

type EventContent struct {
    Summary string   `json:"summary"`
    Detail  string   `json:"detail,omitempty"`
    Files   []string `json:"files,omitempty"`
    Branch  string   `json:"branch,omitempty"`
    Project string   `json:"project,omitempty"`
}

type GitContext struct {
    Repo       string `json:"repo"`
    Branch     string `json:"branch"`
    CommitHash string `json:"commitHash,omitempty"`
}
```

This struct MUST stay in sync with the TypeScript `CaptureEventSchema` in `src/schemas/event.ts`.

#### 1.5 TypeScript Event Schema — `src/schemas/event.ts` (49 lines)

```typescript
// Source enum:  git, ai-session, terminal, browser, manual, mcp-active
// Type enum:    commit, diff, branch-switch, revert, stash, merge-conflict,
//               ai-conversation, ai-completion, ai-rejection,
//               command, error, retry, bookmark, tab-visit, annotation
```

6 sources × 15 types = the full vocabulary of captured events. Most events in practice are `git/commit` and `ai-session/ai-conversation`.

---

### Layer 2: Materialization

#### 2.1 Materializer — `src/services/cache/materializer.ts` (577 lines)

The materializer is the bridge between raw JSONL files and queryable SQLite. It runs on a tick interval (default 5 seconds) and incrementally processes new data.

**Three streams tailed**:
1. `~/.unfade/events/*.jsonl` — capture events (primary)
2. `~/.unfade/graph/decisions.jsonl` — extracted decisions from distill
3. `~/.unfade/metrics/daily.jsonl` — daily metric snapshots

**Cursor mechanism**:
- Each stream tracks a byte offset per file
- Cursor state persisted to `~/.unfade/state/materializer.json`
- On restart, resumes from last saved offset
- **SHA-256 5-point validation**: On resume, reads 5 bytes at the saved offset position and compares SHA-256 hash to detect file truncation or corruption. If mismatch, re-processes from beginning of that file.

**Phantom trailing element fix** (lines 181-185):
When a JSONL file is being actively written by the Go daemon, the last line may be incomplete. The materializer detects this by checking if the last line is valid JSON — if not, it backs up the cursor to exclude that line and retries on next tick.

**Staleness detection**: If a file's size hasn't grown but the modification time has changed, and the new size is less than 2× the cursor position, the materializer treats this as a potential truncation/rotation and re-validates.

**Ingest lock coordination**: During full re-ingest (triggered via IPC `ingest` command), the materializer acquires an exclusive lock to prevent concurrent writes to SQLite.

#### 2.2 SQLite Schema — `src/services/cache/schema.ts` (138 lines)

13 tables with indexes optimized for the query patterns of all 8 intelligence analyzers:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `events` | All captured events | `id, project_id, timestamp, source, type, summary, detail, branch, metadata_json` |
| `decisions` | Extracted decisions from distill | `id, project_id, date, decision, rationale, domain, alternatives_json, evidence_event_ids` |
| `decisionEdges` | Links between related decisions | `from_id, to_id, relationship, confidence` |
| `metricSnapshots` | Daily metric values | `date, project_id, metric_name, value` |
| `directionWindows` | HDS values per time window | `window_start, window_end, project_id, hds, human_directed_count, total_count` |
| `comprehensionProxy` | Per-project comprehension scores | `project_id, domain, score, event_count, last_updated` |
| `comprehensionByModule` | Per-module comprehension | `project_id, module, score, event_count, depth` |
| `directionByFile` | Direction scores per file | `project_id, file_path, avg_hds, event_count` |
| `tokenProxySpend` | Token cost tracking | `date, project_id, model, tokens_in, tokens_out, estimated_cost` |
| `eventInsightMap` | Bidirectional event↔insight links | `event_id, insight_id, analyzer_name` |
| `features` | Feature flags/metadata | `name, value, updated_at` |
| `eventFeatures` | ML features per event | `event_id, feature_name, feature_value` |
| `eventLinks` | Cross-event links (causal chains) | `source_event_id, target_event_id, link_type, confidence` |

All tables indexed on `project_id` for efficient per-project or cross-project queries. The `events` table has a composite index on `(project_id, timestamp, source)` for the common query pattern of "recent events for this project by source."

---

### Layer 3: Intelligence Engine

#### 3.1 Engine Orchestrator — `src/services/intelligence/engine.ts` (82 lines)

The `IntelligenceEngine` class manages all 8 analyzers:

```typescript
class IntelligenceEngine {
  private analyzers: Analyzer[] = [];
  private lastRunMs = 0;
  private minIntervalMs: number;  // default 10_000 (10 seconds)

  async run(ctx: AnalyzerContext): Promise<AnalyzerResult[]> {
    // Throttle: skip if < 10s since last run
    // For each analyzer:
    //   1. Check minimum data points (SELECT COUNT(*) FROM events)
    //   2. Run analyzer
    //   3. Write result atomically (tmp file + rename)
    //   4. Write lineage mapping (event↔insight bidirectional)
    // Each analyzer is error-isolated — one failure doesn't block others
  }
}
```

**AnalyzerContext** provides: `db` (SQLite handle), `projectId`, `config`, `profile` (current reasoning model).
**AnalyzerResult** returns: `data` (JSON), `sourceEventIds` (for lineage), `updatedAt` timestamp.

All outputs written to `~/.unfade/intelligence/` as JSON files.

#### 3.2 Efficiency Analyzer (AES) — `src/services/intelligence/analyzers/efficiency.ts` (341 lines)

The AI Efficiency Score is the headline metric. Composite 0-100:

```
AES = Direction(30%) + TokenEfficiency(20%) + IterationRatio(20%)
    + ContextLeverage(15%) + ModificationDepth(15%)
```

**Sub-metric calculations**:

- **Direction Density (weight 0.30)**: Average HDS across AI sessions in the window. HDS is derived from `direction_signals` in event metadata:
  ```
  HDS = (human_initiated × 0.3) + (specific_request × 0.25)
      + (constraints_given × 0.2) + (modifications / total_turns × 0.15)
      + (rejections / total_turns × 0.1)
  ```
  Clamped to [0, 1]. HDS ≥ 0.6 = "Architectural Thinker", ≥ 0.3 = "Collaborative Builder", < 0.3 = "AI Accelerator".

- **Token Efficiency (weight 0.20)**: `1 - (actual_tokens / baseline_tokens)` where baseline is the median token usage for similar tasks. Higher = using fewer tokens for equivalent output.

- **Iteration Ratio (weight 0.20)**: `1 - (retries / total_interactions)`. Penalizes repeated attempts at the same task. Lower retry count = higher score.

- **Context Leverage (weight 0.15)**: Measures how well prior context is reused. `context_hits / total_queries` from MCP tool usage. More context reuse = higher score.

- **Modification Depth (weight 0.15)**: How substantially the developer modifies AI output vs. accepting verbatim. `modifications_with_changes / total_acceptances`. More modification = higher score (indicates human judgment).

**Phase normalization**:
- Planning sessions get a +50% multiplier (planning inherently scores higher on direction)
- Debugging sessions get a -30% penalty (debugging inherently involves more iteration)
- This prevents the score from being biased by work type

**Outcome adjustment**: Up to -20% penalty for sessions with `outcome: "abandoned"` or `outcome: "rejected"` that represent wasted effort.

**Trend detection**: Compares last 7-day average to previous 7-day average. ±5 point difference threshold:
- `improving` if current > previous + 5
- `declining` if current < previous - 5
- `stable` otherwise

**Insight generation**: Automatically generates text insights for:
- Weakest sub-metric (score < 30): "Your [metric] is low — consider [specific advice]"
- Strongest sub-metric (score > 80): "Your [metric] is excellent — this is a strength"

Output file: `~/.unfade/intelligence/efficiency.json`

#### 3.3 Comprehension Radar — `src/services/intelligence/analyzers/comprehension-radar.ts` (246 lines)

Per-module comprehension scoring to detect blind spots:

- **Module detection**: Files grouped by top-level directory or domain tag from event metadata
- **Scoring per module**: Based on decision quality, modification depth, and event frequency within that module
- **Blind spot threshold**: `BLIND_SPOT_THRESHOLD = 40`, `MIN_EVENTS_FOR_BLIND_SPOT = 5`
  - A module with score < 40 and ≥ 5 events is flagged as a blind spot
- **Phase normalization**: `adjustScoreForPhase()` — if low HDS is expected for the dominant execution phase (e.g., debugging naturally has lower direction), score is boosted to ≥ 50 to prevent false blind-spot alerts
- **Overall score**: Weighted average across modules, weighted by `decisionsCount` per module (more decisions = more influence on overall score)

Output file: `~/.unfade/intelligence/comprehension-radar.json`

#### 3.4 Cost Attribution — `src/services/intelligence/analyzers/cost-attribution.ts` (302 lines)

Tracks AI token spending across multiple dimensions:

- **Dimensions**: by model, by domain, by branch, by feature
- **Waste ratio**: `sessions_with_HDS < 0.2 / total_sessions` — low-direction sessions are considered potentially wasteful
- **Context overhead**: `1 - avg_specificity` — measures how much of the context window is "noise"
- **Abandoned waste**: Sessions with `outcome: "abandoned"` are flagged as pure waste
- **Cost per directed decision**: `total_estimated_cost / decisions_with_HDS >= 0.6` — the "price" of one human-directed decision
- **Projected monthly cost**: Linear extrapolation from current window
- **All values labeled "estimated/proxy"** — the system explicitly acknowledges these are approximations based on token counts, not actual billing data

Output file: `~/.unfade/intelligence/cost-attribution.json`

#### 3.5 Loop Detector — `src/services/intelligence/analyzers/loop-detector.ts` (230 lines)

Detects when a developer is stuck in unproductive loops:

- **Indexes low-direction sessions**: All sessions with HDS < 0.3
- **Similarity matching**: Cosine similarity on TF-IDF vectors of session content. `SIMILARITY_THRESHOLD = 0.7`
- **Stuck loop definition**: `STUCK_LOOP_MIN = 3` similar sessions with similar content and low direction — indicates repeating the same failing approach
- **Intent recurrence detection**: Same `intent_summary` appearing 3+ times with ≥ 2 failures in a 7-day window
- **Domain classification**: Regex-based domain detection from file paths and content
- **Export**: `findSimilarRejections()` is exported for use in MCP context injection — when a user starts a new session similar to a past stuck loop, the MCP tool can warn them

Output file: `~/.unfade/intelligence/loop-detector.json`

#### 3.6 Velocity Tracker — `src/services/intelligence/analyzers/velocity-tracker.ts` (170 lines)

Measures how quickly the developer reaches acceptance in AI interactions:

- **Metric**: Turns-to-acceptance per domain over weekly windows
- **Trend detection**: Splits the time window at midpoint. Compares first-half average to second-half average:
  - `accelerating` if turns decreased > 10%
  - `decelerating` if turns increased > 10%
  - `stable` otherwise
- **Uses `detectTrend()` utility** shared with other analyzers

Output file: `~/.unfade/intelligence/velocity-tracker.json`

#### 3.7 Prompt Patterns — `src/services/intelligence/analyzers/prompt-patterns.ts` (244 lines)

Extracts what prompting strategies work for this specific developer:

- **Feature extraction per prompt** (reads `prompt_full` from metadata):
  - `hasConstraints` — prompt includes specific requirements/limitations
  - `hasExamples` — prompt includes example code or expected output
  - `hasSchema` — prompt references a schema or type definition
  - `questionCount` — number of questions in the prompt
  - `length` — categorized: `short` (< 100 chars), `medium` (< 500), `long` (≥ 500)

- **Grouping by domain**: Patterns are analyzed per-domain because what works in auth code may not work in UI code

- **Effective patterns**: Features with > 1.3× direction lift (HDS improvement) and ≥ 3 samples
  - Example: "Including schema references improves direction by 45% in auth-related prompts"

- **Anti-patterns**: Domains with > 40% low-direction sessions (HDS < 0.3)
  - Example: "Short prompts in infrastructure domain have 60% low-direction rate"

Output file: `~/.unfade/intelligence/prompt-patterns.json`

#### 3.8 Blind Spots — `src/services/intelligence/analyzers/blind-spots.ts` (265 lines)

Three independent blind spot detectors:

1. **High-acceptance detector**: > 90% of sessions with HDS < 0.2 over a 2-week window. Phase-aware filtering — excludes sessions where low direction is expected (e.g., quick lookups during exploring phase).

2. **Low-comprehension detector**: Module comprehension score < 40 with ≥ 5 events (pulls from comprehension radar output).

3. **Declining-direction detector**: Statistically significant downtrend in HDS over 4-week window. Uses linear regression on daily HDS averages.

**Alert throttling**: `MAX_ALERTS_PER_WEEK = 2` — prevents alert fatigue.
**Alert expiry**: Alerts expire after 30 days if acknowledged (user can dismiss in UI).

Output file: `~/.unfade/intelligence/blind-spots.json`

#### 3.9 Decision Replay — `src/services/intelligence/analyzers/decision-replay.ts` (239 lines)

Resurfaces past decisions when new contradictory evidence appears:

Two trigger types:

1. **Domain drift**: Past decisions where `similarity(decision_content, recent_context) + 0.3 > 0.7`. This means the current work area is similar to where a past decision was made — the decision should be surfaced for awareness.

2. **Echoed dead end**: Past decisions similar to recent low-direction sessions where `similarity + 0.2 > 0.7`. This means the developer might be heading toward a known dead end.

**Guards**:
- `MIN_DECISION_AGE_DAYS = 7` — only replay decisions at least a week old (fresh decisions are already in context)
- `MAX_REPLAYS_PER_WEEK = 2` — prevents overload
- `CONFIDENCE_THRESHOLD = 0.7` — only high-confidence replays

Output file: `~/.unfade/intelligence/decision-replay.json`

---

### Layer 4: Distill Pipeline

#### 4.1 Distiller — `src/services/distill/distiller.ts` (849 lines)

The distill pipeline is the synthesis engine that turns raw events into narratives.

**Two entry points**:
- `distillIncremental(date)` — zero-LLM heuristic path. Uses keyword extraction, frequency analysis, and template-based synthesis. Always available, no API key needed.
- `distill(date, config, options)` — LLM-powered path. Sends extracted signals to Anthropic/OpenAI/Ollama for richer synthesis. Falls back to heuristic if LLM fails.

**Pipeline stages** (executed sequentially):

```
1. events         → Read day's JSONL, filter by date
2. extractSignals → Stage 1: statistics, event counts, domain breakdown
3. linkContext    → Stage 2: temporal chains, causal links, acceptance rates
4. synthesize    → Stage 3: LLM or heuristic → DailyDistill output
5. profileUpdate → Update ReasoningModelV2 with new patterns
6. graphUpdate   → Append to decisions.jsonl, update domains.json
7. amplification → Cross-project connection detection
8. writeMarkdown → Write human-readable distill to ~/.unfade/distills/YYYY-MM-DD.md
9. notify        → Emit SSE event for live UI update
```

**Stage 1 — ExtractedSignals** (`src/schemas/distill.ts`):
```typescript
{
  stats: {
    totalEvents, commitCount, aiCompletions, aiRejections,
    branchSwitches, reverts, filesChanged, domains,
    executionPhaseBreakdown: { planning: N, implementing: N, debugging: N, ... },
    outcomeBreakdown: { accepted: N, rejected: N, abandoned: N, ... }
  }
}
```

**Stage 2 — LinkedSignals**: Adds temporal chains (sequence of events that form a logical unit of work), causal links (commit following AI conversation = likely implementation of AI suggestion), and `aiAcceptanceRate`.

**Stage 3 — Synthesis output** (`DailyDistillSchema`):
```typescript
{
  date: "2025-01-15",
  summary: "Focused on auth middleware...",
  decisions: [
    { decision: "Chose JWT over session tokens",
      rationale: "Stateless fits microservice architecture",
      domain: "authentication",
      alternativesConsidered: ["session-based auth", "OAuth2 only"] }
  ],
  tradeOffs: [
    { tradeOff: "Stateless vs stateful auth",
      chose: "JWT (stateless)",
      rejected: "Sessions (stateful)",
      context: "Microservice architecture requires stateless auth" }
  ],
  deadEnds: [
    { description: "Tried session-based approach first",
      timeSpentMinutes: 45,
      resolution: "Switched to JWT after discovering session sharing issues" }
  ],
  breakthroughs: [...],
  patterns: [...],
  domains: ["authentication", "middleware"],
  synthesizedBy: "llm" | "fallback",
  directionSummary: {
    averageHDS: 0.67,
    humanDirectedCount: 8,
    collaborativeCount: 3,
    llmDirectedCount: 1,
    topHumanDirectedDecisions: [...]
  },
  aiCollaborationSummary: {
    toolBreakdown: [{ tool: "claude-code", sessions: 12, avgHDS: 0.65 }],
    directionStyle: "Architectural Thinker"
  }
}
```

**HDS classification** used in `directionStyle`:
- HDS ≥ 0.6 → "Architectural Thinker"
- HDS ≥ 0.3 → "Collaborative Builder"
- HDS < 0.3 → "AI Accelerator"

**Evidence extraction** (for linking decisions to source events):
- Keyword matching: stopwords filtered, minimum 3 characters, limit 15 keywords per decision
- Requires ≥ 2 keyword hits to link a decision to an event
- Top 5 events by hit score become `evidenceEventIds`

**Profile update**: Requires `dataPoints >= 2` before updating the reasoning model. Decision style baseline comparison: ratio > 1.2 = "above baseline", < 0.8 = "below baseline".

**Graph update**: Appends to `~/.unfade/graph/decisions.jsonl` with `evidenceEventIds`. Updates `~/.unfade/graph/domains.json` with domain frequency and depth.

**Backfill**: `backfill(days, config, options)` processes N past days with 10-second throttle between each to prevent API rate limiting.

**Idempotent**: Re-running distill for a date overwrites the existing output.

---

### Layer 5: Surfaces

#### 5.1 Unified Server — `src/server/unfade-server.ts` (287 lines)

The `startUnfadeServer()` function is the single entry point for the `unfade` command:

```typescript
async function startUnfadeServer(cwd?: string): Promise<RunningUnfade> {
  // 1. Register cwd as a project
  // 2. Load config + registry
  // 3. Start HTTP server (Hono on :7654)
  // 4. Start RepoManager (spawns Go daemons)
  // 5. Start global AI capture daemon
  // 6. For each registered repo: addRepo → trigger ingest → first-run report
  // 7. Backfill distills for undistilled days
  // 8. Start registry poll (60s interval for hot-added repos)
  // Returns { server, repoManager, shutdown }
}
```

**Shutdown sequence** (orchestrated, 5 steps):
1. Stop schedulers
2. Final materialization tick + save cursors
3. Close materializers (triggers final tick + cursor save + DB close)
4. Stop ALL daemons (per-project + global AI capture) — parallel via `Promise.all()`
5. Close HTTP server + clean up PID file

**Registry polling**: Every 60 seconds, checks `~/.unfade/state/registry.v1.json` for newly registered repos and hot-adds them to the RepoManager.

**Ingest coordination** (`triggerIngestWhenReady`):
- Checks `<repo>/.unfade/state/ingest.json` for status
- Skips if already completed or running
- Crash recovery: if ingest has been "running" for > 1 hour, marks as failed for re-trigger
- Waits for daemon IPC to be ready (10s timeout), then sends `ingest` command

**Distill backfill** (`triggerBackfillDistill`):
- Scans `~/.unfade/events/` for all date-partitioned JSONL files
- Checks `~/.unfade/distills/` for existing distills
- Processes any dates that have events but no distill (fire-and-forget)

#### 5.2 HTTP Server — `src/server/http.ts` (318 lines)

Hono framework on `localhost:7654`. Server-rendered HTML + htmx + SSE.

**19 page routes**:
- `/` → Home (dashboard with activation + steady-state modes)
- `/setup` → 3-step setup wizard
- `/intelligence` → Intelligence Hub (AES gauge, 5 tabs)
- `/profile` → Reasoning Fingerprint
- `/distill` → Daily Distill viewer
- `/live` → Real-time event stream
- `/cards` → Unfade Cards generator
- `/decisions` → Decision timeline
- `/coach` → Prompt Coach
- `/projects` → Project management
- `/alerts` → Blind spots + Decision replays
- `/logs` → Server logs viewer
- `/integrations` → MCP + tool integrations
- `/settings` → Configuration
- `/velocity` → Velocity tracking
- `/graph` → Thinking graph visualization
- Plus additional routes for specific features

**26+ API routes** (JSON endpoints for htmx):
- `/api/events` — query events with filters
- `/api/intelligence/*` — analyzer outputs
- `/api/profile` — current reasoning model
- `/api/distill/:date` — distill for specific date
- `/api/decisions` — decision search
- `/api/health` — system health check
- `/api/sse` — Server-Sent Events stream
- etc.

**Setup enforcement**: If setup is not complete, all page routes redirect to `/setup`.

**SSE stream**: Real-time push of events, health ticks, and intelligence updates to the browser.

#### 5.3 Dashboard — `src/server/pages/home.ts` (420 lines)

Two modes:
- **Activation mode** (first run): System status dots, progress bar toward first insights, live event capture display
- **Steady-state mode**: System health bar, event stream, 4 metrics (Direction, Events, Comprehension, Cost), quick actions, recent narratives

The activation panel (`src/server/components/system-reveal.ts`, 103 lines) shows:
- 4 subsystem status dots: SSE connection, Capture engine, Data materializer, Intelligence engine
- Each with building/waiting/ready/error states
- Progress bar: "0 of 5 events toward first insights"
- Skip button to jump to dashboard

#### 5.4 Key UI Pages

**Intelligence Hub** (`src/server/pages/intelligence.ts`, 162 lines):
- AES gauge (large circular display, 0-100)
- 5 tabs: Overview, Efficiency breakdown, Comprehension radar, Cost attribution, Velocity
- Each tab renders the corresponding analyzer output

**Profile / Reasoning Fingerprint** (`src/server/pages/profile.ts`, 236 lines):
- Decision Style: avgAlternativesEvaluated, aiAcceptanceRate, aiModificationRate
- Domain Distribution: per-domain with depth (shallow/moderate/deep) and trend (stable/deepening/broadening)
- Patterns: detected with confidence percentage and category
- Identity Labels: auto-generated labels like "Architectural Thinker" with confidence and since-date

**Prompt Coach** (`src/server/pages/coach.ts`, 139 lines):
- Shows effective patterns vs anti-patterns per domain
- "Domain-specific patterns from your actual AI interactions — not generic advice" (the only value-explaining sentence in the entire UI)

**Daily Distill** (`src/server/pages/distill.ts`, 116 lines):
- Date picker + rendered markdown of the daily narrative
- Shows decisions, trade-offs, dead ends, breakthroughs

**Live / Activity** (`src/server/pages/live.ts`, 172 lines):
- Real-time event stream with source filters (git/AI/terminal)
- System health chips: Daemon, Materializer, SSE, Server, Ingest, Intelligence

**Alerts & Replays** (`src/server/pages/alerts.ts`, 141 lines):
- Blind spot alerts with severity and recommended action
- Decision replays with context of why the old decision is relevant now

**Cards** (`src/server/pages/cards.ts`, 122 lines):
- Generate shareable PNG cards from daily distills
- Visual summary of engineering work for the day

**Projects** (`src/server/pages/projects.ts`, 153 lines):
- List of registered repos with status
- Project scanning and registration
- Global AI Capture toggle and status

**Decisions** (`src/server/pages/decisions.ts`, 87 lines):
- Searchable decision timeline with domain filter
- Each decision shows rationale, alternatives, evidence links

**Layout** (`src/server/pages/layout.ts`, 468 lines):
- 4-layer navigation: Observe (Home/Projects/Live/Distill), Understand (Intelligence/Decisions/Coach), Identity (Profile/Cards), System (Integrations/Logs)
- Live Strip: 36px bar at top with SSE-powered system status
- SSE client for real-time updates

#### 5.5 MCP Server — `src/services/mcp/tools.ts` (~300 lines)

7 MCP tools for IDE integration. All return the `ToolResponse` envelope:

```typescript
{ data: ..., _meta: { tool, durationMs, degraded, degradedReason, personalizationLevel } }
```

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `unfade_query` | Search reasoning history | `query`, `project`, `dateRange`, `limit`, `source` |
| `unfade_context` | Recent context window | `scope`: `last_2h`, `today`, `this_week` |
| `unfade_decisions` | Decision lookup | `domain` filter, date range |
| `unfade_profile` | Current reasoning model | (none — returns full ReasoningModelV2) |
| `unfade_distill` | Trigger manual distill | `date` (defaults to today) |
| `unfade_amplify` | Cross-project connections | `query` for related patterns |
| `unfade_log` | Submit manual event | `summary`, `detail`, `type` |

**Degraded mode**: When `~/.unfade/` doesn't exist or isn't initialized, all tools return `{ degraded: true, degradedReason: "..." }` instead of failing hard.

**Personalization level**: Returned in `_meta` — indicates how much historical data influenced the response. `"none"` for new users, `"basic"` for < 1 week data, `"full"` for established profiles.

#### 5.6 CLI — 15 Commands

| Command | Purpose |
|---------|---------|
| `unfade` | Start everything (server + daemons + dashboard) |
| `unfade add <path>` | Register a new repo |
| `unfade reset` | Reset all data |
| `unfade status` | Show system status |
| `unfade distill [date]` | Trigger distill |
| `unfade query <text>` | Search reasoning history |
| `unfade card [date]` | Generate Unfade Card |
| `unfade export` | Export data |
| `unfade doctor` | Diagnose issues |
| `unfade publish` | Publish Thinking Graph site |
| `unfade prompt` | Generate AI prompt from context |
| `unfade ingest` | Re-process events |
| `unfade history` | View event history |
| `unfade savings` | Show AI cost savings |
| `unfade daemon` | Daemon management |
| `unfade mcp` | Start MCP server (stdio transport) |

---

### Data Contracts & Schemas

#### ReasoningModelV2 — `src/schemas/profile.ts` (149 lines)

The developer identity profile that compounds over time:

```typescript
{
  version: 2,
  decisionStyle: {
    avgAlternativesEvaluated: number,
    medianAlternativesEvaluated: number,
    explorationDepthMinutes: { overall: number, byDomain: Record<string, number> },
    aiAcceptanceRate: number,         // 0-1
    aiModificationRate: number,       // 0-1
    aiModificationByDomain: Record<string, number>
  },
  tradeOffPreferences: [{
    preference: string,               // e.g., "Prefers stateless over stateful"
    confidence: number,               // 0-1
    supportingDecisions: number,
    contradictingDecisions: number
  }],
  domainDistribution: [{
    domain: string,
    frequency: number,
    percentageOfTotal: number,
    depth: "shallow" | "moderate" | "deep",
    depthTrend: "stable" | "deepening" | "broadening",
    avgAlternativesInDomain: number
  }],
  patterns: [{
    pattern: string,
    confidence: number,               // 0-1
    observedSince: string,            // ISO date
    lastObserved: string,
    examples: string[],
    category: "decision_style" | "trade_off" | "domain" | "ai_interaction" | "exploration"
  }],
  temporalPatterns: {
    mostProductiveHours: number[],
    avgDecisionsPerDay: number,
    peakDecisionDays: string[]
  },
  uifMetrics: {
    rdi: number,  // Reasoning Depth Index
    dcs: number,  // Decision Consistency Score
    aq: number,   // Adaptability Quotient
    cwi: number,  // Context Window Intelligence
    apiScore: number  // Overall API score
  },
  identityLabels: [{
    label: string,                    // e.g., "Architectural Thinker"
    confidence: number,
    since: string,
    category: string
  }],
  directionPatterns: {
    runningAverageHDS: number,
    trend: "improving" | "stable" | "declining",
    commonSignals: string[],
    byDomain: Record<string, number>,
    dataPoints: number
  }
}
```

#### Global Storage — `src/utils/paths.ts` (143 lines)

18 path functions mapping to the `~/.unfade/` directory structure:

```
~/.unfade/                          getUnfadeHome()
├── config.json                     (direct)
├── events/                         getEventsDir()
├── cache/unfade.db                 getCacheDir()
├── distills/                       getDistillsDir()
├── profile/                        getProfileDir()
├── graph/                          getGraphDir()
├── intelligence/                   getIntelligenceDir()
├── amplification/                  getAmplificationDir()
├── state/                          getStateDir()
│   ├── registry.v1.json
│   └── daemons/<id>/               getDaemonStateDir(id)
├── insights/                       getInsightsDir()
├── metrics/                        getMetricsDir()
├── bin/                            getBinDir()
├── cards/                          getCardsDir()
├── site/                           getSiteDir()
├── logs/                           getLogsDir()
└── projects/<id>/                  getProjectDir(id)
```

`UNFADE_HOME` env var overrides the default `~/.unfade/` for test isolation.

---

### Terminology Map

From `src/constants/terminology.ts` (22 lines):

| Internal Term | User-Facing Term | Used Consistently? |
|--------------|-----------------|-------------------|
| daemon | "capture engine" | Partially — UI still says "daemon" in some places |
| events | "reasoning signals" | No — UI still says "events" everywhere |
| distill | "Daily Distill" | Yes, but the term itself is jargon |
| profile | "Reasoning Fingerprint" | Yes, used on profile page |

---

### System Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    unfade (CLI command)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           unfade-server.ts (orchestrator)               │ │
│  │                                                         │ │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────────────┐│ │
│  │  │ HTTP    │  │ MCP      │  │ RepoManager            ││ │
│  │  │ Server  │  │ Server   │  │ ┌────────┐ ┌─────────┐ ││ │
│  │  │ (Hono)  │  │ (stdio)  │  │ │Git     │ │AI Global│ ││ │
│  │  │ :7654   │  │          │  │ │Daemon  │ │Daemon   │ ││ │
│  │  │ 19 pages│  │ 7 tools  │  │ │(Go)    │ │(Go)     │ ││ │
│  │  │ 26+ APIs│  │          │  │ │per-repo│ │global   │ ││ │
│  │  └────┬────┘  └────┬─────┘  │ └───┬────┘ └────┬────┘ ││ │
│  │       │            │         │     │           │      ││ │
│  │       └────────────┴─────────┼─────┴───────────┘      ││ │
│  │                              └────────────────────────┘│ │
│  └──────────────────────────┬─────────────────────────────┘ │
│                             │                                │
│  ┌──────────────────────────▼─────────────────────────────┐ │
│  │              ~/.unfade/ (global storage)                 │ │
│  │                                                         │ │
│  │  events/*.jsonl  →  materializer  →  SQLite (cache/)    │ │
│  │                         │                                │ │
│  │                    intelligence/  (8 analyzers)          │ │
│  │                         │                                │ │
│  │                    distills/  (daily narratives)         │ │
│  │                         │                                │ │
│  │                    profile/  (ReasoningModelV2)          │ │
│  │                         │                                │ │
│  │                    graph/  (decisions + domains)         │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Data flow**: Go daemon writes JSONL → Materializer tails into SQLite → Intelligence analyzers query SQLite → Distiller synthesizes → Profile/Graph updated → Surfaces (HTTP/MCP/CLI) query all of the above.

**Key invariant**: Go daemon owns `events/` (write). TypeScript owns everything else (read events, write intelligence/distills/profile/graph/cache).

**One writer per file**: No concurrent writes to the same file. Go writes events, TypeScript writes all derived data. The materializer is the only reader of raw events and the only writer to SQLite.

---

## PHASE 1: RIGOROUS RESEARCH — Current UI Audit

### 1.1 Complete User Flow Map

#### Flow A: First-Run (New User)

| Step | What User Sees | What System Does | Gap |
|------|---------------|------------------|-----|
| 1. `unfade` in terminal | Server starts, browser opens to `/setup` | Starts HTTP server, Go daemons, materializer, AI capture | No explanation of what just launched |
| 2. Setup Step 1 | "Configure Intelligence" + LLM provider dropdown | Nothing yet — waiting for config | Only explanation: "Connect an LLM to power daily distills, reasoning extraction, and pattern detection across your workflow" — buried subtitle, assumes familiarity with "distills" |
| 3. Setup Step 2 | "Connect Your AI Tools" + MCP install buttons | Writes MCP config to tool directories | "Give your AI coding tools access to your reasoning history via MCP" — assumes user knows what MCP is and what "reasoning history" means |
| 4. Setup Step 3 | "You're All Set" + summary | Marks setup complete | Summary lists infrastructure: "Capture engine active", "Intelligence configured", "AI tools connected" — no mention of *what* these do for the user |
| 5. Home (activation) | `unfade` + "Warming up capture and materialization" + system status dots + "Captured events" progress bar | Daemons start capturing, materializer processes | Labels: "Real-time connection", "Capture engine", "Data materializer", "Intelligence engine". Pure infrastructure. "0 of 5 events toward first insights" — no explanation of what an "insight" will be |
| 6. Home (dashboard) | System health bar + Event stream + 4 metrics + Quick actions + Narratives | All systems running | Health dots: "SSE", "Capture", "Materializer", "Intelligence". Metrics: "Direction (24h)", "Events (24h)", "Comprehension", "Cost (est.)". None defined for the user |

**Total words explaining what Unfade does across the entire first-run flow: ~30 words** (the step 1 subtitle + step 3's "Start working — insights will appear as data accumulates").

#### Flow B: Steady-State Dashboard

The dashboard (`home.ts:48-420`) shows:
- **System Health**: 4 dots labeled SSE / Capture / Materializer / Intelligence
- **Event Stream**: Raw events with source tag (git/AI) and summary
- **Metrics**: Direction %, Events 24h, Comprehension, Cost est. — no definitions, no "what this means for you"
- **Quick Actions**: Links to Intelligence Hub, Projects, Distill, Coach, Alerts, Cards, Velocity — no descriptions
- **Recent Narratives**: Cross-analyzer insights with "Why?" drillthrough

#### Flow C: Navigation Structure (`layout.ts:93-114`)

```
Observe:     Home / Projects / Live / Distill
Understand:  Intelligence / Decisions / Coach
Identity:    Profile / Cards
System:      Integrations / Logs (collapsed)
```

**Problems**:
- "Observe" / "Understand" / "Identity" are internal mental model categories, not user-oriented labels
- No tooltips, no descriptions on any nav item
- "Distill" is Unfade-specific jargon with no explanation
- "Coach" gives no hint of what it coaches
- "Cards" could mean anything
- System section is hidden by default — but "Integrations" is where users go to connect tools

### 1.2 Screen-by-Screen Language Audit

| Screen | Title | What It Should Communicate | What It Actually Says |
|--------|-------|---------------------------|----------------------|
| **Setup Step 1** | "Configure Intelligence" | What Unfade does + why you want it + what intelligence means | "Connect an LLM to power daily distills, reasoning extraction, and pattern detection" |
| **Setup Step 3** | "You're All Set" | What to expect + when value appears | "Start working — insights will appear as data accumulates" |
| **Activation** | `unfade` | What's happening to your data + when you'll see value | "Warming up capture and materialization. Live telemetry appears below." |
| **Dashboard** | (no title) | Your reasoning health at a glance | System health dots + raw metrics + raw event stream |
| **Intelligence** | "Intelligence Hub" | Your AI collaboration effectiveness + trends | AES gauge with no explanation of what it measures |
| **Decisions** | "Decisions" | Your engineering decisions + rationale | Search box + list with no context for what "decisions" means here |
| **Coach** | "Prompt Coach" | What works for you + what to change | "Domain-specific patterns from your actual AI interactions" — only descriptive text in the entire app |
| **Profile** | "Reasoning Fingerprint" | Your engineering identity + how it's evolving | Decision Style metrics + Domain Distribution + Patterns — no narrative context |
| **Cards** | "Unfade Cards" | Shareable visual proof of your work | "Generate a visual summary card from a daily distill" |
| **Distill** | "Daily Distill" | Today's reasoning narrative | Date picker + markdown blob with no framing |
| **Live** | "Live" | Real-time capture of your thinking | System health chips (Daemon/Materializer/SSE/Server/Ingest/Intelligence) + raw event stream |
| **Alerts** | "Alerts & Replays" | Things that need your attention + past decisions to revisit | "Proactive insights based on sustained patterns" — decent but cold |
| **Projects** | "Projects" | Your tracked codebases | Registered projects + scan + Global AI Capture status |

### 1.3 Terminology Inventory

The codebase has a `terminology.ts` that maps internal→user terms:

```typescript
daemon: "capture engine"          // Good intent, still technical
events: "reasoning signals"       // Good — but never used in UI
distill: "Daily Distill"          // Jargon — undefined for new users
profile: "Reasoning Fingerprint"  // Evocative — but never explained
```

**Terms used in UI that are never defined for the user**:
- "Direction" / "Direction %" — appears 12+ times, never explained
- "Comprehension" — appears 8+ times, no definition
- "AES" / "AI Efficiency Score" — shown as a giant number with no context
- "Materialization" / "Materializer" — infrastructure term, exposed on home + live pages
- "SSE" — Server-Sent Events, a protocol name exposed as user-facing label
- "Distill" — product-specific term used as nav label with no explanation
- "HDS" / "Human Direction Score" — internal metric name, sometimes leaks through
- "Intelligence engine" — vague, sounds like marketing speak
- "Reasoning signals" — defined in terminology.ts but never appears in the actual UI (UI still says "events")

### 1.4 Best-in-Class Novel UI Communication Analysis

Products that successfully introduced **new mental models** to users:

**Datadog — "What's APM?"**
- First screen shows a service map with actual services from your infrastructure
- Every metric has a one-line definition visible on hover
- Onboarding shows data flowing through the system: "Your traces are being collected → Your services are being mapped → Your latency is being measured"
- Never shows infrastructure state (agent status, flush intervals) on the main dashboard — that's buried in Agent Status page

**Notion — "Blocks"**
- The "/" command *is* the tutorial — typing "/" reveals block types with descriptions
- Empty pages show "Press '/' for commands" — the product teaches itself through use
- No setup wizard for the core concept — you learn by doing
- Progressive disclosure: basic text → toggle blocks → databases → relations

**Figma — "Multiplayer Design"**
- Cursors appear immediately — no explanation needed, the metaphor is physical presence
- The first thing you see is other people's cursors moving — the value is visible before you understand the system
- Comments are anchored to specific design elements — the concept of "design review" is embedded in the tool

**Linear — "Issues"**
- First screen: "What are you working on?" — not "Configure your project management"
- Empty state: "Create your first issue" with a single text field, not a wizard
- Labels, statuses, cycles are introduced as you create issues — not front-loaded
- The sidebar shows *work states* (Backlog, Todo, In Progress, Done), not *system categories*

**Key Patterns Extracted**:

| Pattern | How It Works | Unfade's Current State |
|---------|-------------|----------------------|
| **Show value before explaining system** | Datadog shows traces before explaining APM; Figma shows cursors before explaining multiplayer | Unfade shows system health before showing any value |
| **Define metrics in context** | Datadog: every metric has hover definition; Linear: every status has description | No metric in Unfade has any definition |
| **Learn by doing, not by reading** | Notion "/" command; Figma cursor; Linear "What are you working on?" | Unfade has a 3-step setup wizard about infrastructure |
| **Navigation mirrors user mental model** | Linear: Backlog/Todo/InProgress/Done; Datadog: APM/Infrastructure/Logs/Security | Unfade: Observe/Understand/Identity (internal taxonomy) |
| **Progressive disclosure** | Notion: text→blocks→databases; Linear: issues→cycles→projects | Unfade: full nav visible from first interaction |
| **Self-explanatory empty states** | Linear: "No issues yet. Create one?"; Notion: "Start writing" | Unfade: "Not enough data yet" (repeated across 6 pages) |

---

## PHASE 2: REASONING — Core Failure Diagnosis

### 2.1 The Fundamental Problem

**The product is explaining its plumbing instead of its purpose.**

Every screen answers "what is the system's state?" instead of "what has the system learned about you?". This is the difference between:
- A doctor showing you their MRI machine's calibration status vs. showing you your scan results
- A fitness tracker showing Bluetooth connection status vs. showing your heart rate trend

The home dashboard has 4 system health dots (SSE/Capture/Materializer/Intelligence) taking prime visual real estate. These are equivalent to Datadog showing you "Agent: connected, Flush interval: 10s, Transport: HTTP" on their main dashboard. Datadog doesn't do this because *users don't care about the agent* — they care about their services.

### 2.2 The Abstraction Gap Map

| Layer | System-Facing (Current) | User-Facing (Should Be) |
|-------|------------------------|------------------------|
| Capture | "Capture engine active", "Daemon running" | "Watching your work" → "3 commits and 2 AI conversations captured today" |
| Materialization | "Data materializer: ready", "Materialized 47 events into SQLite" | (Invisible — like how Google Docs never says "indexing your document") |
| Intelligence | "Intelligence engine: starting", "AES: 73" | "Here's what we noticed: You evaluate 2.3 alternatives before deciding. Your AI efficiency in the auth domain improved 15% this week." |
| Distill | "Daily Distill" (nav label) | "Today's Story" or "What You Built Today" |
| Metrics | "Direction: 67%", "Comprehension: 82" | "67% of your AI interactions were human-directed — you're steering, not auto-piloting" |
| Events | "Event stream" (raw JSONL rendering) | "Your Activity" with meaningful grouping (commits → AI conversations → patterns detected) |

### 2.3 Where the "Aha Moment" Should Happen (But Doesn't)

The "aha moment" for Unfade should be: **"This tool knows *why* I made that decision, and it's building a picture of how I think."**

Currently, the closest the UI gets to this is:
1. **Coach page** (`coach.ts:14`): "Domain-specific patterns from your actual AI interactions — not generic advice." — This is the *only* line in the entire UI that communicates the value proposition. But it requires navigating to the Coach page, waiting for 10+ AI sessions, and understanding what "domain-specific patterns" means.
2. **Narratives section** on home: Shows cross-analyzer insights with "Why?" drillthrough — but narratives are labeled "Recent narratives" with no context for what a "narrative" is.
3. **Profile page**: Shows Decision Style, Domain Distribution, Detected Patterns — genuinely powerful data, but presented as raw metrics without story.

### 2.4 The Three Mental Models Users Must Understand

For Unfade to click, users need to internalize three concepts (in order):

1. **"Your reasoning is being captured passively"** — Every commit, AI conversation, and terminal session contains reasoning that's normally lost. Unfade saves it.
2. **"The system distills patterns from your reasoning"** — Not just logging events — extracting decisions, trade-offs, dead ends, and turning them into insights about how you work.
3. **"Your reasoning compounds into intelligence over time"** — Today's captured reasoning becomes tomorrow's context. Your AI tools get smarter because they can access your history via MCP. Your developer identity grows.

Currently, none of these are communicated. The setup wizard jumps to "Configure Intelligence" (LLM provider), which is step 3 of the mental model (intelligence requires data) presented as step 1 of the experience.

### 2.5 Narrative Architecture Redesign

**Single-sentence transformation**: "Unfade captures the reasoning behind your code and turns it into compounding intelligence — so you never lose context, your AI tools get smarter, and your engineering identity grows with every decision."

**Progressive revelation strategy**:
- **First 10 seconds**: See your captured reasoning happening in real time (a commit message appears, then an AI conversation summary, with annotations showing "reasoning extracted")
- **First 5 minutes**: See the first distill — a narrative of what you worked on and why
- **First day**: See patterns emerging — "You tend to evaluate 2+ alternatives in auth code but quick-decide in UI code"
- **First week**: See compounding — "Your AI efficiency improved 12% since last week" + MCP context injection saving re-explanation

---

## PHASE 3: VALIDATION — Testing Against Product Experience Principles

### Principle A: First-time user understands value within 5-10 seconds

**Current**: FAIL. First screen is "Configure Intelligence" — an LLM configuration form. Zero value communication.

**Required**: A hero statement + live demonstration. The user should see reasoning being captured *before* they configure anything.

### Principle B: Every screen answers "what is happening / why it matters / what this means for me"

| Screen | What is happening | Why it matters | What this means for me |
|--------|-------------------|----------------|----------------------|
| Home | System health dots (SSE/Capture) | Not stated | Not stated |
| Intelligence | AES: 73 | Not stated | Not stated |
| Profile | Decision Style metrics | Not stated | Not stated |
| Coach | Effective/anti-patterns listed | "not generic advice" | Implicit (copy to CLAUDE.md) |
| Distill | Markdown blob | Not stated | Not stated |
| Decisions | Searchable list | Not stated | Not stated |

**Current**: FAIL on 5 of 6 primary screens.

### Principle C: All system activity reframed as user benefit

**Current failures**:
- "SSE: connected" → should be invisible
- "Capture engine active" → should be "Watching your work"
- "Materialized 47 events into SQLite" → should be invisible or "47 reasoning moments indexed"
- "Intelligence engine: starting" → should be "Analyzing your patterns..."
- "Direction: 67%" → should be "67% human-directed — you're in control of your AI collaboration"
- "Events (24h): 142" → should be "142 reasoning moments captured today"

### Principle D: Progressive education during system operation

**Current**: FAIL. No tooltips, no inline definitions, no educational microcopy, no "learn more" links. The only educational text is on the Coach page.

### Principle E: Continuous sense of compounding value

**Current**: PARTIAL. The profile page shows pattern confidence growing over time. The velocity tracker shows acceleration. But these are presented as raw data, not as a narrative of growth. There's no "you had 3 data points last week, now you have 15 — here's what new patterns emerged."

---

## PHASE 4: EXECUTION — Complete Redesign Blueprint

### 4.1 First-Run Experience: The "Aha" Moment

**Current flow**: Setup wizard (3 steps of infrastructure config) → Activation (system health dots) → Dashboard (raw metrics)

**Redesigned flow**:

#### Step 0: Welcome (NEW — before any configuration)

```
┌─────────────────────────────────────────────────┐
│                                                   │
│                    unfade                          │
│                                                   │
│     Your engineering reasoning, captured           │
│     and compounding — automatically.               │
│                                                   │
│  Every commit, AI conversation, and decision       │
│  contains reasoning that's normally lost.          │
│  Unfade captures it passively, distills it         │
│  into patterns, and builds your developer          │
│  identity over time.                               │
│                                                   │
│  ┌──────────────────────────────────────────┐     │
│  │  [Live demo: simulated event stream]      │     │
│  │                                           │     │
│  │  git  "Switched to feature/auth-refactor" │     │
│  │    ↓  reasoning: branch for isolation     │     │
│  │  AI   "Debated JWT vs session tokens"     │     │
│  │    ↓  decision: JWT — stateless fits      │     │
│  │       microservice architecture           │     │
│  │  git  "Committed auth middleware"         │     │
│  │    ↓  pattern: evaluates 2+ alternatives  │     │
│  │       before committing in security code  │     │
│  │                                           │     │
│  │  ▸ 1 decision captured                    │     │
│  │  ▸ 1 pattern detected                     │     │
│  │  ▸ Reasoning Fingerprint: growing         │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│         [ Get Started → ]                         │
│                                                   │
└─────────────────────────────────────────────────┘
```

**What this achieves**: In 5-10 seconds, the user sees:
1. What Unfade captures (git events, AI conversations)
2. What it extracts (reasoning, decisions, patterns)
3. What compounds (fingerprint grows)

The demo can be a simple CSS animation cycling through 3-4 pre-built events with annotations. No real data needed — this is about comprehension, not functionality.

#### Step 1: Connect (Replaces "Configure Intelligence")

**Title**: "What should Unfade watch?"

Instead of starting with LLM config (which is about *processing*, not *capture*), start with what's immediately visible:

```
Your projects
  ┌──────────────────────────────────┐
  │ ✓ ~/IdeaProjects/unfade-cli      │  (auto-detected from cwd)
  │   + Scan for more projects       │
  └──────────────────────────────────┘

Your AI tools (auto-detected)
  ┌──────────────────────────────────┐
  │ ✓ Claude Code  — sessions found  │
  │ ○ Cursor       — not detected    │
  │ ○ Codex        — not detected    │
  └──────────────────────────────────┘

Intelligence (for deeper analysis)
  ┌──────────────────────────────────┐
  │ Connect an LLM for richer        │
  │ distills and pattern detection.  │
  │ [Configure LLM] or [Skip — use  │
  │ built-in analysis]               │
  └──────────────────────────────────┘
```

**Key changes**:
- Projects first (what to watch) — immediately grounding
- AI tools auto-detected and shown, not requiring manual MCP config
- LLM config is optional and clearly explained as "for deeper analysis"
- "Skip" option with built-in fallback makes the barrier near-zero

#### Step 2: Watch It Work (Replaces Activation)

**Title**: "Unfade is capturing your reasoning"

Instead of system health dots, show *meaning*:

```
┌──────────────────────────────────────────────┐
│                                                │
│  Unfade is watching your work                  │
│                                                │
│  As you code, commit, and talk to AI tools,    │
│  reasoning appears here in real time.          │
│                                                │
│  ┌────────────────────────────────────────┐   │
│  │ 2:14 PM  Committed "Add auth middleware"│   │
│  │          → Decision: JWT over sessions  │   │
│  │          → Files: src/auth/jwt.ts       │   │
│  │                                         │   │
│  │ 2:11 PM  AI conversation captured       │   │
│  │          → Topic: auth approach debate   │   │
│  │          → Outcome: accepted with edits  │   │
│  │          → Direction: 78% human-led      │   │
│  └────────────────────────────────────────┘   │
│                                                │
│  ▸ 2 of 5 events toward your first insights   │
│  ━━━━━━━━━━━━━░░░░░░░░░░░░░░░░░░░░ 40%      │
│                                                │
│  First insights appear after ~5 events.        │
│  Keep working — or [ Skip to Dashboard → ]     │
│                                                │
└──────────────────────────────────────────────┘
```

**Key changes**:
- "Watching your work" instead of "Warming up capture and materialization"
- Events shown with extracted meaning (decisions, direction score) not just raw summaries
- Progress bar has context: "toward your first insights" with "First insights appear after ~5 events"
- System status (SSE/Materializer/Intelligence) removed from user view — moved to System page

### 4.2 Navigation & Labeling Redesign

**Current** (internal architecture taxonomy):
```
Observe:     Home / Projects / Live / Distill
Understand:  Intelligence / Decisions / Coach
Identity:    Profile / Cards
System:      Integrations / Logs
```

**Redesigned** (user mental model):

```
Your Work
  Home              → "Today's activity and insights"
  Projects          → "Your tracked codebases"
  Activity          → "Real-time event stream" (was "Live")
  
Your Thinking  
  Today's Story     → "What you built and decided today" (was "Distill")
  Decisions         → "Your engineering decisions and rationale"
  Patterns          → "What works for you + what to watch" (was "Coach" + "Alerts")

Your Growth
  Effectiveness     → "How efficiently you collaborate with AI" (was "Intelligence")
  Fingerprint       → "Your reasoning identity" (was "Profile")
  Cards             → "Shareable proof of your thinking"

System (collapsed)
  Integrations
  Logs
  Settings
```

**Rationale**:
- "Your Work / Your Thinking / Your Growth" — possessive framing makes it about the user, not the system
- "Today's Story" is immediately understandable vs "Distill"
- "Effectiveness" is clearer than "Intelligence Hub" (which sounds like a marketing page)
- "Fingerprint" preserves the evocative naming from `terminology.ts` (`profile: "Reasoning Fingerprint"`)
- "Activity" is standard (GitHub, Linear, etc.) vs "Live" (which implies streaming video)
- "Patterns" merges Coach + Alerts into one screen about behavioral patterns

**Tooltips for every nav item** (shown on hover, first-visit):

| Nav Item | Tooltip |
|----------|---------|
| Home | Your daily dashboard — activity, metrics, and insights at a glance |
| Projects | Codebases Unfade is watching for reasoning signals |
| Activity | Real-time stream of commits, AI conversations, and captured reasoning |
| Today's Story | Auto-generated narrative of what you worked on and the decisions you made |
| Decisions | Searchable timeline of your engineering decisions with rationale and context |
| Patterns | Effective AI prompting patterns and blind spots detected from your workflow |
| Effectiveness | AI collaboration metrics — how efficiently you direct AI tools |
| Fingerprint | Your evolving reasoning identity — decision style, domain depth, growth |
| Cards | Shareable visual proof of your daily engineering thinking |

### 4.3 Dashboard Redesign

**Current home dashboard** (`home.ts`):
```
[System health: SSE ● Capture ● Materializer ● Intelligence ●]

┌─ Event stream ──────────┐  ┌─ Metrics ─────────┐
│ git: "Committed auth..." │  │ Direction:   67%  │
│ AI:  "Session captured"  │  │ Events:      142  │
│                          │  │ Comprehension: 82 │
│                          │  │ Cost (est.): —    │
└──────────────────────────┘  └───────────────────┘

┌─ Recent narratives ─────────────────────────────┐
│ Loading...                                       │
└──────────────────────────────────────────────────┘
```

**Redesigned**:

```
┌─ What Unfade noticed today ─────────────────────┐
│                                                   │
│  "You evaluated 3 alternatives before choosing    │
│   JWT for the auth middleware — that's your       │
│   typical depth for security-related decisions.   │
│   Your AI efficiency in this domain improved      │
│   15% compared to last week."                     │
│                                                   │
│  ▸ Based on 12 events today + 847 historical     │
│  ▸ [See full story →]  [See pattern →]           │
│                                                   │
└──────────────────────────────────────────────────┘

┌─ Today's numbers ───────────────────────────────┐
│                                                   │
│  67%              142            82              │
│  Human-directed   Reasoning      Domain          │
│  AI interactions  moments today  comprehension   │
│  ─────────────    ─────────────  ─────────────   │
│  "You're steering  "Busiest area: "Strong across │
│   your AI tools,   auth (48       auth, growing  │
│   not auto-        events)"       in infra"      │
│   piloting"                                      │
│                                                   │
└──────────────────────────────────────────────────┘

┌─ Your activity ─────────────┐  ┌─ Quick paths ──┐
│                              │  │                 │
│  2:14  Committed auth flow   │  │ Today's Story → │
│        Decision: JWT tokens  │  │ Decisions →     │
│                              │  │ Patterns →      │
│  2:11  AI: auth approach     │  │ Effectiveness → │
│        Direction: 78%        │  │ Fingerprint →   │
│        "Debated JWT vs       │  │                 │
│         session tokens"      │  │                 │
│                              │  │                 │
│  2:03  Branch switch         │  │                 │
│        → feature/auth        │  │                 │
│                              │  │                 │
└──────────────────────────────┘  └─────────────────┘
```

**Key changes**:
1. **Lead with insight, not infrastructure** — "What Unfade noticed today" is a narrative block, not health dots
2. **Define every metric inline** — "67% Human-directed AI interactions" with one-line explanation below
3. **Activity stream shows extracted meaning** — not just "Committed auth flow" but also "Decision: JWT tokens"
4. **System health moved to a small indicator** — single colored dot in the Live Strip, expandable on click. Users who care about system health can find it on the System page
5. **Quick paths have descriptive labels** — "Today's Story" not "Distill"

### 4.4 Inline Education Layer

#### A. Metric Definitions (Every metric, everywhere)

Every metric in the UI should have an inline definition that appears on first visit and on hover. Implementation: a `<span class="metric-label" data-definition="...">` wrapper.

| Metric | Current Label | New Label | Inline Definition |
|--------|--------------|-----------|-------------------|
| Direction / HDS | "Direction (24h)" | "Human-directed" | "What % of your AI interactions you actively steered vs passively accepted. Higher = more intentional collaboration." |
| Comprehension | "Comprehension" | "Domain comprehension" | "How well you understand the code areas you're working in, based on decision quality and modification depth." |
| AES | "AI Efficiency" | "AI effectiveness" | "A composite score (0-100) measuring how efficiently you collaborate with AI tools. Factors: direction, token usage, iteration count, context reuse." |
| Cost | "Cost (est.)" | "AI spend" | "Estimated token cost of your AI interactions today. Helps you see which conversations are expensive." |
| Events | "Events (24h)" | "Reasoning moments" | "Total captured events: commits, AI conversations, branch switches, and other signals from your workflow." |

#### B. Empty State Education

Current empty states across the app are generic: "Not enough data yet." Redesigned:

| Page | Current Empty State | Redesigned |
|------|-------------------|------------|
| Intelligence | "Not enough data yet. AI Efficiency Score requires 5+ AI interactions." | "Your AI effectiveness score builds from conversations with AI tools. Have 5+ AI interactions and check back — we'll show you patterns in how you collaborate." |
| Coach | "Patterns emerge after ~10 sessions" | "The more you work with AI tools, the more Unfade learns what prompting strategies work *for you specifically*. After ~10 sessions, you'll see your effective patterns vs. approaches that cost more iterations." |
| Profile | "Not enough data to build a reasoning profile yet." | "Your Reasoning Fingerprint grows with every decision you make. After 2+ daily distills, Unfade detects patterns in your decision style, domain expertise, and trade-off preferences. Keep working — your identity is building in the background." |
| Decisions | "No decisions found" | "Decisions are extracted when Unfade distills your daily activity. They capture what you chose, why, and what alternatives you considered. Run `unfade distill` or wait for the next automatic distill." |
| Alerts | "No alerts or replays" | "Alerts surface when Unfade detects sustained patterns that need attention — like a code area where comprehension is dropping, or a past decision that contradicts new evidence. These appear after 2+ weeks of data." |
| Cards | "No cards generated yet." | "Unfade Cards are visual summaries of your daily engineering work — shareable proof of what you built and how you thought through it. Generate your first one after your first daily distill." |

#### C. Progressive Disclosure Tooltips

First-visit tooltips (shown once, stored in localStorage) for key concepts:

1. **First commit captured**: "Unfade just saw your commit. From the commit message, changed files, and timing, it captures the decision behind the change — not just that it happened."
2. **First AI event captured**: "An AI conversation was detected. Unfade extracts what you asked, what the AI suggested, whether you accepted/modified/rejected it, and how much you directed the conversation."
3. **First distill generated**: "Your first Daily Distill is ready. This is a narrative summary of your engineering day — the decisions you made, trade-offs you evaluated, and patterns in your workflow."
4. **First pattern detected**: "Unfade detected a pattern in how you work. These get more accurate over time as more data accumulates. Patterns above 70% confidence are shown on your Fingerprint page."
5. **Direction reaches 50%+**: "Your Direction score crossed 50%. This means more than half your AI interactions today were human-directed — you're actively steering, not just accepting suggestions."

#### D. Contextual "What's this?" Links

Every major section header gets a small `(?)` or "What's this?" that expands inline:

```html
<h2>AI Effectiveness <button class="whats-this">(?)</button></h2>
<div class="explanation hidden">
  A composite score from 0-100 measuring how efficiently you collaborate 
  with AI tools. It factors in: how much you direct conversations (30%), 
  token efficiency (20%), iteration count (20%), context reuse (15%), 
  and modification depth (15%). Higher is better — it means you're getting 
  more value per AI interaction.
</div>
```

### 4.5 Real-Time Feedback System

**The key insight**: Users need to *feel* the system working, not just see status dots.

#### A. Capture Feedback (Replace "Event stream" with Annotated Activity)

Current event stream shows: `git | Committed auth middleware | 2s ago`

Redesigned annotated activity:

```
┌──────────────────────────────────────────────────┐
│  2:14 PM · git commit                             │
│  "Add JWT-based auth middleware"                   │
│                                                    │
│  → Decision captured: chose JWT over sessions      │
│  → Files: src/auth/jwt.ts, src/auth/middleware.ts  │
│  → Domain: authentication (deep engagement)        │
│  ─────────────────────────────────────────────────│
│  2:11 PM · AI conversation (Claude)                │
│  "Debated JWT vs session-based authentication"     │
│                                                    │
│  → Direction: 78% human-led                        │
│  → Outcome: accepted with modifications            │
│  → Cost: ~$0.03 (efficient)                        │
│  → Pattern match: you typically evaluate 2+        │
│    alternatives for security decisions             │
└──────────────────────────────────────────────────┘
```

Each event gets inline annotations showing what Unfade extracted — making the intelligence layer visible.

#### B. Compounding Feedback

A subtle "Unfade is learning" indicator that appears periodically:

```
┌─────────────────────────────────────────┐
│  ● Unfade learned something new          │
│                                          │
│  Pattern updated: "Evaluates 2+          │
│  alternatives for security decisions"    │
│  Confidence: 72% → 78% (+6)             │
│  Based on: 14 observations              │
│                                          │
│  [View pattern →]            [Dismiss]   │
└─────────────────────────────────────────┘
```

This creates the *feeling* of compounding — the user sees their fingerprint growing in real time.

#### C. MCP Context Injection Feedback

When Unfade's MCP tools are used by an AI assistant, show it:

```
┌─────────────────────────────────────────┐
│  ◆ Your reasoning was used               │
│                                          │
│  Claude Code queried your decision       │
│  history about auth patterns.            │
│  Context injected: 3 prior decisions     │
│  about JWT implementation.               │
│                                          │
│  This saved re-explaining your auth      │
│  approach from scratch.                  │
└─────────────────────────────────────────┘
```

This closes the value loop: capture → intelligence → context injection → visible benefit.

### 4.6 System Status Redesign

**Current**: System health dots on every page (home dashboard + live page + activation).

**Redesigned**: 

- **Live Strip** (the 36px bar at top): Single colored dot (green/yellow/red) + text "Live" or "Reconnecting". No SSE/Materializer/Intelligence labels. Click expands to detailed status on a System Health page.
- **Home Dashboard**: Zero system status. Replaced by insight narrative + annotated metrics.
- **System page** (under System nav group): Full system health with all technical details — Daemon PID, materializer lag, SSE connection, intelligence engine status, ingest state. This is where infrastructure-minded users go.
- **Live/Activity page**: Source filters (Git/AI/Terminal) + event stream. Health chips removed. Single "System OK" indicator in corner.

### 4.7 Language Style Guide (Across Entire UI)

| Instead of | Use |
|-----------|-----|
| "Capture engine" | "Watching your work" |
| "Events" | "Reasoning moments" or "activity" |
| "Materialization" / "Materializer" | (Don't expose — invisible infrastructure) |
| "Intelligence engine" | "Analyzing your patterns" |
| "SSE" | (Don't expose — show as "Live" connection dot) |
| "Direction %" | "Human-directed %" with definition |
| "Comprehension" | "Domain comprehension" with definition |
| "AES" | "AI effectiveness" with definition |
| "Distill" (as navigation) | "Today's Story" |
| "Daily Distill" (as page title) | "Daily Story" or "Reasoning Narrative" |
| "Configure Intelligence" | "Set up deeper analysis" |
| "Data materializer: ready" | (Don't expose) |
| "Reasoning signals" | "Reasoning moments" (signals sounds like noise) |
| "Not enough data yet" | Specific explanation of what's needed and what they'll see |
| "System health" (on dashboard) | (Move to System page) |
| "Warming up capture and materialization" | "Setting up — your first insights appear after a few events" |

### 4.8 Implementation Priority Map

#### P0 — Must-have for value communication (Week 1)

1. **Welcome screen** before setup wizard — hero statement + animated demo showing capture→extract→pattern flow
2. **Metric definitions** on home dashboard — every number gets one-line explanation
3. **Navigation relabeling** — "Your Work / Your Thinking / Your Growth" with tooltips
4. **Remove system health from dashboard** — move to System page, keep single Live Strip dot
5. **Redesigned empty states** — specific, educational text for every page

#### P1 — Important for "aha moment" (Week 2)

6. **Insight narrative block** on home — "What Unfade noticed today" replacing raw metrics as hero section
7. **Annotated activity stream** — events with inline extracted meaning (decision, direction, pattern match)
8. **Setup wizard reorder** — projects first, AI tools auto-detected, LLM config last and optional
9. **First-visit tooltips** — progressive disclosure for key concepts (5 tooltip moments)
10. **Contextual "What's this?" expanders** on every major section header

#### P2 — Compounding value feeling (Week 3)

11. **"Unfade learned something" notifications** — pattern updates, confidence changes
12. **MCP usage feedback** — show when AI tools query your reasoning history
13. **Today's Story page** — reframe distill with narrative intro + "what to notice" annotations
14. **Profile narrative** — add "Your Reasoning Story" paragraph above raw metrics on Fingerprint page
15. **Growth indicators** — "X% more data points than last week" on key pages

#### P3 — Polish (Week 4)

16. **Animated transitions** — smooth between activation and dashboard states
17. **Onboarding checklist widget** — persistent but dismissible "Getting Started" tracker
18. **Shareable summaries** — "Share this insight" on narratives and patterns
19. **Help system** — "Learn more about Unfade" section in Settings with concept glossary

---

## Summary: What Changes and Why

| Current State | Problem | Redesigned State |
|--------------|---------|-----------------|
| Setup starts with LLM config | Assumes user knows what Unfade does | Welcome screen explains value + live demo |
| Dashboard shows system health | Users see plumbing, not purpose | Dashboard shows insights + annotated metrics |
| Metrics have no definitions | Users see numbers without meaning | Every metric has inline one-line definition |
| Navigation uses internal taxonomy | Observe/Understand/Identity means nothing | "Your Work / Your Thinking / Your Growth" |
| Event stream shows raw events | Activity without extracted meaning | Annotated events showing decisions/patterns |
| Empty states say "not enough data" | No education about what's coming | Specific descriptions of what builds + when |
| "Distill" / "Coach" / "Direction" | Product jargon undefined for users | "Today's Story" / "Patterns" / "Human-directed %" |
| No compounding feedback | User doesn't feel value growing | Pattern update notifications + MCP usage alerts |
| Infrastructure visible everywhere | System concerns crowd out value | System status on System page only |
| 30 words total explaining what Unfade does | Product doesn't communicate its own novelty | Hero narrative + progressive tooltips + contextual education |

The fundamental shift: **from "here's what the system is doing" to "here's what the system learned about you."**

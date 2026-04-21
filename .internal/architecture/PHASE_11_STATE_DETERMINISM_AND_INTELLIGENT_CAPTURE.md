# Phase 11 — State Determinism & Intelligent Capture

> **Feature Statement:** _"Every prompt, session, and commit flowing through Unfade is a fully contextualized, self-describing event. The materializer never stalls, never loses data, and self-heals from any inconsistency. The intelligence layer knows what you're building, why you're building it, and how your workflow evolved — without you ever declaring it."_
>
> **Prerequisites:** [Phase 4 — Platform & Launch](./PHASE_4_PLATFORM_AND_LAUNCH.md) complete (server architecture, materializer, Go capture engine running). Existing event files in `.unfade/events/` written by Go daemon.
>
> **Status:** ✅ COMPLETE — 11A–11E all done. Sprint 11E completed 2026-04-21.
>
> **Foundation doc:** [Research & Design](./UNFADE_CLI_RESEARCH_AND_DESIGN.md)
>
> **Last updated:** 2026-04-21

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan (Sprints 11A–11E)](#6-implementation-plan-sprints-11a11e)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)
- [9. System Integration Audit & User Feedback Cross-Reference (RRVV — 2026-04-21)](#9-system-integration-audit--user-feedback-cross-reference-rrvv--2026-04-21)
- [10. Post-Capture Intelligence Evolution — RRVV Audit (2026-04-21)](#10-post-capture-intelligence-evolution--rrvv-audit-2026-04-21)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 11 solves two critical problems that block user value:

1. **State corruption:** The materializer can stall indefinitely on valid data. When the Go daemon rewrites event files during ingest, the cursor's byte offset becomes meaningless — but the system doesn't know that. Users see `eventCount24h: 0` even when events exist. This must be impossible by design.

2. **Shallow capture:** Current events capture *what happened* but not *why*, *what for*, or *how it connects*. An AI conversation collapses to a 200-char summary. The system can't answer "what was I working on?", "which prompts led to this commit?", or "show me everything about the auth refactor." This is the gap between a logging system and an intelligence system.

### 1.2 The Principle

> **State is deterministic when any valid sequence of inputs produces identical output regardless of restart timing, crash history, or concurrent writers. Capture is intelligent when every event carries enough context for any downstream pipeline to operate without guesswork.**

---

## 2. The Problem

### Current State

| Concern | State |
|---|---|
| **Cursor reliability** | Stalls if Go daemon rewrites file during ingest. No epoch awareness. Invalid cursor returns -1 → system stuck forever |
| **Crash recovery** | Manual intervention required. Deleting `.unfade/` and restarting may produce partial state |
| **Event richness** | Summary truncated to 200 chars. No full prompt. No file tracking. No sequence ordering. No feature grouping |
| **Feature detection** | Not implemented. Events are isolated — can't group by feature or reconstruct work arcs |
| **Cross-event linking** | Not implemented. Can't answer "which prompt led to this commit?" |
| **Execution phase** | Not captured. Can't distinguish debugging from implementing from testing |
| **Outcome tracking** | Not captured. Can't tell if an interaction succeeded, failed, or was abandoned |

### After Phase 11

| Concern | State |
|---|---|
| **Cursor reliability** | File epoch protocol detects any content change. Self-healing per-file rebuild. Never stalls |
| **Crash recovery** | Automatic within one tick (5s). Atomic cursor persistence via tmp+rename |
| **Event richness** | Full prompts inline (all turns, 5KB quality cap each), file modifications, tool calls, sequence IDs, execution phase, intent |
| **Feature detection** | Streaming 3-strategy algorithm: branch match → file overlap → temporal proximity |
| **Cross-event linking** | `continues_from`, `triggered_commit`, `related_events` — automatic relationship detection |
| **Execution phase** | Auto-classified from prompt keywords + tool patterns: exploring, implementing, debugging, etc. |
| **Outcome tracking** | Derived post-materialization: success, partial, failed, abandoned |

---

## 3. Research

### 3.1 State Management Patterns (Industry Comparison)

| System | Pattern | Key Insight for Unfade |
|---|---|---|
| **Apache Kafka** | Consumer offset + partition epoch | Offset is meaningless without knowing the file version |
| **Redis Streams** | Monotonic IDs per consumer group | Use sequence numbers independent of byte position |
| **Git** | Content-addressed refs | Content addressing eliminates stale reference by design |
| **SQLite WAL** | Readers see consistent snapshot; explicit checkpointing | WAL checkpoint provides the "epoch boundary" |
| **Prometheus TSDB** | Immutable blocks + WAL for recovery | Explicit compaction boundaries signal "done writing" |

**Takeaways applied:**
1. File epoch markers (SHA-256 of first 64 bytes) — detects any rewrite
2. Monotonic sequence IDs per session — ordering independent of clock
3. Writer-reader lock signal (`.ingest.lock`) — explicit "done writing" marker
4. Per-file rebuild on mismatch — targeted recovery, not full rebuild

### 3.2 Execution Phase Classification Research

| Signal Source | What It Reveals | Reliability |
|---|---|---|
| Prompt keywords ("fix", "debug", "test") | User's declared intent | High for explicit statements |
| Tool usage pattern (Read-only vs Edit/Write) | What actually happened | High — ground truth |
| File types touched (`.test.ts`, `.config.js`) | Domain of work | Medium — heuristic |
| Iteration count on same files | Debugging loop detection | Medium — needs threshold |

**Classification rules (ordered by priority):**

| Phase | Trigger | Confidence |
|---|---|---|
| `debugging` | Prompt contains: debug, fix, error, broken, not working, fails, crash | High |
| `testing` | Prompt contains: test, spec, coverage, assert | High |
| `refactoring` | Prompt contains: refactor, rename, extract, move, clean up, simplify | High |
| `reviewing` | Prompt contains review/check/audit AND no files modified | High |
| `configuring` | Prompt contains: configure, setup, install, .env, package.json | Medium |
| `exploring` | Only Read/Grep/Glob tool calls, no Edit/Write | High |
| `implementing` | Has Edit/Write tool calls with files_modified | High (default) |

### 3.3 Outcome Derivation Research

| Signal | Inferred Outcome | Confidence |
|---|---|---|
| Conversation produces Edit/Write tool calls | `success` | High |
| Last user prompt contains "never mind", "cancel", "skip" | `abandoned` | High |
| iteration_count > 5 with no file output | `failed` | Medium |
| Context switch (next event touches entirely different files) | `partial` | Medium |
| Session ends naturally after producing output | `success` | High |

### 3.4 Feature Boundary Detection Strategies

| Strategy | Signal | Strength | Threshold |
|---|---|---|---|
| Branch name match | `feat/auth`, `fix/login` | Strongest — explicit declaration | Exact match |
| File cluster overlap | Jaccard similarity of files touched | Strong — shared code = shared feature | > 0.4 |
| Temporal proximity | Time gap between events | Weak — only valid with other signals | < 2 hours |
| Time gap = feature split | Long silence on same branch | Medium — context switch detection | > 4 hours |

---

## 4. Architecture

### 4.1 Data Flow (Complete Pipeline)

```
┌───────────────────────────────────────────────────────────────────┐
│                     User's AI Tool Sessions                        │
│  ~/.claude/projects/   ~/.cursor/   ~/.codex/   ~/.aider/         │
└─────────┬──────────────────┬─────────────┬────────────────────────┘
          │                  │             │
          ▼                  ▼             ▼
┌───────────────────────────────────────────────────────────────────┐
│                    Go Capture Engine (unfaded)                      │
│                                                                    │
│  ┌──────────┐  ┌───────────────┐  ┌────────────────────────────┐ │
│  │ Parsers  │  │ Classifier    │  │ Event Enrichment            │ │
│  │ Claude   │→ │ HDS Score     │→ │ + repo_root, repo_name     │ │
│  │ Cursor   │  │ Specificity   │  │ + sequence_id (monotonic)  │ │
│  │ Codex    │  │ Direction     │  │ + prompts_all (all turns)  │ │
│  │ Aider    │  │               │  │ + files_modified/referenced│ │
│  └──────────┘  └───────────────┘  │ + tool_calls_summary       │ │
│                                    │ + execution_phase           │ │
│                                    │ + intent_summary            │ │
│                                    │ + feature_signals           │ │
│                                    │ + session boundaries        │ │
│                                    └───────────┬─────────────────┘ │
│                                                │                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Event Writer                                                 │  │
│  │  → .unfade/events/YYYY-MM-DD.jsonl      (event data)        │  │
│  │  → .unfade/events/YYYY-MM-DD.jsonl.epoch (content hash)     │  │
│  │  → .unfade/events/.ingest.lock          (during write)      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬──────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│              TypeScript Materializer (in-process)                   │
│                                                                    │
│  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │ Lock Check   │  │ Epoch Validate  │  │ Per-File Rebuild     │ │
│  │ (.ingest.lock│→ │ (SHA-256 match) │→ │ (self-healing)       │ │
│  │  present? →  │  │ Staleness check │  │ Invalid → reset to 0 │ │
│  │  skip tick)  │  │ (grew > 2x?)   │  │ Reprocess idempotent │ │
│  └──────────────┘  └─────────────────┘  └─────────────────────┘ │
│                              │                                     │
│                              ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ SQLite Cache (unfade.db) — WAL mode                          │  │
│  │  events │ decisions │ metric_snapshots │ events_fts           │  │
│  │  features │ event_features │ event_links                     │  │
│  │  comprehension_proxy │ direction_by_file │ token_proxy_spend │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Intelligence Layer (post-materialization)                     │  │
│  │  • Feature Boundary Detection (branch → files → temporal)   │  │
│  │  • Cross-Event Linking (continues_from, triggered_commit)   │  │
│  │  • Outcome Classification (success/partial/failed/abandoned)│  │
│  │  • Comprehension Scoring                                    │  │
│  │  • Direction Computation                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬──────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│                    HTTP Dashboard + MCP Server                      │
│                                                                    │
│  /api/summary          → Metrics + feature list                   │
│  /api/features/:id     → Feature timeline + narrative             │
│  /api/sessions/:id     → Session replay with full prompts         │
│  /api/events?feature=X → Events filtered by feature               │
│  MCP: unfade-context   → Rich feature-aware context injection     │
│  MCP: unfade-query     → Full-text search over events + distills  │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 File Epoch Protocol

Each JSONL event file has a companion `.epoch` file containing `SHA-256(first 64 bytes)[:32]`.

```
.unfade/events/
├── 2026-04-20.jsonl              # Event data (Go daemon writes, no artificial size limit)
├── 2026-04-20.jsonl.epoch        # SHA-256 of first 64 bytes (Go writes after data finalized)
└── .ingest.lock                  # Present ONLY while Go daemon is actively writing
```

**Invariant:** If epoch file content ≠ cursor's stored epoch → file was rewritten → reset cursor for that file to byte 0 → reprocess (idempotent via INSERT OR REPLACE).

### 4.3 Cursor Schema

```typescript
interface MaterializerCursor {
  schemaVersion: 1;
  streams: Record<string, StreamCursor>;
}

interface StreamCursor {
  file: string;           // Absolute path
  byteOffset: number;     // Bytes processed so far
  lastLineHash: string;   // SHA-256 of last processed line (validates position)
  epoch?: string;         // Must match .epoch file content
  fileSize?: number;      // File size at last tick (staleness detection)
}
```

**Validation sequence:**
1. Check `.ingest.lock` → if present, skip entire tick
2. For each file: check epoch match → if mismatch, delete cursor entry → reprocess from 0
3. Check `byteOffset ≤ file.size` → if exceeded, cursor invalid → reprocess from 0
4. Check `lastLineHash` matches content at offset → if mismatch, reprocess from 0
5. Staleness: if `currentFileSize > savedFileSize × 2` → warn + reprocess from 0

**Persistence:** Atomic write via `tmp` file + `rename`. Never partial cursor on disk.

### 4.4 Enriched Event Metadata Schema

All fields in `metadata` object of CaptureEvent:

```
metadata: {
  // ═══ IDENTITY ═══
  ai_tool: string              // Parser name: "claude-code", "cursor", "codex", "aider"
  session_id: string           // Session UUID (groups interactions within one session)
  conversation_id: string      // Conversation grouping key
  repo_root: string            // Absolute path to git repo root
  repo_name: string            // basename(repo_root)

  // ═══ SEQUENCING ═══
  sequence_id: number          // Monotonic per-session (persisted across daemon restarts)
  turn_count: number           // Total turns in conversation (user + assistant + system)
  iteration_count: number      // User turn count only (interaction depth)
  prompt_count: number         // Number of user prompts in this event
  prompt_timestamps: string[]  // ISO timestamps of each user turn

  // ═══ CONTENT PRESERVATION ═══
  prompt_full: string          // Full first user prompt (10KB quality cap)
  prompts_all: string[]        // ALL user prompts, each 5KB cap, max 20 entries
  tool_calls_summary: object[] // Up to 50 tool call entries [{name, target}]
  files_referenced: string[]   // Paths from Read/Glob/Grep tool calls
  files_modified: string[]     // Paths from Edit/Write tool calls

  // ═══ CLASSIFICATION ═══
  execution_phase: string      // "exploring"|"implementing"|"debugging"|"refactoring"|"testing"|"reviewing"|"configuring"
  intent_summary: string       // One-line goal inference from first prompt (max 200 chars)
  outcome: string              // DERIVED post-materialization: "success"|"partial"|"failed"|"abandoned"|"in_progress"

  // ═══ SESSION LIFECYCLE ═══
  trigger: string              // "user_initiated"|"continuation"|"mcp_invoked"|"watcher_triggered"
  session_start: string        // ISO timestamp of session start
  session_end: string          // ISO timestamp of last activity (set retroactively)
  conversation_complete: bool  // True if conversation reached natural end
  continues_session: string    // session_id of previous session if detected as continuation

  // ═══ ENVIRONMENT ═══
  model_id: string             // e.g. "claude-opus-4-6", "gpt-4o"
  environment: string          // "cli"|"ide"|"web"|"api"

  // ═══ FEATURE SIGNALS ═══
  feature_signals: {
    branch: string             // Git branch name
    file_cluster: string[]     // Union of all files touched
    dominant_path: string      // Most common directory prefix
  }
  feature_tag: string          // User-declared feature name (explicit override via MCP/CLI)
  task_ref: string             // External issue reference (e.g., "GH-123")

  // ═══ DIRECTION (existing, from HDS classifier) ═══
  direction_signals: {
    hds: number                // Human Direction Score (0-1)
    classification: string     // "human-directed"|"collaborative"|"llm-directed"
    signals: object            // Individual signal components
  }
}
```

**Storage rationale:** With no artificial line size limit (see §4.8), all metadata lives in a single JSONL line per event. The Go daemon writes everything inline. Typical AI session events are 5–50KB; git events are 200–500 bytes. Field-level caps exist for quality (preventing degenerate data), not storage.

### 4.5 SQLite Schema Extension

```sql
-- Feature tracking (streaming assignment)
CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  branch TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  event_count INTEGER DEFAULT 0,
  file_count INTEGER DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'  -- active | completed | stale
);

-- Event-to-feature mapping (many-to-many)
CREATE TABLE IF NOT EXISTS event_features (
  event_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  PRIMARY KEY (event_id, feature_id)
);

-- Cross-event relationship links
CREATE TABLE IF NOT EXISTS event_links (
  from_event TEXT NOT NULL,
  to_event TEXT NOT NULL,
  link_type TEXT NOT NULL,  -- continues_from | triggered_commit | related_events
  metadata TEXT,            -- JSON: {sharedFiles: N} for related_events
  PRIMARY KEY (from_event, to_event, link_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_features_branch ON features(branch);
CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
```

### 4.6 Feature Boundary Detection Algorithm

```
For each newly materialized event E:

  1. Load active features (status = 'active', last 50 by recency)
  2. Extract: branch(E), files(E), timestamp(E)

  3. Strategy 1 — Branch match (strongest):
     IF branch(E) ∉ {main, master, develop}:
       IF ∃ feature F where F.branch == branch(E):
         → Assign E to F
       ELSE:
         → Create new feature from branch (name = branch without prefix)

  4. Strategy 2 — File cluster overlap:
     FOR each active feature F:
       jaccard = |files(E) ∩ F.files| / |files(E) ∪ F.files|
       timeDelta = timestamp(E) - F.lastSeen
       IF jaccard > 0.4 AND timeDelta < 4 hours:
         → Assign E to F (best jaccard wins)

  5. Strategy 3 — Temporal proximity (weakest):
     IF ∃ active feature F where timestamp(E) - F.lastSeen < 2 hours:
       → Assign E to most recent F

  6. No match → Create new unnamed feature

  7. Mark features stale if lastSeen > 7 days ago
```

### 4.7 Cross-Event Linking Rules

| Link Type | Condition | Direction |
|---|---|---|
| `continues_from` | Same session_id, event B timestamp > event A, B is next chronologically | A → B |
| `triggered_commit` | AI event A, git commit B, B.timestamp - A.timestamp < 5 minutes | A → B |
| `related_events` | Different events touching same files within 1 hour | earlier → later |

### 4.8 Removing the Artificial Line Size Limit

**Problem discovered via RRVV audit:** The EventWriter enforces a **4096-byte hard limit per JSON line** (`maxLineBytes = 4096` in `writer.go`). The comment claims this is for atomic O_APPEND guarantees (POSIX PIPE_BUF). This limit causes `truncateIfNeeded()` to silently destroy prompt data, making `prompt_full` (10KB) and `prompts_all` (100KB) impossible.

**The limit is based on a misunderstanding and must be removed:**

1. **PIPE_BUF applies to pipes/FIFOs, not regular files.** O_APPEND on regular files is atomic at any write size — the kernel holds the inode lock during the combined seek+write operation.
2. **Single writer guarantee.** The Go daemon is the exclusive owner of `.unfade/events/`. The EventWriter is a single goroutine consuming from a channel. No concurrent writers exist.
3. **Ingest lock provides additional safety.** The materializer won't read while `.ingest.lock` is present, so there's zero reader-writer contention on the file.

**Resolution:**
- Remove `maxLineBytes` constant and `truncateIfNeeded()` function entirely from `writer.go`
- Each JSONL line is as large as it needs to be (typical: 5-50KB for AI sessions, 200-500 bytes for git events)
- Content caps remain at the field level for quality reasons (not storage): `prompt_full` 10KB, `prompts_all` 5KB×20, `tool_calls_summary` max 50 entries
- No sidecar files needed — everything lives in a single JSONL line per event

### 4.9 Downstream Consumer Gap Analysis

**Audit of what each consumer reads vs what it needs (validated 2026-04-21):**

| Consumer | Currently Reads | Missing (addressed in 11D) |
|---|---|---|
| `signal-extractor.ts` | `content.summary`, `content.files`, `metadata.direction_signals`, `metadata.turn_count` | `execution_phase` (time allocation), `prompts_all` (reasoning chains), `outcome` (success rate) |
| `context-linker.ts` | `content.files`, `content.summary/detail`, `gitContext.branch` | `intent_summary` (narrative arcs), `feature_signals` (grouping) |
| `unfade-context.ts` | `summary`, `detail`, `branch`, `timestamp` | `execution_phase`, `intent_summary`, feature context |
| `prompt-patterns.ts` | `content_summary` (200 chars!), `content_detail`, `direction_signals.hds` | `prompt_full` (actual prompt text — currently truncated to oblivion by 4KB limit) |
| `feature-boundary.ts` | `metadata.files_modified`, `metadata.session_id`, `git_branch` | Working correctly — no gaps |

**Key insight:** The prompt-patterns analyzer is currently analyzing 200-character summaries instead of actual prompts. With the size limit removed, full prompts flow through the standard JSONL → materializer → SQLite pipeline.

---

## 5. Design Principles

### 5a. Self-Healing by Default

The materializer NEVER stalls. Any inconsistency triggers automatic recovery:
- Invalid cursor → rebuild that file from byte 0 (not the entire system)
- Epoch mismatch → same: per-file rebuild
- File grew > 2× since last tick → reprocess from 0 (staleness detection)
- Ingest lock present → skip tick, retry next cycle (5s)

Recovery actions produce identical state to a clean run. Upserts (`INSERT OR REPLACE`) make reprocessing idempotent.

### 5b. One Writer Per File, Lock Protocol for Coordination

The Go daemon OWNS `.unfade/events/`. TypeScript ONLY reads it. Coordination via:
- `.ingest.lock` — present while Go daemon is writing. Materializer defers.
- `.epoch` files — written AFTER data is finalized. Materializer validates before trusting cursor.

No two processes ever write the same file.

### 5c. Capture Rich, Process Lazy

The Go daemon captures EVERYTHING available at write time (full prompts, all tool calls, file paths, timestamps). The TypeScript intelligence layer DERIVES higher-order signals (execution_phase classification, outcome, feature assignment) post-materialization. This separation means:
- Capture never blocks on expensive computation
- Intelligence can be re-run on existing data if algorithms improve
- Raw events are the source of truth; derived data is always reconstructible

### 5d. Events Are Self-Describing

Every event carries enough metadata to be understood in isolation. No event requires external state, configuration, or other events to be interpretable. Fields like `repo_root`, `execution_phase`, `intent_summary`, and `feature_signals` ensure any pipeline stage can operate on a single event without context.

### 5e. Quality Caps, Not Storage Caps

Field-level caps exist to prevent degenerate data, not to save disk space (local storage is not a concern):
- `prompts_all`: max 20 entries × 5KB = 100KB absolute max per event
- `tool_calls_summary`: max 50 entries
- `prompt_full`: max 10KB
- `intent_summary`: max 200 chars

Typical AI session event: 5–50KB. At 100 events/day: ~2–5MB/day, ~60–150MB/month. Acceptable for local storage. No artificial line size limits — quality and reliability are the only constraints.

---

## 6. Implementation Plan (Sprints 11A–11E)

### Phase 11 Boundary

> **What the AI agent MUST know before touching Phase 11 code:**

**READS** (from previous phases):

| Data | Source | Schema | Owner |
|---|---|---|---|
| AI session JSONL | `~/.claude/projects/`, `~/.cursor/`, etc. | Parser-specific | AI tools (write), Go daemon (read) |
| Event files | `.unfade/events/*.jsonl` | `CaptureEventSchema` | Go daemon (write), TypeScript (read) |
| SQLite cache | `.unfade/cache/unfade.db` | See §4.5 | TypeScript materializer |
| Cursor state | `.unfade/state/materializer.json` | See §4.3 | TypeScript materializer |

**WRITES** (in Phase 11):

| Data | Destination | Schema | Owner |
|---|---|---|---|
| Enriched events | `.unfade/events/*.jsonl` | Extended metadata (§4.4) | Go daemon |
| Epoch markers | `.unfade/events/*.jsonl.epoch` | SHA-256 hex string (32 chars) | Go daemon |
| Ingest lock | `.unfade/events/.ingest.lock` | PID as text | Go daemon |
| Sequence state | `.unfade/state/sequences.json` | `{sessions: {id: lastSeqId}}` | Go daemon |
| Feature records | `features` table | See §4.5 | TypeScript intelligence |
| Event-feature links | `event_features` table | See §4.5 | TypeScript intelligence |
| Cross-event links | `event_links` table | See §4.5 | TypeScript intelligence |
| Outcome classifications | Events metadata (derived) | `outcome` field | TypeScript intelligence |

---

### Sprint 11A — State Determinism (DONE)

**Objective:** Eliminate all stale cursor scenarios. Materializer self-heals from any inconsistency within one tick.

**Acid test:**

```bash
# Delete state and verify recovery:
rm -rf .unfade/state/materializer.json .unfade/cache/ && \
  unfade & sleep 10 && \
  curl -s localhost:7654/api/summary | jq '.eventCount24h > 0' && \
  echo "PASS: Self-healing works"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **11A.1** | File epoch protocol — Go daemon writes `.epoch` file (SHA-256 of first 64 bytes) after finalizing each JSONL file. TypeScript cursor validates epoch before trusting offset. Epoch mismatch → per-file rebuild. | `daemon/internal/capture/epoch.go`, `daemon/internal/capture/writer.go`, `src/services/cache/cursor.ts` | ✓ |
| **11A.2** | Ingest lock protocol — Go daemon writes `.ingest.lock` before ingest, removes after. Materializer checks for lock at tick start — if present, returns 0 (defers to next tick). | `daemon/internal/capture/historical.go`, `src/services/cache/materializer.ts` | ✓ |
| **11A.3** | Self-healing cursor with per-file rebuild — invalid cursor for file X resets ONLY that file's cursor to 0, reprocesses from start. Idempotent via `INSERT OR REPLACE`. Never stalls. | `src/services/cache/materializer.ts` | ✓ |
| **11A.4** | Startup synchronization — TypeScript waits for Go daemon's ingest lock to clear (polls 500ms, 30s timeout) before first materializer tick. | `src/services/daemon/repo-manager.ts` | ✓ |
| **11A.5** | Staleness detection — if file grew > 2× since cursor was saved, warn and reprocess from byte 0. Catches cases where append-only assumption breaks silently. | `src/services/cache/materializer.ts` | ✓ |

> **Agent Directive for Sprint 11A:** "You are fixing the materializer's state management. Work in `src/services/cache/cursor.ts` and `src/services/cache/materializer.ts`. Add epoch field to StreamCursor interface. Add `readEpochFile()` function that reads `.epoch` companion files. Modify `isCursorValid()` to check epoch match first, then existing offset/hash checks. Modify `materializeEventsIncremental()` to (a) check `.ingest.lock` at top — if present, return 0; (b) for each file, if cursor invalid, delete cursor entry and process from byte 0; (c) after processing, save epoch + fileSize in cursor. Modify Go daemon to write `.epoch` files after each JSONL write and `.ingest.lock` during ingest. All recovery produces identical state to clean rebuild."

**Strict contracts:**
- Epoch: SHA-256 of first 64 bytes of JSONL file, hex-encoded, first 32 chars
- Lock: `.unfade/events/.ingest.lock` contains daemon PID as text
- Cursor: atomic write via `writeFileSync(tmp)` + `renameSync(tmp, target)`
- Recovery: per-file only, never full-system rebuild on single-file mismatch
- Upsert: `INSERT OR REPLACE INTO events` keyed on `id` — reprocessing is idempotent

---

### Sprint 11B — Project-Aware Intelligent Capture (DONE)

**Objective:** Go capture engine produces rich, self-describing events with project context, file tracking, sequence ordering, and feature signals.

**Acid test:**

```bash
# Verify enriched capture:
tail -1 .unfade/events/$(date +%Y-%m-%d).jsonl | jq '{
  has_repo: (.metadata.repo_root != ""),
  has_prompt: (.metadata.prompt_full | length > 50),
  has_files: (.metadata.files_modified | length > 0),
  has_sequence: (.metadata.sequence_id >= 0),
  has_phase: (.metadata.execution_phase != null)
}' | grep -v false && echo "PASS: Enriched capture works"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **11B.1** | Enhanced metadata — Add `repo_root`, `repo_name`, `feature_signals` to every AI session event. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11B.2** | Full prompt preservation — Store complete first user prompt in `prompt_full` (10KB cap). No more 200-char truncation for primary content. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11B.3** | File modification tracking — Differentiate read (Glob/Grep/Read) vs write (Edit/Write) tool calls. Populate `files_referenced` and `files_modified` arrays. `tool_calls_summary` with max 50 entries. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11B.4** | Monotonic sequence IDs — Package-level counter per session. Every event gets a `sequence_id` that's strictly increasing within its session. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11B.5** | Feature boundary detection — Streaming 3-strategy assignment algorithm in TypeScript intelligence layer. Creates/updates features table. | `src/services/intelligence/feature-boundary.ts` | ✓ |
| **11B.6** | Cross-event linking — Detect `continues_from` (same session ordering), `triggered_commit` (git commit within 5 min), `related_events` (file overlap within 1 hour). | `src/services/intelligence/feature-boundary.ts` | ✓ |
| **11B.7** | SQLite schema extension — Add `features`, `event_features`, `event_links` tables with appropriate indices. | `src/services/cache/manager.ts`, `src/services/cache/schema.ts` | ✓ |

> **Agent Directive for Sprint 11B:** "You are enriching the Go capture engine and building the TypeScript intelligence layer. For Go work: modify `conversationToEvent()` in `daemon/internal/capture/ai_session.go` to populate all new metadata fields. Add `extractFullPrompt()` (10KB cap), `extractFileInfo()` (differentiates read/write), `summarizeToolCalls()` (max 50), `nextSequenceID()` (monotonic per-session), `extractPromptTimestamps()`, `countIterations()`. For TypeScript work: create `src/services/intelligence/feature-boundary.ts` with `assignEventsToFeatures(db, eventIds)` implementing the 3-strategy algorithm (branch → Jaccard > 0.4 → temporal < 2h) and `linkRelatedEvents(db, eventIds)` implementing all three link types. Add schema tables in `src/services/cache/schema.ts`. Both: all logging to stderr. stdout is sacred."

**Strict contracts:**
- `prompt_full`: max 10KB, first user prompt with content > 5 chars
- `files_referenced`: paths from Read/Glob/Grep tool inputs
- `files_modified`: paths from Edit/Write tool inputs
- `tool_calls_summary`: `[{name: string, target?: string}]`, max 50 entries
- `sequence_id`: monotonic per `session_id`, starts at 0
- Feature detection: branch match (exact) → Jaccard > 0.4 within 4h → temporal < 2h
- Feature staleness: mark `status = 'stale'` if `last_seen` > 7 days ago
- Link `triggered_commit`: AI event → git commit within 5 minutes after
- Link `related_events`: file overlap > 0 within 1 hour, stored with `{sharedFiles: N}` metadata

---

### Sprint 11C — Integration Test Suite (DONE)

**Objective:** Comprehensive test coverage validating state determinism guarantees and intelligence layer correctness.

| ID | Task | Files | Done |
|---|---|---|---|
| **11C.1** | State determinism tests (TypeScript) — 6 tests: fresh start count, crash recovery, epoch detection, ingest lock, staleness detection, per-file rebuild | `test/integration/state-determinism.test.ts` | ✓ |
| **11C.2** | Capture quality tests (Go) — 5 tests: full prompt preserved, prompt truncation at 10KB, files modified tracked, sequence IDs monotonic, repo association | `daemon/internal/capture/ai_session_test.go` | ✓ |
| **11C.3** | Feature boundary tests (TypeScript) — 8 tests: groups by branch, merges by file overlap, names from branch prefix, marks stale, continues_from links, triggered_commit links, related_events links, no link > 1h | `test/integration/feature-boundary.test.ts` | ✓ |

---

### Sprint 11D — Capture Enrichment & Intelligence (DONE ✅ 2026-04-21)

**Objective:** Remove the artificial 4KB line limit, capture ALL user prompts inline, auto-classify execution phase and intent, track session lifecycle, derive outcomes, and feed enriched data into the distill pipeline.

**Acid test:**

```bash
# Verify full prompts captured (no truncation):
tail -1 .unfade/events/$(date +%Y-%m-%d).jsonl | jq '
  (.metadata.prompts_all | length > 0) and
  (.metadata.execution_phase != null) and
  (.metadata.intent_summary | length > 10)
' && echo "PASS: Enriched capture works"

# Verify prompts materialized into DB:
sqlite3 .unfade/cache/unfade.db "SELECT COUNT(*) FROM events WHERE json_extract(metadata, '$.prompts_all') IS NOT NULL" | grep -v '^0$' && echo "PASS: Full prompts in DB"

# Verify outcome derivation:
sqlite3 .unfade/cache/unfade.db "SELECT COUNT(*) FROM events WHERE json_extract(metadata, '$.outcome') IS NOT NULL" | grep -v '^0$' && echo "PASS: Outcomes derived"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **11D.0** | Remove artificial size limit — Delete `maxLineBytes` constant and `truncateIfNeeded()` function entirely from `writer.go`. Events are written as single JSONL lines with no size cap. O_APPEND on regular files is atomic at any size (single writer, ingest lock for reader coordination). See §4.8. | `daemon/internal/capture/writer.go` | ✓ |
| **11D.1** | All-prompts capture — `extractAllPrompts()` returns all user prompts (5KB quality cap each, max 20). Written inline in event metadata as `prompts_all` array. `prompt_count` integer for quick checks. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11D.2** | Execution phase classification — Auto-classify from prompt keywords + tool patterns. Keyword priority rules (§3.2). Falls back to "implementing" when no clear signal. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11D.3** | Intent summary extraction — First sentence of first meaningful user prompt, max 200 chars. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11D.4** | Session boundary markers — `session_start` (first turn timestamp), `conversation_complete` (parser detects natural end), `session_end` (set retroactively on next event or timeout). | `daemon/internal/capture/ai_session.go` | ✓ |
| **11D.5** | Sequence ID persistence — Persist `sessionSeqCounters` to `.unfade/state/sequences.json` on daemon shutdown, load on startup. Ensures monotonic IDs survive restarts. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11D.6** | Environment and model extraction — Parse `model_id` and `environment` from AI tool session data. | `daemon/internal/capture/parsers/claude_code.go`, `daemon/internal/capture/parsers/cursor.go` | ✓ |
| **11D.7** | Trigger context detection — Detect `continuation` (same branch + same files within 2h), `mcp_invoked`, default `user_initiated`. | `daemon/internal/capture/ai_session.go` | ✓ |
| **11D.8** | Outcome classification — TypeScript intelligence module. Runs post-materialization. Applies rules from §3.3 to derive outcome per event. Writes to event metadata in DB (not source JSONL). | `src/services/intelligence/outcome-classifier.ts` | ✓ |
| **11D.9** | Feature tag binding — MCP tool `unfade-tag` and CLI `unfade tag <feature-name>` to explicitly set `feature_tag` on recent events. Escape valve when heuristics fail. | `src/services/mcp/tools.ts`, `src/commands/tag.ts` | ✓ |
| **11D.10** | Distill pipeline enrichment — Signal extractor consumes `execution_phase` (time allocation), `prompts_all` (reasoning chains), `outcome` (success rate). Context linker uses `intent_summary` for narrative arcs. Prompt-patterns analyzer reads full `prompt_full` from materialized DB instead of 200-char summary. | `src/services/distill/signal-extractor.ts`, `src/services/distill/context-linker.ts`, `src/services/intelligence/analyzers/prompt-patterns.ts` | ✓ |

> **Agent Directive for Sprint 11D:** "You are completing the capture enrichment system. CRITICAL CONTEXT: The EventWriter previously had a 4KB line limit that destroyed prompt data. This limit has been removed (see §4.8) — O_APPEND on regular files is atomic at any size with a single writer, and the ingest lock prevents reader contention.
>
> For Go work (11D.0–11D.7): First, remove `maxLineBytes` constant and `truncateIfNeeded()` function from `writer.go` — events are now unlimited size. Then modify `conversationToEvent()` in `ai_session.go` to write all enrichment fields inline in the event metadata. Add `extractAllPrompts()` (5KB quality cap each, max 20), `classifyExecutionPhase()` (keyword matching → 7 phases), `extractIntentSummary()` (first sentence, 200 chars). Track `session_start`, persist sequence counters.
>
> For TypeScript (11D.8–11D.10): Create `outcome-classifier.ts` with rules: files_modified → success, abandon keywords → abandoned, high iteration no output → failed, context switch → partial. Update distill signal-extractor and prompt-patterns analyzer to read full prompts from materialized DB. All logging to stderr. stdout is sacred."

**Strict contracts:**
- **No line size limit:** `maxLineBytes` and `truncateIfNeeded()` removed entirely. Events are as large as they need to be.
- `prompt_full`: full first user prompt, 10KB quality cap
- `prompts_all`: `string[]`, each entry max 5KB (`content[:5120] + "... [truncated]"`), max 20 entries
- `execution_phase`: one of `"exploring"`, `"implementing"`, `"debugging"`, `"refactoring"`, `"testing"`, `"reviewing"`, `"configuring"`
- `intent_summary`: max 200 chars, derived from first sentence of first user prompt
- `session_start`: ISO timestamp of first turn in session (not first event — actual session start)
- `conversation_complete`: `true` when parser detects natural conversation end (last turn is assistant without pending)
- `sequence_id` persistence: `sequences.json` format: `{"sessions": {"session-uuid": lastId}, "updated": "ISO"}`
- `outcome`: NEVER written to source JSONL — derived in TypeScript, stored in DB metadata column
- `feature_tag`: user-set via CLI/MCP, stored in `event_features` table with explicit `source = 'user'` marker

---

### Sprint 11E — Cross-Analyzer Intelligence & Narrative Synthesis ✅ COMPLETE

**Objective:** Complete the capture→display pipeline with cross-analyzer correlation, narrative synthesis, lineage-backed transparency, and phase-normalized baselines. This sprint requires Phase 12A–12C to be complete (8 analyzers producing stable output for 2+ weeks) before execution.

**Prerequisites:**
- Phase 12A complete (IntelligenceEngine wired, lineage populated)
- Phase 12C complete (session materializer running, analyzers upgraded with Phase 11 fields)
- Minimum 2 weeks of populated intelligence data to train correlation thresholds

**Acid test:**

```bash
# Verify cross-analyzer correlation produces causal links:
cat .unfade/intelligence/correlation.json | jq '.correlations | length > 0' && echo "PASS: Cross-analyzer correlations found"

# Verify narrative insights generated:
cat .unfade/intelligence/narratives.jsonl | tail -1 | jq '.claim' && echo "PASS: Narrative insight produced"

# Verify lineage drill-through works:
curl -s localhost:7654/api/intelligence/lineage/$(jq -r '.id' .unfade/intelligence/narratives.jsonl | tail -1) | jq '.sourceEvents | length > 0' && echo "PASS: Lineage traces to source events"

# Verify phase-normalized HDS baselines:
curl -s localhost:7654/api/intelligence/comprehension | jq '.phaseBaselines' && echo "PASS: Phase-specific baselines computed"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **11E.1** | Cross-analyzer correlation module — After all 8 analyzers produce output, compute pairwise correlations: efficiency↔loops (are loops causing efficiency drops?), comprehension↔velocity (does understanding correlate with speed?), cost↔outcomes (does spending more produce better outcomes?), blind-spots↔loops (are you stuck where you're weakest?). Require Pearson r > 0.6 AND temporal ordering to assert causality. Output: `correlation.json` with `{ pairs: [{ a, b, r, direction, temporalLag }] }` | `src/services/intelligence/cross-analyzer.ts` | [x] |
| **11E.2** | Narrative synthesis layer — Template-based (no LLM) causal claim generator. Runs every 60s. Reads correlation.json + individual analyzer outputs. Produces human-readable "because" statements: "Your efficiency dropped 15% this week because the loop detector found 3 stuck sessions on auth middleware (blind spot: score 28/100)." Output: `narratives.jsonl` ring buffer (max 50 entries). Each entry: `{ id, ts, claim, severity, sources: [analyzerId], confidence, sourceEventIds }` | `src/services/intelligence/narrative-synthesizer.ts` | [x] |
| **11E.3** | Narrative templates — Define 10-15 causal narrative templates that map correlation pairs to human-readable explanations. Each template: trigger condition (which correlations/thresholds), claim format string, severity rules, source attribution. Examples: loop+blindspot → "stuck in weak area", cost+abandoned → "spending on dead ends", velocity_drop+new_domain → "learning curve expected" | `src/services/intelligence/narrative-templates.ts` | [x] |
| **11E.4** | Lineage API endpoint — `GET /api/intelligence/lineage/:insightId` returns `{ insight, sourceEvents: Event[], analyzerChain: string[] }`. Uses `event_insight_map` table (populated by 12A.10). Enables UI drill-through on any insight claim | `src/server/routes/intelligence.ts` | [x] |
| **11E.5** | "Why?" UI affordance — Every insight card in the dashboard gets an expandable "Based on N events" section. Clicking fetches lineage endpoint and shows: source event summaries, timeline, and which analyzer produced the claim. Implemented as a shared component used across efficiency, comprehension, coach, and home pages | `src/server/pages/components/lineage-drillthrough.ts` | [x] |
| **11E.6** | Phase-normalized HDS baselines — Compute per-execution-phase HDS baseline from historical data: planning (expected 0.7-1.0), implementation (0.3-0.7), debugging (0.1-0.5), review (0.5-0.8). Deviations FROM phase baselines replace raw HDS in comprehension radar. Prevents false "brain atrophy" alerts during debugging sprints | `src/services/intelligence/phase-baselines.ts` | [x] |
| **11E.7** | Comprehension radar upgrade — Replace raw HDS scoring with phase-normalized scoring from 11E.6. A debugging session with HDS 0.3 is NORMAL (not a blind spot). A planning session with HDS 0.3 IS concerning. Update blind-spot detection to use normalized deviations | `src/services/intelligence/analyzers/comprehension-radar.ts`, `src/services/intelligence/analyzers/blind-spots.ts` | [x] |
| **11E.8** | Narrative insight feed in home page — Replace or augment the existing "recent insights" feed with narrative insights from 11E.2. Show causal claims with severity badges, not raw metric changes. Each card shows the "because" explanation + "Why?" drill-through | `src/server/pages/home.ts` | [x] |
| **11E.9** | Coach narrative integration — Coach tool (`unfade_coach` MCP + dashboard page) reads narrative insights to provide contextualized recommendations. Instead of generic "try shorter prompts," Coach says "Your auth middleware sessions average 12 turns (vs 4 for other modules) — the comprehension radar shows this is a blind spot. Consider breaking it into smaller sub-problems." | `src/tools/unfade-coach.ts`, `src/server/pages/coach.ts` | [x] |
| **11E.10** | Correlation confidence decay — Correlations older than 14 days get confidence × 0.7 per week. Remove correlations below 0.3 confidence. Prevents stale correlations from producing outdated narrative claims | `src/services/intelligence/cross-analyzer.ts` | [x] |
| **11E.11** | Integration test: cross-analyzer correlation detects efficiency↔loop link | `test/services/intelligence/cross-analyzer.test.ts` | [x] |
| **11E.12** | Integration test: narrative synthesizer produces causal claim from correlation | `test/services/intelligence/narrative-synthesizer.test.ts` | [x] |
| **11E.13** | Integration test: lineage endpoint returns source events for insight | `test/server/routes/intelligence-lineage.test.ts` | [x] |
| **11E.14** | Integration test: phase-normalized baselines change blind-spot detection | `test/services/intelligence/phase-baselines.test.ts` | [x] |

> **Agent Directive for Sprint 11E:** "You are building the cross-analyzer intelligence layer — the final piece that transforms isolated metrics into coherent narratives. This sprint CANNOT be executed until Phase 12A-12C are complete and 2+ weeks of intelligence data exists.
>
> Core insight: Individual analyzers produce isolated findings (efficiency=72, loop on auth, blind spot in payments). Cross-analyzer correlation CONNECTS these: 'efficiency dropped BECAUSE you're stuck in a blind spot.' This is the difference between a dashboard and an intelligence system.
>
> Narrative synthesis is TEMPLATE-BASED, not LLM. You have ~15 templates that map correlation pairs to causal claims. Each template: IF correlation(A, B) > threshold AND direction matches THEN produce claim from format string. This keeps latency <5ms per narrative and avoids LLM costs for real-time intelligence.
>
> Lineage is already populated (12A.10 writes to event_insight_map). You're building the API endpoint that READS it and the UI component that DISPLAYS it. The hard work (writing lineage) is already done.
>
> Phase baselines: Query the sessions table (12C.13) grouped by execution_phase. Compute 30-day rolling average HDS per phase. These become the baselines against which comprehension and blind-spots are measured. A low HDS during debugging is EXPECTED — only flag deviations from phase norms."

**Strict contracts:**
- Correlation requires Pearson r > 0.6 AND temporal ordering (cause precedes effect). No spurious causal claims.
- Narratives are template-based. No LLM in the real-time path. Templates are explicit, editable, testable.
- Narratives max 50 in ring buffer. Oldest evicted first. Each tagged with confidence and source event IDs.
- Phase baselines computed from 30-day rolling window. Minimum 50 events per phase before baseline is trusted.
- Confidence decay: 0.7× per week after 14 days. Prevents zombie correlations.
- Non-fatal: If correlation or narrative fails, individual analyzer outputs continue unchanged.
- "Why?" UI never makes a network call without user interaction (click). No preloading lineage data.

---

### Tests (11C–11E)

| Sprint | ID | Test Description | File |
|---|---|---|---|
| **11E** | **T-335** | Cross-analyzer correlation detects efficiency↔loop pair (r > 0.6) | `test/services/intelligence/cross-analyzer.test.ts` |
| **11E** | **T-336** | Correlation requires temporal ordering (cause before effect) | `test/services/intelligence/cross-analyzer.test.ts` |
| **11E** | **T-337** | Narrative synthesizer produces claim from efficiency↔loop correlation | `test/services/intelligence/narrative-synthesizer.test.ts` |
| **11E** | **T-338** | Narrative ring buffer evicts oldest at 50 entries | `test/services/intelligence/narrative-synthesizer.test.ts` |
| **11E** | **T-339** | Lineage endpoint returns source events via event_insight_map | `test/server/routes/intelligence-lineage.test.ts` |
| **11E** | **T-340** | Phase baselines: debugging HDS 0.3 is NOT flagged as blind spot | `test/services/intelligence/phase-baselines.test.ts` |
| **11E** | **T-341** | Phase baselines: planning HDS 0.3 IS flagged as concerning | `test/services/intelligence/phase-baselines.test.ts` |
| **11E** | **T-342** | Confidence decay removes correlations below 0.3 after 4 weeks | `test/services/intelligence/cross-analyzer.test.ts` |
| **11E** | **T-343** | Coach narrative uses cross-analyzer context in recommendation | `test/tools/unfade-coach.test.ts` |
| **11E** | **T-344** | Narrative synthesis non-fatal — failure doesn't break analyzer pipeline | `test/services/intelligence/narrative-synthesizer.test.ts` |

---

### Tests (11C existing + 11D new)

| Sprint | ID | Test Description | File |
|---|---|---|---|
| 11C | **T-301** | Fresh start produces correct event count | `test/integration/state-determinism.test.ts` |
| 11C | **T-302** | Cursor survives crash — all events eventually materialized | `test/integration/state-determinism.test.ts` |
| 11C | **T-303** | File rewrite detected via epoch | `test/integration/state-determinism.test.ts` |
| 11C | **T-304** | Ingest lock prevents premature processing | `test/integration/state-determinism.test.ts` |
| 11C | **T-305** | Staleness detection reprocesses when file grew >2x | `test/integration/state-determinism.test.ts` |
| 11C | **T-306** | Per-file rebuild only resets invalid file | `test/integration/state-determinism.test.ts` |
| 11C | **T-307** | Full prompt preserved in event metadata | `daemon/internal/capture/ai_session_test.go` |
| 11C | **T-308** | Full prompt truncated at 10KB | `daemon/internal/capture/ai_session_test.go` |
| 11C | **T-309** | Files modified tracked from Edit/Write tools | `daemon/internal/capture/ai_session_test.go` |
| 11C | **T-310** | Sequence IDs monotonic within session | `daemon/internal/capture/ai_session_test.go` |
| 11C | **T-311** | Repo association from project path | `daemon/internal/capture/ai_session_test.go` |
| 11C | **T-312** | Groups events by branch into same feature | `test/integration/feature-boundary.test.ts` |
| 11C | **T-313** | Merges by file overlap (Jaccard > 0.4) | `test/integration/feature-boundary.test.ts` |
| 11C | **T-314** | Names feature from branch prefix | `test/integration/feature-boundary.test.ts` |
| 11C | **T-315** | Marks stale features after 7 days | `test/integration/feature-boundary.test.ts` |
| 11C | **T-316** | Creates continues_from links for same-session events | `test/integration/feature-boundary.test.ts` |
| 11C | **T-317** | Creates triggered_commit links within 5 minutes | `test/integration/feature-boundary.test.ts` |
| 11C | **T-318** | Creates related_events links for shared files within 1 hour | `test/integration/feature-boundary.test.ts` |
| 11C | **T-319** | Does not link events more than 1 hour apart | `test/integration/feature-boundary.test.ts` |
| 11D | **T-320** | Event written with no size truncation (>4KB prompts preserved) | `daemon/internal/capture/writer_test.go` |
| 11D | **T-321** | `truncateIfNeeded` removed — large events written intact | `daemon/internal/capture/writer_test.go` |
| 11D | **T-322** | `prompts_all` captures all user turns (max 20, 5KB each) inline | `daemon/internal/capture/ai_session_test.go` |
| 11D | **T-323** | `execution_phase` correctly classifies "fix the bug" as "debugging" | `daemon/internal/capture/ai_session_test.go` |
| 11D | **T-324** | `execution_phase` classifies Read-only session as "exploring" | `daemon/internal/capture/ai_session_test.go` |
| 11D | **T-325** | `intent_summary` extracts first sentence, max 200 chars | `daemon/internal/capture/ai_session_test.go` |
| 11D | **T-326** | `session_start` set to first turn timestamp | `daemon/internal/capture/ai_session_test.go` |
| 11D | **T-327** | Sequence IDs persist across daemon restart | `daemon/internal/capture/ai_session_test.go` |
| 11D | **T-328** | Materializer processes large events (>10KB) without corruption | `test/integration/state-determinism.test.ts` |
| 11D | **T-329** | Outcome classifier: files_modified → success | `test/integration/outcome-classifier.test.ts` |
| 11D | **T-330** | Outcome classifier: abandon keywords → abandoned | `test/integration/outcome-classifier.test.ts` |
| 11D | **T-331** | Outcome classifier: high iteration no output → failed | `test/integration/outcome-classifier.test.ts` |
| 11D | **T-332** | Feature tag binding via CLI sets event_features with user source | `test/commands/tag.test.ts` |
| 11D | **T-333** | Distill signal extractor uses execution_phase for time allocation | `test/services/distill/signal-extractor.test.ts` |
| 11D | **T-334** | Prompt-patterns analyzer reads full prompt_full from DB (not truncated summary) | `test/services/intelligence/prompt-patterns.test.ts` |

---

## 7. Success Metrics

| Metric | Before Phase 11 | Target | Measurement |
|---|---|---|---|
| **Stale cursor incidents** | ~1 per restart | 0 | Automated test suite (T-301 through T-306) |
| **Time to full data on fresh start** | Manual intervention required | < 60s automatic | Timer: first event appears within 60s of `unfade` start |
| **Events with repo context** | ~50% (project field) | 100% | `SELECT COUNT(*) WHERE json_extract(metadata, '$.repo_root') = ''` = 0 |
| **Prompt preservation** | 200 chars (truncated by 4KB limit) | Full prompts inline in event, materialized into DB | `json_extract(metadata, '$.prompts_all') IS NOT NULL` on all AI events in SQLite |
| **Feature grouping** | Not implemented | Events grouped accurately for branch-named work | Manual validation: branch events → same feature |
| **Cross-event links** | Not implemented | continues_from, triggered_commit detected automatically | `SELECT COUNT(*) FROM event_links` > 0 after normal usage |
| **Execution phase coverage** | Not captured | Classified on 100% of AI events | `json_extract(metadata, '$.execution_phase') IS NOT NULL` on all AI events |
| **Outcome classification** | Not captured | Derived on 100% of completed conversations | TypeScript intelligence layer runs after each tick |
| **MCP context quality** | Basic summary (200 chars) | Feature-aware narrative with full prompts | `unfade-context` returns session-grouped, feature-tagged activity |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Large JSONL lines** (AI events 5-50KB typical, 110KB worst case) | Medium | Low | Field-level quality caps: 10KB prompt_full, 5KB×20 prompts_all, 50 tool calls. Materializer handles any size. Prune after 30 days |
| **Execution phase misclassification** | Medium | Low | Keyword rules are conservative (high-confidence triggers only). Default is "implementing" which is safe. Intelligence layer can reclassify later |
| **Feature boundary mis-clustering** | Medium | Medium | `feature_tag` provides explicit override. Active features limited to 50. Stale features auto-archived at 7 days |
| **Outcome heuristic inaccuracy** | Medium | Low | Outcome is advisory, not authoritative. Rules favor "success" as default. Users never see "failed" unless strong signal |
| **Sequence ID counter file corruption** | Low | Low | Counter only provides ordering convenience. If lost, new counters start fresh (still unique, just not globally monotonic) |
| **Go/TS schema drift** (new metadata fields) | Medium | Medium | Shared test fixtures validate both sides produce/consume compatible events. CI runs both `pnpm test` and `make test` |
| **Performance with large metadata** | Low | Medium | 20 prompts × 5KB = 100KB max per event. SQLite JSON queries on metadata may slow down. Mitigated by FTS index on content fields |
| **Conversation_complete false positive** | Medium | Low | Materializer processes events regardless of this flag. Flag only affects distill quality (partial vs complete conversation). Safe to be wrong |

---

## 9. System Integration Audit & User Feedback Cross-Reference (RRVV — 2026-04-21)

### 9.1 Executive Summary

Post-Sprint 11D completion, a full RRVV audit was conducted: (1) verify the IntelligenceEngine orphan claim, (2) cross-reference real developer pain points from Reddit/community feedback against actual codebase capabilities, (3) identify what's truly missing vs disconnected vs working. The audit reveals a system that captures rich data but fails to deliver its most valuable insights due to a single structural integration gap — plus 5 entirely unbuilt features that directly address the highest-signal user needs.

### 9.2 Validated Findings — IntelligenceEngine Orphan

#### CONFIRMED: IntelligenceEngine is orphaned (severity: CRITICAL)

**Evidence chain:**
1. `IntelligenceEngine` class exists at `src/services/intelligence/engine.ts` (75 lines, complete implementation with register/run/checkMinData/throttle)
2. Zero imports of this class outside its own file — verified via grep across entire codebase
3. No `new IntelligenceEngine()` call exists anywhere in any execution path
4. The materializer tick in `src/services/daemon/repo-manager.ts:210-292` calls individual functions directly but **does not import or invoke the engine**

**What the materializer tick DOES call:**
- `computeComprehensionBatch()` + `upsertComprehensionScores()` — basic engagement proxy
- `aggregateComprehensionByModule()` — module-level rollup
- `computeDirectionByFile()` — per-file direction density
- `assignEventsToFeatures()` + `linkRelatedEvents()` — feature boundary detection
- `writeSummary()` — `summary.json` with direction/comprehension/cost fields
- `writePartialSnapshot()` — 4-hour periodic snapshots
- `appendRecentInsight()` — simple text log

**What it DOES NOT call (Phase 7 analyzers — all written, all orphaned):**
- `efficiencyAnalyzer` (AES composite score)
- `costAttributionAnalyzer` (per-decision cost breakdown)
- `promptPatternsAnalyzer` (effective/anti patterns + Coach output)
- `loopDetectorAnalyzer` (rejection index)
- `comprehensionRadarAnalyzer` (deep per-module scoring)
- `velocityTrackerAnalyzer` (turns-to-acceptance over time)
- `blindSpotsAnalyzer` (low-engagement alerts)
- `decisionReplayAnalyzer` (revisitable decisions)

**Impact:** 8 API routes return 204 permanently. 8 dashboard pages show empty state. Coach "Copy as CLAUDE.md rule" button has nothing to copy. MCP intelligence tools return no data.

### 9.3 User Feedback Cross-Reference: What Developers Actually Need

Source: Reddit developer communities, HN discussions, competitive analysis (`unfade_support.md`), theme scoring from product strategy.

#### 9.3.1 Feature-by-Feature: Reddit Pain Points vs Our Implementation

| # | What developers do manually (Reddit) | Our feature | Codebase status | Gap severity |
|---|---|---|---|---|
| 1 | **Maintain `.cursorrules`/`CLAUDE.md` manually** — encoding preferences, architecture, conventions | Prompt Coach → "Copy as CLAUDE.md rule" button (`src/server/pages/coach.ts`) | Analyzer written (`src/services/intelligence/analyzers/prompt-patterns.ts`). UI renders. **Engine not wired** → no patterns generated → button copies nothing | **CRITICAL** |
| 2 | **Re-explain context every session** ("50 First Dates" amnesia) | MCP context injection — 13 tools registered (`src/services/mcp/tools.ts:68-718`) | **WORKING.** Tools respond with live data from materialized DB. Requires AI tool to actively query unfade | **LOW** (works, but passive — see §9.3.2 #2) |
| 3 | **"Tell Claude to update its memory"** — manual preference persistence | Loop Detector + MCP `unfade_coach` tool | Analyzer written (`src/services/intelligence/analyzers/loop-detector.ts`), MCP tool registered. **Engine not wired** → rejection index never built | **HIGH** |
| 4 | **Track which prompts work** (trial-and-error, manual notes/spreadsheets) | Prompt Coach — pattern clustering + outcome correlation | Full analyzer implementation. **Engine not wired** → zero patterns produced. Users literally building spreadsheets we could automate | **CRITICAL** |
| 5 | **"Main coder + validator" pattern** (human reviews AI output) | Comprehension Radar + Direction Density | Basic proxy runs on tick (`comprehension_proxy` table). Full Radar analyzer not wired. Deep per-module engagement scoring absent | **MEDIUM** |
| 6 | **Manually estimate AI costs** (checking bills) | Cost Attribution Engine + token spend proxy | Proxy runs (`summary.json` has `todaySpendProxy`, `costPerDirectedDecision`). Full per-decision attribution **not wired** | **MEDIUM** |
| 7 | **"How much time am I saving?"** (gut feeling, no data) | Reasoning Velocity (`src/services/intelligence/analyzers/velocity-tracker.ts`) | Analyzer fully implemented (tracks turns-to-acceptance over time). **Engine not wired** → users get zero quantified improvement data | **CRITICAL** |
| 8 | **Multi-tool usage** (Claude for reasoning, Cursor for daily) | Cross-tool capture — 4 parsers (Claude Code, Cursor, Codex, Aider) in `daemon/internal/capture/parsers/` | **WORKING.** All parsers implemented with incremental tailing. Events flow through full pipeline | **NONE** |
| 9 | **Direction signals** (understanding human vs AI contribution) | HDS Classifier in Go daemon (`daemon/internal/capture/classifier/`) | **WORKING.** Runs on every captured conversation. Direction signals in event metadata, surfaced in summary.json | **NONE** |
| 10 | **"What did I work on yesterday?"** for standup | Daily Distill + `unfade status` + Home page | **WORKING.** Full distill pipeline functional. Status CLI shows daily metrics. Home page renders summary | **LOW** (could add "since last visit" ribbon) |

#### 9.3.2 Features MISSING Entirely (Not Built, High User Signal)

Cross-referencing Reddit frequency, theme scores from `unfade_support.md` §1, and product gaps from §3:

| # | Missing feature | User signal strength | Why users need it | Implementation exists? | Effort to build |
|---|---|---|---|---|---|
| 1 | **Auto-sync to `.cursorrules`/`CLAUDE.md`** — write observed preferences directly into user's rules file | **VERY HIGH** (Theme #1: cross-tool context, score 19/20. #1 Reddit workaround) | Closes the loop: observe → generate rules → AI reads rules → behavior improves. Currently observe but never write back. "Copy" button requires manual paste. | `src/server/pages/coach.ts` has the UI chrome. Zero file-write code exists. Grep for `cursorrules` returns 0 results in `src/`. No `.mdc` file generation. | **Low** — file append + path detection + UI button. BUT requires P0 (engine wiring) first to generate patterns |
| 2 | **Session continuity hook** — auto-inject yesterday's context at AI tool startup without user asking | **HIGH** (Theme #1 score 19/20. "50 First Dates" is the universal complaint) | MCP `unfade_context` exists but is PULL-only — AI must actively query it. No PUSH mechanism. No startup hook. No CLAUDE.md auto-update. Grep for `startup.*hook`, `auto.*inject` returns 0 results. | No hook mechanism exists. No file watcher that updates CLAUDE.md with latest context. The MCP tool works if invoked, but nothing triggers it automatically. | **Medium** — needs: (a) file-watcher that appends "## Last session context" to CLAUDE.md on session end, OR (b) MCP resource that AI tools auto-read on connect |
| 3 | **Weekly reasoning digest** — automated "this week vs last week" comparison | **MEDIUM-HIGH** (developers doing manual weekly reviews abandon after 3-4 weeks) | `summary.json` already has 7d/30d comparisons. `src/services/intelligence/nudges.ts` has rule-based triggers (reflex mode, CWI celebration). But no weekly cadence, no template, no shareable card. Grep for "weekly" finds references in analyzers but no scheduler/template. | Partial infrastructure: `nudges.ts` (line 1-50) selects nudges, `insights.ts` generates text. No weekly aggregation template. No scheduled generation. No card output. | **Low** — template from existing summary data + cron/materializer-based trigger |
| 4 | **"Am I getting better?" longitudinal view** — visible skill progression narrative | **HIGH** (existential "am I just a prompter?" anxiety. Theme #7 score 15/20) | `velocity-tracker.ts` computes turns-to-acceptance over time. `decision-replay.ts` tracks revisitable decisions. But engine not wired → no data produced. Even if wired, no page shows Month 1 → Month 3 as a *story*. | Analyzers written, never invoked. No narrative template exists. `src/server/pages/velocity-page.ts` exists but presumably renders from intelligence data that's never generated. | **Medium** — needs P0 (engine wiring) + narrative template + longitudinal page |
| 5 | **Ambient comprehension alerts** — "you just shipped 3 changes to payments/ without deep engagement" | **MEDIUM** (the "brain turning to mush" fear) | `src/services/intelligence/analyzers/blind-spots.ts` (lines 1-40) — complete implementation with MAX_ALERTS_PER_WEEK=2, MIN_SUSTAINED_WEEKS=2. Detects: high acceptance rate, low comprehension, declining direction. All logic present. **Engine not wired** → never runs. | Fully implemented analyzer. `src/services/intelligence/nudges.ts` also selects post-distill nudges. Delivery mechanism unclear — appears in status/distill but no push notification. | **Low** — needs P0 only. Alert generation logic is complete. Display channel: `unfade status` + distill output |
| 6 | **Debugging session reconstruction** — stitch debugging arcs into coherent narratives | **HIGH** (Gap #3 from `unfade_support.md` §3. "Where most valuable reasoning happens and most context is lost") | `src/services/distill/signal-extractor.ts` has basic debugging detection (via `execution_phase = "debugging"`). `src/services/mcp/prompts.ts` has some reconstruction context. But no dedicated debugger that stitches: hypothesis → test → error change → refined hypothesis. | Partial: execution_phase captures "debugging" events. No dedicated stitching/narrative reconstruction for debugging arcs. Signal extractor treats debugging generically (counts it, doesn't reconstruct it). | **Medium** — need: debugging arc detector (group debugging events by error pattern), hypothesis-test-result narrative template |
| 7 | **Decision durability tracking** — which decisions held vs reverted | **MEDIUM** (Gap #4 from `unfade_support.md` §3. Reasoning confidence/self-calibration) | `src/services/cache/manager.ts` has `durability` reference. `decision-replay.ts` analyzer (not wired) tracks decisions. But no revert detection comparing git history to past decisions. | Minimal. `decision-replay.ts` identifies revisitable decisions but doesn't track whether they were actually reverted. No git-blame correlation to detect "decision X was overwritten 2 weeks later." | **Medium-High** — need: git history correlation + decision-outcome tracking over time |
| 8 | **Onboarding narrative** — "unfade history --project=auth --last-6months" for new team members | **HIGH** (Gap #1 from `unfade_support.md` §3. Score 9/10 relevance, 8/10 pain) | `src/commands/query.ts` exists for searching events. `src/commands/ingest.ts` for backfilling. But no `history` command that produces structured narrative of architectural decisions over time. | Partial query infrastructure. No dedicated `unfade history` command. No narrative template that stitches decisions into an onboarding document. Data exists (events, distills, decisions graph) but no consumer produces the narrative. | **Medium** — query existing data + narrative template + new CLI command |
| 9 | **Value receipt / savings quantification** — "Unfade saved you ~$180 and 4.2 hours this month" | **HIGH** (Gap #2 from `unfade_support.md` §3. The strongest adoption argument for managers) | `src/services/intelligence/analyzers/efficiency.ts` references "value" calculation. `summary.json` has `todaySpendProxy`. But no "counterfactual" computation: tokens/time that WOULD have been spent re-explaining context. | Minimal. Cost proxy estimates what was spent, not what was saved. No baseline comparison ("without Unfade, you'd have spent X re-explaining"). The efficiency analyzer (not wired) may compute some of this. | **Medium** — need: baseline model (avg tokens per context re-explanation) + integration with MCP usage stats |

#### 9.3.3 Confirmed Working — No Action Needed

| Feature | File | Evidence of working |
|---|---|---|
| Cross-tool capture (4 parsers) | `daemon/internal/capture/parsers/{claude_code,cursor,aider,codex}.go` | Full parser implementations with Discover/Parse/Tail interface |
| Direction classification (HDS) | `daemon/internal/capture/classifier/` (domain.go, heuristic.go, patterns.go, specificity.go) | Classifier runs on every conversation, produces direction_signals |
| MCP context injection (13 tools) | `src/services/mcp/tools.ts:68-718` | All tools registered, return live data from DB |
| Daily Distill pipeline | `src/services/distill/{signal-extractor,context-linker,synthesizer}.ts` | Full pipeline: events → signals → links → synthesis → markdown |
| First-run revelation | `src/services/intelligence/first-run-analyzer.ts` (lines 1-60) | Produces `FirstRunReport` with: totalInteractions, directionDensity, domains, toolBreakdown, highestAcceptVerbatim |
| Unfade Card v3 | `src/commands/card.ts` (lines 1-50) | Pulls from summary.json — direction, comprehension, velocity, cost, domains. Generates visual card |
| Outcome classification | `src/services/intelligence/outcome-classifier.ts` | Post-materialization derivation: success/partial/failed/abandoned |
| Execution phase | Go daemon `classifyExecutionPhase()` | 7 phases classified from prompt keywords + tool patterns |
| Feature boundary detection | `src/services/intelligence/feature-boundary.ts` | 3-strategy streaming assignment (branch → Jaccard → temporal) |
| Summary writer | `src/services/intelligence/summary-writer.ts` | Produces `.unfade/summary.json` with 24h/7d/30d metrics |
| Post-distill nudges | `src/services/intelligence/nudges.ts` (lines 1-50) | Rule-based: reflex mode, new shallow domain, CWI celebration, dead-end-without-recovery |

### 9.4 Root Cause Analysis

#### Why did the IntelligenceEngine remain unwired?

The materializer tick was built incrementally across Phases 4-6, adding individual function calls directly into `onTick`. When Phase 7 introduced `IntelligenceEngine` as the orchestrator, the existing direct calls were already working. The engine was built as the "proper" way to run analyzers, but the integration step was never executed.

**Failure mode:**
1. Individual modules built and tested in isolation ✓
2. Integration test coverage validates individual features, not end-to-end pipeline
3. No smoke test asserts "intelligence/*.json files exist after N ticks"
4. Graceful 204 degradation masks the failure — every downstream consumer handles null without error

**Structural pattern:** Graceful degradation hid a critical integration failure. The system silently produces zero value from its most sophisticated modules.

#### Why are 5 high-signal user features entirely unbuilt?

The development followed a bottom-up pattern: capture → store → analyze → display. The missing features are all **action** features (write-back, push, schedule, narrate) — they require the system to DO something proactively rather than respond to queries. The architecture excels at passive observation and on-demand retrieval but has no proactive action layer.

**Pattern:** Every missing feature requires the system to PUSH rather than be PULLED:
- Auto-sync → PUSH to `.cursorrules`
- Session hook → PUSH context at startup
- Weekly digest → PUSH card on schedule
- Alerts → PUSH notification on threshold breach
- Value receipt → PUSH savings proof to user

The system has no scheduled action framework, no file-watcher-based write-back, and no push notification channel.

### 9.5 Prioritized Action Plan (Revised with User Feedback)

| Priority | Action | User pain it solves | Leverage | Effort | Success criteria |
|---|---|---|---|---|---|
| **P0** | Wire `IntelligenceEngine.run()` into `repo-manager.ts` onTick | Unlocks 6 of the top 10 user pain points simultaneously | Lights up 8 analyzers, 8 routes, 8 pages, Coach, MCP intelligence tools | ~30 LOC | `GET /api/intelligence/efficiency` returns JSON after 10+ events materialized |
| **P1** | Auto-write to `.cursorrules`/`CLAUDE.md` from Coach | #1 manual workaround (Reddit). Theme score 19/20. THE demo moment | Closes the observe→generate→apply loop. "Unfade auto-generated my rules file" = instant viral screenshot | File append + path detection + "Apply" button | Clicking "Apply to project" appends rule to `.cursor/rules/unfade.mdc` or `CLAUDE.md` |
| **P2** | Session continuity PUSH — auto-update CLAUDE.md with last session context | #1 theme score (19/20). Universal "50 First Dates" complaint | Eliminates re-explanation entirely. Zero user effort. AI tools read updated CLAUDE.md on startup | File watcher + context formatter + CLAUDE.md append | After session ends, CLAUDE.md contains "## Recent Context" section auto-updated |
| **P3** | Weekly digest card — shareable "this week vs last week" | Recurring viral trigger (52x/year). Retention mechanic | Creates ritual + share moment. Data already in summary.json | Template + scheduler + card render | `.unfade/cards/weekly-YYYY-WW.png` auto-generated. Shows in `unfade status` |
| **P4** | Value receipt in distill — "Unfade saved X hours, $Y this month" | Strongest adoption argument for managers. Gap #2 (score 8/10) | Converts abstract benefit to concrete number. Budget justification for teams | Baseline model + MCP usage correlation | Daily distill includes "Estimated context re-injection savings: ~15 min, ~$8 today" |
| **P5** | Debugging arc reconstruction — stitch debugging sessions into narratives | Gap #3 (score 8/10, 8/10). "Where most context is lost" | Highest-value distillation. "I solved this before" becomes retrievable | Arc detector + narrative template | `unfade query --type=debugging --project=auth` returns structured debugging arcs |
| **P6** | Onboarding narrative — `unfade history --project=X` | Gap #1 (score 9/10, 8/10). Converts personal→organizational tool | Zero new data needed — just query + narrative presentation | CLI command + narrative template | Command produces structured timeline of decisions/trade-offs for a domain |
| **P7** | Decision durability tracking — which decisions held vs reverted | Gap #4 (score 7/10). Reasoning confidence calibration | Answers "decisions explored deeply have 94% retention; quick ones 61%" | Git correlation + decision outcome tracking | Decision replay page shows retention rates by deliberation depth |
| **P8** | Smoke test: intelligence files generated after materializer runs | Guards against P0 regression | CI catches wiring gaps before they ship | 1 integration test | CI fails if `intelligence/*.json` absent after N ticks with sufficient events |

### 9.6 Critical Omissions & Risks

1. **No proactive action framework:** The system has no scheduler, no file-watcher write-back, no push channel. P1-P4 all require one. Building a minimal `ActionRunner` (scheduled tasks + file-write primitives) would unblock 4 priorities at once.
2. **Performance risk of 8 analyzers on tick:** IntelligenceEngine has 10s throttle but some analyzers query ORDER BY LIMIT 500. At 50K+ events, need index validation: `CREATE INDEX idx_events_ts ON events(ts)`.
3. **Cold-start UX:** Each analyzer has `minDataPoints` (10-50). First-time users see empty intelligence until sufficient capture. Need clear "warming up" state vs "broken" state in UI.
4. **No end-to-end integration test:** Event JSONL → Go daemon → materializer → IntelligenceEngine → *.json → API → dashboard. This chain has never been tested as a unit.
5. **Token proxy is estimation only:** Cost-attribution relies on turn-count heuristics. Without vendor API key integration, cost data is approximate. Acceptable but should be labeled "estimated" in UI.
6. **PUSH features need permission model:** Auto-writing to `.cursorrules`/`CLAUDE.md` modifies user's project files. Needs explicit opt-in during `unfade init` and ability to disable per-project.

### 9.7 User Impact Matrix — Complete View

| User pain point | Signal strength | Existing solution | Blocker | Priority to fix |
|---|---|---|---|---|
| "Maintain .cursorrules manually" | **VERY HIGH** (19/20) | Coach "Copy as CLAUDE.md rule" | Engine not wired + no file-write | P0 + P1 |
| "Re-explain context every session" | **VERY HIGH** (19/20) | MCP `unfade_context` (PULL) | Works today but requires active query. No PUSH | P2 |
| "Which prompts work best?" | **HIGH** | Prompt Coach analyzer | Engine not wired | P0 |
| "How much time am I saving?" | **HIGH** | Velocity analyzer | Engine not wired + no quantified savings | P0 + P4 |
| "Am I just a prompter now?" | **HIGH** | Comprehension Radar + Blind Spots | Engine not wired | P0 |
| "Debugging context lost" | **HIGH** (8/10) | Basic `execution_phase = "debugging"` capture | No arc reconstruction | P5 |
| "Onboarding takes 4-6 weeks" | **HIGH** (9/10) | Events + distills exist | No narrative command | P6 |
| "AI keeps suggesting bad patterns" | **MEDIUM-HIGH** | Loop Detector | Engine not wired | P0 |
| "How much is AI costing?" | **MEDIUM** | Cost proxy in summary.json | Engine not wired for granular attribution | P0 |
| "Brain turning to mush" | **MEDIUM** | Blind Spot analyzer (complete logic) | Engine not wired | P0 |
| "What did I work on yesterday?" | **LOW** | Daily Distill + status | **Works today** | — |
| "Multi-tool context" | **NONE** | Cross-tool capture (4 parsers) | **Works today** | — |

### 9.8 The Proactive Action Layer — Architectural Gap

The audit reveals a systemic pattern: Unfade excels at **passive observation** and **on-demand retrieval** but has zero **proactive action** capability. Every missing high-signal feature requires the system to act without being asked:

```
Current architecture:    User asks → System responds (PULL)
Missing architecture:    System observes → System acts (PUSH)

                         ┌──────────────────────────────────┐
                         │     PROACTIVE ACTION LAYER        │
                         │        (does not exist)           │
                         │                                   │
                         │  Triggers:                        │
                         │  • Session end → update CLAUDE.md │
                         │  • Monday 8am → weekly digest     │
                         │  • Threshold breach → nudge       │
                         │  • Pattern learned → write rule   │
                         │                                   │
                         │  Actions:                         │
                         │  • File write (.cursorrules, md)  │
                         │  • Card generate (weekly PNG)     │
                         │  • Notification (status, banner)  │
                         │  • Rule append (apply to project) │
                         └──────────────────────────────────┘
```

Building a minimal `ActionRunner` with scheduled triggers + file-write primitives would unblock P1, P2, P3, and P4 simultaneously. This is arguably **P0.5** — it's infrastructure that 4 user-facing features depend on.

### 9.9 Decision: Execution Sequence

```
Phase 12A (Sprint 12A) — Wire & Light Up
├── P0: Wire IntelligenceEngine into materializer tick (~30 LOC)
├── P8: Smoke test (intelligence files generated)
└── Validate: all 8 dashboard pages populate, MCP tools return data

Phase 12B (Sprint 12B) — Proactive Action Layer
├── P0.5: ActionRunner framework (triggers + file-write + schedule)
├── P1: Auto-write to .cursorrules from Coach patterns
├── P2: Session-end CLAUDE.md context update
└── P3: Weekly digest card generation

Phase 12C (Sprint 12C) — Deep Intelligence
├── P4: Value receipt / savings quantification
├── P5: Debugging arc reconstruction
├── P6: Onboarding narrative command
└── P7: Decision durability tracking
```

**The P0 change alone resolves 6 of 12 user pain points** by unblocking data flow to already-built UI. P1+P2 together create the demo moment that drives adoption. P3 creates the retention/viral loop.

---

## 10. Post-Capture Intelligence Evolution — RRVV Audit (2026-04-21)

> **Scope:** Full post-capture lifecycle optimization. Maps every transformation from raw event to user-visible intelligence, identifies structural gaps between Phase 11's rich capture and actual utilization, and produces an execution-ready enhancement plan.

### 10.1 Research — The Post-Capture Lifecycle Map

#### 10.1.1 Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ EVENT CAPTURE (Go daemon → .unfade/events/*.jsonl)                               │
│ Phase 11 fields: prompts_all, execution_phase, intent_summary, outcome,          │
│ session boundaries, feature_signals, sequence_id, files_modified/referenced,     │
│ tool_calls_summary, token estimates, parent_event_id                             │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ JSONL read (cursor-based)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ MATERIALIZER TICK (repo-manager.ts, 2s interval)                                 │
│ Calls: computeComprehensionBatch → aggregateComprehensionByModule →              │
│        computeDirectionByFile → assignEventsToFeatures → linkRelatedEvents →     │
│        writeSummary → writePartialSnapshot → appendRecentInsight                 │
│                                                                                  │
│ ⚠️ DOES NOT CALL: IntelligenceEngine.run()                                       │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ SQLite rows
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ INTELLIGENCE ENGINE (orphaned — never invoked)                                   │
│ 8 Analyzers: efficiency, cost-attribution, comprehension-radar,                  │
│ prompt-patterns, loop-detector, velocity-tracker, blind-spots, decision-replay   │
│ Each writes to: .unfade/intelligence/<analyzer>.json                             │
│ Throttle: 10s minimum between runs                                               │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ JSON files (never written)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ API ROUTES (src/server/routes/intelligence.ts)                                   │
│ 9 endpoints: /efficiency, /costs, /comprehension, /prompt-patterns,              │
│ /coach, /velocity, /rejections, /alerts, /replays                                │
│ All return jsonOr204() — permanently 204 since files never exist                 │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ JSON (always null)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ UI PAGES (efficiency.ts, home.ts, etc.)                                          │
│ Permanently show "Not enough data" or empty state                                │
│ SSE events for live updates exist but never fire intelligence payloads            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 10.1.2 Phase 11 Metadata — Capture vs. Utilization Matrix

| Phase 11 Field | Captured | Materialized to DB | Used by Analyzers | Surfaced in UI | Gap Level |
|---|:---:|:---:|:---:|:---:|:---:|
| `prompts_all` (full prompts) | ✅ | ✅ (content column) | ❌ (use `content_summary` 200-char) | ❌ | **CRITICAL** |
| `execution_phase` | ✅ | ✅ | ❌ (only distill uses for time %) | ❌ | HIGH |
| `intent_summary` | ✅ | ✅ | ❌ | ❌ | HIGH |
| `outcome` (success/partial/failure/abandoned) | ✅ | ✅ | ❌ (hardcoded 5-rule classifier) | ❌ | HIGH |
| `feature_signals` | ✅ | ✅ (feature boundary) | ❌ (not cross-referenced) | ❌ | MEDIUM |
| `session_id` / boundaries | ✅ | ✅ | ❌ | ❌ | HIGH |
| `sequence_id` | ✅ | ✅ | ❌ | ❌ | MEDIUM |
| `files_modified` / `files_referenced` | ✅ | ✅ | ❌ (only feature boundary uses) | ❌ | MEDIUM |
| `tool_calls_summary` | ✅ | ✅ | ❌ | ❌ | MEDIUM |
| `token_estimate` | ✅ | ✅ (token_proxy_spend) | ❌ (summary uses for cost) | Partial (cost KPI) | LOW |
| `parent_event_id` | ✅ | ✅ (event_links) | ❌ | ❌ | MEDIUM |
| HDS (human_direction_score) | ✅ | ✅ | ✅ (comprehension, direction) | Partial (home KPI) | LOW |

**Key finding:** Phase 11 delivers 12 enriched metadata fields. Only 2 (HDS, token_estimate) reach any user-facing surface. The remaining 10 fields are captured, stored, but never processed beyond basic DB insertion.

#### 10.1.3 Transformation Inventory — What Each Module Actually Does

| Module | Input | Transformation | Output | Depth |
|---|---|---|---|---|
| `computeComprehensionBatch` | events.hds | Weighted average per event | comprehension_proxy table | Shallow aggregation |
| `aggregateComprehensionByModule` | comprehension_proxy | GROUP BY module, AVG(score) | comprehension_by_module | Shallow aggregation |
| `computeDirectionByFile` | events.hds + files | Per-file direction density | direction_by_file table | Shallow aggregation |
| `assignEventsToFeatures` | events + features | Branch → file Jaccard → temporal | event_features table | Heuristic matching |
| `linkRelatedEvents` | events + git context | parent_event_id, triggered_commit | event_links table | Structural linking |
| `writeSummary` | Multiple tables | 24h rolling stats, top domain | summary.json | Composite aggregation |
| `writePartialSnapshot` | token_proxy_spend | Periodic metric checkpoint | metric_snapshots table | Pass-through |
| `appendRecentInsight` | New events | Basic severity + type classification | recent-insights.jsonl | Simple classification |
| **Distill pipeline** | All events for day | Signal extraction → LLM synthesis | Markdown file + profile | **Deep** (with LLM) |
| **IntelligenceEngine** | DB queries | Statistical pattern detection | JSON files (never written) | **Deep** (orphaned) |

### 10.2 Reasoning — Structural Gaps and Enhancement Opportunities

#### 10.2.1 The Utilization Cliff

The system has a sharp drop-off between capture quality and utilization quality:

```
Capture Richness:  ████████████████████████████████ 100% (Phase 11 complete)
DB Materialization: ███████████████████████████████ 95%  (all fields stored)
Shallow Processing: █████████████████               55%  (aggregation only)
Deep Intelligence:  ██                              5%   (engine orphaned)
User-Visible Value: █                               3%   (summary.json + distill)
```

**Root cause:** The materializer tick performs only shallow aggregation (GROUP BY, AVG, COUNT). Deep pattern detection exists in the IntelligenceEngine but is disconnected. The distill pipeline runs daily (not real-time) and only synthesizes into narrative text, not structured actionable intelligence.

#### 10.2.2 Five Structural Gaps

**Gap 1: Engine Orphan (Critical)**
- IntelligenceEngine has 8 analyzers fully built, each with `minDataPoints` thresholds, trend detection, and structured JSON output
- The materializer tick never calls `engine.run()`
- Result: 8 dashboard pages, 9 API routes, and 5 MCP intelligence tools permanently return empty/204
- Fix complexity: ~30 LOC (add engine import + invocation after existing tick functions)

**Gap 2: Shallow Field Utilization**
- Analyzers were written BEFORE Phase 11 enrichment was available
- They query `content_summary` (200-char truncation) instead of full `prompts_all`
- `execution_phase` is ignored by all analyzers — no breakdown of planning vs implementation vs debugging time
- `intent_summary` could power the loop detector (detect repeated intents → stuck loop) but isn't used
- `outcome` field (success/partial/failure/abandoned) is available but analyzers use hardcoded heuristic classifiers

**Gap 3: No Cross-Analyzer Signal Integration**
- Each analyzer runs independently, produces isolated JSON
- No mechanism for: "efficiency is dropping BECAUSE the loop detector found you're stuck on auth middleware"
- The Coach tool (`unfade_coach`) could synthesize across analyzers but reads individual files
- Opportunity: Cross-analyzer correlation matrix → causal narratives

**Gap 4: Session-Level Intelligence Missing**
- Phase 11 captures `session_id` and session boundaries, enabling session-level analysis
- No analyzer groups events by session to produce: "This session accomplished X in Y turns with Z outcome"
- Session efficiency (turns-to-outcome) is the most intuitive metric for users but isn't computed
- The velocity-tracker computes turns-to-acceptance per domain but not per session

**Gap 5: Lineage Infrastructure Unpopulated**
- `event_insight_map` table exists with correct schema
- `writeInsightMappings()` and `getInsightsForEvent()` / `getEventsForInsight()` are implemented
- No caller ever invokes `writeInsightMappings()` — the lineage system is built but unused
- Without lineage: UI can't answer "why does my efficiency score show X?" with "because events A, B, C"

#### 10.2.3 Intelligence Depth Taxonomy — Current vs. Possible

| Analysis Type | Current | With Phase 11 Fields | Improvement Factor |
|---|---|---|---|
| **Efficiency** | AES composite from HDS + tokens | + execution_phase weighting + outcome-adjusted + session-bounded | 3× (from proxy to measured) |
| **Cost** | Token count × model rate | + per-feature attribution + waste detection (abandoned sessions) | 2× (from estimate to attribution) |
| **Comprehension** | HDS average by module | + intent_summary clustering + skill growth trajectory | 4× (from score to skill map) |
| **Prompt patterns** | Feature comparison (length, constraints) | + full prompt text analysis + outcome correlation | 5× (from structural to semantic) |
| **Loop detection** | Cosine similarity on content_summary | + intent_summary recurrence + outcome=failure chains | 3× (from textual to causal) |
| **Velocity** | Turns-to-acceptance by domain | + session-bounded + execution_phase transitions | 2× (from aggregate to session) |
| **Blind spots** | Module scores < threshold | + files_referenced coverage + tool_calls diversity | 2× (from score to coverage) |
| **Decision replay** | Drift detection on decisions.jsonl | + outcome tracking + feature correlation | 3× (from detection to explanation) |

### 10.3 Validation — Against Product Expectations

#### Expectation 1: "Every data point → insight"

**Current state: FAIL.** Of ~12 enriched metadata fields captured per event, only 2 reach any user-facing surface (HDS → comprehension KPI, tokens → cost KPI). The remaining 10 fields are stored but produce zero insights.

**With proposed enhancements:** Each field contributes to at least one analyzer. `execution_phase` → efficiency time allocation. `intent_summary` → loop detection + skill clustering. `outcome` → velocity adjustment + cost waste. `session_id` → session-level reports. `files_modified` → blind spot coverage. `tool_calls` → tool diversity index.

#### Expectation 2: "Narrative-driven, not metric-dump"

**Current state: PARTIAL.** The distill pipeline produces daily narrative markdown (decisions, trade-offs, dead ends). But real-time intelligence surfaces are all metric-only (AES score, cost number, comprehension percentage). No narrative layer wraps the real-time metrics.

**With proposed enhancements:** Cross-analyzer correlation produces causal narratives: "Your efficiency dropped 15% this week because you spent 3 sessions stuck on the auth middleware (loop detected). The comprehension radar shows this is a blind spot — consider pair programming or documentation review."

#### Expectation 3: "Context-aware"

**Current state: PARTIAL.** Feature boundary detection groups events by feature. MCP enrichment adds identity labels and domain context. But intelligence outputs are global — not scoped to the feature you're currently working on.

**With proposed enhancements:** Feature-scoped intelligence: "For the auth-refactor feature specifically: 12 sessions, 3 stuck loops, 78% comprehension, $14.20 cost. Your most effective sessions used constraint-based prompting."

#### Expectation 4: "Incremental (value from day 1)"

**Current state: FAIL for intelligence.** Summary.json (direction density, event count, cost) works from day 1. But all intelligence analyzers have `minDataPoints` thresholds (5-50) AND are orphaned. Users see zero intelligence indefinitely.

**With proposed enhancements:** Progressive disclosure with honest thresholds: "5 events: basic activity → 20 events: efficiency estimate → 50 events: pattern detection → 100 events: predictive coaching." Each stage lights up when data is sufficient, with clear progress indicators.

#### Expectation 5: "Transparent (user can trace any claim)"

**Current state: FAIL.** Lineage infrastructure exists (`event_insight_map`, bidirectional query functions) but is never populated. No insight can be traced back to its source events. The UI has no "why?" affordance.

**With proposed enhancements:** Every insight written by an analyzer also calls `writeInsightMappings()` with source event IDs. UI adds expandable "Based on N events" with drill-through to the raw events.

### 10.4 Execution — Enhancement Plan

#### 10.4.1 Redesigned Post-Capture Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ MATERIALIZER TICK (2s)                                                           │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Layer 1 — Structural Processing (existing, unchanged)                            │
│ • computeComprehensionBatch                                                      │
│ • aggregateComprehensionByModule                                                 │
│ • computeDirectionByFile                                                         │
│ • assignEventsToFeatures                                                         │
│ • linkRelatedEvents                                                              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Layer 2 — Session Materialization (NEW)                                          │
│ • materializeSessionMetrics: group by session_id, compute per-session:           │
│   turns, outcome distribution, execution_phase breakdown, feature scope          │
│ • detectSessionBoundaryTransitions: identify context switches, blocked→unblocked │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Layer 3 — Intelligence Engine (UNWIRED → WIRED)                                  │
│ • engine.run(newRows) — 10s throttle preserved                                   │
│ • Each analyzer upgraded to consume Phase 11 fields (see §10.4.2)                │
│ • Cross-analyzer correlation pass after individual runs                           │
│ • Lineage population on every insight write                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Layer 4 — Narrative Synthesis (NEW)                                              │
│ • correlateAnalyzerOutputs: find causal links between analyzer findings          │
│ • generateNarrativeInsight: produce human-readable "because" statements          │
│ • Runs every 60s (not every tick) — narrative needs sufficient signal             │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Layer 5 — Summary & Notification (existing, enhanced)                            │
│ • writeSummary (enhanced: include intelligence highlights)                        │
│ • writePartialSnapshot                                                           │
│ • appendRecentInsight (enhanced: include narrative insights)                      │
│ • emitSSE: push real-time intelligence updates to connected UI                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 10.4.2 Upgraded Intelligence Modules

**Efficiency Analyzer — Enhanced**
```
Current:  AES = DD×0.30 + TE×0.20 + IR×0.20 + CL×0.15 + MD×0.15
Enhanced: AES = DD×0.25 + TE×0.15 + IR×0.15 + CL×0.10 + MD×0.10 + SE×0.15 + OA×0.10

New sub-metrics:
  SE (Session Efficiency) = successful_outcomes / total_sessions (from outcome field)
  OA (Outcome-Adjusted) = weighted by execution_phase:
    planning turns get 1.5× weight (high HDS expected)
    debugging turns get 0.7× weight (low HDS acceptable)
    implementation turns get 1.0× weight (baseline)
```

**Cost-Attribution Analyzer — Enhanced**
```
Current:  Aggregate token_proxy per model/domain/branch
Enhanced: + per-feature cost tracking (via event_features join)
          + waste detection: sessions with outcome=abandoned → waste cost
          + cost-per-successful-outcome (meaningful unit economics)
          + session-level burn rate (tokens/min by execution_phase)
```

**Loop Detector — Enhanced**
```
Current:  Cosine similarity on content_summary (200 chars)
Enhanced: + intent_summary recurrence (same intent across sessions = stuck)
          + outcome chain analysis: intent repeated + outcome≠success = confirmed loop
          + causal attribution: which files/modules correlate with loops
          + escape detection: what changed when the loop broke
```

**Comprehension Radar — Enhanced**
```
Current:  Per-module HDS average, blind spots at score < 40
Enhanced: + intent_summary clustering → skill taxonomy (not just module names)
          + growth trajectory: comprehension by module over time
          + tool_calls diversity → correlate tool usage with comprehension
          + files_referenced coverage → "modules you've never directed AI on"
```

**Prompt Patterns — Enhanced**
```
Current:  Feature comparison (has constraints? has examples? length)
Enhanced: + full prompt text available (prompts_all not content_summary)
          + outcome correlation: which structural features → success
          + execution_phase correlation: do prompts differ by phase?
          + anti-pattern detection using actual outcomes not HDS proxy
```

**Velocity Tracker — Enhanced**
```
Current:  Turns-to-acceptance by domain/week
Enhanced: + session-bounded velocity (turns per session to achieve outcome)
          + execution_phase transitions: planning→implementation velocity
          + feature-scoped velocity (how fast per active feature)
          + trend decomposition: is slowdown domain-specific or global?
```

**Blind Spots — Enhanced**
```
Current:  Module scores < threshold for 2+ weeks
Enhanced: + files_referenced coverage map → untouched areas
          + tool_calls diversity → tool avoidance patterns
          + cross-reference with comprehension growth → stagnation zones
          + session avoidance: features with 0 sessions in N days
```

**Decision Replay — Enhanced**
```
Current:  Drift detection on decisions.jsonl text
Enhanced: + outcome tracking: decisions with known outcomes → calibration score
          + feature correlation: which features have most decision reversals
          + temporal pattern: decisions made in debugging phase → revert rate
          + confidence calibration: high-confidence decisions that failed
```

#### 10.4.3 Improved Data Transformation Strategies

**Strategy 1: Session-First Aggregation**

Instead of treating events atomically, group by `session_id` first:

```
Events → Sessions → Features → Intelligence

Session = {
  id, start_ts, end_ts, event_count, turn_count,
  execution_phases: { planning: N, implementation: N, debugging: N, review: N },
  outcome: dominant_outcome,
  feature_id: primary feature,
  intent_cluster: grouped intent_summaries,
  comprehension: session-level HDS trajectory,
  cost: total tokens × rate,
  tools_used: unique tool_calls,
  files_touched: union of files_modified + files_referenced
}
```

This intermediate representation enables all analyzers to reason at session granularity without each rebuilding the grouping logic.

**Strategy 2: Outcome-Weighted Signals**

Current: All events weighted equally in aggregations.
Enhanced: Weight by outcome:
- `success` → 1.0× (baseline)
- `partial` → 0.7× (partial signal)
- `failure` → analyzed differently (what went wrong, not averaged in)
- `abandoned` → flagged as waste, excluded from positive metrics

**Strategy 3: Execution Phase Normalization**

Current: HDS compared globally regardless of phase.
Enhanced: Phase-specific baselines:
- `planning`: expected HDS 0.7-1.0 (human directing heavily)
- `implementation`: expected HDS 0.3-0.7 (collaboration)
- `debugging`: expected HDS 0.1-0.5 (AI exploring)
- `review`: expected HDS 0.5-0.8 (human verifying)

Deviations FROM phase-specific baselines are more meaningful than raw scores.

**Strategy 4: Progressive Signal Fusion**

```
Tick-level (2s):     Structural processing (existing Layer 1)
Batch-level (10s):   IntelligenceEngine per-analyzer pass
Correlation (60s):   Cross-analyzer narrative synthesis
Daily (distill):     Full LLM-powered narrative + profile update
Weekly (digest):     Trend decomposition + pattern confidence promotion
```

Each level feeds into the next. Tick-level produces the DB rows. Batch-level produces per-analyzer JSON. Correlation produces narrative insights. Daily distill uses all of the above as input. Weekly digest promotes/demotes patterns based on sustained evidence.

#### 10.4.4 Backend-UI Integration Tightening

**Current state:** UI fetches from API, API reads JSON files, JSON files never written. A 4-layer disconnect.

**Enhanced integration:**

| Signal | Backend Source | Transport | UI Surface | Latency |
|---|---|---|---|---|
| Summary stats | `writeSummary()` (2s tick) | SSE push | Home page KPIs | <3s |
| Intelligence insights | Engine JSON (10s batch) | SSE push on write | Dashboard pages | <12s |
| Narrative claims | Correlation pass (60s) | SSE push | Insight feed | <65s |
| Lineage traces | `event_insight_map` | REST on-demand | "Why?" drill-through | On click |
| Feature progress | `assignEventsToFeatures` | SSE push | Feature timeline | <3s |
| Session reports | Session materializer | REST + SSE | Session view | <5s |
| Coach recommendations | Cross-analyzer synthesis | REST + badge notification | Coach page + home banner | <65s |

**New UI affordances needed:**
1. **"Why?" button** on every insight → expands to show source events via lineage
2. **Feature filter** on all intelligence pages → scope metrics to active feature
3. **Session timeline** view → per-session cards with outcome, cost, efficiency
4. **Progressive disclosure** indicators → "5/20 events to unlock velocity insights"
5. **Narrative insight cards** in the home feed → causal explanations, not just numbers

#### 10.4.5 Prioritization Framework

**Scoring dimensions:**
- **Unlock factor (U):** How many downstream features does this unblock? (1-10)
- **Data readiness (D):** Is the input data already captured and stored? (0-1, where 1 = fully ready)
- **User signal (S):** How strongly do users want this? (from §9.7 signal strength)
- **Implementation effort (E):** Lines of code / complexity (inverted: lower effort = higher score)

**Priority Score = U × D × S × E**

| Enhancement | U | D | S | E | Score | Phase 12 Sprint |
|---|---|---|---|---|---|---|
| Wire IntelligenceEngine.run() | 10 | 1.0 | 1.0 | 1.0 | **10.0** | 12A (task 12A.2) |
| Populate lineage on insight write | 7 | 1.0 | 0.8 | 0.9 | **5.0** | 12A (add to 12A.2) |
| Session-level materialization | 6 | 1.0 | 0.9 | 0.7 | **3.8** | 12C (new task) |
| Upgrade analyzers to use Phase 11 fields | 5 | 1.0 | 0.8 | 0.6 | **2.4** | 12C (enhances existing) |
| Cross-analyzer correlation | 4 | 0.8 | 0.7 | 0.5 | **1.1** | Phase 13 (post-12C) |
| Narrative synthesis layer | 3 | 0.6 | 0.9 | 0.4 | **0.65** | Phase 13 (post-12C) |
| Outcome-weighted signal adjustment | 3 | 1.0 | 0.6 | 0.8 | **1.4** | 12A (in outcome classifier 12A.5) |
| Feature-scoped intelligence | 4 | 1.0 | 0.7 | 0.5 | **1.4** | 12C (enhances history cmd) |
| "Why?" lineage UI | 3 | 0.5 | 0.8 | 0.5 | **0.6** | Phase 13 (requires populated lineage) |
| Progressive disclosure indicators | 2 | 1.0 | 0.7 | 0.8 | **1.1** | 12A (task 12A.9) |

### 10.5 Execution Sequence — Mapped to Phase 12 Sprints

The following enhancements integrate into the Phase 12 sprint structure defined in `PHASE_12_INTELLIGENCE_WIRING_AND_PROACTIVE_ACTIONS.md`:

```
Sprint 12A — Wire & Light Up (Phase 12 defined: 9 tasks)
├── [existing] Wire IntelligenceEngine.run() into materializer tick (12A.2)
├── [existing] Outcome classification before engine.run (12A.5)
├── [existing] Cold-start 202 "warming_up" response (12A.9)
├── [ENHANCEMENT] Add lineage writes (writeInsightMappings) inside engine.run output path
├── [ENHANCEMENT] SSE push on intelligence file write (emit to connected dashboards)
└── Validates: all 8 pages show data, MCP tools return real intelligence, lineage populated

Sprint 12B — Proactive Action Layer (Phase 12 defined: 13 tasks)
├── [existing] ActionRunner framework + config schema v3 (12B.1-12B.2)
├── [existing] Auto-rule generation from Coach patterns (12B.3-12B.5)
├── [existing] Session-end context writer (12B.6)
├── [existing] Weekly digest card generation (12B.7-12B.8)
├── No new enhancements — sprint is already comprehensive
└── Validates: proactive file writes work, opt-in respected, rate limits enforced

Sprint 12C — Deep Intelligence (Phase 12 defined: 12 tasks)
├── [existing] Value receipt model + distill integration (12C.1-12C.2)
├── [existing] Debugging arc reconstruction (12C.3-12C.4)
├── [existing] `unfade history` command (12C.5)
├── [existing] Decision durability tracker (12C.6-12C.7)
├── [existing] `unfade savings` command (12C.8)
├── [ENHANCEMENT] Session-level materialization (new task: materializeSessionMetrics)
├── [ENHANCEMENT] Upgrade analyzers to consume Phase 11 fields (see §10.4.2)
├── [ENHANCEMENT] Feature-scoped intelligence in history command
└── Validates: value quantified, debugging arcs narrated, sessions visible, analyzers deeper

Sprint 11E — Cross-Analyzer Intelligence (Phase 11, post-Phase 12)
├── Cross-analyzer correlation module (11E.1, requires all 8 analyzers producing stable output)
├── Narrative synthesis layer (11E.2-11E.3, 60s cadence, template-based causal claims)
├── "Why?" lineage drill-through in UI (11E.4-11E.5, requires lineage populated in 12A)
├── Phase-normalized HDS baselines (11E.6-11E.7, requires session materializer 12C.13)
├── Coach narrative integration (11E.9, synthesizes cross-analyzer context)
└── Prerequisite: Phase 12A-12C complete, 2+ weeks of populated intelligence data
```

**Alignment note:** §9.9 defined the execution sequence as Phases 12A→12B→12C. The Phase 12 architecture doc formalizes this into 39 tasks across 3 sprints (original 34 + 5 enhancements from this audit). The cross-analyzer intelligence work (correlation, narratives, lineage UI, phase baselines) lives in Sprint 11E — it returns to Phase 11 because it completes the capture→display intelligence pipeline that Phase 11 owns. Sprint 11E executes AFTER Phase 12C, requiring 2+ weeks of populated intelligence data.

### 10.6 Key Architectural Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| Session materialization as intermediate layer | Reduces N×M joins across analyzers; each analyzer queries sessions, not raw events | Each analyzer does its own session grouping (duplication, inconsistency) |
| 60s narrative cadence (not every tick) | Narrative needs multi-analyzer signal; running per-tick would produce noisy half-formed claims | Daily-only narrative (too slow for real-time dashboard) |
| Outcome-weighted rather than outcome-filtered | Abandoned/failed sessions contain learning signal; filtering discards useful data | Binary filter (exclude failures entirely) |
| Phase-specific HDS baselines | Raw HDS penalizes debugging (naturally AI-heavy); normalization makes comparison fair | Global threshold (produces false "brain atrophy" alerts during debugging sprints) |
| Lineage populated at write-time | O(1) per insight vs. O(N) retroactive computation; enables instant "Why?" | Compute lineage on demand (slow, blocks UI interaction) |

### 10.7 Success Criteria (mapped to Phase 12 sprints)

| Metric | Current | After 12A | After 12B | After 12C |
|---|---|---|---|---|
| Intelligence pages with real data | 0/8 | 8/8 | 8/8 | 8/8 |
| % of Phase 11 fields utilized | 17% (2/12) | 33% (4/12) | 33% (4/12) | 83% (10/12) |
| Time from event to intelligence insight | ∞ (never) | <12s | <12s | <12s |
| Insight traceability (lineage populated) | 0% | 100% | 100% | 100% |
| User actions required for value | Manual query | Manual query | Zero (proactive) | Zero (proactive) |
| Cross-analyzer causal narratives | 0 | 0 | 0 | 0 (Phase 13) |
| Auto-generated project rules | 0 | 0 | Active (files updated) | Active |
| Value quantification | None | None | None | Present in distill |
| Session-level visibility | None | None | None | Session metrics computed |

### 10.8 Risk Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| 8 analyzers on tick cause latency spike | Medium | 10s throttle already exists. Add per-analyzer timing. Skip analyzer if previous run >5s. Index `idx_events_ts` already present. |
| Cross-analyzer correlation produces spurious causality | High | Require correlation coefficient > 0.6 AND temporal ordering. Label all causal claims as "likely" not "definitely". |
| Session materialization doubles storage | Low | Sessions table is bounded: ~5-20 sessions/day × 365 = ~7K rows/year. Negligible. |
| Narrative synthesis hallucinates without LLM | Medium | Use template-based narrative (pattern matching on analyzer outputs) not LLM. Reserve LLM for daily distill only. |
| Auto-writing to project files causes user trust loss | High | Require explicit opt-in during `unfade init`. Show preview before first write. Add `--no-auto-write` kill switch. Never write without user having enabled it. |
| Cold-start frustration (nothing visible for days) | Medium | Progressive disclosure with specific thresholds. Show "3 more events until X unlocks." Make the warming-up state feel intentional, not broken. |

---

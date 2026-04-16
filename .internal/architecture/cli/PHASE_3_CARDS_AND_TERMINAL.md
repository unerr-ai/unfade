# Phase 3 — Cards & Terminal Capture

> **Feature Statement:** _"My AI coding day, distilled into a shareable card. The Unfade Card IS the marketing — every share is a demonstration of what Unfade does. Terminal capture adds the richest debugging signal: 'Spent 40 min on auth token refresh — tried 3 approaches, root cause was JWT validation order.'"_
>
> **Prerequisites:** [Phase 2 — Hooks API & MCP Server](./PHASE_2_HOOKS_API_AND_MCP.md) complete (MCP server running, HTTP API available, query engine working)
>
> **Status:** AWAITING REVIEW
>
> **Inspired by:** GitHub contribution graph (heatmap identity), Spotify Wrapped (shareable personal data), OG image generation patterns (`@vercel/og`, `satori`)
>
> **Foundation doc:** [Research & Design](./UNFADE_CLI_RESEARCH_AND_DESIGN.md)
>
> **Last updated:** 2026-04-16

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan (Micro-Sprints 3A–3D)](#6-implementation-plan-micro-sprints-3a3d)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 3 delivers two capabilities that serve different strategic goals:

1. **Unfade Cards** — the viral marketing unit. Every card shared on X/LinkedIn/Reddit is a demonstration of what Unfade does. The card itself creates aspiration-driven adoption: "I want MY reasoning day to look like that."

2. **Terminal capture** — the richest signal source. Git captures what you decided. AI sessions capture what you asked. Terminal captures the *exploration process*: retries, debugging sessions, error patterns, command sequences. This is the signal that transforms distills from "you made decisions" to "you spent 40 minutes debugging JWT validation, tried 3 approaches, and the root cause was validation order."

### 1.2 The Principle

> **The card is the marketing. The terminal is the signal. Together, they make every distill richer and every share more compelling.**

---

## 2. The Problem

### Current State (after Phase 2)

Distills exist and are queryable via MCP/HTTP — but they're text files visible only to the developer. There's no shareable artifact. Terminal activity (the richest debugging signal) is not captured.

### After Phase 3

| Concern | State |
|---|---|
| **Unfade Card** | Web UI `/cards` page provides preview, generation for any date, and PNG download. TUI quick action `[c]` triggers card generation. API endpoint `POST /cards/generate` powers both interfaces. Rendering pipeline: satori → resvg-js → PNG — dark theme, top decisions, domain tags, reasoning depth indicator |
| **Card sharing** | Card image generated locally via web UI or TUI. Developer shares manually (attach to tweet, paste in Slack) |
| **Terminal capture** | Shell hooks installed during `unfade init` (reinstallable from web UI `/settings`). Hooks pipe commands + exit codes to the Go daemon (`unfaded`) via Unix socket (macOS/Linux) or named pipe (Windows) |
| **Debugging detection** | Go daemon detects patterns: same command run 3x with different args → "exploration pattern." Error → retry → success → "debugging session" |
| **Richer distills** | Terminal events enrich distill with debugging context: time spent, approaches tried, error patterns |
| **Export** | `unfade export` creates portable `.tar.gz` archive of all `.unfade/` data |
| **Amplification v1** | Cross-temporal connection detection — when generating distill, compare today's decisions against past distills. Surfaces "You evaluated X today; on [date] you made a similar evaluation" |
| **Similar search** | `unfade_similar` MCP tool + Web UI `/search` page — find analogous past decisions for a given problem description. `unfade_amplify` MCP tool + HTTP endpoint for proactive insight surfacing |

---

## 3. Research

### 3.1 OG Image Generation

| Technology | Pros | Cons | Verdict |
|---|---|---|---|
| **`satori`** (Vercel) | JSX → SVG, no browser needed, fast, small | SVG only (needs `resvg-js` for PNG) | **Best fit** — JSX rendering matches our React stack |
| **`@vercel/og`** | Built on satori, adds PNG conversion | Designed for edge runtime, heavier | Use satori directly |
| **Puppeteer/Playwright** | Full browser rendering | Heavy dependency (300MB+), slow | Too heavy for CLI |
| **Canvas (node-canvas)** | Direct pixel manipulation | Native dependency, complex layout | Too low-level |

### 3.2 Terminal Capture Patterns

| Approach | How It Works | Pros | Cons |
|---|---|---|---|
| **Shell hook (preexec/precmd)** | zsh `preexec` captures command before execution, `precmd` captures exit code after | Lightweight, no latency, captures intent | Requires shell-specific hooks |
| **Script/tee wrapper** | Wrap shell in `script` or pipe through tee | Captures full output | Adds latency, complex setup |
| **PTY proxy** | Interpose a pseudo-terminal | Full capture with no user-visible change | Complex, potential compatibility issues |

**Unfade Choice:** Shell hook (preexec/precmd) — lightweight, captures the right signal (commands + exit codes), no latency, well-understood pattern.

---

## 4. Architecture

### 4.1 Unfade Card — Data Flow

```
.unfade/distills/YYYY-MM-DD.md
        │
        ▼
┌──────────────────┐
│ Card Generator   │  (generator.ts)
│                  │
│ Parse distill    │
│ Extract:         │
│  - Top decisions │
│  - Domain tags   │
│  - Reasoning     │
│    depth score   │
│  - Dead ends     │
│    count         │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Card Template    │  (templates.ts)
│                  │
│ JSX → satori     │
│ → SVG → resvg    │
│ → PNG            │
└────────┬─────────┘
         │
         ▼
  .unfade/cards/YYYY-MM-DD.png
```

### 4.2 Unfade Card — Visual Design

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

### 4.3 Terminal Capture — Shell Hook

```bash
# Installed by `unfade init` into .zshrc (reinstallable from web UI /settings)

# Capture command before execution
unfade_preexec() {
  _unfade_cmd="$1"
  _unfade_cmd_start=$(date +%s)
}

# Capture result after execution
unfade_precmd() {
  local exit_code=$?
  if [[ -n "$_unfade_cmd" ]]; then
    # Send to Go daemon (unfaded) via Unix socket (non-blocking)
    echo "{\"cmd\":\"$_unfade_cmd\",\"exit\":$exit_code,\"duration\":$(($(date +%s)-_unfade_cmd_start))}" \
      | nc -U ~/.unfade/state/daemon.sock 2>/dev/null &
    unset _unfade_cmd _unfade_cmd_start
  fi
}

# Register hooks
autoload -Uz add-zsh-hook
add-zsh-hook preexec unfade_preexec
add-zsh-hook precmd unfade_precmd
```

### 4.4 Terminal Event Types

| Terminal Pattern | How Detected | CaptureEvent Type | Reasoning Signal |
|---|---|---|---|
| **Command execution** | preexec hook | `command` | What tools/commands used |
| **Error** | Non-zero exit code | `error` | What went wrong |
| **Retry** | Same base command, different args, after error | `retry` | Debugging exploration |
| **Debugging session** | 3+ retries within 10 minutes on related commands | (metadata) | Time invested, approaches tried |

### 4.5 File Tree — Phase 3 Additions

```
src/
  services/
    card/
      generator.ts          # Parse distill → card data extraction
      templates.ts           # JSX card template for satori rendering
    shell/
      installer.ts           # Shell hook installer (called from `unfade init`)
    distill/
      amplifier.ts           # Cross-temporal connection detection
  server/
    pages/
      cards.ts               # GET /cards — web UI card preview/generate/download page
      search.ts              # GET /search — web UI similar-decision search page
    routes/
      cards.ts               # POST /cards/generate — card generation API
  tools/
    unfade-amplify.ts        # unfade_amplify MCP tool
    unfade-similar.ts        # unfade_similar MCP tool
  commands/
    export.ts                # `unfade export` CLI command (power user)

daemon/                      # Go daemon (unfaded)
  capture/
    terminal.go              # Terminal event receiver (Unix socket / named pipe)
    patterns/
      debugging.go           # Debugging session + retry pattern detection
  platform/
    shell_hook.go            # Platform-specific shell hook helpers
```

---

## 5. Design Principles

1. **The card is the product demo.** Every Unfade Card is a self-contained demonstration of what Unfade does. It must be beautiful enough that developers want to share it unprompted.

2. **Terminal capture adds zero latency.** The shell hook sends data asynchronously via Unix socket. The developer should never notice it's there.

3. **Debugging sessions are gold.** When terminal capture detects a debugging session (retries, errors, eventual success), this is the highest-value signal for distillation. The distill should highlight these as "exploration narratives."

4. **Cards are generated, not hosted.** Phase 3 generates card images locally. Hosting (unfade.dev/username) is a Phase 5 concern. The developer decides where to share.

5. **Shell hooks are opt-in.** Shell hooks are installed during `unfade init` with explicit opt-in. Hook status is visible and reinstallable from the web UI `/settings` page.

---

## 6. Implementation Plan (Micro-Sprints 3A–3D)

> **Phase 3 Boundary:**
> Phase 3 spans BOTH TypeScript and Go. The two domains are strictly isolated into separate sprints to prevent agent hallucination. Go sprints touch ONLY `daemon/` files. TypeScript sprints touch ONLY `src/` files.
>
> ```
> TypeScript READS from:  .unfade/distills/YYYY-MM-DD.md    (card data extraction)
>                          .unfade/events/YYYY-MM-DD.jsonl   (amplifier comparison)
>                          .unfade/graph/decisions.jsonl      (similar decision search)
>                          .unfade/profile/reasoning_model.json (card stats)
>
> TypeScript WRITES to:   .unfade/cards/YYYY-MM-DD.png       (generated card images)
>
> Go daemon READS from:   ~/.unfade/state/daemon.sock        (terminal event receiver)
>
> Go daemon WRITES to:    .unfade/events/YYYY-MM-DD.jsonl    (terminal CaptureEvents)
> ```
>
> **CardData extraction contract:**
> ```
> CardData {
>   date: string               // YYYY-MM-DD
>   decisions: string[]         // Top 3 decision one-liners (max 80 chars each)
>   domains: string[]           // Top 3 domain tags
>   reasoning_depth: number     // avg alternatives per decision
>   dead_ends: number
>   decision_count: number
>   ai_modified_pct: number     // % of decisions involving AI modification
> }
> ```
>
> **Debugging session detection rules (in Go daemon):**
> ```
> A debugging session is detected when:
>   1. 3+ commands within a 10-minute window
>   2. Commands are "related" (any of: same base binary, same target file, same cwd)
>   3. At least one command has non-zero exit code
>
> Related commands heuristic:
>   - Same base binary: first token matches (e.g., npm, cargo, python)
>   - Same target file: argument contains a path-like token (contains / or . with known extension)
>   - Same cwd + time proximity: same working directory within 10-minute window
> ```

---

### 6.1 Sprint 3A — Card Rendering Pipeline (TypeScript)

**Objective:** End-to-end card generation from distills — parse Markdown, extract CardData, render JSX via satori → resvg-js → PNG. Web UI `/cards` page and `POST /cards/generate` API endpoint.

**Acid Test:**
```bash
# Generate card via API
curl -s -X POST http://localhost:7654/cards/generate \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-04-15"}' > card.png
file card.png
# → PNG image data, 1200 x 630

# Web UI card page
curl -s http://localhost:7654/cards | grep -c "hx-post"
# → 1+ (generate button present)

# Card file written
ls .unfade/cards/2026-04-15.png
# → file exists
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-058** | Card generator: parse Daily Distill Markdown → extract `CardData` — top decisions (max 3, 80 chars each), domain tags (top 3), reasoning depth score (avg alternatives per decision), dead ends count, AI modification rate. Handle missing/empty distill gracefully (return empty CardData with `degraded: true`) | `src/services/card/generator.ts` | [x] |
| **UF-059** | Card templates: JSX template for satori rendering — dark theme (background #1a1a2e, text #e0e0e0, accent from primary domain), Unfade branding header, decision list (bullet points), domain tag pills, reasoning depth bar (visual progress bar), stats footer (dead ends, decisions, AI modified %). Dimensions: 1200x630 (OG-compatible) | `src/services/card/templates.tsx` | [x] |
| **UF-060** | Card rendering pipeline: `generateCard(date: string): Promise<Buffer>` — reads distill via generator (UF-058), renders JSX template (UF-059) via satori to SVG, converts via resvg-js to PNG, writes to `.unfade/cards/YYYY-MM-DD.png`. Return PNG buffer for API responses | `src/services/card/generator.ts` | [x] |
| **UF-061** | Card web UI page and API: `GET /cards` page (date picker, "Generate Card" button via `hx-post="/cards/generate"`, card preview `<img>` tag, PNG download link). `POST /cards/generate` JSON API endpoint (accepts `{ date }`, returns `{ url, path }` with `_meta` envelope). TUI `[c]` quick action calls this endpoint via HTTP (read port from `server.json`) | `src/server/pages/cards.ts`, `src/server/routes/cards.ts` | [x] |

**Agent Directive (Sprint 3A):**

> "Build 4 modules. All TypeScript. Do NOT touch any Go files or daemon code. (1) `src/services/card/generator.ts`: export `extractCardData(distillPath: string): CardData` — read distill Markdown, parse sections (DECISIONS, TRADE-OFFS, DEAD ENDS using regex or simple Markdown parsing). Extract top 3 decisions (first sentence, max 80 chars), top 3 domain tags (from decision metadata), reasoning depth (avg alternatives count), dead ends count, decision count, AI modification rate. Handle missing file: return empty CardData with all zero values. Export `generateCard(date: string): Promise<Buffer>` — calls extractCardData, renders template, returns PNG buffer. Write PNG to `.unfade/cards/YYYY-MM-DD.png`. (2) `src/services/card/templates.ts`: export a JSX-compatible template function for satori. Dark theme: background #1a1a2e, text #e0e0e0, monospace font. Layout: header ('UNFADE' + date), decision list (bullet points), domain pills (colored tags), reasoning depth bar (filled/unfilled segments), stats footer. Dimensions 1200x630. (3) Wire pipeline: satori renders JSX → SVG string, resvg-js converts SVG → PNG Buffer. (4) `src/server/pages/cards.ts` + `src/server/routes/cards.ts`: GET /cards page with layout() wrapper, date picker input, generate button with `hx-post='/cards/generate'` and `hx-target='#card-preview'`, img preview, download link. POST /cards/generate route: validate date, call generateCard(), return `{ data: { path, url }, _meta }`. Update TUI dashboard `[c]` handler to POST to this endpoint."

**Strict Contracts:**
- Card dimensions: exactly 1200x630 pixels (OG-compatible for X/LinkedIn)
- Card file size: target < 500KB PNG
- `extractCardData()` NEVER throws — returns empty CardData for missing/malformed distills
- Card PNG written to `.unfade/cards/YYYY-MM-DD.png` — one card per day
- `POST /cards/generate` returns `_meta` envelope consistent with Phase 2 API pattern
- Domain-to-color mapping: deterministic hash of domain string → HSL hue (consistent colors across cards)

---

### 6.2 Sprint 3B — Go Daemon: Terminal Capture & Debugging Detection

**Objective:** Extend Go daemon to receive terminal events via Unix socket from shell hooks. Detect debugging sessions (3+ related commands with errors in 10-minute window). Emit enriched CaptureEvents.

**Acid Test:**
```bash
# Send terminal event to daemon socket
echo '{"cmd":"npm test","exit":1,"duration":3,"cwd":"/project"}' \
  | nc -U ~/.unfade/state/daemon.sock

# Verify event written
tail -1 .unfade/events/$(date +%Y-%m-%d).jsonl | jq .source
# → "terminal"

# Trigger debugging session detection
for i in 1 2 3; do
  echo "{\"cmd\":\"npm test --flag$i\",\"exit\":1,\"duration\":2,\"cwd\":\"/project\"}" \
    | nc -U ~/.unfade/state/daemon.sock
  sleep 1
done
echo '{"cmd":"npm test --flag4","exit":0,"duration":2,"cwd":"/project"}' \
  | nc -U ~/.unfade/state/daemon.sock

# Verify debugging session event
grep debugging_session .unfade/events/$(date +%Y-%m-%d).jsonl | jq .
# → synthetic CaptureEvent with type "debugging_session"
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-062** | Terminal capture receiver in Go daemon: listen on Unix socket (`~/.unfade/state/terminal.sock` on macOS/Linux) for JSON payloads from shell hooks. Parse `{ cmd, exit, duration, cwd }` into CaptureEvents with `source: "terminal"`, write to daily JSONL. Non-blocking accept — never delay daemon startup. Handle malformed JSON gracefully (log warning, discard) | `daemon/internal/capture/terminal.go` | [x] |
| **UF-064** | Debugging session detection: stateful pattern detector that buffers last 10 minutes of terminal events per cwd. On each new event: check if 3+ related commands exist in buffer with at least one non-zero exit code. If yes, emit synthetic CaptureEvent with `type: "debugging_session"` containing: commands involved, total duration, exit codes, eventual resolution (last successful command, if any). Related-commands heuristic: same base binary (first token) OR same target file (path-like args) OR same cwd within time window. False positives are harmless; false negatives lose signal — keep heuristic simple | `daemon/internal/capture/debugging.go` | [x] |

**Agent Directive (Sprint 3B):**

> "Build 2 Go modules. Do NOT touch any TypeScript files or `src/` directory. (1) `daemon/internal/capture/terminal.go`: add a `TerminalReceiver` that listens on a Unix domain socket at `~/.unfade/state/daemon.sock`. Accept connections in a goroutine loop. For each connection: read one JSON line (`{ cmd, exit, duration, cwd }`), validate fields, convert to `CaptureEvent` with `source: 'terminal'`, `type: 'command'` (or `type: 'error'` if exit != 0). Write to daily JSONL file via existing event writer. Close connection after reading. Handle errors: malformed JSON → log warning + discard, socket already exists → remove stale socket on startup. Platform: use `net.Listen('unix', path)` on macOS/Linux. Add Windows named pipe support via build tag or conditional. (2) `daemon/internal/capture/patterns/debugging.go`: export `DebuggingDetector` struct with `ProcessEvent(event CaptureEvent)` method. Maintain a circular buffer of terminal events per cwd (keyed by cwd string, 10-minute TTL). On each event: scan buffer for related commands (same base binary = first whitespace-delimited token, or same cwd). If 3+ related commands exist with ≥1 non-zero exit: emit a synthetic CaptureEvent `{ type: 'debugging_session', source: 'terminal', metadata: { commands: [...], total_duration, exit_codes, resolved: bool, resolution_cmd } }`. Clear matched events from buffer after emitting session."

**Strict Contracts:**
- Socket path: `~/.unfade/state/daemon.sock` (macOS/Linux), `\\.\pipe\unfade` (Windows)
- Terminal event JSON payload: `{ "cmd": string, "exit": number, "duration": number, "cwd": string }`
- CaptureEvent `source` field: `"terminal"` for all terminal-originated events
- Debugging session threshold: 3+ related commands, ≥1 non-zero exit, within 10-minute window
- Socket listener MUST NOT block daemon startup — run in separate goroutine
- Stale socket file: remove and re-create on daemon startup

---

### 6.3 Sprint 3C — Shell Hooks & Export (TypeScript)

**Objective:** Shell hook installer generates and installs preexec/precmd hooks for zsh/bash that pipe terminal events to the Go daemon's Unix socket. `unfade export` creates a portable archive.

**Acid Test:**
```bash
# Shell hook installation (dry run)
unfade init --dry-run 2>&1 | grep -c "shell hook"
# → 1+ (hook installation mentioned)

# Verify hook code generation
node -e "const {generateHook} = require('./dist/cli.mjs'); console.log(generateHook('zsh'))"
# → outputs zsh preexec/precmd hook code

# Export command
unfade export
ls unfade-export-$(date +%Y-%m-%d).tar.gz
# → file exists

# Export excludes ephemeral state
tar tzf unfade-export-*.tar.gz | grep -c "daemon.sock"
# → 0 (socket excluded)
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-063** | Shell hook installer: called from `unfade init` (Phase 1 UF-018 step). Detect shell (zsh via `$SHELL` or `$ZSH_VERSION`, bash via `$BASH_VERSION`, PowerShell via `$PSVersionTable`). Generate appropriate hook code: zsh (`preexec`/`precmd` with `add-zsh-hook`), bash (`PROMPT_COMMAND` + `DEBUG` trap). Hook sends JSON `{ cmd, exit, duration, cwd }` to daemon socket via `nc -U` (non-blocking, backgrounded). Append to shell config (`~/.zshrc`, `~/.bashrc`). Verify installation by checking if hook functions are defined. Idempotent: check if already installed before appending. Web UI `/settings` page shows hook status and provides reinstall button | `src/services/shell/installer.ts` | [x] |
| **UF-065** | `unfade export` command: `unfade export [--output path]`. Create `.tar.gz` archive of `.unfade/` directory. EXCLUDE: `state/daemon.sock`, `state/daemon.pid`, `state/health.json`, `state/server.json`, `state/init_progress.json`, `bin/` directory. INCLUDE: `events/`, `distills/`, `graph/`, `profile/`, `amplification/`, `cards/`, `config.json`. Add manifest file to archive root with: export date, date range of events, event count, distill count. Default output: `./unfade-export-YYYY-MM-DD.tar.gz`. Use Node.js `tar` package or `zlib` + `tar-stream` | `src/commands/export.ts` | [x] |

**Agent Directive (Sprint 3C):**

> "Build 2 TypeScript modules. Do NOT touch any Go files or `daemon/` directory. (1) `src/services/shell/installer.ts`: export `installShellHooks(shell: 'zsh' | 'bash' | 'powershell'): InstallResult` and `detectShell(): string` and `generateHookCode(shell: string): string` and `isHookInstalled(shell: string): boolean`. `detectShell()`: check `$SHELL` env var, fall back to `$ZSH_VERSION` / `$BASH_VERSION`. `generateHookCode('zsh')`: return zsh hook with `unfade_preexec()` and `unfade_precmd()` using `add-zsh-hook` — capture command, start time, then on completion send JSON payload via `nc -U ~/.unfade/state/daemon.sock` backgrounded with `&`. `generateHookCode('bash')`: return bash equivalent using `DEBUG` trap for preexec and `PROMPT_COMMAND` for precmd. `installShellHooks()`: check `isHookInstalled()` first (grep for 'unfade_preexec' in config file), if not installed append generated code with `# Added by Unfade` comment markers, return `{ installed: true, shell, configFile }`. (2) `src/commands/export.ts`: Commander command `unfade export` with `--output` option (default `./unfade-export-YYYY-MM-DD.tar.gz`). Find `.unfade/` directory via `paths.ts`. Create tar.gz excluding ephemeral state files. Add `manifest.json` to archive: `{ exportDate, dateRange: { from, to }, eventCount, distillCount }`. Print export path to stderr."

**Strict Contracts:**
- Shell hooks send data via `nc -U` backgrounded (`&`) — ZERO latency impact on shell
- Hook installation is idempotent — grep for marker comment before appending
- Hook code includes `2>/dev/null` on socket send — silent failure if daemon not running
- Export NEVER includes socket files, PID files, or binaries
- Export manifest includes date range and counts for portability verification

---

### 6.4 Sprint 3D — Amplification Engine, Tools & Search UI (TypeScript)

**Objective:** Cross-temporal connection detection (amplifier), MCP tools for amplification and similar-decision search, and web UI `/search` page.

**Acid Test:**
```bash
# Amplifier finds cross-temporal connection
curl -s http://localhost:7654/unfade/amplify?date=2026-04-15 | jq '.data.connections[0]'
# → { "today": "Chose Redis for session cache", "past": { "date": "2026-04-10", "decision": "Chose Memcached for cache" }, "relevance": 0.85 }

# Similar decision search via MCP tool
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"unfade_similar","arguments":{"problem":"choosing a cache backend"}},"id":1}' \
  | unfade mcp | jq '.result.content[0].text' | jq '.data.results'
# → array of similar past decisions

# Web UI search page
curl -s http://localhost:7654/search | grep -c "hx-get"
# → 1+ (search form with htmx present)
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-066** | Amplifier v1: cross-temporal connection detection — `amplify(date: string): AmplificationResult`. Read today's decisions from distill, compare against all past distills using keyword overlap + domain match scoring. If similar decision found (relevance > 0.7), surface connection: "You evaluated X today. On [date], you made a similar evaluation and chose Y." Return ranked connections with relevance scores. Register `GET /unfade/amplify?date=` HTTP endpoint | `src/services/distill/amplifier.ts`, `src/server/routes/amplify.ts` | [x] |
| **UF-067** | Amplify MCP tool + HTTP endpoint: `unfade_amplify` MCP tool — accepts `{ date }`, calls amplifier, returns connections in `_meta` envelope. Proactive insight surfacing from reasoning history. Also register as HTTP endpoint `GET /unfade/amplify` for API access | `src/tools/unfade-amplify.ts` | [x] |
| **UF-068** | Similar MCP tool: `unfade_similar` — accepts `{ problem: string, limit?: number }`, searches past decisions in `graph/decisions.jsonl` and distills for analogous decisions. Score by keyword overlap + domain proximity. Return ranked results with context (date, full decision, alternatives considered). Register in MCP server alongside Phase 2 tools | `src/tools/unfade-similar.ts` | [x] |
| **UF-069** | Similar search web UI page: `GET /search` page with search input (`hx-get="/unfade/similar?problem={value}"` with `hx-trigger="keyup changed delay:300ms"`), results list showing analogous past decisions with dates and context. Layout wrapper from Phase 2. Add `/search` to nav bar | `src/server/pages/search.ts` | [x] |

**Agent Directive (Sprint 3D):**

> "Build 4 TypeScript modules. Do NOT touch any Go files. (1) `src/services/distill/amplifier.ts`: export `amplify(date: string): Promise<AmplificationResult>` — read target date's distill, extract decisions. Read all past distills (scan `.unfade/distills/` directory for `*.md` files, exclude target date). For each past decision: compute relevance score (keyword overlap via Jaccard similarity on tokenized words + domain match bonus of 0.2 if same domain). Filter connections with relevance > 0.7. Return `{ connections: [{ today, past: { date, decision }, relevance }], _meta }`. Sort by relevance descending. Also export `findSimilar(problem: string, limit: number): SimilarResult[]` — search decisions.jsonl + all distills for decisions matching the problem description. Score by keyword overlap. (2) `src/tools/unfade-amplify.ts`: MCP tool handler for `unfade_amplify` — validate input `{ date }` with Zod, call `amplify()`, wrap in `_meta` envelope. Register in MCP server's tool list. (3) `src/tools/unfade-similar.ts`: MCP tool handler for `unfade_similar` — validate input `{ problem, limit? }` with Zod, call `findSimilar()`, wrap in `_meta` envelope. (4) `src/server/pages/search.ts`: GET /search handler — render search page with layout() wrapper. Search input with `hx-get='/unfade/similar'` and `hx-target='#results'` and `hx-trigger='keyup changed delay:300ms'`. Results div showing decision cards (date, decision text, relevance score, alternatives). Also register `GET /unfade/similar` as JSON endpoint (returns results for htmx or API use). Add 'Search' link to nav bar in layout.ts. Register `GET /unfade/amplify` route calling amplifier."

**Strict Contracts:**
- Amplifier relevance threshold: 0.7 minimum (conservative — false positives erode trust)
- Amplifier scans ALL past distills — no date range limit (the whole history IS the value)
- `findSimilar()` searches BOTH `graph/decisions.jsonl` AND distill Markdown files
- MCP tools `unfade_amplify` and `unfade_similar` follow Phase 2 `_meta` envelope pattern
- Search UI uses htmx with 300ms debounce — no custom JavaScript
- Missing distills/decisions → return empty results, never throw

---

### 6.5 Tests (T-156 → T-185)

| Test | What It Validates | File | Sprint |
|---|---|---|---|
| **T-156** | Card generator: parses distill and extracts top 3 decisions | `test/services/card/generator.test.ts` | 3A |
| **T-157** | Card generator: extracts domain tags from decisions | `test/services/card/generator.test.ts` | 3A |
| **T-158** | Card generator: calculates reasoning depth score | `test/services/card/generator.test.ts` | 3A |
| **T-159** | Card generator: handles distill with no decisions gracefully | `test/services/card/generator.test.ts` | 3A |
| **T-160** | Card rendering: produces valid PNG file | `test/services/card/generator.test.ts` | 3A |
| **T-161** | Card rendering: PNG dimensions are OG-compatible (1200x630) | `test/services/card/generator.test.ts` | 3A |
| **T-162** | Card template: renders with all data fields populated | `test/services/card/templates.test.ts` | 3A |
| **T-163** | Card template: renders with minimal data (no dead ends) | `test/services/card/templates.test.ts` | 3A |
| **T-164** | Web UI `/cards` page: renders card preview for today's distill | `test/server/pages/cards.test.ts` | 3A |
| **T-165** | Card generation API `POST /cards/generate`: generates PNG for specific date | `test/server/routes/cards.test.ts` | 3A |
| **T-166** | Card generation API `POST /cards/generate`: handles missing distill with helpful error | `test/server/routes/cards.test.ts` | 3A |
| **T-167** | Web UI `/cards` page: supports date picker for generating cards for any date | `test/server/pages/cards.test.ts` | 3A |
| **T-168** | Web UI `/cards` page: provides PNG download link after generation | `test/server/pages/cards.test.ts` | 3A |
| **T-169** | Go daemon terminal capture: receives command event via Unix socket | `daemon/internal/capture/terminal_test.go` | 3B |
| **T-170** | Go daemon terminal capture: parses command with exit code | `daemon/internal/capture/terminal_test.go` | 3B |
| **T-171** | Go daemon terminal capture: detects error event (non-zero exit) | `daemon/internal/capture/terminal_test.go` | 3B |
| **T-172** | Go daemon debugging detection: detects retry pattern (same command, different args) | `daemon/internal/capture/patterns/debugging_test.go` | 3B |
| **T-173** | Go daemon debugging detection: detects debugging session (3+ retries in 10 min) | `daemon/internal/capture/patterns/debugging_test.go` | 3B |
| **T-174** | Go daemon terminal capture: handles socket unavailable gracefully | `daemon/internal/capture/terminal_test.go` | 3B |
| **T-175** | Shell hook installer: detects zsh and generates correct hook code | `test/services/shell/installer.test.ts` | 3C |
| **T-176** | Shell hook installer: detects bash and generates correct hook code | `test/services/shell/installer.test.ts` | 3C |
| **T-177** | Shell hook installer: does not duplicate if already installed | `test/services/shell/installer.test.ts` | 3C |
| **T-178** | `unfade export`: creates .tar.gz archive with manifest | `test/commands/export.test.ts` | 3C |
| **T-179** | `unfade export`: excludes daemon socket and ephemeral state files | `test/commands/export.test.ts` | 3C |
| **T-180** | Amplifier: detects similar past decision by keyword overlap | `test/services/distill/amplifier.test.ts` | 3D |
| **T-181** | Amplifier: surfaces connection with date and context | `test/services/distill/amplifier.test.ts` | 3D |
| **T-182** | Amplifier: no false positives on unrelated decisions | `test/services/distill/amplifier.test.ts` | 3D |
| **T-183** | Similar MCP tool: finds analogous decision from history | `test/tools/unfade-similar.test.ts` | 3D |
| **T-184** | Similar MCP tool: returns empty for novel decisions | `test/tools/unfade-similar.test.ts` | 3D |
| **T-185** | Web UI `/search` page: renders search interface and displays results via htmx | `test/server/pages/search.test.ts` | 3D |

---

## 7. Success Metrics

| Metric | Current | Target | How to Measure |
|---|---|---|---|
| **Card generation time** | N/A | < 3 seconds | Timer in card generator |
| **Card visual quality** | N/A | Looks good when shared on X (OG preview renders correctly) | Manual test: share URL with card meta tag |
| **Card file size** | N/A | < 500KB PNG | File size check |
| **Terminal capture latency** | N/A | < 10ms per command (user-imperceptible) | Benchmark preexec → socket send |
| **Debugging session detection accuracy** | N/A | Detects 80%+ of actual debugging sessions (qualitative) | Manual review of 5 debugging sessions |
| **Distill enrichment** | N/A | Terminal-enriched distills include "exploration narrative" for debugging sessions | Manual review |
| **Amplification precision** | N/A | 80%+ of surfaced connections are genuinely relevant | Manual review of 10 amplification suggestions |
| **Test count** | 155+ (Phase 2) | 185+ tests, all passing | `pnpm test` (TypeScript), `go test` (Go daemon) |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **satori rendering limitations** | Medium | Medium — card may not look exactly as designed | satori supports a subset of CSS. Design within supported features. Fallback: use simpler layout |
| **Shell hook compatibility** | Medium | Medium — may not work on all shell configurations | Support zsh (primary) and bash. Test with oh-my-zsh, prezto, starship. Provide manual installation instructions for edge cases |
| **Terminal capture privacy** | Medium | High — commands may contain sensitive data | Only capture command string and exit code. Do NOT capture command output. Document what is captured. Allow per-command opt-out (`# unfade:ignore`) |
| **Socket message loss** | Low | Low — non-critical data | Fire-and-forget via `nc -U` to Go daemon (`unfaded`). Lost terminal events are acceptable — git and AI sessions are the primary sources |
| **Amplification false positives** | Medium | Medium — erodes trust in amplification | Start conservative: high-confidence connections only (same domain, similar keywords). Add "not helpful" feedback in Phase 4 |
| **Card OG rendering on platforms** | Low | Low — cosmetic | Test OG rendering on X, LinkedIn, Slack. Ensure meta tags are correct |

---

> **Next phase:** [Phase 4: Reasoning Personalization & Amplification](./PHASE_4_PERSONALIZATION_AND_AMPLIFICATION.md) — Full personalization engine, reasoning profile (web UI `/profile`), amplification v1, similar-decision search (web UI `/search`).

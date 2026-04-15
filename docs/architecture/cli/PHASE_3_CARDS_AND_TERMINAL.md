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
> **Last updated:** 2026-04-14

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan](#6-implementation-plan)
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

---

## 5b. Execution Guide (Day 3: Viral Artifacts — Cards & Terminal Capture)

> **Sourced from:** Master Execution Blueprint — consolidated tasks with acid tests, strict contracts, and agent directives for AI-agent-driven execution.

### Acid Test

```
# Card test
curl -X POST http://localhost:7654/cards/generate -d '{"date":"2026-04-15"}' > card.png
file card.png              → PNG image data, 1200 x 630

# Terminal capture test
echo "test" && sleep 2     → terminal event appears in .unfade/events/ JSONL
npm test && npm test        → retry pattern detected in next distill

# Share test
# Upload card.png to X — OG preview renders correctly at 1200x630
```

### Strict Contracts

**Card data extraction (distill → card):**

```
CardData {
  date: string               // YYYY-MM-DD
  decisions: string[]         // Top 3 decision one-liners (max 80 chars each)
  domains: string[]           // Top 3 domain tags
  reasoning_depth: number     // avg alternatives per decision
  dead_ends: number
  decision_count: number
  ai_modified_pct: number     // % of decisions involving AI modification
}
```

**Card rendering pipeline:**
```
CardData → JSX template (React component) → satori (JSX → SVG) → resvg-js (SVG → PNG)
```

- Dimensions: 1200x630 (OG-compatible)
- Theme: dark background, monospace font, developer-native aesthetic
- Accent color: derived from primary domain (e.g., auth → blue, database → green)

**Debugging session detection rules (in Go daemon):**
```
A debugging session is detected when:
  1. 3+ commands within a 10-minute window
  2. Commands are "related" (any of: same base binary, same target file, same cwd)
  3. At least one command has non-zero exit code

Related commands heuristic:
  - Same base binary: first token matches (e.g., npm, cargo, python)
  - Same target file: argument contains a path-like token (contains / or . with known extension)
  - Same cwd + time proximity: same working directory within 10-minute window
```

### Consolidated Tasks (4) with Agent Directives

#### Task 3.1: Card Rendering Pipeline

Build the end-to-end card generation: extract data from distills, render via satori + resvg-js, produce PNG.

**Agent directive:** "Build `src/services/card/generator.ts` — extracts CardData from a distill markdown file (parse sections: DECISIONS, TRADE-OFFS, DEAD ENDS). Build `src/services/card/templates.tsx` — React JSX component for satori: dark theme card at 1200x630 with the Unfade branding, decision list, domain tags, reasoning depth bar, stats footer. Build the pipeline: `generateCard(date: string): Promise<Buffer>` — reads distill, extracts data, renders JSX via satori to SVG, converts via resvg-js to PNG, writes to `.unfade/cards/YYYY-MM-DD.png`. Register `POST /cards/generate` route in `src/server/routes/cards.ts`."

#### Task 3.2: Terminal Capture Intelligence (Go Daemon)

Add debugging session detection to the Go daemon's TerminalReceiver. The basic socket listener from Phase 1 already receives and stores terminal events — this task adds pattern detection.

**Agent directive:** "Extend the Go daemon's TerminalReceiver in `daemon/internal/capture/terminal.go`. Add `patterns/debugging.go` — a stateful detector that buffers the last 10 minutes of terminal events per repo (keyed by cwd). When a new event arrives: check if 3+ related commands exist in the buffer with at least one non-zero exit code. If yes, emit a synthetic CaptureEvent with type 'debugging_session' that includes: commands involved, total duration, exit codes, eventual resolution (the last successful command). The related-commands heuristic: extract base binary (first token of cmd) and target files (scan args for path-like tokens). Keep the detector simple — false positives are harmless, false negatives lose signal."

#### Task 3.3: Web UI /cards + TUI Integration

Card preview page in the web UI and TUI quick action `[c]` for card generation.

**Agent directive:** "Build `src/server/pages/cards.ts` — GET /cards renders an HTML page with: date picker, 'Generate Card' button (`hx-post='/cards/generate'`), card preview (img tag showing latest card), download link. The POST handler generates the card and returns an HTML fragment with the updated preview image. Update `src/tui/dashboard.tsx` — wire the `[c]` quick action to call `POST /cards/generate` via HTTP (read port from server.json), then display 'Card generated: .unfade/cards/YYYY-MM-DD.png'."

#### Task 3.4: `unfade export` Command

Archive `.unfade/` data as a portable `.tar.gz`, excluding ephemeral state.

**Agent directive:** "Build `src/commands/export.ts` — `unfade export [--output path]`. Creates a `.tar.gz` archive of the `.unfade/` directory. EXCLUDE: `state/daemon.sock`, `state/daemon.pid`, `state/health.json`, `state/server.json`, `state/init_progress.json`, `bin/` directory. INCLUDE: `events/`, `distills/`, `graph/`, `profile/`, `amplification/`, `cards/`, `config.json`. Default output: `./unfade-export-YYYY-MM-DD.tar.gz`. Use Node.js `tar` package (or `zlib` + `tar-stream`)."

## 6. Implementation Plan

### Sprint 6: Unfade Cards & Terminal Capture

> **Goal:** Shareable card generation from distills. Terminal command capture via shell hooks. Debugging session detection enriches distills.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-058** | Card generator: parse Daily Distill Markdown → extract top decisions (max 3), domain tags, reasoning depth score (avg alternatives), dead ends count, AI modification rate | `src/services/card/generator.ts` | [ ] |
| **UF-059** | Card templates: JSX template for satori rendering — dark theme, Unfade branding, decision list, domain tags, reasoning depth bar, stats footer | `src/services/card/templates.ts` | [ ] |
| **UF-060** | Card rendering pipeline: satori (JSX → SVG) → resvg-js (SVG → PNG). Output to `.unfade/cards/YYYY-MM-DD.png` | `src/services/card/generator.ts` | [ ] |
| **UF-061** | Card web UI page and API: GET `/cards` page (preview, generate for any date, download PNG). POST `/cards/generate` API endpoint (used by web UI and TUI quick action `[c]`). Supports today's card, specific date, download as PNG | `src/server/pages/cards.ts`, `src/server/routes/cards.ts` | [ ] |
| **UF-062** | Terminal capture in Go daemon: receive command events via Unix socket (macOS/Linux) or named pipe (Windows) from shell hooks, parse into CaptureEvents | `daemon/capture/terminal.go` | [ ] |
| **UF-063** | Shell hook installer: called from `unfade init` — detect shell (zsh/bash/PowerShell), generate appropriate hook code, append to shell config, verify installation. Web UI `/settings` page shows hook status and provides reinstall option | `src/services/shell/installer.ts` | [ ] |
| **UF-064** | Debugging session detection in Go daemon: analyze terminal events for retry patterns — same base command with different args within 10-minute window → mark as debugging session with duration and attempt count | `daemon/capture/patterns/debugging.go` | [ ] |
| **UF-065** | `unfade export` command: create `.tar.gz` archive of entire `.unfade/` directory, exclude `state/daemon.sock`, include manifest with date range and event counts | `src/commands/export.ts` | [ ] |
| **UF-066** | Amplifier v1: cross-temporal connection detection — when generating distill, compare today's decisions against past distills. If similar decision found, surface it: "You evaluated Redis vs Memcached today. On [date], you made a similar evaluation and chose Memcached" | `src/services/distill/amplifier.ts` | [ ] |
| **UF-067** | Amplify tool: `unfade_amplify` MCP tool and HTTP endpoint — proactive insight surfacing from reasoning history connections | `src/tools/unfade-amplify.ts` | [ ] |
| **UF-068** | Similar tool: `unfade_similar` MCP tool — find analogous past decisions for a given problem description | `src/tools/unfade-similar.ts` | [ ] |
| **UF-069** | Similar search web UI page: GET `/search` page for similar-decision search — search by problem description, view analogous past decisions. Replaces standalone `unfade similar` CLI command | `src/server/pages/search.ts` | [ ] |

### Tests

| Test | What It Validates | File |
|---|---|---|
| **T-128** | Card generator: parses distill and extracts top 3 decisions | `test/services/card/generator.test.ts` |
| **T-129** | Card generator: extracts domain tags from decisions | `test/services/card/generator.test.ts` |
| **T-130** | Card generator: calculates reasoning depth score | `test/services/card/generator.test.ts` |
| **T-131** | Card generator: handles distill with no decisions gracefully | `test/services/card/generator.test.ts` |
| **T-132** | Card rendering: produces valid PNG file | `test/services/card/generator.test.ts` |
| **T-133** | Card rendering: PNG dimensions are OG-compatible (1200x630) | `test/services/card/generator.test.ts` |
| **T-134** | Card template: renders with all data fields populated | `test/services/card/templates.test.ts` |
| **T-135** | Card template: renders with minimal data (no dead ends) | `test/services/card/templates.test.ts` |
| **T-136** | Go daemon terminal capture: receives command event via Unix socket | `daemon/capture/terminal_test.go` |
| **T-137** | Go daemon terminal capture: parses command with exit code | `daemon/capture/terminal_test.go` |
| **T-138** | Go daemon terminal capture: detects error event (non-zero exit) | `daemon/capture/terminal_test.go` |
| **T-139** | Go daemon terminal capture: detects retry pattern (same command, different args) | `daemon/capture/patterns/debugging_test.go` |
| **T-140** | Go daemon terminal capture: detects debugging session (3+ retries in 10 min) | `daemon/capture/patterns/debugging_test.go` |
| **T-141** | Go daemon terminal capture: handles socket unavailable gracefully | `daemon/capture/terminal_test.go` |
| **T-142** | Shell hook installer (called from `unfade init`): detects zsh and generates correct hook | `test/services/shell/installer.test.ts` |
| **T-143** | Shell hook installer (called from `unfade init`): detects bash and generates correct hook | `test/services/shell/installer.test.ts` |
| **T-144** | Shell hook installer (called from `unfade init`): does not duplicate if already installed | `test/services/shell/installer.test.ts` |
| **T-145** | Web UI `/cards` page: renders card preview for today's distill | `test/server/pages/cards.test.ts` |
| **T-146** | Card generation API `POST /cards/generate`: generates PNG for specific date | `test/server/routes/cards.test.ts` |
| **T-147** | Card generation API `POST /cards/generate`: handles missing distill with helpful error | `test/server/routes/cards.test.ts` |
| **T-148** | `unfade export`: creates .tar.gz archive | `test/commands/export.test.ts` |
| **T-149** | `unfade export`: excludes daemon socket file | `test/commands/export.test.ts` |
| **T-150** | Amplifier: detects similar past decision by keyword overlap | `test/services/distill/amplifier.test.ts` |
| **T-151** | Amplifier: surfaces connection with date and context | `test/services/distill/amplifier.test.ts` |
| **T-152** | Amplifier: no false positives on unrelated decisions | `test/services/distill/amplifier.test.ts` |
| **T-153** | Similar MCP tool + web UI `/search` page: finds analogous decision from history | `test/tools/unfade-similar.test.ts`, `test/server/pages/search.test.ts` |
| **T-154** | Similar MCP tool: returns empty for novel decisions | `test/tools/unfade-similar.test.ts` |
| **T-155** | Web UI `/search` page: renders search interface and displays results | `test/server/pages/search.test.ts` |
| **T-156** | Web UI `/cards` page: supports date picker for generating cards for any date | `test/server/pages/cards.test.ts` |
| **T-157** | Web UI `/cards` page: provides PNG download link after generation | `test/server/pages/cards.test.ts` |

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
| **Test count** | 127 (Phase 2) | 157+ tests, all passing | `pnpm test` (TypeScript), `go test` (Go daemon) |

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

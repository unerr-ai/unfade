# MASTER UAT & TESTING PLAN — Unfade CLI

> **Status:** DEFINITIVE BLUEPRINT
>
> **Framework:** RRVV (Research → Reason → Validate → Verify)
>
> **Scope:** Every user-facing feature, implicit system behavior, state transition, graceful degradation path, and recovery flow across all 5 phases of Unfade.
>
> **Last updated:** 2026-04-16
>
> **Principle:** If it's not tested here, it doesn't ship. If a user can trigger it, it has a test case.

---

## Table of Contents

- [State Matrix Reference](#state-matrix-reference)
- [Epic 1: Zero-Knowledge Onboarding](#epic-1-zero-knowledge-onboarding)
- [Epic 2: Daily Ritual & TUI Dashboard](#epic-2-daily-ritual--tui-dashboard)
- [Epic 3: Web UI Experience](#epic-3-web-ui-experience)
- [Epic 4: AI Agent MCP Integration](#epic-4-ai-agent-mcp-integration)
- [Epic 5: Background Capture Engine](#epic-5-background-capture-engine)
- [Epic 6: Distillation Pipeline](#epic-6-distillation-pipeline)
- [Epic 7: Personalization & Amplification](#epic-7-personalization--amplification)
- [Epic 8: Cards & Thinking Graph](#epic-8-cards--thinking-graph)
- [Epic 9: Self-Healing & Edge Cases](#epic-9-self-healing--edge-cases)
- [Epic 10: Ecosystem & Launch Readiness](#epic-10-ecosystem--launch-readiness)

---

## State Matrix Reference

Every test case references one of these system states. The self-healing state detector (`src/state/detector.ts`) must correctly identify each.

| State ID | State Name | Conditions | Expected Behavior |
|---|---|---|---|
| S1 | `not_initialized` | No `.unfade/` directory | Bare `unfade` triggers full init flow |
| S2 | `initialized` | `.unfade/` exists, daemon binary present | Daemon can be started |
| S3 | `daemon_running` | `.unfade/` + daemon PID active + health.json OK | Full capture active |
| S4 | `daemon_stopped` | `.unfade/` + daemon PID stale or missing | Self-healing restarts daemon |
| S5 | `no_llm` | `.unfade/` + daemon running + no Ollama + no API key | Distills use structured fallback (no synthesis) |
| S6 | `no_git` | `.unfade/` + not inside a git repo | Git capture disabled, other sources active |
| S7 | `first_distill_pending` | `.unfade/` + daemon running + zero distills exist | First backfill+distill in progress or needed |
| S8 | `ready` | `.unfade/` + daemon running + ≥1 distill + LLM configured | Full functionality |

---

## Epic 1: Zero-Knowledge Onboarding

> **Principle:** `npx unfade` is the ONLY command a user needs to know. First run IS the init. No separate `unfade init` for general users.

### 1.1 First Run — Fresh Machine

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E1-001 | First run triggers init | S1: No `.unfade/` | `npx unfade` | Welcome box → progress: "Setting up..." → checkmarks for each step → "Unfade is running. Your first distill arrives at 6:00 PM." → "Open your dashboard: unfade (terminal) / unfade open (browser)" | `.unfade/` created with `config.json`, `events/`, `distills/`, `profile/`, `state/`, `graph/`, `cards/`; daemon binary in `.unfade/bin/`; daemon PID in `state/daemon.pid` |
| E1-002 | Shell hooks installed silently | S1 | `npx unfade` (first run) | Checkmark: "✓ Installed shell hooks (zsh)" | `~/.zshrc` contains `unfade_preexec` and `unfade_precmd` functions; hooks registered via `add-zsh-hook` |
| E1-003 | Platform auto-start registered | S1, macOS | `npx unfade` (first run) | Checkmark: "✓ Registered auto-start (launchd)" | launchd plist at `~/Library/LaunchAgents/` with `KeepAlive: true` |
| E1-004 | Platform auto-start — Linux | S1, Linux | `npx unfade` (first run) | Checkmark: "✓ Registered auto-start (systemd)" | systemd user unit with `Restart=always` |
| E1-005 | Daemon binary download | S1 | `npx unfade` (first run) | Checkmark: "✓ Downloaded capture engine (12MB)" | Platform-specific Go binary in `.unfade/bin/unfaded`; binary is executable |
| E1-006 | Git backfill on first run | S1, inside git repo with history | `npx unfade` (first run) | Checkmark: "✓ Backfilling 30 days of git history..." | `.unfade/events/` contains JSONL files for days with git activity |
| E1-007 | Immediate first distill from backfill | S1, git repo with ≥1 commit | `npx unfade` (first run) | TUI dashboard appears with first distill content (decisions, trade-offs) | `.unfade/distills/` contains at least one markdown file; `.unfade/profile/reasoning_model.json` seeded |
| E1-008 | No LLM prompt during init | S1, no Ollama installed | `npx unfade` (first run) | Init completes WITHOUT asking for API key or LLM config | `config.json` has `llm.provider: null` or fallback; distill uses structured summary |
| E1-009 | `.git/info/exclude` updated | S1, inside git repo | `npx unfade` (first run) | No visible output about gitignore | `.git/info/exclude` contains `.unfade/` line |
| E1-010 | Non-git directory handling | S1, NOT inside git repo | `npx unfade` | Init completes; warning about no git repo | `.unfade/` created; git capture disabled in config; daemon running with AI + terminal sources only |
| E1-011 | Daemon started during init | S1 | `npx unfade` (first run) | Checkmark: "✓ Started capture engine" | `daemon.pid` exists and process is alive; `health.json` shows healthy |
| E1-012 | MCP connection hint shown | S1 | `npx unfade` (first run) | "Tip: Your AI tools can connect via MCP — see unfade open → Settings" | No system state change (informational) |

### 1.2 First Run — Edge Cases

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E1-020 | Binary download fails (network error) | S1, no internet | `npx unfade` | Error with hint: "Could not download capture engine. Check your internet connection and retry with `unfade init --force`" | `.unfade/` partially created; no daemon binary; `process.exitCode = 1` |
| E1-021 | Insufficient disk space | S1, <50MB free | `npx unfade` | Error: "Not enough disk space to install Unfade" | No `.unfade/` created |
| E1-022 | Permission denied on `.unfade/` | S1, read-only directory | `npx unfade` | Error with hint about permissions | No state change; exit code 1 |
| E1-023 | Port 7654 already in use | S1, port occupied | `npx unfade` | Server starts on fallback port (7655–7660); output reflects actual port | `config.json` reflects bound port; server accessible on fallback port |
| E1-024 | Existing `.unfade/` from older version | `.unfade/` exists with `config.json` version 1 | `npx unfade` | Config migrated silently; TUI dashboard appears | `config.json` updated to version 2; `.unfade/config.backup.json` created |
| E1-025 | Corrupt `config.json` | `.unfade/` exists, `config.json` is invalid JSON | `npx unfade` | Warning about corrupt config; re-creates with defaults | `config.json` recreated; backup of corrupt file preserved |
| E1-026 | `unfade init` explicit command | S1 | `unfade init` | Same behavior as bare `unfade` on first run | Same as E1-001 |
| E1-027 | `unfade init --force` re-initialization | S8 (fully working) | `unfade init --force` | Re-downloads binary, re-installs hooks, re-registers auto-start; preserves `.unfade/events/` and `.unfade/distills/` | All infrastructure re-provisioned; data preserved |
| E1-028 | `unfade init --global` | S1, wants global storage | `unfade init --global` | Init creates data at `$HOME/.unfade/projects/<repo-hash>/` | No local `.unfade/`; global path used for all data |

---

## Epic 2: Daily Ritual & TUI Dashboard

> **Principle:** Bare `unfade` is the single entry point for daily use. The TUI covers every common action. A user who only ever types `unfade` and uses quick actions will never need another command.

### 2.1 TUI Dashboard — Display

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E2-001 | TUI launches on bare command | S8 (ready) | `unfade` | TUI dashboard renders: header "UNFADE", capture status "● Capturing", today's event count, decision count, latest distill bullet points, reasoning profile summary, quick actions bar | No state change |
| E2-002 | Capture status — running | S3 (daemon running) | `unfade` | Green indicator: "● Capturing" | No state change |
| E2-003 | Capture status — stopped | S4 (daemon stopped) | `unfade` | Warning: "⚠ Capture engine stopped. Restarting..." then "● Capturing" | Daemon restarted silently (self-healing) |
| E2-004 | Today's distill shown | S8 + today's distill exists | `unfade` | Latest distill bullet points (top 3 decisions) displayed in dashboard body | No state change |
| E2-005 | No distill yet today | S8 + no distill for today | `unfade` | Dashboard shows yesterday's distill or "No distills yet. Your first arrives at 6:00 PM." | No state change |
| E2-006 | Reasoning profile summary | S8 + `reasoning_model.json` exists with ≥10 data points | `unfade` | "Reasoning Profile: 3.2 alt/decision │ 60% AI modified" and "Top domains: backend, databases, auth" | No state change |
| E2-007 | No profile yet (first day) | S7 (first distill pending) | `unfade` | Profile section shows "Building your reasoning profile..." or placeholder | No state change |
| E2-008 | Quick actions bar rendered | S8 | `unfade` | Bottom bar: `[d] Distill now [c] Generate card [o] Open browser [s] Search [p] Profile [e] Export [q] Quit` | No state change |

### 2.2 TUI Dashboard — Quick Actions

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E2-010 | [d] Distill now | S8, TUI open | Press `d` | Progress indicator → "Distilling..." → distill content refreshes in dashboard | New distill written to `.unfade/distills/YYYY-MM-DD.md`; profile updated |
| E2-011 | [d] Distill with no events today | S8, TUI open, zero events today | Press `d` | Message: "No events captured today. Nothing to distill." | No new distill created |
| E2-012 | [c] Generate card | S8, TUI open, today's distill exists | Press `c` | Progress → "Card generated!" → shows file path `.unfade/cards/YYYY-MM-DD.png` | PNG file created at `.unfade/cards/YYYY-MM-DD.png` (1200x630) |
| E2-013 | [c] Generate card — no distill | S8, TUI open, no distill exists | Press `c` | Message: "No distill available. Run [d] first." | No card created |
| E2-014 | [o] Open browser | S8, TUI open | Press `o` | Default browser opens `http://localhost:7654` | No state change (browser opens) |
| E2-015 | [s] Search | S8, TUI open | Press `s` | Inline search prompt appears: "Search reasoning: ▌" | No state change |
| E2-016 | [s] Search — query | S8, TUI open | Press `s` → type "caching" → Enter | Search results displayed inline (matching events/distill excerpts) | No state change |
| E2-017 | [p] Profile | S8, TUI open, profile exists | Press `p` | Inline profile summary: decision style, domain distribution, patterns, temporal patterns | No state change |
| E2-018 | [e] Export | S8, TUI open | Press `e` | Confirmation prompt → export progress → "Exported to .unfade/export/unfade-YYYY-MM-DD.tar.gz" | `.tar.gz` archive created containing all `.unfade/` data (excluding `state/`) |
| E2-019 | [q] Quit | S8, TUI open | Press `q` | TUI exits cleanly; returns to shell prompt | Daemon continues running in background |

### 2.3 CLI Commands — Direct Invocation

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E2-030 | `unfade distill` manual trigger | S8 | `unfade distill` | "Distilling today's reasoning..." → distill summary printed to stderr | `.unfade/distills/YYYY-MM-DD.md` created or overwritten (idempotent) |
| E2-031 | `unfade distill --backfill 7` | S8, git history for past 7 days | `unfade distill --backfill 7` | Progress for each day → "Backfilled 7 days" | 7 distill files created; 10s throttle between each |
| E2-032 | `unfade distill --json` | S8 | `unfade distill --json` | JSON output to stdout: `{ data: { distill: ... }, _meta: { tool, durationMs, ... } }` | Same as E2-030 |
| E2-033 | `unfade query "caching"` | S8, events/distills mentioning caching | `unfade query "caching"` | Matching events and distill excerpts printed to stderr | No state change |
| E2-034 | `unfade query --from --to --limit` | S8 | `unfade query "auth" --from 2026-04-01 --to 2026-04-14 --limit 5` | Up to 5 results within date range | No state change |
| E2-035 | `unfade query --json` | S8 | `unfade query "caching" --json` | JSON to stdout with `_meta` envelope | No state change |
| E2-036 | `unfade open` | S8, HTTP server running | `unfade open` | Default browser opens `http://localhost:7654` | No state change |
| E2-037 | `unfade export` | S8 | `unfade export` | Progress → file path of `.tar.gz` archive | Archive created |
| E2-038 | `unfade export --json` | S8 | `unfade export --json` | JSON to stdout: `{ data: { path: "..." }, _meta: {...} }` | Archive created |
| E2-039 | `unfade daemon stop` (power user) | S3 | `unfade daemon stop` | "Capture engine stopped." | Daemon process killed; PID file removed; auto-start NOT unregistered |
| E2-040 | `unfade publish` | S8, ≥7 days of distills | `unfade publish` | "Thinking Graph generated at .unfade/site/index.html" | `.unfade/site/` created with `index.html`, `style.css`, `data.json`, `assets/og-card.png` |
| E2-041 | `unfade --help` | Any state | `unfade --help` | Shows core commands (no hidden commands like `mcp` or `daemon`) | No state change |
| E2-042 | `unfade --version` | Any state | `unfade --version` | Prints version from `package.json` | No state change |
| E2-043 | Unknown command | Any state | `unfade foobar` | "Unknown command: foobar. Run `unfade --help` for available commands." | `process.exitCode = 1` |

---

## Epic 3: Web UI Experience

> **Principle:** The web UI is the primary daily visual interface. htmx + Hono, no JS build step. Server-rendered HTML with dynamic interactivity.

### 3.1 Dashboard Page (`/`)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E3-001 | Dashboard loads | S8, server running | Navigate to `localhost:7654/` | HTML page: activity feed, recent distill summary, quick stats (events today, decisions, domains) | No state change |
| E3-002 | Activity feed shows today's events | S8, events captured today | Load `/` | Activity feed lists recent events with timestamps, types, summaries | No state change |
| E3-003 | Recent distill inline | S8, today's distill exists | Load `/` | Latest distill decisions shown as bullet points | No state change |
| E3-004 | Dashboard with no data (day 1) | S7 (first distill pending) | Load `/` | Empty state: "Unfade is capturing your reasoning. Check back after your first distill." | No state change |
| E3-005 | Dashboard navigation | S8 | Click nav links | Navigation to `/distill`, `/profile`, `/cards`, `/search`, `/settings` works (htmx partial updates) | No state change |

### 3.2 Distill Viewer Page (`/distill`)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E3-010 | Distill list | S8, ≥3 distills | Navigate to `/distill` | List of distills by date (newest first); each shows date + summary | No state change |
| E3-011 | Distill full view | S8 | Click a distill date | Full markdown distill rendered: Decisions, Trade-offs, Dead Ends, Breakthroughs, Patterns | No state change |
| E3-012 | Re-generate distill button | S8, viewing a distill | Click "Re-generate" button | `hx-post="/unfade/distill"` fires → progress indicator → distill content refreshes | Distill file overwritten with new synthesis |
| E3-013 | Distill viewer — no distills | S7 | Navigate to `/distill` | Empty state with explanation and "Distill now" button | No state change |

### 3.3 Profile Page (`/profile`)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E3-020 | Profile visualization | S8, profile with ≥10 data points | Navigate to `/profile` | Displays: decision style stats, domain distribution bar chart, trade-off preferences, detected patterns, temporal patterns | No state change |
| E3-021 | Profile — insufficient data | S8, profile with <10 data points | Navigate to `/profile` | "Building your reasoning profile... Unfade needs more data to detect patterns." with progress indicator | No state change |

### 3.4 Cards Page (`/cards`)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E3-030 | Card preview | S8, today's distill exists | Navigate to `/cards` | Card preview rendered for today's date (or latest available) | No state change |
| E3-031 | Generate card for specific date | S8, distill exists for selected date | Select date → click "Generate" | Card generated → PNG preview shown → download link available | `.unfade/cards/YYYY-MM-DD.png` created |
| E3-032 | Download card PNG | S8, card exists | Click "Download" on card | Browser downloads PNG file (1200x630) | No state change |
| E3-033 | Card page — no distills | S7 | Navigate to `/cards` | Empty state: "Generate your first distill to create a card." | No state change |

### 3.5 Search Page (`/search`)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E3-040 | Search input | S8 | Navigate to `/search` | Search input field with placeholder "Search your reasoning history..." | No state change |
| E3-041 | Search results | S8, data exists | Type query → submit | Results displayed with highlighting, date, context excerpt; htmx partial update | No state change |
| E3-042 | Similar decision search | S8 | Enter problem description in "Find similar decisions" | Past decisions matching the problem ranked by relevance with personalization weighting | No state change |
| E3-043 | No results | S8 | Search for non-existent term | "No results found for 'xyz'. Try broader terms." | No state change |

### 3.6 Settings Page (`/settings`)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E3-050 | Settings page loads | S8 | Navigate to `/settings` | Sections: Capture Engine status + toggle, LLM Configuration, Capture Sources, Distillation Schedule, MCP Connection snippets | No state change |
| E3-051 | Pause/resume capture toggle | S8 | Click "Pause capture" | Status changes to paused; capture engine still running but not writing events | `config.json` updated; daemon enters idle mode |
| E3-052 | LLM provider configuration | S5 (no LLM) | Enter Ollama URL or OpenAI API key → Save | "LLM configured. Next distill will use AI synthesis." | `config.json` updated with provider + model; next distill uses LLM |
| E3-053 | Change distillation schedule | S8 | Change time to "20:00" → Save | "Schedule updated. Next distill at 8:00 PM." | `config.json` distillation.schedule updated |
| E3-054 | MCP config snippets | S8 | View "Connect AI Tools" section | Copy-paste JSON configs for: Claude Code (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`), Windsurf | No state change |
| E3-055 | Reinstall shell hooks | S8, hooks missing | Click "Reinstall shell hooks" in settings | "Shell hooks reinstalled for zsh." | `~/.zshrc` updated with hook functions |
| E3-056 | Capture source toggles | S8 | Toggle "Terminal capture" off → Save | "Terminal capture disabled." | `config.json` capture.terminal = false; daemon stops terminal event listener |

---

## Epic 4: AI Agent MCP Integration

> **Principle:** One MCP server serves every MCP-compatible tool. Stdout is sacred — only JSON-RPC. Degraded mode returns `degraded: true` with reason.

### 4.1 MCP Resources (Read-Only)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E4-001 | `unfade://context/recent` | S8, events in last 2 hours | Agent reads resource | JSON: recent events with summaries, structured by type | No state change |
| E4-002 | `unfade://context/today` | S8, events today + distill | Agent reads resource | JSON: all today's events + distill content | No state change |
| E4-003 | `unfade://profile` | S8, profile exists | Agent reads resource | JSON: ReasoningModelV2 (decision style, domains, patterns) | No state change |
| E4-004 | `unfade://decisions/recent` | S8, decisions in graph | Agent reads resource | JSON: recent decisions with alternatives, trade-offs | No state change |
| E4-005 | `unfade://distill/latest` | S8, ≥1 distill | Agent reads resource | Full markdown of most recent distill | No state change |
| E4-006 | Resource — no data yet | S7 (first distill pending) | Agent reads `unfade://distill/latest` | Response with `degraded: true`, `degradedReason: "no_distills"` | No state change |
| E4-007 | Resource — not initialized | S1 | Agent reads any resource | Response with `degraded: true`, `degradedReason: "not_initialized"`, setup instructions | No state change |

### 4.2 MCP Tools (Executable Queries)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E4-010 | `unfade_query` — basic search | S8, data exists | `{ query: "caching", limit: 10 }` | `ToolResponse` envelope: matching events + distill excerpts, `_meta.tool: "unfade_query"`, `_meta.durationMs` | No state change |
| E4-011 | `unfade_query` — date range | S8 | `{ query: "auth", dateRange: { from: "2026-04-01", to: "2026-04-14" } }` | Filtered results within date range | No state change |
| E4-012 | `unfade_query` — no results | S8 | `{ query: "nonexistent" }` | Empty data array, `_meta` present | No state change |
| E4-013 | `unfade_distill` — trigger | S8, events today | `{ date: "2026-04-16" }` | Generated distill content in response | New distill file written |
| E4-014 | `unfade_profile` | S8, profile exists | `{}` | Full ReasoningModelV2 in response envelope | No state change |
| E4-015 | `unfade_context` — scopes | S8 | `{ scope: "last_2h" }` → `{ scope: "today" }` → `{ scope: "this_week" }` | Appropriately scoped event summaries for each | No state change |
| E4-016 | `unfade_decisions` — by domain | S8 | `{ domain: "backend", limit: 5 }` | Up to 5 backend-domain decisions | No state change |
| E4-017 | `unfade_similar` — find similar | S8 | `{ description: "Choosing between Redis and Memcached" }` | Ranked list of similar past decisions with relevance scores | No state change |
| E4-018 | `unfade_amplify` — cross-temporal | S8, amplification data exists | `{}` | Cross-temporal connections and insights | No state change |
| E4-019 | Tool — not initialized | S1 | Any tool call | `{ data: null, _meta: { degraded: true, degradedReason: "not_initialized" } }` | No state change |

### 4.3 MCP Prompts (Reasoning Frameworks)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E4-030 | `unfade_code_review` prompt | S8, profile + recent context | Agent requests prompt with `{ diff: "..." }` | Prompt text referencing developer's reasoning patterns, past decisions in related files, trade-off preferences | No state change |
| E4-031 | `unfade_architecture` prompt | S8 | `{ question: "Should we use Redis or Memcached?" }` | Prompt referencing past architecture decisions, domain expertise, known trade-off preferences | No state change |
| E4-032 | `unfade_debug` prompt | S8 | `{ error: "ECONNREFUSED", context: "Redis client" }` | Prompt referencing past debugging sessions, dead ends explored, exploration patterns | No state change |
| E4-033 | Prompt — insufficient profile | S7, minimal data | Any prompt request | Prompt generated without personalization; `_meta.personalizationLevel: "none"` | No state change |

### 4.4 MCP Transport & Protocol

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E4-040 | Stdio transport — stdout purity | S8 | `unfade mcp` (stdio mode) | ONLY JSON-RPC on stdout; zero non-JSON bytes | All logging on stderr exclusively |
| E4-041 | `unfade mcp` hidden command | S8 | `unfade --help` | `mcp` command NOT listed in help | No state change |
| E4-042 | `unfade mcp` starts server | S8 | `unfade mcp` | MCP server starts on stdio; responds to `initialize` handshake | Server process running |
| E4-043 | MCP server — concurrent requests | S8 | Multiple tool calls in parallel | All return valid responses; no corruption | No state change |
| E4-044 | Response envelope consistency | S8 | Any MCP tool call | Every response has: `{ data: ..., _meta: { tool, durationMs, degraded, degradedReason, personalizationLevel } }` | No state change |

---

## Epic 5: Background Capture Engine

> **Principle:** The capture engine is invisible. <50MB RAM, <1% CPU idle. The word "daemon" never appears in user-facing output.

### 5.1 Daemon Lifecycle

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E5-001 | Daemon starts on init | S1 | `npx unfade` (first run) | "✓ Started capture engine" | `daemon.pid` file with valid PID; process alive; `health.json` shows `{ status: "healthy" }` |
| E5-002 | Daemon single-instance | S3 (daemon running) | Attempt to start second daemon | Second instance exits; no error visible to user | Only one `unfaded` process; PID lock prevents duplicates |
| E5-003 | Daemon auto-start on login | S2 (initialized), system reboot | Reboot / login | No user action needed | Daemon starts via launchd/systemd; PID file created; events captured |
| E5-004 | Daemon graceful shutdown | S3 | `unfade daemon stop` | "Capture engine stopped." | Process exits cleanly; PID file removed; in-flight events flushed to disk |
| E5-005 | Daemon crash recovery | S3, daemon crashes | Platform manager detects crash | No visible output (user unaware) | launchd/systemd restarts daemon within 10 seconds; new PID file |
| E5-006 | Stale PID detection | S4 (PID file exists, process dead) | `unfade` | "⚠ Capture engine stopped. Restarting..." → "● Capturing" | Stale PID file removed; new daemon started; new PID written |
| E5-007 | Resource budget — RAM | S3, daemon running for 24h | Monitor memory | N/A (automated test) | `unfaded` process <50MB RSS |
| E5-008 | Resource budget — CPU | S3, daemon idle | Monitor CPU | N/A (automated test) | `unfaded` process <1% CPU when idle |
| E5-009 | Health check endpoint | S3 | Read `.unfade/state/health.json` | JSON: `{ status: "healthy", pid: N, uptime: N, capturedToday: N }` | No state change |

### 5.2 Git Capture

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E5-020 | Commit event captured | S3, git repo | `git commit -m "fix auth bug"` | No visible output (passive) | New event in `.unfade/events/YYYY-MM-DD.jsonl` with type `commit`, message, files, diff summary, branch |
| E5-021 | Branch switch captured | S3, git repo | `git checkout feature-branch` | No visible output | Event with type `branch-switch`, from/to branches |
| E5-022 | Revert captured | S3 | `git revert HEAD` | No visible output | Event with type `revert`, reverted hash |
| E5-023 | Stash captured | S3 | `git stash` | No visible output | Event with type `stash`, stashed files |
| E5-024 | Merge conflict captured | S3 | Trigger merge conflict | No visible output | Event with type `merge-conflict`, conflicting files, branches |
| E5-025 | Auto-save noise filtered | S3, auto-save enabled in editor | Rapid file saves (IDE auto-save) | No visible output | Events debounced; not every save creates an event |
| E5-026 | Ignore patterns respected | S3, `config.capture.ignorePatterns: ["*.env"]` | Touch `.env` file | No visible output | No event generated for `.env` files |

### 5.3 AI Session Capture

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E5-030 | Cursor session captured | S3, Cursor logs at `~/.cursor/logs/` | Use Cursor AI | No visible output | Events with type `ai-conversation`, `ai-completion`, or `ai-rejection` |
| E5-031 | Claude Code session captured | S3, Claude Code sessions at `~/.claude/` | Use Claude Code | No visible output | AI session events in JSONL |
| E5-032 | AI session paths auto-detected | S1 | `npx unfade` (first run) | Init detects installed AI tools | `config.capture.ai_session_paths` populated with detected paths |
| E5-033 | Missing AI session paths | S3, Cursor not installed | Daemon running | No error; no AI session events | AI session watcher skips missing paths gracefully |

### 5.4 Terminal Capture

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E5-040 | Command captured via preexec | S3, shell hooks installed | Run any terminal command (e.g., `ls -la`) | No visible output; zero latency added to command | Event sent to daemon via Unix socket: `{ cmd, exit, duration }` |
| E5-041 | Exit code captured via precmd | S3, hooks installed | Run failing command (e.g., `false`) | No visible output | Event includes `exit: 1` |
| E5-042 | Debugging session detected | S3 | Run same command 3+ times with variations within 10 min | No visible output | Daemon groups events into "debugging session" metadata |
| E5-043 | Socket not available (daemon down) | S4, hooks installed | Run terminal command | No visible output; no error; no latency | `nc -U ... 2>/dev/null &` fails silently; command runs normally |
| E5-044 | Terminal capture disabled | S3, `config.capture.terminal: false` | Run terminal command | No event | No terminal events written |

### 5.5 Event Storage

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E5-050 | JSONL format correctness | S3, events captured | Read `.unfade/events/YYYY-MM-DD.jsonl` | Each line is valid JSON matching `CaptureEventSchema`: `{ id, timestamp, source, type, content, gitContext? }` | One file per day, append-only |
| E5-051 | Date rollover | S3, events span midnight | Capture events at 23:59 and 00:01 | No visible output | Events land in correct date-named files |
| E5-052 | Concurrent writes safe | S3, git + AI + terminal events simultaneously | Multiple sources fire at once | No visible output | All events appended; no corruption (O_APPEND guarantees) |
| E5-053 | Event file greppable | S3 | `grep "commit" .unfade/events/2026-04-16.jsonl` | Human-readable JSON lines matching grep | No state change |

---

## Epic 6: Distillation Pipeline

> **Principle:** events → signals → context linking → LLM synthesis → profile update → graph update → write markdown → notify. Idempotent. No-LLM fallback is always available.

### 6.1 Scheduled Distillation

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E6-001 | 6 PM default trigger | S8, events today, schedule "18:00" | Clock reaches 18:00 local (±5 min jitter) | System notification: "Your Unfade is ready — 5 decisions, 1 dead end explored" | `.unfade/distills/YYYY-MM-DD.md` written; `reasoning_model.json` updated; `decisions.jsonl` updated; `domains.json` updated |
| E6-002 | Custom schedule | S8, schedule "20:00" | Clock reaches 20:00 | Same notification pattern | Distill generated at configured time |
| E6-003 | Schedule "manual" disables auto | S8, schedule "manual" | Clock passes all hours | No notification; no distill | No auto-distill generated |
| E6-004 | Zero-event day skipped | S8, zero events today | 6 PM arrives | No notification; no empty distill | No `.unfade/distills/YYYY-MM-DD.md` created |
| E6-005 | Jitter prevents exact timing | S8 | Multiple days of distills | N/A (statistical test) | Distill times vary by ±5 minutes; not exactly 18:00 every day |

### 6.2 Manual Distillation

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E6-010 | Manual trigger via CLI | S8, events today | `unfade distill` | "Distilling today's reasoning..." → summary | Distill written |
| E6-011 | Manual trigger via TUI | S8, TUI open | Press `d` | Inline progress → distill refresh | Distill written |
| E6-012 | Manual trigger via Web UI | S8, on `/distill` page | Click "Re-generate" | htmx progress → new content | Distill overwritten |
| E6-013 | Manual trigger via MCP | S8 | `unfade_distill` tool call | Distill content in response | Distill written |
| E6-014 | Manual trigger via HTTP | S8 | `POST /unfade/distill` | JSON response with distill content | Distill written |
| E6-015 | Idempotent re-run | S8, distill already exists for today | `unfade distill` | New distill replaces old one | File overwritten; profile re-updated |

### 6.3 Backfill

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E6-020 | Backfill N days | S8, git history for past 7 days | `unfade distill --backfill 7` | Per-day progress → "Backfilled 7 days" | 7 distill files; 10-second throttle between API calls |
| E6-021 | Backfill skips empty days | S8 | `unfade distill --backfill 30` (some days have no events) | Only days with events are distilled | No empty distill files created |
| E6-022 | Backfill during first init | S1, git history exists | `npx unfade` | Backfill runs as part of init (30 days default) | Backfilled distills available immediately |

### 6.4 No-LLM Fallback

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E6-030 | Structured summary without LLM | S5 (no LLM), events today | `unfade distill` or scheduled trigger | Distill generated with: file change summary, detected decision patterns (no AI synthesis prose) | Distill markdown: structured but no narrative synthesis |
| E6-031 | Structured summary is useful | S5 | Read generated distill | Distill contains: decisions detected (from commit messages/diffs), files changed, domains touched, time invested | No state change |
| E6-032 | LLM failure mid-distill | S8, LLM provider returns error | `unfade distill` | Warning: "AI synthesis unavailable. Using structured summary." → distill still generated | Fallback distill written; no crash |
| E6-033 | Ollama auto-detection | S5, then install Ollama | Next distill trigger | Distill uses Ollama for synthesis (auto-detected) | `config.json` provider updated or Ollama detected at runtime |

### 6.5 Distill Output Structure

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E6-040 | Markdown structure | S8 | Generate distill | Markdown with sections: `# Daily Distill — YYYY-MM-DD`, `## Decisions Made`, `## Trade-offs Navigated`, `## Dead Ends Explored`, `## Breakthroughs`, `## Patterns` | Valid markdown file |
| E6-041 | Personalization section (Phase 4+) | S8, profile with ≥10 data points | Generate distill | Additional section: `## Your Reasoning Profile` with personalized observations | Distill includes personalization |
| E6-042 | Decision alternatives counted | S8, commit with clear alternatives | Generate distill | "Alternatives evaluated: X, Y, Z" per decision | Decision data also in `graph/decisions.jsonl` |
| E6-043 | Profile updated per distill | S8 | Generate distill | No visible profile output (background update) | `reasoning_model.json` updated: averages recalculated, data points incremented |
| E6-044 | Graph updated per distill | S8 | Generate distill | No visible graph output | `decisions.jsonl` has new entries; `domains.json` updated |

### 6.6 Notification

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E6-050 | System notification on distill | S8, distill completes | Scheduled or manual distill | macOS/Linux system notification: "Your Unfade is ready — N decisions, M dead ends" | No state change |
| E6-051 | Notification click opens web UI | S8 | Click notification | Default browser opens `localhost:7654/distill` | No state change |
| E6-052 | No notification on zero-event day | S8, zero events | 6 PM arrives | No notification sent | No state change |
| E6-053 | Notification disabled in config | S8, `notification.enabled: false` | Distill completes | No notification | No state change |

---

## Epic 7: Personalization & Amplification

> **Principle:** Unfade doesn't just summarize your day — it learns how you think. The temporal moat: competitors can't replicate months of reasoning patterns.

### 7.1 Reasoning Profile (ReasoningModelV2)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E7-001 | Profile seeded on first distill | S7, first distill generated | First distill | TUI profile section shows initial metrics | `reasoning_model.json` v2: `version: 2`, initial `decisionStyle`, seed `domainDistribution` |
| E7-002 | Profile accumulates over time | S8, 10+ distills generated | View profile after 10th distill | Profile shows stabilized metrics (e.g., "3.2 avg alternatives") | `dataPoints ≥ 10`; averages converging |
| E7-003 | Decision style tracked | S8, various decisions captured | View profile | `decisionStyle.avgAlternativesEvaluated`, `medianAlternativesEvaluated`, `aiAcceptanceRate`, `aiModificationRate` populated | Values reflect actual behavior |
| E7-004 | Domain distribution tracked | S8, work across multiple domains | View profile | `domainDistribution` array with domain, frequency, percentage, depth, depthTrend | Domains reflect actual coding areas |
| E7-005 | Trade-off preferences detected | S8, ≥5 similar trade-off decisions | View profile | `tradeOffPreferences` entry: e.g., "simplicity over flexibility", confidence > 0.5 | Pattern detected from repeated choices |
| E7-006 | Patterns detected | S8, ≥20 data points | View profile | `patterns` array: e.g., "evaluates 3+ alternatives for infrastructure decisions", confidence, examples count | Patterns above confidence threshold |
| E7-007 | Temporal patterns | S8, 2+ weeks of data | View profile | `temporalPatterns.mostProductiveHours`, `avgDecisionsPerDay` | Derived from timestamp analysis |
| E7-008 | Profile migration v1→v2 | Profile exists as v1 format | Distill or profile read | Profile migrated silently to v2 | `reasoning_model.json` now v2; old data preserved in new schema |

### 7.2 Personalized Context (Context Shaper)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E7-010 | High-exploration dev gets more alternatives | S8, profile shows high exploration depth | MCP `unfade_context` call | Response includes expanded alternatives and trade-off details | No state change |
| E7-011 | High-AI-acceptance dev gets concise context | S8, profile shows high AI acceptance | MCP `unfade_context` call | Response is more concise, focused on recommendations | No state change |
| E7-012 | Domain expert gets deeper context | S8, profile shows deep backend expertise | MCP context for backend code | Backend-related context expanded with history; frontend compressed | No state change |
| E7-013 | Personalization level in `_meta` | S8, profile exists | Any MCP tool response | `_meta.personalizationLevel: "full"` (or `"seed"` or `"none"` based on profile state) | No state change |

### 7.3 Amplification

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E7-020 | Cross-temporal connection detected | S8, similar decision made weeks apart | Distill generation | Distill contains: "You evaluated X today; on [date] you made a similar evaluation in [domain]" | `amplification/connections.jsonl` updated |
| E7-021 | Cross-domain connection detected | S8, pattern connects backend + devops | Distill generation | Distill surfaces cross-domain insight | Connection recorded |
| E7-022 | Blind spot quantification | S8, profile with ≥20 data points, domains never explored | View profile | Profile identifies unexplored domains relative to codebase | `reasoning_model.json` includes blind spot data |
| E7-023 | `unfade_amplify` MCP tool | S8, amplification data exists | Agent calls `unfade_amplify` | Returns cross-temporal and cross-domain insights | No state change |
| E7-024 | Amplification with insufficient data | S8, <5 decisions | Distill generation | No amplification section (graceful omission) | No connections generated |

---

## Epic 8: Cards & Thinking Graph

> **Principle:** The card IS the marketing. The Thinking Graph is the resume. Every share is a demonstration.

### 8.1 Unfade Card Generation

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E8-001 | Card generated from distill | S8, today's distill exists | TUI `[c]`, Web UI generate, or API `POST /cards/generate` | Card preview or file path | `.unfade/cards/YYYY-MM-DD.png` — 1200x630 PNG |
| E8-002 | Card visual content | S8 | View generated card | Card contains: UNFADE header, date, top 3 decisions, domain tags, reasoning depth bar, dead ends count, AI modified %, unfade.dev footer | PNG matches design spec |
| E8-003 | Card for specific date | S8, distill exists for 2026-04-10 | Generate card for 2026-04-10 | Card shows data from April 10 distill | `.unfade/cards/2026-04-10.png` created |
| E8-004 | Card without distill fails gracefully | S8, no distill for requested date | `POST /cards/generate?date=2026-04-20` | Error: "No distill available for 2026-04-20" | No card file created |
| E8-005 | Card rendering pipeline | S8 | Generate card | Pipeline: parse distill → extract CardData → JSX template → satori SVG → resvg-js PNG | Valid PNG file, correct dimensions |
| E8-006 | Card OG-compatible dimensions | S8 | Check generated PNG | Image is exactly 1200x630 pixels | Verified via image metadata |

### 8.2 Thinking Graph (Static Site)

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E8-010 | `unfade publish` generates site | S8, ≥7 days of distills | `unfade publish` | "Thinking Graph generated at .unfade/site/index.html" | `.unfade/site/` with `index.html`, `style.css`, `data.json`, `assets/og-card.png` |
| E8-011 | Decision Density Heatmap | S8, ≥30 days of data | View generated site | SVG heatmap: 52 cols (weeks) × 7 rows (days), intensity = decisions + (trade_offs × 1.5) + (dead_ends × 2), month labels, tooltips | Heatmap data in `data.json` matches formula |
| E8-012 | Domain distribution chart | S8 | View site | Horizontal bar chart showing domain percentages (backend, databases, auth, etc.) | Data sourced from `reasoning_model.json` |
| E8-013 | Reasoning profile card | S8 | View site | Profile card: avg alternatives, AI modified %, dead ends/day, top pattern | Data from profile |
| E8-014 | Recent distills section | S8 | View site | Last 7-30 distills listed with date + summary | Distills parsed from `.unfade/distills/` |
| E8-015 | OG card as social preview | S8 | View site source | `<meta property="og:image" content="assets/og-card.png">` | OG card generated (reuses card generator) |
| E8-016 | Static site — no JavaScript | S8 | View site source | Zero `<script>` tags; pure HTML + CSS + inline SVG | No JS runtime required |
| E8-017 | Site deployable to static host | S8 | Copy `.unfade/site/` to any static host | Site renders correctly | Self-contained single-directory output |
| E8-018 | Dark theme | S8 | View site | Dark background, light text, accent colors for heatmap | CSS uses dark color scheme |
| E8-019 | Heatmap tooltip content | S8 | Hover over heatmap cell (if deploying to browser with JS tooltips) | "Apr 15: 3 decisions, 1 trade-off, 0 dead ends" | Tooltip data in SVG `<title>` elements |
| E8-020 | `unfade publish` with minimal data | S8, only 1 distill | `unfade publish` | Site generated with sparse heatmap; no errors | Handles sparse data gracefully |

### 8.3 Export

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E8-030 | `unfade export` creates archive | S8 | `unfade export` | File path printed: `.unfade/export/unfade-YYYY-MM-DD.tar.gz` | Archive contains: `events/`, `distills/`, `profile/`, `graph/`, `cards/`, `amplification/`, `config.json` |
| E8-031 | Export excludes state directory | S8 | `unfade export` | Archive does NOT contain `state/` (PID, socket, health) | State files excluded |
| E8-032 | Export excludes `bin/` directory | S8 | `unfade export` | Archive does NOT contain `bin/` (daemon binary) | Binary excluded from archive |
| E8-033 | `unfade export --json` | S8 | `unfade export --json` | JSON to stdout: `{ data: { path: "...", size: N }, _meta: {...} }` | Archive created |

---

## Epic 9: Self-Healing & Edge Cases

> **Principle:** Every `unfade` invocation checks and silently fixes issues. The user never needs to troubleshoot. If something is broken, the system repairs it before the user notices.

### 9.1 State Detector

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E9-001 | Detect `not_initialized` | No `.unfade/` | `unfade` | Triggers full init flow (E1-001) | Transitions to S3/S8 |
| E9-002 | Detect `daemon_stopped` | `.unfade/` exists, PID file present, process dead | `unfade` | "⚠ Capture engine stopped. Restarting..." → TUI launches | New daemon started; new PID |
| E9-003 | Detect `daemon_running` | Everything healthy | `unfade` | TUI launches immediately (no warnings) | No state change |
| E9-004 | Detect missing daemon binary | `.unfade/` exists, `bin/unfaded` missing | `unfade` | "Re-downloading capture engine..." → continues | Binary re-downloaded; daemon started |
| E9-005 | Detect missing shell hooks | `.unfade/` exists, hooks not in `.zshrc` | `unfade` | Hooks silently reinstalled | `.zshrc` updated with hooks |
| E9-006 | Detect unregistered auto-start | `.unfade/` exists, no launchd plist | `unfade` | Auto-start silently re-registered | Plist created |
| E9-007 | Detect `no_llm` | `.unfade/` + daemon + no Ollama + no API key | `unfade` | TUI launches normally (no error); distills use structured fallback | System operational in degraded mode |
| E9-008 | Detect `no_git` | `.unfade/` exists, not inside git repo | `unfade` | TUI launches; no git-related events | Git capture disabled; other sources active |
| E9-009 | Multiple issues — combined repair | `.unfade/` exists, daemon dead + hooks missing + no auto-start | `unfade` | "⚠ Capture engine stopped. Restarting..." → all silently fixed → TUI | Daemon restarted + hooks installed + auto-start registered |

### 9.2 Graceful Degradation Matrix

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E9-020 | No LLM + scheduled distill | S5 | 6 PM distill trigger | Structured summary generated; notification: "Your Unfade is ready" (no mention of missing LLM) | Structured distill written |
| E9-021 | No LLM + manual distill | S5 | `unfade distill` | "Distilling..." → structured summary | No error about missing LLM |
| E9-022 | No LLM + MCP context | S5 | Agent queries `unfade_context` | Context returned normally; `_meta.degraded: false` (context doesn't need LLM) | No state change |
| E9-023 | No daemon + CLI query | S4, daemon stopped | `unfade query "auth"` | Query still works (reads files directly) | No state change (direct file read) |
| E9-024 | No daemon + MCP resource | S4 | Agent reads `unfade://context/today` | Response with events (direct file read); `_meta` may include daemon status | No state change |
| E9-025 | Not initialized + MCP tool | S1 | Agent calls `unfade_query` | `{ data: null, _meta: { degraded: true, degradedReason: "not_initialized" } }` with setup hint | No state change |
| E9-026 | No distills + card request | S7 | `POST /cards/generate` or TUI `[c]` | Friendly message: "No distill available. Run a distill first." | No card created |
| E9-027 | Corrupt event file | S3, one JSONL line is invalid JSON | Distill trigger | Corrupt line skipped; rest of file processed; warning logged at debug level | Distill generated from valid events |
| E9-028 | Missing profile file | S3, `reasoning_model.json` deleted | `unfade` or MCP | Profile rebuilt from scratch on next distill; current session shows empty profile | New `reasoning_model.json` created on next distill |
| E9-029 | Disk full during event write | S3, disk full | New git commit captured | Event dropped silently; daemon continues running; log warning at debug level | No new event appended; daemon stable |

### 9.3 Error Handling & User-Facing Messages

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E9-040 | `handleCliError` — ECONNREFUSED | S4, server not running | `unfade query "test"` | Stderr: "Could not connect to Unfade server. Run `unfade` to restart." | `process.exitCode = 1` |
| E9-041 | `handleCliError` — missing `.unfade/` | S1 | `unfade distill` | Stderr: "Unfade not initialized. Run `unfade` to get started." | `process.exitCode = 1` |
| E9-042 | `handleCliError` — permissions | S2, file permission issue | `unfade distill` | Stderr: user-friendly message + permission hint | `process.exitCode = 1` |
| E9-043 | Debug stack trace | Any error | `unfade distill --verbose` | Full stack trace logged at debug level to stderr | `process.exitCode = 1` |
| E9-044 | No "daemon" in user output | Any error state | Any CLI command | Error messages say "capture engine", never "daemon" | Terminology enforced |

### 9.4 IPC Boundary Safety

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E9-050 | Go writes events only | S3 | Daemon operates | No writes to `distills/`, `profile/`, `graph/` by Go process | Only `events/` and `state/` modified by daemon |
| E9-051 | TypeScript writes distills only | S8 | Distill generated | No writes to `events/` by TypeScript process | Only `distills/`, `profile/`, `graph/` modified by TS |
| E9-052 | Concurrent read during write | S3 | TypeScript reads `events/` while Go appends | No corruption; read may miss in-flight append (acceptable) | Eventual consistency within seconds |
| E9-053 | Atomic JSON writes | S8 | Profile update | `reasoning_model.json` written via tmp + rename pattern | No partial JSON visible to concurrent readers |

---

## Epic 10: Ecosystem & Launch Readiness

> **Principle:** A stranger gets value in 5 minutes. The Thinking Graph is beautiful enough for bios and job applications. Polish is the product.

### 10.1 npm Package

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E10-001 | `npx unfade` works on fresh machine | Clean machine with Node.js ≥18 | `npx unfade` | Downloads package → runs init flow → TUI | Full install in single command |
| E10-002 | Package includes platform binaries | npm install | `npm install unfade` | Correct platform Go binary included via optional deps | `unfaded` binary for current platform in package |
| E10-003 | `package.json` bin entry | Published package | `npx unfade` | Resolves to `dist/cli.mjs` with shebang | Executable CLI entry point |
| E10-004 | No postinstall side effects | npm install in CI | `npm install unfade` | No daemon started; no `.unfade/` created on install | Package installs cleanly without side effects |

### 10.2 ClawHub Skill

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E10-010 | SKILL.md valid format | Published skill | OpenClaw validates SKILL.md | Accepted: one-line description, features, setup, MCP tools | Skill discoverable on ClawHub |
| E10-011 | manifest.json valid | Published skill | OpenClaw validates manifest | `name`, `mcp.command`, `mcp.transport`, `tools` array all present | Skill installable |
| E10-012 | Install via SKILL.md instructions | Fresh machine | Follow SKILL.md: `npx unfade` | Full init flow works | Same as E1-001 |
| E10-013 | MCP tools match manifest | S8 | Agent lists available tools from manifest | All 7 tools listed in manifest are actually available | Tool names match |

### 10.3 MCP Registry

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E10-020 | `server.json` valid | Published entry | MCP Registry validates | Valid: `name`, `transport.type: "stdio"`, `capabilities` | Entry discoverable |
| E10-021 | `server.json` transport works | S8 | MCP client uses `server.json` config: `{ command: "npx", args: ["unfade", "mcp"] }` | MCP server starts, responds to initialize | Full MCP handshake succeeds |

### 10.4 Config Migration

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E10-030 | v1 → v2 migration | `config.json` with `version: 1` | Any `unfade` command | Silent migration | `config.json` now `version: 2`; `config.backup.json` created; all v1 fields mapped to v2 |
| E10-031 | Future-proof migration chain | `config.json` with `version: 1`, migrations [1→2, 2→3] exist | `unfade` | Runs 1→2 then 2→3 sequentially | Config at latest version |
| E10-032 | Migration preserves user data | v1 config with custom LLM + schedule | Migration runs | Custom LLM provider, model, schedule all preserved in v2 structure | No data loss |
| E10-033 | Backup before migration | Any version < latest | Migration runs | `.unfade/config.backup.json` is exact copy of pre-migration config | Backup file exists and is valid JSON |

### 10.5 `--json` Output Flag

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E10-040 | `unfade distill --json` | S8 | `unfade distill --json` | stdout: `{ data: { distill: "..." }, _meta: { tool: "distill", durationMs: N } }`; stderr: progress logs | JSON on stdout, logs on stderr |
| E10-041 | `unfade query --json` | S8 | `unfade query "auth" --json` | stdout: JSON with results array + `_meta` | Parseable by `jq` |
| E10-042 | `unfade export --json` | S8 | `unfade export --json` | stdout: JSON with path + `_meta` | Pipeable to scripts |
| E10-043 | `--json` never writes to stderr (for data) | S8 | Any `--json` command | All data on stdout; only logs/progress on stderr | Clean separation |
| E10-044 | `--json` error envelope | Error state | `unfade distill --json` (when error occurs) | stdout: `{ error: { code: "...", message: "..." }, _meta: {...} }` | Structured error on stdout |

### 10.6 E2E Integration Test

| Test ID | Feature / Test Case | Preconditions | Action / Trigger | Expected User Output (CLI/UI) | Expected System State |
|---|---|---|---|---|---|
| E10-050 | Full workflow E2E | Clean temp directory, git repo with history | `npx unfade` → events captured → `unfade distill` → `unfade query "test"` → `unfade card` → `unfade publish` | Each step succeeds | `.unfade/` fully populated: events, distills, profile, graph, cards, site |
| E10-051 | E2E under 5 minutes | Clean machine (simulated) | Time full workflow from `npx unfade` to first distill viewed | Wall-clock < 5 minutes (including binary download) | First value delivered within time budget |
| E10-052 | E2E — MCP round-trip | S8, MCP client connected | init → capture → distill → MCP query → MCP context → MCP profile | All MCP responses valid | Full MCP integration verified |

---

## Cross-Cutting Validation Rules

These rules apply to EVERY test case above and must be verified continuously:

| Rule ID | Rule | Verification Method |
|---|---|---|
| XC-001 | **stdout is sacred**: No non-JSON-RPC output on stdout in MCP mode | Pipe `unfade mcp` stdout through JSON-RPC validator |
| XC-002 | **No `console.log()`**: Zero instances in codebase | `grep -r "console.log" src/` returns 0 results |
| XC-003 | **All logging to stderr**: `logger.*()` writes to `process.stderr` | Logger unit tests verify stream target |
| XC-004 | **"capture engine" not "daemon"**: User-facing strings | `grep -r "daemon" src/` returns 0 results outside of: internal code comments, `daemon.pid` file references, `unfade daemon stop` command name |
| XC-005 | **ESM imports have `.js` extensions** | `grep -rP "from ['\"]\..*(?<!\.js)['\"]" src/` returns 0 |
| XC-006 | **Zod schemas are source of truth**: Every data file validates against its schema | Schema validation in tests for all fixtures |
| XC-007 | **Response envelope on every tool response** | Unit tests verify `_meta` presence on all tool/`--json` outputs |
| XC-008 | **`.unfade/` paths via `src/utils/paths.ts`** only | No hardcoded `.unfade/` strings in business logic |
| XC-009 | **Errors use `handleCliError`** | All CLI command catch blocks route through `handleCliError` |
| XC-010 | **Config reads use schema validation** | `config.json` parsed through `UnfadeConfigSchema.parse()` |
| XC-011 | **CaptureEventSchema (TS) mirrors CaptureEvent (Go)** | Cross-language schema parity test |
| XC-012 | **One writer per file** | Go only writes `events/` + `state/`; TypeScript only writes `distills/` + `profile/` + `graph/` + `cards/` + `site/` |
| XC-013 | **No `process.stdout.write()` except MCP transport and `--json` flag** | `grep -r "process.stdout" src/` limited to MCP transport + JSON output utility |

---

## Test Count Summary

| Epic | Test Cases |
|---|---|
| Epic 1: Zero-Knowledge Onboarding | 20 |
| Epic 2: Daily Ritual & TUI Dashboard | 24 |
| Epic 3: Web UI Experience | 18 |
| Epic 4: AI Agent MCP Integration | 21 |
| Epic 5: Background Capture Engine | 22 |
| Epic 6: Distillation Pipeline | 22 |
| Epic 7: Personalization & Amplification | 15 |
| Epic 8: Cards & Thinking Graph | 17 |
| Epic 9: Self-Healing & Edge Cases | 20 |
| Epic 10: Ecosystem & Launch Readiness | 18 |
| Cross-Cutting Rules | 13 |
| **TOTAL** | **210** |

---

## Definition of Done

A feature is **done** when:

1. All test cases in its epic pass (manual or automated)
2. All applicable cross-cutting rules verified
3. No "daemon" in user-facing strings
4. Graceful degradation confirmed for every failure mode in Epic 9
5. `--json` output validates against response envelope schema
6. MCP tool responses include `_meta` with all required fields
7. Zero `console.log()` in production code
8. All imports use `.js` extensions
9. Error handling routes through `handleCliError`

---

*Generated by RRVV Framework analysis of Unfade architecture documents: `UNFADE_CLI_RESEARCH_AND_DESIGN.md`, `ZERO_KNOWLEDGE_UX_PLAN.md`, and `PHASE_0`–`PHASE_4` / `PHASE_6`–`PHASE_7` under `.internal/architecture/`.*

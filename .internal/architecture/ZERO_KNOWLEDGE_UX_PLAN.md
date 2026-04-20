# Unfade Zero-Knowledge UX Plan

> **Status:** PROPOSAL
>
> **Last updated:** 2026-04-15
>
> **Scope:** Simplify the Unfade CLI experience so that a general user needs to know essentially NOTHING to start using Unfade. One or two commands max for everything day-to-day. The full command surface remains as power-user/debugging reference.

---

## Table of Contents

- [Part I: Research — Pattern Extraction from Zero-Config UX Leaders](#part-i-research--pattern-extraction-from-zero-config-ux-leaders)
- [Part II: Reason — Designing the Simplified UX](#part-ii-reason--designing-the-simplified-ux)
- [Part III: Validate — User Journey Testing](#part-iii-validate--user-journey-testing)
- [Part IV: Verify — Ensuring Simplification Does Not Break](#part-iv-verify--ensuring-simplification-does-not-break)
- [Part V: Implementation Recommendations](#part-v-implementation-recommendations)
- [Part VI: Risk Assessment](#part-vi-risk-assessment)

---

## Part I: Research — Pattern Extraction from Zero-Config UX Leaders

### 1.1 `npx create-next-app` — The "One Command Does Everything" Pattern

**What it does:** A single `npx create-next-app` invocation handles project naming, template selection, dependency installation, git initialization, and first-run instructions. The user runs one command, answers a few prompts, and has a working project.

**Key patterns for Unfade:**
- **First-run detection is implicit.** There is no separate `create-next-app init` step. The command IS the init.
- **Sensible defaults with opt-in prompts.** TypeScript? Yes. ESLint? Yes. App Router? Yes. Every default is the mainstream choice. Power users override via flags (`--typescript`, `--no-eslint`).
- **Exit message is the next action.** After completion, it prints exactly what to do next: `cd my-app && npm run dev`. No ambiguity.

**Unfade takeaway:** `npx unfade` on first run should BE the init. No separate `unfade init` command for the common case. The exit message should say "Unfade is running. Your first distill arrives at 6 PM. Run `unfade` anytime to check status."

### 1.2 Docker Desktop — Abstracting CLI Complexity Behind a GUI

**What it does:** Docker Desktop gives users a system tray icon, a dashboard GUI, and auto-starts containers. The `docker` CLI still works for power users, but most users interact through the GUI.

**Key patterns for Unfade:**
- **System tray presence.** Docker Desktop lives in the macOS menu bar / Windows system tray. It is always visible without being intrusive.
- **GUI is the default, CLI is the escape hatch.** New users never touch `docker run`. They click buttons.
- **Auto-start on login.** Docker Desktop starts automatically. No `docker daemon start` needed.
- **Status at a glance.** The tray icon changes to indicate running/stopped/error state.

**Unfade takeaway:** The web UI (`localhost:7654`) is the primary daily interface, not the CLI. The TUI dashboard is for terminal-native developers who want a quick glance. Consider a system tray presence (Phase 6+) but in the meantime, the system notification ("Your Unfade is ready") serves as the pull-back mechanism. The daemon auto-starts via launchd/systemd and never requires manual start.

### 1.3 Homebrew `brew install` + Auto-Start Pattern

**What it does:** `brew install` downloads, compiles, and installs. `brew services start` registers a launchd plist for auto-start on login. Some formulae do this automatically.

**Key patterns for Unfade:**
- **Single install command handles binary acquisition.** No separate "download binary" step.
- **Auto-start is a one-liner:** `brew services start postgresql` registers the service permanently. No manual launchd configuration.
- **Uninstall is clean:** `brew services stop && brew uninstall` removes everything.

**Unfade takeaway:** `npx unfade` must handle Go daemon binary download, verification, and platform auto-start registration (launchd plist/systemd unit/Task Scheduler) in a single flow. The user should never know there is a Go binary involved. The phrase "Go daemon" should never appear in user-facing output.

### 1.4 Spotify Wrapped — Zero User Action to Generate

**What it does:** At the end of the year, Spotify Wrapped appears automatically. The user did nothing to configure it, trigger it, or opt into it. The data was collected passively. The artifact was generated without user action. The user's only role is to view and share.

**Key patterns for Unfade:**
- **Passive data collection.** The user's listening history is captured as a side effect of normal usage.
- **Automatic artifact generation.** Wrapped is generated server-side on a schedule. No user trigger.
- **Push notification to consume.** The user is notified when Wrapped is ready.
- **Sharing is the primary action.** The artifact is designed for sharing (Instagram Stories format, shareable links).

**Unfade takeaway:** The Daily Distill is Unfade's "daily Wrapped." It should be generated automatically at 6 PM (configurable) without any user action. The system notification says "Your Unfade is ready — tap to view." The Unfade Card is the shareable artifact. The user's only action is viewing and optionally sharing. `unfade distill` exists only for power users who want to trigger it manually or backfill.

### 1.5 GitHub Copilot — Zero Setup After Initial Auth

**What it does:** After authenticating with GitHub in VS Code, Copilot works immediately. No configuration of models, endpoints, or preferences. It observes code context and provides suggestions.

**Key patterns for Unfade:**
- **One-time auth, then invisible.** The setup is a single sign-in step. After that, Copilot works without configuration.
- **No model selection.** Users do not choose which model powers Copilot. The system chooses.
- **Progressive disclosure of settings.** Settings exist (temperature, suggestion length) but are buried in VS Code settings. The default experience requires zero configuration.

**Unfade takeaway:** LLM configuration is the one friction point in Unfade's init. For zero-config: default to Ollama if available, fall back to structured summaries (no LLM) if not. Do NOT prompt for API keys during init unless the user explicitly asks. The structured summary (no AI synthesis) is a good-enough first experience. LLM configuration should be discoverable in the web UI settings page, not required at init time.

### 1.6 Progressive Disclosure in CLI Tools

**The pattern:** Show the minimum at each level of engagement:
- **Level 0 (install):** One command. No options needed.
- **Level 1 (daily use):** One entry point (`unfade` or web UI). All common actions accessible from there.
- **Level 2 (power user):** Specific commands (`unfade query`, `unfade distill`, `unfade export`).
- **Level 3 (debugging):** `unfade daemon stop`, `--verbose`, `--json`, `--config`.

Reference implementations: `git` (porcelain vs plumbing), `docker` (Docker Desktop vs CLI), `brew` (install/upgrade vs tap/formula/audit).

**Unfade takeaway:** The command surface should be organized into tiers. The user learns commands only when they need them, and the TUI/web UI should cover everything in Levels 0-1 without ever requiring a command name.

---

## Part II: Reason — Designing the Simplified UX

### 2.1 What `npx unfade` Should Do

**First run (no `.unfade/` directory detected):**

```
$ npx unfade

  ╭──────────────────────────────────────────╮
  │                                          │
  │   Welcome to Unfade                      │
  │   Your engineering reasoning, captured.  │
  │                                          │
  ╰──────────────────────────────────────────╯

  Setting up...

  ✓ Created .unfade/ directory
  ✓ Downloaded capture engine (12MB)
  ✓ Installed shell hooks (zsh)
  ✓ Registered auto-start (launchd)
  ✓ Started capture engine
  ✓ Backfilling 30 days of git history...

  Unfade is running. Your first distill arrives at 6:00 PM.
  
  Open your dashboard:  unfade       (terminal)
                        unfade open  (browser)

  Tip: Your AI tools can connect via MCP — see unfade open → Settings
```

**Subsequent runs (`.unfade/` exists, daemon running):**

```
$ npx unfade
→ Launches TUI dashboard (Ink)
```

**Subsequent runs (`.unfade/` exists, daemon NOT running):**

```
$ npx unfade

  ⚠ Capture engine stopped. Restarting...
  ✓ Started capture engine

→ Launches TUI dashboard (Ink)
```

**Key design decision:** `unfade init` is NOT a separate command for general users. It is absorbed into the bare `unfade` command via state detection. `unfade init` remains as an alias/power-user command for explicit re-initialization, but it is never mentioned in primary documentation or onboarding.

### 2.2 Eliminating `unfade init` as a Separate Mental Model

**Current design (from Phase 5 task UF-086):** Bare `unfade` already detects state and runs init wizard if not initialized. This is correct but needs to be the ONLY documented path.

**Concrete changes needed:**

1. **README quickstart section** says `npx unfade` — not `npx unfade init`.
2. **ClawHub SKILL.md** says `npx unfade` — not `npx unfade init`.
3. **`unfade init` still works** but is documented only in the "Power User Reference" section.
4. **`unfade init --force`** re-runs initialization (reinstalls hooks, re-downloads binary, etc.) for troubleshooting.
5. **State detector** (from `src/state/detector.ts`) must handle all edge cases:
   - `.unfade/` exists but daemon binary missing → re-download
   - `.unfade/` exists but daemon not running → restart daemon
   - `.unfade/` exists but shell hooks not installed → reinstall hooks
   - `.unfade/` exists but auto-start not registered → re-register
   - Everything healthy → launch TUI dashboard

### 2.3 TUI Dashboard as the Single Entry Point

**Current design:** TUI dashboard shows status, today's distill summary, personalization level, quick actions `[d]istill [c]ard [o]pen web [q]uit`.

**Enhanced design for zero-knowledge UX:**

The TUI dashboard should cover every common action without requiring the user to know any other command:

```
┌──────────────────────────────────────────────────────────────┐
│  UNFADE                                    ● Capturing       │
│  ──────                                                      │
│                                                              │
│  Today: 12 events captured │ 3 decisions detected            │
│                                                              │
│  Latest Distill (2026-04-14):                                │
│  • Chose Redis over Memcached for session cache              │
│  • Refactored auth middleware to use JWT refresh              │
│  • Abandoned custom WebSocket auth (40 min dead end)         │
│                                                              │
│  Reasoning Profile:  3.2 alt/decision │ 60% AI modified      │
│  Top domains:        backend, databases, auth                │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  [d] Distill now    [c] Generate card    [o] Open browser    │
│  [s] Search         [p] Profile          [e] Export          │
│  [q] Quit                                                    │
└──────────────────────────────────────────────────────────────┘
```

**Changes from current design:**
- Add `[s] Search` quick action — opens inline search prompt, equivalent to `unfade query "..."`.
- Add `[p] Profile` quick action — shows inline profile summary.
- Add `[e] Export` quick action — triggers export with confirmation.
- The TUI becomes a complete interface. A user who only ever types `unfade` and uses quick actions will never need to learn any other command.

### 2.4 Making the Web UI Auto-Discoverable

**The problem:** The web UI runs on `localhost:7654` but the user has to know to run `unfade open` or type the URL. Neither is zero-knowledge.

**Solutions, in order of implementation priority:**

1. **System notification links to web UI (Phase 1).** When "Your Unfade is ready" notification fires, clicking it opens `localhost:7654` in the default browser. Implementation: `node-notifier` supports click callbacks on macOS (NSUserNotification) and Windows (toast notification).

2. **TUI dashboard `[o]` key (Phase 1).** Already planned. The `[o]pen browser` action in the TUI opens the web UI. This is the secondary discovery mechanism.

3. **Init completion message (Phase 1).** The init flow prints `Open your dashboard: unfade open (browser)` as part of the exit message. This is the tertiary discovery mechanism.

4. **macOS menu bar app (Phase 6+, deferred).** A lightweight menu bar app (Electron-less; use `node-mac-notifier` or a Go tray app) that shows a status icon and provides one-click access to the web UI. This is the Docker Desktop pattern but should be deferred until after launch.

### 2.5 The "Install and Forget" Daemon Experience

**Current design is already correct.** The daemon auto-starts via platform manager (launchd plist on macOS, systemd unit on Linux, Task Scheduler on Windows). Key refinements:

1. **The word "daemon" never appears in user-facing output.** Replace with "capture engine" in all user-facing text. "Daemon" is a power-user/docs concept.
   - TUI: `● Capturing` (not `● Daemon running`)
   - Notification: "Unfade is capturing your reasoning" (not "Daemon started")
   - Error: "Capture engine stopped unexpectedly. Restarting..." (not "Daemon crashed")

2. **Auto-restart on crash.** The launchd plist / systemd unit should include `KeepAlive: true` (macOS) / `Restart=always` (Linux). If the daemon crashes, the platform manager restarts it within 10 seconds. The user never notices.

3. **Self-healing on `unfade` invocation.** Every time the user runs `unfade` (TUI dashboard), the state detector checks daemon health. If the daemon is not running, it silently restarts it before showing the dashboard.

4. **No `unfade daemon start` command.** The daemon starts automatically during init and auto-restarts via platform manager. The only daemon command a user might need is `unfade daemon stop` for debugging, and even that is a power-user command. The web UI `/settings` page should have a "Pause capture" toggle that is the GUI-friendly equivalent.

### 2.6 Daily Distill Without ANY User Action

**Current design is already correct** (Phase 1, Section 4.2): the daemon's scheduler triggers distillation at 6 PM local time by default. Refinements:

1. **No LLM required for first value.** If Ollama is not installed and no API key is configured, the distill should still generate a structured signal summary (decisions detected, files changed, domains touched, time invested). The structured summary is the "no-LLM" distill mode. This means init NEVER prompts for LLM configuration. LLM is an enhancement, not a requirement.

2. **System notification when distill is ready.** Already planned. The notification should:
   - Include a preview: "3 decisions, 1 dead end explored"
   - Clicking it opens the web UI distill viewer (not the terminal)
   - On macOS, use `terminal-notifier` or `node-notifier` with `open` callback

3. **Weekend/no-activity handling.** If there are zero events for the day, do NOT generate an empty distill. Do NOT send a notification. Silence is correct behavior for inactive days.

### 2.7 Notification Strategy

**Tier 1: Essential (enabled by default):**
- "Your Unfade is ready" — daily distill complete. Click opens web UI.

**Tier 2: Optional (disabled by default, enable in web UI settings):**
- Weekly reasoning profile update
- Amplification insight ("You made a similar decision 3 weeks ago...")
- Unfade Card auto-generated for notable days

**Tier 3: Never (no notification):**
- Daemon started/stopped
- Events captured
- Configuration changes

**Implementation note:** All notifications route through `src/services/notification/notifier.ts`. The notifier reads `notification.enabled` and `notification.categories` from config. System notifications (not terminal bells) are the only channel.

---

## Part III: Validate — User Journey Testing

### Journey 1: Brand New User (Saw It on HN, Wants to Try It)

**Before (current design):**
```
1. Reads README → sees "npx unfade init"
2. Runs `npx unfade init`
3. Init wizard asks about LLM provider (confusion: "What's Ollama? Do I need an API key?")
4. Init completes, prints instructions
5. User waits until 6 PM for first distill
6. User forgets about Unfade because nothing happened for hours
```

**After (zero-knowledge design):**
```
1. Reads README → sees "npx unfade"
2. Runs `npx unfade`
3. Auto-detects first run. Scaffolds .unfade/, downloads capture engine, installs hooks.
   NO LLM prompt. Defaults to structured summaries.
4. Backfills 30 days of git history. Immediately triggers first distill from backfill data.
5. Init completes in ~60 seconds. TUI dashboard appears showing:
   "First distill generating from your git history... (takes ~30 seconds)"
6. First distill appears in the TUI. User sees their past 7 days of decisions summarized.
7. User presses [o] to open web UI. Sees dashboard with distill, profile seed, event timeline.
8. System notification at 6 PM: "Your Unfade is ready — 5 decisions, 1 dead end explored"
```

**Critical change:** Trigger an immediate first distill from backfilled git data during init, so the user sees value within 2 minutes, not at 6 PM. This is the "first value in under 5 minutes" principle applied aggressively.

### Journey 2: Day 2 User (Wants to See Yesterday's Distill)

**Before:**
```
1. User remembers "there was some command..."
2. Tries `unfade` → sees TUI dashboard with yesterday's distill summary
3. Wants full distill → tries `unfade distill` (wrong — this triggers re-distillation)
4. Confusion about how to VIEW vs GENERATE
```

**After:**
```
1. User types `unfade` → TUI dashboard shows yesterday's distill summary
2. Presses [o] → web UI opens with full distill content
   OR
1. User clicks yesterday's "Your Unfade is ready" notification → web UI opens directly to distill
```

**Critical change:** The TUI dashboard should show the LATEST distill (which may be yesterday's), not just today's. The `[d]` quick action should be labeled `[d] Distill now` (not just `[d]istill`) to make it clear this GENERATES a new distill, not views the existing one.

### Journey 3: Week 2 User (Wants to Share Their Unfade Card)

**Before:**
```
1. User remembers seeing something about "cards"
2. Tries various commands: `unfade card`? `unfade publish`?
3. Eventually finds it in --help
```

**After:**
```
1. User types `unfade` → TUI dashboard
2. Presses [c] → card generates, preview shown in terminal, and opens in browser
   OR
1. User opens web UI → clicks "Cards" in navigation → picks a date → generates → downloads PNG
   OR
1. After an unusually productive day, system notification: "Notable day! Your Unfade Card
   is ready to share." (Tier 2 notification, opt-in)
```

**Critical change:** The TUI `[c]` quick action should generate the card AND open it in the browser (not just show a terminal confirmation).

### Journey 4: Power User (Wants to Search Past Decisions)

**Before:**
```
1. User remembers `unfade query "caching"`
2. Gets results in terminal
```

**After (additional paths — power user command still works):**
```
1. User types `unfade` → TUI dashboard → presses [s] → types "caching" → sees inline results
   OR
2. User opens web UI → uses search bar on dashboard → sees results with full context
   OR
3. User's AI tool (Claude Code/Cursor) asks Unfade MCP: "What did the developer decide
   about caching?" → gets answer automatically
   OR
4. User types `unfade query "caching"` → terminal results (still works)
```

**Critical change:** Add `[s] Search` to TUI quick actions. Add a search bar to the web UI dashboard page.

### Journey 5: User Connecting MCP to Claude Code / Cursor

**Before:**
```
1. User reads docs about MCP configuration
2. Manually edits Claude Code's MCP config to add Unfade server
3. Specifies the command and args for the stdio MCP server
4. Restarts Claude Code
```

**After:**
```
1. User opens web UI → Settings → "Connect AI Tools" section
2. Sees copy-paste snippets for Claude Code, Cursor, Windsurf:
   
   For Claude Code, add to ~/.claude/settings.json:
   {
     "mcpServers": {
       "unfade": {
         "command": "npx",
         "args": ["unfade", "mcp"]
       }
     }
   }

3. User pastes, restarts IDE, done.
   OR
1. User runs `unfade` → TUI shows "Tip: Connect your AI tools for persistent memory
   → press [o] for setup instructions"
```

**Critical change:** The web UI settings page should have a dedicated "Connect AI Tools" section with pre-formatted, copy-pasteable configuration snippets for each major MCP client. Add `unfade mcp` as a hidden command (not in `--help` top-level) that starts the MCP stdio server for IDE integration.

---

## Part IV: Verify — Ensuring Simplification Does Not Break

### 4.1 Full Command Surface (All Commands Still Work)

| Command | Level | Before | After | Change |
|---|---|---|---|---|
| `unfade` (no args) | Core | TUI dashboard if initialized, error if not | TUI dashboard if initialized, **runs init if not** | State detection handles both cases |
| `unfade init` | Power | Required first command | **Alias for explicit re-init.** `unfade init --force` for full re-initialization | De-emphasized in docs, still works |
| `unfade open` | Core | Opens web UI | Opens web UI | No change |
| `unfade query "..."` | Power | Search reasoning history | Search reasoning history. **Also accessible via TUI `[s]` and web UI search bar** | Additional access paths |
| `unfade distill` | Power | Manual re-distill | Manual re-distill. **Also accessible via TUI `[d]` and web UI re-generate button** | Additional access paths |
| `unfade export` | Power | Archive data | Archive data. **Also accessible via TUI `[e]` and web UI settings** | Additional access paths |
| `unfade daemon stop` | Debug | Stop daemon | Stop daemon. **Web UI settings has "Pause capture" toggle** | GUI alternative |
| `unfade publish` | Power | Generate static site | Generate static site. **Also accessible via web UI** | Additional access path |
| `unfade mcp` | Hidden (NEW) | N/A | **Start MCP stdio server** (called by IDE configs, not users) | New hidden command |

### 4.2 TUI Dashboard Covers All Common Actions

| Action | TUI Quick Key | What It Does |
|---|---|---|
| View today's distill | Shown by default | Summary displayed inline |
| Generate new distill | `[d]` | Triggers distillation, shows progress, displays result |
| Generate card | `[c]` | Generates card PNG, opens in browser |
| Open web UI | `[o]` | Opens `localhost:7654` in default browser |
| Search reasoning | `[s]` (NEW) | Inline search prompt, results displayed in TUI |
| View profile | `[p]` (NEW) | Inline profile summary |
| Export data | `[e]` (NEW) | Triggers export with confirmation |
| Quit | `[q]` | Exits TUI |

### 4.3 Web UI Covers All Visual/Sharing Actions

| Page | URL | Actions Available |
|---|---|---|
| Dashboard | `/` | Activity feed, recent distill, search bar, quick stats |
| Distill Viewer | `/distill` | Browse history, read full distills, re-generate |
| Profile | `/profile` | Reasoning profile visualization, pattern feedback |
| Cards | `/cards` | Generate, preview, download PNG for any date |
| Search | `/search` | Full search interface with filters |
| Settings | `/settings` | LLM config, capture toggles, shell hook reinstall, **Connect AI Tools (MCP snippets)**, pause capture, export |

### 4.4 MCP Integration Works Without User Configuration

The MCP server starts automatically with the daemon. The user adds a config snippet to their IDE's MCP settings pointing to `npx unfade mcp`.

**What "without user configuration" means:** The user still has to add the MCP config to their IDE (IDE limitation, not Unfade limitation). But Unfade makes this as frictionless as possible:
- Copy-paste snippets in web UI settings
- `server.json` manifest for MCP Registry auto-discovery
- ClawHub skill for OpenClaw ecosystem discovery
- Zero Unfade-side configuration required (no API keys, no endpoints)

### 4.5 No Action Requires Remembering a Command Name

| User Intent | Zero-Knowledge Path | Power-User Path |
|---|---|---|
| "I want to start using Unfade" | `npx unfade` | `npx unfade init` |
| "I want to see my dashboard" | `unfade` | `unfade` |
| "I want to see my distill" | Click notification / `unfade` then `[o]` | `unfade open` |
| "I want to search past decisions" | `unfade` then `[s]` / web UI search | `unfade query "..."` |
| "I want to share my card" | `unfade` then `[c]` / web UI cards page | N/A |
| "I want to connect my AI tools" | Web UI Settings → Connect AI Tools | Edit IDE config manually |
| "I want to export my data" | `unfade` then `[e]` / web UI settings | `unfade export` |
| "I want to stop capture" | Web UI Settings → Pause | `unfade daemon stop` |

---

## Part V: Implementation Recommendations

### 5.1 Changes to Existing Tasks

| Task ID | Current Description | Recommended Change |
|---|---|---|
| **UF-086** | Smart default: bare `unfade` when not initialized → runs init | **Expand:** Make this the PRIMARY init path. Init should complete silently (no LLM prompt), trigger immediate first distill from backfill, then show TUI dashboard. |
| **UF-006** | Commander entry point with placeholder commands | **Add:** `unfade mcp` hidden command for MCP stdio server. Register it with Commander but do not list in `--help` top-level. |
| **UF-063** | Shell hook installer called from `unfade init` | **No change to implementation**, but init should install hooks without prompting for confirmation. Hooks are opt-out (configurable in web UI settings), not opt-in. |
| **UF-048** | Server auto-start with daemon | **No change.** Already correct. |

### 5.2 New Tasks Required

> **Integration status:** Phase 1 tasks (UF-086a/b/c/f/g) have been integrated into [PHASE_1_CAPTURE_AND_INTELLIGENCE.md](./PHASE_1_CAPTURE_AND_INTELLIGENCE.md) micro-sprints. UF-086b merged into UF-013 (self-healing state detector). UF-086f merged into UF-040 (notification click handler). Phase 2 tasks (UF-086d/e) have been integrated into [PHASE_2_CONTEXT_AND_INTEGRATION.md](./PHASE_2_CONTEXT_AND_INTEGRATION.md) micro-sprints.

| New Task | Description | Phase | Status |
|---|---|---|---|
| **UF-086a** | Immediate first distill: after backfill in init flow, call distiller for the most recent day with events. Display result in TUI dashboard. If no LLM configured, produce structured summary. | Phase 1 | **Integrated** → Sprint 1D |
| **UF-086b** | Self-healing state detector: on every `unfade` invocation, check daemon health, shell hook status, auto-start registration. Silently fix any issues before showing TUI. | Phase 1 | **Merged into UF-013** → Sprint 1A |
| **UF-086c** | TUI quick actions expansion: add `[s]earch`, `[p]rofile`, `[e]xport` to dashboard. `[s]` opens inline search input. `[p]` shows inline profile summary. `[e]` triggers export with y/n confirmation. | Phase 1 | **Integrated** → Sprint 1G |
| **UF-086d** | `unfade mcp` hidden command: starts MCP stdio server for IDE integration. Not listed in `--help` but works when invoked. | Phase 2 | **Integrated** → Sprint 2C |
| **UF-086e** | Web UI "Connect AI Tools" section: settings page includes copy-paste MCP config snippets for Claude Code, Cursor, Windsurf, and generic MCP clients. | Phase 2 | **Integrated** → Sprint 2D |
| **UF-086f** | Notification click handler: clicking "Your Unfade is ready" notification opens web UI distill viewer in default browser. | Phase 1 | **Merged into UF-040** → Sprint 1F |
| **UF-086g** | User-facing terminology: replace all instances of "daemon" in user-facing strings with "capture engine." Audit all command output, TUI text, web UI text, notifications. "Daemon" remains in code, logs, and developer docs. | Phase 1 | **Integrated** → Sprint 1A |

### 5.3 Documentation Changes

| Document | Change |
|---|---|
| **README.md** (UF-090) | Quickstart says `npx unfade` not `npx unfade init`. Command reference splits into "Daily Use" (`unfade`, `unfade open`) and "Power User" (`query`, `distill`, `export`, `daemon stop`, `publish`). |
| **SKILL.md** (UF-084) | Setup section says `npx unfade` not `npx unfade init`. |
| **CLAUDE.md** (UF-093) | Add "user-facing terminology" convention: "capture engine" not "daemon" in user-facing text. |

### 5.4 Init Flow Redesign (Detailed)

Current init (from Phase 1) has these steps:
1. Scaffold `.unfade/`
2. Fingerprint project
3. Download Go daemon binary
4. Install shell hooks
5. Install platform auto-start (launchd/systemd/Task Scheduler)
6. Configure LLM (PROMPT USER)
7. Start daemon + web server
8. Trigger git backfill

Redesigned init (zero-knowledge):
1. Scaffold `.unfade/`
2. Fingerprint project
3. Download Go daemon binary (display: "Downloading capture engine...")
4. Install shell hooks (NO confirmation prompt)
5. Install platform auto-start
6. **Skip LLM configuration entirely.** Default to Ollama if `ollama list` succeeds, otherwise default to no-LLM mode (structured summaries).
7. Start daemon + web server
8. Trigger git backfill (30 days)
9. **NEW: Trigger immediate first distill from backfilled data for most recent active day**
10. **NEW: Show TUI dashboard with first distill result**

LLM configuration moves to: web UI Settings page, accessible anytime. The settings page should show a banner: "Enhance your distills with AI — configure an LLM provider" if no LLM is configured.

### 5.5 The Two-Command Mental Model

The marketing and documentation should establish exactly two commands in the user's mind:

| Command | When | What |
|---|---|---|
| `npx unfade` | Once ever (first install) | Installs everything, shows first distill |
| `unfade` | Anytime after | Opens dashboard with everything you need |

Everything else is discoverable through the TUI quick actions or web UI. No command name needs to be memorized beyond these two (and they are the same command).

---

## Part VI: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Silent init installs shell hooks without consent** | Medium | Medium — some users will object to .zshrc modification without prompt | Add a single-line notice: "Installed shell hooks for command capture. Disable anytime: unfade open → Settings". Do not prompt, but inform. |
| **No-LLM distill feels weak for first impression** | Medium | High — user's first distill is a structured summary, not AI synthesis | Make the structured summary genuinely useful: decision count, files changed, time invested, domain tags. Add banner: "AI-powered distills available — configure in Settings." |
| **Immediate first distill slows init** | Low | Medium — init takes 2 minutes instead of 60 seconds | Show progress: "Generating your first reasoning summary..." with spinner. The wait is acceptable because the user sees immediate value. Run distill async; show TUI immediately with "generating..." placeholder. |
| **Self-healing state detector is complex** | Medium | Low — edge cases in daemon/hook/auto-start detection | Start simple: check PID file exists and process is alive. Expand detection scope over time. Log all self-healing actions for debugging. |
| **Users expect `unfade init` from other CLI tool patterns** | Medium | Low — confusion when README says just `npx unfade` | `unfade init` still works. If user runs it when already initialized, show: "Already set up! Opening dashboard..." and launch TUI. |

---

## Critical Files for Implementation

- `.internal/architecture/PHASE_0_FOUNDATION.md` — Update command hierarchy, add `unfade mcp` hidden command
- `.internal/architecture/PHASE_1_CAPTURE_AND_INTELLIGENCE.md` — Redesign init flow (skip LLM prompt, add immediate first distill, add self-healing state detector)
- `.internal/architecture/PHASE_2_CONTEXT_AND_INTEGRATION.md` — Add `unfade mcp` hidden command, add "Connect AI Tools" web UI section
- `.internal/architecture/PHASE_4_PLATFORM_AND_LAUNCH.md` — Expand UF-086 scope, change README quickstart from `npx unfade init` to `npx unfade` where applicable
- `.internal/architecture/` — Update any day-plan / checklist doc in-repo to reflect zero-knowledge init flow

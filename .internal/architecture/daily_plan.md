# Unfade: One-Week Build Plan — Build in Public, Ship Daily

> **Aligned with:** [Vertical Slicing Plan](./VERTICAL_SLICING_PLAN.md) (canonical architecture)
>
> **Last updated:** 2026-04-14

---

## The Constraint That Shapes Everything

You have **5 days** (Mon-Fri). You're building in public. Each day must produce something **testable by others** and **shareable on X/HN/Reddit**. This means: ship a working thing every single day, get feedback overnight, incorporate in the morning.

## Technology Decisions (Settled)

**Hybrid architecture: Go daemon + TypeScript CLI.** See [Vertical Slicing Plan §Framework Decisions](./VERTICAL_SLICING_PLAN.md#framework-decisions) for full RRVV analysis.

| Concern | Technology | Why |
|---|---|---|
| **Daemon** (`unfaded`) | Go binary (~12MB) | 24/7 process. <15MB RAM, <1% CPU. Cross-platform via goreleaser. fsnotify for file watching |
| **CLI** (`unfade`) | TypeScript (Node.js ESM) | On-demand. MCP SDK, Ink TUI, satori cards, Hono server — all TypeScript-native |
| **Web UI** | htmx (~14KB) + Hono | Server-rendered HTML. No JS build step. Hono renders templates on localhost:7654 |
| **TUI** | Ink 6.x + React 19 | `unfade` (no args) — quick dashboard in terminal |
| **IPC** | Filesystem (`.unfade/`) | Go daemon writes events, TypeScript reads. No RPC needed |

**Repo: `unfade-cli`** — MIT license.

---

## The Build Order: 5 Days, 5 Shippable Milestones

### Day 1 (Monday): The 5-Minute Wow — Init + Fingerprint + Daemon

> **Maps to:** [Slice 1 (Instant Fingerprint)](./VERTICAL_SLICING_PLAN.md#slice-1-instant-fingerprint--the-5-minute-wow) + [Slice 2 (Daemon)](./VERTICAL_SLICING_PLAN.md#slice-2-daily-distill--the-habit-loop)

**What you build:**
- `unfade init` — the single setup command that does everything:
  1. Scaffolds `.unfade/` directory structure
  2. Scans git history → generates Reasoning Fingerprint (no LLM needed)
  3. Downloads `unfaded` Go daemon binary for current platform
  4. Detects shell (zsh/bash), installs capture hooks
  5. Installs platform auto-start (launchd on macOS)
  6. Starts daemon + HTTP server (localhost:7654)
- Go daemon (`unfaded`): watches `.git/` via fsnotify, tails AI session logs (`~/.cursor/logs/`, `~/.claude/`)
- Event storage: append-only JSONL at `.unfade/events/YYYY-MM-DD.jsonl`
- `unfade distill` — takes today's events, sends to Ollama (local LLM), produces Daily Distill at `.unfade/distills/YYYY-MM-DD.md`
- `unfade` (no args) — TUI dashboard showing daemon status, today's event count, quick actions

**The personalization seed (Day 1):**
Even in the first distill, include a `PATTERNS` section: count of alternatives evaluated per decision, domains touched, ratio of "developer decided" vs. "accepted AI suggestion." This is rough but it's the signal that says "this tool is learning me."

**What to share on Day 1:**
Post on X/HN: "I built a CLI that watches your git + AI sessions and generates a daily reasoning summary. Here's what my Day 1 Distill looks like. Open source, local-only, MIT." Include a screenshot of the Distill output. Share the repo link.

**What to test:**
- Does `unfade init` complete in <60 seconds and show the Reasoning Fingerprint?
- Does the Go daemon capture git commits in real-time (fsnotify → JSONL)?
- Does the Ollama distill produce something useful from real git history?
- Can you run `unfade distill --backfill 7` to retroactively distill the last 7 days of git history? (Critical for cold start.)
- Does the TUI dashboard (`unfade` no args) show daemon status?

---

### Day 2 (Tuesday): The Memory Layer — MCP Server + HTTP API + Web UI

> **Maps to:** [Slice 3 (Dual-Protocol Server)](./VERTICAL_SLICING_PLAN.md#slice-3-dual-protocol-server--the-memory-layer)

**What you build:**
- Hono HTTP server on `localhost:7654` (auto-starts with daemon):
  - JSON API: `GET /context`, `GET /query`, `GET /decisions`, `GET /profile`
  - Web UI (htmx): `GET /` (dashboard), `GET /distill` (viewer), `GET /profile` (reasoning profile), `GET /settings` (daemon control)
- MCP server over stdio: expose same data as MCP Resources (`unfade://context/recent`, `unfade://profile`, `unfade://decisions/recent`) and MCP Tools (`unfade_query`, `unfade_distill`)
- `unfade query "..."` — search reasoning history from CLI (pipeable)
- `unfade open` — opens web UI in browser

**What to share on Day 2:**
Post: "Day 2: Unfade now has an MCP server. Connect it to Claude Code or Cursor and your AI automatically knows what you were working on yesterday. Zero config. Here's the 30-second setup." Include a GIF showing: connect MCP → ask Claude Code "continue what I was working on yesterday" → it knows.

**What to test:**
- Add Unfade MCP server to Claude Code's MCP config. Does Claude Code auto-discover the resources?
- Ask Claude Code "What was I working on yesterday?" — does it get context from Unfade?
- Does the web UI (`localhost:7654`) render the dashboard, distill viewer, profile?
- Does `unfade query "caching"` return relevant decisions from CLI?
- Does htmx re-distill button work on the `/distill` page?

---

### Day 3 (Wednesday): The Viral Artifacts — Unfade Cards + Terminal Capture

> **Maps to:** [Slice 4 (Cards & Terminal)](./VERTICAL_SLICING_PLAN.md#slice-4-cards--terminal--the-viral-artifacts)

**What you build:**
- Card rendering pipeline: parse distill → extract data → JSX template → satori (SVG) → resvg-js (PNG)
- Web UI `/cards` page — card preview, generate for any date, download PNG
- Card generation API: `POST /cards/generate` (used by web UI and TUI `[c]` quick action)
- Terminal capture: zsh/bash preexec/precmd hooks → Go daemon's Unix socket → CaptureEvents in JSONL
- Debugging session detection (in Go daemon): retry patterns (same command, different args, within 10-minute window) → enriched events
- `unfade export` — portable `.tar.gz` archive of `.unfade/`

**What to share on Day 3:**
Post: "Day 3: Unfade Cards. My AI coding day, distilled into a shareable card. Here's mine. What does yours look like?" Post YOUR actual Unfade Card. This is the viral moment — the card IS the marketing. Include the terminal capture announcement.

**What to test:**
- Does the Unfade Card look good when shared on X? (Check OG preview rendering, 1200x630)
- Does terminal capture work without noticeable latency (<10ms)?
- Do debugging sessions produce richer distills? ("Spent 40 min on auth token refresh — tried 3 approaches, root cause was JWT validation order")
- Does the web UI `/cards` page let you generate and download cards?
- Does TUI `[c]` quick action trigger card generation?

---

### Day 4 (Thursday): The Moat — Reasoning Personalization + Amplification

> **Maps to:** [Slice 5 (Personalization & Amplification)](./VERTICAL_SLICING_PLAN.md#slice-5-personalization--amplification--the-moat)

**What you build:**
- `reasoning_model.json` v2 — the personalization model that accumulates over time:
  - Decision style: alternatives evaluated per decision (running average)
  - Domain distribution: which areas you reason about most
  - Exploration depth: how long you spend on dead ends
  - AI acceptance rate: how often you accept vs. modify AI suggestions
  - Trade-off preferences: inferred from consistent patterns
- Daily Distill now includes **PERSONALIZATION** section with personal baseline comparisons
- Amplification v1: when generating distill, compare today's decisions against past distills. Surface connections: "You evaluated Redis vs Memcached today. On [date], you made a similar evaluation and chose Memcached"
- Web UI `/search` page — query reasoning history + find similar past decisions
- `unfade_amplify` and `unfade_similar` MCP tools for AI agents
- Web UI `/profile` page enhanced with personalization v2 data

**What to share on Day 4:**
Post: "Day 4: Unfade now learns how you think. After 4 days, my reasoning profile shows I evaluate 3.2 alternatives on average, favor simplicity for frontend but go deep on database decisions, and modify 60% of AI suggestions. No other tool does this. Here's my profile." Post the web UI `/profile` screenshot.

**What to test:**
- Does the reasoning profile feel accurate after 4 days of data? (Use `--backfill` for richer testing)
- Does amplification surface a relevant past decision?
- Does the PERSONALIZATION section in the Distill feel like "this tool knows me" or generic filler?
- Does the web UI `/search` page find similar past decisions?
- Ask community: "Does your profile match how you think you reason? What's surprising?"

---

### Day 5 (Friday): The Launch — ClawHub + Thinking Graph + Polish

> **Maps to:** [Phase 5 (Ecosystem Launch)](./cli/PHASE_5_ECOSYSTEM_LAUNCH.md)

**What you build:**
- `unfade-memory` ClawHub skill: package the MCP server as an OpenClaw-installable skill. Create SKILL.md with progressive disclosure. Publish to ClawHub.
- MCP Registry entry: create `server.json`, publish to the MCP Registry.
- `unfade publish` — generates a static HTML site from `.unfade/` data:
  - Decision Density Heatmap (SVG — GitHub-style, each day is a cell)
  - Domain Distribution chart
  - Reasoning Profile card
  - Last 7 days of Distills browsable
  - "Powered by Unfade — unfade.dev" footer
- Deploy instructions: `unfade publish` generates files in `.unfade/site/`, user deploys to Vercel/Netlify/GitHub Pages
- Polish: README with clear install instructions, GIF demos, architecture diagram. npm publish (`npx unfade init`).

**What to share on Day 5:**
Post: "Day 5: Unfade is live. Open source, MIT license, local-first. Install with `npx unfade init`. Your AI tools get persistent memory. You get a reasoning identity. Here's my Thinking Graph after one week. What does yours look like?" Link to your hosted Thinking Graph. Link to the ClawHub skill.

**What to test:**
- Can a new user install and get their first Fingerprint in under 2 minutes?
- Does the ClawHub skill install cleanly on OpenClaw?
- Does the Thinking Graph render correctly on Vercel/GitHub Pages?
- Is the README clear enough that people don't need to ask questions?
- Launch thread on HN "Show HN: Unfade — an open-source reasoning engine that learns how you think"

---

## The Complete Feature Checklist (By Day)

| Day | Feature | Testable? | Shareable? |
|---|---|---|---|
| **D1** | `unfade init` (full 5-step setup) | Yes — `npx unfade init` | Repo link |
| **D1** | Go daemon (`unfaded`) — git + AI session capture | Yes — daemon auto-starts | - |
| **D1** | Reasoning Fingerprint from git history | Yes — shown during init | Screenshot of fingerprint |
| **D1** | `unfade distill` with Ollama | Yes — generates markdown | Screenshot of first Distill |
| **D1** | `unfade distill --backfill 7` | Yes — retroactive distill | - |
| **D1** | TUI dashboard (`unfade` no args) | Yes — shows status | - |
| **D1** | Personalization seed in Distill | Yes — PATTERNS section | - |
| **D2** | HTTP API (localhost:7654) | Yes — curl-testable | - |
| **D2** | Web UI (htmx on localhost:7654) | Yes — browser-testable | Screenshot of web UI |
| **D2** | MCP server (stdio) | Yes — connect from Claude Code | GIF of "telepathic AI" |
| **D2** | `unfade query "..."` CLI | Yes — terminal | - |
| **D2** | `unfade open` | Yes — opens browser | - |
| **D3** | Unfade Cards (web UI `/cards`) | Yes — generates image | Post YOUR Unfade Card |
| **D3** | Terminal capture (shell hooks) | Yes — auto-installed by init | - |
| **D3** | Debugging session detection | Yes — in next Distill | - |
| **D3** | `unfade export` | Yes — creates .tar.gz | - |
| **D4** | `reasoning_model.json` v2 | Yes — web UI `/profile` | Post YOUR reasoning profile |
| **D4** | Personalization in Distill | Yes — PERSONALIZATION section | - |
| **D4** | Amplification v1 (similar past decisions) | Yes — web UI `/search` | - |
| **D4** | `unfade_similar` MCP tool | Yes — from Claude Code | - |
| **D5** | ClawHub skill (`unfade-memory`) | Yes — OpenClaw install | Announce on ClawHub |
| **D5** | MCP Registry entry | Yes — discoverable | - |
| **D5** | `unfade publish` (static Thinking Graph) | Yes — deploy to Vercel | Link to YOUR graph |
| **D5** | Decision Density Heatmap | Yes — SVG in graph | - |
| **D5** | npm publish (`npx unfade init`) | Yes — anyone can install | HN "Show HN" launch |

---

## Command Surface (Final — 4 Core + 3 Power + 1 Launch)

```
CORE (what 95% of users need):
  unfade init          # One-time: scaffold, fingerprint, daemon, shell hooks, auto-start, start
  unfade               # TUI dashboard — status, today's distill, quick actions
  unfade open          # Open web UI in browser (localhost:7654)
  unfade query "..."   # Search reasoning history (terminal, pipeable)

POWER USER (available, rarely needed):
  unfade export        # Archive .unfade/ data
  unfade distill       # Manual re-distill (usually triggered from TUI/web)
  unfade daemon stop   # Manual daemon control (usually managed from web UI settings)

LAUNCH (Day 5):
  unfade publish       # Generate static Thinking Graph site for public hosting
```

---

## Build-in-Public Posting Schedule

| Day | Platform | Post |
|---|---|---|
| **Mon AM** | X + Reddit | "Building an open-source reasoning engine this week. Day 1: capture daemon + first distill. Follow along." |
| **Mon PM** | X | Screenshot of Reasoning Fingerprint + first Daily Distill. "Here's what my engineering day looks like when distilled to reasoning." |
| **Tue PM** | X + r/ClaudeCode + r/cursor | GIF of MCP integration. "My AI now remembers what I was working on yesterday. 30 second setup." |
| **Wed PM** | X + LinkedIn | YOUR Unfade Card. "Day 3 of building Unfade. Here's my engineering reasoning, in a card." |
| **Thu PM** | X + r/ExperiencedDevs | YOUR reasoning profile from web UI. "After 4 days, this tool knows I evaluate 3.2 alternatives on average. Does your profile match how you think you reason?" |
| **Fri AM** | HN "Show HN" | Full launch post. Link to repo, demo, Thinking Graph. |
| **Fri PM** | X + Reddit + Indie Hackers + DEV Community | "Unfade is live. Open source, MIT. Install with `npx unfade init`. Here's my first-week Thinking Graph." |

---

## Critical Path Dependencies (What Blocks What)

```
Day 1: Init + Daemon + Capture + Distill (everything depends on this)
  │
  ├── Day 2: API + MCP + Web UI (needs events + distills to serve)
  │     │
  │     └── Day 5: ClawHub + MCP Registry (needs working MCP server)
  │
  ├── Day 3: Unfade Cards (needs distill data) + Terminal Capture (needs daemon)
  │
  ├── Day 4: Personalization + Amplification (needs multiple days of distill data)
  │
  └── Day 5: Thinking Graph (needs distill + profile data to render)
```

Day 1 is the critical foundation — everything depends on capture + storage + distill working. If Day 1 slips, everything slips. Prioritize getting `unfade init` → daemon running → `unfade distill --backfill 7` working before anything else.

---

## What You Intentionally Skip This Week (Ship Later)

| Feature | Why Skip | When to Add |
|---|---|---|
| Browser extension | Adds capture signal but not critical path. Git + AI sessions + terminal cover 80% of reasoning | Week 2 |
| Cloud distill (frontier LLMs) | Ollama is good enough for v1. Cloud adds latency, cost, and privacy concerns | When Unfade Pro launches |
| Team Unfades | Requires multi-user infrastructure. Solo developer experience must be perfect first | Week 3-4 |
| Hosted `unfade.dev/username` | Self-hosted static site is sufficient for launch. Hosted profiles are the first paid feature | Week 3 |
| Windows support | Go daemon supports it, but shell hooks need PowerShell testing. macOS/Linux first | Week 2 |
| Collaborative reasoning | Needs multiple users on the same repo. Complexity is high | Month 2 |
| Enterprise features (SSO, admin) | No enterprise customers yet. Build when someone asks with a PO | When someone pays |

---

## The Acid Test for Each Day

Before posting anything, ask yourself:

1. **Can a stranger install this and get value in 5 minutes?** If not, fix the install path before shipping.
2. **Does the output feel like "this tool is learning me" or "this tool is logging my activity"?** If the latter, rewrite the distill prompt. The personalization signal is the difference between Unfade and every competitor.
3. **Would I share this screenshot/card on my own X account?** If not, it's not ready for others to share.

The one-week timeline is aggressive but achievable because the core architecture is simple: an invisible Go daemon + LLM prompt chain + local HTTP/MCP server + htmx web UI + image generator + static site generator. No databases, no auth, no cloud infrastructure. Everything runs locally on the developer's machine. That simplicity is both the shipping speed advantage and the privacy guarantee that makes the product trustworthy.

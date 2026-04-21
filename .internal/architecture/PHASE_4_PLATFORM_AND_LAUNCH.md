# Phase 4 -- Platform & Launch

> **Feature Statement:** _"Run `unfade`. Your direction ratio updates while you code. Your dashboard is live at localhost:7654. When you're done, Ctrl+C. Tomorrow, run `unfade` again -- it picks up exactly where it left off. The Thinking Graph renders your accumulated reasoning as a visual profile. No daemon management, no autostart debugging, no orphaned processes."_
>
> **Prerequisites:** Phase 3 -- Identity & Personalization complete (full personalization engine, pattern detection, domain tracking, amplification v2, profile building, enhanced similar-decision search)
>
> **Phase sequence:** Foundation -> Capture & Intelligence -> Context & Integration -> Identity & Personalization -> **Platform & Launch**

---

## 1. Business Justification

### 1.1 The Insight Gap

Today's developer tools show activity (commits, lines, PRs). They do not show reasoning quality in the AI-assisted era: alternatives considered, rejections, course corrections, domain injection into prompts. That information already exists locally -- fragmented across Cursor DB, Claude JSONL, Codex sessions -- but no unified, local-first layer turns it into a durable identity signal.

METR's randomized controlled trial found experienced developers were 19% slower with AI tools on real codebases, yet perceived themselves 24% faster. Addy Osmani named the crisis "comprehension debt" -- developers score 17% lower on understanding their own AI-assisted code. No tool on the market measures whether a developer actually understands what they shipped. Unfade does.

What a developer does not know today -- and will discover through Unfade:

| What you don't know | What Unfade shows you |
|---|---|
| Your direction ratio -- what percentage of your AI-assisted day you actually steered vs followed | "Today: 73% human-directed decisions. You overrode Claude 4 times in the auth module -- each time injecting domain knowledge the model didn't have." |
| Your judgment moments -- the specific points where you rejected AI and were right | "At 2:14pm you refused a singleton pattern and directed toward dependency injection. That's an architectural judgment call." |
| Your reasoning velocity -- whether you're getting faster at making good decisions in a domain | "Auth decisions that took you 6 back-and-forth turns last month now take 2. Your reasoning velocity: +56%." |
| Your comprehension score -- do you actually understand the code you shipped with AI? | "Auth module: comprehension 82 -- you engaged deeply. Payments: comprehension 31 -- you accepted 90% verbatim." |
| Your reasoning fingerprint -- a behavioral identity that proves how you think, not just what you shipped | A shareable Card: "Systems Architect. 78% human-directed. Comprehension: 74. Not a vibe coder." |

### 1.2 The Accountability Gap

Engineering and finance leads need answers that git cannot give:

| Leadership question | What Unfade tells them |
|---|---|
| "Where are our AI dollars going?" | Per-repo, per-model token proxy -- "Project X consumed ~$420 in Claude Opus this month, 60% on the payments module." |
| "Is this engineer using AI well or just rubber-stamping?" | Direction density: "Engineer A modifies 68% of AI suggestions. Engineer B accepts 91% verbatim." |
| "Can I justify this AI tooling budget to the CFO?" | Export pack: numeric rollup of token spend x reasoning quality x efficiency gains -- with methodology doc. Local evidence, not vibes. |

### 1.3 Why This Phase Exists

Phase 4 consolidates everything built in Phases 0--3 into a production-ready platform. Three strategic objectives:

1. **Server-first runtime.** Replace the multi-process, multi-start-mechanism architecture with a single `unfade` command that starts everything. Inspired by `next dev` and `vite` -- run one command, everything works, Ctrl+C when done.

2. **Continuous intelligence.** Transform Unfade from a batch-oriented logger (distill when you remember) into a continuous intelligence layer where direction ratio, comprehension score, and reasoning velocity update while you work.

3. **Ecosystem distribution.** The Thinking Graph transforms `.unfade/` data into a shareable visual identity. ClawHub skill and MCP Registry entry make Unfade discoverable. npm package enables `npx unfade`.

---

## 2. Problem Statement

### 2.1 Runtime Complexity

Before this phase, Unfade had accumulated significant runtime complexity:

**Seven start mechanisms:** launchd plist per repo, systemd unit per repo, launchd coordinator, systemd coordinator, detached Node spawn for Go daemon, detached Node spawn for HTTP server, and foreground in-process for `unfade server start`.

**Six diagnostic steps when something breaks:** Is the Go daemon running? Is it capturing events? Is the HTTP server running? Is the materializer running? Is launchd/systemd managing it? Is the right repo targeted? For an open-source tool that should delight on first use, this is unacceptable.

**Batch-gated intelligence:** RDI, direction density, comprehension scores, and metric snapshots only update when `distill` runs. The product feels batchy despite rich real-time event capture. Users must remember to run a command to see their day.

### 2.2 Target State

| Concern | Target |
|---|---|
| Starting Unfade | Single command: `unfade`. Everything starts. Ctrl+C stops cleanly |
| Debugging stale data | One question: "Is `unfade` running?" |
| Intelligence cadence | Continuous -- direction ratio updates within seconds of new events, without waiting for distill |
| Multi-repo | Single `unfade` watches all registered repos. Portfolio dashboard built-in |
| Enterprise boundary | Full individual experience is free. Enterprise adds always-on daemons, autostart, team features |
| Thinking Graph | `unfade publish` generates a deployable static site with visual reasoning identity |

---

## 3. Research

### 3.1 Developer Tool UX Patterns

| Tool | Runtime model | User experience |
|---|---|---|
| Next.js (`next dev`) | Single process: HTTP server + HMR + compiler | Run, works, Ctrl+C |
| Vite | Single process: HTTP server + file watcher + transformer | Run, works, Ctrl+C |
| Remix (`remix dev`) | Single process: HTTP server + file watcher + live reload | Run, works, Ctrl+C |
| Prisma Studio | Single process: HTTP server + DB connection | `npx prisma studio`, browser opens, Ctrl+C |
| Docker Desktop | Background daemon + GUI | Always-on, menubar icon -- enterprise-grade infra |

**Pattern:** Open-source developer tools that achieve mass adoption use the single long-running process model. Background daemons with autostart are enterprise/infrastructure patterns.

### 3.2 Open Source vs Enterprise Boundaries

| Product | Open Source | Enterprise/Paid |
|---|---|---|
| PostHog | Self-hosted analytics, all features | Cloud hosting, scale, support |
| Supabase | Self-hosted Postgres + auth + storage | Cloud hosting, edge functions, support |
| GitLab | Full CI/CD, all features | Premium features, compliance, support |
| Grafana | Dashboards, alerting | Enterprise plugins, SSO, audit logs |

**Pattern:** The most successful open-source products give away the full individual experience and charge for team/enterprise/ops features. The boundary is operational complexity (always-on, multi-machine, team aggregation, compliance), not feature-gating core capabilities.

### 3.3 Local-First Reference Patterns

| System | Global vs local | Mechanism |
|---|---|---|
| Git | `~/.gitconfig` vs `.git/` | Clear split; no duplicate role names |
| Docker | `~/.docker/` contexts | Named contexts point to environments |
| VS Code | User settings vs `.vscode/` | Workspace trust boundary |
| Obsidian | Vault = folder | SQLite inside vault for plugins -- colocation of index with content |

**Lesson:** Product source of truth for repo-scoped reasoning should stay next to the repo (`.unfade/`). Machine-global stores are for registry, defaults, and explicit cross-project aggregates only.

### 3.4 Embedded Databases

| Engine | Role in Unfade | Scope |
|---|---|---|
| JSONL | Append-only source of truth for events | Per-project |
| SQLite (`sql.js`) | Materialized read cache, FTS, aggregations | Per-project `.unfade/cache/unfade.db` |
| SQLite (optional) | Global read-optimized index over registered repos | `~/.unfade/cache/global_index.db` |

**Principle:** Every SQLite file is rebuildable from JSONL + config; never the sole owner of irreplaceable history.

### 3.5 Behavioral Psychology

Developer tools read as "intelligent" when they compress time (show a pattern the user would need hours to infer) and respect identity (strengthen self-story without shaming).

| Mechanism | Design lever |
|---|---|
| Prediction error / surprise | Occasional statistical contradictions paired with actionable context |
| Zeigarnik / open loops | "Since you last opened..." header pulls return visits |
| Variable reward | Mix micro-insights (always) with deeper arcs (sometimes, LLM-enriched) |
| Endowment / ownership | Local-first + evidence links make insight feel earned and non-fungible |
| Habit stacking | Attach micro-surface to existing rituals: shell exit, git push, morning `unfade status` |

**Guardrail:** Thrill must not become gotcha. Language and defaults optimize for curiosity and craft pride, not performance anxiety.

### 3.6 Static Site Generation

| Approach | Verdict |
|---|---|
| Raw HTML + CSS + SVG | Best fit -- single-page, no framework needed, fastest generation |
| Astro/11ty | Too heavy for a single page |
| React SSG | Unnecessary -- static data, no interactivity |

SVG is the best fit for the Decision Density Heatmap, following GitHub's contribution graph pattern.

---

## 4. Architecture

### 4.1 Server-First Runtime

The single `unfade` command starts a long-running Node process that manages everything:

```
+-------------------------------------------------------------------+
|  unfade (single Node process)                                      |
|                                                                    |
|  +--------------+  +----------------------+  +-----------+         |
|  | HTTP + SSE   |  | Per-Repo Materializers|  | Scheduler  |       |
|  | Dashboard    |  | (one per registered   |  | (daily     |       |
|  | Portfolio    |  |  repo, 2s timer each) |  |  distill   |       |
|  | MCP + API    |  |                       |  |  per repo) |       |
|  +--------------+  +----------+------------+  +------------+       |
|                               | reads                              |
|         +---------------------+----------------------+             |
|         |                     |                      |             |
|   repo-A/.unfade/       repo-B/.unfade/        repo-C/.unfade/     |
|   events/*.jsonl        events/*.jsonl         events/*.jsonl      |
|         ^                     ^                      ^             |
|         | writes              | writes               | writes     |
|  +------+-------+  +---------+--------+  +----------+-------+    |
|  | unfaded       |  | unfaded           |  | unfaded           |   |
|  | --project-dir |  | --project-dir     |  | --project-dir     |   |
|  | repo-A        |  | repo-B            |  | repo-C            |   |
|  | (child proc)  |  | (child proc)      |  | (child proc)      |   |
|  +---------------+  +------------------+  +------------------+    |
|                                                                    |
|  Registry: ~/.unfade/state/registry.v1.json                        |
+-------------------------------------------------------------------+
```

One `unfade` process manages N Go daemon children -- one per registered repo. Each repo keeps its own `.unfade/` tree. The registry (`~/.unfade/state/registry.v1.json`) is the source of truth for which repos are tracked.

### 4.2 Command Surface

| Command | Behavior | Lifetime |
|---|---|---|
| `unfade` | Start server for all registered repos: init cwd if needed, spawn daemon per repo, materializer per repo, HTTP, SSE, scheduler | Long-running (Ctrl+C to stop) |
| `unfade add <path>` | Register an additional repo in the registry | Instant |
| `unfade status` | Read state files, print summary, exit | Instant |
| `unfade distill` | Run one-shot distill for cwd repo, exit | Seconds |
| `unfade doctor` | Print diagnostics for all repos, exit | Instant |
| `unfade card` | Generate card for cwd repo, exit | Instant |
| `unfade export` | Export archive, exit | Seconds |
| `unfade query <search>` | Search history in cwd repo, exit | Instant |
| `unfade publish` | Generate static Thinking Graph site, exit | Seconds |

Only bare `unfade` starts the long-running server. Everything else is run-and-exit.

### 4.3 Embedded Daemon and RepoManager

The Go daemon runs as a managed child process of the Node server:

- **Not detached** -- when the Node process exits, the child receives SIGTERM. No orphaned processes.
- **Stderr piped to Node logger** -- single unified log stream for the user.
- **Crash recovery** -- exponential backoff: 1s, 2s, 4s, up to 30s max. Reset backoff counter after 60s of stable running. Skip restart during graceful shutdown.

The `RepoManager` class manages N `EmbeddedDaemon` + N `MaterializerDaemon` pairs, one per registered repo. Methods: `addRepo(entry)`, `removeRepo(id)`, `getAll()`, `shutdownAll()`. Used by the server on startup (iterate registry) and by the registry watcher (hot-add new repos).

Implementation: `src/services/daemon/embedded-daemon.ts`, `src/services/daemon/repo-manager.ts`.

### 4.4 Continuous Intelligence and Materializer

The Continuous Intelligence Layer (CIL) turns append-only event capture into claims users can feel -- scores, summaries, and insights -- on a clock independent of user-initiated distill.

**Processing planes:**

| Plane | Trigger | Computes |
|---|---|---|
| P0 -- Capture | OS / file events | Normalize, append `events/*.jsonl` |
| P1 -- Incremental index | Debounced batch / idle 2s | Upsert `unfade.db` rows, rollups, FTS diff |
| P2 -- Insight emitters | P1 commit or timer | Heuristic insight candidates, `summary.json` |
| P3 -- LLM enrichment | Queue depth, schedule | Narrative distill, ambiguous classification |

**Failure isolation:** P3 stalls must never empty P2; users still see honest heuristics and freshness timestamps. LLM work deepens but does not unlock baseline honesty of the system.

**MaterializerDaemon** runs on a 2-second interval per repo:
- Tail-reads `events/*.jsonl` from cursor byte offset
- Upserts into SQLite cache (`unfade.db`)
- Computes comprehension scores, direction windows, reasoning velocity
- Atomically writes `summary.json` (under 4KB, powers dashboard first-paint)

**Rolling window aggregates:** 1h, 8h, 24h, 7d windows for direction density, tool mix, event cadence. Bounded cardinality, never unbounded scans.

**Intelligence services** (all in `src/services/intelligence/`): comprehension scoring (composite = mod_depth x 0.4 + specificity x 0.3 + rejection x 0.3), file direction tracking, reasoning velocity via linear regression over trailing 30 daily RDI snapshots, window aggregation, cost-quality analysis, domain tagging, methodology detection, nudges, identity building, first-run analysis, and insight generation (6 types: cross_domain, temporal, milestone, anomaly, skill, trend).

Implementation: `src/services/cache/materializer-daemon.ts`, `src/services/cache/materializer.ts`, `src/services/intelligence/summary-writer.ts`, `src/services/intelligence/window-aggregator.ts`.

### 4.5 Resume-From-Where-Left-Off

Every restart of `unfade` picks up exactly where the last session left off. No re-processing. No data loss. No duplicate events. The developer runs `unfade` Monday, works 4 hours, Ctrl+C. Runs `unfade` Tuesday -- dashboard shows full history within 5 seconds.

**Three cursor mechanisms:**

| Cursor | File | What it tracks |
|---|---|---|
| Go ingest cursor | `.unfade/state/ingest.json` | Per-AI-tool file processing progress |
| Materializer cursor | `.unfade/state/materializer.json` | Per-JSONL-file byte offset + SHA-256 hash |
| Distill date index | `.unfade/distills/*.md` existence | Which dates have been distilled |

**Startup sequence:** Load config, read materializer cursor, spawn Go daemon as managed child (it reads ingest.json internally), wait for daemon IPC socket (max 10s), trigger historical ingest via IPC (daemon skips already-processed files), start materializer (resumes from cursor byte_offset), first summary.json write (immediate dashboard data), start HTTP server, start distill scheduler, print banner.

**Graceful shutdown sequence:** Stop schedulers, final materializer tick, save materializer cursor with final byte offsets, SIGTERM to Go daemon (it flushes event writer and saves ingest.json), wait max 5s for daemon exit then SIGKILL, close HTTP server, remove server.json, exit 0.

**Edge cases:** SIGKILL recovery triggers hash mismatch detection and falls back to full rebuild. JSONL truncation detected via SHA-256. Go daemon crash triggers exponential backoff restart. New AI tool data between sessions discovered by daemon on startup.

### 4.6 Multi-Repo Management

The server watches all registered repos, not just the repo where `unfade` was launched. On first run, the current repo is registered automatically. Additional repos are registered via `unfade add <path>`.

**Hot-add:** When a new repo is registered while the server is running, the server detects the registry change within 60 seconds and adds a daemon child + materializer -- no restart required.

**Registry:** `~/.unfade/state/registry.v1.json` with versioned schema, canonical repo root pointers, stable UUID per repo, human label, last-seen timestamp, and capabilities metadata.

**Portfolio dashboard:** HTTP server at localhost:7654 shows all repos at a glance. Click to drill down to per-repo dashboard with direction density, comprehension, judgment reel, iteration map, and arc panels.

### 4.7 Data Flow

```
External AI tools (Claude, Cursor, Codex, Aider)
    +---> ~/.claude/, ~/.cursor/, ~/.codex/ (AI session data)

Per repo (N repos from registry):
  Go daemon child (unfaded --project-dir <repo-root>)
      +---> watches AI tool data directories (filters by project path)
      +---> watches <repo>/.git/ for commits
      +---> receives terminal events via <repo>/.unfade/state/daemon.sock
      +---> writes <repo>/.unfade/events/YYYY-MM-DD.jsonl

  Materializer (Node, 2s timer per repo)
      +---> tail-reads events/*.jsonl from cursor offset
      +---> upserts <repo>/.unfade/cache/unfade.db (SQLite)
      +---> computes comprehension, direction windows, velocity
      +---> writes <repo>/.unfade/state/summary.json (atomic)

Global (one instance):
  HTTP Server (Node, Hono)
      +---> portfolio dashboard at localhost:7654
      +---> per-repo drill-down at localhost:7654/repos/:id
      +---> SSE updates from per-repo summary.json files
      +---> MCP at localhost:7654/mcp
      +---> API routes (heatmap, repos, insights, decisions)

  Scheduler (Node, daily timer per repo)
      +---> triggers distill for each repo at configured time

  Registry watcher (60s poll)
      +---> detects new repos -> hot-adds daemon + materializer
```

### 4.8 Directory Architecture

**User home (`~/.unfade/`):** config.json (user defaults), state/registry.v1.json (canonical repo roots), cache/global_index.db (optional cross-repo rollups).

**Per project (`<repo>/.unfade/`):**

```
.unfade/
+-- config.json
+-- state/          daemon.pid, daemon.sock, server.json, ingest.json,
|                   materializer.json, summary.json, health.json
+-- events/         YYYY-MM-DD.jsonl (Go daemon writes, append-only)
+-- cache/          unfade.db (SQLite, rebuildable from JSONL)
+-- distills/       Markdown daily distills (TypeScript writes)
+-- profile/        reasoning_model.json (v2)
+-- graph/          decisions.jsonl, domains.json
+-- metrics/        daily.jsonl
+-- insights/       recent.jsonl (ring buffer)
+-- amplification/  Cross-session connections
+-- cards/          Generated PNG Unfade Cards
+-- site/           Generated Thinking Graph static site
+-- bin/            Go binaries (unfaded, unfade-send)
+-- logs/           daemon.log, daemon.stderr.log
```

**One writer per file** prevents corruption. Go daemon owns `events/`. TypeScript owns `distills/`, `profile/`, `graph/`, `cache/`, `state/summary.json`.

### 4.9 RRVV Framework

The intelligence layer follows RRVV: Relevance, Recency, Velocity, Volume.

- **Relevance:** Insights are evidence-linked claims, not generic activity counts. Fusion of AI transcripts + git + terminal produces non-replicable signals.
- **Recency:** Rolling windows (1h, 8h, 24h, 7d) with trailing baselines. "Since you last opened..." headers.
- **Velocity:** Reasoning velocity computed via linear regression over trailing 30 daily RDI snapshots. Requires 7+ data points.
- **Volume:** Token proxy attribution by model, repo, and contributor. Cost-per-reasoning-quality metric.

### 4.10 Thinking Graph

`unfade publish` generates a deployable static site at `.unfade/site/`:

**Visual components:**
- Decision Density Heatmap (SVG): 52 columns x 7 rows, GitHub-style, 5 intensity levels. Formula: `intensity = decisions + (trade_offs x 1.5) + (dead_ends x 2)`.
- Domain Distribution bars from reasoning model
- Reasoning Profile card with direction ratio, comprehension score, top patterns
- Recent Distills list (last 7-30 days, collapsible)
- OG meta tags for social sharing

**Data pipeline:** Site generator reads events, distills, and profile. Computes heatmap data (decision count per day for 90 days), extracts domain distribution, compiles recent distills. Renders single-page HTML with inline CSS + SVG. Dark theme, responsive, minimum viewport 320px. No JavaScript runtime required.

**Deployment:** Copy-paste commands for Vercel (`npx vercel .unfade/site`), Netlify, GitHub Pages. Output under 200KB (excluding OG image).

Implementation: `src/services/site/site-generator.ts`, `src/services/site/heatmap.ts`, `src/services/site/template.ts`, `src/commands/publish.ts`.

### 4.11 Ecosystem Distribution

**ClawHub skill (`unfade-memory`):** Progressive disclosure SKILL.md, manifest.json with MCP transport config (stdio via `npx unfade mcp`). All 7 MCP tools listed.

**MCP Registry:** `server.json` at project root with name, version, transport, capabilities (tools, resources, prompts).

**npm package:** `bin.unfade` -> `./dist/cli.mjs`. Optional dependencies for platform-specific Go binaries: `@unfade/daemon-darwin-arm64`, `@unfade/daemon-darwin-x64`, `@unfade/daemon-linux-arm64`, `@unfade/daemon-linux-x64`. Release workflow cross-compiles with `CGO_ENABLED=0`, publishes daemon packages before the main `unfade` package.

### 4.12 Simplified Init

**Before (8 steps):** Scaffold, fingerprint, ensure binary, install shell hooks, install autostart (launchd/systemd), LLM config wizard, start daemon, backfill via IPC.

**After (4 steps):** Scaffold `.unfade/`, ensure binary, install shell hooks, LLM config wizard. Then: "Run `unfade` to start capturing and analyzing."

No daemon spawn. No autostart. No backfill IPC. The server handles all of that when it starts. LLM configuration preserved intact -- web UI settings page at localhost:7654/settings. Each repo can have its own LLM configuration in multi-repo mode.

### 4.13 Enterprise Boundary

| Capability | Open Source | Enterprise |
|---|---|---|
| Live capture while `unfade` runs | Yes | Yes |
| Historical analysis from disk | Yes | Yes |
| Resume from where left off | Yes | Yes |
| Multi-repo from single `unfade` command | Yes | Yes |
| Portfolio dashboard | Yes | Yes |
| Dashboard + SSE + heatmap per repo | Yes | Yes |
| MCP server | Yes | Yes |
| Comprehension, direction, velocity | Yes | Yes |
| Cards, Thinking Graph | Yes | Yes |
| LLM config (wizard + web settings) | Yes | Yes |
| Always-on background daemon | -- | Yes |
| Autostart (launchd/systemd) | -- | Yes |
| Multi-machine aggregation | -- | Yes |
| Team dashboards (cross-developer) | -- | Yes |
| Leadership export with org rollups | -- | Yes |

The open-source limitation is not a missing feature -- it is operator convenience. The natural upgrade path: the developer has experienced the full product and wants always-on capture and team aggregation.

---

## 5. Design Principles

1. **A stranger gets value in 5 minutes.** `npx unfade`. First insight appears from historical data already on their machine.

2. **One command, everything works.** `unfade` starts the server, daemons, materializers, scheduler, dashboard, and MCP. Ctrl+C stops cleanly.

3. **Continuous intelligence, not batch logging.** Direction ratio, comprehension score, and reasoning velocity update while you work. Distill is enrichment, not the gate to core signals.

4. **Resume is an invariant.** Every restart picks up exactly where the last session left off. No re-processing, no data loss, no duplicate events.

5. **JSONL is truth, SQLite is cache.** Every SQLite file is rebuildable from JSONL + config. Append-only writes on the hot path.

6. **stdout is sacred.** All logging, progress, TUI rendering, and user messages go to stderr. stdout is only for MCP JSON-RPC.

7. **The Thinking Graph is the resume.** Beautiful enough that developers link it in bios and job applications. Dark theme, clean typography, information density without clutter.

8. **Honest degradation beats silent staleness.** When load is high, emit degraded summary.json with `confidence=low` and explicit `ingest_lag_ms`. Never pretend data is fresh when it is not.

9. **Dual projection, single core.** Developer and leadership experiences are views over the same local evidence, not two pipelines. Developer view is a superset of leadership view.

10. **Static means no runtime.** `unfade publish` generates HTML + CSS + SVG. No JavaScript runtime. No database. No server. Deploy to any static host.

---

## 6. Implementation Summary

### 6.1 Server-First Runtime

The unified server entry point (`src/server/unfade-server.ts`) reads the registry, orchestrates all subsystems for all registered repos in-process. For each repo: spawn embedded daemon, start materializer. Globally: start HTTP server, start scheduler, print banner. Polls registry every 60s to hot-add new repos. Returns a `RunningUnfade` handle with `shutdown()` method.

Bare `unfade` in `cli.ts`: if cwd not in registry, run lightweight init (register cwd), then `startUnfadeServer`. SIGINT/SIGTERM triggers `handle.shutdown()`.

### 6.2 Embedded Daemon Lifecycle

`EmbeddedDaemon` class (`src/services/daemon/embedded-daemon.ts`): spawns `unfaded --project-dir <repoRoot>` as a non-detached child. Exposes `start()`, `stop()`, `isRunning()`, `getPid()`, `getRestartCount()`, `getUptimeMs()`. Crash recovery with exponential backoff. Stderr piped to Node logger with `[capture:<label>]` prefix.

`RepoManager` class (`src/services/daemon/repo-manager.ts`): manages N EmbeddedDaemon + N MaterializerDaemon pairs. Methods: `addRepo(entry)`, `removeRepo(id)`, `getAll()`, `shutdownAll()`, `getHealthStatus()`.

### 6.3 Continuous Intelligence

`MaterializerDaemon` class (`src/services/cache/materializer-daemon.ts`): configurable interval, initial rebuild if DB empty, then incremental ticks via `materializeIncremental()`. Graceful close: final tick, save cursor, close DB.

Summary writer (`src/services/intelligence/summary-writer.ts`): produces `SummaryJson` with schema version, freshness, direction density (24h), event count, comprehension score, top domain, tool mix, reasoning velocity proxy.

Window aggregator (`src/services/intelligence/window-aggregator.ts`): WINDOW_SIZES = 1h, 8h, 24h, 7d. Max 4 historical entries per window.

20 intelligence service modules covering comprehension, cost-quality, domain tagging, file direction, first-run analysis, identity, insights, MCP enrichment, methodology, nudges, presentation, RDI, recent insights, snapshots, summaries, token proxy, and velocity.

### 6.4 Graceful Shutdown

Orchestrated shutdown sequence in `unfade-server.ts`: stop schedulers, final materializer tick + cursor save per repo, close materializers (triggers final tick + cursor save + DB close), SIGTERM to daemons with 5s timeout then SIGKILL, close HTTP server, remove server.json, print completion banner.

Shutdown banner (`src/cli/server-banner.ts`): prints each step as it completes. Shows per-repo cursor state and daemon PID on stop.

### 6.5 Simplified Init

Lightweight init (`src/services/init/lightweight-init.ts`): scaffold, ensure binary, shell hooks, config check. Idempotent. No daemon spawn, no autostart, no backfill.

Autostart code moved to `src/services/init/enterprise/` directory with `UNFADE_ENTERPRISE=true` env check. Coordinator mode in Go daemon gated similarly.

### 6.6 Thinking Graph and Ecosystem

Site generator, heatmap renderer (SVG), and HTML template in `src/services/site/`. `unfade publish` command orchestrates generation into `.unfade/site/`.

ClawHub skill: `skills/unfade-memory/SKILL.md` + `manifest.json`. MCP Registry: `server.json` at project root.

npm packaging: platform-specific optional dependencies for Go binaries, cross-compilation via `scripts/build-daemon.sh`, release workflow in `.github/workflows/release.yml`.

### 6.7 CLI Polish

`--json` output flag on `unfade query`, `unfade distill`, `unfade export` -- machine-readable JSON wrapped in response envelope with `_meta`.

Config migration infrastructure (`src/config/config-migrations.ts`): versioned migrations, sequential application, backup before mutation.

Error handling audit: all errors through response envelope, no raw stack traces in user-facing output, helpful messages for common issues (Ollama not installed, no git repo, `.unfade/` not found).

---

## 7. Success Metrics

| Metric | Target |
|---|---|
| Time from install to first insight | Under 30 seconds (init + `unfade` starts everything) |
| Time to first Distill | Under 5 minutes (including backfill) |
| Number of processes to understand | 1 (`unfade`) |
| Debugging "why is my dashboard stale?" | 1 step: "Is `unfade` running?" |
| Time from last event to updated summary.json | 5s p50, 60s p95 under multi-repo load |
| Thinking Graph generation | Under 10 seconds for 90 days of data |
| Thinking Graph page size | Under 200KB (HTML + CSS + SVG, excluding OG image) |
| Multi-repo dashboard load | Under 500ms for 20 repos |
| LLM cost for core metrics | Distill optional; 40%+ of days need no LLM |
| Habit proxy | 40%+ WAU open summary path without running distill |
| E2E test | Full workflow passes in CI |
| README clarity | New user installs without asking questions |

---

## 8. Risk Assessment

| Risk | Mitigation |
|---|---|
| Users forget to run `unfade` -- lose capture data | Clear messaging. Data is never lost -- next run picks up new AI session files from disk |
| Shell hooks fail when server is not running | `unfade-send` handles connection refused gracefully. Terminal events are lost but not critical |
| Multiple terminals, same repo | Second `unfade` detects existing `server.json`, prints "Already running" and exits |
| Performance of Node + Go in one process tree | Go daemon is a separate child process -- full performance isolation. Node handles only HTTP + materialization (I/O-bound) |
| Enterprise boundary feels like feature-gating | Framing: "full product for individual use" vs "ops convenience for teams." Open source has 100% of intelligence features |
| npm name `unfade` unavailable | Check npm registry. Alternative: `unfade-cli`, `@unfade/cli` |
| Thinking Graph looks bad on some screen sizes | Responsive CSS. Minimum viewport 320px. Test mobile, tablet, desktop |
| SIGKILL recovery | Cursor hash mismatch detection triggers safe full rebuild |
| SQLite corruption | Disposable cache; rebuild from JSONL |
| Insight fatigue / shame spiral | Tone rules, rate limits on nudges, user-controlled quiet hours |
| First-time user confusion | Init wizard quality, clear error messages, `--help` on every command, FAQ in README |
| Coordinator complexity | Ship registry + materializer before coordinator. Server-first model avoids need for coordinator entirely in open-source |

---

## 9. What Was Intentionally Deferred

| Feature | Why Deferred |
|---|---|
| Browser extension | Git + AI sessions + terminal cover 80% of reasoning signal |
| Cloud distill (frontier LLMs) | Ollama sufficient for v1. Cloud adds latency, cost, privacy concerns |
| Team Unfades | Requires multi-user infrastructure. Solo experience must be perfect first |
| Hosted `unfade.dev/username` | Self-hosted static site sufficient for launch. Hosted profiles = first paid feature |
| Collaborative reasoning | Needs multiple users on same repo. High complexity |
| Plugin SDK | Community connectors for VS Code, JetBrains, Windsurf |
| Predictive reasoning | "Based on your patterns, you'll likely want..." Needs 4+ months of data |
| Queryable second self | `unfade ask "How would I approach..."` answered from your reasoning |

---

> Phase 4 consolidates the runtime, intelligence, and distribution layers into a production-ready platform. After this phase, Unfade is a publicly available, MIT-licensed, npm-installable CLI that captures engineering reasoning, distills it into personalized summaries, exposes it as context for every AI tool via MCP, updates intelligence continuously while you work, and renders it as a shareable visual identity. The temporal moat begins accumulating for every user from day one.

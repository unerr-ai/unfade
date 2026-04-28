# Unfade — Feature List

> Complete inventory of user-facing features across Dashboard, CLI, and MCP surfaces.
> Last updated: 2026-04-26

---

## Table of Contents

1. [Dashboard — Observe Layer](#dashboard--observe-layer)
2. [Dashboard — Understanding Layer](#dashboard--understanding-layer)
3. [Dashboard — Identity Layer](#dashboard--identity-layer)
4. [Dashboard — System Layer](#dashboard--system-layer)
5. [CLI Commands](#cli-commands)
6. [MCP Tools (AI Agent Surface)](#mcp-tools-ai-agent-surface)

---

## Dashboard — Observe Layer

### 1. Home

**At-a-glance overview of your engineering activity.**

- Hero metric: events captured in the last 24 hours
- KPI strip: projects tracked, decisions extracted, distills generated, active sessions
- Event activity area chart (time-series)
- Project cards with per-project status
- Latest insights surfaced by the intelligence pipeline
- Narrative headlines — natural-language claims about your work
- Adapts between global view (all projects) and per-project view

### 2. Live

**Real-time event feed — see your workflow as it happens.**

- Streaming feed of git commits, AI conversations, and terminal activity
- Virtualized list (handles thousands of events smoothly)
- Source filters: Git, AI Session, Terminal
- Count badges per source type
- Active session panel showing running AI sessions and daemon status
- Status indicator: "Engines running" / "Connecting..."
- Click any event to open an evidence drawer with full raw data

---

## Dashboard — Understanding Layer

### 3. Decisions

**Searchable log of engineering decisions extracted from your workflow.**

- Full-text search across all decisions
- Filter by project, domain, and time period (7d / 30d / 90d)
- Each decision card shows:
  - The decision and rationale
  - Direction classification: "You directed", "Collaborative", or "AI suggested"
  - Human Direction Score (0-100%)
  - Domain badge and project badge (human-readable name, not UUID)
  - Evidence event count
- Click any decision to open an evidence drawer with:
  - Full evidence trail (all linked events, no cap)
  - Each evidence event shows source (Git / AI Session / Terminal), type (Commit / AI Conversation / Branch Switch / Revert), branch, files touched, conversation title
  - Expandable file lists per event
  - Metrics panel: domain, date, project, origin, direction score, evidence count
- Pagination for large decision sets

### 4. Distill

**Daily reasoning summaries — auto-generated digests of your engineering day.**

- Date-navigable: browse any past day (prev/next arrows)
- Rendered markdown content: what you worked on, decisions made, trade-offs considered, dead ends hit
- Metadata display: decision count, domains covered, dead ends, trade-offs
- Regenerate on demand (re-synthesize with current LLM)
- Freshness badge showing data age
- Narrative headline extracted from the distill

### 5. Intelligence Hub

**8 intelligence cards with expandable detail tabs — your engineering analytics.**

| Card | What It Shows |
|------|---------------|
| **Vehicle Maturity** | Overall development maturity phase — how established your workflow is. Phases progress from initial setup through full autonomous operation. |
| **Efficiency (AES)** | AI Efficiency Score (0–100) — composite metric of how effectively you leverage AI tools. Interpretation: "Running lean" / "Nominal fuel consumption" / "Running rich". |
| **Comprehension** | Per-module comprehension radar — which parts of the codebase you understand deeply vs. rely on AI blindly. Overall percentage with per-module breakdown. |
| **Steering (Autonomy)** | Independence index — how much you direct AI vs. accept suggestions passively. "Steering with precision" / "Transmission engaging" / "Engine running without steering". |
| **Velocity** | Decision velocity — decisions/day with trend direction. "Accelerating" / "Decelerating" / "Cruising". |
| **Cost** | Estimated AI cost per directed decision — broken down by model, domain, and branch. Proxy estimates based on token usage, not actual invoices. |
| **Patterns** | Prompt pattern analysis — your most effective interaction patterns with effectiveness percentage. Detects anti-patterns and loop warnings. |
| **Git & Expertise** | File ownership, churn analysis, and expertise map across the codebase. Shows which areas you own vs. areas you're new to. |
| **Narratives** | Auto-generated narrative threads — natural-language claims about your work patterns. "Clear signal path" / "Threads emerging" / "Signal building". |

---

## Dashboard — Identity Layer

### 6. Profile

**Your engineering identity — built from your reasoning patterns, not commit counts.**

- Radar chart of domain expertise distribution
- Decision style stats:
  - Average alternatives evaluated per decision
  - AI acceptance rate and modification rate
  - Exploration depth (minutes)
- Detected behavioral patterns (e.g., "architectural thinking", "active steering", "high-durability decisions")
- Trade-off preferences with confidence scores and supporting/contradicting decision counts
- Temporal patterns: average decisions per day, most productive hours
- Identity line: auto-generated summary of your engineering traits
- Requires 2+ distills to detect patterns

### 7. Unfade Cards

**Shareable PNG identity cards — a visual summary of your engineering reasoning.**

- Generate cards with style selection (dark/light)
- Time range selection (7d / 30d / 90d)
- Preview generated card inline
- Download as PNG
- Copy shareable link
- History of previously generated cards with dates and sizes

---

## Dashboard — System Layer

### 8. Projects

**Manage tracked repositories.**

- List all registered projects with daemon status (running / stopped)
- Per-project actions: pause, resume, restart capture
- Discover new projects on disk (scans for git repos)
- One-click add to start tracking a discovered project
- Shows project path, label, and monitoring status

### 9. Settings

**Configure Unfade's behavior.**

- LLM configuration: provider (Anthropic, OpenAI, etc.), model, API key, custom base URL
- Validation status indicator (verified / not verified)
- Theme toggle: light / dark
- Persona mode selection (affects dashboard information density)

### 10. Integrations

**Connect AI tools for capture.**

- Shows detected AI tools: Claude Code, Cursor, Codex, Aider, and others
- Status per tool: Connected / Disconnected
- One-click connect to start capturing from each tool
- Shows configuration file path for each integration

### 11. Logs

**System diagnostic log viewer.**

- Filterable by log level: debug, info, warn, error
- Filterable by component: Capture Engine, Materializer, Intelligence, Server
- Full-text search across log messages
- Auto-scrolling with toggle
- Relative timestamps ("just now", "5m ago", "2h ago")
- Color-coded level badges

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `unfade` | Start everything — HTTP dashboard, MCP server, capture engines, materializer. Single command to run, Ctrl+C stops all cleanly. |
| `unfade add <path>` | Register a repository for tracking. Creates a `.unfade` marker file and adds to the global registry. |
| `unfade status` | Show what's running — daemon status per project, event counts, system health. |
| `unfade query <text>` | Search your reasoning history from the terminal — searches distills, events, and decisions. |
| `unfade distill [date]` | Manually trigger a daily reasoning summary for a specific date (defaults to today). |
| `unfade history` | Browse past distills from the terminal. |
| `unfade export` | Export your reasoning data in a portable format. |
| `unfade card` | Generate an Unfade Card (PNG identity card) from the command line. |
| `unfade tag` | Apply feature tags to events — group related events under a feature name. |
| `unfade publish` | Publish your thinking graph / profile to a shareable format. |
| `unfade doctor` | Diagnose and repair — rebuild caches, check daemon health, verify data integrity. |
| `unfade reset` | Reset captured data (with confirmation). |
| `unfade savings` | Show estimated time and cost savings from AI usage. |
| `unfade prompt` | Generate prompts from reasoning context — useful for bootstrapping AI sessions. |
| `unfade ingest` | Manually ingest events from external sources. |
| `unfade daemon` | Direct daemon control — start, stop, restart capture engines. |
| `unfade mcp` | Start standalone MCP server (without the full dashboard). |
| `unfade open` | Open the dashboard in your default browser. |

---

## MCP Tools (AI Agent Surface)

These tools are exposed via the Model Context Protocol, making every AI tool aware of your prior reasoning without re-explaining.

| Tool | What AI Agents Get |
|------|-------------------|
| `unfade_query` | Search across reasoning history — distills, events, decisions. Supports date range filters and project scoping. |
| `unfade_context` | Recent reasoning context — what you were working on and why. Scopes: last 2 hours, today, or this week. |
| `unfade_decisions` | List engineering decisions with rationale, domain, project name (human-readable), and evidence chain. Filterable by domain and project. |
| `unfade_profile` | Your reasoning profile — decision style, domain expertise, behavioral patterns, trade-off preferences. |
| `unfade_distill` | Trigger distillation from within an AI session — synthesize a day's reasoning into a summary on demand. |
| `unfade_amplify` | Cross-temporal connection detection — find past decisions similar to today's reasoning. Surfaces "you dealt with something like this before" moments. |
| `unfade_similar` | Find analogous past decisions for a given problem description — semantic search across your decision history. |
| `unfade_log` | Log a structured reasoning event — active instrumentation by the AI agent. Records decisions, trade-offs, alternatives considered, and confidence levels. |
| `unfade_comprehension` | Per-module comprehension scores — which parts of the codebase you understand deeply vs. rely on AI blindly. |
| `unfade_efficiency` | AI Efficiency Score (AES) with configurable time period (7d / 30d / 90d). |
| `unfade_costs` | Cost attribution — estimated AI spend broken down by model, domain, or branch. |
| `unfade_coach` | Domain-specific prompt coaching — surfaces effective patterns, anti-patterns, and active loop warnings from your AI interaction history. |

---

## Feature Count Summary

| Surface | Features |
|---------|----------|
| Dashboard pages | 11 |
| Intelligence cards | 8 |
| CLI commands | 17 |
| MCP tools | 12 |
| **Total** | **48** |

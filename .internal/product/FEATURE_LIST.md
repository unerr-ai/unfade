# Unfade — Feature Groups

> Complete inventory of user-facing features in the free open-source product, organized by what they do and the computation they share. No enterprise or team features. Everything here runs locally.
>
> Each group is a cluster of features that share a common data source, computation pipeline, or strategic purpose. Features within a group are listed across all surfaces (dashboard, MCP, automated) because the same underlying engine powers them regardless of where the user accesses them.
>
> **CLI-light model:** Unfade is a dashboard-first product. The CLI exists only as the initial entry point (`unfade` to start — first run triggers onboarding automatically). All ongoing interaction, configuration, and exploration happens through the dashboard or is automated. MCP tools serve AI integrations programmatically.
>
> **Last updated:** April 2026

---

## Table of Contents

1. [Passive Capture](#1-passive-capture)
2. [Cross-Tool Context Injection](#2-cross-tool-context-injection)
3. [Daily Distill](#3-daily-distill)
4. [Decisions](#4-decisions)
5. [Comprehension](#5-comprehension)
6. [Direction & Autonomy](#6-direction--autonomy)
7. [Efficiency & Cost](#7-efficiency--cost)
8. [Velocity & Patterns](#8-velocity--patterns)
9. [Expertise & Codebase Knowledge](#9-expertise--codebase-knowledge)
10. [Personalization & Amplification](#10-personalization--amplification)
11. [Thinking Identity](#11-thinking-identity)
12. [Narrative Intelligence](#12-narrative-intelligence)
---

## 1. Passive Capture

**What this group does:** Records engineering reasoning from your existing workflow. Zero effort after install. This is the data source that feeds every other feature group.

**Computation base:** Go capture daemon (`unfaded` binary) with two modes -- one instance per tracked repo (git watcher) and one global instance (AI session watcher). Both write date-partitioned JSONL to `~/.unfade/events/`. Materialization pipeline ingests JSONL into DuckDB (analytics) and SQLite (search/lookups).

**Why it matters:** Without capture, nothing else works. This is the foundation layer. Every other group consumes what capture produces.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Git capture** | Background daemon | Watches `.git/` via fsnotify. Captures commits, diffs, branch switches, reverts, stashes, merge conflicts. 500ms debounce. One instance per tracked repo. |
| **AI session capture** | Background daemon | 10s poll on `~/.claude/`, Cursor, Codex, Aider directories. Parses conversation files into structured events with intent summary, outcome, model, token counts. One global instance. |
| **Terminal capture** | Background daemon | Captures commands, error outputs, retry patterns. Detects debugging sessions and exploration arcs. |
| **Git history backfill** | Onboarding (automated) | On first registration, walks `git log` to backfill past commits. Produces the Reasoning Fingerprint within 60 seconds of install -- no waiting for new activity. |
| **Live event feed** | Dashboard: Live page | Real-time streaming feed of all captured events. Source filters (Git / AI Session / Terminal). Count badges per type. Virtualized list for large volumes. |
| **Active session panel** | Dashboard: Live page | Shows currently running AI sessions and daemon status. "Engines running" / "Connecting..." indicator. |
| **Event evidence drawer** | Dashboard: Live page | Click any event to inspect full raw data -- source, type, files, branch, timestamps, content. |
| **Integration status** | Dashboard: Integrations page | Shows detected AI tools (Claude Code, Cursor, Codex, Aider). Connected/Disconnected status per tool. One-click connect. Configuration file path per integration. |

---

## 2. Cross-Tool Context Injection

**What this group does:** Makes every AI tool aware of your prior reasoning without re-explaining. This is where Unfade delivers immediate Day 1 value.

**Computation base:** MCP server running on `localhost:7654`. Exposes resources (auto-discoverable context), tools (semantic search, comprehension queries), and prompts (reusable templates). Any MCP-compatible AI tool can query it. Also available as local HTTP API.

**Why it matters:** This is the entry point. It saves 10-15 minutes of re-explanation per AI session. It's the feature that makes developers keep the daemon running.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Recent context retrieval** | MCP: `unfade_context` | Returns structured reasoning context -- what you were working on and why. Configurable scope: last 2 hours, today, or this week. AI tools call this automatically to resume where you left off. |
| **Semantic reasoning search** | Dashboard: search, MCP: `unfade_query` | Full-text search across distills, events, and decisions. Date range and project scoping. Find any past reasoning from any tool. |
| **Decision retrieval** | MCP: `unfade_decisions` | List engineering decisions with rationale, domain, project name, and evidence chain. Filterable by domain and project. AI tools use this to avoid contradicting past decisions. |
| **Profile injection** | MCP: `unfade_profile` | Returns your reasoning profile -- decision style, domain expertise, behavioral patterns, trade-off preferences. AI tools use this to tailor responses to how you think. |
| **Comprehension-aware context** | MCP: `unfade_comprehension` | Per-module comprehension scores. AI tools adapt guidance based on where you're strong vs. where you need support. |
| **Analogous reasoning** | MCP: `unfade_similar` | Finds past decisions similar to a given problem description. Semantic search across your full decision history. "You solved something like this before." |
| **On-demand distill** | MCP: `unfade_distill` | Trigger distillation from within an AI session. Synthesize reasoning into a summary without leaving the current tool. |
| **Active reasoning logging** | MCP: `unfade_log` | AI agents can log structured reasoning events -- decisions, trade-offs, alternatives considered, confidence levels. Active instrumentation from within AI sessions. |
| **Prompt generation** | MCP: auto-context | Generates prompts from reasoning context automatically. Bootstraps AI sessions with relevant history via MCP resources. |
| **Standalone MCP server** | Automated (part of `unfade` startup) | MCP server starts automatically with the main process. Minimal footprint, zero configuration. |

---

## 3. Daily Distill

**What this group does:** Auto-generates structured reasoning summaries from your engineering day. Not a commit log -- a thinking log. The daily habit that creates engagement.

**Computation base:** Distill pipeline (`distiller.ts`): events -> signal extraction -> context linking -> signal fusion -> LLM synthesis -> narrative building -> profile update -> graph update -> write markdown. Runs through local LLM (Ollama), any OpenAI-compatible API, or a structured fallback synthesizer that works with zero API keys.

**Why it matters:** The distill is the 2-minute daily review ritual. It creates the habit loop (Layer 2). Every distill feeds the personalization model, the Thinking Graph, and the decision archive.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Daily synthesis** | Automated (background) | Generates a structured reasoning summary for each day automatically. Covers: decisions made, trade-offs navigated, dead ends explored, breakthroughs, thinking patterns. Idempotent -- re-running overwrites cleanly. |
| **Backfill** | Onboarding (automated) | Generates distills for the past N days from existing git and AI session history during onboarding. Produces weeks of reasoning summaries immediately after install. Throttled at 10s intervals. |
| **Distill browser** | Dashboard: Distill page | Date-navigable rendered markdown distills. Prev/next arrows to browse any past day. Metadata display: decision count, domains covered, dead ends, trade-offs. Narrative headline. Freshness badge. |
| **Distill history** | Dashboard: Distill page | Browse past distills with date navigation. Quick access to reasoning summaries. |
| **Regeneration** | Dashboard: Distill page | Re-synthesize any day's distill on demand with current LLM. Useful after changing LLM provider or when better models become available. |
| **Signal extraction** | Internal pipeline | Extracts raw signals from captured events: direction signals (who drove each decision), complexity signals, domain signals, outcome signals. Feeds into all downstream analysis. |
| **Context linking** | Internal pipeline | Links related events across tools. A commit, the AI conversation that preceded it, and the terminal debugging session that led to it get connected into a reasoning arc. |
| **Conversation digestion** | Internal pipeline | Summarizes AI conversations into structured records: intent, approach, outcome, decision points, alternatives considered. |

---

## 4. Decisions

**What this group does:** Extracts, classifies, stores, and makes searchable every engineering decision from your workflow. The reasoning archive.

**Computation base:** Decision extraction from distill pipeline (`decision-records.ts`) + decision replay analyzer + decision durability tracking. Stored in SQLite with full-text search. Direction scoring classifies each decision as "You directed," "Collaborative," or "AI suggested."

**Why it matters:** Decisions are the atomic unit of reasoning. Every other feature group either produces decisions (capture, distill) or consumes them (comprehension, identity, amplification). This is the queryable memory of why your code is the way it is.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Decision search** | Dashboard: Decisions page | Full-text search across all decisions. Filter by project, domain, and time period (7d / 30d / 90d). |
| **Decision cards** | Dashboard: Decisions page | Each decision shows: rationale, direction classification, Human Direction Score (0-100%), domain badge, project name, evidence event count. |
| **Evidence trail** | Dashboard: Decisions page | Click any decision to open an evidence drawer with the full provenance chain -- all linked events with source (Git / AI / Terminal), type, branch, files, conversation title. No artificial caps on evidence display. |
| **Decision retrieval** | MCP: `unfade_decisions` | Programmatic access to decisions with filtering. AI tools query this to avoid contradicting or duplicating past decisions. |
| **Decision replay** | Intelligence: decision-replay analyzer | Resurfaces past decisions when new contradictory evidence appears. "You decided X two weeks ago, but today's commit reverts that approach." |
| **Feature tagging** | Dashboard: Decisions page | Group related decisions under a feature name. Links events that belong to the same logical change across days and tools. |

---

## 5. Comprehension

**What this group does:** Tracks how deeply you understand different parts of your codebase. The single metric that answers "Am I understanding more or less as I use AI?"

**Computation base:** Comprehension radar analyzer + FSRS decay model `(1 + t/(9*stability))^(-1)` + per-module engagement tracking + blind spot detection. Reads from direction scoring, session intelligence, and modification rate data in DuckDB. Threshold: below 40 = blind spot, minimum 5 events per module for assessment.

**Why it matters:** This is Unfade's core differentiator. No other tool measures comprehension. Every competitor measures output, activity, or code quality. Unfade measures whether you actually understand what you build.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Comprehension Score** | Dashboard: Intelligence Hub | Single 0-100 number tracking your overall comprehension trajectory. Trends over time. The "check engine light" for developer understanding. |
| **Per-module comprehension radar** | Dashboard: Intelligence Hub | Which parts of the codebase you understand deeply vs. rely on AI blindly. Visual breakdown by module. Overall percentage with per-module drill-down. |
| **Comprehension decay tracking** | Internal pipeline | FSRS-based decay model. "Auth comprehension at 0.42 -- will reach critical (0.30) in 2 weeks without engagement." Feeds into MCP context so AI tools know where you need extra guidance. |
| **Blind spot detection** | Intelligence: blind-spots analyzer | Identifies areas where you consistently accept AI output without modification over 2+ weeks. Potential comprehension gaps. |
| **Comprehension context for AI** | MCP: `unfade_comprehension` | AI tools query per-module comprehension scores. They adapt guidance based on where you're strong vs. where you need support. "You're editing the auth module. Your comprehension has decayed." |

---

## 6. Direction & Autonomy

**What this group does:** Measures whether you're steering AI or following it. The core measurement that distinguishes "collaborating with AI" from "delegating to AI."

**Computation base:** Direction scoring (`file-direction.ts`, `direction-classifier.ts`) + session intelligence analyzer + maturity model. Computes Human Direction Score (HDS) per decision, per file, per session, and aggregated over time windows. Window aggregator maintains rolling 7d/30d/90d views in DuckDB.

**Why it matters:** Direction is the leading indicator. When direction drops, comprehension follows. This group provides the early warning system that tells you before the problem shows up in production.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Independence index (Steering)** | Dashboard: Intelligence Hub | How much you direct AI vs. accept suggestions passively. "Steering with precision" / "Transmission engaging" / "Engine running without steering." |
| **Direction classification** | Distill pipeline | Every decision classified as: "You directed" (you drove the approach), "Collaborative" (back-and-forth), or "AI suggested" (you accepted). Built from modification rates, prompt specificity, and session depth. |
| **Session intelligence** | Intelligence: session-intelligence analyzer | Detects deepening vs. shallow engagement within work sessions. Are your sessions getting richer or more superficial over time? |
| **Maturity assessment** | Intelligence: maturity-model analyzer | Where you sit on the AI collaboration maturity curve. Phases progress from passive acceptance through active direction to full autonomous collaboration. Data-driven, not self-reported. |
| **Efficiency scoring (AES)** | MCP: `unfade_efficiency` | AI Efficiency Score (0-100) with configurable time period. Composite: Direction (30%) + Token Efficiency (20%) + Iteration Ratio (20%) + Context Leverage (15%) + Modification Depth (15%). Phase-normalized and outcome-adjusted. |

---

## 7. Efficiency & Cost

**What this group does:** Tracks the economics of your AI collaboration -- where your tokens go, what they produce, and whether the spend is justified.

**Computation base:** Token proxy (`token-proxy.ts`) + cost attribution analyzer + value receipt generator. Estimates based on token counts from captured AI sessions and model pricing tables. Stored as typed columns in DuckDB for time-series queries.

**Why it matters:** Developers and managers need to justify AI tool spend. This group turns abstract "we use AI" into concrete "we spent $X this month, and it produced Y directed decisions across Z domains."

### Features

| Feature | Surface | What it does |
|---|---|---|
| **AI Efficiency Score** | Dashboard: Intelligence Hub | Composite 0-100 score of how effectively you leverage AI. Interpretation: "Running lean" / "Nominal" / "Running rich." |
| **Cost attribution** | Dashboard: Intelligence Hub | Estimated token spend broken down by model, domain, and branch. Proxy estimates based on captured token counts, not actual invoices. |
| **Cost per directed decision** | Intelligence: cost-attribution analyzer | How much AI spend produces a decision where you actually drove the outcome. Separates productive spend from churn. |
| **Cost breakdown for AI tools** | MCP: `unfade_costs` | Programmatic access to cost data. AI tools can surface "this session cost ~$3 and produced 2 directed decisions" without the user checking a dashboard. |
| **Savings estimate** | Dashboard: Intelligence Hub | Shows estimated time and cost savings from AI usage. How much re-explanation Unfade's context injection saved you. |

---

## 8. Velocity & Patterns

**What this group does:** Tracks your development momentum and how you communicate with AI tools. Not just speed -- the relationship between speed and understanding.

**Computation base:** Velocity tracker analyzer + prompt patterns analyzer + loop detector. Velocity measures decisions/day with domain-level breakdowns. Prompt patterns detects effective and anti-patterns from AI interaction history. Loop detector uses cosine similarity (0.7 threshold) on session embeddings to catch repeated dead ends.

**Why it matters:** Velocity without understanding is "productivity theater." Patterns reveal which communication approaches with AI actually work. Loop detection prevents wasted time on already-explored dead ends.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Velocity tracking** | Dashboard: Intelligence Hub | Decisions/day with trend direction. "Accelerating" / "Decelerating" / "Cruising." Domain-level breakdown shows where you're most active. |
| **Prompt pattern analysis** | Dashboard: Intelligence Hub | Your most effective AI interaction patterns with effectiveness percentage. Shows what communication styles lead to better outcomes. Detects anti-patterns. |
| **Loop detection** | Intelligence: loop-detector analyzer | Catches when you're re-exploring the same dead ends. "This is the third time you've explored a WebSocket approach and abandoned it. Your reasoning was consistent -- SSE covers the requirement." Threshold: 3+ similar failures on the same approach. |
| **Prompt coaching** | MCP: `unfade_coach` | Domain-specific prompt coaching for AI tools. Surfaces effective patterns, anti-patterns, and active loop warnings from your interaction history. AI tools can improve their own prompting on your behalf. |

---

## 9. Expertise & Codebase Knowledge

**What this group does:** Maps your domains of genuine expertise and your relationship with the codebase -- where you reason deeply vs. where you defer to defaults.

**Computation base:** Git expertise map analyzer + git file churn analyzer + domain classifier + knowledge graph substrate (CozoDB). Entity resolution (13 strategies) merges concepts across tools -- "auth module" in Cursor and "authentication service" in Claude are recognized as the same entity. Bi-temporal tracking (when something was true, when we learned it was true).

**Why it matters:** Expertise mapping answers "what am I actually good at?" based on evidence, not self-assessment. The knowledge graph enables cross-tool queries that no other tool can answer.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Expertise map** | Dashboard: Intelligence Hub | File ownership, churn analysis, and expertise distribution across the codebase. Which areas you own vs. areas you're new to. Built from decision density, trade-off complexity, and dead-end exploration within each domain. |
| **Domain classification** | Intelligence: domain-classifier | Automatically classifies decisions, events, and files into knowledge domains (auth, database, API, frontend, etc.). Used by every other analyzer that needs domain context. |
| **Entity resolution** | Intelligence: knowledge graph | Cross-tool entity merging. "auth module" in Cursor = "authentication service" in Claude = "auth" in git commit messages. 13 resolution strategies. |
| **Temporal fact management** | Intelligence: knowledge graph | Tracks facts about your codebase with bi-temporal metadata. "The auth module used JWT tokens" was true until March 15 when you migrated to session tokens. Queries return current truth, not stale facts. |
| **Cross-tool reasoning unification** | Intelligence: knowledge graph | When you ask "what do I know about auth?", the answer draws from every tool and every session, not just the most recent one. Unified reasoning history across Cursor, Claude Code, Codex, Aider, and terminal. |

---

## 10. Personalization & Amplification

**What this group does:** Learns how you think over time and proactively surfaces connections you wouldn't find on your own. This is the temporal moat -- the capability that makes Unfade harder to replace the longer you use it.

**Computation base:** Profile builder (`profile-builder.ts`) + pattern detector + cross-project amplification + cross-analyzer correlation engine. The profile (ReasoningModelV2) accumulates decision style, trade-off preferences, exploration habits, and communication style. Amplification runs cross-temporal similarity queries against your full reasoning history.

**Why it matters:** This is what makes Unfade qualitatively different from memory tools. Mem0 remembers facts. Unfade learns how you reason. After 3 months, context injection doesn't just return what you did -- it shapes context for how you process information.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Reasoning profile** | Dashboard: Profile page, MCP: `unfade_profile` | Your reasoning fingerprint: decision style (2 alternatives or 5?), trade-off preferences (simplicity vs. flexibility), exploration depth, blind spots, communication style. Emerges from data over weeks, not self-reporting. |
| **Trade-off preference tracking** | Dashboard: Profile page | Your documented tendencies with confidence scores and supporting/contradicting decision counts. "Favors simplicity over flexibility -- 84% confidence, 12 supporting decisions, 2 contradicting." |
| **Pattern detection** | Dashboard: Profile page | Automatically extracted meta-patterns: "Consistently evaluates 3+ alternatives before deciding." "Strong at identifying edge cases early." Requires 2+ distills to begin detecting. |
| **Cross-project amplification** | MCP: `unfade_amplify` | Surfaces connections across projects and time. "You're evaluating caching strategies again. Last time (March 3, Project X), you chose write-behind -- here's your reasoning." |
| **Decision durability tracking** | Intelligence: decision-durability analyzer | Which decisions held vs. which were reverted. "Decisions you made after exploring 3+ alternatives have a 94% retention rate. Quick decisions have 61%." |
| **Debugging arc reconstruction** | Intelligence: debugging-arcs analyzer | Stitches terminal signals, AI conversations, and error patterns into coherent debugging narratives. "You hypothesized X, tested with Y, the error changed to Z, so you refined to..." |

---

## 11. Thinking Identity

**What this group does:** Produces visible, shareable artifacts of your reasoning depth. The growth engine. Every shared card is a product advertisement.

**Computation base:** Identity engine (`identity.ts`) + card generator + Thinking Graph builder. Draws from the full reasoning profile, comprehension scores, decision history, and domain expertise to produce visual identity artifacts. Card generation produces PNG images locally.

**Why it matters:** This is Layer 3 -- the identity that drives organic growth. "I want proof I understand what I build" is the user desire. Cards and the Thinking Graph are the answer. Everything here runs locally and generates local files.

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Unfade Card generation** | Dashboard: Cards page | Shareable PNG identity cards summarizing your reasoning patterns. Dark/light style selection. Time range selection (7d / 30d / 90d). Preview inline before downloading. |
| **Card history** | Dashboard: Cards page | Previously generated cards with dates and file sizes. Browse past cards to see how your identity evolved. |
| **Thinking Graph** | Dashboard: Profile page | Visual interactive profile of how you reason. Decision density heatmap (like GitHub's contribution graph, but for reasoning moments). Domain evolution over time. Thinking threads (connected decision chains across days). |
| **Reasoning Fingerprint** | Onboarding (first run) | Generated within 60 seconds of install from git history. Decision style, top domains, trade-off profile, dead end tolerance, AI collaboration pattern. The "wow moment" that makes people share. |
| **Export** | Dashboard: Settings page | Export your reasoning data in a portable format. Your data, your ownership, always extractable. |
| **Publish** | Dashboard: Profile page | Generate a static Thinking Graph site for self-hosting (GitHub Pages, Vercel, Netlify). Shareable without any paid tier. |

---

## 12. Narrative Intelligence

**What this group does:** Turns raw analyzer outputs into human-readable stories. Not 25 separate dashboards -- one coherent narrative about how you work.

**Computation base:** Narrative engine (`narrative-engine.ts`, `narrative-synthesizer.ts`, `narrative-templates.ts`) + cross-analyzer correlation engine + diagnostic stream. Reads outputs from all other analyzers and synthesizes cross-cutting insights. Template-driven with narrative spine construction.

**Why it matters:** Users don't want 8 intelligence cards with separate numbers. They want one story: "This week you deeply understood the payment refactoring but rubber-stamped the auth migration. Your comprehension dipped because you accepted 23 AI suggestions in auth without modification."

### Features

| Feature | Surface | What it does |
|---|---|---|
| **Narrative headlines** | Dashboard: Home page | Natural-language claims about your work generated from cross-analyzer correlation. "Clear signal path" / "Threads emerging" / "Pattern detected in auth decisions." |
| **Narrative cards** | Dashboard: Intelligence Hub | Auto-generated narrative threads about your work patterns. The synthesis layer that connects efficiency, comprehension, velocity, and direction into actionable stories. |
| **Cross-analyzer correlation** | Intelligence: cross-analyzer engine | Finds meaningful connections between different analyzer outputs. "Your comprehension dropped in auth (comprehension analyzer) at the same time your direction score dropped (direction analyzer) and your velocity spiked (velocity analyzer) -- you shipped fast without understanding." |
| **Diagnostic stream** | Intelligence: diagnostic-stream | Real-time diagnostic messages as the intelligence pipeline runs. Surfaces specific, actionable problems: "Your steering is loose in infrastructure -- you're accepting 90% of AI output without modification." |
| **Latest insights** | Dashboard: Home page | Most recent insights surfaced by the intelligence pipeline. Prioritized by relevance and recency. |

---

## Feature Count Summary

| Group | Features | Primary Surfaces |
|---|---|---|
| Passive Capture | 8 | Daemon, Dashboard (Live, Integrations) |
| Cross-Tool Context Injection | 10 | MCP, CLI |
| Daily Distill | 8 | CLI, Dashboard (Distill), Internal pipeline |
| Decisions | 6 | Dashboard (Decisions), MCP, CLI |
| Comprehension | 5 | Dashboard (Intelligence), MCP, Internal pipeline |
| Direction & Autonomy | 5 | Dashboard (Intelligence), MCP, Internal pipeline |
| Efficiency & Cost | 5 | Dashboard (Intelligence), MCP, CLI |
| Velocity & Patterns | 4 | Dashboard (Intelligence), MCP |
| Expertise & Codebase Knowledge | 5 | Dashboard (Intelligence), Internal pipeline |
| Personalization & Amplification | 6 | Dashboard (Profile), MCP, Internal pipeline |
| Thinking Identity | 6 | Dashboard (Cards, Profile), CLI |
| Narrative Intelligence | 5 | Dashboard (Home, Intelligence), Internal pipeline |
| **Total** | **73** | |

---

## How Groups Connect

```
┌──────────────────────────────────────────────────────────────┐
│                    PASSIVE CAPTURE (1)                        │
│            Git + AI Sessions + Terminal → JSONL               │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  DAILY DISTILL (3)                            │
│      Signals → Context linking → Synthesis → Markdown        │
│                       │                                      │
│              Extracts:│                                       │
│                       ▼                                      │
│               DECISIONS (4)                                   │
└──────────┬───────────┬──────────┬────────────────────────────┘
           │           │          │
           ▼           ▼          ▼
┌────────────┐ ┌────────────┐ ┌────────────────────┐
│COMPREHENSIO│ │ DIRECTION  │ │ EFFICIENCY & COST  │
│N (5)       │ │ & AUTONOMY │ │ (7)                │
│            │ │ (6)        │ │                    │
│Score 0-100 │ │HDS, Session│ │AES, Token spend,   │
│FSRS decay  │ │Intelligence│ │Cost attribution    │
│Blind spots │ │Maturity    │ │                    │
└─────┬──────┘ └─────┬──────┘ └────────┬───────────┘
      │              │                  │
      └──────┬───────┴──────────┬───────┘
             │                  │
             ▼                  ▼
┌──────────────────┐  ┌──────────────────────────┐
│ VELOCITY &       │  │ EXPERTISE & CODEBASE     │
│ PATTERNS (8)     │  │ KNOWLEDGE (9)            │
│                  │  │                          │
│Decisions/day,    │  │Domain map, Entity        │
│Prompt patterns,  │  │resolution, Temporal      │
│Loop detection    │  │facts, Knowledge graph    │
└────────┬─────────┘  └────────┬─────────────────┘
         │                     │
         └──────────┬──────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│           PERSONALIZATION & AMPLIFICATION (10)                │
│     Reasoning profile + Cross-project connections            │
│                       │                                      │
│              ┌────────┴────────┐                             │
│              ▼                 ▼                              │
│   ┌──────────────────┐  ┌──────────────────┐                │
│   │ NARRATIVE         │  │ THINKING         │                │
│   │ INTELLIGENCE (12) │  │ IDENTITY (11)    │                │
│   │                   │  │                  │                │
│   │ Stories from all  │  │ Cards, Graph,    │                │
│   │ analyzers         │  │ Fingerprint      │                │
│   └──────────────────┘  └──────────────────┘                │
└──────────────────────────────────────────────────────────────┘

                    ▲
                    │ feeds back into
                    │
┌──────────────────────────────────────────────────────────────┐
│          CROSS-TOOL CONTEXT INJECTION (2)                     │
│   MCP server serves all of the above to every AI tool        │
└──────────────────────────────────────────────────────────────┘

```

Every group feeds downstream groups. Capture feeds everything. Distill extracts decisions. Decisions feed comprehension, direction, efficiency, velocity, and expertise. Those feed personalization. Personalization feeds identity and narrative. MCP serves all of it back to AI tools, closing the loop.

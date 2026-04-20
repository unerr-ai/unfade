# Unfade: Strategic Support Document — Deep Analysis & Growth Blueprint

> **What this document is:** The evidence layer beneath [unfade.md](./unfade.md). Where the canonical strategy declares *what Unfade is and why it must exist*, this document shows *how we know* — the theme scoring, the competitive map at depth, the structural gap no competitor occupies, the core differentiator that defeats every category, the strategic decisions and their evidence, and the growth mechanics that turn a good product into a movement.
>
> **How to read this document:** Each section answers a specific strategic question. The sections build on each other: evidence → landscape → gap → differentiator → decisions → growth → launch → success criteria. Read sequentially for the full argument, or jump to the section that addresses your question.
>
> **Last updated:** April 2026 (implementation note added 2026-04-20)

---

## Table of Contents

- [1. Theme Analysis: What Matters Most](#1-theme-analysis-what-matters-most)
- [2. Competitive Landscape & Core Differentiator](#2-competitive-landscape--core-differentiator)
- [3. Gaps & Highest-Impact Additions](#3-gaps--highest-impact-additions)
- [4. Strategic Decisions](#4-strategic-decisions)
- [5. Growth Strategy, Viral Mechanics & Launch Blueprint](#5-growth-strategy-viral-mechanics--launch-blueprint)
- [6. Critical Path to 50K Stars](#6-critical-path-to-50k-stars)

---

## 1. Theme Analysis: What Matters Most

*Question this section answers: Across the entire Unfade strategy, which themes carry the most weight — and which are secondary?*

The scoring reveals a clear three-tier structure. **The top tier (combined 17–19) clusters around infrastructure and trust** — cross-tool context injection, privacy, and passive capture are the foundation. Without these, nothing else works. They must dominate the v1 experience. **The middle tier (14–16) is the differentiation layer** — personalization, amplification, identity, and hiring signal are what separate Unfade from the 16 other tools in the space. They are not v1 features, but the personalization seed must ship from Day 1 (see [Section 2 — Core Differentiator](#strategic-implications-from-competitive-analysis)). **The lower tier (10–13) is the ecosystem and social layer** — Unfade Cards, community skills, and team metrics are strategically important for growth and network effects, but the pain they solve is aspirational ("I want to share my thinking") rather than urgent ("I need my AI to stop forgetting me").

Fourteen distinct theme/feature groups emerge from the product strategy. Each is scored on **market relevance** (how strongly the market signals demand) and **pain intensity** (how acutely developers feel the problem today). Scores are grounded in external research: JetBrains 2026 Developer Survey, ContextStream usage data, Assessory hiring research, MCP ecosystem metrics, and developer community sentiment across Reddit, HN, and X.

| # | Theme / Feature Group | Core Value | Market Relevance (1–10) | Pain Intensity (1–10) | Combined |
|---|---|---|---|---|---|
| 1 | **Cross-Tool Context Injection** (Unfade Hooks API + MCP Server) | Every AI tool knows what you worked on yesterday without re-explaining | **10** | **9** | **19** |
| 2 | **Privacy / Local-First / Open Source** | All data local, plain text, inspectable, exportable. Open source = verifiable. | **10** | **9** | **19** |
| 3 | **Passive Reasoning Capture** (git, AI sessions, terminal) | Zero-effort recording of decisions, explorations, dead ends | **9** | **8** | **17** |
| 4 | **Hiring Signal** (reasoning-based developer evaluation) | A harder-to-fake signal: reasoning depth, trade-off quality, domain expertise | **9** | **8** | **17** |
| 5 | **MCP-Native Ecosystem** (Unfade as MCP server, ClawHub skill) | One install makes every MCP-compatible agent smarter | **9** | **8** | **17** |
| 6 | **Reasoning-Level Personalization** (learns decision style, trade-off weights) | AI adapts to *how you think*, not just what you prefer. Cross-tool, dynamic. | **9** | **7** | **16** |
| 7 | **Thinking Graph** (visual reasoning identity profile) | Compounding visual profile: decision density, patterns, domain evolution | **8** | **7** | **15** |
| 8 | **Proactive Amplification** (connection surfacing, blind spot detection) | Surfaces reasoning connections you missed across projects and time | **8** | **7** | **15** |
| 9 | **Daily Distill** (auto-generated reasoning summary) | 2-minute daily ritual reviewing decisions, trade-offs, dead ends, breakthroughs | **8** | **6** | **14** |
| 10 | **Reasoning Agent / "Second Self"** (queryable, delegatable) | Year 2+ endgame: "How would I approach X?" answered from your own reasoning | **8** | **6** | **14** |
| 11 | **unerr Integration / Shared Data Substrate** | Structural intelligence + reasoning intelligence = irreplaceable | **7** | **7** | **14** |
| 12 | **Team Unfades** (aggregate reasoning quality metrics) | Team-level thinking metrics, not velocity metrics | **7** | **6** | **13** |
| 13 | **Unfade Cards** (shareable reasoning artifacts) | "Spotify Wrapped for your engineering brain" | **7** | **5** | **12** |
| 14 | **Community Skill Ecosystem** (Amplification Lenses, Knowledge Packs) | Platform play — others build on Unfade's MCP surface | **6** | **4** | **10** |

**Key implication for v1 prioritization:** The strongest v1 ruthlessly prioritizes the three themes with the highest combined scores — cross-tool context injection, privacy/local-first, and passive capture — and positions everything else as compounding value that emerges from the same data stream.

---

## 2. Competitive Landscape & Core Differentiator

> **Full analysis:** The deep competitive landscape (35+ tools across 8 categories), Dumbbell Pattern, Six-Stage Depth Map, and strategic playbook have been consolidated into **[Unfade Competitive Analysis](./unfade_competitor_analysis.md)**.
>
> Key sections:
> - §2–9: Category-by-category competitor analysis (Reasoning Capture, MCP Memory, IDE Memory, Developer Identity, PKM, Record Everything, Funded Threats, Agent Memory Frameworks)
> - §10: The Dumbbell Pattern — why competitors cluster at both ends
> - §11: Six-Stage Depth Map — no competitor covers more than 2.5/6 stages
> - §12: Honest Assessment — where Unfade wins and where it's vulnerable
> - §13: Strategic Playbook — positioning messages, priorities, what not to do

### Strategic Implications (from competitive analysis)

**The Core Differentiator: Reasoning Personalization Engine**

The reasoning personalization engine — the system that learns *how* you think across tools, projects, and months — is the single capability that defeats every competitor and creates an unassailable moat. The temporal moat means a well-funded competitor cannot shortcut months of accumulated reasoning patterns.

**The Dual-Output Architecture:**

```
         ┌─────────────────────────────────────┐
         │     REASONING PERSONALIZATION        │
         │        ENGINE (The Core)             │
         │                                      │
         │  Learns: decision style, trade-off   │
         │  weights, domain depth, blind spots, │
         │  exploration habits, failure patterns │
         └───────────┬───────────┬─────────────┘
                     │           │
          ┌──────────┘           └──────────┐
          ▼                                 ▼
   ┌──────────────┐                ┌──────────────┐
   │  UTILITY OUT  │                │ IDENTITY OUT  │
   │               │                │               │
   │ Personalized  │                │ Thinking      │
   │ context for   │                │ Graph,        │
   │ every AI tool │                │ Unfade Cards, │
   │ via MCP       │                │ hiring signal │
   └──────────────┘                └──────────────┘
```

- AI tools read the personalization model to improve their responses (*utility*)
- The developer reads the same model as their Thinking Graph (*identity*)

**Ship Personalization from Day 1:** Even rough personalization — "you tend to evaluate 3 alternatives," "your exploration depth was above your emerging baseline" — is qualitatively different from what any competitor offers. The Daily Distill should include personalization signals from the very first distill: not "you made 3 decisions today" (that's DevDaily), but "you made 3 decisions today — *you evaluated 2 alternatives for the first, 4 for the second, and accepted the AI's suggestion without evaluation for the third.*"

> **Other tools remember what you did. Unfade learns how you think — and that understanding makes every AI tool smarter, produces a visible identity you can share, and becomes more irreplaceable with every month of use.**

> **Implementation note (2026-04-20):** The shipped product already includes passive capture (Go daemon), distillation, ReasoningModelV2 profile with personalization seed, direction density / comprehension scoring, 9 MCP tools, and a continuous materializer. Phase 7 (`PHASE_7_BREAKTHROUGH_INTELLIGENCE.md`) defines the next layer: AES, cost attribution, prompt coach, loop detector, comprehension radar, velocity, blind spots, and decision replay. Architecture docs live in `.internal/architecture/PHASE_0` through `PHASE_4` (shipped) + `PHASE_6` (planned) + `PHASE_7` (planned). The competitor landscape addendum (Quint, Antigravity, Kiro) is in `unfade_competitor_analysis.md` and Phase 7 §3.2.

---

## 3. Gaps & Highest-Impact Additions

*Question this section answers: What real developer cravings are unaddressed or underserved in the current strategy — and which should we act on?*

Cross-referencing the product strategy against external community signals reveals six gaps. Each is assessed with its strategic priority inline.

### Gap 1: Onboarding / Knowledge Transfer — Should Inform v1 Positioning

**The signal:** Developer onboarding is a persistent, high-intensity pain. New hires take 4–6 weeks to ramp up. AI halves this, but doesn't solve the deeper problem: *understanding why the codebase is the way it is*.

**What Unfade misses:** Unfade captures the reasoning behind the code over time — exactly what a new hire needs but can never access. The strategy never positions Unfade as an onboarding accelerator. A new developer could run `unfade history --project=auth --last-6months` and get a structured narrative of every architectural decision, trade-off, and dead end the team explored. This requires zero new features — just positioning and a query interface.

**Relevance: 9/10. Pain intensity: 8/10.** A clear missed opportunity that converts Unfade from a personal tool into an organizational asset.

**Action:** Add onboarding narrative as a first-class output. Zero new features required — just a `unfade history` command and explicit positioning. "Your codebase's reasoning history becomes your onboarding documentation" is an enterprise-grade value proposition. Pain intensity is high (4–6 week ramp-ups are measurably expensive), the audience is broad (every team that hires), and it converts Unfade from personal tool to organizational asset.

### Gap 2: Token/Cost Waste Visibility — Should Inform v1 Positioning

**The signal:** Power users face $30–$800/month in opaque API costs. unerr's own strategy identifies token waste as a top problem ("Full-time Claude Code usage runs $3K–$13K/month").

**What Unfade misses:** Unfade could surface cost data alongside reasoning: "You spent ~$12 in tokens re-explaining the auth context 4 times this week — Unfade auto-injected this context, saving those tokens." This connects utility to a dollar amount — the strongest adoption argument for managers. The strategy mentions saving "15 minutes per session" but never quantifies *cost savings*.

**Relevance: 8/10. Pain intensity: 7/10.** Not the primary pain, but a powerful secondary argument, especially for team/enterprise buyers.

**Action:** Add a "value receipt" to the Daily Distill: "Today, Unfade auto-injected context that would have taken ~15 minutes and ~$8 in tokens to re-explain. This month: 4.2 hours and ~$180 saved." This turns abstract benefit into a concrete number engineering managers can put in a budget justification.

> **Status (2026-04-20):** Partially addressed. Token spend proxy (`token-proxy.ts`), cost-per-quality fields, and `summary.json` cost hints are shipped. Phase 7 Cost Attribution Engine (§4.5 in PHASE_7) escalates this to per-decision, per-domain, per-model attribution with "value receipt" UX on the Cost dashboard page — labeled as **estimates** until vendor usage data is enriched.

### Gap 3: Debugging Session Capture — Should Inform v1 Positioning

**The signal:** Debugging is where the most valuable reasoning happens and the most context is lost. Developers re-debug the same class of issue weekly without realizing it.

**What Unfade underserves:** The strategy captures terminal commands and error outputs, but treats debugging generically. The *reasoning arc* of a debugging session — "I hypothesized X, tested it by doing Y, the error changed to Z, so I refined my hypothesis to..." — is the richest reasoning signal a developer produces. A dedicated debugging reasoning reconstructor that stitches terminal signals, AI conversations, and error patterns into a coherent narrative would be the single highest-value distillation Unfade could produce.

**Relevance: 8/10. Pain intensity: 8/10.** This is where context loss hurts most and where "I solved this before but forgot" is most maddening.

**Action:** Elevate debugging from "we capture terminal commands" to "we reconstruct the full reasoning arc of your debugging sessions." This is the highest-value distillation possible and the strongest "I can't believe no one built this" reaction.

### Gap 4: Reasoning Confidence / Self-Calibration — Phase 2–3

**The signal:** Only 29% of developers trust AI-generated code, down from 40% in 2025. The trust crisis extends to developers' trust in their *own* reasoning when AI is involved.

**What Unfade misses:** The "Thinking Patterns" feature shows meta-patterns but doesn't address *reasoning confidence calibration*: "How often do my decisions hold up? How often do I revert choices I made quickly vs. those I explored deeply?" This would make Unfade a reasoning *coach*, not just a reasoning *mirror*. The data already exists in the reasoning graph (decisions + subsequent reverts = calibration signal).

**Relevance: 7/10. Pain intensity: 6/10.** Less acute than context amnesia, but valuable for developers navigating the AI trust crisis.

**Action:** Track decision durability — which held vs. which were reverted. Surface patterns: "Decisions you made after exploring 3+ alternatives have a 94% retention rate. Quick decisions have 61%." Phase 2–3 enhancement.

### Gap 5: Real-Time Collaborative Reasoning — Phase 2–3

**The signal:** Each user's memory is siloed. When multiple team members work on the same project, no tool connects their reasoning.

**What Unfade underserves:** The strategy has "Collaborative Reasoning Graphs" as a future ecosystem primitive (Phase 4). A more immediate opportunity: when two developers work on the same codebase, Unfade could surface "Your teammate evaluated this same library yesterday and chose option B — here's their reasoning." This prevents duplicated reasoning work using data that already exists if both developers run Unfade.

**Relevance: 7/10. Pain intensity: 7/10.** Becomes critical at 3+ developers on a shared codebase.

**Action:** When two Unfade users work on the same repo, surface each other's recent reasoning non-intrusively. Phase 2–3 enhancement.

### Gap 6: Non-Developer Knowledge Workers — Deliberately Excluded

**The signal:** Product managers, designers, and technical writers all make reasoning-heavy decisions that evaporate. The reasoning capture + distillation + identity value proposition is domain-agnostic.

**Assessment:** Correctly scoped out of v1. Developer trust, git-as-primary-signal, and technical community adoption all require a developer-first approach. Worth documenting as a future expansion path when v1 proves the model.

**Relevance: 6/10 for v1, 9/10 for v2+.**

### What the Strategy Already Gets Right

The strategy is notably strong in areas where most strategy documents are weak:

- **Privacy architecture** — local-first, plain-text, open-source, thoroughly justified
- **Habit formation** — Hook Model mapping with six independent retention forces
- **Competitive triage** — 19+ tools across 7 categories, each with specific gap analysis
- **MCP-native ecosystem** — protocol-level integration, not custom plugins
- **The Supabase model for unerr relationship** — rigorously evaluated via RRVV

The primary risk is not what's missing but **scope ambition** — 14 feature groups across 5 phases over 12 months is an enormous surface area. Ruthless prioritization of the top three themes (cross-tool context injection, privacy, passive capture) gives the strongest possible v1.

---

## 4. Strategic Decisions

*Question this section answers: What are the four most consequential strategic choices, and what does the evidence say?*

### Decision 1: Open Source or Paid?

**Answer: Open-source core with paid cloud/team tiers (the PostHog model).**

The open-source layer is non-negotiable, not a strategic preference:

1. **The Microsoft Recall precedent.** Microsoft faced massive privacy backlash for an observation tool. Within weeks, open-source alternatives launched. Unfade captures git history, AI sessions, and terminal output. Developers will not grant these permissions to closed-source code.

2. **The data confirms it.** 92% of developers use open-source software. Vendor lock-in avoidance is the #1 driver of OSS adoption (55% of respondents, up 68% YoY). For a tool that builds a compounding model of *how you think*, the lock-in concern is existential.

3. **Every competitor is open source.** GitWhy, Deciduous, thinking-mcp, Smara, OpenClaw — all MIT/Apache. Closed-source Unfade would be a trust disadvantage against every alternative.

4. **Open source IS the distribution strategy.** The funnel: discover via Unfade Card → install free CLI → use for free → hit team/cloud limits → convert. PostHog operates this exact model.

**Where the money comes from:**

| Layer | Free (Open Source) | Paid |
|---|---|---|
| Capture daemon, personalization, amplification, MCP server | Unlimited, local | Unlimited, local |
| Daily Distill | Local LLM (Ollama) | Cloud LLM option for higher quality |
| Thinking Graph | Self-hosted (GitHub Pages, Vercel) | **Hosted at `unfade.dev/username`** |
| Unfade Cards | Generate locally | **Hosted sharing with analytics** |
| Team Unfades | N/A | **Paid** — aggregate reasoning metrics, manager dashboards |
| Cross-machine sync | N/A | **Cloud backup + sync** |
| Reasoning Marketplace | Browse free packs | **Publish + monetize** |

**The model: PostHog, not Cursor.** PostHog is a free open-source tool that happens to have paid tiers. The core reasoning engine must be free and local forever. Monetize hosted identity, team features, and marketplace.

### Decision 2: Part of unerr or Separate?

**Answer: Separate open-source project, same product ecosystem (the Supabase model).**

**Why not a feature of unerr:**
- **Audience mismatch is 10–50x.** unerr serves teams needing lifecycle intelligence. Unfade serves *any developer who uses AI tools*. Bundling means 90%+ of Unfade's audience never discovers it.
- **The viral mechanic dies inside unerr.** "Check out my Unfade" is a shareable identity. "Check out my unerr developer intelligence module" is not.
- **ClawHub/MCP positioning requires independence.** `unfade-memory` signals a focused, developer-native tool. `unerr-unfade` signals enterprise complexity.

**Why not fully separate (different company):**
- **The shared data substrate is the ultimate moat.** Both installed together means the AI receives structural intelligence (code) AND reasoning intelligence (developer). No competitor can replicate this without building both systems.
- **The conversion funnel is natural.** Unfade (free, viral) introduces developers to reasoning tooling. When their codebase needs structural intelligence, unerr is the natural next step.

**Implementation:**
- Unfade has its own GitHub repo, npm/cargo package, ClawHub skill, MCP Registry entry, landing page (`unfade.dev`)
- unerr has its own repo, CLI, product identity
- Both share: auth system, billing, data substrate (when both installed), optional unified dashboard

### Decision 3: Interface Strategy

**Answer: CLI + local web UI is primary. Not a tab in unerr's sidebar.**

- **Unfade must work without unerr.** Most Unfade users will never install unerr.
- **The daily interaction is CLI + notification, not a dashboard.** The daemon runs silently, context injection is invisible, the Daily Distill arrives as a notification. More like WakaTime than Vercel.
- **unerr integration is an enrichment, not a relocation.** A "Developer Intelligence" section appears in the unerr sidebar *only when both are installed*.

| Interface | When Used | Primary For |
|---|---|---|
| `unfade` CLI | Install, configure, queries, distill | Every user, every day |
| Local web UI (`localhost:7654/ui`) | Review Distill, browse reasoning graph, generate Cards | Solo developers, daily ritual |
| `unfade.dev/username` (hosted) | Public Thinking Graph, shared Cards, hiring profile | Identity/viral layer (paid tier) |
| unerr dashboard (optional) | Combined structural + reasoning view | Power users/enterprise with both installed |

### Decision 4: Pricing

**Answer: Free forever for individuals. Usage-based cloud tiers for hosted identity, team features, and marketplace.**

| Tier | What's Included | Price |
|---|---|---|
| **Unfade Free** | Everything local: capture, personalization, amplification, distill (Ollama), MCP server, ClawHub skill, self-hosted Thinking Graph, local Cards, full `.unfade/` directory | **$0 forever** |
| **Unfade Pro** | Hosted `unfade.dev/username`, hosted Card sharing with analytics, cloud distill (frontier LLMs), cross-machine sync, advanced reasoning analytics | **$12/dev/month** ($10 annual) |
| **Unfade Team** | Everything in Pro + Team Unfades, collaborative context, manager dashboards, onboarding narratives, SSO, admin controls | **$20/dev/month** ($16 annual) |
| **Enterprise (with unerr)** | Everything in Team + unerr Enterprise + shared data substrate + unified dashboard + audit exports + private deployment | **Custom** |

**Price rationale:** $12/mo positions below Cursor ($20) and above GitWhy ($12). $20/dev/mo for teams is comparable to WakaTime Team ($21) and below Cursor Business ($40).

**Projected conversion funnel (PostHog dynamics):**

| Stage | Users | Revenue |
|---|---|---|
| Free (OSS) | 100,000 | $0 |
| Pro (3% conversion) | 3,000 | $36K/mo |
| Team (500 teams × 5 devs) | 2,500 | $50K/mo |
| Enterprise with unerr (20 orgs × 50 devs) | 1,000 | $40K/mo |
| **Total at 100K free** | — | **~$126K/mo ($1.5M ARR)** |

---

## 5. Growth Strategy, Viral Mechanics & Launch Blueprint

*Question this section answers: How does Unfade actually grow — from first install to 50K stars — and what does the current plan get wrong about virality?*

### What Actually Made Breakout Projects Viral

Strip away the narratives and breakout open-source projects share four structural mechanics:

| Mechanic | OpenClaw (354K stars) | Spotify Wrapped | Bolt.new ($40M ARR) |
|---|---|---|---|
| **Visible output in shared spaces** | Agent posts useful things in group chats — every message is a live demo | Pushed to users once/year — scarcity creates urgency | Generated deployed URLs users could share |
| **Instant wow moment** | Install → connect → ask → useful answer. Under 60 minutes. | Open app → your data is there | Type sentence → running web app in 45 seconds |
| **Identity-forming behavior** | People named agents, competed on capabilities. "My agent." | "My music taste." | "My app." |
| **Zero effort to share** | The *product* shares by existing in group chats | The *product* pushes the card to you | The *product* generates a URL |

### The Five Laws of 50K Stars

Across every breakout project from 2024–2026, five patterns are universal:

**Law 1: The 10-Second Wow.** Every breakout project delivers a visible, impressive result within 10 seconds of first interaction. If the user doesn't say "whoa" in 10 seconds, they close the tab.

**Law 2: The Shareable Output.** The product generates something the user *wants other people to see*. The output is the marketing.

**Law 3: Zero Configuration.** Every moment of configuration is a moment the user might close the tab.

**Law 4: The "Show My Friends" Trigger.** What gets shared is not "I installed a tool" — it's "look at what this tool showed me about myself."

**Law 5: Timing + Vacuum.** Every breakout launched into a problem everyone felt but nobody had solved.

### What the Current Plan Gets Wrong

**The fatal flaw: Unfade Cards are not a viral loop. They are a share button.**

| | OpenClaw | Spotify Wrapped | Unfade Cards (current) |
|---|---|---|---|
| Who initiates the share? | The *product* (agent posts in chats) | Spotify pushes *to the user* | The *user* must decide to share |
| Where does it appear? | Inside existing social spaces | Instagram/Twitter stories | X/LinkedIn (deliberate posting) |
| What does the viewer feel? | "I want one" (utility envy) | "I need to do mine" (FOMO) | "Cool card" (intellectual admiration) |
| Can the viewer become a user? | Yes — conversation happens in same chat | Yes — open Spotify | Maybe — install CLI, have Ollama, wait a day |

**The problem:** Unfade Cards produce *admiration* ("cool concept"), not *urgency* ("I need this NOW"). Admiration doesn't create exponential growth. Urgency does.

**The second flaw: 24-hour delay to the wow moment.** The current design requires: install → start daemon → work for a day → get Daily Distill tomorrow. No viral product has a 24-hour delay to first value.

### Three Structural Fixes

#### Fix 1: Make the Product Visible Where Developers Already Work

The product must be the marketing — visible in shared spaces without requiring deliberate sharing:

- **GitHub PR descriptions auto-enriched by Unfade.** When you open a PR, Unfade auto-generates a "Reasoning Context" section. Every teammate and contributor sees it passively. This is the OpenClaw "agent posts in group chat" equivalent for developers.

- **Commit messages enriched with reasoning.** `unfade commit` wraps `git commit` and appends structured reasoning context. Every `git log` and `git blame` shows *why*, not just *who*.

- **Slack/Discord bot posting Daily Distills to team channels.** The Distill appears in the team channel every evening. Teammates see it without anyone "sharing."

#### Fix 2: Instant Wow via Backfill

The "wow moment" must happen in under 5 minutes, not after a day.

```
$ npx unfade-cli init

⟐ Unfade — Your AI knows how you think.

Scanning git history... found 847 commits across 14 months.
Scanning AI sessions... found 312 Cursor conversations, 89 Claude Code sessions.
Analyzing reasoning patterns...

━━━ Your Reasoning Fingerprint ━━━

  Decision Style:     Deep Explorer (3.4 alternatives per decision)
  Top Domains:        Authentication (34%), Database (22%), API Design (18%)
  Trade-off Profile:  Favors simplicity over flexibility (72% of choices)
  Dead End Tolerance:  High — you explore 2.1 dead ends per major decision
  AI Collaboration:   Modifier (you edit 64% of AI suggestions vs. accepting)

  Your thinking resembles the top 8% of reasoning depth
  across Unfade's developer population.

━━━ First Unfade Card Generated ━━━

  → Your card: .unfade/cards/first-unfade.png
  → Share it:  unfade card --share
```

**Why this works:** The developer sees their Reasoning Fingerprint within 60 seconds of running `init`. This is the Spotify Wrapped "Your top genres" reveal — a mirror reflecting something true about you that you didn't know. The backfill uses existing git history — no LLM required, no waiting, no Ollama dependency for first run.

#### Fix 3: Identity Envy, Not Intellectual Admiration

Make the Thinking Graph competitive and status-signaling:

- **Reasoning Depth Score** — a single comparable number. "My Unfade score is 847. What's yours?" Creates the comparison dynamic that drives Spotify Wrapped sharing.
- **Rare Achievement Badges** — "Explored 5+ dead ends in one session" (Deep Explorer), "Reversed an AI suggestion with better reasoning" (Independent Thinker). Rare achievements create brag-worthy moments.
- **Domain Leaderboards (opt-in)** — "Top 3% reasoning depth in Distributed Systems." Comparison triggers sharing.
- **Weekly Wrapped** — more shareable than daily (reduces fatigue), more visually striking, designed for social feeds.

The psychological shift: from "look at what I decided" (process documentation) to "look at how deeply I think" (identity flex). The first is content marketing. The second is viral growth.

### The Revised Growth Architecture

```
IMMEDIATE WOW          PASSIVE VISIBILITY         IDENTITY ENVY
(5-min backfill)       (in tools they already     (competitive,
                        use together)              shareable)
        │                       │                       │
        ▼                       ▼                       ▼
  "This tool knows     PR descriptions,          Reasoning Score,
   how I think         commit messages,          rare badges,
   already"            Slack/Discord bot         weekly Wrapped
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                                ▼
                    ORGANIC DISCOVERY LOOP
                    (every PR, every commit,
                     every team channel message
                     is a live demo)
```

### What the Instant Wow Changes in the Build Plan

**Before:** Day 1 = capture daemon + distill. Fingerprint comes Day 4.

**After:** Day 1 = Instant Fingerprint from git history backfill + first Unfade Card. This is the launch asset. Everything else comes after the front door is built.

| Priority | What | Why |
|---|---|---|
| **P0** | `unfade init` → Instant Fingerprint from git history | The front door. Without this, no one installs. |
| **P0** | Unfade Card generation from Fingerprint | The marketing unit. Without this, no one shares. |
| **P1** | Capture daemon + Daily Distill | Retention. Makes them come back tomorrow. |
| **P1** | MCP server + `unfade serve` | Utility. Makes their AI tools better. |
| **P2** | Personalization engine deepening | The moat. Makes them unable to leave. |
| **P2** | Thinking Graph (static site) | Long-term identity. The portfolio. |
| **P3** | ClawHub skill + MCP Registry | Ecosystem distribution. Compounds adoption. |
| **P3** | Amplification (cross-project connections) | Delight. The "aha" moments. |

### Revised Build Week

| Day | What Ships | Key Difference from Original |
|---|---|---|
| **Day 1** | Capture + `unfade distill --backfill 30` | Backfill is the wow moment. Spend extra time on prompt quality. |
| **Day 2** | Unfade Hooks API + MCP Server + `unfade commit` | `unfade commit` enriches commits with reasoning — the "visible in shared spaces" mechanic. |
| **Day 3** | Reasoning Depth Score + Weekly Wrapped card + terminal capture | Weekly card replaces daily card as primary viral artifact. Score enables comparison. |
| **Day 4** | Personalization seed + Amplification v0 | Core differentiator. This is unchanged. |
| **Day 5** | ClawHub + Thinking Graph + GitHub Action for PR enrichment + Launch | PR enrichment is the "visible without sharing" mechanic. |

### Pre-Launch (3–5 Days Before)

| Action | Purpose |
|---|---|
| Build in public on X — daily progress with screenshots | Build anticipation, accumulate followers |
| Seed "What's your reasoning fingerprint?" — post your own card | Create curiosity before the tool exists |
| Record 30-second terminal GIF: `unfade init` → fingerprint → card | The most critical launch asset. This GIF IS the HN post. |
| Write HN first comment draft | HN posts live or die on first comment quality |
| Prepare subreddit-specific angles | Identity for r/ExperiencedDevs, MCP utility for r/ClaudeCode |

### Launch Day

**HN title options:**
- `Show HN: Unfade — run one command, see how you think (open source reasoning fingerprint)`
- `Show HN: I built a tool that learns how you reason across Cursor, Claude Code, and git`
- `Show HN: Your AI tools forget you every session. Unfade remembers how you think.`

**Timing:** Tuesday or Wednesday, 8:30 AM PT.

**First comment:**
```
Hey HN — I built Unfade because every AI tool I use starts from zero every session.
It doesn't know I spent 4 hours debugging caching last week, or that I always
evaluate 3+ alternatives before deciding, or that I prefer explicit error handling.

Unfade fixes this. Run `npx unfade-cli init` and in 60 seconds you get:
- Your "Reasoning Fingerprint" — decision style, domains, trade-off profile
- Your first Unfade Card — shareable, beautiful, unique to you
- An MCP server that makes Cursor/Claude Code remember your reasoning

Fully open source (MIT), local-first, your data never leaves your machine.

The fingerprint uses your existing git history — no LLM required for first run.
For ongoing daily distills, it uses Ollama (local) or any OpenAI-compatible API.

What it does NOT do: screen recording, keylogging, or anything Rewind/Recall-like.
It reads structured signals: git diffs, AI session logs, terminal commands.

Would love feedback on: (1) Does the fingerprint feel accurate?
(2) What's missing from the Daily Distill? (3) What MCP integrations first?
```

### Post-Launch Amplification

| Day | Action | Target |
|---|---|---|
| Day 0 | HN "Show HN" + X thread + r/programming | First 500–1,000 stars |
| Day 1 | r/ClaudeCode ("Unfade MCP makes Claude remember") + r/cursor | AI tool communities |
| Day 2 | r/ExperiencedDevs ("How do you prove you think?") + DEV Community article | Identity/career angle |
| Day 3 | Indie Hackers + LinkedIn for eng managers | Team/hiring angle |
| Day 4 | Publish `unfade-memory` on ClawHub | OpenClaw's 354K community discovers Unfade |
| Day 5 | "What's your reasoning fingerprint?" challenge on X | Viral loop activation |
| Day 7 | Respond to all issues, ship 2–3 community requests | Signal: "this project is alive" |

### Projected Growth Trajectory

| Week | Stars | What Drives It |
|---|---|---|
| Week 2 | 5K–10K | HN residual + Reddit cross-posts + early adopter tweets |
| Week 3 | 15K–25K | YouTube tutorials emerge. "Reasoning Fingerprint" becomes a meme. ClawHub adoption. |
| Week 4 | 25K–40K | Dev blog roundups. Newsletter mentions. Team adoption begins. |
| Week 6–8 | 40K–60K | Compounding loop: cards → curiosity → installs → cards. First "I got hired because of my Thinking Graph" story. |

---

## 6. Critical Path to 50K Stars

*Question this section answers: What absolutely must be true for Unfade to break out?*

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  The ENTIRE growth strategy rests on ONE moment:                 │
│                                                                  │
│    npx unfade-cli init → 60 seconds → Reasoning Fingerprint      │
│                                                                  │
│  If this moment doesn't make developers say "whoa, that's me,"  │
│  nothing else matters. No amount of MCP integration, Daily       │
│  Distills, or ecosystem plays can substitute for a first         │
│  experience that doesn't create instant recognition.             │
│                                                                  │
│  The fingerprint IS the product's front door.                    │
│  The card IS the marketing.                                      │
│  Everything else is retention.                                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Five Things That Must Be True

1. **The Fingerprint must be accurate enough to create recognition.** "Deep Explorer who favors simplicity over flexibility" — if the developer reads this and nods, you win. If they shrug, you lose. The heuristics for extracting reasoning patterns from git history (alternatives per decision, revert frequency, branch exploration depth, AI suggestion modification rate) must be tuned aggressively before launch. This is the single highest-priority engineering task.

2. **The Card must be beautiful enough to screenshot.** Dark theme, distinctive visual language, instantly recognizable. Not a generic chart. Not a GitHub-style graph. Something that belongs in a portfolio or a tweet. If it's ugly, nobody shares it.

3. **The install must be copy-paste-enter.** `npx unfade-cli init` and nothing else. No Ollama dependency for first run. No config files. No API keys. The Fingerprint comes from git history analysis, not LLM synthesis.

4. **The HN title must induce curiosity.** Best format: `Show HN: [what it does in 10 words] (open source)`. The words "open source" increase click-through on HN significantly.

5. **The README must have a terminal GIF in the first screenful.** This GIF — showing `unfade init` → fingerprint → card — is the single most important marketing asset. 15–20 seconds, beautiful, makes the viewer want to run it themselves. Repos with comprehensive READMEs get 4x more stars and 6x more contributors.

### The Honest Assessment

Will Unfade hit 354K stars like OpenClaw? Almost certainly not. OpenClaw had once-in-a-decade timing, a trademark controversy generating 3 media cycles, a viral agent-in-group-chat mechanic, and meme culture that transcended developer communities.

But Unfade *can* produce a strong, sustained growth curve (10K–50K stars in 3 months) by nailing three things:

1. **5-minute wow moment** via backfill — "this tool already knows how I think"
2. **Passive visibility** via enriched PRs/commits — the product is the marketing
3. **Identity competition** via reasoning scores — people can't resist comparing

The difference between 1K stars (interesting tool) and 50K stars (movement) is whether the product markets itself through normal usage or requires deliberate sharing. The structural fixes above shift Unfade from "interesting tool with a share button" to "product that is visible everywhere developers work together." That shift is the difference between a good launch and a growth engine.

# Phase 7 — Breakthrough Intelligence

> **Feature Statement:** _"A developer runs `unfade` for a week. On day one, they see their Direction Ratio — 73% human-directed. Interesting. By day three, Unfade tells them: 'Your architecture prompts produce 3x better outcomes when you specify constraints upfront. Your Claude sessions cost $14.20 this week — 40% was spent re-explaining context that Unfade already knows.' By day seven: 'You've entered a stuck loop 4 times this week on the same pattern — dependency injection in Go. Here's what worked last Tuesday.' The developer realizes: this isn't a logger. This is a mirror that makes me better."_
>
> **Prerequisites:** [Phase 4 — Platform & Launch](./PHASE_4_PLATFORM_AND_LAUNCH.md) (consolidated spec: server-first runtime, continuous intelligence, materializer, live dashboard, ecosystem distribution) **and** the **implemented** stack in `src/` + `daemon/` (standalone server, registry, SSE/API, MCP). [Phase 6 — Post-Launch & Enterprise](./PHASE_6_POST_LAUNCH.md) is adjacent (Windows, cloud distill, team model) but not required to start Phase 7. There is **no separate Phase 5.6 document** — global storage, runtime, and CIL contracts live in Phase 4 and the codebase.
>
> **Status:** PLANNING — **verification pass 2026-04-18** (capture shapes, token semantics, MCP naming, file paths aligned to repo reality)
>
> **Foundation doc:** [Product strategy](../product/unfade.md) | [Strategic support / themes](../product/unfade_support.md) | [Competitive analysis](../product/unfade_competitor_analysis.md)
>
> **Phase sequence (canonical docs):** [Phase 0](./PHASE_0_FOUNDATION.md) → [1](./PHASE_1_CAPTURE_AND_INTELLIGENCE.md) → [2](./PHASE_2_CONTEXT_AND_INTEGRATION.md) → [3](./PHASE_3_IDENTITY_AND_PERSONALIZATION.md) → [4](./PHASE_4_PLATFORM_AND_LAUNCH.md) → [6](./PHASE_6_POST_LAUNCH.md) → **[7](./PHASE_7_BREAKTHROUGH_INTELLIGENCE.md)**. Ecosystem / global-runtime / CIL material lives in **Phase 4 + code**, not a separate numbered doc.
>
> **Last updated:** 2026-04-20 (content refresh: architecture alignment + data-contract corrections)

---

## Table of Contents

- [0. Architecture alignment & data-contract verification](#0-architecture-alignment--data-contract-verification)
- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Breakthrough Capabilities](#4-breakthrough-capabilities)
- [5. Data Gap Analysis](#5-data-gap-analysis)
- [6. Architecture](#6-architecture)
- [7. Design Principles](#7-design-principles)
- [8. Implementation Plan](#8-implementation-plan)
- [9. Success Metrics](#9-success-metrics)
- [10. Risk Assessment](#10-risk-assessment)

---

## 0. Architecture alignment & data-contract verification

This section **reconciles Phase 7 with the current codebase and capture reality** (see [Phase 4](./PHASE_4_PLATFORM_AND_LAUNCH.md) for the intended continuous-intelligence architecture). Earlier drafts assumed signals that are *schema-valid* but **not the primary daemon emission path** — without this correction, implementation teams would build analyzers on empty tables.

### 0.1 What shipped before Phase 7 (continuous layer / launch hardening)

The following already exists in the TypeScript + Go stack and **overlaps Phase 7 themes** (intelligence is partially productized before the dedicated `intelligence/` directory from §6):

| Capability (Phase 7 name) | Shipped analogue | Location / behavior |
|---|---|---|
| Continuous signals (not distill-only) | Materializer tick → SQLite cache → `state/summary.json` | `server-standalone.ts`, `summary-writer.ts`, `MaterializerDaemon` |
| Cost / efficiency hints | `computeTokenSpend` (proxy), `computeCostPerQuality`, pricing from config | `token-proxy.ts`, `cost-quality.ts`, `summary-writer.ts` |
| Comprehension (module-level) | Comprehension batch + by-file direction for heatmap | `comprehension.ts`, `file-direction.ts` |
| Insights stream | Ring-buffered `insights/recent.jsonl` + API/SSE consumers | `recent-insights.ts`, routes |
| Multi-repo | `registry.v1.json`, resolver, daemon routing | `registry.ts`, `resolver.ts`, Go `unfade-send` |
| MCP | **`unfade_comprehension`** already registered (snake_case family with other tools) | `src/services/mcp/tools.ts` |

**Implication:** Phase 7 is an **escalation layer** (deeper analyzers, dedicated artifacts, coach/loop/replay), not the first time “intelligence” appears in the product.

### 0.2 Capture contract — what the Go daemon actually emits today

The primary AI watcher (`daemon/internal/capture/ai_session.go`) produces events with:

- `source: "ai-session"`
- `type: "**ai-conversation**"` (one event per classified conversation window)
- `metadata`: `ai_tool`, `session_id`, `conversation_id`, `**turn_count**`, `**direction_signals**` (from the heuristic classifier — this *is* the human–AI steering signal for HDS-style metrics)

It does **not** currently emit a stream of separate `ai-completion` / `ai-rejection` events per suggestion for every tool. Those types exist in `CaptureEventSchema` for **downstream synthesis, tests, and optional enrichers** — but **Phase 7 analyzers must not assume they are populated** from passive capture alone.

**Required Phase 7 adjustment (pick one or combine):**

1. **Derive** pseudo completion/rejection and modification proxies from `ai-conversation` content + `direction_signals` + git proximity; or  
2. **Extend parsers / daemon** to emit `ai-completion` / `ai-rejection` when the underlying format exposes accept/reject UI signals (tool-specific); or  
3. **Ingest** IDE-specific telemetry where legally/technically available — explicit scope and consent.

Until (2) or (3) lands, treat **Prompt Coach**, **Comprehension Radar** sub-metrics that depend on per-suggestion outcomes, and **Loop Detector** match quality as **confidence-graded** (see §7c).

### 0.3 Token and cost semantics — corrected

Earlier text referenced `event.metadata.tokenCount` with input/output splits. **The production path today does not standardize API token fields on every event.** Cost work uses:

- **Token spend proxy:** counts of AI-session (and related) events per day × model × **configurable price-per-thousand-events** — a **budget thermometer**, not an invoice reconciler (`token-proxy.ts`).
- Optional `metadata.model` / `metadata.ai_tool` extracted in SQL for grouping.

Phase 7 **Cost Attribution Engine** must label outputs **estimated / proxy** unless capture is upgraded to real `usage` fields from vendor logs. JetBrains-style surveys show multi-tool adoption ([April 2026 research post](https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/)) — users will compare Unfade numbers to Cursor/Anthropic bills; **trust requires honest labeling**.

### 0.4 Document hygiene fixes (this pass)

| Issue | Correction |
|---|---|
| Web dashboard paths | Use **`src/server/pages/*.ts`** (Hono + server HTML), not `src/web/pages/`. |
| MCP tool names | Match existing convention: **`unfade_*` snake_case**. **`unfade_comprehension` already exists** — extend it; add `unfade_efficiency`, `unfade_costs`, `unfade_coach` (not hyphenated `unfade-efficiency`). |
| Competitor metrics (ARR, valuations, “70% waste”) | Treat as **directional** unless linked to primary sources in doc footnotes; several lines were narrative aggregation — **do not use in investor materials without citation**. |
| “Only Unfade can answer X” | Replace with **“Unfade is positioned to answer X when cross-tool transcripts + git + terminal are fused locally”** — avoids false uniqueness if a funded competitor ships passive parsers. |

### 0.5 “Most loved on launch” — missing product layers (add to backlog)

Recent ecosystem behavior (multi-tool, agent loops, comprehension anxiety — see §3.4) implies **launch delight** needs more than dashboards:

1. **Trust UX:** per-metric “how we know / what we don’t know” and confidence bars.  
2. **Action channel:** one-click “apply to CLAUDE.md / rules snippet” from a coach insight (opt-in, file-backed).  
3. **Silence by default:** no alert spam; weekly digest as the premium rhythm.  
4. **Pairing with evaluation:** optional export that compares Unfade proxies to **one** pasted invoice line — self-validation ritual.

---

## 1. Business Justification

### 1.1 The Insight That Changes Everything

Phases **0–4** build the **capture → distill → identity → platform / continuous intelligence** pipeline (see phase docs under `.internal/architecture/`). Phase **6** extends platform coverage (Windows, cloud distill, team/enterprise specs). Phase **7** is the first phase dedicated to **active optimization** on top of that stack. Capabilities here transform Unfade from a passive reasoning recorder into an **active intelligence layer** that makes developers measurably better at working with AI.

The research is unambiguous: developers don't just want to *see* what they did. They want to *improve* how they work. They want answers to questions no tool can currently answer:

| Question developers ask | What exists today | What Unfade can uniquely answer |
|---|---|---|
| "Am I using AI well or just rubber-stamping?" | Nothing. No tool measures this | "Your acceptance rate dropped from 91% to 68% this month. You're modifying AI output more in auth — that's where your deepest expertise lives" |
| "Where is my AI budget actually going?" | Billing dashboards showing total spend | "63% of your Claude tokens this week went to re-explaining context. If your AI tools had Unfade's MCP context, you'd save ~$180/month" |
| "Why does my AI keep making the same mistakes?" | Nothing. Session amnesia ensures repetition | "Claude suggested a singleton pattern 4 times this month. You rejected it every time. Unfade now auto-injects 'developer prefers DI over singletons in this codebase' into every session" |
| "Am I getting faster at making good decisions?" | Nothing. No longitudinal reasoning metrics exist | "Auth decisions took 6 back-and-forth turns in March. Now they take 2. Your reasoning velocity in auth: +200%" |
| "How much of my code do I actually understand?" | Nothing. Comprehension is unmeasured | "Payments module: comprehension 31 — you accepted 90% verbatim without modification. Auth module: comprehension 82 — you engaged deeply, modified 68% of suggestions" |
| "What should my manager know about my AI usage?" | DORA metrics, PR counts, commit volume | "Engineer A modifies 68% of AI suggestions and explores 3.2 alternatives per decision. Engineer B accepts 91% verbatim. Same commit count. Radically different reasoning depth" |

### 1.2 Why This Phase Exists Now

Three market forces create urgency:

**1. The \$12.8B AI coding tool market has zero reasoning intelligence.** Cursor (\$2B ARR, \$29B valuation), GitHub Copilot (37% market share), Claude Code, Windsurf, Kiro, Antigravity — every tool generates code. None help developers understand *how* they use AI. The entire market is a black box to its own users. Unfade is the only tool positioned to illuminate it because we already capture the raw signal (AI conversation logs, token counts, acceptance/rejection rates, session timing) that no other tool has access to in aggregate.

**2. Cost explosion is creating demand for AI usage analytics.** Cursor's June 2025 billing switch caused users to report costs jumping from \$28/month to \$500 in three days. A fintech rolled back Cursor for 200 developers after overages hit \$22,000\/month. One developer spent \$4,800 on AI tools in 2025. 70% of tokens in AI agent runs are identified as waste. Yet no tool helps individual developers understand their own AI economics. LLM observability tools (Langfuse, Helicone, Portkey) track API calls for app builders — not for developers understanding their own usage patterns.

**3. The productivity paradox demands measurement.** METR found experienced developers were 19% slower with AI tools on real codebases, yet perceived themselves 24% faster. Addy Osmani identified "comprehension debt" — developers score 17% lower on understanding AI-assisted code. AI-coauthored PRs have ~1.7x more issues. 69% of frequent AI users report deployment problems with AI-generated code. The gap between *feeling* productive and *being* productive is the crisis — and Unfade is the only tool that can measure the difference because we capture the reasoning layer between the developer and the AI.

### 1.3 The Principle

> **Capture is the foundation. Intelligence is the product.** Raw signals already in the bus — **conversation windows with `direction_signals`, turn counts, git/terminal correlation, distill decisions, dead ends** — contain actionable insight *when fused and labeled honestly*. Vendor-grade **per-token** counts and **per-suggestion** accept/reject streams are **not yet universal** in capture; Phase 7 must either **derive** proxies from transcripts + git or **extend** parsers. Phase 7 turns validated signals into active intelligence: **AI Efficiency Score**, **Prompt Coach**, **Loop Detector**, **Comprehension Radar** (extending shipped scoring), and **Cost Attribution** (extending the token **proxy**). These are not features bolted onto a logger — they are the reason the logger exists — **provided** the data contracts in §0 stay truthful.

---

## 2. The Problem

### 2.1 Current State (after Phase 4 continuous implementation in code)

Unfade captures events from git, AI sessions, and terminal. It distills them into daily summaries. It builds a reasoning profile (ReasoningModelV2) with decision style, trade-off preferences, domain distribution, and direction patterns. It exposes this data via MCP for cross-tool context injection. It generates Unfade Cards and a Thinking Graph.

**Already landed (continuous layer in repo — see §0):** materialized SQLite + periodic `summary.json` updates, **token spend proxy** and **cost-per-quality-style fields** (pricing-dependent, estimate-only), **comprehension + file-direction** signals for heatmap/dashboard paths, **`unfade_comprehension` MCP tool**, ring-buffer insights, multi-repo registry.

What remains **for Phase 7** (deeper / actionable / habit-forming):

| Gap | Impact |
|---|---|
| **No unified AI Efficiency Score (AES)** | Sub-metrics exist in pieces; users lack one **explainable composite** with tunable weights |
| **No honest cost attribution at invoice fidelity** | Proxy spend helps; **per-branch / per-decision USD** from real token usage requires richer capture or user reconciliation |
| **No prompt pattern analysis (coach)** | Prompt text exists inside `ai-conversation` / distill context but **systematic clustering ↔ outcome** is not a product surface |
| **No proactive stuck-loop / rejection replay** | Dead ends surface in distill; **MCP-injected warnings** before repeated mistakes are not shipped |
| **Comprehension not yet “Radar-grade”** | Shipped heuristics ≠ full **modification-depth / test-link / review-latency** stack in §4.4 |
| **No reasoning velocity dashboard** | Temporal data exists; **week-over-week velocity UX** not first-class |
| **No blind spot alert engine** | Threshold-based nudges with caps not shipped as dedicated product |
| **No decision replay** | Distill decisions exist; **temporal drift triggers** are not an automated loop |

### 2.2 After Phase 7

| Concern | State |
|---|---|
| **AI Efficiency Score** | Real-time composite metric: how effectively you direct AI, where you waste tokens, where you excel |
| **Prompt Coach** | Pattern analysis of prompts that led to accepted vs. rejected AI output, with actionable suggestions |
| **Loop Detector** | Proactive detection of stuck patterns, with MCP-injected warnings before you repeat a known mistake |
| **Comprehension Radar** | Per-module, per-domain measurement of engagement depth vs. passive acceptance |
| **Cost Attribution Engine** | Per-decision, per-domain, per-model cost tracking from captured token data |
| **Reasoning Velocity Dashboard** | Longitudinal tracking of how decision speed improves per domain |
| **Blind Spot Alerts** | Proactive warnings about domains where you defer without evaluation |
| **Decision Replay** | Resurface past decisions when new context suggests they should be revisited |

---

## 3. Research

### 3.1 Developer Pain Points (Primary Research, April 2026)

Research conducted across Reddit (r/programming, r/ClaudeAI, r/cursor, r/ExperiencedDevs, r/LocalLLaMA), Hacker News, X/Twitter, DEV Community, Indie Hackers, and engineering blogs. Findings organized by intensity and frequency.

**Methodology note:** Secondary citations below (vendor blogs, aggregators, market-size PDFs) vary in rigor. **Product decisions** should rely on **reproducible user studies** (e.g. JetBrains’ large-N surveys) or **first-party Unfade telemetry** post-launch — not on a single viral thread framed as universal law.

#### Pain Cluster 1: Context Loss and AI Amnesia (CRITICAL — Highest Intensity)

The single most repeated frustration across every developer community:

| Signal | Source | Intensity |
|---|---|---|
| "Every time you reset the context or start a new session, you're working with another brand new hire" | LogRocket Blog | Universal |
| AI agents "silently lose their CLAUDE.md instructions, forget which files they'd already modified, and repeat work they'd done 30 minutes ago" | DEV Community | High — recurring thread |
| At ~150K tokens (~75% of Claude's 200K window), context compression drops instructions from the top first | Developer reports | High — causes cascading failures |
| Developer trust in AI output / comprehension anxiety | Multiple 2025–2026 surveys & essays | Recurring — **verify exact percentages per source before marketing copy** |
| The AI agent memory market: $6.27B in 2025, projected $28.45B by 2030 (35% CAGR) | Mem0 Report | Market validation |
| Developers created "elaborate workaround systems with 62 agents" just for basic continuity | HN | Desperation signal |
| 60,000+ repos use AGENTS.md files — described as "wish lists, not contracts" that work ~20-25% of the time | NineTwoThree | Scale of workaround |

**What Unfade uniquely solves:** We already capture reasoning from AI sessions. The breakthrough is actively injecting distilled lessons, not just raw context, via MCP. "Your AI doesn't need to re-derive that you prefer DI over singletons — Unfade already knows, and tells it."

#### Pain Cluster 2: Cost Explosion and Opacity (HIGH — Growing Intensity)

| Signal | Source | Intensity |
|---|---|---|
| Cursor billing switch: users reported costs jumping $28/mo → $500 in 3 days | TechCrunch | High — mass backlash |
| Fintech rolled back Cursor for 200 devs after $22,000/mo overages | Morph | Enterprise impact |
| A production AI agent racked up $2,400 in API charges overnight in infinite loop | Developer report | Catastrophic waste |
| One developer spent $4,800 on AI coding tools in 2025 | Medium | Individual pain |
| 70% of tokens in AI agent runs identified as waste | Analysis study | Systemic inefficiency |
| Team of 10: $192,666 annual AI cost including debugging AI errors ($46,800) and review time ($78,000) | Cost analysis | Hidden costs dwarf licensing |
| 30% hit token limits — "frustrating and disruptive, especially when in a flow state" | GetPanto | Flow state interruption |

**What Unfade uniquely solves:** We already capture token counts (input/output/total) per AI session in event metadata. We know which sessions led to accepted decisions vs. rejected ones. The breakthrough is computing cost-per-decision, waste-per-session, and projecting savings from context injection.

#### Pain Cluster 3: Agent Stuck Loops and Repetitive Mistakes (HIGH)

| Signal | Source | Intensity |
|---|---|---|
| "When a coding agent gets stuck, it doesn't stop. It loops... Each iteration adds tokens to context" | Leanware | High — universal experience |
| After 15 iterations: 30K-75K tokens spent on a problem the agent will never solve | Loop analysis | Quantified waste |
| A 50-iteration loop can cost $50-100+ in API credits | Developer report | Direct financial pain |
| "The babysitting requirement means time spent debugging AI-generated code can eclipse time savings" | Multiple sources | Productivity paradox |
| AI-coauthored PRs have ~1.7x more issues than human-only PRs | CodeRabbit Dec 2025 | Quality regression |

**What Unfade uniquely solves:** We capture error→retry→fix chains and dead ends. The breakthrough is learning from past stuck loops and proactively injecting warnings via MCP: "Claude is about to suggest the same approach you rejected 3 times this month."

#### Pain Cluster 4: Convention Violations and Personalization Failure (MEDIUM-HIGH)

| Signal | Source | Intensity |
|---|---|---|
| Developers set .cursorrules but Cursor "acknowledges them then generates class components with any types instead" | DEV Community | Frustration |
| "The agent is unlikely to stick to any coding conventions unless they're explicitly laid out" | Pete Hodgson | Structural limitation |
| AI told developer: "rules are just text, with no enforced behavior behind them" | Developer report | Tool acknowledges failure |
| "Developers working with niche frameworks, legacy codebases, or domain-specific requirements report AI becomes nearly worthless" | Multiple sources | Domain-specific failure |

**What Unfade uniquely solves:** ReasoningModelV2 already tracks domain expertise and decision patterns. The breakthrough is transforming this profile into active context that makes conventions behavioral, not textual.

#### Pain Cluster 5: Developer Identity Crisis (MEDIUM — Existential)

| Signal | Source | Intensity |
|---|---|---|
| "Some builder-types report identity loss and even grief — much relating to no longer doing hands-on coding because they cannot justify it" | Pragmatic Engineer | Emotional — widespread |
| "Developers who have gone furthest with AI describe their role as 'creative director of code'" | GitHub Blog | Identity shift |
| LeadDev published "Managing the AI-driven developer identity crisis" | LeadDev | Institutionally recognized |
| "My GitHub Exploded, But My Impact Didn't" — green squares "went vertical" with AI but developer wasn't more impactful | Mandar's Blog | Measurement failure |
| "A GitHub contribution graph measures neither productivity, nor skill, nor engagement" | DEV Community | Identity artifact failure |
| Recruiters "don't ask for resumes first anymore. They ask for links" | Multiple sources | Market signal |

**What Unfade uniquely solves:** Thinking Graph and Unfade Cards already address this. The breakthrough capabilities in Phase 7 make the identity *actionable* — not just "here's who you are" but "here's how you're improving."

#### Pain Cluster 6: Knowledge Silos and the Bus Factor (MEDIUM)

| Signal | Source | Intensity |
|---|---|---|
| 45% of developers report knowledge silos negatively impact productivity 3+ times/week | Leadership Garden | Frequent |
| Senior engineer onboarding: 12-16 weeks with high tribal knowledge vs. 4-6 weeks documented | Industry data | Costly |
| Rebuilding knowledge after a developer leaves costs $200-300K per lost developer | Codenteam | Enterprise pain |
| "Code is generated faster than intent is captured" — AI accelerates the knowledge loss problem | Multiple sources | Worsening |
| "Teams break architecture because the people who understood the original decisions leave" | DEV Community | Structural failure |

**What Unfade uniquely solves:** Daily Distills and the reasoning profile already capture why decisions were made. The breakthrough is making this knowledge *queryable per person* — Team Unfades where each developer's reasoning is preserved and searchable even after they leave.

### 3.2 Competitive Landscape Update (April 2026)

#### New Entrants Since Original Analysis

| Tool | What It Does | Threat to Unfade | Gap It Leaves |
|---|---|---|---|
| **Quint** (quint.codes) | Decision engineering for AI coding tools. `.haft/` directory, evidence decay (90-day auto-expire), structured reasoning. Works with Claude Code, Cursor, Gemini CLI, Codex | **MEDIUM** — closest new competitor to reasoning capture | Requires explicit `/h-reason` invocation — not passive. No developer identity. No cross-project aggregation. No visualization. No distillation. Decision-only, no terminal or git capture |
| **Google Antigravity** | Agent-first IDE with Manager Surface, Artifacts system, Knowledge base. Free in preview | **LOW** — agent-focused, not developer-focused | No developer identity. No cross-tool reasoning. Knowledge base serves agents, not developers |
| **Amazon Kiro** | Spec-driven development — generates specs before code. Agent Hooks. 250K+ devs since Nov 2025 | **LOW** — code generation, not reasoning capture | No reasoning persistence. No developer profile. No cross-session learning |
| **Potpie AI** ($2.2M pre-seed) | Engineering context layer / knowledge graph for code. Ontology-first. Enterprises with 1M+ LOC | **LOW** — codebase-focused, not developer-focused | No developer identity. No AI session parsing. No reasoning capture from individuals |
| **Hive Memory MCP** | Cross-project memory via MCP server | **LOW-MEDIUM** — generic memory, not reasoning | No reasoning distillation. No developer identity. No pattern learning |

#### Market Scale Update

| Metric | Value | Source |
|---|---|---|
| AI coding tool market size | Multi–$B TAM (definitions differ by analyst) | **Cite primary report if used externally** |
| Developer AI adoption | 84% use AI tools; AI writes 41% of all code | Stack Overflow / surveys |
| Cursor scale | $2B ARR, $29B valuation, 2M+ users, 1M+ paying | TechCrunch Feb 2026 |
| Replit scale | $400M Series D at $9B valuation, targeting $1B revenue | Industry reports |
| AI agent memory market | $6.27B (2025), projected $28.45B by 2030 (35% CAGR) | Mem0 report |
| Augment Code | $252M raised, $977M valuation, 100K+ devs | TechCrunch |
| Poolside AI | $626M raised at $3B, reportedly raising $2B at $12B | TechCrunch |

#### The Seven White Spaces (Validated)

Research confirms seven white spaces where no tool operates:

| # | White Space | Closest Competitor | Distance from Coverage |
|---|---|---|---|
| 1 | **Passive reasoning capture from AI sessions** | Quint (opt-in only) | Quint requires explicit commands; no passive capture exists |
| 2 | **Cross-tool reasoning aggregation (Git + AI + Terminal)** | None | WakaTime tracks time. LinearB tracks PRs. Langfuse tracks API calls. None connect the three |
| 3 | **Developer identity from reasoning patterns** | None | Every identity tool measures output quantity, not reasoning quality |
| 4 | **Automated distillation of engineering knowledge** | None | ADR tools are manual. Obsidian is manual. No auto-synthesis exists |
| 5 | **Compounding developer context via MCP** | Reflect Memory (fact-level only) | Reflect stores preferences; no tool injects reasoning-level understanding |
| 6 | **The reasoning layer between code and metrics** | None | Engineering metrics measure outputs. AI tools generate code. The reasoning between is uncaptured |
| 7 | **Individual-level AI productivity measurement** | None | DX measures team-level. WakaTime tracks time. No tool helps an individual understand their AI usage patterns |

**White Space #7 is the Phase 7 opportunity.** Every other white space is largely addressed by Phases 0–4 **plus** the shipped continuous materialization path in code. White Space #7 — **individual-level AI productivity measurement with honest confidence** — is the gap Phase 7 fills. The **core bus** exists; **invoice-fidelity and per-suggestion outcomes** may still need capture upgrades (§0.2–§0.3).

### 3.3 Data we have vs data we assumed (verification-aligned)

**Correction to earlier draft:** passive capture’s main AI event is **`ai-conversation`** with **`direction_signals`** and **`turn_count`**, not a steady stream of `ai-completion` / `ai-rejection`. Token **API** counts are **not** yet a guaranteed field on every event — the materializer uses a **count-based spend proxy** (`token-proxy.ts`) plus optional pricing.

| Raw signal | Where it lives | Maturity today | Phase 7 use (honest) |
|---|---|---|---|
| **Direction / HDS-style signals** | `metadata.direction_signals` on `ai-conversation` | **High** | AES direction sub-score; trend baselines |
| **`ai-completion` / `ai-rejection`** | Schema + tests; optional enrichers | **Low–medium** in passive capture | Fine-grained coach/loop — **derive from transcripts** or **extend daemon** |
| **Vendor token usage (input/output)** | Parser-dependent | **Low** unless enriched | Invoice-grade cost — **capture upgrade** or user reconciliation |
| **Spend proxy (events × model × price table)** | SQLite `token_proxy_spend`, summary | **Medium** | Cost dashboards — always label **estimate** |
| **Comprehension heuristics** | Materializer path + MCP | **Medium** | Extend toward full **Radar** (diff/test/review depth) |
| **Prompt/response text** | `content.detail` (often truncated) | **Medium** | Prompt Coach + similarity — needs **redaction + length policy** |
| **Git / terminal / distill decisions** | Existing pipeline | **High** | Velocity, replay, leadership rollups |

### 3.4 Recent ecosystem signals (external, Jan–Apr 2026)

| Signal | Why it matters for Phase 7 | Source |
|---|---|---|
| **~90% of developers use AI tools at work regularly**; **~74% use specialized coding assistants** | Validates demand for *measurement* not just *generation* | [JetBrains — Which AI Coding Tools Do Developers Actually Use at Work?](https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/) |
| **Multi-tool usage is normal** | Strengthens Unfade’s **cross-vendor** positioning vs single-IDE memory | Same |
| **Fast mover: Claude Code adoption curve** in survey rankings | Parser priority + “terminal agent” UX parity | Same |

---

## 4. Breakthrough Capabilities

### 4.1 AI Efficiency Score (AES)

**The Wow Moment:** _"Your AI Efficiency Score is 64. You're in the top 30% of developers using Claude Code. Your biggest efficiency gain this week: architecture prompts where you specify constraints upfront produce 3x fewer iteration rounds."_

**What it is:** A composite, real-time metric (0-100) that measures how effectively a developer uses AI tools. Not a judgment — an optimization signal. Like a fuel efficiency gauge for AI-assisted development.

**Components:**

| Sub-metric | Weight | Computed From | What It Measures |
|---|---|---|---|
| **Direction Density** | 25% | HDS scores across sessions | How often you direct vs. follow AI |
| **Token Efficiency** | 25% | **When available:** tokens per accepted decision from vendor metadata. **Otherwise:** spend-proxy events per decision / per distill — must be labeled *estimate* (§0.3) | How much “AI surface area” buys useful judgment vs. waste |
| **Iteration Ratio** | 20% | Turns-to-acceptance across sessions | How many back-and-forth rounds before reaching a good outcome |
| **Context Leverage** | 15% | Re-explanation detection via prompt similarity | How often you re-explain context that Unfade already knows |
| **Modification Depth** | 15% | Diff between AI suggestion and committed code | How deeply you engage with AI output before accepting |

**Why it matters:** No tool in the $12.8B AI coding market tells developers how well they use AI. Every other productivity metric (DORA, cycle time, PR throughput) measures output. AES measures the human layer — the quality of human-AI collaboration.

**Why competitors can't replicate:** AES requires cross-tool AI session data (prompts, responses, token counts, acceptance/rejection signals) combined with git commit data (what was actually shipped) combined with temporal analysis (how patterns evolve). No single-tool vendor has this cross-cutting view. LLM observability tools (Langfuse, Helicone) track API calls but not the developer's reasoning process.

---

### 4.2 Prompt Coach

**The Wow Moment:** _"Your database prompts that include schema context produce accepted output 78% of the time. Without schema context: 23%. Suggestion: always include relevant schema when asking about queries."_

**What it is:** An analysis engine that identifies patterns in prompts that produce good outcomes (accepted, modified, shipped) vs. bad outcomes (rejected, abandoned, led to dead ends). Delivers actionable, personalized suggestions.

**How it works:**

1. **Corpus:** Primary path: `ai-conversation` with `content.detail` (may be truncated) + `direction_signals` + git outcomes. **Augmented path:** `ai-completion` / `ai-rejection` when emitted by enrichers/parsers — do not assume universal coverage until §0.2 is implemented.
2. **Pattern extraction:** Cluster prompts by domain, task type, and structural features (constraint specification, example inclusion, context depth, question framing)
3. **Outcome correlation:** For each pattern cluster, compute acceptance rate, iteration count, and modification depth
4. **Insight generation:** Surface the highest-leverage patterns — where small prompt changes produce large outcome differences

**Insight categories:**

| Category | Example Insight | Data Source |
|---|---|---|
| **Context specification** | "Your auth prompts with explicit constraint lists are accepted 3x more often" | Prompt structure → acceptance rate |
| **Domain-specific patterns** | "For database work, including schema produces 78% acceptance vs. 23% without" | Domain tag → prompt features → outcome |
| **Framing effects** | "Asking 'evaluate these 3 approaches' produces better outcomes than 'implement X'" | Prompt framing → HDS → outcome |
| **Anti-patterns** | "Prompts longer than 500 words in frontend domain have 2x rejection rate — you lose signal in noise" | Prompt length → domain → outcome |
| **Tool-specific** | "Your Claude Code prompts outperform Cursor prompts in architecture tasks by 40%" | Tool → domain → outcome |

**Why it matters:** Prompt engineering is the most discussed and least measured skill in AI-assisted development. Everyone talks about writing better prompts; nobody has data on what "better" means for *their specific workflow*. Unfade has this data — every prompt, every outcome, correlated over weeks and months.

---

### 4.3 Loop Detector & Cross-Session Learning

**The Wow Moment:** _"Warning injected via MCP: 'You rejected a singleton pattern for this service 3 times in the past 2 weeks. Your preferred approach: dependency injection with interface contracts. Last time: daemon/internal/capture/orchestrator.go on April 14.'"_

**What it is:** A proactive system that detects when AI is about to suggest something the developer has previously rejected, and injects a warning + the developer's preferred approach via MCP before the suggestion is made.

**How it works:**

1. **Rejection / override database:** Prefer `ai-rejection` when present; otherwise infer “override moments” from **direction_signals + transcript markers** on `ai-conversation`. Index by domain / file / pattern hash.
2. **Preference extraction:** From rejection patterns, extract positive preferences ("developer always chooses DI over singletons," "developer prefers explicit error handling over try-catch")
3. **MCP injection:** When an AI tool queries Unfade's MCP server for context, include relevant learned preferences and rejection history for the current domain/file
4. **Loop detection:** When the materializer sees a new AI session touching a domain where rejections have occurred, flag the session and enrich MCP context with anti-patterns

**Three levels of proactivity:**

| Level | Trigger | Action |
|---|---|---|
| **Passive** | AI tool queries MCP for context | Include relevant rejection history and preferences in response |
| **Alert** | Materializer detects session in domain with known rejection patterns | Surface warning in dashboard: "You typically reject X in this domain" |
| **Preventive** | Pattern match between current prompt and past rejected suggestions | Inject specific guidance: "Last 3 times Claude suggested Y here, you redirected to Z" |

**Why it matters:** This is the single capability that most directly addresses the #1 developer pain point (AI amnesia). Every AI session today starts from zero. With the Loop Detector, every AI session starts with *lessons learned from every previous session*. The AI doesn't repeat mistakes because Unfade remembers them.

**Stuck loop economics:** A 50-iteration stuck loop costs $50-100+ in API credits. If Unfade prevents even one stuck loop per week, the ROI is immediate and measurable.

---

### 4.4 Comprehension Radar

**The Wow Moment:** _"Auth module: Comprehension 82 — you engaged deeply, modified 68% of AI suggestions, and asked 4 clarifying questions. Payments module: Comprehension 31 — you accepted 90% verbatim. Risk: you may not fully understand the payment retry logic that shipped yesterday."_

**What it is:** A per-module, per-domain measurement of how deeply a developer engages with AI-generated code. Not a judgment — a risk signal. Low comprehension in a critical module is an audit flag.

**Comprehension Score formula (0-100):**

| Factor | Weight | What It Measures |
|---|---|---|
| **Modification rate** | 30% | % of AI suggestions modified before commit |
| **Question density** | 25% | Number of clarifying/challenging prompts per AI session in this module |
| **Alternative exploration** | 20% | Number of alternatives evaluated before accepting |
| **Test engagement** | 15% | Whether developer ran tests or wrote tests for AI-generated code in this module |
| **Review depth** | 10% | Time spent between AI suggestion and commit (rushed = low comprehension signal) |

**Computed from existing data:**
- `ai-completion` / `ai-rejection` **when present**, else **proxy signals** from `ai-conversation` + git file overlap → module attribution
- Prompt analysis for question marks, "why", "what about", "alternatively" → question density
- `alternatives_evaluated` from HDS classifier → alternative exploration
- `command` events with test/build commands temporally linked to AI sessions → test engagement
- Timestamp delta between AI session end and git commit → review depth

**Why it matters:** METR found developers score 17% lower on understanding AI-assisted code. This is the "comprehension debt" crisis. No tool measures it. Unfade is uniquely positioned because we have both the AI session data (what was suggested) and the git data (what was committed), allowing diff-level comprehension analysis.

**Leadership value:** Engineering managers get module-level comprehension heatmaps. "The payments module has average comprehension of 28 across the team. Schedule a review session before the next release." This is the killer enterprise feature — not velocity metrics, but *understanding* metrics.

---

### 4.5 Cost Attribution Engine

**The Wow Moment:** _"This week: $47.20 in AI costs. Breakdown: Auth refactor ($18.40 — high value, 3 shipped decisions), Payments debugging ($22.30 — 60% was a stuck loop on retry logic), CSS fixes ($6.50 — could have been done without AI). Your most cost-effective domain: infrastructure ($3.20 per shipped decision). Least cost-effective: frontend styling ($14.80 per shipped decision)."_

**What it is:** Per-decision, per-domain, per-model, per-feature-branch cost tracking, computed from token counts already captured in event metadata.

**Cost computation:**

```
cost_per_session = (input_tokens × model_input_rate) + (output_tokens × model_output_rate)
cost_per_decision = sum(session_costs for sessions contributing to decision) / decisions_shipped
waste_ratio = cost_of_rejected_sessions / total_cost
context_overhead = cost_of_re-explanation_tokens / total_cost
```

**Model rate table (configurable, shipped with defaults):**

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| Claude Opus 4.6 | $15.00 | $75.00 |
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| GPT-4o | $2.50 | $10.00 |
| Gemini 3 Pro | $1.25 | $5.00 |
| Local (Ollama) | $0.00 | $0.00 |

**Attribution dimensions:**

| Dimension | Source | Insight |
|---|---|---|
| **Per decision** | Link AI sessions to git commits via temporal + file overlap | "This architectural decision cost $18.40 in AI tokens across 6 sessions" |
| **Per domain** | Domain tags from distill pipeline | "Infrastructure: $3.20/decision. Frontend: $14.80/decision" |
| **Per model** | `metadata.model` on AI session events | "Claude Opus for architecture, Sonnet for implementation saves 60%" |
| **Per branch** | `gitContext.branch` on events | "Feature branch `auth-refactor`: total AI cost $42.00" |
| **Waste breakdown** | Rejected sessions, dead ends, stuck loops | "22% of spend was on ultimately rejected approaches" |
| **Context overhead** | Prompt similarity detection across sessions | "35% of tokens were re-explaining context Unfade already knows" |

**Projected savings:** The context overhead metric is the most powerful sales tool: "If every AI tool in your workflow had Unfade's MCP context, you'd save X% of your AI spend by eliminating re-explanation tokens."

**Why it matters:** $12.8B is being spent on AI coding tools. Zero tools help individual developers understand where that money goes. Unfade turns opaque billing into transparent, actionable cost intelligence — and directly quantifies its own value proposition (context injection = token savings).

---

### 4.6 Reasoning Velocity Dashboard

**The Wow Moment:** _"Auth decisions: March average 6.2 turns, April average 2.1 turns. Reasoning velocity: +195%. You're making faster, more confident decisions in auth because your domain expertise has deepened. Suggestion: your payments domain is where auth was 2 months ago — expect similar acceleration."_

**What it is:** Longitudinal tracking of how quickly a developer reaches good decisions in each domain, measured by turns-to-acceptance, time-to-commit, and alternatives-evaluated trends over weeks and months.

**Velocity metrics:**

| Metric | Computation | What It Shows |
|---|---|---|
| **Turns-to-acceptance** | Average AI conversation turns before accepted decision, per domain, per week | Fewer turns = faster convergence = deeper expertise |
| **Time-to-commit** | Average time from first AI session to git commit, per domain | Shorter time = more confident decision-making |
| **Alternatives evaluated** | Average alternatives considered per decision, per domain | Stable or increasing = maintaining rigor. Decreasing = potential complacency |
| **Dead-end ratio** | % of exploration paths abandoned, per domain, per week | Decreasing = better judgment about viable approaches |

**Trend detection:** Week-over-week, month-over-month trends with statistical significance thresholds. Only surface a "velocity improvement" when the trend is statistically meaningful (>2 standard deviations over 4+ data points).

**Why it matters:** No tool tracks whether a developer is getting better at making decisions. Performance reviews are subjective. Code output metrics are gameable. Reasoning velocity is an objective, longitudinal measure of expertise deepening — the first of its kind.

---

### 4.7 Blind Spot Alerts

**The Wow Moment:** _"Alert: Your payments module has a comprehension score of 28 and an AI acceptance rate of 94%. You've shipped 12 payment-related changes this month with minimal engagement. Consider: reviewing the retry logic manually, or pairing on the next payments task."_

**What it is:** Proactive alerts when pattern analysis reveals domains where the developer accepts AI output without deep engagement — potential blind spots where comprehension debt is accumulating.

**Detection criteria:**

| Signal | Threshold | Alert |
|---|---|---|
| AI acceptance rate > 90% in a domain with > 5 decisions | Sustained over 2+ weeks | "You're accepting almost everything in {domain}. Past behavior: you usually evaluate 3+ alternatives" |
| Comprehension score < 40 in a domain with recent commits | 3+ commits with low comprehension | "Low engagement with AI output in {domain}. Risk: you may not fully understand what shipped" |
| Declining HDS trend in a domain | Statistically significant decline over 3+ weeks | "Your direction density is dropping in {domain}. You're steering less and accepting more" |
| No alternatives evaluated in high-stakes domain | 3+ decisions with zero alternatives in a critical domain | "You've stopped evaluating alternatives in {domain}. This breaks your usual pattern" |

**Why it matters:** This is the capability that makes Unfade a *development partner*, not just a logger. It uses the developer's own historical patterns as the baseline — not an arbitrary standard. "You usually do X; you've stopped doing X in this domain" is a personalized, evidence-based nudge that respects the developer's autonomy.

---

### 4.8 Decision Replay

**The Wow Moment:** _"3 months ago you chose Redis for the caching layer (decision: 2026-01-18, branch: cache-implementation). Since then, you've made 8 decisions suggesting the deployment topology has changed. Consider: does the Redis choice still hold given the current architecture?"_

**What it is:** A system that resurfaces past decisions when new context suggests they should be revisited. Not a notification spam engine — a carefully filtered system that only surfaces high-confidence replays.

**Replay triggers:**

| Trigger | Detection | Example |
|---|---|---|
| **Domain drift** | A past decision was made under domain assumptions that subsequent decisions have changed | "You chose SQL for X because of consistency. Since then, 5 decisions prioritized eventual consistency" |
| **Technology evolution** | A past decision involved a technology that the developer has since moved away from | "You chose library X. Your last 3 projects use library Y instead" |
| **Failure echo** | A current dead end resembles a past decision's predicted risk | "The timeout issue you're debugging was flagged as a risk when you chose this caching strategy" |
| **Alternative validation** | An alternative that was rejected in a past decision has since been validated in a different context | "You rejected DynamoDB for project A. You successfully used it in project B. Revisit for project A?" |

**Filter criteria (prevent noise):**
- Only replay decisions older than 2 weeks (avoid rehashing recent choices)
- Only replay when confidence > 0.7 that the trigger is genuine
- Maximum 2 replays per week (prevent notification fatigue)
- User can dismiss with "decision still valid" (Unfade learns)

---

## 5. Data Gap Analysis

### 5.1 What we currently capture vs. what Phase 7 needs (post–§0)

| Capability | Data required | Captured today? | Gap |
|---|---|---|---|
| **AI Efficiency Score** | Direction signals, iteration proxies, spend proxy or tokens, optional diffs | **PARTIAL** — direction + turns strong; tokens often proxy | Composite formula + **confidence** UX |
| **Prompt Coach** | Rich prompts + outcomes | **PARTIAL** — text in `ai-conversation.detail` (variable richness) | Clustering + outcome correlation + **redaction** |
| **Loop Detector** | Rejections / overrides | **PARTIAL** — `ai-rejection` sparse; infer from conversations | Indexing + similarity + **false-positive** controls |
| **Comprehension Radar** | Multi-signal engagement | **PARTIAL** — shipped heuristics ≠ full radar | Diff engine + test linkage (§5.2) |
| **Cost Attribution** | Model + **usage** or proxy | **PARTIAL** — proxy in SQLite/summary | Parser upgrade **or** invoice reconcile mode |
| **Reasoning Velocity** | Time series of turns / commits / dead ends | **HIGH** | Dashboards + significance tests |
| **Blind Spot Alerts** | Comprehension + acceptance proxies | **PARTIAL** | Threshold engine + weekly cadence |
| **Decision Replay** | Distill decisions + drift signals | **MEDIUM** | Trigger model + caps |

### 5.2 New data collection / enrichment (minimum set)

| New data | Purpose | Collection method |
|---|---|---|
| **AI suggestion → committed code diff** | True modification-depth for Comprehension Radar | Compare last AI-touch window to subsequent `commit` diff per overlapping file — **materializer post-pass** |
| **(Recommended) Enriched usage metadata** | Invoice-grade cost + token efficiency | Extend parsers/daemon to record **vendor usage** fields when log format exposes them; else remain proxy |

Everything else can start as **pure computation** on `ai-conversation` + git + terminal — with explicit confidence tiers.

### 5.3 New Schema Extensions

**CaptureEvent metadata extensions (backward-compatible):**

```
metadata: {
  // Existing (optional — populate when parser exposes vendor usage)
  tokenCount?: { input: number, output: number, total: number }
  model?: string
  
  // New (Phase 7)
  estimatedCost?: { input: number, output: number, total: number }  // USD
  promptFeatures?: {
    length: number           // character count
    hasConstraints: boolean  // detected constraint specification
    hasExamples: boolean     // detected example inclusion
    hasSchema: boolean       // detected schema/type context
    questionCount: number    // count of questions in prompt
  }
  suggestionSimilarity?: number  // 0-1, similarity to previously rejected suggestions
}
```

**ReasoningModelV2 extensions (backward-compatible):**

```
efficiency: {
  aes: number                    // 0-100 AI Efficiency Score
  tokenEfficiency: number        // accepted decisions per 1000 tokens
  iterationRatio: number         // average turns to acceptance
  contextLeverage: number        // 0-1, how much context is reused vs re-explained
  modificationDepth: number      // 0-1, average modification of AI output
  costPerDecision: {
    overall: number              // USD
    byDomain: Record<string, number>
    byModel: Record<string, number>
  }
  totalEstimatedCost: {
    allTime: number
    last7Days: number
    last30Days: number
  }
  wasteRatio: number             // 0-1, cost of rejected/abandoned sessions
  contextOverhead: number        // 0-1, cost of re-explanation tokens
}

comprehension: {
  overall: number                // 0-100
  byModule: Record<string, {
    score: number                // 0-100
    decisionsCount: number
    lastUpdated: string          // ISO date
  }>
  byDomain: Record<string, number>
  blindSpots: string[]           // domains with score < 40
}

velocity: {
  byDomain: Record<string, {
    currentTurnsToAcceptance: number
    previousTurnsToAcceptance: number
    velocityChange: number       // percentage
    dataPoints: number
  }>
  overallTrend: 'accelerating' | 'stable' | 'decelerating'
}

promptPatterns: {
  effectivePatterns: Array<{
    domain: string
    pattern: string              // description
    acceptanceRate: number       // 0-1
    sampleSize: number
  }>
  antiPatterns: Array<{
    domain: string
    pattern: string
    rejectionRate: number        // 0-1
    suggestion: string           // actionable improvement
  }>
}
```

---

## 6. Architecture

### 6.1 Intelligence Pipeline

Phase 7 introduces an **Intelligence Pipeline** that runs after the materializer processes new events. It operates on the same `.unfade/` data bus — reading from `events/` and `distills/`, writing to a new `intelligence/` directory.

```
Go Capture Engine          TypeScript Server
     │                          │
     │  writes events/          │  reads events/
     ▼                          ▼
  .unfade/events/         Materializer (2s tick)
                               │
                               ├── Distiller (existing)
                               │      │
                               │      ▼
                               │   distills/
                               │
                               └── Intelligence Engine (NEW)
                                      │
                                      ├── Efficiency Analyzer
                                      ├── Prompt Pattern Analyzer
                                      ├── Loop Detector
                                      ├── Comprehension Scorer
                                      ├── Cost Attributor
                                      ├── Velocity Tracker
                                      ├── Blind Spot Detector
                                      └── Decision Replayer
                                      │
                                      ▼
                                   intelligence/
                                   ├── efficiency.json
                                   ├── prompt-patterns.json
                                   ├── rejections.idx.json
                                   ├── comprehension.json
                                   ├── costs.json
                                   ├── velocity.json
                                   ├── alerts.json
                                   └── replays.json
```

### 6.2 Directory Structure Extension

```
.unfade/
├── events/              # EXISTING — Go writes, TS reads
├── distills/            # EXISTING — TS writes
├── profile/             # EXISTING — reasoning_model.json (extended)
├── intelligence/        # NEW — Phase 7 outputs
│   ├── efficiency.json          # AES score, sub-metrics, history
│   ├── prompt-patterns.json     # Effective/anti-pattern analysis
│   ├── rejections.idx.json      # Indexed rejection database for loop detection
│   ├── comprehension.json       # Per-module comprehension scores
│   ├── costs.json               # Cost attribution by dimension
│   ├── velocity.json            # Reasoning velocity by domain
│   ├── alerts.json              # Active blind spot alerts
│   └── replays.json             # Pending decision replay suggestions
├── state/               # EXISTING
├── graph/               # EXISTING
├── cache/               # EXISTING
├── logs/                # EXISTING
└── ...
```

### 6.3 Intelligence Engine Architecture

```
src/services/intelligence/
├── engine.ts                    # Orchestrator — runs all analyzers on new events
├── analyzers/
│   ├── efficiency.ts            # AES computation (Direction + Token + Iteration + Context + Modification)
│   ├── prompt-patterns.ts       # Prompt clustering, outcome correlation, insight generation
│   ├── loop-detector.ts         # Rejection indexing, similarity matching, MCP injection
│   ├── comprehension.ts         # Per-module comprehension scoring
│   ├── cost-attribution.ts      # Token → cost conversion, dimension attribution
│   ├── velocity.ts              # Longitudinal trend computation
│   ├── blind-spots.ts           # Threshold-based alert generation
│   └── decision-replay.ts       # Temporal matching, trigger detection, confidence scoring
├── schemas/
│   ├── efficiency.ts            # Zod schemas for efficiency.json
│   ├── intelligence-event.ts    # Shared types across analyzers
│   └── alerts.ts                # Alert types and severity levels
└── utils/
    ├── text-similarity.ts       # Cosine similarity for prompt/suggestion matching
    ├── trend.ts                 # Statistical trend detection (moving average, std dev)
    └── cost-rates.ts            # Model cost rate table (configurable)
```

### 6.4 MCP Server Extensions

Phase 7 adds **up to three** new MCP tools and **extends** existing ones (snake_case naming matches `src/services/mcp/tools.ts`).

**New MCP tools (proposed names):**

| Tool | Input | Output | Purpose |
|---|---|---|---|
| `unfade_efficiency` | `{ period?: '7d' \| '30d' \| '90d' }` | AES score, sub-metrics, trend, top insights | "How efficiently am I using AI?" |
| `unfade_costs` | `{ period?: string, groupBy?: 'domain' \| 'model' \| 'branch' }` | Cost breakdown (**estimates** unless usage enriched) | "Where is my AI budget going (proxy)?" |
| `unfade_coach` | `{ domain?: string }` | Effective patterns, anti-patterns, suggestions | "How can I prompt better?" |

**Existing tool to extend (already shipped in the continuous layer):**

| Tool | Phase 7 extension |
|---|---|
| `unfade_comprehension` | Add Radar fields: confidence, modification depth (when diff engine exists), blind-spot hints — **do not register a second tool** |

**Extended MCP Resources:**

| Resource | Extension | Purpose |
|---|---|---|
| `unfade://profile` | Include `efficiency`, `comprehension`, `velocity`, `promptPatterns` sections from extended ReasoningModelV2 | AI tools see the full intelligence profile |
| `unfade://context` | Include active alerts, relevant rejection history, and learned preferences for current domain | AI tools get proactive warnings and learned preferences |

**Extended MCP Prompts:**

| Prompt | Purpose |
|---|---|
| `unfade-improve` | "Based on my Unfade profile, how can I work more effectively with AI in {domain}?" — injects efficiency data, prompt patterns, and comprehension scores |

### 6.5 Web Dashboard Extensions

**Canonical UI/UX re-architecture (IA, Live strip, data-to-UI mapping, flows, stack strategy):** [PHASE_7_WEB_UI_UX_ARCHITECTURE.md](./PHASE_7_WEB_UI_UX_ARCHITECTURE.md). Sprint tables below name **routes**; the UX spec may consolidate routes (e.g. a single **Intelligence** hub with AES as the hero) — follow the linked doc when implementing.

The existing Hono + htmx web dashboard at `localhost:7654` gets new pages (minimum set):

| Route | Page | Content |
|---|---|---|
| `/efficiency` or `/intelligence` | AI Efficiency / Intelligence hub | AES gauge, sub-metric breakdown, trend chart, top insights |
| `/costs` | Cost Attribution | Per-domain cost chart, per-model comparison, waste breakdown, projected savings (**estimate** UX) |
| `/comprehension` | Comprehension Radar | Module heatmap, per-domain scores, blind spot alerts |
| `/velocity` | Reasoning Velocity | Per-domain velocity trends, acceleration charts |
| `/coach` | Prompt Coach | Effective patterns, anti-patterns with examples, suggestions |

All pages follow the existing kap10 design system (Tailwind CSS CDN, htmx for interactivity, server-rendered HTML). **Default:** no SPA. Optional React/Next islands only where justified in [PHASE_7_WEB_UI_UX_ARCHITECTURE.md](./PHASE_7_WEB_UI_UX_ARCHITECTURE.md) §5.

---

## 7. Design Principles

### 7a. Mirror, Not Judge

Unfade's intelligence layer is a **mirror that reflects patterns**, not a judge that grades performance. "Your comprehension in payments is 31" is a data point, not a criticism. The developer decides what to do with it. Language is always observational: "Your pattern is X" — never prescriptive: "You should do X."

Exception: Blind Spot Alerts use gentle nudge language because the alert itself implies action is needed. But even alerts reference the developer's own historical patterns as the baseline: "This breaks your usual pattern of evaluating 3+ alternatives."

### 7b. Computation over collection (with guardrails)

**Default:** maximize analyzers in TypeScript on existing JSONL/SQLite.

**Exception:** when §0.2/§0.3 shows a metric would be **misleading** without richer capture (invoice-grade tokens, per-suggestion accept), **the daemon/parsers must evolve** — intelligence-only patches would violate trust.

Minimum new enrichment: **AI ↔ commit diff linkage** for modification depth (§5.2). Optional: vendor `usage` blocks per session.

### 7c. Statistical Significance Before Surfacing

Never surface an insight based on fewer than 5 data points. Never claim a trend with fewer than 4 weeks of data. Never alert on a pattern that hasn't sustained for 2+ weeks. The threshold for surfacing is deliberately high because **false insights are worse than no insights.** A developer who sees "your reasoning velocity improved 200%" based on 2 data points will stop trusting the system.

### 7d. Progressive Disclosure

The intelligence layer delivers value at increasing depth over time:

| Time | What's Available | Why |
|---|---|---|
| **Day 1** | AES (basic), Cost Attribution (basic), Comprehension (rough) | Minimum viable data for all three |
| **Week 1** | Prompt Coach (first patterns), Loop Detector (first rejections indexed) | Enough sessions for pattern detection |
| **Month 1** | Reasoning Velocity (first trends), Blind Spot Alerts (pattern baselines established) | Longitudinal data needed |
| **Month 3** | Decision Replay (enough history for temporal matching), full AES (all sub-metrics calibrated) | Deep history enables cross-temporal analysis |

### 7e. Cost Transparency Builds Trust

The Cost Attribution Engine doesn't just track costs — it projects savings. "If your AI tools had Unfade's MCP context, you'd save X% by eliminating re-explanation tokens." This makes Unfade's value proposition quantifiable. A developer who sees "$180/month in context overhead" knows exactly what Unfade is worth to them.

### 7f. Local-First Intelligence

All intelligence computation happens locally. No data leaves the machine. No cloud API calls for analysis (distillation may use cloud LLMs — that's Phase 6 — but intelligence analysis is pure local computation). The `intelligence/` directory is plain JSON, inspectable, greppable, deletable. The developer owns their intelligence data the same way they own their event data.

---

## 8. Implementation Plan

### Phase 7 Boundary

> **What must be true before Phase 7 work begins:**

**READS** (from previous phases):

| Data | Source | Schema | Owner |
|---|---|---|---|
| Capture events | `.unfade/events/*.jsonl` | `CaptureEventSchema` | Go daemon (write), TypeScript (read) |
| Distill output | `.unfade/distills/*.json` | `DailyDistillSchema` | TypeScript |
| Reasoning profile | `.unfade/profile/reasoning_model.json` | `ReasoningModelV2Schema` | TypeScript |
| Config | `.unfade/config.json` | `UnfadeConfigSchema` | TypeScript |
| MCP context | MCP server responses | Response envelope pattern | TypeScript |

**WRITES** (new in Phase 7):

| Data | Destination | Schema | Owner |
|---|---|---|---|
| Efficiency metrics | `.unfade/intelligence/efficiency.json` | `EfficiencySchema` (new) | TypeScript |
| Prompt patterns | `.unfade/intelligence/prompt-patterns.json` | `PromptPatternsSchema` (new) | TypeScript |
| Rejection index | `.unfade/intelligence/rejections.idx.json` | `RejectionIndexSchema` (new) | TypeScript |
| Comprehension scores | `.unfade/intelligence/comprehension.json` | `ComprehensionSchema` (new) | TypeScript |
| Cost attribution | `.unfade/intelligence/costs.json` | `CostAttributionSchema` (new) | TypeScript |
| Velocity tracking | `.unfade/intelligence/velocity.json` | `VelocitySchema` (new) | TypeScript |
| Alerts | `.unfade/intelligence/alerts.json` | `AlertsSchema` (new) | TypeScript |
| Decision replays | `.unfade/intelligence/replays.json` | `ReplaysSchema` (new) | TypeScript |
| Extended profile | `.unfade/profile/reasoning_model.json` | `ReasoningModelV2Schema` (extended) | TypeScript |

---

### Sprint 7A — Core Intelligence Engine (3 capabilities)

**Objective:** Build the intelligence engine framework and deliver the three capabilities with the strongest immediate wow factor: AI Efficiency Score, Cost Attribution Engine, and Comprehension Radar.

**Why these three first:** They require only existing captured data (no new collection), produce immediate visual impact on the dashboard, and directly address the two highest-intensity pain points (cost opacity and comprehension debt).

| ID | Task | Description | Files |
|---|---|---|---|
| **UF-100** | Intelligence Engine framework | Build the orchestrator that runs analyzers on materializer tick. Reads events and distills, writes to `intelligence/` directory. Pluggable analyzer interface. Integrates with existing materializer loop | `src/services/intelligence/engine.ts`, `src/services/intelligence/analyzers/index.ts` | `[x] COMPLETE` |
| **UF-101** | AI Efficiency Score analyzer | Compute AES (0-100) from 5 sub-metrics: Direction Density (from HDS), Token Efficiency (tokens per accepted decision), Iteration Ratio (turns to acceptance), Context Leverage (prompt similarity detection), Modification Depth (acceptance rate inverse). Write to `efficiency.json`. Extend `ReasoningModelV2Schema` with `efficiency` section | `src/services/intelligence/analyzers/efficiency.ts`, `src/schemas/intelligence/efficiency.ts` | `[x] COMPLETE` |
| **UF-102** | Cost Attribution Engine | Convert token counts to USD using configurable model rate table. Attribute costs by domain (from distill domain tags), by model (from `metadata.model`), by branch (from `gitContext.branch`). Compute waste ratio (cost of rejected sessions / total). Compute context overhead (prompt similarity to prior sessions). Write to `costs.json` | `src/services/intelligence/analyzers/cost-attribution.ts`, `src/schemas/intelligence/costs.ts` | `[x] COMPLETE` |
| **UF-103** | Comprehension Radar | Compute per-module comprehension score (0-100) from modification rate, question density, alternative exploration, test engagement, and review depth. Module attribution via `content.files[]`. Detect blind spots (score < 40 in module with > 5 decisions). Write to `comprehension.json`. Extend `ReasoningModelV2Schema` with `comprehension` section | `src/services/intelligence/analyzers/comprehension-radar.ts`, `src/schemas/intelligence/comprehension.ts` | `[x] COMPLETE` |
| **UF-104** | Dashboard pages — Efficiency, Costs, Comprehension | Three new Hono routes with htmx interactivity. Efficiency: AES gauge + sub-metric breakdown + trend. Costs: per-domain chart + per-model comparison + waste + projected savings (**estimate disclaimers**). Comprehension: extend existing heatmap/radar views. Follow existing server-rendered patterns | `src/server/pages/efficiency.ts`, `src/server/pages/costs.ts`, `src/server/routes/intelligence.ts` | `[x] COMPLETE` |
| **UF-105** | MCP tools — `unfade_efficiency`, `unfade_costs`; extend `unfade_comprehension` | New tools + **extend** existing comprehension tool. Response envelope pattern. Extend `unfade://profile` resource to include efficiency / cost / velocity sections | `src/services/mcp/tools.ts`, `src/tools/unfade-efficiency.ts`, `src/tools/unfade-costs.ts` | `[x] COMPLETE` |

---

### Sprint 7B — Learning Engine (3 capabilities)

**Objective:** Build the capabilities that make Unfade actively improve developer effectiveness: Prompt Coach, Loop Detector, and Reasoning Velocity Dashboard.

**Why these three second:** They require the intelligence framework from 7A. Prompt Coach and Loop Detector need the rejection index. Velocity needs the temporal analysis utilities.

| ID | Task | Description | Files |
|---|---|---|---|
| **UF-106** | Prompt Pattern Analyzer | Cluster prompts by domain and structural features (constraint specification, example inclusion, schema context, question count, length). Correlate clusters with outcome (acceptance rate, iteration count, modification depth). Generate effective patterns and anti-patterns per domain. Write to `prompt-patterns.json`. Extend profile with `promptPatterns` | `src/services/intelligence/analyzers/prompt-patterns.ts`, `src/services/intelligence/utils/text-similarity.ts`, `src/schemas/intelligence/prompt-patterns.ts` | `[x] COMPLETE` |
| **UF-107** | Loop Detector & Cross-Session Learning | Index all low-direction sessions by domain, approach category, and content hash. Compute similarity between sessions using cosine similarity. Track stuck loop patterns (3+ similar low-direction sessions). Write rejection index to `rejections.idx.json`. Export `findSimilarRejections` for MCP context injection | `src/services/intelligence/analyzers/loop-detector.ts`, `src/schemas/intelligence/rejections.ts` | `[x] COMPLETE` |
| **UF-108** | Reasoning Velocity Tracker | Compute turns-to-acceptance per domain per week. Detect statistically significant trends (>2 std dev over 4+ data points using trend utility). Surface acceleration/deceleration per domain. Write to `velocity.json` | `src/services/intelligence/analyzers/velocity-tracker.ts`, `src/services/intelligence/utils/trend.ts`, `src/schemas/intelligence/velocity.ts` | `[x] COMPLETE` |
| **UF-109** | Dashboard pages — Coach, Velocity | Two new Hono routes. Coach: effective patterns with examples, anti-patterns with suggestions. Velocity: per-domain trend cards with change percentages and direction arrows | `src/server/pages/coach.ts`, `src/server/pages/velocity-page.ts` | `[x] COMPLETE` |
| **UF-110** | MCP tool — `unfade_coach` | New MCP tool returning prompt patterns and active loop warnings for the current domain. Reads from `prompt-patterns.json` and `rejections.idx.json` | `src/services/mcp/tools.ts`, `src/tools/unfade-coach.ts` | `[x] COMPLETE` |

---

### Sprint 7C — Proactive Intelligence (2 capabilities)

**Objective:** Build the capabilities that make Unfade a proactive development partner: Blind Spot Alerts and Decision Replay.

**Why these last:** They require longitudinal data (1+ month for meaningful baselines). Sprint 7C should not ship until users have accumulated enough history for alerts and replays to be meaningful. This sprint can be built concurrently with 7A/7B but should only activate after sufficient data accumulation.

| ID | Task | Description | Files |
|---|---|---|---|
| **UF-111** | Blind Spot Detector | Monitor acceptance rate per domain, comprehension scores, HDS trends. Generate alerts when thresholds exceeded: acceptance > 90% for 2+ weeks, comprehension < 40 with recent commits, declining HDS trend (statistically significant). Allow user dismissal with "acknowledged" flag. Maximum 2 alerts per week. Write to `alerts.json` | `src/services/intelligence/analyzers/blind-spots.ts`, `src/schemas/intelligence/alerts.ts` | `[x] COMPLETE` |
| **UF-112** | Decision Replay Engine | Monitor current domain signals against past decisions. Trigger replay when: domain assumptions have shifted (drift detection), rejected alternative validated in different context, current dead end echoes past decision's risk prediction. Confidence threshold > 0.7. Maximum 2 replays per week. User can dismiss with "decision still valid" (learning feedback). Write to `replays.json` | `src/services/intelligence/analyzers/decision-replay.ts`, `src/schemas/intelligence/replays.ts` | `[x] COMPLETE` |
| **UF-113** | Alert & Replay UI + MCP | Dashboard alerts panel (accessible from all pages). Notification badges. MCP: extend `unfade://context` to include active alerts when relevant to current domain. Dashboard: replay cards with original decision context, trigger reason, and action buttons | `src/server/pages/alerts.ts`, `src/server/routes/intelligence.ts`, `src/server/http.ts` | `[x] COMPLETE` |

---

### Sprint 7D — Integration & Polish

**Objective:** Integrate all intelligence capabilities into a coherent experience. Unified intelligence dashboard. Export capabilities for leadership reporting.

| ID | Task | Description | Files |
|---|---|---|---|
| **UF-114** | Unified Intelligence Dashboard | Main `/intelligence` page aggregating: AES gauge, cost summary, comprehension heatmap, velocity sparklines, active alerts, recent coach insights. Single-page overview of all Phase 7 capabilities | `src/server/pages/intelligence.ts` | `[x] COMPLETE` |
| **UF-115** | Leadership Export Pack | Extend leadership export to include intelligence artifacts: efficiency.json, costs.json, comprehension.json, velocity.json (numeric only, no raw prompts). Intelligence data included alongside existing CSV exports | `src/commands/export.ts` (extend) | `[x] COMPLETE` |
| **UF-116** | Intelligence onboarding experience | Onboarding API: computes progress toward each intelligence capability, shows "N more days/sessions until X". Built into unified dashboard with progressive disclosure | `src/server/routes/intelligence-onboarding.ts` | `[x] COMPLETE` |

---

## 9. Success Metrics

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| **AES adoption** | N/A | 80%+ of active users check AES weekly | Dashboard analytics (local) |
| **Cost insight accuracy** | N/A | Cost attribution within 15% of actual billing | User-reported comparison with billing dashboards |
| **Comprehension blind spot detection** | N/A | Identified blind spots correlate with user-acknowledged gaps in >60% of cases | User feedback on blind spot accuracy |
| **Prompt Coach actionability** | N/A | 40%+ of surfaced patterns rated "useful" by users | Thumbs up/down on coach suggestions |
| **Loop prevention** | N/A | 30% reduction in same-category rejections after Loop Detector activation | Before/after rejection pattern comparison |
| **Reasoning velocity visibility** | N/A | Users can identify their fastest-improving domain within 30 seconds | Dashboard usability |
| **Time to first insight** | N/A | AES (basic) within 1 day. Prompt Coach patterns within 1 week. Velocity trends within 1 month | Progressive disclosure timeline |
| **MCP context enrichment** | Existing context queries | 50%+ of MCP context responses include intelligence-derived insights (preferences, warnings, patterns) | MCP response analysis |
| **Context overhead quantification** | N/A | Users see projected savings from MCP context injection | Cost Attribution "projected savings" metric |

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **AES feels arbitrary or gameable** | Medium | High — users distrust the metric and ignore it | Ground every sub-metric in observable, explainable data. Show the formula. Allow users to adjust weights. Never present AES as a ranking — it's a personal optimization signal |
| **Comprehension score causes anxiety** | Medium | Medium — developers feel judged instead of helped | Language is always observational ("your engagement depth in payments is 31") never judgmental ("you don't understand payments"). Emphasize: low comprehension is a signal, not a score |
| **Prompt Coach patterns are obvious** | Low-Medium | Medium — "include context" is not a revelation | Focus on *domain-specific* patterns, not generic advice. "Your auth prompts with constraint lists" is actionable; "write better prompts" is not. Only surface patterns with >2x outcome difference |
| **Loop Detector false positives** | Medium | Medium — warning about an approach that's actually correct this time | High similarity threshold (>0.7). Include the context of the past rejection so the developer can judge. Easy dismissal: "this time is different" (with feedback learning) |
| **Cost rates become stale** | High | Low — rates change as models evolve | Ship with defaults, make fully configurable in `config.json`. Update defaults in each release. Costs are estimates, not invoices — label clearly |
| **Intelligence computation is too slow** | Low | Medium — slows materializer tick | Run intelligence analyzers asynchronously, not on the critical path of the materializer. Use incremental computation (update running averages, don't recompute from scratch). Budget: <500ms per tick |
| **Insufficient data for meaningful insights** | High (early) | High — empty dashboards destroy first impression | Progressive disclosure: show what WILL be available once data accumulates. Show progress toward first insight. Never show an empty chart — show a "collecting data" state with estimated time |
| **Alert fatigue from blind spots / replays** | Medium | Medium — users disable alerts entirely | Strict caps: max 2 alerts per week, max 2 replays per week. Acknowledge/dismiss with learning. Alert only when statistically significant over 2+ weeks |
| **Privacy concerns with prompt analysis** | Low | Medium — users uncomfortable with prompt text being analyzed | All analysis is local. Prompt text never leaves the machine. Prompt patterns are stored as structural features (has_constraints, has_schema), not raw text. Raw text stays in events only |
| **Feature scope creep** | High | High — trying to ship all 8 capabilities simultaneously | Sprint sequencing is deliberate: 7A (3 core) → 7B (3 learning) → 7C (2 proactive) → 7D (integration). Each sprint is independently valuable. Ship 7A first, measure adoption, then proceed |

---

## Appendix A: The Unfade Intelligence Loop

Phase 7 completes the **intelligence loop** that transforms Unfade from a passive tool into an active development partner:

```
    ┌─────────────────────────────────────────────────────────────┐
    │                                                             │
    │   CAPTURE                    DISTILL                        │
    │   (Go daemon)                (LLM synthesis)                │
    │   git + AI + terminal  →     daily summaries                │
    │                              decisions, trade-offs          │
    │                                     │                       │
    │                                     ▼                       │
    │   INTELLIGENCE               PROFILE                       │
    │   (Phase 7 — NEW)            (ReasoningModelV2)             │
    │   efficiency, cost,          decision style,                │
    │   comprehension,             domains, patterns              │
    │   velocity, coach                   │                       │
    │        │                            │                       │
    │        ▼                            ▼                       │
    │   INJECT                     IDENTITY                      │
    │   (MCP — enhanced)           (Thinking Graph, Cards)       │
    │   warnings, preferences,     visual reasoning profile      │
    │   learned patterns                  │                       │
    │        │                            │                       │
    │        ▼                            ▼                       │
    │   IMPROVE                    SHARE                         │
    │   (developer behavior)       (shareable artifacts)         │
    │   better prompts,            career signal,                │
    │   fewer loops,               hiring artifact               │
    │   deeper comprehension                                     │
    │        │                                                    │
    │        └──────────── feeds back into ──────────────────────┘
    │                      CAPTURE
    │
    └─────────────────────────────────────────────────────────────┘
```

The loop is self-reinforcing: better prompts → better AI output → richer reasoning capture → deeper intelligence → better prompts. This is the compounding moat that no competitor can replicate without months of accumulated data.

---

## Appendix B: Competitive Positioning After Phase 7

| When a user says... | Unfade's response |
|---|---|
| "How is this different from WakaTime?" | "WakaTime tracks how long you code. Unfade tracks how well you *think*. WakaTime tells you '4 hours in auth module.' Unfade tells you 'your auth decisions are 3x faster than last month, your comprehension is 82, and your prompts with constraint lists produce 3x better outcomes.'" |
| "How is this different from Langfuse/Helicone?" | "Langfuse tracks LLM API calls for app builders. Unfade tracks how *you* use AI as a developer — your efficiency, your patterns, your cost per decision, your comprehension depth. Different user, different question, different data." |
| "How is this different from DX/LinearB?" | "DX measures team-level AI impact. Unfade measures *your personal* AI effectiveness — and helps you improve it. DX tells your manager 'the team shipped faster.' Unfade tells you 'your architecture prompts produce 3x better outcomes when you specify constraints upfront.'" |
| "How is this different from Cursor's memories?" | "Cursor remembers your preferences inside Cursor. Unfade learns how you *reason* across every tool — and uses that to make every AI interaction better. Plus: Unfade tells you things Cursor never will: your AI efficiency score, your comprehension per module, your cost per decision." |
| "How is this different from Quint?" | "Quint captures decisions when you explicitly invoke it. Unfade captures reasoning passively from everything you already do — git, AI sessions, terminal — and turns it into actionable intelligence: efficiency scores, prompt coaching, loop detection, comprehension radar. No commands to remember, no workflow interruption." |

---

## Appendix C: The First-Week Experience

What a developer experiences in their first week with Phase 7 capabilities:

| Day | What Happens | Wow Moment |
|---|---|---|
| **Day 1** | Install, run `unfade`. Capture engine starts. First events flow. Basic AES computes | "Huh, it already knows I used Claude Code for 3 sessions today and Cursor for 2" |
| **Day 2** | Cost Attribution shows first estimates. Comprehension rough scores appear | "I spent $8.40 on AI today? And 40% was re-explaining context?" |
| **Day 3** | AES stabilizes with 3 days of data. First sub-metric insights surface | "My token efficiency is low in frontend — I'm using Opus for CSS fixes. Sonnet would be 80% cheaper" |
| **Day 4** | Prompt Coach detects first pattern with 4+ sessions in a domain | "My database prompts with schema context are accepted 3x more often — I should always include schema" |
| **Day 5** | Loop Detector indexes enough rejections to start matching. First MCP injection | "Wait — my AI session just started with 'Note: you've rejected singleton patterns in this codebase 3 times.' How did it know?" |
| **Day 6** | Comprehension Radar shows per-module scores with a week of data | "Auth: 78. Payments: 29. That's... actually accurate. I have no idea how the payment retry logic works" |
| **Day 7** | First-week summary. Direction ratio trend. Cost summary. First velocity data point | "I'm more efficient on Day 7 than Day 1. My AI is learning about me. This is... different from every other tool I've used" |

---

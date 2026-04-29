# Instant-Value Features — The Cursor Test

> Every feature here must pass the Cursor test: **does the user feel measurably better at their work within 5 minutes of install?** Not "informed about their work." Not "aware of their patterns." Better. Faster. Smarter. Protected from mistakes they were about to make.
>
> Cursor didn't grow to $2B ARR by showing developers dashboards about their coding patterns. It grew because users were 20-25% faster in the first 5 minutes. Lovable didn't hit $100M ARR in 8 months by analyzing app development workflows. It grew because users typed a sentence and got a deployed app.
>
> **The test:** If you remove Unfade, does the user's next AI session get worse? Not "less informed" — actually worse. If the answer is yes, the feature passes. If the answer is "they'd lose some interesting data," it fails.
>
> **Companion documents:**
> - [PATH_TO_1M_ARR.md](./PATH_TO_1M_ARR.md) — Commercial readiness evaluation
> - [FEATURE_LIST.md](./FEATURE_LIST.md) — Complete feature inventory (73 features, 12 groups)
> - [unfade.md](./unfade.md) — Product narrative and why this exists
>
> **Last updated:** April 2026

---

## Table of Contents

- [1. Why Most Developer Tool Features Fail the Cursor Test](#1-why-most-developer-tool-features-fail-the-cursor-test)
- [2. Research: What Actually Creates $1B+ Developer Tools](#2-research-what-actually-creates-1b-developer-tools)
- [3. The Features](#3-the-features)
- [4. Ship Order and Engineering Scope](#4-ship-order-and-engineering-scope)

---

## 1. Why Most Developer Tool Features Fail the Cursor Test

Developer tools love dashboards. Dashboards feel impressive in demos. But dashboards are **past-facing** — they show you what happened. The tools that create billion-dollar companies are **present-facing** — they make your current action better.

**Past-facing (reports about yesterday):**
- "You had 347 AI conversations last month"
- "Your comprehension score is 72%"
- "You're a Collaborator-type developer"
- "Your reasoning streak is 14 days"

These are interesting. Users will look at them once, maybe twice. They don't change behavior. They don't make the next hour of work better. They are the developer-tool equivalent of screen time reports — acknowledged, then ignored.

**Present-facing (interventions in this moment):**
- Your AI tool already knows about the auth decisions you made yesterday — you don't re-explain
- You're about to try WebSockets again — Unfade warns you that you abandoned this approach twice before for the same reason
- You're modifying code you've never deeply engaged with — Unfade flags the comprehension gap before you ship a bug
- You switch from Claude to Cursor mid-task — Cursor already has the full context of what you were doing in Claude

The difference: past-facing features create awareness. Present-facing features create dependency. Awareness is optional. Dependency is retention.

**Cursor's lesson:** Tab-complete that understands your codebase isn't a feature you appreciate — it's a feature whose absence you feel immediately. When Cursor users switch to another editor, they feel slower within minutes. That's the bar.

**Unfade's equivalent:** MCP interventions that make every AI tool smarter about you. When Unfade is running, your AI tools remember your reasoning, warn you about dead ends, and know your codebase comprehension. When Unfade stops running, your AI tools have amnesia again. That's the dependency.

---

## 2. Research: What Actually Creates $1B+ Developer Tools

### Cross-session memory is the #1 unmet need

Every AI coding tool operates on a single-session context window. Claude Code doesn't know what you did in Cursor yesterday. Cursor doesn't know what you decided in Claude last week. Codex doesn't know about the three times you tried and abandoned WebSockets.

The evidence is overwhelming:
- **Devin's data** shows 67% PR merge rate with persistent context vs. 34% without — context continuity nearly doubles output quality.
- **JetBrains 2026 survey:** 76% of developers report significant context loss when switching between AI tools. The average developer uses 2.3 AI coding tools.
- **MCP adoption:** 97M monthly SDK downloads, 17K+ community servers. OpenAI deprecated its Assistants API in favor of MCP. This is the universal standard. Unfade sits at the MCP layer — it's the memory that every AI tool shares.

No tool currently solves cross-session, cross-tool memory. Cursor has project-level memory — but only for Cursor. GitHub Copilot has workspace indexing — but only for Copilot. Unfade is the only tool positioned to be the shared memory layer across all AI tools.

### Comprehension debt is a crisis with no measurement

The AI-assisted coding explosion created a silent problem: developers are shipping code they don't understand.

- **GitClear 2025:** 41% of new code is now AI-generated. Code churn (code rewritten within 2 weeks) increased 39% year-over-year.
- **MIT/Wharton 2025:** Developers using AI for delegation score below 40% on comprehension tests for the code they produce, vs. 65% for those using AI for conceptual inquiry. Same code, same output quality — but fundamentally different understanding.
- **Uplevel 2025:** Developer burnout indicators increased alongside AI adoption. The hypothesis: cognitive load shifted from "writing code" to "reviewing AI output" — a task humans are measurably worse at.

No tool measures comprehension. Code coverage measures tests. Linting measures style. Static analysis measures correctness. Nothing measures whether the developer understands the code they're shipping. Unfade's comprehension scoring is the first tool to address this — and it's already built.

### Time-to-value determines survival

- **Amplitude 2025:** Improvements in a user's first 5 minutes drive 50% increases in lifetime value.
- **1Capture 2025:** 68% of developers abandon tools with setup times exceeding 10 minutes. Every 10-minute delay costs 8% conversion.
- **Cursor's growth curve:** Word-of-mouth driven. Users try it, feel faster immediately, tell colleagues. No sales team until well past $100M ARR.
- **Lovable's growth curve:** Zero gap between intent and result. User types a sentence, gets a deployed app. $100M ARR in 8 months, entirely PLG.

The pattern: the product must make the user's immediate next action better. Not their next day. Not their next week. Their next action.

---

## 3. The Features

### Feature 1: Cross-Tool Memory Layer

**What it does:** Every AI tool you use — Claude Code, Cursor, Codex, Aider, any MCP-compatible client — automatically gets your full reasoning context. Not your code (they already have that). Your *reasoning*: what you decided, why, what you tried and rejected, what you understand deeply vs. superficially.

When you open Claude Code after a Cursor session, Claude already knows:
- The architectural decision you made in Cursor 2 hours ago
- The approach you explored and abandoned yesterday
- That you deeply understand the database layer but have surface-level familiarity with the auth module
- The 3 trade-offs you evaluated for the caching strategy

No prompt. No re-explanation. No "let me give you some context." Your AI tool just... knows.

**Why this passes the Cursor test:** Remove Unfade, and your next AI session starts from zero. You spend 3-5 minutes re-explaining context. The AI suggests an approach you already rejected. You correct it. You lose 15-20 minutes per context switch. With Unfade, that friction disappears. The difference is felt in the first MCP query — typically within minutes of starting work.

**What exists today:**
- `unfade_context` MCP tool: serves recent reasoning scoped by time and project
- `unfade_decisions` MCP tool: serves past decisions with rationale and evidence
- `unfade_profile` MCP tool: serves the user's reasoning profile, patterns, and domain expertise
- `mcp-enrichment.ts`: enriches every MCP response with identity labels, domain context, active session state, active diagnostics, relevant patterns, and full graph context (current feature comprehension, related decisions, similar sessions, suggested approach)
- 30-second profile cache for performance
- Live DiagnosticStream integration

**What needs to be built:**
- **Visibility layer**: Dashboard widget showing injection count, what was injected, and estimated time saved. Context injection is currently invisible — users don't know it's working. The counter transforms "I guess it's working" into "I can see it saved me 23 minutes today."
- **Cross-tool session linking**: Detect when a user switches tools mid-task and automatically bridge the context. Currently each MCP query is independent — linking them into continuous sessions amplifies the value.
- **Proactive context push**: Instead of waiting for the AI tool to query Unfade, push relevant context when the user enters a file or domain where Unfade has relevant reasoning. Requires file-watch integration or editor plugin hooks.

**Engineering scope:** Visibility layer: 3-5 days. Session linking: 1-2 weeks. Proactive push: 2-3 weeks (depends on editor integration surface).

---

### Feature 2: Dead End Firewall

**What it does:** Real-time prevention when you or your AI tool is about to go down a path you've already explored and abandoned. Not a dashboard showing past dead ends — an active intervention that stops wasted work before it happens.

You're in Claude Code, discussing a caching strategy. You mention Redis Cluster. Unfade injects into the conversation:

> "You explored Redis Cluster for session storage on Feb 20. You abandoned it because your deployment topology doesn't support it without Kubernetes. That constraint hasn't changed. You settled on in-memory LRU with disk spillover — that decision has held for 2 months."

The AI tool receives this context and adjusts its suggestion accordingly. You save 30-90 minutes of re-exploration. This is the "Unfade just saved me an hour" moment that drives word-of-mouth — the single most powerful growth mechanism for developer tools.

**Why this passes the Cursor test:** Remove Unfade, and you will re-explore dead ends. Every developer does it. You forget why you rejected an approach. Your AI tool doesn't know your history. You spend an afternoon going in circles. With Unfade, dead ends stay dead. The protection is invisible until the moment it fires — and then it's unforgettable.

**What exists today:**
- `loop-detector.ts`: Knowledge-grounded loop detection. A real loop = same entity discussed 3+ times in a week with fewer than 1 new fact extracted per session. Loop risk = sessions_without_progress / total_sessions. Has DuckDB fallback for intent-repetition detection.
- `unfade_similar` MCP tool: Takes a problem description, returns similar past decisions with rationale. Uses cosine similarity on decision embeddings.
- `unfade_coach` MCP tool: Already surfaces loop detection warnings and anti-patterns.
- `mcp-enrichment.ts`: Already includes `activeSession.loopRisk` and `activeDiagnostics` with actionable warnings in every MCP response.
- Dead end extraction in the distill pipeline: distills already capture dead ends with reasoning for abandonment.

**What needs to be built:**
- **Proactive dead-end matching**: When an MCP query mentions concepts similar to known dead ends, automatically inject the dead-end context without waiting for the loop detector's 3-occurrence threshold. Currently the loop detector is reactive (fires after repeated attempts) — the firewall should be preventive (fires on first re-approach).
- **Constraint change detection**: Track whether the constraints that caused abandonment have changed. "You abandoned Redis Cluster because no Kubernetes" — but if the user now has Kubernetes, the dead end should be marked as potentially viable.
- **Dead End Archive UI**: Browsable dashboard view of all dead ends with abandonment reasoning, times explored, and constraint status. Makes the invisible protection visible.
- **Confidence scoring**: Not all dead ends are permanent. Some are "abandoned due to time pressure" vs. "fundamentally incompatible." Score the permanence.

**Engineering scope:** Proactive matching: 1-2 weeks. Constraint tracking: 1 week. Archive UI: 3-5 days. Confidence scoring: 3-5 days. Total: 3-4 weeks.

---

### Feature 3: Comprehension X-Ray

**What it does:** A real-time visual map of what you actually understand in your codebase — not what you've touched, but what you'd survive debugging at 3am without AI assistance.

- **Green zones:** Deep understanding — you've made decisions here, modified code deliberately, engaged in back-and-forth reasoning sessions
- **Yellow zones:** Working knowledge — you've interacted but mostly through AI delegation
- **Red zones:** Blind spots — AI-generated code you accepted without deep engagement, areas with decaying comprehension (FSRS model), code you haven't touched since the AI wrote it
- **Decay indicators:** Comprehension fades. Code you understood deeply 3 months ago but haven't revisited is decaying. The X-Ray shows what's fading before it becomes a liability.

This is generated from git history alone in 60 seconds on first run. As AI session data accumulates, it becomes dramatically more precise — distinguishing "I wrote this" from "I understand this" from "the AI wrote this and I hit accept."

**Why this passes the Cursor test:** This doesn't just inform you — it changes what your AI tools do. When you're working in a red zone, Unfade enriches MCP responses with comprehension context: "The user has low comprehension in this area — provide more detailed explanations, flag assumptions, suggest the user review the generated code more carefully." Your AI tools adapt their behavior based on your understanding level. Remove Unfade, and your AI tools treat every area of your codebase as if you understand it equally — which you don't.

**What exists today:**
- Comprehension analyzer: Scores 0-100 per module with FSRS (spaced repetition) decay modeling
- Expertise map analyzer: File-level ownership, churn analysis, expertise distribution
- `unfade_comprehension` MCP tool: Returns comprehension data with per-module breakdown
- `mcp-enrichment.ts` `graphContext.currentFeature.comprehension`: Already enriches MCP responses with comprehension level for the active feature area
- Blind spot detection: Identifies modules where AI suggestions are accepted without modification
- Trend tracking: Improving / declining / stable comprehension per area

**What needs to be built:**
- **Visual heat map component**: Treemap or directory-tree visualization with color coding. Git-history-only version for first-run, enhanced version with AI session data.
- **Adaptive MCP enrichment**: Currently comprehension data is included in MCP responses but not used to modify AI behavior. The enrichment should include explicit instructions: "User has low comprehension here — explain more, don't assume familiarity."
- **Decay alerts**: Proactive notifications when comprehension in a critical area drops below threshold. "Your understanding of the payment module has decayed — last deep engagement was 6 weeks ago."
- **Team surface (future)**: The "check engine light" for engineering leads. Which areas of the codebase have comprehension gaps across the team? This is the enterprise feature that creates willingness-to-pay.

**Engineering scope:** Heat map UI: 1-2 weeks. Adaptive enrichment: 3-5 days. Decay alerts: 3-5 days. Total: 2-3 weeks.

---

### Feature 4: Decision Continuity Engine

**What it does:** When you enter an area of code, Unfade automatically briefs your AI tool with every relevant decision, trade-off, and context from your history in that area. Not because you asked — because the context is relevant right now.

You open a file in the payments module. Before you type a single prompt, your AI tool already knows:
- You chose Stripe over Paddle 3 weeks ago because of the international tax handling
- You made a deliberate trade-off: higher per-transaction fees for lower integration complexity
- There's an open question about webhook retry logic that you flagged but haven't resolved
- Your comprehension in this module is high (you directed 85% of the decisions here)
- Related: the auth module's session handling intersects with payment flows — you noted this dependency on March 15

This is the anti-amnesia engine. Every AI session starts with full historical context for whatever you're working on — automatically.

**Why this passes the Cursor test:** Without Unfade, every AI session in a returning-to area starts cold. The AI doesn't know what you decided, what trade-offs you made, or what questions remain open. You either re-explain (wasting time) or don't (getting suggestions that contradict your past decisions). With Unfade, continuity is automatic. The AI builds on your past reasoning instead of starting from scratch.

**What exists today:**
- `mcp-enrichment.ts` `graphContext`: Already provides `currentFeature` (name, comprehension, loopRate, decisionCount), `relatedDecisions`, `activePatterns`, `capabilities`, `similarSessions`, `featureKnowledgeMap`, `suggestedApproach`, `connectedDecisions`
- `unfade_context` MCP tool: Serves recent reasoning scoped by time and project
- `unfade_decisions` MCP tool: Filters decisions by domain, direction, confidence
- CozoDB knowledge graph: Entity resolution, temporal facts, cross-tool concept merging
- Decision replay and lineage tracking in the intelligence pipeline

**What needs to be built:**
- **File-to-decision mapping**: Currently decisions are tagged by domain but not by specific files. Map decisions to the files they affect so that entering a file triggers relevant decision context. Requires enhancing the materializer to extract file paths from decision evidence.
- **Proactive briefing assembly**: Instead of waiting for an MCP query, pre-assemble a "briefing" for the active file/module. When the first MCP query arrives for a new area, the briefing is ready instantly.
- **Open question tracking**: Extract unresolved questions from sessions and surface them when the user returns to the relevant area. "You flagged webhook retry logic as unresolved on March 15 — still open."
- **Decision conflict detection**: When the AI is about to suggest something that contradicts a past decision, flag it. "This suggestion uses Paddle — you chose Stripe over Paddle on March 3 for international tax reasons."

**Engineering scope:** File-to-decision mapping: 1-2 weeks. Proactive briefing: 1 week. Open question tracking: 1 week. Conflict detection: 1 week. Total: 4-5 weeks.

---

## 4. Ship Order and Engineering Scope

### Priority 0: Ship with Launch

These create the instant dependency — the "remove Unfade and my AI tools get dumber" feeling.

| Feature | Why First | Scope |
|---|---|---|
| **Cross-Tool Memory Layer** (visibility) | The MCP enrichment already works — but users don't know it. Making it visible converts invisible value into conscious dependency. | 3-5 days |
| **Dead End Firewall** (proactive matching) | The loop detector and similar-decision tools exist. Lowering the intervention threshold from "3 occurrences" to "first re-approach" creates the word-of-mouth moment. | 1-2 weeks |
| **Comprehension X-Ray** (git-only version) | 60-second first-run wow moment. Shows something no other tool shows. The "check engine light" moment. | 1-2 weeks |

**Combined P0 estimate:** 3-4 weeks. These three features transform the first session from "interesting dashboard" to "my AI tools are smarter now and I can see why."

### Priority 1: Ship by Week 3

These deepen the dependency and create the "can't go back" feeling.

| Feature | Why Second | Scope |
|---|---|---|
| **Comprehension X-Ray** (adaptive enrichment) | AI tools now adjust explanations based on your comprehension level. The dependency deepens — your AI tools literally behave differently with Unfade running. | 3-5 days |
| **Decision Continuity Engine** (file mapping + briefings) | Every returning-to area gets automatic context. The "my AI remembers everything" feeling solidifies. | 2-3 weeks |
| **Dead End Firewall** (constraint tracking + archive UI) | The firewall becomes browsable. Users can see what they're being protected from. Trust deepens. | 1-2 weeks |

**Combined P1 estimate:** 4-5 weeks.

### Priority 2: Ship by Week 8

These complete the system and create the moat.

| Feature | Why Third | Scope |
|---|---|---|
| **Cross-Tool Memory Layer** (session linking + proactive push) | Context bridges across tool switches automatically. The memory layer becomes seamless. | 3-4 weeks |
| **Decision Continuity Engine** (open questions + conflict detection) | The system now catches contradictions and reminds you of unresolved issues. Full reasoning continuity. | 2 weeks |
| **Comprehension X-Ray** (decay alerts) | Proactive warnings when critical understanding is fading. The "check engine light" becomes predictive. | 3-5 days |

**Combined P2 estimate:** 5-6 weeks.

### Total: ~13-15 weeks for the complete system

But P0 alone — 3-4 weeks — creates the instant dependency that passes the Cursor test. Every subsequent priority deepens the moat.

---

## The Cursor Test Validation

For each feature, the removal test:

| Feature | What happens when you remove Unfade? |
|---|---|
| **Cross-Tool Memory** | Your AI tools have amnesia. You re-explain context every session. 15-20 min/day wasted. |
| **Dead End Firewall** | You re-explore abandoned approaches. Hours wasted on paths you already rejected. |
| **Comprehension X-Ray** | Your AI tools treat all code areas equally. You ship code you don't understand. No warning. |
| **Decision Continuity** | Every return to old code starts cold. Past decisions invisible. AI contradicts your past choices. |

Every feature passes. Removal makes the next AI session measurably worse — not "less informed," but functionally degraded.

---

## What We Deliberately Cut

Features from the previous version that failed the Cursor test:

| Cut Feature | Why |
|---|---|
| **Reasoning Streak** | Gamification. Doesn't make your next AI session better. Duolingo streaks work for language learning habits — but developers don't need a streak to use their AI tools. The streak measures engagement with Unfade, not improvement of work. |
| **Weekly Wrapped** | Past-facing report. Interesting but not dependency-creating. Users look at it, nod, close it. Spotify Wrapped works because music is emotional identity — engineering patterns are not. |
| **AI Usage X-Ray** | "You had 347 AI conversations" is trivia. It doesn't change what you do next. Cost tracking is useful but doesn't pass the removal test — you can estimate costs from your API dashboard. |
| **AI Collaboration Pattern** | Personality classification ("You're a Collaborator"). Fun to share once. Doesn't make your next session better. The underlying data (direction scores, modification rates) feeds into features that do pass the test — but the label itself is decorative. |

The principle: if a feature's value is "interesting to look at," cut it. If its value is "my work gets worse without it," keep it.

---

*Research sources: Cursor growth analysis (a]16z 2025), Lovable ARR trajectory (TechCrunch 2026), Devin persistent context study (Cognition Labs 2025), JetBrains Developer Survey 2026, MCP adoption data (Anthropic 2026), GitClear AI code generation study 2025, MIT/Wharton AI comprehension research 2025, Uplevel developer productivity study 2025, Amplitude Time-to-Value Study 2025, 1Capture Free Trial Benchmarks 2025*

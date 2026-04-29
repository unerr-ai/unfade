# Unfade — Why This Exists

> **What this document is:** A founder's reference. The complete, evidence-backed narrative of why Unfade exists — from the real pain developers feel today, through the research that shaped our thinking, to what we built and why each piece matters. Written as the single document you'd hand someone who needs to understand the soul of this product in one sitting.
>
> **What this document is NOT:** A pitch deck, a marketing brief, a competitor teardown, or an implementation spec. Competitor analysis lives in `unfade_competitor_analysis.md`. Business model and growth strategy live in `unfade_business.md`. Technical architecture lives in `.internal/architecture/`. This document stops at the product and its features.
>
> **Last updated:** April 2026

---

## The World Developers Live In Now

Something broke in 2025. Not dramatically — gradually, then all at once.

AI coding tools got good. Really good. Cursor, Claude Code, Copilot, Codex, Windsurf — every developer now has an AI assistant that can write entire features, refactor modules, and generate tests. The output exploded. PRs got bigger. Commit frequency went up. Cycle times dropped. By every traditional metric, developers became more productive than ever.

But the developers themselves started saying something different.

*"I caught myself unable to write a basic recursive function without Copilot. I've been coding for 12 years."* — r/ExperiencedDevs, 2026

*"I ship faster but I understand less. Is this sustainable?"* — r/cursor, recurring theme with hundreds of upvotes

*"My manager thinks we're 3x more productive because PRs are bigger. The bug rate has doubled."* — r/ExperiencedDevs, 2026

*"I spend 10-15 minutes every session re-explaining context."* — r/ClaudeCode, recurring

*"I have an identity crisis every day now."* — X/Twitter, 15-year veteran developer

These aren't isolated complaints. They are the dominant emotional thread in every developer community in 2026 — Reddit, Hacker News, X, Indie Hackers, dev blogs. And they all point to the same thing: AI made building faster, but something important is being lost in the speed.

---

## The Pain Is Real — And Measured

We didn't start with a product idea. We started by listening — systematically — across Reddit, Hacker News, X/Twitter, academic research, industry reports, and developer forums. What we found is not a single problem but a convergence of crises, each reinforcing the others.

### Cognitive Debt: "AI Is Making Me Worse at My Job"

This is the most emotionally charged pain across all developer communities. And it's not just feelings — it's backed by controlled studies.

An MIT EEG study in 2025 measured weaker neural connectivity patterns in developers using ChatGPT compared to those solving problems manually. The brain literally engages less when AI does the heavy lifting.

The METR randomized controlled trial (2025) found that AI-assisted developers were **19% slower** on real-world tasks — despite *feeling* 20% faster. The confidence-competence gap is measurable and consistent.

Anthropic's own developer comprehension study (2026) showed **17% lower codebase comprehension** after just 3 months of AI assistant use.

Addy Osmani coined the term **"Comprehension Debt"** in March 2026 (O'Reilly) — the widening gap between code volume produced and developer understanding of that code. The post went viral on Hacker News with 1,200+ points. It gave a name to what every developer was already feeling.

The research also identified 6 distinct patterns of AI interaction — ranging from "delegators" (highest cognitive atrophy) to "collaborators" (who maintained or grew their skills). The way you use AI matters more than how much you use it. But no tool helps you see which pattern you've fallen into.

### The Productivity Paradox: "We're Faster But Shipping Worse"

The numbers at the organizational level are striking.

Faros AI's 2026 data showed teams completing **21% more tasks** while organizational delivery stayed flat. PR review time increased **441%**. And 31% of PRs were merging with no review at all.

ThoughtWorks Technology Radar (April 2026) flagged what they called **"AI productivity theater"** — teams reporting higher velocity while quality metrics silently degrade.

Kent Beck put it simply: *"We're measuring the wrong thing. The question isn't how much code AI writes — it's how much the developer understands."*

The security numbers are even more alarming. Teams with more than 40% AI-generated code face a 20-25% rework increase. AI-assisted commits leaked secrets at 2x the baseline rate (3.2% for Claude Code). There were **35 CVEs in March 2026 alone** from AI-generated code. More than 60% of "vibe-coded" applications exposed API keys directly in client-side JavaScript.

In one week of March 2026, three security disasters hit: Lovable ($6.6B platform) breached through AI-generated code, Vercel's breach vector included AI-generated components, and Bitwarden CLI was hit by a supply-chain attack via AI-generated typosquat. AI-generated code has a **2.74x higher security vulnerability rate** compared to human-written code.

The common thread: speed without understanding creates fragile, insecure systems. The code works — until it doesn't. And nobody knows why it was written that way.

### Context Amnesia: "Every AI Session Starts From Zero"

Developers use 2-3 AI tools (Stack Overflow 2025 survey). None share context. Every tool switch forces re-explanation.

Cursor users report "code reversions" since v1.2.4 where the tool overwrites manual edits because it lost track of prior context. 67% of Copilot users hit context limits on multi-file edits. Developer trust in AI accuracy dropped from 43% to 33% between 2024 and 2025 — partly because AI keeps making the same mistakes developers already corrected.

The effective context on complex tasks falls 99% below the advertised maximum. A 200K token window collapses to roughly 2K effective tokens of relevant context.

20% of customer churn across AI tools is attributed to re-explanations. Developers are abandoning tools because they're tired of re-teaching the AI what they already explained yesterday.

ChatGPT added "Memory." Claude writes to CLAUDE.md files. Cursor caches project context. But these are all single-tool, preference-level, and non-learning. Claude's memory doesn't help Cursor. Cursor's memory doesn't help Claude. None of them understand how you think — they remember what you said, not why you said it.

MCP (Model Context Protocol) is becoming the universal standard for AI tool integration — 10,000+ servers, 97M monthly SDK downloads. But MCP is a protocol, not a memory. It needs something upstream that knows what context to inject.

### Knowledge Silos: "When Sarah Left, We Lost 6 Months"

42% of role-specific expertise is known by only one person. New hires spend an average of 200 hours re-learning context that lived in a departed developer's head. The estimated productivity loss: $72M annually per 30,000-person organization.

*"We have 50K lines of Cursor-generated code. Nobody knows why half the architectural decisions were made."* — r/programming, 2026

"Archaeological debugging" — spending hours reverse-engineering AI-generated code decisions — is now a recognized anti-pattern. Git blame shows who changed a line, but not why they understood the change was correct. Decision rationale evaporates the moment the terminal closes.

AI accelerates individual output while destroying the organic knowledge transfer that used to happen through slower, collaborative development. People used to learn by watching each other code. Now everyone codes with AI, alone, fast, and the reasoning never gets shared.

### The Junior Developer Crisis

Entry-level developer hiring is down 25% year-over-year. Employment for ages 22-25 declined 20% from the 2022 peak. AI tool experience job postings are up 340% — "knows how to prompt" is replacing "knows how to code."

The tasks juniors used to learn on — boilerplate, CRUD, simple features — are now AI-generated. The learning ramp has been pulled away. And one-third of managers still assess developers based on code volume — the worst possible metric in the AI era.

*"Every candidate's portfolio looks impressive now. How do I show that I actually understand distributed systems vs. just prompting Claude to build one?"* — r/cscareerquestions, 2026

*"I'm hiring developers who've never written production code without AI. How do I assess their actual capability?"* — Startup founder forums, 2026

7 hours per week are lost to AI inefficiencies per developer — juniors hit hardest because they can't evaluate AI output.

### The Identity Collapse

Polywork, the developer identity platform, discontinued in January 2025. GitHub contribution graphs are losing credibility because AI-assisted commits make the green squares meaningless. LinkedIn is a credentialing wasteland where every portfolio now looks impressive regardless of real understanding.

*"GitHub contribution graphs are meaningless in the AI era. What replaces them?"* — Hacker News, 2026

*"I want something that shows how I think, not just what I built."* — IndieHackers, 2026

*"There should be a way to prove thinking, not just typing."* — r/ExperiencedDevs

The cultural response is telling. The Human-Crafted Software Manifesto, the Artisanal Coding manifesto, and "Organic Free-Range Programming" all emerged independently in late 2025. These aren't anti-AI — they're demanding intentionality, ownership, and proof of deliberate thinking. But manifestos don't ship products.

### AI Cost Opacity

AI tooling is the fastest-growing line item in engineering budgets.

*"My startup spends more on Claude API than on AWS. We have no idea if it's making us faster or just making us feel faster."* — Hacker News, March 2026

*"We're paying $40/seat/month for Copilot across 200 devs. Leadership wants ROI numbers. I have nothing."* — r/programming, 2026

Cursor charges $40-50/month per developer with opaque credit burn. CFOs are entering the conversation. LinearB acknowledged that DORA metrics don't capture AI development patterns — the measurement tools themselves admit they can't measure this.

AI observability tools (LangSmith, Langfuse, Helicone) measure AI system performance — latency, tokens, cost per call. Engineering analytics platforms (LinearB, Swarmia, Allstacks) measure throughput. Neither can answer the question every engineering leader is asking: "Did spending $200K on AI tools make our team more capable, or just more dependent?"

---

## What All of This Converges On

Every one of these pains — cognitive debt, the productivity paradox, context amnesia, knowledge silos, junior developer crisis, identity collapse, cost opacity, security blindness from AI speed — traces back to a single gap:

**No tool measures whether developers understand what they build.**

Every existing tool in the developer ecosystem measures output. GitHub Copilot Metrics tracks acceptance rate and lines suggested. DORA metrics measure cycle time and deployment frequency. LinearB, Allstacks, Pluralsight Flow — all throughput. Code review tools measure PR size, not whether the reviewer understood the change. CI/CD pipelines measure whether the build passed, not whether anyone knows why it was structured that way.

In the age before AI, output was a rough proxy for understanding. If someone wrote the code, they probably understood it. That proxy is broken now. AI writes code that developers accept without fully understanding. PRs merge without meaningful review. Systems grow in complexity while the humans maintaining them understand less and less.

The VP Engineering podcast quote from March 2026 captures it perfectly: *"We need a 'check engine light' for developer comprehension. Right now we only find out someone doesn't understand the system when it breaks in production."*

That check engine light doesn't exist. Anywhere. We looked at 60+ tools across 10 competitive categories. None of them measure understanding.

---

## What Developers Actually Crave

Underneath the pain, we found consistent patterns of what developers are already trying to build for themselves — workarounds and hacks that reveal the shape of the product they wish existed.

**They paste context preambles into every AI conversation.** Every ChatGPT and Claude session starts with a paragraph of context — what they were working on, what they tried, what the constraints are. They're manually doing what a persistent memory layer should automate.

**They build personal CLI wrappers around LLMs.** Developers on GitHub and r/LocalLLaMA are building custom shells that prepend personal context before every LLM call — hand-rolling the personalization layer that no tool provides.

**They hoard browser tabs (40-80 per session).** Tabs are a proxy for working memory. People are desperate to preserve context that will evaporate when they close the browser.

**They write "Today I Learned" posts and film end-of-session Loom videos.** Developers on DEV Community and Indie Hackers are documenting micro-learnings and filming screen recordings for next-day continuity. Desperate measures to preserve session context across days.

**They build nightly automation scripts.** On Hacker News "Show HN" and personal GitHub projects, developers are building custom tools to synthesize "where did my week go?" — a clear gap signal.

**They curate "awesome-X" repos.** Millions of collective GitHub stars on curated lists that signal taste and judgment. Identity work disguised as resource sharing.

**They wish their AI "just knew" them.** The most emotionally intense recurring thread across r/ClaudeCode, Cursor Forum, and ChatGPT feedback: *"I want my AI to know what I was working on yesterday without me telling it."*

The craving is not for another note-taking app, or another productivity tracker, or another chat memory. It's for three things:

1. **"Stop making me re-explain myself."** Context that persists across every AI tool, every session, every day. Relief from the daily re-explanation tax.

2. **"Am I understanding more or less?"** A way to see whether AI is making them better or worse — a personal fitness tracker for their comprehension trajectory.

3. **"Proof that I think, not just prompt."** An identity artifact that captures reasoning depth — something to replace the GitHub contribution graph in the AI era.

These three cravings map directly to a product architecture: context injection as the entry point (immediate relief, Day 1 value), comprehension intelligence as the differentiation (insight over weeks), and thinking identity as the growth engine (shareability over months).

---

## The Gap No One Occupies

Before building anything, we mapped the entire landscape. 60+ tools. 10 competitive categories. The pattern that emerged is what we call the **Dumbbell Pattern**: competitors cluster at two ends — capture (11+ tools record decisions, sessions, or activity) and cross-tool memory (Mem0, Zep, LangMem, Letta store facts for AI retrieval). The entire middle — personalization, comprehension, identity — is structurally empty.

We modeled this as a seven-stage depth pipeline:

1. **Capture** — Record what happened (11+ tools here)
2. **Memory** — Store and retrieve facts (5 MCP memory servers here)
3. **Context** — Inject relevant history into AI tools (emerging, shallow)
4. **Personalization** — Learn how you reason and adapt (empty)
5. **Comprehension** — Track whether you understand what you build (empty)
6. **Identity** — Prove your reasoning depth to the world (empty)
7. **Ecosystem** — Others build on your reasoning data (empty)

No competitor covers more than 2.5 of these 7 stages. The middle stays empty because time itself is the barrier to entry. A competitor cannot produce 6 months of your reasoning patterns without 6 months of observation, regardless of funding or engineering talent.

Memory products like Mem0 ($24M raised) and Zep store facts — they're vector databases with retrieval. They can tell an AI "the user worked on auth last week" but not "the user deeply understands the token refresh flow but has never engaged with the RBAC layer." They don't model reasoning trajectories, decision rationale, or comprehension state.

Engineering analytics like LinearB, Allstacks, and Atlassian's DX ($350M acquisition) measure throughput or collect surveys. None observe comprehension.

Developer identity platforms are dying — Polywork shut down. GitHub graphs are meaningless. No replacement exists.

The closest analogy: GitHub created "developer identity through code contribution." Strava created "athletic identity through activity." **Nobody has created "developer identity through reasoning."** That category is empty.

---

## What Unfade Is

Unfade is an open-source, local-first tool that passively captures your engineering reasoning from your existing workflow — git, AI sessions, terminal — and uses it to do three things:

1. **Make every AI tool remember you.** Context injection via MCP so that Cursor, Claude Code, Copilot, and every other AI tool knows what you were working on yesterday, what decisions you've made, and how you think. No re-explaining.

2. **Show you whether you're understanding more or less.** A Comprehension Score (0-100) that tracks your engagement depth over time — are you deeply engaging with what you build, or rubber-stamping AI suggestions without reading them?

3. **Build a visible thinking identity.** A Thinking Graph and shareable Thinking Cards that prove reasoning depth — not commit counts, not lines of code, but evidence of how you think.

All data stays local. Plain text. Human-readable. Open source. Inspectable. You own everything.

### What Unfade Is NOT

- **Not a note-taking app.** You don't write anything. Unfade captures reasoning from your existing workflow.
- **Not a screen recorder.** No screen capture. No keylogging. Structured signals only: git diffs, AI session logs, terminal commands.
- **Not a productivity tracker.** No time tracking. Unfade captures what you thought, not how long you sat there.
- **Not another chat memory.** ChatGPT Memory stores facts. Unfade builds a reasoning model — it learns how you think, not just what you prefer. Cross-tool, not locked to one AI.
- **Not an AI assistant.** Unfade doesn't write code. It remembers your reasoning, personalizes your AI interactions, and makes every AI assistant you already use meaningfully better.

---

## How It Works: The Features

### Passive Capture — The Foundation

A lightweight capture engine runs in the background. Zero effort. Zero configuration after install. It watches three signal sources:

**Git.** Commits, diffs, branch switches, reverts, stashes, merge conflicts. Every commit is a micro-decision. Every revert is a rejected approach. Every branch switch is a context shift. Git is the richest reasoning signal a developer produces.

**AI Sessions.** Cursor conversation logs, Claude Code session transcripts, Copilot completions, Codex output, Aider conversations. The reasoning that happens in conversation with AI is often the highest-quality reasoning in a developer's day — what alternatives were considered, what was rejected, what constraints were applied.

**Terminal.** Commands, error outputs, retries. Patterns of exploration (trying three approaches to start a service), debugging signals (the specific error message that led to the fix), workflow patterns (which tools in what order).

All captured data is stored locally in `~/.unfade/events/` as date-partitioned JSONL files. Append-only. Never leaves your machine without explicit action. Human-readable. Greppable.

Resource budget: less than 50MB memory, less than 1% CPU when idle. The capture engine is invisible to your workflow.

The capture engine is written in Go — a single binary, cross-platform, minimal footprint. It runs in two modes: one instance per tracked repository (watching `.git/`), and one global instance watching AI session directories (`~/.claude/`, Cursor, Codex, Aider). Both write to the same `~/.unfade/events/` directory.

### Cross-Tool Context Injection — The Entry Point

This is where Unfade delivers immediate, Day 1 value. It's the feature that makes developers stay.

Unfade runs an MCP server that any AI tool can query. When you open Cursor and say "Continue the auth refactoring I started yesterday," Cursor queries Unfade's MCP server and receives structured context: yesterday's decisions, the error that blocked progress, the approach that was deferred, the files that were modified. No copy-pasting. No re-explaining. The AI just remembers.

The MCP server exposes your reasoning context through standard MCP primitives:

- **Resources** — Agents auto-discover and read your recent reasoning context, file-specific context, reasoning profile, recent decisions, and domain expertise.
- **Tools** — Agents invoke semantic search across your full history, request proactive insights for the current task, find analogous past reasoning, trigger distillation, or query per-module comprehension scores.
- **Prompts** — Reusable templates like "answer using my reasoning context" or "evaluate this decision against my past patterns."

Because MCP is the universal standard — supported by Claude, Cursor, Windsurf, Copilot, and thousands of other tools — one Unfade install makes every MCP-compatible tool in your workflow smarter. No per-tool plugins. No custom integrations. The protocol does the work.

The same context is also available as a local HTTP API at `localhost:7654` for the web UI, CLI, and custom scripts.

**What this feels like in practice:** You stop explaining yourself. You switch from Claude Code to Cursor mid-session, and Cursor knows what you were doing. You come back Monday morning and your AI tools remember Friday's context. The 10-15 minutes per session spent re-explaining — gone.

### Daily Distill — The Habit

Every day (or at whatever interval you configure), Unfade generates a Daily Distill — a structured reasoning summary synthesized from the day's captured events.

Not a commit log. A thinking log.

**Decisions Made.** What was decided and why — extracted from commits, AI conversations, and branch history. "Chose refresh-ahead over clock tolerance for JWT handling — latency benchmarks showed 4ms overhead vs 200ms+ on cold refresh."

**Trade-offs Navigated.** Where you chose A over B, and the reasoning. "Evaluated Redis Cluster but abandoned it — deployment topology doesn't support it without Kubernetes, which is out of scope this sprint."

**Dead Ends Explored.** Paths tried and abandoned. This is the most valuable signal of expertise — the ability to quickly evaluate and discard approaches that won't work. "Spent 45 minutes attempting to fix JWT validation by adjusting clock tolerance — abandoned when root cause identified as validation order, not clock skew."

**Breakthroughs.** Moments where understanding shifted. "JWT library validates expiry before checking refresh window — reversing the order eliminates the entire clock skew class of bugs."

**Thinking Patterns.** How your day compares to your baseline. "You explored 4 alternatives before deciding today — highest this month. 2 dead ends explored — consistent with your average."

The distill runs through a local LLM (Ollama by default) or an optional cloud LLM for higher quality synthesis. A structured fallback synthesizer works without any LLM at all — you get value even with zero API keys configured.

The distill is reviewable in 2 minutes. It's the daily "closing the rings" moment — reflective, satisfying, and non-performative. Unlike "build in public" (which requires crafting a public update and has 2.3x higher failure rates for projects with heavy activity), the Distill is auto-generated from real work. The effort is 2 minutes of review, not 20 minutes of writing.

### Intelligence Pipeline — The Engine

Behind the distill and the comprehension score sits an intelligence pipeline — 25 analyzers organized in a DAG (directed acyclic graph) that extract meaning from your raw captured events.

**Efficiency Analyzer.** Measures how you collaborate with AI — are your sessions productive or spinning? How much back-and-forth before resolution?

**Comprehension Radar.** Tracks how deeply you engage with different parts of the codebase. Where do you modify AI suggestions vs. accept them blindly?

**Velocity Tracker.** Your development momentum — not just speed, but the relationship between speed and understanding.

**Cost Attribution.** Token spend per session, per project, per decision. Where your AI budget actually goes.

**Prompt Patterns.** How you communicate with AI tools. What patterns lead to better outcomes. Where your prompting style helps vs. hurts.

**Decision Replay.** Reconstructs decision chains from git and AI session data — what was decided, what alternatives were considered, what was rejected and why.

**Rejection Analysis.** When you reject AI suggestions, what patterns emerge? This is signal — it shows where you exercise judgment vs. where you defer.

**Direction Scoring.** Are you steering AI or following it? This is the core measurement that distinguishes "collaborating" from "delegating."

**Session Intelligence.** Detects deepening vs. shallow engagement within work sessions. Are your sessions getting richer or more superficial over time?

**Expertise Mapping.** Charts your domains of genuine expertise — where you reason deeply vs. where you defer to defaults. Built from decision density, trade-off complexity, and dead-end exploration within each domain.

**Blind Spot Detection.** Identifies areas where you consistently accept AI output without modification — potential comprehension gaps that could become security vulnerabilities or architectural debt.

**Loop Detection.** Catches when you're re-exploring the same dead ends. "This is the third time in 6 weeks you've explored a WebSocket approach and abandoned it. Your reasoning was consistent each time — SSE covers the requirement."

**Cross-Project Amplification.** Surfaces connections across projects and time. "You evaluated Redis vs Memcached 2 months ago in a different project — here's what you decided and why."

**Maturity Assessment.** Where you sit on the AI collaboration maturity curve — from "delegator" to "collaborator" to "director."

**Narrative Synthesis.** The cross-analyzer correlation engine that turns all of these signals into a human-readable story. Not 25 separate dashboards — one coherent narrative about how you work.

These analyzers run incrementally. They don't re-process your entire history every time — they update with each new batch of events, maintaining state across runs. The DAG ordering ensures that downstream analyzers can build on upstream results (e.g., narrative synthesis draws from all other analyzers).

### Comprehension Score — The Differentiator

The Comprehension Score is a single 0-100 number that answers the question every developer and every engineering leader is asking: **"Am I understanding more or less as I use AI?"**

It's computed from the intelligence pipeline — direction scoring, session depth, engagement patterns, modification rates, decision quality — and presented as one number that trends over time.

The score isn't a judgment. It's a mirror. It shows you:

- Which parts of the codebase you deeply understand (high engagement, AI suggestions modified or rejected with reason)
- Which parts you're rubber-stamping (high acceptance, low modification, shallow sessions)
- How your comprehension trajectory is moving — up, down, or stable — across different domains
- Where comprehension has decayed because you haven't engaged with an area recently

The decay model follows a power-law curve inspired by FSRS (Free Spaced Repetition Scheduler): `(1 + t/(9*stability))^(-1)`. If you deeply engaged with the auth module 3 weeks ago and haven't touched it since, your comprehension of that module is decaying on a predictable curve. Unfade can tell you: "Auth comprehension at 0.42 — will reach critical (0.30) in 2 weeks without engagement."

This feeds back into the MCP context injection. When your AI tool knows your comprehension state, it adapts. "You're editing the auth module. Your comprehension has decayed to 0.42. Here are the architectural constraints and security implications you should review before making changes." The AI becomes a better collaborator because it knows where you're strong and where you need support.

For engineering leaders, the comprehension score aggregated across a team answers the question nobody else can: "Is our AI investment building capability or creating dependency?" The cost-attribution analyzer combined with the comprehension trajectory produces the one metric CFOs actually need: cost per unit of comprehension growth. "Your team spent $18K on AI tools this month. Comprehension grew 12% in the payment domain but declined 8% in auth. The auth team is spending $6K/month to understand less."

### Personalization — Learning How You Think

This is the capability that makes Unfade qualitatively different from every other tool in the space. Not just context injection — reasoning-level personalization that improves over time.

Over weeks and months, Unfade builds a model of your reasoning fingerprint:

- **Decision style.** Do you evaluate 2 alternatives or 5? Do you prototype-then-decide or analyze-then-decide?
- **Trade-off preferences.** Do you favor simplicity over flexibility? Performance over readability? Convention over optimization?
- **Domain depth.** Where do you reason deeply vs. where do you defer to defaults?
- **Exploration habits.** How long do you spend on a dead end before abandoning? How many alternatives do you consider before converging?
- **Blind spots.** What classes of dead ends do you repeatedly explore? Where are your reasoning gaps?
- **Communication style.** How do you process information — terse or detailed? Evidence-based or principle-based?

This personalization manifests in two ways:

**Better AI interactions.** The MCP context injection doesn't just return what you did — it shapes context for how you process information. A developer who favors deep exploration gets broader alternative suggestions. A developer who values simplicity gets context emphasizing the minimal viable approach. The AI session isn't just remembering — it's tuned to how you think.

**Better distills.** The Daily Distill learns which decisions are worth surfacing, what counts as a "breakthrough" in your domain, what granularity you prefer. After 3 months, the distill reads like it was written by someone who knows you.

The personalization compounds. On day 1, Unfade injects raw context. By month 3, it injects the right context in the right shape for how this specific developer processes information. This is the critical distinction from ChatGPT Memory ("user likes Python") or .cursorrules (a static prompt that never learns). Unfade's personalization is dynamic, cross-tool, and reasoning-level.

**This creates the temporal moat.** After 6 months of use, a developer's Unfade contains a reasoning model that no competitor can replicate without 6 months of their own observation. You can't shortcut accumulated reasoning patterns with better AI or more funding. Time is the barrier to entry.

### Proactive Amplification — Surfacing What You Don't See

Capture records what happened. Personalization tunes how Unfade communicates. Amplification goes further — it actively surfaces connections, patterns, and blind spots from your accumulated reasoning.

*"You're evaluating caching strategies again. Last time (March 3, Project X), you chose write-behind over write-through due to latency constraints. The deployment topology was similar. Here's what you decided and why."*

*"This is the third time in 6 weeks you've explored a WebSocket approach and abandoned it. Your reasoning was consistent each time — SSE covers the requirement."*

*"You spent 2 hours debugging auth token refresh. You encountered a nearly identical issue on February 12 — different project, same root cause. Here's the fix you applied."*

*"In the last 20 architectural decisions in this project, you've never considered failure modes for the external API dependency. Your reasoning patterns in Project X showed strong failure-mode thinking — it may not be transferring."*

This is the difference between a recording and a thinking partner. Without amplification, Unfade is a good journal. With it, Unfade surfaces connections across projects and time that you wouldn't have found on your own — and saves you from repeating work you've already done.

### Thinking Graph & Thinking Cards — The Identity

Over days and weeks, your Daily Distills and intelligence pipeline outputs compound into a Thinking Graph — a visual, interactive profile of how you reason.

**Decision Density Heatmap.** Like GitHub's contribution graph, but for reasoning moments. Each cell is a day. Intensity represents deliberate decisions captured. Weekends with deep side-project thinking light up. Crunch days with 40 AI-generated commits but no reasoning show as dim. It measures thinking, not typing.

**Thinking Patterns.** Automatically extracted meta-patterns: "Consistently evaluates 3+ alternatives before deciding." "Strong at identifying edge cases early." "Favors simplicity over cleverness." These emerge from data, not self-reporting.

**Domain Evolution.** How your expertise has deepened over time across specific domains — databases, distributed systems, auth, frontend. Not just what domains you work in, but how deeply you reason about them.

**Thinking Threads.** Connected decision chains across days and weeks. "On March 3, you chose write-behind caching. On March 7, that decision influenced your queue design. On March 12, you refined the approach based on load testing."

**Thinking Cards.** Shareable, beautifully designed cards summarizing days, weeks, or notable decisions. Purpose-built for social sharing — the equivalent of Spotify Wrapped for your engineering brain. Auto-generated from real work, not curated for performance.

The Thinking Graph goes in bios, portfolios, and job applications. It's the first developer identity artifact grounded in reasoning, not activity. It's harder to fake than GitHub contribution graphs and more meaningful than LinkedIn credentials.

*"I want proof — for myself and for hiring managers — that I'm the one who thinks, not just the one who prompts."* — IndieHackers

The Thinking Graph is that proof.

### Knowledge Graph Substrate — The Connective Tissue

Underneath everything sits a graph-based knowledge substrate (CozoDB) that connects entities across tools and time.

When you discuss the "auth module" in a Cursor session and the "authentication service" in a Claude conversation, the entity resolution pipeline (13 strategies) recognizes these as the same thing and merges the reasoning history. This means when you ask "what do I know about auth?", you get a unified answer drawing from every tool and every session.

The substrate stores entities, relationships, facts, and temporal metadata — including bi-temporal tracking (when something was true, and when we learned it was true). This matters in evolving codebases where understanding changes over time.

It enables queries that no other tool can answer:
- "Show me all decisions about the payment module and their reasoning"
- "Who on the team has the deepest engagement with authentication?"
- "What facts about this module have changed in the last month?"

### The Architecture — How It All Fits Together

Every feature is either an input to or an output from a single reasoning engine:

```
            ┌─────────────────────────────────┐
            │     REASONING ENGINE (Core)      │
            │                                  │
            │  25 DAG-ordered analyzers        │
            │  CozoDB graph substrate          │
            │  Personalization model            │
            │  Comprehension scoring           │
            │  Temporal fact management        │
            └───────────┬───────────┬──────────┘
                        │           │
             ┌──────────┘           └──────────┐
             ▼                                  ▼
      ┌──────────────┐                ┌──────────────┐
      │  UTILITY OUT  │                │ IDENTITY OUT  │
      │               │                │               │
      │ MCP context   │                │ Thinking      │
      │ injection for │                │ Graph,        │
      │ every AI tool │                │ Cards,        │
      │               │                │ Comprehension │
      │ Daily Distill │                │ Score         │
      └──────────────┘                └──────────────┘
```

The dual-output architecture means the same engine that makes your AI tools smarter also produces your visible thinking identity. One data stream, two outputs, one compounding moat. This is why no competitor can replicate the full value by being good at just one thing — memory servers deliver facts without personalization, identity tools measure output without understanding reasoning, decision capture tools record decisions without learning patterns.

### Three Layers, Three Strategic Functions

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: THINKING GRAPH              (Identity — Spread)   │
│  Visual profile, Cards, hiring signal. Shareable.           │
│  WHY people talk about Unfade.                               │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: DAILY DISTILL               (Ritual — Habit)      │
│  Auto-generated reasoning summary. 2-minute review.         │
│  WHY people return every day.                               │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1: REASONING SUBSTRATE         (Foundation — Moat)   │
│  Persistent reasoning graph, MCP context injection,         │
│  personalization, comprehension, amplification.             │
│  WHY every AI tool gets smarter. WHY people can't leave.    │
└─────────────────────────────────────────────────────────────┘
```

Layer 1 provides the utility that keeps the daemon running (context injection saves 10-15 minutes per session). Layer 2 provides the ritual that creates daily engagement (the distill is satisfying and reflective). Layer 3 provides the identity that drives organic growth (every shared Thinking Card is a product advertisement).

---

## A Day With Unfade

**Morning.** Unfade daemon has been running overnight. Zero interaction required. You open your dashboard. Comprehension Score: 73 (down 2 from last week). A narrative card tells you why: "You deeply engaged with the payment refactoring — comprehension of the payment domain grew 8 points. But you rubber-stamped 23 AI suggestions in the auth module without modification. Auth comprehension decayed from 0.71 to 0.42."

**During work.** You open Cursor. Say "Continue the auth refactoring." Cursor queries Unfade via MCP, receives structured context — yesterday's decisions, the error that blocked progress, the approach that was deferred. You don't paste anything. The MCP injection also notes your auth comprehension is low, so the AI explains architectural constraints before suggesting changes.

**Mid-afternoon.** While evaluating caching strategies, a quiet notification from Unfade: "Related context: On Feb 8 (Project X), you evaluated Redis vs Memcached for a hot-path cache. You chose Memcached for throughput but noted 'would pick Redis if we ever need pub/sub or persistence.' This project needs both." The connection saves 30 minutes of re-research.

**End of day.** "Your Unfade is ready." You open the Daily Distill. 3 decisions, 2 trade-offs, 1 dead end, 1 breakthrough. The amplification section catches your eye: "You've explored edge auth (Cloudflare Workers) in 3 separate projects and deferred each time. Recurring pattern — consider whether this is a genuine constraint or an assumption worth challenging." You tap "Publish" on the JWT breakthrough — it becomes a shareable Thinking Card.

**Over weeks.** Your Thinking Graph fills in. Decision density heatmap showing reasoning moments. Domain expertise in Authentication deepening visibly. A Thinking Thread connecting the JWT fix to a broader auth infrastructure narrative spanning three weeks. You link it in your bio.

---

## The Principles Behind the Product

### Privacy Is Structural, Not Claimed

Developers will grant a tool permission to observe their git history, AI sessions, and terminal output only if they can inspect exactly what is captured, how it is processed, and where it is stored.

All data stays in `~/.unfade/` on your machine. Plain text JSONL. Markdown summaries. JSON profiles. Human-readable, greppable, version-controllable. No proprietary database. No cloud sync unless you explicitly opt in. Open source so the privacy guarantee is verifiable, not claimed.

The Microsoft Recall precedent proved this matters. Microsoft faced massive backlash for an observation tool. Within weeks, open-source alternatives launched. For a tool that captures reasoning patterns, the trust bar is even higher. Open source isn't our distribution strategy — it's a structural prerequisite for the product to exist.

### Zero-Config, Passive, Compounding

You install Unfade. You work normally. Unfade captures, distills, learns. There is no daily writing ritual. No manual tagging. No data entry. The value compounds silently in the background and shows up when you check in.

If you skip a day, nothing is lost — the graph accumulated data passively. If you skip a week, you come back to a richer profile, not a blank slate. The only thing Unfade asks of you is 2 minutes of daily review — and even that is optional.

This is the lesson from every failed knowledge management tool: if it requires active effort, developers won't do it. Unfade captures reasoning from work you're already doing.

### Open Source Is The Only Option

92% of developers use open-source software. Vendor lock-in avoidance is the #1 driver of OSS adoption (55% of respondents, up 68% YoY). For a tool that builds a compounding model of how you think, the lock-in concern is existential.

Every competitor in the reasoning capture space is open source — GitWhy, Deciduous, thinking-mcp. Closed-source Unfade would be a trust disadvantage against every alternative.

The core reasoning engine is free and local forever. Everything that runs on your machine — capture, distillation, intelligence pipeline, MCP server, comprehension scoring — is open source and always will be.

---

## Why This Product, Why Now

Four converging forces make this the right product at the right time:

**AI made output cheap.** When code generation is a commodity, the differentiator is reasoning — why that code exists, what alternatives were considered, whether the decisions behind it were sound. Output-based signals (GitHub contributions, lines of code) are becoming meaningless. The demand for a reasoning-based signal is urgent and growing.

**Context fragmentation hit critical mass.** Developers use 2-3 AI tools. MCP created the protocol for them to talk to each other. But MCP is plumbing — it needs something upstream that knows what context to inject. That upstream layer doesn't exist yet.

**The identity crisis created emotional urgency.** Developers are scared. Not of losing their jobs (though some are), but of losing the thing that made them good at their jobs — deep understanding. They crave a system that makes their thinking visible, proves they're more than prompt engineers. This emotional urgency drives adoption faster than any feature spec.

**The comprehension gap became measurable.** METR, MIT, Anthropic — the studies that proved cognitive debt is real gave developers and engineering leaders permission to take the problem seriously. "Am I understanding more or less?" is no longer a philosophical question. It's a measurable one. And Unfade is the only tool designed to measure it.

---

*This document is the culmination of research across Reddit, Hacker News, X/Twitter, academic studies (MIT, METR, Anthropic), industry reports (ThoughtWorks, DORA, Stack Overflow, JetBrains, Faros AI), competitive analysis of 60+ tools, and direct observation of developer behavior across dozens of communities. The evidence base is documented in `unfade_business.md` and `unfade_competitor_analysis.md`.*

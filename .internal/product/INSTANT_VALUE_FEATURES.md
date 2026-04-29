# Instant-Value Features — Gravity, Cravings & Need

> Features that showcase value within minutes, not days. Designed around the three psychological forces that determine product growth: **Gravity** (what pulls you back tomorrow), **Cravings** (what makes you want more), and **Need** (what becomes essential to your workflow). Evaluated via RRVV: research on what actually creates these forces, reasoning through how each feature maps to them, validation against Unfade's north star, and execution priorities.
>
> **North star:** Unfade captures engineering reasoning, builds comprehension intelligence, and creates thinking identity. Every feature here must serve that mission while delivering value in the user's first session — not next week.
>
> **Companion documents:**
> - [PATH_TO_1M_ARR.md](./PATH_TO_1M_ARR.md) — Commercial readiness evaluation
> - [FEATURE_LIST.md](./FEATURE_LIST.md) — Complete feature inventory (73 features, 12 groups)
> - [unfade.md](./unfade.md) — Product narrative and why this exists
>
> **Last updated:** April 2026

---

## Table of Contents

- [1. Why Gravity, Cravings & Need — Not Just Value](#1-why-gravity-cravings--need--not-just-value)
- [2. What the Research Says](#2-what-the-research-says)
- [3. The Features](#3-the-features)
- [4. How They Map to the Three Forces](#4-how-they-map-to-the-three-forces)
- [5. What Must Ship and in What Order](#5-what-must-ship-and-in-what-order)

---

## 1. Why Gravity, Cravings & Need — Not Just Value

"Showcasing value" is table stakes. Every developer tool demo looks impressive. The question is not whether a feature is useful — it's whether the feature creates a psychological pull strong enough to alter the user's behavior permanently.

Three forces determine whether a product grows or flatlines after launch:

**Gravity** — the invisible force that pulls users back without external prompts. Not push notifications. Not emails. The user returns because something inside the product is accumulating, decaying, or changing, and they feel the pull to check. Strava's activity feed. GitHub's contribution graph. Duolingo's streak counter. The mechanism is always the same: the product holds something that the user considers *theirs*, and leaving it unattended creates unease.

**Cravings** — the anticipation of a reward that hasn't arrived yet. Nir Eyal's Hook Model identifies variable rewards as the craving engine: when the brain can't predict exactly what it will receive, it craves the discovery. Spotify Wrapped's power isn't the data — it's the annual surprise of "who am I as a listener?" that users anticipate for weeks. The craving must be tied to self-knowledge — "what will I learn about how I think?" — not to gamification points or badges.

**Need** — the workflow dependency that makes removing the product painful. This is distinct from value. A tool can be valuable without being needed (you appreciate it when it's there but don't miss it when it's gone). Need emerges when the product removes friction so completely that its absence reintroduces pain the user had forgotten existed. Once a developer has MCP context injection working, every AI session without it feels like amnesia. That's need.

The critical insight: **these three forces operate on different timescales.** Need can be established in the first session (remove friction immediately). Cravings emerge within the first week (deliver the first variable reward). Gravity builds over weeks (accumulate enough that leaving hurts). A product that creates all three in the right sequence compounds growth. A product that only creates value — even intense value — leaks users at every seam.

---

## 2. What the Research Says

### Speed is not a feature — it's the feature

Improvements in a user's first 5 minutes drive a 50% increase in lifetime value (Amplitude 2025). Every 10-minute delay in time-to-value costs 8% in conversion (1Capture 2025 benchmark study). 40-60% of free users in a typical PLG funnel are "zombie users" who sign up, poke around, and never reach the activation milestone.

The tools that grew fastest in 2025-2026 share one trait: sub-minute time to "wow." Cursor: write code with AI immediately. Vercel: live URL in seconds after git push. Supabase: working database + auth in 20 minutes. Unfade's 60-second Reasoning Fingerprint is in this class — but it's the only sub-minute moment we have. One wow moment creates trial. Multiple wow moments create retention.

### Variable rewards create cravings — fixed rewards don't

Spotify Wrapped generated 500 million shares in its first day (2025) and 2 billion social impressions. The mechanism: personalized insights about yourself that you couldn't predict — "you were in the top 1% of listeners for this artist." Users describe it as a personality test, not a report. The key: it feels like self-discovery, not data delivery.

Duolingo's streak feature increased course completion by 3.6x (users who reach a 7-day streak). But the streak alone isn't the craving — the craving is the variable reward within the streak: XP earned, leaderboard position changes, surprise achievements. Fixed daily rewards would not create the same pull.

For developer tools specifically: WakaTime's leaderboards and goal tracking create moderate engagement, but the deeper pull is "how much time did I actually spend coding today?" — a self-knowledge question with a variable answer. The craving is the daily reveal.

### Loss aversion is 2x stronger than gain-seeking

The endowment effect means people value what they own disproportionately. The IKEA effect amplifies this: people value what they helped create even more. A 2025 meta-analysis confirmed a significant moderate impact of self-assembly labor on valuation, liking, and sense of ownership.

For Unfade, this means: the reasoning profile a user builds over weeks is not just valuable — it's *theirs* in a way that no subscription cancellation logic can undo. But this only works if the user *sees* the accumulation happening. Invisible value doesn't trigger loss aversion. Every accumulating data point must be visible, counted, and felt.

### Identity sharing is the highest-leverage viral mechanism

People don't share Spotify Wrapped because it's useful. They share it because it says something about who they are. The format works because it feels "less like a report and more like a personality test." 78% of sharing happens on Instagram Stories and X — ephemeral, social, identity-projecting surfaces.

GitHub's contribution graph succeeded because it became a proxy for developer identity despite its crudeness. Trophy.so's 2025 analysis found that "recognition and the ability to build reputation are often stronger motivators than points or prizes" for developers. The contribution graph's real power was social proof, not personal tracking.

The implication for Unfade: Thinking Cards and the Reasoning Fingerprint are not features — they are the primary distribution mechanism. But they only work as distribution if they're generated instantly (not after a week of use) and feel like genuine self-expression (not marketing material).

### Developer tools convert through activation, not awareness

Developer tools achieve 15-25% trial-to-paid conversion — significantly higher than typical SaaS. But the key metric is activation rate, not sign-up rate. Datadog defines activation as "sends 100+ monitoring events and maintains activity for 7+ days" — a behavioral trigger, not a time trigger. Products that hit 70%+ activation rates reach best-in-class status.

Most conversion problems are activation problems. If users don't reach the "aha moment" in the first session, calendar-based conversion tactics underperform by 67%.

---

## 3. The Features

### Feature 1: AI Usage X-Ray

**What it does:** On first install, within 60 seconds of first `unfade` run, scan the user's AI session history (Claude Code, Cursor, Codex, Aider) and git history to produce a shocking, personalized report:

- "You've had **347 AI conversations** in the last 3 months"
- "You re-explained your project context **41 times** across tools"
- "Your estimated AI token spend: **~$280/month**"
- "You explored and abandoned **WebSocket approaches 4 times**"
- "Your most AI-dependent codebase area: **auth module** (89% AI-generated changes)"
- "Your most independent area: **database layer** (12% AI assistance)"

**Why it creates gravity:** The X-Ray reveals a hidden reality about the user's own behavior. Once you see these numbers, you can't unsee them. The natural next question is "how do these change over time?" — which pulls you back to check. The monthly X-Ray update becomes the "what will my numbers be this time?" moment.

**Why it creates cravings:** Every X-Ray is a variable reward — a Spotify Wrapped-style reveal of self-knowledge the user didn't know they wanted. The user cannot predict what the X-Ray will show. "Am I spending more or less than last month?" "Did I re-explain less?" "Is my auth dependency growing or shrinking?" The anticipation of the next reveal creates the craving.

**Why it creates need:** The X-Ray answers questions that no other tool can answer. "How much am I actually spending on AI?" "Where am I most dependent?" These become reference points for how the developer thinks about their own practice. Removing the tool means losing visibility into your own behavior — returning to the blind spot.

**Alignment with north star:** Directly serves comprehension intelligence (shows where understanding is shallow), reasoning capture (quantifies reasoning patterns), and context injection (shows the cost of not having it).

**Surface:** Dashboard (Home page first-run experience), shareable card format.

**Engineering scope:** Medium. The data already exists in the capture pipeline and DuckDB analytics layer. This is a query + presentation layer on top of existing event data. The re-explanation detection requires cosine similarity on context preambles across sessions — similar to the existing loop detector's approach. Estimated: 1-2 weeks.

---

### Feature 2: Reasoning Streak

**What it does:** A daily counter of consecutive days with meaningful engineering reasoning captured. Not just "did I commit today" — did I make at least one deliberate decision, explore an alternative, navigate a trade-off, or engage deeply enough with code that the intelligence pipeline extracted signal.

Visible on the dashboard home page, CLI status, and as a badge on Thinking Cards. The streak counter shows current streak length, longest streak ever, and a subtle "at risk" indicator if the day is ending without captured reasoning.

**Why it creates gravity:** Loss aversion. Duolingo proved that users who reach a 7-day streak are 2.4x more likely to return the next day. The streak leverages the most powerful retention mechanism in consumer psychology: the pain of breaking a chain is more motivating than the pleasure of extending it. After 14 days, the streak represents accumulated effort that the user cannot afford to lose.

**Why it creates cravings:** The streak itself is a fixed reward — but what varies is the *content* of each day's reasoning capture. "What will today's distill show?" "Will today's reasoning be richer than yesterday's?" The streak is the container; the variable reward is the daily insight within it.

**Why it creates need:** The streak reframes what "a productive day" means. A day with 40 commits but no reasoning shows as dim. A day with 3 commits but a deep architectural decision lights up. Over time, the developer internalizes a new definition of productivity — one that values understanding over output. Removing the tool means losing this recalibration.

**Critical design constraint:** The streak must never feel like surveillance or guilt. The "at risk" indicator should be ambient, not alarming. Missing a day should show a "streak freeze" option (like Duolingo) that preserves momentum. The goal is encouragement, not anxiety.

**Alignment with north star:** Directly creates daily engagement habit around reasoning capture. Reinforces the core thesis: understanding matters more than output.

**Surface:** Dashboard (Home page persistent widget), Thinking Card badge.

**Engineering scope:** Small. The intelligence pipeline already extracts signal-bearing events. The streak is a daily boolean derived from existing signal extraction: "did today produce at least one decision, trade-off, or deep engagement event?" Stored as a simple counter in SQLite. Estimated: 3-5 days.

---

### Feature 3: Weekly Reasoning Wrapped

**What it does:** Every Monday morning, auto-generates a personalized "Weekly Wrapped" — a compact, beautifully formatted summary of your reasoning week, designed for sharing:

- "This week: **14 decisions**, 3 dead ends explored, comprehension **up 6%** in payments"
- "Your reasoning style this week: **Deep Explorer** — you evaluated 4.2 alternatives per decision (your average: 2.8)"
- "Biggest shift: You moved from **delegating** to **directing** in the infrastructure domain"
- "Your most valuable dead end: 2 hours on WebSocket approach → confirmed SSE is sufficient (saves future re-exploration)"
- "Context injection saved you an estimated **47 minutes** of re-explanation"

Formatted as a shareable card (PNG) and an interactive dashboard view. One-tap share to X/LinkedIn with og:image preview.

**Why it creates gravity:** The weekly cadence is the "goldilocks frequency" — daily is fatiguing (Distill already occupies that slot), monthly is too infrequent to build habit. Weekly creates the "I wonder what my Wrapped will show this Monday" anticipation. Spotify Wrapped proved the model at annual cadence; weekly compresses the anticipation cycle from 12 months to 7 days.

**Why it creates cravings:** Every week's Wrapped is different. The variable reward is self-knowledge you couldn't predict: "I didn't realize I explored that many alternatives this week." "I didn't know my comprehension grew that much." The craving is the reveal — "who was I this week?"

**Why it creates need:** The Weekly Wrapped becomes the developer's self-awareness ritual. Without it, the week's reasoning evaporates into a blur of commits and conversations. With it, the developer has a structured record of how they grew (or didn't). Over months, the collection of Weekly Wrappeds becomes a reasoning journal that is genuinely irreplaceable.

**Social virality:** Each Wrapped is designed for sharing. The format is optimized for X/LinkedIn — personality-test style framing ("Deep Explorer", "Precision Builder", "Rapid Integrator") that developers want to share because it projects identity, not metrics.

**Alignment with north star:** Synthesizes all intelligence outputs into a single shareable artifact. Combines comprehension trajectory, reasoning identity, and decision intelligence into a weekly narrative. The share mechanism drives adoption.

**Surface:** Dashboard (dedicated Wrapped view), notification/email, shareable PNG card.

**Engineering scope:** Medium. Draws from existing analyzer outputs (comprehension, direction, velocity, decisions, cost attribution). Requires: weekly aggregation queries, narrative template system (similar to existing narrative-engine.ts), card renderer (extends existing card generation), sharing infrastructure. Estimated: 1.5-2 weeks.

---

### Feature 4: Live Context Injection Counter

**What it does:** A persistent, always-visible counter on the dashboard and in the CLI status showing:

- "Context injections today: **7**"
- "Estimated time saved: **23 minutes**"
- "Total since install: **342 injections, ~19 hours saved**"

Updates in real-time as MCP queries arrive. Each injection shows a brief toast: "Context injected into Claude Code — your auth decisions from yesterday included."

**Why it creates gravity:** The counter accumulates. Like a step counter, the number only goes up. The user develops a relationship with the number — checking it becomes habitual. "How many injections today?" is the developer equivalent of checking your step count. The cumulative "total since install" creates the endowment effect — "I've saved 19 hours. That's mine."

**Why it creates cravings:** Each injection is a micro-variable-reward. The user doesn't know when the next injection will happen or what context it will include. The toast notification creates a "what did Unfade just tell my AI?" curiosity moment. Over time, the user starts noticing when injections DON'T happen — absence creates awareness.

**Why it creates need:** This is the most direct need-creation mechanism. The counter makes invisible value visible. Without the counter, context injection is a background process the user might forget exists. With it, the user sees — in real time — that Unfade is working. When the counter stops (because the user switched to a tool without MCP, or the daemon stopped), the absence is immediately felt: "my AI doesn't know what I was doing."

**Critical design constraint:** The time savings estimate must be conservative and transparent. "Based on average re-explanation time of 3.2 minutes per context switch (your measured baseline from first week)." Over-claiming destroys trust.

**Alignment with north star:** Makes the invisible MCP value visible. Converts "I guess it's working" into "I can see exactly how much it's helping." This is the feature that turns context injection from a background utility into a conscious part of the developer's workflow.

**Surface:** Dashboard (Home page persistent widget, Live page detail), notification toasts.

**Engineering scope:** Small. The MCP server already handles all queries. This adds: a query counter in SQLite, a time-saved estimator (based on the user's measured re-explanation baseline from early sessions), a toast notification system, and a dashboard widget. Estimated: 3-5 days.

---

### Feature 5: Comprehension Heat Map (Instant)

**What it does:** Within 60 seconds of first `unfade` run, generates a visual heat map of the codebase showing:

- **Green zones:** Areas the user deeply understands (high modification rate, frequent engagement, deep sessions)
- **Yellow zones:** Areas with moderate understanding (mixed signals)
- **Red zones:** Blind spots (AI-dependent, low modification, shallow engagement, or decaying comprehension)
- **Gray zones:** Areas the user has never touched

The heat map is generated from git history alone on first run (no AI session data needed). As AI session data accumulates, the heat map becomes more precise — showing the difference between "I wrote this code" and "I understand this code."

Each zone is clickable, showing: last engagement date, modification depth score, relevant decisions made in that area, and the comprehension decay trajectory.

**Why it creates gravity:** The heat map changes. Red zones can become green through engagement. Green zones decay to yellow without attention. The user returns to check: "did my auth comprehension recover after yesterday's deep session?" The map is a living representation of the user's relationship with their codebase — and like any relationship, neglect shows.

**Why it creates cravings:** The variable reward is the shift. "Which zones changed this week?" "Did my blind spots shrink?" The user cannot predict how their comprehension landscape will look next Monday. The craving is the reveal of change — self-knowledge about growth (or decay) that is genuinely surprising.

**Why it creates need:** The heat map answers the question every developer asks but has no tool for: "which parts of this codebase would I struggle with if I had to debug them at 3am without AI?" The answer is immediately actionable — study the red zones, engage more deeply with yellow zones. Removing the tool means returning to the illusion of uniform understanding.

**Alignment with north star:** This IS the comprehension intelligence north star, made visual and instant. The heat map is the "check engine light" that the VP Engineering described wanting. It's the single most important differentiating feature Unfade has, and it must be visible within the first minute.

**Surface:** Dashboard (Intelligence Hub primary visualization, Home page summary widget).

**Engineering scope:** Medium. The initial version uses git history only (file-level modification frequency, recency, depth of changes). The full version incorporates AI session data, FSRS decay, and blind spot detection from the existing comprehension analyzer. The initial heat map is a view on top of the git expertise map analyzer output. Estimated: 1-2 weeks for initial version, ongoing refinement.

---

### Feature 6: "Your AI Collaboration Pattern" — First-Minute Personality Reveal

**What it does:** Extends the existing Reasoning Fingerprint with a prominent AI collaboration pattern classification. Within 60 seconds of install, the user sees not just their reasoning style but their relationship with AI:

**Six patterns** (derived from existing research — MIT 2025, Anthropic 2026):
- **The Director** — You steer AI precisely. High modification rate, specific prompts, clear architectural constraints. AI is a tool, not a partner.
- **The Collaborator** — You think with AI. Back-and-forth sessions, genuine exploration, building on AI suggestions with original thought.
- **The Challenger** — You use AI as a sparring partner. High rejection rate, frequent alternative exploration, AI suggestions as starting points for your own reasoning.
- **The Accelerator** — You use AI to go faster at things you understand. Low AI dependency in familiar domains, high usage in routine tasks.
- **The Explorer** — You use AI to learn new territory. High AI usage in unfamiliar domains, decreasing dependency as understanding grows.
- **The Delegator** — You accept AI output with minimal modification. High acceptance rate, shallow sessions, limited alternative exploration.

Each pattern shows on a spectrum, not as a binary label. The user might be "78% Collaborator, 15% Director, 7% Delegator." The pattern shifts over time and across domains — "You're a Director in database work but an Explorer in frontend."

**Why it creates gravity:** The pattern is dynamic. It changes as the user's AI interaction style evolves. "Am I becoming more of a Collaborator?" "Did I delegate more this week?" The pull is the same as any personality assessment that tracks over time — the desire to see whether you're becoming who you want to be.

**Why it creates cravings:** This is the personality test moment. Spotify Wrapped works because "you are this type of listener" feels like self-discovery. "You are a Collaborator who challenges AI in backend work but delegates in CSS" is genuinely novel self-knowledge. Users will share this because it projects identity — "I'm a Director, not a Delegator" is a statement about professional capability.

**Why it creates need:** The pattern reframes the entire conversation about AI in development. Instead of "do you use AI?" the question becomes "how do you use AI?" This is the language shift Unfade creates — from activity to relationship. Once a developer has this vocabulary, losing it feels like losing self-awareness.

**Alignment with north star:** Directly serves thinking identity (shareable, expressive), comprehension intelligence (Delegator pattern correlates with comprehension decay), and reasoning capture (the pattern is derived from captured reasoning).

**Surface:** Dashboard (Profile page primary card, onboarding first-run reveal), Thinking Card (prominent badge), shareable card format.

**Engineering scope:** Small-medium. The underlying data exists in the direction scoring, session intelligence, and maturity model analyzers. This is a classification layer on top of existing outputs — mapping modification rates, prompt specificity, session depth, and rejection rates into pattern labels. The git-only heuristic version (for first-minute display) uses modification rates and commit patterns. Estimated: 1 week.

---

### Feature 7: Dead End Archive — "You've Already Solved This"

**What it does:** Extracts and prominently surfaces every dead end from the user's history — approaches explored and abandoned, with the reasoning for abandonment. On first install, the backfill produces a Dead End Archive from git history (reverts, abandoned branches, refactored approaches):

- "**WebSocket real-time updates** — Explored 3 times (Jan 12, Feb 8, Mar 3). Abandoned each time because SSE covered the requirement without the connection management overhead."
- "**Redis Cluster for session storage** — Explored Feb 20. Abandoned because deployment topology doesn't support it without Kubernetes."
- "**Custom JWT validation** — Explored Jan 5. Abandoned in favor of library validation after discovering edge cases in clock skew handling."

Each dead end shows: times explored, time spent, the consistent reasoning for abandonment, and a "confidence score" for whether this dead end is truly dead or worth revisiting (based on whether the constraints have changed).

**Why it creates gravity:** Dead ends accumulate. The archive grows with every abandoned approach. The user returns to check when they encounter a new problem: "have I tried this before?" The archive becomes a decision-support tool — not just a historical record, but a live reference that prevents wasted time.

**Why it creates cravings:** The surprise is the dead end you forgot. "I didn't realize I'd tried WebSockets three times." "I forgot I abandoned that approach for that reason." Self-knowledge about your own reasoning patterns is genuinely surprising — especially the patterns you repeat unconsciously.

**Why it creates need:** Every developer has wasted hours re-exploring an approach they already rejected. The Dead End Archive prevents this. Once it saves you 2 hours by surfacing "you already tried this and abandoned it for this reason," the tool becomes essential. The loop detector already does this reactively — the archive makes it proactive and browsable.

**Proactive integration:** When the MCP server detects that a current AI session is heading toward a known dead end (via the existing loop detector's cosine similarity), it injects: "You explored this approach on Feb 8. You abandoned it because [reason]. The constraints haven't changed." This is the "Unfade just saved me an hour" moment that drives word-of-mouth.

**Alignment with north star:** Directly serves reasoning capture (dead ends are the most valuable reasoning signal), comprehension intelligence (dead end recognition is evidence of understanding), and cross-tool context (preventing re-exploration across tools).

**Surface:** Dashboard (dedicated Dead Ends section in Decisions page, Home page highlight), MCP (proactive injection on loop detection).

**Engineering scope:** Small-medium. The loop detector and decision replay analyzers already identify repeated approaches. The Dead End Archive is a query + presentation layer on top of existing data. The proactive MCP injection extends the existing loop detection warning. Estimated: 1 week.

---

### Feature 8: "First Session Report" — The 5-Minute Wow

**What it does:** After the user's first meaningful AI session with Unfade running (typically 15-30 minutes of work), automatically generates a "First Session Report" that shows what Unfade captured and what it learned:

- "During this session, you made **3 decisions** and explored **1 dead end**"
- "Your direction score: **72%** — you directed most of this session's output"
- "Key decision captured: Chose connection pooling over individual connections for database access. Rationale: throughput requirements exceed 500 req/s."
- "This session's reasoning is now available to every AI tool you use via MCP. Next time you open Cursor, it will know about today's database decisions."
- "Your comprehension in the **database** domain increased from the baseline"

**Why it creates gravity:** The first session report establishes the pattern — "every session I have, Unfade captures and learns." The user begins to anticipate the post-session insight. "What did I do that session? Let me check Unfade." The report creates a natural reflection point that the user starts to expect and rely on.

**Why it creates cravings:** The variable reward is what the intelligence pipeline found. The user can't predict which decisions will be highlighted, what patterns will emerge, or what the direction score will be. Each session report is a mini-reveal.

**Why it creates need:** The report makes reasoning tangible. Without it, the session's decisions dissolve into the commit history. With it, the developer has a structured record of what they thought and why. After 10 sessions, the accumulated reports form a reasoning journal that would be painful to lose.

**Critical timing:** The report must appear within 30 seconds of session end. Delayed insight loses impact. The intelligence pipeline must prioritize speed over completeness for this report — a quick analysis with 80% accuracy delivered immediately is worth more than a perfect analysis delivered an hour later.

**Alignment with north star:** Closes the loop between reasoning capture and user awareness. Converts invisible background capture into visible, valuable insight. Creates the "Unfade is watching my back" feeling.

**Surface:** Dashboard (notification + dedicated view), system notification.

**Engineering scope:** Medium. Requires: session boundary detection (already exists in session intelligence analyzer), fast-path analysis (subset of full intelligence pipeline optimized for speed), report template, notification system. The analyzers already produce this data — the challenge is producing it fast enough for the post-session moment. Estimated: 1.5-2 weeks.

---

## 4. How They Map to the Three Forces

### Force Matrix

| Feature | Gravity | Cravings | Need | Time to Value |
|---|---|---|---|---|
| AI Usage X-Ray | Accumulating numbers change over time | "What will my numbers be?" — variable self-knowledge | Answers questions no other tool can | 60 seconds |
| Reasoning Streak | Loss aversion — can't break the chain | Variable daily content within the streak | Redefines what "productive day" means | Day 1 |
| Weekly Wrapped | "What will Monday show?" anticipation | Personality-test-style variable insights | Irreplaceable reasoning journal over time | Week 1 |
| Context Injection Counter | Growing number = endowment effect | "What did Unfade just tell my AI?" curiosity | Makes invisible MCP value visible | First MCP query |
| Comprehension Heat Map | Living map that changes with engagement | "Did my blind spots shrink?" surprise | Answers "would I survive a 3am debug without AI?" | 60 seconds |
| AI Collaboration Pattern | Dynamic pattern shifts over time | Personality test — "who am I with AI?" | Creates new vocabulary for AI relationship | 60 seconds |
| Dead End Archive | Growing archive prevents wasted time | Forgotten dead ends are genuinely surprising | "Unfade just saved me 2 hours" moments | 60 seconds (backfill) |
| First Session Report | Every session creates anticipation for the next | Variable insights per session | Tangible record of reasoning per session | First session end |

### Gravity Depth

The features create three tiers of gravitational pull:

**Tier 1 — Immediate gravity (Day 1):** Reasoning Streak + Context Injection Counter. These activate loss aversion and visible accumulation from the first day. The streak says "don't break the chain." The counter says "look how much I've already gained."

**Tier 2 — Discovery gravity (Week 1):** AI Usage X-Ray + Comprehension Heat Map + AI Collaboration Pattern + Dead End Archive. These create the "I didn't know that about myself" moments that make the user return to check what changed. Each revisit deepens the relationship.

**Tier 3 — Ritual gravity (Week 2+):** Weekly Wrapped + First Session Report. These create recurring anticipation — scheduled reveals that the user begins to expect and look forward to. The weekly wrapped becomes the "Monday morning ritual." The session report becomes the "end of session reflection."

### Craving Architecture

The cravings layer follows Nir Eyal's three reward types:

- **Rewards of the Self** (mastery): Comprehension Heat Map improving, AI Collaboration Pattern shifting from Delegator to Collaborator, streak growing. "I'm getting better."
- **Rewards of the Hunt** (discovery): AI Usage X-Ray revealing hidden numbers, Dead End Archive surfacing forgotten explorations, Weekly Wrapped showing unexpected patterns. "What will I find?"
- **Rewards of the Tribe** (social): Weekly Wrapped shareable cards, AI Collaboration Pattern badges on Thinking Cards, streak badges visible to others. "Others can see who I am."

### Need Escalation

Need deepens in stages:

1. **Session 1:** Context injection removes re-explanation friction. The counter makes it visible. First need established: "I don't want to re-explain."
2. **Week 1:** X-Ray and heat map reveal hidden reality. Second need established: "I don't want to be blind to my own patterns."
3. **Week 2:** Streak and Wrapped create behavioral framework. Third need established: "I don't want to lose my definition of a productive day."
4. **Month 1:** Dead End Archive saves real time. Personalization deepens. Fourth need established: "I can't afford to re-explore paths I've already rejected."
5. **Month 3+:** Accumulated data is irreplaceable. Temporal moat is real. "I can't leave — Unfade knows me better than I know myself."

---

## 5. What Must Ship and in What Order

### Priority 0: Ship with Launch (Day 0)

These features must be in the first release. Without them, the product has one wow moment (Reasoning Fingerprint) and then silence until the first Distill. That silence kills activation.

| Feature | Why P0 | Engineering |
|---|---|---|
| **AI Usage X-Ray** | Second wow moment. Fills the "what else?" gap after the Fingerprint. Makes the invisible cost of re-explanation visible. | 1-2 weeks |
| **Comprehension Heat Map (initial)** | The north star feature, visible from minute one. Git-history-only version. | 1-2 weeks |
| **AI Collaboration Pattern** | Extends the Fingerprint from "how you reason" to "how you work with AI." Shareable identity artifact. | 1 week |
| **Context Injection Counter** | Makes MCP value visible immediately. Without it, context injection is invisible = forgettable. | 3-5 days |

**Combined P0 estimate:** 4-6 weeks. These four features transform the first 60 seconds from one wow moment to four. The user goes from "interesting fingerprint" to "I didn't know I re-explained context 41 times / my auth area is a blind spot / I'm a Collaborator who delegates in CSS / Unfade just injected context into Cursor."

### Priority 1: Ship by Week 2

These features establish the habit loop that turns trial into retention.

| Feature | Why P1 | Engineering |
|---|---|---|
| **Reasoning Streak** | Loss aversion kicks in after 7 days. Must exist before the user's first week ends. | 3-5 days |
| **First Session Report** | Closes the capture-to-awareness loop. Without it, users don't know what Unfade learned from their sessions. | 1.5-2 weeks |
| **Dead End Archive** | The "saved me 2 hours" moment that drives word-of-mouth. Backfill version from git history. | 1 week |

**Combined P1 estimate:** 3-4 weeks.

### Priority 2: Ship by Week 4

This feature creates the recurring social distribution mechanism.

| Feature | Why P2 | Engineering |
|---|---|---|
| **Weekly Reasoning Wrapped** | The Spotify Wrapped model at weekly cadence. Primary viral sharing mechanism after the initial Thinking Card share. | 1.5-2 weeks |

**Combined P2 estimate:** 1.5-2 weeks.

### Total estimate: 8-12 weeks of engineering for all 8 features

The P0 features overlap with launch prep and can be developed in parallel. P1 features can begin during the first week post-launch. The staggered release creates the "product is improving every week" perception that early adopters reward with loyalty and sharing.

---

## The Five Numbers That Validate These Features

1. **Second wow moment rate** — What percentage of users who see the Fingerprint also engage with the X-Ray and Heat Map? Target: >60%. Below that, the second wow moment isn't landing.
2. **7-day streak rate** — What percentage of active users reach a 7-day Reasoning Streak? Target: >30%. Below that, the habit loop isn't forming.
3. **Weekly Wrapped share rate** — What percentage of users who receive a Weekly Wrapped share it? Target: >15%. Below that, the social distribution mechanism isn't working.
4. **Context injection awareness** — What percentage of users can describe what Unfade injects into their AI tools? Target: >50%. Below that, the counter isn't making the invisible visible.
5. **Dead end save events** — How many "you already tried this" interventions per active user per month? Target: >2. Below that, the archive isn't preventing real waste.

Every other engagement metric is downstream of these five. If users reach the second wow, form the streak habit, share the Wrapped, understand the injection, and get saved from dead ends — retention, conversion, and virality follow.

---

*Analysis performed via RRVV framework — April 2026*
*Research sources: Amplitude 2025 Time-to-Value Study, 1Capture 2025 Free Trial Benchmarks, Nir Eyal Hook Model (Hooked, 2014), Spotify Wrapped 2025 sharing data, Duolingo streak retention data (Lenny's Podcast, 2025), Trophy.so GitHub Gamification Case Study 2025, Pelled et al. 2026 IKEA Effect Meta-Analysis, DX 2026 Engineering Leaders Survey, JetBrains 2026 Developer Survey, Brex Benchmark December 2025, NPR Spotify Wrapped Psychology 2023, Appcues Time to Wow framework*

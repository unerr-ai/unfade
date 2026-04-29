# Unfade: Adoption & Virality Playbook

> **What this document is:** A research-backed strategy for maximizing Unfade's user adoption and organic growth. Grounded in how the fastest-growing developer tools (Cursor: $0→$2B ARR in 3 years, Lovable: $100M in 8 months) actually grew — not how consumer apps grow.
>
> **Core thesis:** Developer tools don't grow through gamification, badges, or shareable cards. They grow because users become measurably faster and tell colleagues. Cursor spent $0 on marketing for its first $100M ARR — 100% word-of-mouth. The recommendation trigger is always functional: "this tool saved me X hours," never "look at my badge."
>
> **Relationship to other docs:**
> - [INSTANT_VALUE_FEATURES.md](./INSTANT_VALUE_FEATURES.md) — The 4 features that create instant dependency (Cross-Tool Memory, Dead End Firewall, Comprehension X-Ray, Decision Continuity)
> - [PATH_TO_1M_ARR.md](./PATH_TO_1M_ARR.md) — Commercial readiness evaluation
> - [TRANSMISSION_THESIS.md](./TRANSMISSION_THESIS.md) — The vehicle analogy used in Intelligence Hub diagnostics
>
> **Last updated:** April 2026

---

## Table of Contents

- [1. What the Research Actually Says About Developer Tool Growth](#1-what-the-research-actually-says-about-developer-tool-growth)
- [2. The Three Growth Engines](#2-the-three-growth-engines)
- [3. Engine 1: Utility Word-of-Mouth](#3-engine-1-utility-word-of-mouth)
- [4. Engine 2: Embedded Distribution](#4-engine-2-embedded-distribution)
- [5. Engine 3: Identity Artifacts](#5-engine-3-identity-artifacts)
- [6. The Viral Loop](#6-the-viral-loop)
- [7. Adoption Funnel](#7-adoption-funnel)
- [8. Anti-Patterns: What We Don't Do](#8-anti-patterns-what-we-dont-do)
- [9. Feature Inventory](#9-feature-inventory)
- [10. Metrics & Success Criteria](#10-metrics--success-criteria)

---

## 1. What the Research Actually Says About Developer Tool Growth

### Cursor didn't grow through cards and badges

Cursor hit $100M ARR (Jan 2025), $500M (Jun 2025), $1B (Nov 2025), $2B (Feb 2026). The fastest B2B software growth in history. Here's how:

- **$0 marketing spend** for the first $100M ARR. 100% word-of-mouth.
- **The viral artifact was embedded utility**, not a shareable card. "Edited with Cursor" auto-appended to GitHub pull requests drove 32% of organic signups. The colleague sees the label, investigates, tries Cursor, and is 20-25% faster in 5 minutes.
- **The recommendation is functional.** Developers tell colleagues "I'm faster with Cursor," not "look at my Cursor badge." The word-of-mouth is about the work, not the tool.

### Utility virality beats output virality for professional tools

Stack Overflow 2025 Survey: developers adopt tools based on "reputation for quality" and "robust API" — not AI integration, not badges, not gamification. The recommendation trigger is always concrete: "this tool fits my workflow and I'm measurably faster."

The distinction matters:
- **Output virality** (Spotify Wrapped, Canva designs): the artifact IS the share trigger. Works when the product creates media.
- **Utility virality** (Cursor, Calendly, Slack): the product makes your work better, and you tell people because it's genuinely useful. Works when the product creates productivity.

Developer tools are professional tools. Professionals recommend tools that save them time, not tools that give them badges. Healthcare AI documentation tools saw explosive adoption driven entirely by "83% less time writing notes" stories (2025 data). SAP documented 70% time savings on manual reconciliation — adoption driven by word-of-mouth from users who couldn't shut up about the time savings.

### Gamification fails for developer tools

This is the hardest lesson for product teams to accept, because gamification *looks* like it works. Research shows gamified development platforms see 25% higher code commits — but this is the trap:

- **The metric being rewarded must be resistant to gaming.** Developer activity metrics are highly gameable. Streaks reward "showing up," not "doing meaningful work."
- **Streak systems create anxiety** when life interrupts. Todoist's Karma system works only for users who don't optimize for it. Developers who game the metric lose actual productivity.
- **Weekends destroy streak mechanics.** Productivity app gamification consistently fails at weekends and vacations when external structure disappears.
- **Poor implementation "reduces work to point-hunting" with burnout as the outcome** (2026 gamification meta-analysis).

Duolingo's streaks work because language learning requires daily practice. Developer tools don't — developers already code daily because it's their job. Adding a streak to something people already do is adding friction (anxiety about breaking the chain), not value.

### MCP is the distribution channel

MCP adoption data as of 2026:
- **97M+ monthly SDK downloads**, 5,800+ servers, 300+ clients
- Backed by Anthropic, OpenAI, Google, Microsoft
- Donated to Agentic AI Foundation (Linux Foundation) in Dec 2025
- 90% of organizations projected to use MCP by end of 2025

**Network effect:** Each new MCP server increases value for all MCP clients. Being an MCP server means every AI coding tool becomes your distribution channel. When Claude Code, Cursor, Codex, and Aider all query Unfade's MCP server, the user experiences Unfade's value through every tool — without ever opening Unfade's dashboard.

This is Unfade's Cursor-equivalent embedded distribution: the product improves the tools users already use, and the value is experienced inside those tools.

---

## 2. The Three Growth Engines

The previous version of this playbook proposed Output Virality, Progression & Streaks, and Identity Signaling. Research invalidated two of three. Here are the engines that actually work for developer tools:

| Engine | Mechanic | Why It Works | Unfade Implementation |
|---|---|---|---|
| **Utility Word-of-Mouth** | Users tell colleagues because the tool saves real time | Cursor's entire growth story. "I never re-explain context" is concrete and repeatable. | Dead End Firewall saves hours. Cross-Tool Memory eliminates re-explanation. |
| **Embedded Distribution** | The product's value surfaces inside tools people already use | Cursor's "Edited with Cursor" on PRs drove 32% of signups | MCP enrichment makes every AI tool a distribution channel for Unfade |
| **Identity Artifacts** | Shareable outputs that carry the brand | Works as amplifier, not primary driver. Cards, profiles, badges. | Unfade Cards, public profiles, README badges — but secondary to utility |

These engines operate in order of impact:
1. **Utility word-of-mouth** drives the majority of adoption (Cursor: 100% WOM for first $100M)
2. **Embedded distribution** creates passive exposure (32% of Cursor signups from PR labels)
3. **Identity artifacts** amplify among early adopters who are already sold

The critical mistake is inverting this order — building cards and badges first, utility second. Utility is the foundation. Everything else is amplification.

---

## 3. Engine 1: Utility Word-of-Mouth

**Core principle:** The strongest recommendation a developer can make is "this tool saved me X hours this week." Not "this tool gives me a cool dashboard." Not "this tool has streaks." Concrete time savings, concrete productivity gains.

### 3.1 The "Saved Me Time" Stories

Unfade's word-of-mouth triggers are the moments where the product prevents wasted work:

**Dead End Firewall moment:** "I was about to spend 2 hours on WebSockets again. Unfade told Claude that I'd already tried this twice and why I abandoned it. Claude adjusted its suggestion immediately. Saved me the entire afternoon."

**Cross-Tool Memory moment:** "I switched from Cursor to Claude Code mid-task. Claude already knew about the auth decisions I made in Cursor this morning. I didn't re-explain anything. It just... knew."

**Comprehension X-Ray moment:** "Unfade flagged that I was modifying code in a module where my comprehension score was 28%. I was about to ship something I didn't actually understand. I slowed down, reviewed properly, and caught a bug."

**Decision Continuity moment:** "I opened a file I hadn't touched in 3 weeks. Before I even asked a question, Claude already had context on the 4 decisions I'd made in this area and an open question I'd flagged. It was like it had been paying attention the whole time."

These stories are:
- **Concrete** — specific time savings, specific prevented mistakes
- **Repeatable** — they happen weekly, not once
- **Verifiable** — the user experienced the value, it's not a dashboard number
- **Natural to share** — developers tell each other about tools that save them time without prompting

### 3.2 Making the Invisible Visible

The problem with MCP-based value is that it's invisible. Context injection happens silently in the background. The user's AI tool is better, but the user doesn't know why.

**Context Injection Counter:**
- Dashboard widget: "Context injections today: **7** | Estimated time saved: **23 minutes** | Total since install: **342 injections, ~19 hours saved**"
- Real-time toast on each injection: "Context injected into Claude Code — your auth decisions from yesterday included."
- The counter transforms "I guess it's working" into "I can see exactly how much it's helping."

**Dead End Prevention Log:**
- Dashboard section: "Dead ends prevented this month: **3** | Estimated time saved: **4.5 hours**"
- Each prevention links to the specific dead end, the context that was injected, and the AI's adjusted response.

**The visibility layer is not a vanity metric.** It's the mechanism that converts invisible background value into speakable word-of-mouth. "Unfade saved me 19 hours this month" is a sentence a developer can say to a colleague. "Unfade runs in the background" is not.

### 3.3 The Time Savings Estimate

The time savings number must be conservative and transparent, or it destroys trust.

**Methodology:**
- **Context injection savings:** Measured from the user's actual re-explanation patterns in their first week (before Unfade's memory is rich). Average time spent re-explaining context per AI session becomes the baseline. Each injection that eliminates re-explanation credits the baseline time.
- **Dead end prevention savings:** Measured from the actual time the user previously spent on the same dead end (from git history: branch creation to abandonment). If the dead end was explored for 3 hours last time, the prevention credits 3 hours.
- **Always show "estimated"** — never claim precision. The user can inspect the methodology by clicking the number.
- **Round down** — if the calculation says 23.7 minutes, show 23. Under-promising builds trust.

---

## 4. Engine 2: Embedded Distribution

**Core principle:** The best distribution channel is the tools people already use. Cursor's "Edited with Cursor" on PRs drove 32% of signups because every colleague who reviews the PR sees it. Unfade's equivalent: every AI tool that queries Unfade's MCP server is a distribution channel.

### 4.1 MCP as Distribution

When a developer's AI tool queries Unfade's MCP server, the response is richer, more contextual, and more personalized than any tool without Unfade. The colleague notices:

- "Why does your Claude Code seem to know about your past decisions?"
- "How did Cursor know about the dead end before you mentioned it?"
- "Your AI tools seem to... remember things between sessions. How?"

The answer is always: "Unfade." This is embedded distribution — the product's value is visible inside tools people already use, creating curiosity in the people around the user.

### 4.2 MCP Attribution Marker

A subtle attribution in MCP responses that AI tools can surface:

```json
{
  "_meta": {
    "enhanced_by": "unfade",
    "context_source": "Cross-session reasoning memory (47 decisions, 12 dead ends, 3 months of context)",
    "learn_more": "unfade.dev"
  }
}
```

AI tools that display MCP metadata show users (and their pair-programming partners) that Unfade is the source of the enhanced context. This is the equivalent of "Edited with Cursor" — a passive, non-intrusive attribution that creates curiosity.

**Design constraints:**
- Never block or degrade the MCP response to add attribution. The response is always the priority.
- The attribution is metadata, not user-facing text. AI tools choose whether to surface it.
- No tracking, no analytics, no phone-home. Pure passive visibility.

### 4.3 "Enhanced by Unfade" in AI Output

When an AI tool provides a response that was significantly enhanced by Unfade context (dead end prevention, comprehension-adapted explanation, decision continuity), the MCP response includes an `attribution` field:

```json
{
  "attribution": {
    "type": "dead_end_prevention",
    "summary": "Prevented re-exploration of Redis Cluster approach (abandoned Feb 20 due to Kubernetes dependency)",
    "time_saved_estimate_minutes": 90
  }
}
```

AI tools that display this create the "Unfade just saved me an hour" moment visible to anyone watching the session (pair programming, screen sharing, recorded demos).

### 4.4 Cross-Tool Network Effect

Unfade becomes more valuable as the user uses more AI tools:
- 1 tool: Unfade provides session history and decisions
- 2 tools: Unfade bridges context between tools (decisions from Claude appear in Cursor)
- 3+ tools: Unfade becomes the universal memory layer — the one system that knows everything across all tools

This creates a natural expansion dynamic: the user who installs Unfade for Claude Code discovers it also works with Cursor. They start using both. The value compounds. They tell colleagues who use different AI tools: "It works with everything."

---

## 5. Engine 3: Identity Artifacts

**Important context:** Identity artifacts (cards, badges, profiles) are real but secondary growth drivers. They amplify adoption among users who are already sold on the utility. They do not create initial adoption on their own.

The research is clear: developers share artifacts that project professional competence, not gamification badges. "I have a 47-day streak" is not something senior engineers share. "I direct 78% of my AI collaborations — here's my reasoning profile" is.

### 5.1 Unfade Card

A visually striking, data-rich summary of a developer's reasoning identity. The card works because it answers a novel question: "How do you actually work with AI?"

**Card contents:**
- Comprehension map summary: domains of deep understanding vs. blind spots
- Direction profile: how the developer steers AI tools (director, collaborator, delegator spectrum)
- Decision footprint: total decisions, held vs. revised rate, key domains
- Context reach: how many AI tools benefit from the user's reasoning memory
- Watermark: `unfade.dev/cards/{username}`

**Share targets:**
- One-click export as PNG — optimized for Twitter/X and LinkedIn aspect ratios
- Card URL with `og:image` metadata for rich link previews
- Direct share to Twitter/X with pre-filled text

**Design principles:**
- The card is interesting because the data is novel — no other tool shows this information
- It projects professional competence: "I understand my codebase deeply and direct my AI tools deliberately"
- It creates a curiosity gap: "What's a direction profile? What's comprehension mapping?" — the viewer clicks to understand

### 5.2 Public Profile

An optional public page at `unfade.dev/u/{username}` showing:
- Comprehension landscape: domains with depth indicators
- Direction signature: how the developer collaborates with AI
- Decision track record: held vs. revised, deliberation depth
- Reasoning narrative: auto-generated summary of the developer's thinking patterns

**Privacy model:**
- 100% opt-in. Nothing is public until published from the dashboard
- User controls what's visible
- All data is computed locally — the public profile is a snapshot
- No login required to view (reduces friction for viewers)

### 5.3 README Badge

A dynamic SVG badge for GitHub README files:

```markdown
[![Unfade](https://unfade.dev/badge/{username})](https://unfade.dev/u/{username})
```

Renders as: `[Unfade: 312 decisions | 4 domains]`

The badge signals depth: this developer has a track record of deliberate reasoning across multiple domains. It's a professional credential, not a gamification badge.

### 5.4 Publish Action

The dashboard Publish action generates:
- Public profile page
- README badge
- og:image card for link previews
- Latest Unfade Card

Single action, zero config.

---

## 6. The Viral Loop

The loop follows utility, not gamification:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  Developer installs Unfade                                       │
│  (free, passive, local-first, zero behavior change)              │
│              │                                                   │
│              ▼                                                   │
│  AI tools get smarter immediately                                │
│  (MCP serves reasoning context, decisions, comprehension)        │
│              │                                                   │
│              ▼                                                   │
│  User FEELS the difference                                       │
│  - No re-explanation needed                                      │
│  - Dead end caught before wasting time                           │
│  - AI adapts to comprehension level                              │
│  - Decisions carry forward across sessions                       │
│              │                                                   │
│              ▼                                                   │
│  Counter makes value visible                                     │
│  "23 minutes saved today" / "3 dead ends prevented this month"   │
│              │                                                   │
│              ▼                                                   │
│  User tells colleagues (utility word-of-mouth)                   │
│  "Unfade saved me 2 hours" / "My AI tools remember everything"   │
│              │                                                   │
│              ▼                                                   │
│  Colleagues notice enhanced AI responses (embedded distribution) │
│  "How does your Claude know about your past decisions?"          │
│              │                                                   │
│              ▼                                                   │
│  Colleague installs Unfade                                       │
│  Their AI tools get smarter immediately                          │
│              │                                                   │
│              ▼                                                   │
│  Loop restarts                                                   │
│                                                                  │
│  [AMPLIFIER] Some users share Unfade Cards / profiles            │
│  This accelerates the loop but doesn't drive it                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### K-Factor Drivers

These elements determine how many new users each existing user generates:

1. **Concrete time savings stories** — "Unfade saved me 19 hours this month" is a sentence that creates instant curiosity. More specific = more viral.
2. **Cross-tool visibility** — When Unfade enhances AI responses during pair programming or screen sharing, the observer sees the difference. This is passive distribution with zero effort from the user.
3. **Zero behavior change** — Install → work normally → value appears. The activation energy is near zero. Low barrier = higher conversion from curious observer to active user.
4. **Privacy-first removes trust friction** — "All data stays local" eliminates the #1 objection to developer tools that capture activity (Stack Overflow 2025: security/privacy concerns rank #1 deal-breaker).
5. **Cross-tool value** — Works across Claude Code, Cursor, Codex, Aider, any MCP client. Every AI tool user is a potential Unfade user. This is a larger addressable market than any single-tool solution.
6. **MCP network effect** — As MCP adoption grows (97M+ monthly SDK downloads), Unfade's distribution surface grows automatically. New AI tools that support MCP become new distribution channels for Unfade without any integration work.

### Viral Coefficient Target

- Realistic target: **K = 0.3-0.5** in the first year
- This is sub-viral (K < 1.0 means each user generates less than one new user) but with strong organic growth
- The goal is steady compounding — matching Unfade's core value proposition (reasoning that compounds over time)
- Cursor reached K > 1.0 only after ~$300M ARR when network effects kicked in. Unfade should plan for the same trajectory.

---

## 7. Adoption Funnel

### Stage 1: Awareness

**Trigger:** Developer hears about Unfade from a colleague, sees enhanced AI responses during pair programming, or encounters an Unfade Card/badge.

**The word-of-mouth message:** "My AI tools remember everything I decided across sessions. I never re-explain context. It caught me before I wasted 2 hours on a dead end."

This is specific, concrete, and immediately testable. Compare to the old message ("I have a 47-day reasoning streak") — abstract, not actionable, doesn't create urgency.

**Design:**
- Landing page hero: "Your AI tools forget everything between sessions. Unfade fixes that."
- Show a before/after: AI session without Unfade (re-explaining context, rediscovering dead ends) vs. with Unfade (instant context, dead end prevention)
- Installation: single command (`curl -fsSL unfade.dev/install | sh` or `npm i -g unfade`)
- Emphasize: passive, local-first, zero behavior change, works with any MCP-compatible AI tool

### Stage 2: Activation (First 5 Minutes)

**This is where everything is won or lost.** 68% of developers abandon tools with setup times exceeding 10 minutes. Unfade must deliver felt value in under 5 minutes.

**Trigger:** User runs `unfade` for the first time.

**Activation sequence:**
1. **Minute 0-1:** Auto-discover repos, start capture, begin materializing git history. Display Comprehension X-Ray from git history alone — the user sees green/yellow/red zones in their codebase within 60 seconds.
2. **Minute 1-2:** MCP server starts. If the user has Claude Code, Cursor, or another MCP client configured, context injection begins immediately. First MCP query returns enriched context.
3. **Minute 2-5:** User starts an AI session. The AI tool's response is enhanced with reasoning context from the user's git history. The context injection counter starts ticking. The user may not notice the enhancement yet — but the counter makes it visible.
4. **First dead end encounter (variable timing):** This is the unforgettable moment. The user starts exploring an approach they've tried before. Unfade injects the dead-end context. The AI adjusts its suggestion. The user realizes: "This thing just saved me hours."

**Activation metric:** User has at least 1 MCP context injection in their first session. Target: >80% of users who complete install.

### Stage 3: Retention (Week 1)

**Trigger:** Accumulating value — context injections, dead end preventions, comprehension insights.

**Design:**
- Counter grows daily. "23 minutes saved today" → "2.3 hours saved this week" → visible accumulation
- Comprehension X-Ray becomes more precise as AI session data supplements git history
- Decision Continuity kicks in — returning to areas triggers proactive briefings
- Dashboard shows concrete value: interventions, time saved, dead ends prevented

**Retention mechanism:** The retention isn't "come back to check your dashboard." It's "your AI tools get dumber if you stop running Unfade." This is the Cursor retention model — users don't return to Cursor because of streaks. They return because other editors feel slow.

### Stage 4: Deep Engagement (Month 1+)

**Trigger:** Accumulated reasoning data creates compounding value.

**Design:**
- Cross-tool memory deepens — switching between AI tools feels seamless
- Dead End Firewall has more history to draw from — catches more near-misses
- Comprehension scoring has enough data for meaningful decay alerts
- Decision Continuity spans weeks of context
- The user's data is irreplaceable — 3 months of reasoning context can't be recreated

**The temporal moat:** This is Unfade's ultimate retention mechanism. After 3 months, Unfade holds reasoning context that doesn't exist anywhere else. It's not in git (git has code, not reasoning). It's not in AI chat logs (fragmented across tools). It's not in the developer's memory (humans forget). Leaving Unfade means losing this accumulated intelligence.

### Stage 5: Referral

**Trigger:** A concrete "saved me time" moment — dead end prevented, context switch eliminated, comprehension gap caught.

**Design:**
- The counter provides the talking point: "Unfade saved me 19 hours this month"
- During pair programming, the colleague sees enhanced AI responses — "How did it know that?"
- The Unfade Card provides an optional share artifact for users who want to signal identity
- Share prompts appear only after concrete value moments — never unprompted

---

## 8. Anti-Patterns: What We Don't Do

### 8.1 No Streaks

Streaks create anxiety, reward showing up (not meaningful work), fail at weekends, and are gameable. Developers already code daily — adding a streak to something they already do adds friction, not value. Duolingo's streaks work because language learning requires daily practice discipline. Developer tools don't need to create practice discipline — they need to create productivity gains.

### 8.2 No Leaderboards

Developers hate being ranked against strangers. Public leaderboards create anxiety, not engagement. The only comparison is with your own past: "comprehension improved 12% this month" — never "you're in the 73rd percentile."

### 8.3 No Gamification Points, Badges, or Levels

Points and XP systems "reduce work to point-hunting" with burnout as the outcome (2026 meta-analysis). Every number in Unfade has a real-world interpretation. "312 decisions" means "312 deliberate choices you made and can reference." It's not a score to maximize.

### 8.4 No Dark Patterns

- No features locked behind sharing
- No "invite friends to unlock" gates
- No notification spam
- No forced onboarding flows (the product works immediately without completing any tutorial)

### 8.5 No Forced Sharing

Every share prompt has a clear dismiss button. The product is 100% functional without ever sharing anything. Sharing is a natural outcome of genuine time savings, not a requirement for features.

### 8.6 No Email Marketing

Developers delete tool emails (Stack Overflow 2025: email is the #1 annoyance from developer tools). All engagement happens in-app or through the MCP layer. No weekly digests. No "you haven't logged in" nudges. The product's value is experienced through the AI tools the developer is already using.

### 8.7 No Vanity Metrics

Every number shown has a real-world interpretation. We never show a big number just because big numbers feel good. "342 context injections" is always accompanied by "~19 hours saved" — the number the user can actually feel.

---

## 9. Feature Inventory

### Priority 0: Ship with Launch — Creates Immediate Dependency

| Feature | Description | Growth Engine | Effort |
|---|---|---|---|
| **Context Injection Counter** | Real-time display of MCP injections + time saved | Utility WOM | Small |
| **Dead End Firewall (proactive)** | Prevent re-exploration on first re-approach, not third | Utility WOM | Medium |
| **Comprehension X-Ray (git-only)** | 60-second visual comprehension map from git history | Utility WOM | Medium |
| **MCP Attribution Marker** | `enhanced_by: unfade` metadata in MCP responses | Embedded Distribution | Trivial |

### Priority 1: Ship by Week 3 — Deepens Dependency

| Feature | Description | Growth Engine | Effort |
|---|---|---|---|
| **Adaptive MCP Enrichment** | AI tools adjust explanations based on comprehension level | Utility WOM | Small |
| **Decision Continuity (file mapping)** | Entering a file triggers relevant decision context | Utility WOM | Medium |
| **Dead End Prevention Log** | Dashboard showing prevented dead ends with time saved | Utility WOM | Small |
| **Cross-Tool Session Linking** | Bridge context when switching AI tools mid-task | Utility WOM | Medium |

### Priority 2: Ship by Week 6 — Amplification Layer

| Feature | Description | Growth Engine | Effort |
|---|---|---|---|
| **Unfade Card v2** | Rich card with comprehension map, direction profile, decisions | Identity Artifacts | Medium |
| **Public Profile** | `unfade.dev/u/{username}` with reasoning identity | Identity Artifacts | Large |
| **README Badge** | Dynamic SVG showing decisions + domains | Identity Artifacts | Medium |
| **Publish Action** | One-click: profile + badge + card + og:image | Identity Artifacts | Medium |

### Priority 3: Ship by Week 8 — Full System

| Feature | Description | Growth Engine | Effort |
|---|---|---|---|
| **Open Question Tracking** | Surface unresolved questions when returning to code areas | Utility WOM | Medium |
| **Decision Conflict Detection** | Flag AI suggestions that contradict past decisions | Utility WOM | Medium |
| **Comprehension Decay Alerts** | Proactive warnings when understanding fades in critical areas | Utility WOM | Small |
| **Proactive Context Push** | Push relevant context on file open, before AI query | Embedded Distribution | Large |

---

## 10. Metrics & Success Criteria

### Primary Metrics: Utility Value (These Drive Everything)

| Metric | Target (6 months) | Why It Matters |
|---|---|---|
| **MCP injections per active user per day** | > 5 | Core value delivery — every injection is a moment of felt value |
| **Dead ends prevented per user per month** | > 2 | The "saved me 2 hours" moments that drive word-of-mouth |
| **Estimated time saved per user per month** | > 4 hours | The talking point: "Unfade saves me a day per month" |
| **First MCP injection within 5 minutes of install** | > 80% | Activation — did the user feel value in the first session? |

### Retention Metrics: Dependency Created

| Metric | Target (6 months) | Why It Matters |
|---|---|---|
| **D7 retention** (% users with capture running 7 days post-install) | > 40% | Did immediate value create continued use? |
| **D30 retention** | > 25% | Did accumulating value create dependency? |
| **MCP query volume trend** (per user, week over week) | Stable or growing | Are AI tools continuing to benefit from Unfade? |
| **Dashboard visit frequency** | 1-2x per week | Users check their counter and comprehension map |

### Growth Metrics: Word-of-Mouth Working

| Metric | Target (6 months) | Why It Matters |
|---|---|---|
| **K-factor** (new users per existing user) | > 0.3 | Viral loop functioning — utility WOM creating installs |
| **Install source: word-of-mouth** | > 60% | Utility-driven growth, not marketing-driven |
| **unfade.dev traffic from direct/social** | > 50% | Organic discovery from recommendations and shared artifacts |
| **Install conversion from unfade.dev** | > 15% | Value prop resonating — "my AI tools remember everything" |

### Amplification Metrics: Identity Artifacts (Secondary)

| Metric | Target (6 months) | Why It Matters |
|---|---|---|
| **Cards generated per month** | Growth | Users creating shareable artifacts |
| **Cards shared** (% of generated) | > 10% | Artifacts worth sharing |
| **README badges deployed** | Growth | Persistent ecosystem visibility |
| **Public profiles published** | Growth | Users investing in public identity |

### What We Don't Measure

- **Streak length** — We don't have streaks. Daily engagement is measured through MCP query volume, not consecutive-day counters.
- **Time on dashboard** — Dashboard time is not a goal. Users should spend time in their AI tools, with Unfade working in the background.
- **Badge/achievement completion** — We don't have badges. Progress is measured in real outcomes (time saved, dead ends prevented), not gamification milestones.

---

## The Diagnostic Language (From Transmission Thesis)

The vehicle analogy from the Transmission Thesis is used in Intelligence Hub diagnostics — not as a viral mechanic, but as a communication tool. Diagnostics like "your steering is loose in infrastructure" are more actionable than "your direction score is 42%." The analogy serves comprehension, not virality.

**Glossary (source of truth for all UI copy):**

| Vehicle Term | System Concept | Where Used |
|---|---|---|
| **Engine** | AI tool (Claude Code, Cursor, etc.) | Thesis framing, system status |
| **Steering** | Human Direction Score / autonomy | AutonomyTab, diagnostics |
| **Track Visibility** | Comprehension score | ComprehensionTab, diagnostics |
| **Ground Speed** | AI Efficiency Score (AES) | OverviewTab |
| **Gears** | Maturity phases (1-4) | MaturityTab |
| **Transmission** | The system Unfade builds (context, patterns, decisions) | Maturity phases |
| **Vehicle Diagnostics** | Synthesis of analyzer outputs into actionable problems | AutonomyTab, OverviewTab |

The metaphor concentrates in the Intelligence Hub. Home, Live, Decisions, and Distill pages use straightforward language. When the metaphor doesn't fit, we drop it. Clarity beats consistency.

**Risks and mitigations:**
- **Condescension risk:** Phases describe system state, not developer skill. "Bare Engine" = "you haven't built a transmission yet," not "you're a bad developer."
- **Cultural barriers:** The metaphor is the interpretation layer, not the data layer. Raw metrics are always accessible underneath.
- **Metaphor ceiling:** When the analogy doesn't fit (cross-project amplification, temporal facts), use direct language instead of force-fitting.

---

## Research Sources

- Cursor growth trajectory — TechCrunch 2025-2026, DevGraphiq 2026, GetPanto 2026
- Cursor "Edited with Cursor" PR attribution — 32% organic signup driver (a16z 2025 growth analysis)
- Stack Overflow 2025 Developer Survey — tool adoption drivers, trust factors, deal-breakers
- MCP adoption data — Anthropic 2026, Thoughtworks 2025, The New Stack 2026
- Lovable growth — TechCrunch 2026 ($100M ARR in 8 months)
- Devin persistent context study — Cognition Labs 2025 (67% vs 34% merge rate)
- Gamification failure research — Design Bootcamp 2026 meta-analysis, Trophy.so 2025
- Healthcare AI documentation adoption — 83% time savings driving explosive WOM (2025)
- SAP manual reconciliation — 70% time savings driving enterprise adoption (2025)
- Amplitude 2025 Time-to-Value Study — first 5 minutes drive 50% LTV increase
- 1Capture 2025 Free Trial Benchmarks — 68% abandon at >10 min setup
- Claude Code NPS — +58 (CustomGauge SaaS Benchmarks 2025)
- JetBrains 2026 Developer Survey — 76% report context loss across AI tools
- GitClear 2025 — 41% AI-generated code, 39% churn increase
- MIT/Wharton 2025 — comprehension gap: delegation (40%) vs inquiry (65%)
- Evil Martians 2025 — "Six Things Developer Tools Must Have"
- RedMonk 2025 — "10 Things Developers Want From Agentic IDEs"

---

*Playbook revised April 2026 — grounded in Cursor/Lovable growth research, not consumer app gamification patterns*

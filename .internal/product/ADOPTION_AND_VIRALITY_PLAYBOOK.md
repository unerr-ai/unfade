# Unfade: Adoption & Virality Playbook

> **What this document is:** A research-backed strategy for maximizing Unfade's user adoption and organic virality. Covers user psychology, viral mechanics, the role of the Transmission Thesis analogy, and concrete product features to implement.
>
> **What this document is NOT:** Implementation specs or sprint plans. It defines *what* to build and *why* it works psychologically. Architecture and implementation details live in separate phase docs.
>
> **Relationship to Transmission Thesis:** The Thesis (`TRANSMISSION_THESIS.md`) defines the analogy — engines, transmissions, steering, tracks. This document defines how that analogy (and the product built around it) drives adoption and word-of-mouth growth.
>
> **Last updated:** April 2026

---

## Table of Contents

- [1. Psychology: Why the Vehicle Analogy Works](#1-psychology-why-the-vehicle-analogy-works)
- [2. Psychology: Where It Can Fail](#2-psychology-where-it-can-fail)
- [3. The Three Viral Engines](#3-the-three-viral-engines)
- [4. Engine 1: Output Virality](#4-engine-1-output-virality)
- [5. Engine 2: Progression & Streaks](#5-engine-2-progression--streaks)
- [6. Engine 3: Identity Signaling](#6-engine-3-identity-signaling)
- [7. The Viral Loop](#7-the-viral-loop)
- [8. Anti-Patterns: What We Don't Do](#8-anti-patterns-what-we-dont-do)
- [9. Feature Inventory](#9-feature-inventory)
- [10. Adoption Funnel Design](#10-adoption-funnel-design)
- [11. Metrics & Success Criteria](#11-metrics--success-criteria)

---

## 1. Psychology: Why the Vehicle Analogy Works

The Transmission Thesis uses a vehicle analogy to describe the state of AI-developer collaboration: engines (AI tools), drivers (developers), tracks (codebases), transmissions (the missing system Unfade provides). This analogy is not decoration — it is a deliberate cognitive tool backed by research.

### 1.1 Conceptual Metaphor Theory (Lakoff & Johnson)

Humans reason about abstract concepts by mapping them to concrete, embodied experiences. "Human Direction Score: 0.6" is abstract. "Your steering is loose in infrastructure" is concrete — it activates spatial reasoning, motor memory, and an immediate sense of "I should fix that."

Research confirms:
- Concrete metaphors reduce cognitive load during onboarding — users map new concepts to existing mental models rather than learning from scratch
- Retention improves when information is encoded through familiar physical analogies
- CHI 2025 ProductMeta study found that well-designed product metaphors bridge the gap between designer intent and user comprehension

**Application to Unfade:** Every developer has driven a car (or at least understands the concept). "Bare Engine" immediately communicates "powerful but uncontrolled." "Tuned Vehicle" immediately communicates "fast and precise." No explanation needed.

### 1.2 Maturity Models Drive Self-Assessment

Progression models (Dreyfus skill model, CMMI, Spotify's engineering levels) are psychologically effective because they create a productive tension between where you are and where you could be.

Key findings from developer maturity research:
- **Users cannot skip levels** — progression feels earned, not arbitrary. A Phase 2 developer cannot shortcut to Phase 4 because the underlying behaviors must change.
- **Perceived usefulness matters more than perceived ease of use** — TAM (Technology Acceptance Model) research shows developers adopt tools they find genuinely informative, not just easy.
- **The perception gap is real** — research shows developers overestimate their own speed by ~20% while actually being 19% slower. Unfade's maturity phases hold up a mirror that is honest but constructive.

**Application to Unfade:** The 4-phase model (Bare Engine → First Gear → Multi-Gear → Tuned Vehicle) gives every user a starting position, a current assessment, and a visible path forward. The phases are computed from real data (HDS, acceptance rate, comprehension, context leverage), not self-reported.

### 1.3 Diagnostic Language Creates Trust

Abstract metrics invite dismissal ("67% direction density — what does that even mean?"). Specific diagnostics invite engagement ("Your steering is loose in infrastructure — you're accepting 90% of AI output without modification in that domain").

The Transmission Thesis explicitly reframes every metric as a diagnosis:
- Not "Direction: 67%" → "Your steering is precise in auth but loose in infra"
- Not "Comprehension: 45%" → "You're driving blind in infrastructure — comprehension below 40%"
- Not "Maturity: Phase 2" → "Your vehicle has first gear. Turns are rough, but you're beginning to direct the engine."

This works because:
- Diagnostics imply actionability — "if my steering is loose, I can tighten it"
- Vehicle language externalizes the problem — it's the vehicle that needs work, not the developer
- Specific domain callouts feel personalized, not generic

---

## 2. Psychology: Where It Can Fail

### 2.1 The Clippy Problem (Condescension)

Alan Cooper's "Myth of Metaphor" and the Microsoft Bob/Clippy disasters demonstrate that extended metaphors fail catastrophically when they feel patronizing. A senior engineer hearing "you're a Bare Engine" may bristle — it feels like a judgment of competence rather than a description of tooling maturity.

**Mitigation:**
- The phases describe the *system state*, not the *developer's skill*. "Bare Engine" means "you haven't built a transmission yet" — it says nothing about whether you're a good developer.
- Diagnostic language stays analytical, never cute. "Engine running without steering — high AI dependence" reads as a technical assessment. Never: "Oops, looks like you need to learn to drive! 🚗"
- The vehicle language is opt-in context — raw metrics are always accessible underneath (EvidenceDrawer, raw data views).

### 2.2 Cultural Barriers

Vehicle/driving metaphors are culturally specific. In regions where car ownership is uncommon, or where driving carries different associations, the metaphor may fall flat.

**Mitigation:**
- The metaphor is the *interpretation layer*, not the *data layer*. HDS, acceptance rate, comprehension — these are universal metrics. The vehicle framing is how we present them, not how we compute them.
- Keep the door open for alternative metaphor skins in the future (music/instrument, sports/training, etc.) without coupling the data model to any specific analogy.

### 2.3 Metaphor Ceiling

Every extended metaphor breaks when stretched beyond its natural domain. When Unfade needs to describe something that has no vehicle analogue (e.g., cross-project reasoning amplification), force-fitting creates confusion.

**Mitigation:**
- Concentrate the metaphor in Intelligence Hub and maturity phases. Home, Live, Decisions, and Distill pages use straightforward language.
- When the metaphor doesn't fit, drop it. Clarity beats consistency.

### 2.4 Mixed Metaphors

Inconsistent usage ("steering" means autonomy in one place, "direction" means comprehension elsewhere) turns the metaphor into noise.

**Mitigation — Glossary (source of truth for all UI copy):**

| Vehicle Term | System Concept | Where Used |
|---|---|---|
| **Engine** | AI tool (Claude Code, Cursor, etc.) | Thesis framing, system status |
| **Driver** | Developer | Thesis framing only (never in UI — "you" is always the driver) |
| **Track** | Codebase | Comprehension context |
| **Steering** | Human Direction Score / autonomy | AutonomyTab, diagnostics |
| **Transmission** | The system Unfade helps build (context, patterns, decisions) | Maturity phases, build guide |
| **Gears** | Maturity phases (1-4) | MaturityTab, phase badges |
| **Ground Speed** | Actual useful velocity (AES) | OverviewTab, KPIs |
| **Track Visibility** | Comprehension score | ComprehensionTab, diagnostics |
| **Drafting** | Unknowingly following AI defaults | AutonomyTab diagnostics |
| **Upshift / Downshift** | Phase transition (up or down) | Phase change events, celebrations |
| **Vehicle Diagnostics** | Synthesis of all analyzer outputs into actionable problems | AutonomyTab, OverviewTab |
| **Build Guide** | Prescriptive steps to reach next phase | MaturityTab |

---

## 3. The Three Viral Engines

The highest-virality products combine three mechanics. Each creates a different type of organic spread:

| Engine | Mechanic | Example | Unfade Implementation |
|---|---|---|---|
| **Output Virality** | Product outputs carry the brand into external channels | Loom videos, Canva designs, Spotify Wrapped | Unfade Cards, Monthly Wrapped, README badges |
| **Progression & Streaks** | Loss aversion + visible progress create daily retention | Duolingo streaks, GitHub contribution graph | Reasoning Streak, phase upshift celebrations |
| **Identity Signaling** | Visible competence signals others want to acquire | GitHub contributions, Stack Overflow reputation | Public vehicle profile, phase badges, domain mastery |

These engines compound: progression creates milestones → milestones trigger shareable outputs → shared outputs signal identity → identity attracts new users → new users start progressing.

---

## 4. Engine 1: Output Virality

**Core principle:** Every product output that leaves Unfade carries the brand with it. When a Loom user shares a video, the viewer sees Loom. When an Unfade user shares a card, the viewer sees Unfade.

### 4.1 Unfade Card v2

The Unfade Card is the primary viral artifact — a visually striking, data-rich summary of a developer's reasoning identity.

**Card contents:**
- Vehicle phase badge (Bare Engine → Tuned Vehicle) with phase-specific color
- Radar chart of 4 dimensions: Steering, Track Knowledge, Ground Speed, Vehicle Maturity
- Top 3 domains with mastery level (e.g., "Infrastructure: Deep", "Auth: Moderate")
- Reasoning streak (consecutive days with captured reasoning)
- Total decisions captured (lifetime)
- Watermark: `unfade.dev/cards/{username}`

**Share targets:**
- One-click export as image (PNG/SVG) — optimized for Twitter/X and LinkedIn aspect ratios
- Copy-to-clipboard as image
- Direct share to Twitter/X with pre-filled text: "My developer vehicle: [Phase]. [Streak]-day reasoning streak across [N] projects. unfade.dev"
- Card URL with `og:image` metadata — pasting the link anywhere renders a rich preview

**Design principles:**
- Visually distinctive — not another boring metric card. Bold phase colors, clean type, recognizable at thumbnail size
- Information-dense but scannable — a developer should understand their peer's card in 3 seconds
- Phase badge is the visual anchor — the first thing you see is the vehicle phase

### 4.2 Monthly Wrapped

A recurring share trigger inspired by Spotify Wrapped and GitHub Wrapped.

**Generated automatically at month-end. Contains:**
- Month's highlight: biggest upshift, longest streak, most active domain
- Comparison to previous month: "Your steering improved 15% — infrastructure acceptance rate dropped from 90% to 75%"
- Total: decisions captured, sessions, domains touched, cost
- A narrative sentence: "This month you moved from Bare Engine to First Gear. Your biggest shift: you started modifying AI output in infrastructure instead of accepting it wholesale."
- Share-ready format: single card image + URL with og:image

**Why monthly, not annual:**
- Annual is too infrequent — users who install mid-year never see a Wrapped
- Monthly creates 12 share moments per year instead of 1
- Monthly aligns with how developers think about progress (sprints, monthly reviews)

### 4.3 Milestone Cards

Auto-generated at specific achievement moments:
- **Streak milestones**: 7, 30, 90, 180, 365 days
- **Phase upshifts**: Bare Engine → First Gear, etc.
- **Domain milestones**: "Deep mastery" reached in a domain
- **Decision milestones**: 100, 500, 1000 decisions captured

Each milestone generates a mini-card with a share prompt. The prompt is dismissable — never forced.

---

## 5. Engine 2: Progression & Streaks

**Core principle:** Loss aversion and visible progress create daily retention. Duolingo's streaks increase commitment by 60%. Users who maintain a 7-day streak are 3.6x more likely to stay engaged long-term.

### 5.1 Reasoning Streak

A count of consecutive days where the user has captured reasoning (git commits, AI sessions, terminal activity with capture running).

**Critical design decision: the streak is passive.** Unlike Duolingo where you must actively practice, Unfade streaks reward normal work. If you code with capture running, your streak continues. No extra action required. This is essential for developer tools — developers will not perform busywork to maintain a badge.

**Display:**
- Sidebar: small flame icon + day count, always visible
- Home page: prominent streak card with current count + personal best
- Dashboard: sidebar streak display (always visible)

**Streak mechanics:**
- A "day" counts if at least 1 captured event exists (any source: git, AI, terminal)
- Streak freeze: if the user misses a single day, the streak pauses (not broken). Resumes on next activity. This is generous by design — weekends and vacation shouldn't kill a streak.
- Extended absence (3+ days): streak resets, but "longest streak" is preserved as a historical best.
- The freeze is automatic, not a purchasable item (this isn't a monetization mechanic — it's a retention mechanic)

**Psychology:**
- Loss aversion: "I have a 23-day streak, I don't want to lose it" → keeps capture running
- Visible progress: the number going up creates a micro-reward loop
- Social proof: "47-day streak" on a shared card signals consistency

### 5.2 Phase Upshift Celebrations

When a user transitions between maturity phases (computed from real data, not arbitrary thresholds), the product acknowledges it.

**Celebration design:**
- A brief, non-blocking modal/banner: "Upshift: You've reached First Gear. Your drivetrain is engaging."
- The phase badge in the sidebar updates with a brief animation
- A shareable milestone card is generated (see §4.3)
- Share prompt (dismissable): "Share your upshift?"

**Phase downshift handling:**
- No celebration, obviously. Instead, a diagnostic notification: "Downshift detected: Multi-Gear back to First Gear. Your recent sessions show lower steering precision in [domain]. Check your vehicle diagnostics for details."
- Framed as mechanical feedback, not punishment: "Something is creating friction — check your steering in recent sessions."

### 5.3 Weekly Reasoning Pulse

A lightweight weekly summary (not as elaborate as Monthly Wrapped) that surfaces one actionable insight:
- "This week: 12 decisions captured, 4 domains active, streak at 31 days. Your steering tightened in auth (acceptance rate dropped from 80% → 65%). Next challenge: infrastructure is still on autopilot."
- Delivered in-app (not email — developers hate email from tools) as a home page card on Monday
- Short enough to screenshot and share, detailed enough to be useful

---

## 6. Engine 3: Identity Signaling

**Core principle:** Developers signal competence through their tools and their outputs. GitHub contributions, Stack Overflow reputation, and open-source maintainership are all identity signals. Unfade creates a new signal: reasoning maturity.

### 6.1 Public Vehicle Profile

An optional public page at `unfade.dev/u/{username}` showing:
- Vehicle phase + phase history (when did they reach each phase)
- Dimension radar: Steering, Track Knowledge, Ground Speed, Vehicle Maturity
- Top domains with depth indicators
- Reasoning streak (current + personal best)
- Total decisions captured
- A narrative: "This developer is in Multi-Gear. They steer with precision in auth and infrastructure, with deep track knowledge across 4 domains. 90-day reasoning streak."

**Privacy model:**
- 100% opt-in. Nothing is public until published from the dashboard
- The user controls what's visible (e.g., show phase but hide domains)
- All data is computed locally — the public profile is a snapshot, not a live feed
- No login required to view (reduces friction for viewers → higher conversion)

**Why this works:**
- Hiring signal: "This candidate is Phase 3 with deep auth reasoning" is more meaningful than "contributed to 47 repos"
- Peer signal: developers share profiles in team channels, README files, conference talks
- Self-documentation: the profile is a personal record of reasoning growth

### 6.2 README Badge

A dynamic SVG badge for GitHub README files:

```markdown
[![Unfade](https://unfade.dev/badge/{username})](https://unfade.dev/u/{username})
```

Renders as: `[Unfade: Multi-Gear | 47-day streak]`

**Design:**
- Matches the visual style of existing README badges (shields.io-like format)
- Shows vehicle phase + streak count
- Links to public profile
- Updates automatically (cached, refreshed daily)

**Why badges work:**
- Persistent visibility — the badge is seen every time someone visits the repo
- Low friction — add one line to README
- Social proof — when multiple developers in a community have Unfade badges, it normalizes the tool

### 6.3 Dashboard Identity Summary

The Home page shows a compact identity summary:

```
Multi-Gear (Phase 3) | 47-day streak | 312 decisions
Steering: 72% | Track: 68% | Speed: 81% | Maturity: 65%
Top: auth (Deep), infrastructure (Moderate), database (Emerging)
```

This is designed to be:
- Screenshot-friendly for developer tweets/posts
- Glanceable overview of current state
- Embeddable in CI/CD output or team dashboards (via API)

### 6.4 Publish Enhancement

The dashboard's Publish action generates a static site. Enhanced version:
- Generates public profile page (§6.1)
- Generates README badge (§6.2)
- Generates og:image card for link previews
- Generates the latest Unfade Card (§4.1)
- Outputs: "Published to unfade.dev/u/{username}. Badge: [markdown snippet]. Card: [image URL]."
- Single command, zero config

---

## 7. The Viral Loop

The three engines connect into a self-reinforcing loop:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Developer installs Unfade                              │
│  (free, passive, local-first, zero behavior change)     │
│              │                                          │
│              ▼                                          │
│  Works normally — capture runs in background            │
│              │                                          │
│              ▼                                          │
│  Streak builds → phase progresses → diagnostics appear  │
│  (Engine 2: Progression)                                │
│              │                                          │
│              ▼                                          │
│  Hits milestone (streak / phase upshift / domain depth) │
│              │                                          │
│              ▼                                          │
│  Gets shareable artifact (card / badge / wrapped)       │
│  (Engine 1: Output Virality)                            │
│              │                                          │
│              ▼                                          │
│  Shares to Twitter / LinkedIn / README / team chat      │
│  (Engine 3: Identity Signaling)                         │
│              │                                          │
│              ▼                                          │
│  Peer sees artifact → curiosity gap                     │
│  ("What's Multi-Gear?" / "What's Unfade?")              │
│              │                                          │
│              ▼                                          │
│  Peer visits unfade.dev → installs                      │
│              │                                          │
│              ▼                                          │
│  Loop restarts                                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### K-Factor Amplifiers

These elements increase the number of new users each existing user generates:

1. **Curiosity gap**: Vehicle phases are unusual — "Multi-Gear" on a badge makes people click to understand
2. **Zero behavior change**: The install-to-value gap is tiny (install → work normally → value appears). Low barrier = higher conversion from curious viewer to active user
3. **Privacy-first removes trust friction**: "All data stays local" eliminates the biggest objection to developer tools that capture activity
4. **No account required to start**: Install, run `unfade`, work. Account only needed if you want to publish publicly. This follows the Duolingo model — 80% of their users arrive organically
5. **Cross-tool value**: Unfade works across Claude Code, Cursor, Aider, terminal — it's not locked to one ecosystem. Every AI tool user is a potential Unfade user

### Viral Coefficient Target

- **K > 1.0** means each user generates more than one new user (exponential growth)
- Realistic target: **K = 0.3–0.5** in the first year (sub-viral but with strong organic growth)
- The goal is not "go viral overnight" but "compound steadily" — matching Unfade's core value proposition (reasoning that compounds over time)

---

## 8. Anti-Patterns: What We Don't Do

### 8.1 No Leaderboards

Developers hate being ranked against strangers. Public leaderboards create anxiety, not engagement. Competition is with yourself (streak, phase progression), not with others.

### 8.2 No Social Features

Unfade stays local-first. There is no feed, no following, no comments. Sharing is opt-in, outbound only. The product is fully useful in complete isolation.

### 8.3 No Dark Patterns

- Streak freezes are automatic and generous — no purchase required
- Phase downshifts are explained diagnostically, never punitively
- No features are locked behind sharing
- No "invite friends to unlock" gates
- No notification spam (weekly pulse is in-app only, dismissable)

### 8.4 No Forced Sharing

Every share prompt has a clear, prominent dismiss button. The product is 100% functional without ever sharing anything. Sharing is a natural outcome of pride in progress, not a requirement for features.

### 8.5 No Vanity Metrics

Every number shown has an interpretation (R-1 compliance). We never show a big number just because big numbers feel good. "312 decisions" is always accompanied by what that means in context.

### 8.6 No Email Marketing

Developers delete tool emails. All engagement happens in-app or in the terminal. The only outbound communication is the weekly reasoning pulse (in-app card) and milestone notifications (in-app banner).

---

## 9. Feature Inventory

### Priority 1: Highest retention impact, lowest effort

| Feature | Description | Viral Engine | Effort |
|---|---|---|---|
| **Reasoning Streak** | Consecutive days with captured reasoning. Sidebar + Home display. | Progression | Small |
| **Phase upshift celebration** | Banner + shareable card on phase transition | Progression + Output | Small |
| **Streak counter** | Dashboard sidebar shows streak | Identity | Trivial |

### Priority 2: Primary viral artifacts

| Feature | Description | Viral Engine | Effort |
|---|---|---|---|
| **Unfade Card v2** | Rich card with phase, radar, streak, domains, share buttons | Output | Medium |
| **Share targets** | One-click export to Twitter/X, LinkedIn, clipboard | Output | Medium |
| **Streak milestones** | Auto-generated cards at 7/30/90/180/365 days | Progression + Output | Small |

### Priority 3: Persistent ecosystem presence

| Feature | Description | Viral Engine | Effort |
|---|---|---|---|
| **README badge** | Dynamic SVG showing phase + streak | Identity | Medium |
| **Public profile** | `unfade.dev/u/{username}` with full vehicle profile | Identity | Large |
| **Publish v2** | Dashboard action: generates profile + badge + card + og:image | Identity + Output | Medium |

### Priority 4: Recurring engagement

| Feature | Description | Viral Engine | Effort |
|---|---|---|---|
| **Monthly Wrapped** | Auto-generated monthly recap card | Output | Medium |
| **Weekly Reasoning Pulse** | Home page card with one actionable insight | Progression | Small |
| **Phase downshift diagnostics** | Constructive notification on regression | Progression | Small |

---

## 10. Adoption Funnel Design

### Stage 1: Awareness (Peer sees artifact)

**Trigger:** Unfade Card on Twitter, badge on README, profile link in Slack
**Goal:** Curiosity → click to `unfade.dev`
**Design:** Artifacts must be visually distinctive and create a curiosity gap. "Multi-Gear" is unusual — people will click to understand.

### Stage 2: Interest (Visitor on unfade.dev)

**Trigger:** Landed on `unfade.dev` from artifact link
**Goal:** Understand what Unfade does → install
**Design:**
- Hero: "Your AI tools are powerful. Are you steering them?" (direct Thesis framing)
- Show an example Unfade Card with vehicle phase explanation
- Installation: single command (`curl -fsSL unfade.dev/install | sh` or `npm i -g unfade`)
- Emphasize: passive, local-first, zero behavior change, works with any AI tool

### Stage 3: Activation (First value moment)

**Trigger:** User runs `unfade` for the first time
**Goal:** See value before any configuration
**Design:**
- Auto-discover repos (existing feature)
- Start capture immediately (existing feature)
- Show first diagnostic within 24h: "You captured 8 events today. Your vehicle assessment will be ready after 3 more sessions."
- Display streak counter from day 1 (even "1-day streak" creates the loss-aversion hook)

### Stage 4: Retention (Daily engagement)

**Trigger:** Streak builds, diagnostics appear, phase progresses
**Goal:** Keep capture running, check dashboard periodically
**Design:**
- Streak counter is passive — reward normal behavior
- Diagnostics become more specific and actionable as data accumulates
- Weekly pulse gives a reason to check in
- Phase progression gives long-term goal

### Stage 5: Referral (Share trigger)

**Trigger:** Milestone achieved (streak, phase upshift, domain depth)
**Goal:** Share artifact → attract new user
**Design:**
- Celebration moment with pre-generated card
- One-click share to social platforms
- Share prompt is brief, non-blocking, dismissable
- The artifact is interesting enough that people share it for status, not because we asked

---

## 11. Metrics & Success Criteria

### Adoption Metrics

| Metric | Target (6 months) | Why It Matters |
|---|---|---|
| Weekly active users (capture running) | Growth | Core engagement |
| D7 retention (% users active 7 days after install) | > 40% | Streak mechanic validation |
| D30 retention | > 25% | Progression mechanic validation |
| Streak distribution | Median > 7 days | Loss aversion working |
| Phase progression rate | 30%+ users reach Phase 2 within 30 days | Maturity model engagement |

### Virality Metrics

| Metric | Target (6 months) | Why It Matters |
|---|---|---|
| K-factor (new users per existing user) | > 0.3 | Viral loop functioning |
| Cards shared per month | Growth | Output virality working |
| README badges deployed | Growth | Persistent ecosystem visibility |
| unfade.dev traffic from social | > 30% of total | Organic discovery from shared artifacts |
| Install conversion from unfade.dev | > 15% | Landing page + value prop working |

### Engagement Metrics

| Metric | Target | Why It Matters |
|---|---|---|
| Monthly Wrapped generation rate | > 80% of 30+ day users | Recurring share trigger |
| Share rate on milestones | > 10% | Artifacts are worth sharing |
| Phase upshift celebration → share | > 15% | Natural share moment |
| Dashboard visit frequency | 2+ per week | Product is useful, not just a badge generator |

---

## Research Sources

- Lakoff, G. & Johnson, M. — *Metaphors We Live By* (conceptual metaphor theory)
- CHI 2025 ProductMeta study — design metaphors in product UX
- Technology Acceptance Model (TAM) — perceived usefulness as adoption driver
- ABB Developer Tools Study — gamification increases developer engagement by ~47%
- Duolingo Case Study 2025 — streaks increase commitment by 60%, 7-day streak users 3.6x more likely to stay engaged, 80% organic user acquisition
- Alan Cooper — "The Myth of Metaphor" (risks of extended metaphors in UI)
- GitHub Wrapped 2025 — shareable annual developer recap (output virality pattern)
- Spotify Wrapped — the definitive shareable recap mechanic
- Loom/Canva virality research — output virality and brand-carrying artifacts
- Product-Led Growth research (2025-2026) — viral coefficient mechanics, organic growth loops
- SSRN: Impact of Gamification on Word-of-Mouth — badges/levels signal competence and drive sharing
- SlopCodeBench (March 2026) — AI agents degrade quality in 80-89.8% of trajectories (validates the Thesis problem statement)

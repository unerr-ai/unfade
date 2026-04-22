# The Transmission Thesis

## The Analogy

Coding agents have arrived as potent motor engines — high-horsepower, freshly launched, and genuinely powerful. Claude Code, Cursor, Aider, Codex — these are not toys. They produce real output at real speed.

Codebases are the tracks. Every team has a different one: different terrain, different curves, different history, different hazards. No two tracks are alike.

Developers are the drivers. They have been handed these engines and told: "Build your vehicle. Race your track. Hit your objectives."

**The problem: there is no vehicle.**

There is no chassis, no transmission, no steering column, no suspension. Developers are bolting jet engines directly to wheels, pointing them at their track, and hoping. Some are experienced enough to rig something that mostly holds together. Most are not.

The result is predictable:
- **Wheels spin** — AI generates volumes of code that doesn't fit the codebase (AI slop)
- **The vehicle fishtails** — regressions, inconsistency, architectural drift
- **The driver loses control** — they stop directing and start accepting whatever the engine produces
- **The track gets torn up** — the codebase degrades under uncontrolled output

And the industry's response? **Hire track cleaners.** Linters, AI code review tools, slop detectors, formatting bots — all of them operate *after* the damage is done. Nobody is questioning why the vehicle doesn't have a transmission. Nobody is even telling the driver that their vehicle is incomplete.

### What is missing, precisely

**A transmission** — the mechanical system that converts raw engine horsepower into controlled wheel speed appropriate for the current terrain. In software terms: the system that converts raw AI generation capability into controlled, directed output that fits the specific codebase, context, and objective.

**Steering** — the ability to direct where the power goes. Not just "generate code" but "generate *this specific thing* in *this specific way* for *this specific reason*." In software terms: context injection, constraint specification, decision history awareness.

**A dashboard** — instruments that tell the driver what their vehicle is actually doing. Not "engine RPM" (tokens generated) but "ground speed" (useful output), "fuel efficiency" (cost per decision), "tire grip" (how well output fits the codebase), and "heading" (are you going where you intended).

**A vehicle diagnostic system** — something that tells the driver: "Your transmission only has two gears. Your steering pulls left in infrastructure code. Your suspension bottoms out on complex refactors. Here is what to fix and how."

### What the market currently looks like

| Component | Market Status | Examples |
|-----------|--------------|---------|
| **Engines** | Oversupplied. Every major AI company shipping coding agents. | Claude Code, Cursor, Aider, Codex, Copilot, Windsurf, Devin |
| **Track cleaning** | Growing. Post-hoc cleanup of AI output. | Linters, AI code review, slop detectors, formatting bots |
| **Transmission** | **Zero products.** Nobody is building the drivetrain. | — |
| **Driving telemetry** | Unfade is the only product. But only the retrospective half. | Unfade (current) |
| **Vehicle diagnostics** | **Zero products.** Nobody tells the driver what's wrong with their vehicle. | — |

The gap is not engines. The gap is everything between the engine and the road.

---

## Where Unfade Sits Today

Unfade, as built, is the **telemetry system and dashcam** for the vehicle. It captures:

- **How fast you went** — velocity tracker measures turns-to-acceptance per domain, detects acceleration/deceleration trends
- **How much fuel you burned** — cost attribution tracks token spend by model, domain, and branch; computes waste ratios for low-direction sessions
- **Where you spun out** — loop detector finds 3+ similar low-direction sessions on the same approach (stuck in the same corner)
- **Your driving patterns over time** — reasoning profile builds a picture of decision style, domain depth, trade-off preferences, identity labels
- **A highlight reel of your day** — daily distill synthesizes the day's reasoning into narrative with decisions, trade-offs, dead ends, breakthroughs
- **What your driving style is** — prompt patterns analyzer shows which prompting strategies produce high-direction outcomes in which domains
- **Blind spots on the track** — blind spot detector flags sustained low-comprehension areas and declining-direction trends

This is genuinely valuable. No other product captures the reasoning layer. But it is **retrospective telemetry**, not **forward-looking diagnostics**.

The dashcam records the crash. It doesn't prevent it.

---

## What Unfade Should Also Tell Them

### 1. "What phase of vehicle construction are you in?"

Most developers do not know they are building a vehicle. They think they are "using an AI tool." They don't realize there is construction work to do — that effective AI collaboration requires building a system around the engine, not just turning the key.

Unfade has the data to compute a **collaboration maturity model**. The signals already exist across the 8 analyzers and the reasoning profile:

**Phase 1: Bare Engine (No Transmission)**
- HDS consistently below 0.3 — the engine runs, the driver watches
- AI acceptance rate above 85% with low modification depth — accepting output verbatim
- No context reuse — re-explaining the same things across sessions
- No CLAUDE.md or equivalent context files
- The vehicle "moves" but the driver has no control over where

**Phase 2: First Gear (Basic Transmission)**
- HDS climbing to 0.3-0.5 — the driver is starting to steer
- Context files exist but are generic
- Some prompt patterns emerging — the driver is learning what inputs produce useful output
- Modification rate climbing — the driver edits AI output instead of accepting wholesale
- The vehicle can go straight but turns are rough

**Phase 3: Multi-Gear (Functional Drivetrain)**
- HDS averaging 0.5-0.7 — collaborative, directed interaction
- Context injection working — MCP queries returning relevant prior decisions, reducing re-explanation
- Domain-specific prompt patterns established — the driver knows what works in which terrain
- Low loop rate — when stuck, the driver recognizes it and changes approach
- The vehicle handles most terrain but struggles on the hardest sections

**Phase 4: Tuned Vehicle (Optimized System)**
- HDS above 0.6 with high consistency — the driver directs with precision
- High context leverage — prior reasoning is actively reused, compounding
- Low cost-per-directed-decision — maximum output per token spent
- Velocity accelerating — turns-to-acceptance dropping as the system learns
- The vehicle is fast, controlled, and efficient on this specific track

**What this enables**: A single assessment — "You are in Phase 2. Your vehicle has an engine and first gear, but your steering is loose and you have no mirrors. Here is what Phase 3 looks like and what you need to build to get there."

### 2. "Here are your steering problems"

Not abstract metrics. Specific mechanical diagnoses:

**"Your steering is loose in infrastructure code"**
You accept 90% of AI output without modification in infrastructure. In authentication code you modify 60%. The vehicle pulls hard to one side — you're directing in some domains but auto-piloting in others. This means your infra code is accumulating decisions you didn't actually make.

**"You're not using your mirrors"**
Context injection via MCP is available but you re-explain your authentication approach from scratch every 3rd session. The rear-view mirror (your reasoning history) exists but you are not looking at it. Each session starts from zero when it could start from your last known position.

**"Your gear shifts are rough"**
When you switch from planning to implementing, your AI efficiency drops 40%. The transition between execution phases has no clutch — you go from high-direction planning prompts to low-direction "just do it" implementation prompts. The engine revs but the wheels don't grip.

**"You're redlining in 2nd gear"**
Your prompts in the database domain are long, specific, heavily constrained (high effort) but your acceptance rate is only 30%. You are working extremely hard at steering but the gearing is wrong for this terrain. The prompting strategy that works for UI code is not working for database code.

**"Your suspension bottoms out on refactors"**
Complex multi-file changes have a 3x higher loop rate than single-file changes. Your vehicle handles simple terrain but the suspension cannot absorb complexity. You need a different approach (decomposition, incremental changes) for rough terrain.

**"You're drafting without knowing it"**
You follow the same patterns as your AI tool's defaults. Your decision style shows low alternatives-evaluated in areas where the AI has strong opinions. You think you are driving but you are drafting — the air resistance is low because you are going exactly where the engine wants to go.

### 3. "Here is what to build next"

Prescriptive, specific, based on actual data:

- "Adding a CLAUDE.md with your 12 most-referenced auth decisions would improve your context leverage from 30% to an estimated 60%. That is like adding 3rd and 4th gear."
- "Your effective prompt pattern in auth (schema references + constraints) has a 45% direction lift. Applying it to your infrastructure prompts — where you currently auto-pilot — could cut your loop rate in half."
- "You have 3 decision replays pending — past decisions that contradict your current approach. Reviewing them before your next session would be like checking the map before entering an unfamiliar section of track."

---

## The Product Evolution This Implies

### Current state: Driving Telemetry
```
Capture → Materialize → Analyze → Report
"Here is how you drove today"
```

### Next state: Vehicle Diagnostics + Build Guide
```
Capture → Materialize → Analyze → Diagnose → Prescribe
"Here is your vehicle. Here is what is broken. Here is what to build next."
```

The shift is from:
- **Retrospective** ("your AES was 67 today") → **Diagnostic** ("your transmission slips in these situations because of this mechanical reason")
- **Metric-centric** ("Direction: 67%") → **Narrative-diagnostic** ("your steering is precise in auth but loose in infra — here is why and what to do")
- **Dashboard** (instruments you read) → **Mechanic** (a system that reads the instruments for you and tells you what they mean)

### What this requires architecturally

The data already exists. The 8 analyzers already compute direction, context leverage, modification depth, prompt patterns, blind spots, loops, velocity, cost. The profile already tracks patterns, domain depth, decision style.

The missing piece is a **synthesis layer** — something that reads all 8 analyzer outputs + profile + distill history and produces:

1. **A maturity assessment**: "You are in Phase 2. Here is the evidence."
2. **A diagnostic report**: "These are your 3 most impactful steering problems, ranked by how much they cost you."
3. **A build prescription**: "Do these 2 things this week to move toward Phase 3."

This is not 8 separate screens showing 8 separate metrics. It is one narrative that synthesizes everything into "the state of your vehicle."

---

## Why This Matters Beyond Individual Developers

If Unfade can assess vehicle maturity for one developer, it can assess it for a team. Imagine:

- "Your team is averaging Phase 2.3. Two engineers are in Phase 3 (strong steering, good context reuse). Three are in Phase 1 (bare engine, no transmission). The team's collective AI efficiency would improve 40% if the Phase 1 engineers adopted the prompt patterns that the Phase 3 engineers already use."

- "Your organization spends $X/month on AI coding tools. 60% of that spend happens in low-direction sessions (engine running, no steering). The transmission gap costs you $Y/month in wasted tokens and Z hours/month in loop time."

This turns Unfade from a personal telemetry tool into an organizational capability assessment. The question stops being "how is my AI tool performing?" and becomes "how mature is my team's ability to direct AI tools?" — which is the question every engineering leader should be asking but has no data to answer.

---

---

## Unerr: What It Actually Offers

Unerr positions itself as "Lifecycle Intelligence for AI-Built Software" — sustainable velocity, not just generation speed. Having read the full architecture and product docs, here is what concretely exists and what it does:

### The 4 Core Capabilities

**1. Blueprint (Architectural Deep Dive)**
- `unerr plan` / `unerr_deep_dive` MCP tools
- Web-research-informed architecture planning — not just "plan from what you know" but "plan from what the industry knows"
- Outputs vertical-sliced implementation plans connected to health trajectory
- CozoDB knowledge graph (5-signal causal substrate) stores architectural understanding persistently
- Community Detection via Louvain algorithm — discovers natural code communities and their relationships
- "Immunity starts at design" — the architecture plan already includes quality constraints

**2. Immune System (Rules Engine)**
- JIT rule filtering — rules applied at the right moment, not all at once
- Push-based violation enforcement — violations caught as they happen, not after commit
- Auto-remediation — some violations fixed automatically
- STAGED dry-run mode — test rules before enforcing
- Exception TTL — temporary exemptions that expire
- Dynamic tool injection — MCP tools adapt based on what rules are active
- Rule telemetry — tracks which rules fire, which get overridden, which prevent real problems
- Butter-Sync SSE — real-time rule state synchronization

**3. Guardian (Health & Quality)**
- 16 health/quality features shipped
- Health scoring with trajectory tracking — not just "your codebase is healthy" but "it's getting healthier/sicker over time"
- Drift detection via overlay snapshots — per-branch drift measurement
- PR review integration
- Doc verification — checks if documentation matches actual code
- CI gate (`unerr manifest check`) — fails the build if health drops
- Code quality signals fed into prompt context enrichment

**4. Evolution Engine**
- Scale gap analysis — "your codebase works at current scale but here's what breaks at 10x"
- Vertical-sliced migration plans — not "rewrite everything" but "migrate this slice, then this slice"
- Agent-guided execution — the migration plan is executable by AI agents
- Health trajectory tracking during evolution — ensures the cure isn't worse than the disease

### The Infrastructure Layer

**Shadow Ledger** — 30-second correlation window for intent-to-commit attribution. When a developer prompts an AI tool and then commits code, the Shadow Ledger links the intent (prompt) to the outcome (commit). Three-layer telemetry: Shadow Ledger → Git Notes → Ledger Flush.

**Prompt Ledger / Rewind** — Working snapshots with deterministic rewind. Timeline view of all AI interactions. Hallucination loop circuit breaker — detects when AI is generating in circles.

**22 MCP Tools** across 6 categories:
- Pre-flight (before AI generation): context loading, constraint specification, rule awareness
- Post-flight (after AI generation): quality check, health impact, violation scan
- Exploration: codebase understanding, community detection, dependency mapping
- Ledger/Rewind: prompt history, snapshot management, causal bridge queries
- Architecture Deep Dive: structure analysis, pattern detection, debt measurement
- Prompt Intelligence: context enrichment, effective pattern injection

**Local-First Intelligence Proxy** — 9 local tools resolve 80% of calls in <5ms without cloud. Five-mode degradation (FULL → LOCAL → PARSE → BOOTSTRAP → SETUP). BYO-LLM support (Ollama, LM Studio, OpenAI-compatible).

**Correction Learning** — Error-to-fix detection from Shadow Ledger using Jaccard similarity. When the same kind of error gets fixed the same way multiple times, Unerr learns the correction pattern and can apply it automatically.

---

## Mapping to the Vehicle Analogy: What Each Product IS

### Unerr = The Vehicle Factory + Maintenance Shop

Unerr's capabilities map precisely to vehicle construction and maintenance:

| Vehicle Component | Unerr Capability | What It Does |
|-------------------|-----------------|--------------|
| **Vehicle blueprint** | Blueprint / Deep Dive | Designs the vehicle before you build it. "For your track (codebase), you need this chassis (architecture), this suspension (error handling), this steering geometry (API design)." Web-research-informed means it learns from every track ever built, not just yours. |
| **Structural frame / chassis** | CozoDB knowledge graph | The persistent understanding of how the vehicle is built. Not just files and functions but the *relationships* — what depends on what, what communities exist, where the load-bearing structures are. |
| **Guardrails / lane-keeping** | Immune System (Rules Engine) | Prevents the vehicle from leaving the track. JIT rule filtering = guardrails that deploy exactly where the track curves. Auto-remediation = automatic course correction when the vehicle drifts. Push-based enforcement = the guardrails are *on the track*, not in a review meeting after the crash. |
| **Vehicle inspection** | Guardian (Health & Quality) | Regular structural inspection. Health trajectory = "this weld is weakening over time." Drift detection = "your wheel alignment is off by 2 degrees on this branch." CI gate = "this vehicle does not pass inspection, it cannot race today." |
| **Upgrade system** | Evolution Engine | "Your vehicle handles city streets but will fail on the highway. Here's the upgrade plan: replace the suspension first (vertical slice 1), then the transmission (slice 2), then the engine mounts (slice 3). We'll check structural integrity after each step." |
| **Black box / flight recorder** | Shadow Ledger | Records everything that happened mechanically. Intent-to-commit attribution = "the driver turned the wheel at 2:14:03, the vehicle responded at 2:14:04, the resulting trajectory was X." 30-second correlation window links cause to effect. |
| **Rollback mechanism** | Prompt Ledger / Rewind | If an upgrade breaks the vehicle, rewind to the last known good state. Deterministic — not "try to undo" but "restore exactly." |
| **Pre-flight / post-flight check** | MCP pre-flight / post-flight tools | Before each run: check tire pressure (context loaded?), fuel level (constraints specified?), alignment (rules aware?). After each run: check for damage (quality regression?), measure wear (health impact?), log performance (ledger updated?). |
| **On-board computer** | Local-first intelligence proxy | Intelligence that runs ON the vehicle, not phoned in from a remote garage. 80% of diagnostic checks complete in <5ms. If the network dies, the vehicle still has brains. |
| **Track map** | Community Detection (Atlas) | Maps the terrain before you drive it. "This section of track (code community) is tightly coupled. This section is isolated. These two sections interact at this junction." |
| **Error memory** | Correction Learning | "Last time this part failed, this is how it was fixed." The maintenance shop remembers every repair and can apply known fixes automatically. |

### Unfade = The Driver Development Program

Unfade's capabilities map to understanding and improving the driver:

| Vehicle Component | Unfade Capability | What It Does |
|-------------------|------------------|--------------|
| **Driving telemetry** | 8 Intelligence Analyzers | Speed (velocity tracker), fuel efficiency (cost attribution), cornering (loop detector), lap times (efficiency/AES), terrain grip (comprehension radar) |
| **Driving style profile** | Reasoning Profile (ReasoningModelV2) | "This driver evaluates 2.3 alternatives before deciding. They're deep in auth, shallow in infra. They prefer simplicity over configurability. They modify AI output 60% of the time in security code." |
| **Race narrative** | Daily Distill | "Today you ran 142 laps. You chose JWT over sessions (decision). You hit a dead end on session sharing (dead end, 45min). You broke through when you realized stateless fits microservices (breakthrough)." |
| **Driving coach** | Prompt Patterns analyzer | "Your cornering technique (prompting strategy) works in auth curves but not infra straights. Adding schema references improves your line (direction) by 45% in auth." |
| **Blind spot detection** | Blind Spots analyzer | "You never check your left mirror (infra code). You've been auto-piloting there for 2 weeks. Your comprehension in that zone is dropping." |
| **Dashcam / instant replay** | Decision Replay analyzer | "3 weeks ago you decided X about this corner. You're approaching the same corner with a different plan. Want to see the tape from last time?" |
| **Rear-view mirror** | MCP context injection (7 tools) | When the driver enters a section of track they've raced before, the mirror shows: "Last time you were here, you decided X for reason Y." Prevents re-learning what was already learned. |
| **Driver identity card** | Unfade Cards + Reasoning Fingerprint | "This is who you are as a driver: Architectural Thinker, deep in auth/security, evaluates alternatives, 67% human-directed." Portable, shareable, compounding. |

---

## Together: Do We Have the Conveyor Belt?

### What the conveyor belt needs to produce

A functional vehicle = a developer who can effectively direct AI tools to produce high-quality output in their specific codebase.

The factory line:

```
[1. DESIGN]  →  [2. BUILD]  →  [3. INSPECT]  →  [4. DRIVE]  →  [5. IMPROVE]  →  [6. UPGRADE]
                                                      ↑                              |
                                                      └──────────────────────────────┘
```

### What each station provides

**Station 1: DESIGN — "What vehicle do you need?"**
- Unerr Blueprint: architectural deep dive, web-research-informed planning, vertical slicing
- Unerr Atlas/Community Detection: track mapping, terrain analysis
- **Coverage: STRONG.** This station exists and works.

**Station 2: BUILD — "Construct the vehicle correctly"**
- Unerr Immune System: rules enforced during construction (JIT, push-based)
- Unerr Pre-flight tools: context and constraints specified before each AI generation
- Unerr Knowledge Graph: structural memory of what's been built and how it connects
- **Coverage: STRONG.** The guardrails and quality enforcement are real-time, not after-the-fact.

**Station 3: INSPECT — "Is the vehicle sound?"**
- Unerr Guardian: health scoring with trajectory, drift detection, CI gate
- Unerr Post-flight tools: quality check after each AI generation
- Unerr Doc Verification: does the manual match the vehicle?
- **Coverage: STRONG.** Inspection is continuous, not periodic.

**Station 4: DRIVE — "How is the driver performing?"**
- Unfade Capture: passive recording of all driving activity (git, AI sessions, terminal)
- Unfade Intelligence: 8 analyzers measuring driving quality in real-time
- Unfade Distill: daily narrative of what happened and why
- Unfade MCP: rear-view mirror injecting prior reasoning into current sessions
- **Coverage: STRONG.** This is Unfade's core and no one else has it.

**Station 5: IMPROVE — "How does the driver get better?"**
- Unfade Prompt Patterns: what driving techniques work for this driver
- Unfade Blind Spots: where the driver isn't looking
- Unfade Decision Replay: lessons from past drives surfaced at the right moment
- Unfade Profile: compounding identity that grows with every drive
- **Coverage: MODERATE.** The data exists. What's missing is the synthesis into a maturity model and prescriptive guidance ("you're in Phase 2, here's how to reach Phase 3").

**Station 6: UPGRADE — "The vehicle needs to evolve"**
- Unerr Evolution Engine: scale gap analysis, migration planning, agent-guided execution
- Unerr Health Trajectory: ensures upgrades improve rather than degrade
- Unerr Correction Learning: applies known fixes automatically
- **Coverage: STRONG.** The upgrade path is planned, sliced, and health-tracked.

### The gap analysis — what's missing from the conveyor belt

**Gap A: The Transmission Itself (Real-Time Power Conversion)**

Both products operate *around* the AI generation moment — Unerr checks before and after, Unfade records and analyzes after. Neither product sits *inside* the generation loop converting engine power to wheel speed in real-time.

The closest things:
- Unerr's MCP pre-flight tools load context and constraints before generation
- Unerr's Immune System can catch violations during generation (push-based)
- Unfade's MCP context injection provides historical reasoning during sessions

But the true transmission — a system that dynamically adjusts the AI's output characteristics based on the specific codebase section, the developer's proven patterns, and the current architectural constraints — doesn't fully exist yet. The pre-flight/post-flight model is closer to "check the vehicle before and after each leg" than "continuously adapt gear ratios while driving."

**Gap B: The Maturity Assessment (Cross-Product)**

Neither product currently tells the developer: "Here is the state of your complete setup. Your vehicle (Unerr health score: B+), your driving (Unfade AES: 67, Phase 2), your combined effectiveness (you have guardrails but aren't using your mirrors)."

The maturity model from the earlier section lives in the gap between the two products. Unerr knows the vehicle state. Unfade knows the driver state. Nobody synthesizes them into "here's your total racing capability and what to improve first."

**Gap C: Cross-Product Feedback Loops**

The two products don't currently talk to each other. But they should:

- Unfade detects the driver auto-pilots in infrastructure code → Unerr could respond by tightening rules for infra, adding more pre-flight checks in that domain
- Unerr detects health declining in the auth module → Unfade could flag this in the daily distill with "your recent decisions in auth are correlated with declining health scores"
- Unfade's prompt pattern analysis discovers that schema-reference prompts work well → Unerr could auto-inject schema context into pre-flight for that domain
- Unerr's Correction Learning detects a recurring fix pattern → Unfade could surface this as a decision replay: "you keep fixing X the same way — should this be a rule?"

Without these loops, you have two good stations on the conveyor belt that don't pass parts to each other.

### The honest answer: Do we have the conveyor belt?

**80% yes.**

The major stations exist. Design (Unerr Blueprint), Build (Unerr Immune System), Inspect (Unerr Guardian), Drive (Unfade Capture + Intelligence), Upgrade (Unerr Evolution Engine) — these are real, built, and functional.

What's missing for the complete conveyor belt:

1. **The maturity synthesizer** — a cross-product assessment that tells the user "here's your complete setup, here's what's weak, here's what to build next." This is the Phase 1-4 model from the earlier section, but informed by BOTH products' data.

2. **Cross-product feedback loops** — Unfade driver insights informing Unerr vehicle configuration, and Unerr vehicle health informing Unfade driver assessment. Without these, the conveyor belt has stations that work independently but don't coordinate.

3. **Real-time transmission** — the system that sits inside the AI generation loop and continuously adapts. Pre-flight/post-flight is inspection at the start and end of each track section. Transmission is continuous adaptation *during* the section. This may be the hardest gap to close because it requires intercepting or augmenting the AI tool's generation process.

4. **A unified story** — right now Unerr and Unfade are separate products with separate positioning. Unerr says "lifecycle intelligence for AI-built software." Unfade says "engineering reasoning captured and compounding." The conveyor belt story is: "We give you everything between the engine and the road — the factory to build your vehicle, the telemetry to measure your driving, the mechanic to tell you what's broken, and the upgrade path to make it all better over time." That story doesn't exist yet as a unified narrative.

---

## The Positioning Opportunity

The market has engines (Claude Code, Cursor, Aider, Codex). The market has track cleaners (linters, review bots, slop detectors). The market has *nothing* in the space between engine and road.

If Unerr + Unfade together claim that space — "we are the drivetrain" — that is a category-creating position. Not competing with engines (you need an engine to drive). Not competing with cleaners (you still sweep the track). Occupying the space that nobody has built in.

The narrative:

> "AI coding tools are the most powerful engines ever built. But an engine without a transmission is just noise. Unerr builds the vehicle — architecture, guardrails, quality, evolution. Unfade develops the driver — reasoning capture, pattern detection, coaching, identity. Together, they are the complete drivetrain between AI power and engineering outcomes."

Or more concisely:

> "Engines are commoditizing. Tracks are unique. We sell the drivetrain."

---

## Open Questions

1. **Maturity model calibration**: The 4-phase model is a hypothesis. What are the actual thresholds? Do they vary by team size, codebase complexity, AI tool? Needs validation against real Unerr + Unfade usage data.

2. **Cross-product integration**: How do Unerr and Unfade communicate? Shared data layer? API calls? Shared MCP namespace? The architectural decision here determines whether the conveyor belt is one machine or two machines bolted together.

3. **The transmission gap**: Is real-time power conversion (sitting inside the AI generation loop) achievable? Or is the pre-flight/post-flight model the practical ceiling? Claude Code's hooks architecture and MCP tool injection may be the mechanism — but it requires the AI tool to call your tools during generation, which is a dependency on third-party behavior.

4. **Unified vs. separate products**: Is the conveyor belt one product ("Kap10 Platform: Unerr + Unfade") or two products that integrate? The PLG motion might be cleaner as one brand. But engineering complexity doubles. The market might understand "vehicle factory" and "driver coaching" as separate value props more easily than a combined "drivetrain" story.

5. **Which gap to close first?** The maturity synthesizer (narrative + assessment) is the easiest to build — it's a new intelligence layer that reads existing data. Cross-product feedback loops require integration work. Real-time transmission requires deeper architectural changes. The maturity synthesizer would also validate whether users actually want this framing before investing in the harder gaps.

6. **Scope discipline**: Unerr already has 22 MCP tools, 5 delivery tranches, ~95 shipped features. Unfade has 8 analyzers, 19 pages, 7 MCP tools. The conveyor belt framing risks becoming "add everything" when the real value might be in ruthless prioritization: what is the ONE cross-product feature that proves the drivetrain thesis?

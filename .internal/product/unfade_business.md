# Unfade: Business Playbook

> A founder's reference for how Unfade goes from open-source CLI to $1M ARR. No marketing language. Just evidence, numbers, and honest assessments.
>
> **Companion documents:**
> - [unfade.md](./unfade.md) -- What the product is and why it exists
> - [unfade_competitor_analysis.md](./unfade_competitor_analysis.md) -- Who else is in this space and where they fall short
> - [ADOPTION_AND_VIRALITY_PLAYBOOK.md](./ADOPTION_AND_VIRALITY_PLAYBOOK.md) -- Psychology and viral mechanics in detail
>
> **Last updated:** April 2026

---

## Table of Contents

- [1. The Business Case in One Page](#1-the-business-case-in-one-page)
- [2. What We Sell and Why People Pay](#2-what-we-sell-and-why-people-pay)
- [3. How Recent Open-Source Projects Grew Fast -- and What Actually Worked](#3-how-recent-open-source-projects-grew-fast----and-what-actually-worked)
- [4. Unfade's Growth Plan: Week by Week](#4-unfades-growth-plan-week-by-week)
- [5. The Open Source to Enterprise Transition](#5-the-open-source-to-enterprise-transition)
- [6. Revenue Model and Path to $1M ARR](#6-revenue-model-and-path-to-1m-arr)
- [7. Six Gaps That Become Revenue](#7-six-gaps-that-become-revenue)
- [8. Strategic Decisions and Why](#8-strategic-decisions-and-why)
- [9. Risks and Honest Problems](#9-risks-and-honest-problems)
- [10. Metrics That Matter](#10-metrics-that-matter)

---

## 1. The Business Case in One Page

**The problem.** Every developer using AI coding tools (Cursor, Claude Code, Copilot, Codex) faces the same issue: their AI starts from zero every session. Context is lost. Reasoning evaporates. Developers re-explain the same things daily. The result: wasted tokens ($3K-$13K/month for power users), wasted time (15+ minutes per session re-explaining), and a growing worry that they're becoming dependent on tools they can't control.

**The market.** 92% of developers use AI coding tools (JetBrains 2026). That's roughly 26 million developers worldwide. The AI coding tool market is projected at $14.1B by 2027. Every single one of those developers has the context amnesia problem. Zero tools solve it at the reasoning level.

**What Unfade does.** One command installs a passive capture engine that watches git, AI sessions, and terminal activity. It builds a compounding model of how you think -- your decision patterns, trade-off preferences, domain expertise, exploration habits. That model feeds into every AI tool you use via MCP, making them smarter about you. It also produces a visible identity (Thinking Graph, Unfade Cards) you can share.

**Why now.** Three things converged in early 2026: (1) MCP became the universal protocol for AI tool integration -- Unfade plugs into every MCP-compatible tool with zero custom work, (2) the "comprehension debt" conversation went mainstream after Addy Osmani's viral post and the Anthropic study showing 17% lower comprehension after 3 months of AI use, and (3) developers started asking "how do I prove I understand what I'm building?" with no answer available.

**The business model.** Free open-source core (capture, personalization, MCP server, local distill, local cards). Paid tiers for hosted identity, cloud features, and team dashboards. The PostHog model: give away the engine, monetize the cloud and the team layer.

**The target.** 50K GitHub stars in 4-6 weeks. 100K free users within 3 months. $1M ARR within 3-4 months from Pro + Team conversions.

---

## 2. What We Sell and Why People Pay

### The Free Layer (Open Source, Forever)

Everything that runs locally is free. This is non-negotiable -- developers won't trust a closed-source tool that captures their git history, AI sessions, and terminal activity.

What's included:
- Go capture daemon (git + AI sessions + terminal)
- Local materialization and intelligence pipeline (25 analyzers)
- MCP server (makes every AI tool aware of your reasoning history)
- Daily Distill with local LLM (Ollama or any OpenAI-compatible API)
- Comprehension Score (0-100)
- Local Unfade Card generation
- Self-hosted Thinking Graph
- Full `.unfade/` directory -- plain text, inspectable, exportable

### What People Pay For

| Feature | Why It's Worth Money | Who Pays |
|---|---|---|
| **Hosted identity** (`unfade.dev/username`) | Public Thinking Graph with og:image previews, link sharing, hiring signal | Individual developers building a career signal |
| **Cloud distill** | Frontier LLMs (Claude, GPT-4) produce higher-quality distillations than local Ollama | Developers who want the best output without managing local LLMs |
| **Cross-machine sync** | Your reasoning model follows you across laptop, desktop, work machine | Anyone with more than one dev machine |
| **Hosted card sharing** | Analytics on who viewed your cards, rich link previews on social platforms | Developers who share cards on LinkedIn/Twitter |
| **Team dashboards** | Aggregate comprehension scores, team reasoning patterns, onboarding narratives, manager views | Engineering managers, team leads |
| **SSO + admin controls** | Enterprise auth, audit logs, data policies | Companies with compliance requirements |
| **Onboarding narratives** | Dashboard reasoning history (filterable by project + timeframe) gives new hires a reasoning history of every decision | Any team that hires (this is the killer enterprise feature) |

### The Core Insight About Payment

People don't pay for capture. They pay for three things:

1. **Convenience** -- cloud distill and sync save setup time
2. **Identity** -- hosted profiles and cards with analytics are a career asset
3. **Team visibility** -- managers need to see if their teams are growing or just prompting

The free layer creates the habit. The paid layer amplifies the value. This is exactly how PostHog, Plausible, and Supabase work.

---

## 3. How Recent Open-Source Projects Grew Fast -- and What Actually Worked

### Case Study: Graphify (37.5K stars in ~4 weeks)

**What it does.** Turns any folder of code, docs, or media into a queryable knowledge graph. Works as a slash command inside Claude Code, Cursor, Codex, Gemini CLI, and 10+ other AI tools.

**What actually drove the growth:**

1. **Celebrity signal boost.** Andrej Karpathy tweeted about it. Result: 12K stars in 48 hours. This single event was the ignition. Without it, the project would likely have grown slowly. Lesson: one high-profile endorsement outweighs months of organic marketing.

2. **Multi-tool integration from day one.** By shipping as a slash command for every major AI coding tool simultaneously, they maximized their addressable audience. Every Claude Code user, every Cursor user, every Codex user could use it immediately.

3. **One-line install, instant visual output.** `uv tool install graphifyy && graphify install` -- no config, no API keys. Run it, get three artifacts: `graph.json`, `graph.html` (interactive visualization), `GRAPH_REPORT.md`. The visual output is inherently shareable.

4. **Social amplification cascade.** After the initial Karpathy tweet, reposts cascaded across X and LinkedIn. The README includes 25+ language translations, broadening international pickup.

5. **Rapid iteration.** Five versions (v0.5.0-v0.5.4) shipped quickly, keeping the repo active on GitHub Trending.

**What Unfade can learn:** The shareable visual artifact (interactive `graph.html`) is the closest parallel to Unfade Cards. But Graphify's growth was ignition-dependent (one tweet). Unfade needs structural virality that works without relying on a single celebrity endorsement.

### Case Study: RTK (38K stars in ~3 months)

**What it does.** CLI proxy that reduces LLM token consumption by 60-90% by filtering and compressing command output before it reaches your AI coding agent's context window. Single Rust binary, zero dependencies.

**What actually drove the growth:**

1. **Measurable, quantifiable value.** Every user can see exactly how many tokens they saved: "83.7% tokens saved, 24.6M tokens reclaimed." These are numbers people screenshot and share. Lesson: if your value is visible as a number, people share it without being asked.

2. **Zero-friction install.** `brew install rtk` or a one-liner curl. Works with 12 AI coding tools immediately. No config, no accounts, no API keys.

3. **Built-in virality mechanic.** `rtk gain` shows a personal savings dashboard with concrete dollar amounts. Users share these stats on Twitter organically. The product generates the marketing material automatically.

4. **Multi-channel launch.** Show HN post, Product Hunt launch, and Twitter amplification from notable developers sharing personal stats.

5. **README as conversion machine.** Opens with a before/after token comparison table, multiple one-liner installs, 100+ supported commands, compatibility table. No fluff, pure utility demonstrated visually.

6. **Performance credibility.** Built in Rust. "<10ms overhead" is believable. The name "Rust Token Killer" is memorable and searchable.

**What Unfade can learn:** The `rtk gain` command -- showing personal savings as shareable stats -- is directly transferable. Unfade needs an equivalent: a dashboard stats view showing "47 decisions captured, context auto-injected 12 times this week, estimated 3 hours of re-explanation saved."

### Case Study: Lovable (Fastest to $1M ARR in 2025-2026)

**What it does.** AI app builder (formerly GPT Engineer). Type a sentence, get a running web app.

**Growth numbers:** $0 to $10M ARR in 60 days. $100M ARR by July 2025. 500K apps generated in first 2 months.

**Why it grew so fast:** Every generated app was a billboard. Users shared their apps, and every app linked back to Lovable. The output WAS the marketing. No deliberate sharing required -- the product distributed itself through its outputs.

**What Unfade can learn:** This is the most important lesson. Unfade Cards, enriched PR descriptions, and enriched commit messages should all carry the Unfade brand passively. The product must market itself through normal usage, not through users deciding to share.

### Patterns Across All Three (RRVV Verified)

| Pattern | Graphify | RTK | Lovable | Unfade Plan |
|---|---|---|---|---|
| **Under 60 seconds to first value** | Yes (instant graph) | Yes (immediate token savings) | Yes (app in 45 seconds) | Yes (Reasoning Fingerprint from git history backfill) |
| **Zero config** | Yes (one command) | Yes (one command) | Yes (type a sentence) | Yes (`npx unfade-cli init`) |
| **Shareable output built in** | Yes (graph.html) | Yes (`rtk gain` stats) | Yes (deployed app URL) | Yes (Unfade Card + enriched PRs) |
| **Multi-tool reach** | Yes (10+ AI tools) | Yes (12 AI tools) | N/A (standalone) | Yes (every MCP-compatible tool) |
| **Growth ignition** | Celebrity tweet | HN + Product Hunt + dev tweets | Word-of-mouth from generated apps | HN + targeted dev communities + card sharing |

### Other Growth Benchmarks Worth Knowing

- **OpenClaw:** 9K to 210K stars in 10 days (Jan 2026). Driven by cultural meme (lobster mascot went viral in China), ultra-low barrier (runs on Raspberry Pi), and the agent-in-group-chat mechanic (every message the agent posts is a live demo). This is a once-in-a-decade outlier.
- **AFFiNE:** Documented playbook to 60K+ stars. Key tactic: wave-based launches -- seed 100-200 stars from your network, then fire all channels within a 48-hour window to trigger GitHub Trending.
- **Cursor:** ~25% AI code editor market share, $2B ARR by Feb 2026. Growth through superior DX in a familiar form factor (VS Code fork) + word-of-mouth from power users.
- **Devin:** $1M ARR (Sep 2024) to $73M ARR (Jun 2025). Viral demo video on Twitter drove initial awareness; enterprise sales closed the revenue.

---

## 4. Unfade's Growth Plan: Week by Week

### RRVV Validation of the Plan

Before laying out the plan, here's how each element was validated:

| Element | Research Source | Validation |
|---|---|---|
| Instant wow via backfill | Graphify, RTK, Lovable all deliver value in <60s | Every breakout project confirms sub-minute first value is mandatory |
| HN + Reddit multi-channel launch | AFFiNE playbook, RTK launch, general OSS research | Sequenced multi-channel launch within 48 hours triggers GitHub Trending |
| Shareable cards as viral artifacts | Spotify Wrapped (millions shared), GitHub Wrapped | Shareable identity artifacts drive organic distribution when they reflect genuine data |
| Multi-tool integration (MCP) | Graphify's success with 10+ tool integrations | Maximizing addressable audience via protocol-level integration works |
| Build-in-public pre-launch | Multiple 2025-2026 dev tool launches | Builds anticipation and seeds initial star count from followers |

### Pre-Launch (Days -7 to -1)

| Day | Action | Why |
|---|---|---|
| -7 | Start building in public on X. Daily progress screenshots showing the Reasoning Fingerprint output. | Builds anticipation. Every post seeds followers who will star on launch day. |
| -5 | Post your own Unfade Card with the caption "What's your reasoning fingerprint?" | Creates curiosity before the tool exists. Establishes the visual artifact in people's minds. |
| -3 | Record 30-second terminal GIF: `unfade` -> fingerprint -> card. | This GIF is the single most important launch asset. It IS the HN post. Repos with terminal GIFs in the first screenful get 4x more stars. |
| -2 | Seed 100-200 stars from personal network, dev friends, and beta testers. | Not fake stars -- real people who tried the beta. This seeds the GitHub Trending algorithm. |
| -1 | Write HN first comment draft. Prepare subreddit-specific angles. | HN posts live or die on first comment quality. Each subreddit needs a different angle. |

### Launch Week (Days 0-7)

| Day | Action | Target |
|---|---|---|
| **Day 0** | Show HN + X thread + r/programming | First 500-1,000 stars. HN title: "Show HN: Run one command, see how you think (open source reasoning fingerprint)" |
| **Day 1** | r/ClaudeCode ("Unfade MCP makes Claude remember how you think") + r/cursor ("stop re-explaining to Cursor every session") | AI tool communities. These are the highest-intent audiences. |
| **Day 2** | r/ExperiencedDevs ("How do you prove you understand what you build?") + DEV Community article | Identity and career angle. Hits the comprehension debt nerve. |
| **Day 3** | Indie Hackers + LinkedIn post targeting engineering managers | Team and hiring angle. "How do you know if your team is growing or just prompting?" |
| **Day 4** | Publish `unfade-memory` MCP skill on relevant registries | Every MCP user discovers Unfade through their tool ecosystem. |
| **Day 5** | "What's your reasoning fingerprint?" challenge on X | Viral loop activation. Users share their own cards. |
| **Day 7** | Respond to every issue. Ship 2-3 community-requested features. | Signals "this project is alive." Active maintainers keep GitHub Trending momentum. |

### Weeks 2-4: Sustaining Momentum

| Week | Expected Stars | What Drives It |
|---|---|---|
| **Week 2** | 5K-10K | HN residual traffic + Reddit cross-posts + early adopter tweets + Dev.to articles |
| **Week 3** | 15K-25K | YouTube tutorials emerge. "Reasoning Fingerprint" becomes a talking point. MCP ecosystem adoption. |
| **Week 4** | 25K-40K | Dev blog roundups. Newsletter mentions (TLDR, Bytes, JavaScript Weekly). Team adoption begins. First enterprise inquiry. |

### Critical Success Factors (Five Things That Must Be True)

1. **The Fingerprint must feel accurate.** "Deep Explorer who favors simplicity over flexibility" -- if the developer reads this and nods, you win. If they shrug, you lose. The heuristics for extracting reasoning patterns from git history (alternatives per decision, revert frequency, branch exploration depth, AI suggestion modification rate) must be tuned aggressively before launch. This is the single highest-priority engineering task.

2. **The Card must be beautiful enough to screenshot.** Dark theme, distinctive visual language, instantly recognizable at thumbnail size. Not a generic chart. Something that belongs in a portfolio or a tweet.

3. **The install must be copy-paste-enter.** `npx unfade-cli` and nothing else. No Ollama dependency for first run. No config files. No API keys. The Fingerprint comes from git history analysis, not LLM synthesis.

4. **The README must have a terminal GIF in the first screenful.** This GIF -- showing `unfade` -> fingerprint -> card -- is the single most important marketing asset. 15-20 seconds. Beautiful.

5. **Day 7 responsiveness must be flawless.** Every issue gets a response within hours. At least 2-3 community requests get shipped. This signals "alive project" and sustains GitHub Trending placement.

---

## 5. The Open Source to Enterprise Transition

### The Model: PostHog, Not Slack

PostHog's path: MIT-licensed open-source analytics -> generous free cloud tier (90%+ of companies use it free) -> usage-based billing on high-volume customers -> enterprise features (SSO, audit, permissions). They didn't gate core features behind payment. They let companies grow into paying customers naturally.

This is the right model for Unfade because:

1. **Trust is the bottleneck.** Unfade captures sensitive data (git history, AI sessions, terminal output). Developers will not install a closed-source tool that does this. Open source removes the trust barrier entirely.

2. **The free tier IS the sales funnel.** Individual developer installs Unfade free -> uses it daily -> tells team lead -> team lead wants dashboards -> enterprise wants SSO and audit logs. This is exactly how PostHog, Plausible, and Grafana grow.

3. **Every free user is a distribution channel.** Their enriched PRs, commit messages, and shared Unfade Cards expose the brand to teammates and peers who haven't installed yet.

### The 4-Week Transition Timeline

| Week | Free Layer Focus | Paid Layer Focus |
|---|---|---|
| **Week 1** | Launch open-source CLI. Fingerprint + Card + MCP server all working. Focus entirely on star growth and community building. | Nothing. Do not mention pricing. Let the free product speak. |
| **Week 2** | Ship community requests. Fix bugs aggressively. Add integrations requested by users. | Soft-launch `unfade.dev/username` hosted profiles for early adopters. Free during beta. Collect feedback on what "hosted identity" should include. |
| **Week 3** | Ship team features in open source: team reasoning aggregation in the dashboard. | Announce Pro tier pricing. Hosted identity + cloud distill + cross-machine sync. $12/dev/month. Early adopter discount (first 3 months free or 50% off). |
| **Week 4** | Ship onboarding narratives (dashboard reasoning history). This is the enterprise killer feature. | Announce Team tier. $20/dev/month. Team dashboards + aggregate comprehension + SSO. Start conversations with engineering managers who found Unfade through their developers. |

### Why This Ordering Works

The ordering follows a validated pattern from PostHog, Supabase, and Grafana:

1. **Week 1: pure generosity.** Give everything away. Build trust and community. Any hint of monetization in the first week kills developer trust.

2. **Week 2: soft-launch the convenience tier.** Hosted identity is a natural "I'd pay for this" feature. It doesn't gate any functionality -- it just makes sharing easier. Developers who already love the free product self-select into trying hosted profiles.

3. **Week 3: formalize individual pricing.** By now you have thousands of active users. Some percentage naturally want cloud distill (better LLMs without managing Ollama) and cross-machine sync. Price it below Cursor ($20) and comparable to WakaTime ($11).

4. **Week 4: unlock the enterprise conversation.** The onboarding narrative feature (`unfade history`) is the entry point for enterprise sales. "Your codebase's reasoning history becomes your onboarding documentation" is a value proposition engineering managers immediately understand because they feel the pain of 4-6 week ramp-ups for every new hire.

---

## 6. Revenue Model and Path to $1M ARR

### Pricing

| Tier | Price | What's Included |
|---|---|---|
| **Free** | $0 forever | Everything local: capture, personalization, intelligence pipeline, MCP server, local distill (Ollama), local cards, self-hosted Thinking Graph |
| **Pro** | $12/dev/month ($10 annual) | Hosted `unfade.dev/username`, hosted card sharing with view analytics, cloud distill (frontier LLMs), cross-machine sync, advanced reasoning analytics |
| **Team** | $20/dev/month ($16 annual) | Everything in Pro + team dashboards, aggregate comprehension scores, onboarding narratives, manager views, SSO, admin controls |
| **Enterprise** | Custom pricing | Everything in Team + private deployment, audit exports, compliance features, dedicated support, custom integrations |

**Price rationale.** $12/month positions below Cursor ($20) and Windsurf ($15). $20/dev/month for teams is comparable to WakaTime Team ($21) and below Cursor Business ($40). Enterprise is custom because enterprise deals vary wildly in scope.

### The Math: How to Reach $1M ARR

**Conservative scenario (based on PostHog conversion dynamics):**

| Stage | Users | Conversion | Monthly Revenue |
|---|---|---|---|
| Free users (3 months post-launch) | 100,000 | -- | $0 |
| Pro conversion (3% of free) | 3,000 | 3% | $36,000 |
| Team conversion (500 teams x 5 devs) | 2,500 | -- | $50,000 |
| Enterprise (10 orgs x 30 devs) | 300 | -- | Custom (~$15,000) |
| **Total monthly** | -- | -- | **~$101,000** |
| **Annualized** | -- | -- | **~$1.2M ARR** |

**What this requires:**
- 100K free installs within 3 months (ambitious but achievable if the growth plan works -- RTK got 38K stars in 3 months, and stars roughly correlate with 2-5x installs)
- 3% Pro conversion (PostHog sees 2-5% conversion depending on the feature, so 3% is realistic for a tool with daily value)
- 500 teams adopting Team tier (this requires the onboarding narrative feature to be compelling enough for managers to justify $100/month for a 5-person team)
- 10 enterprise deals (this is the hardest part -- enterprise sales cycles are 2-6 months, so this may slip to month 5-6)

**Aggressive scenario (if the viral loop hits):**

If Unfade Cards and enriched PRs create genuine organic discovery (K-factor > 0.3), the free user count could reach 250K+ within 3 months. At that volume:

| Stage | Users | Monthly Revenue |
|---|---|---|
| Free | 250,000 | $0 |
| Pro (3%) | 7,500 | $90,000 |
| Team (1,000 teams x 5 devs) | 5,000 | $100,000 |
| Enterprise (20 orgs) | 600 | ~$30,000 |
| **Total monthly** | -- | **~$220,000** |
| **Annualized** | -- | **~$2.6M ARR** |

### RRVV Validation of Revenue Projections

**Research:** Lovable hit $10M ARR in 60 days. Devin went from $1M to $73M ARR in 9 months. Cursor hit $2B ARR. These are the outliers, but they validate that developer tools with daily utility can monetize quickly.

**Reasoning:** Unfade's monetization is weaker than Lovable/Cursor because it doesn't gate a core workflow behind payment. The free product IS the full product locally. Revenue comes from convenience and team features, not from gating the core experience. This means conversion rates will be lower (3% vs. Cursor's ~5-8%) but the trust and adoption curve will be steeper.

**Validation:** PostHog took ~2 years to reach $1M ARR with this model. But PostHog launched in 2020, before the AI coding tool explosion. Unfade is launching into a market where 92% of developers use AI tools and the "comprehension debt" anxiety is at peak intensity. The timing compression is real.

**Risk:** The $1M ARR in 3-4 months target is aggressive. It depends on all three things working: (1) 50K+ stars generating 100K+ installs, (2) a compelling Pro tier that 3%+ convert to, and (3) the team/enterprise features shipping fast enough to capture early demand. If any one of these lags, the timeline extends to 5-6 months. Still fast by any standard.

---

## 7. Six Gaps That Become Revenue

These are real developer needs that Unfade can address, each validated against community signals. They are ordered by revenue potential.

### Gap 1: Onboarding and Knowledge Transfer (Enterprise Killer Feature)

**The pain.** New hires take 4-6 weeks to ramp up. AI halves this, but doesn't solve the deeper problem: understanding *why* the codebase is the way it is.

**What Unfade offers.** The dashboard's reasoning history view (filterable by project + timeframe) gives a new hire a structured narrative of every architectural decision, trade-off, and dead end the team explored. This requires zero new features -- just a query interface and positioning.

**Revenue impact.** This is the single strongest enterprise conversion argument. "Your codebase's reasoning history becomes your onboarding documentation" maps directly to a budget line item (onboarding time costs $5K-$15K per new hire in lost productivity).

### Gap 2: Token and Cost Visibility (Manager Buy-In Feature)

**The pain.** Power users face $30-$800/month in opaque API costs. Teams are spending $50K-$500K/year on AI tooling with no ROI measurement.

**What Unfade offers.** A "value receipt" in every Daily Distill: "Today, Unfade auto-injected context that would have taken ~15 minutes and ~$8 in tokens to re-explain. This month: 4.2 hours and ~$180 saved." This turns abstract benefit into a concrete number engineering managers can put in a budget justification.

**Revenue impact.** This directly addresses the biggest objection to any new paid developer tool: "prove it's worth the money." When the tool quantifies its own ROI, the Team tier sells itself.

**Status:** Partially shipped. Token spend proxy and cost hints exist. Full cost attribution with value receipts is planned.

### Gap 3: Debugging Session Capture (Retention Feature)

**The pain.** Debugging is where the most valuable reasoning happens and the most context is lost. Developers re-debug the same class of issue weekly.

**What Unfade offers.** A debugging reasoning reconstructor that stitches terminal signals, AI conversations, and error patterns into a coherent narrative: "You hypothesized X, tested with Y, the error changed to Z, so you refined to..."

**Revenue impact.** This is the strongest retention feature. Once a developer has 6 months of debugging narratives they can search, they cannot leave.

### Gap 4: Reasoning Confidence Calibration (Differentiation Feature)

**The pain.** Only 29% of developers trust AI-generated code, down from 40% in 2025. The trust crisis extends to developers' trust in their own reasoning when AI is involved.

**What Unfade offers.** Decision durability tracking: "Decisions you made after exploring 3+ alternatives have a 94% retention rate. Quick decisions have 61%." This makes Unfade a reasoning coach, not just a reasoning mirror.

**Revenue impact.** Pro tier feature. Developers who care about growth and calibration are exactly the audience willing to pay $12/month.

### Gap 5: Collaborative Reasoning (Team Tier Driver)

**The pain.** When multiple team members work on the same project, their reasoning is siloed. No tool connects their thinking.

**What Unfade offers.** When two Unfade users work on the same repo, surface each other's recent reasoning: "Your teammate evaluated this same library yesterday and chose option B -- here's their reasoning."

**Revenue impact.** This is the Team tier differentiator. Individual Unfade is a personal tool. Team Unfade prevents duplicated reasoning across the team.

### Gap 6: Non-Developer Knowledge Workers (Future Expansion)

**The pain.** Product managers, designers, and technical writers make reasoning-heavy decisions that evaporate. The capture + distill + identity model is domain-agnostic.

**Revenue impact.** Not v1. Correctly scoped out. But worth documenting as a future expansion path that could 5-10x the addressable market.

---

## 8. Strategic Decisions and Why

### Decision 1: Open Source Core (Non-Negotiable)

**The answer:** MIT-licensed core with paid cloud and team tiers.

**Why this isn't optional:**

1. **The Microsoft Recall precedent.** Microsoft faced massive privacy backlash for an observation tool. Open-source alternatives launched within weeks. Unfade captures git history, AI sessions, and terminal output. Developers will not grant these permissions to closed-source code. Period.

2. **The data confirms it.** 92% of developers use open-source software. Vendor lock-in avoidance is the #1 driver of OSS adoption (55% of respondents, up 68% YoY). For a tool that builds a compounding model of how you think, the lock-in concern is existential.

3. **Every competitor is open source.** Graphify, RTK, thinking-mcp, OpenClaw -- all MIT or Apache. Closed-source Unfade would be a trust disadvantage against every alternative.

4. **Open source IS the distribution.** The funnel: discover via Unfade Card -> install free CLI -> use daily -> hit team limits -> convert. PostHog runs exactly this model.

### Decision 2: Separate Product, Shared Ecosystem (with unerr)

**The answer:** Unfade is its own GitHub repo, npm package, landing page, and identity. It shares a data substrate with unerr when both are installed.

**Why separate:**
- **Audience mismatch is 10-50x.** unerr serves teams needing lifecycle intelligence. Unfade serves any developer who uses AI tools. Bundling means 90%+ of Unfade's audience never discovers it.
- **The viral mechanic dies inside unerr.** "Check out my Unfade" is a shareable identity. "Check out my unerr developer intelligence module" is not.

**Why connected:**
- **The shared data substrate is the ultimate moat.** Both installed together means the AI receives structural intelligence (code) AND reasoning intelligence (developer). No competitor can replicate this without building both systems.
- **Natural conversion funnel.** Unfade (free, viral) introduces developers to reasoning tooling. When their codebase needs structural intelligence, unerr is the next step.

### Decision 3: CLI + Web UI, Not a Dashboard Product

**The answer:** The primary interaction is CLI + local web UI + MCP server running silently. Not a SaaS dashboard.

**Why:**
- The daemon runs silently. Context injection is invisible. The Daily Distill arrives as a notification.
- The daily interaction pattern is: glance at Comprehension Score, read distill, continue working. More like WakaTime than Vercel.
- The web UI is for browsing the Thinking Graph, reviewing distills, and generating cards. It's a review surface, not a workflow tool.

### Decision 4: Free Forever for Individuals

**The answer:** The core reasoning engine must be free and local forever. No artificial limits on capture, personalization, or MCP tools.

**Why this matters more than it seems:**

The biggest risk for any open-source-to-enterprise product is poisoning the free tier with artificial limits that push users away. PostHog's generous free tier is why 90%+ of companies use it free -- and why 5% of those convert to paid at very high contract values.

Unfade's free tier should be genuinely useful for a solo developer for years without ever paying. The paid tiers must offer genuinely new value (hosting, team features, cloud compute), not gatekept versions of free features.

---

## 9. Risks and Honest Problems

### Risk 1: The Fingerprint Isn't Accurate Enough

**The problem.** The entire growth strategy rests on one moment: `unfade` -> 60 seconds -> Reasoning Fingerprint. If the fingerprint feels generic or wrong, nobody shares it, and the viral loop never starts.

**Mitigation.** Aggressive tuning of git history heuristics before launch. Beta test with 20-50 developers and measure "recognition rate" -- what percentage say "that's me"? Must be >70% to launch.

**Severity: Critical.** This is a launch-blocker.

### Risk 2: 24-Hour Delay to Ongoing Value

**The problem.** After the initial fingerprint wow, the next value comes from Daily Distill -- which requires working for a day first. No viral product has a 24-hour gap between first value and second value.

**Mitigation.** The backfill (automated during onboarding) should produce distills from the past 30 days of git history immediately. The user gets both the fingerprint AND a month of distills in their first session.

**Severity: High.** Solvable with engineering effort.

### Risk 3: Cards Create Admiration, Not Urgency

**The problem.** Looking at the viral products that actually worked (Spotify Wrapped, OpenClaw, Lovable), the viewer's reaction is "I need this NOW" -- not "cool concept." Unfade Cards might produce admiration ("interesting idea") without urgency ("I need my own fingerprint").

**Mitigation.** Three structural fixes:
1. Make the product visible where developers already work (enriched PR descriptions, enriched commit messages) so discovery is passive
2. The Reasoning Depth Score creates comparison: "My score is 847. What's yours?"
3. Weekly Wrapped creates recurring share moments (monthly is too infrequent, daily is fatiguing)

**Severity: Medium.** This is a growth ceiling risk, not a launch blocker. Even without viral growth, Unfade can grow steadily through utility (the MCP server genuinely makes AI tools better).

### Risk 4: Enterprise Sales Cycle Is Slow

**The problem.** Enterprise deals take 2-6 months. The $1M ARR target in 3-4 months assumes enterprise revenue that may not materialize that fast.

**Mitigation.** The math works even without enterprise: 100K free users x 3% Pro conversion = $36K/month + 500 teams at $20/dev = $50K/month = ~$1M ARR from Pro + Team alone.

**Severity: Medium.** Enterprise is upside, not a requirement for the target.

### Risk 5: A Well-Funded Competitor Copies the Approach

**The problem.** If GitHub, JetBrains, or a well-funded startup decides to build comprehension tracking, they have more distribution.

**Mitigation.** The temporal moat. A competitor can copy the feature set, but they cannot copy 6 months of accumulated reasoning patterns. Every month Unfade runs, the switching cost increases because the personalization model is deeper. This is the same moat that makes WakaTime sticky despite being simple.

**Severity: Low-Medium.** Real but slow-moving. Unfade has at least 12-18 months before a serious funded competitor could ship something equivalent.

### Risk 6: Developer Tool Fatigue

**The problem.** Developers are overwhelmed with tools. "Another CLI to install" is a real objection.

**Mitigation.** Zero configuration and passive operation. After running `unfade`, the user never needs to interact with the CLI again unless they want to. The MCP server runs silently. Capture runs silently. Value appears in their existing AI tools without any workflow change. This is the opposite of tools that demand daily engagement.

**Severity: Low.** Passive tools avoid the fatigue trap by not adding cognitive load.

---

## 10. Metrics That Matter

### Growth Metrics (First 3 Months)

| Metric | Week 1 Target | Month 1 Target | Month 3 Target |
|---|---|---|---|
| GitHub stars | 5,000 | 25,000-40,000 | 60,000+ |
| npm installs | 2,000 | 15,000 | 100,000 |
| Active users (capture running daily) | 500 | 5,000 | 30,000 |
| MCP connections (Unfade serving context to AI tools) | 200 | 3,000 | 20,000 |

### Viral Metrics

| Metric | Target | Why It Matters |
|---|---|---|
| K-factor (new users per existing user) | > 0.3 first year | If K > 1.0, growth is exponential. Realistic target is sub-viral but with strong organic compounds. |
| Cards shared per month | Growing | Output virality working |
| README badges deployed | Growing | Persistent ecosystem visibility |
| Install conversion from `unfade.dev` | > 15% | Landing page and value prop resonating |
| Time to first Fingerprint | < 60 seconds | The front door is fast enough |

### Retention Metrics

| Metric | Target | Why It Matters |
|---|---|---|
| D7 retention (active 7 days after install) | > 40% | The habit is forming |
| D30 retention | > 25% | The compounding value is visible |
| Reasoning streak median | > 7 days | Loss aversion mechanic working |
| Daily Distill read rate | > 50% | The distill is genuinely useful, not ignored |

### Revenue Metrics (Starting Month 2)

| Metric | Month 2 | Month 3 | Month 4 |
|---|---|---|---|
| Pro subscribers | 200 | 1,500 | 3,000 |
| Team subscriptions | 20 teams | 100 teams | 500 teams |
| MRR | $5,000 | $40,000 | $85,000 |
| ARR (annualized) | $60,000 | $480,000 | $1,020,000 |

### The Honest Assessment

Will Unfade hit $1M ARR in exactly 3-4 months? It's aggressive but achievable if three things go right:

1. The launch generates 25K+ stars in the first month (requires the Fingerprint to be genuinely impressive and the launch sequence to execute well)
2. The Pro tier converts at 3%+ (requires hosted identity and cloud distill to be genuinely better than local)
3. Team adoption starts in month 2 (requires the onboarding narrative feature to be compelling)

If any of these lags, the timeline extends to 5-6 months. If the viral loop actually works (K > 0.5), the timeline compresses to 2-3 months.

The most likely outcome: $1M ARR in 4-5 months, with enterprise deals adding another $500K-$1M in months 6-12.

---

*Generated via RRVV analysis -- April 2026*
*Research sources: Graphify (GitHub), RTK (GitHub/HN/ProductHunt), Lovable (TechResearchOnline), PostHog (company blog), AFFiNE (growth playbook), OpenClaw (star history), Cursor/Devin (industry reporting), METR study, Anthropic comprehension study, JetBrains 2026 Developer Survey*

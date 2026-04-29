# Build Order — Feature Groups, Test Gates & Public Launches

> **What this is:** The ordered plan for building Unfade's 12 feature groups (73 features) into a shippable product. Each group is built, tested end-to-end, and verified before moving to the next. After specific milestones, we launch publicly — building in public, shipping incrementally.
>
> **Principle:** No feature group ships untested. Every group has acceptance criteria. We test before proceeding, launch before perfecting.
>
> **Starting state:** All backend infrastructure (Layers 0–4) is complete — 25 DAG-ordered analyzers, 11 MCP tools, dual-database materializer, CozoDB knowledge graph, intelligence presentation. The work ahead is building the React UI that surfaces this to users, and verifying each feature group works end-to-end.
>
> **Companion documents:**
> - [FEATURE_LIST.md](.internal/product/FEATURE_LIST.md) — 73 features, 12 groups, dependency graph
> - [INSTANT_VALUE_FEATURES.md](.internal/product/INSTANT_VALUE_FEATURES.md) — Launch psychology (Gravity, Cravings, Need)
>
> **Last updated:** 2026-04-29

---

## The Order

### Group 1: Passive Capture

**Pages:** LivePage, IntegrationsPage

**Build:**
- Real-time event feed with SSE (virtual scroll for performance)
- Capture status indicators — which engines are running, events/minute
- Integration cards for connected tools (Claude Code, Cursor, Codex, Aider, terminal)
- Daemon health display per repo
- Project management: add/remove/pause repos, discovery scanner

**Test gate — verify before proceeding:**
- [ ] `unfade add .` registers a repo, daemon starts, events appear in LivePage within 5 seconds
- [ ] AI session capture: open Claude Code, do work, events appear in LivePage
- [ ] Git capture: make a commit, event appears in LivePage
- [ ] Terminal capture: `unfade-send` pipes terminal context, event appears
- [ ] Daemon health: kill a daemon process, UI shows it as down, auto-restart triggers
- [ ] Multi-repo: add 3 repos, all show events independently, project switcher works
- [ ] IntegrationsPage shows all connected capture sources with live status
- [ ] SSE reconnects after network drop (simulate by killing server, restarting)

---

### Group 3: Daily Distill

**Pages:** DistillPage

**Build:**
- Distill list with date navigation (calendar or date picker)
- Markdown rendering of distill summaries
- Sections for decisions, trade-offs, dead ends, domains
- Backfill indicator (shows progress when distilling past days)

**Test gate — verify before proceeding:**
- [ ] Capture events for a full work session, run distill, DistillPage shows the summary
- [ ] Backfill: `unfade distill --backfill 7` processes 7 days, all appear in DistillPage
- [ ] Each distill shows: summary paragraph, decisions list with domain tags, trade-offs, dead ends
- [ ] Date navigation works — click a date, see that day's distill
- [ ] Empty state: day with no events shows appropriate "no activity" message
- [ ] Distill with LLM provider configured produces rich synthesis
- [ ] Distill without LLM provider falls back to heuristic synthesis (still useful)

---

### Group 11: Thinking Identity

**Pages:** CardsPage

**Build:**
- Card generation UI: time range selector (7d / 30d / 90d), style picker (dark/light)
- PNG preview inline before downloading
- Download button
- Card history gallery (previously generated cards with dates)
- First-run Reasoning Fingerprint display (the 60-second wow moment)

**Test gate — verify before proceeding:**
- [ ] `unfade add .` on a repo with git history → Reasoning Fingerprint generates within 60 seconds
- [ ] CardsPage: select 7d range, generate card, preview appears, download produces valid PNG
- [ ] Card contains: top decisions, domains, reasoning style, comprehension indicators
- [ ] Card history shows previously generated cards
- [ ] Dark and light card styles both render correctly
- [ ] Card generation with minimal data (1 day of activity) produces reasonable output
- [ ] Card generation with rich data (30 days) shows depth

---

### **--- LAUNCH 1: "Unfade captures your reasoning and shows you who you are" ---**

**What we ship:** Passive capture + daily distill + identity cards. The viral loop: install → see events flowing → get your reasoning summarized → generate your thinking card → share it.

**Launch message:** "Unfade passively captures your engineering reasoning from git, AI tools, and terminal. It distills your daily work into decisions, trade-offs, and dead ends. Generate your Thinking Card — a visual fingerprint of how you reason."

---

### Group 4: Decisions

**Pages:** DecisionsPage

**Build:**
- Decision table with TanStack Table (sort, filter, paginate)
- Direction classification badges: "You directed" / "Collaborative" / "AI suggested"
- Domain tags on each decision
- Decision detail view with evidence drawer (raw events that produced the decision)
- Search across decisions (full-text)

**Test gate — verify before proceeding:**
- [ ] DecisionsPage loads with decisions extracted from distills
- [ ] Sorting works: by date, domain, direction, confidence
- [ ] Filtering works: by domain, by direction type, by date range
- [ ] Direction badges are accurate — manually verify 10 decisions have correct classification
- [ ] Evidence drawer: click a decision → see the raw capture events that led to it
- [ ] Search: type a keyword → relevant decisions surface
- [ ] Pagination: 100+ decisions paginate correctly, no performance degradation

---

### Group 2: Cross-Tool Context Injection

**Pages:** IntegrationsPage (enhance from Group 1)

**Build:**
- MCP connection status display
- Context injection counter ("41 context injections saved re-explanation this week")
- Connected tools list with health indicators
- What-was-injected log (last N injections with tool name, context summary)

**Test gate — verify before proceeding:**
- [ ] MCP server starts with `unfade`, responds to tool calls from Claude Code
- [ ] IntegrationsPage shows MCP as connected with tool count
- [ ] Context injection counter increments when AI tools call MCP
- [ ] All 11 MCP tools respond correctly: `unfade_query`, `unfade_context`, `unfade_decisions`, `unfade_profile`, `unfade_amplify`, `unfade_similar`, `unfade_comprehension`, `unfade_efficiency`, `unfade_costs`, `unfade_coach`, `unfade_log`
- [ ] Degraded mode: stop server, MCP tools return `degraded: true` with reason
- [ ] Injection log shows recent context injections with what was served

---

### **--- LAUNCH 2: "Your AI tools now remember everything" ---**

**What we ship:** Everything from Launch 1 + decisions explorer + MCP context injection visibility. Users can now explore their decisions, see direction patterns, and understand what Unfade is injecting into their AI tools.

**Launch message:** "Unfade now tracks every engineering decision you make — who drove it, what alternatives you considered, whether it held. Plus: your AI tools (Claude, Cursor, Codex) now get your full reasoning context automatically. No more re-explaining."

---

### Group 5: Comprehension

**Pages:** IntelligencePage (first section)

**Build:**
- Comprehension Score 0-100 with interpretation text
- Per-module heatmap (which areas you understand deeply vs. superficially)
- Blind spot detection (modules where you defer without understanding)
- FSRS decay indicators (knowledge freshness — what's fading)
- Trend direction (improving / declining / stable)

**Test gate — verify before proceeding:**
- [ ] IntelligencePage loads with comprehension section
- [ ] Score 0-100 displays with interpretation ("Deep understanding" / "Surface engagement" / etc.)
- [ ] Module heatmap shows at least 3 distinct modules with different scores
- [ ] Blind spots list identifies areas where AI suggestions were accepted without modification
- [ ] Decay indicators show which knowledge is fresh vs. stale
- [ ] Trend arrow shows direction over last 7 days
- [ ] Score changes after a day of deep work in a blind-spot area (verify recalculation)

---

### Group 6: Direction & Autonomy

**Pages:** IntelligencePage (second section)

**Build:**
- Human Direction Score (HDS) display with interpretation
- Independence index — how much you steer vs. accept
- Session intelligence — deepening vs. shallow engagement within sessions
- Maturity assessment — where you sit on the AI collaboration maturity curve
- AI Efficiency Score (AES) 0-100 composite

**Test gate — verify before proceeding:**
- [ ] Direction section renders with HDS score and interpretation
- [ ] Independence index shows meaningful distinction between directed and passive work
- [ ] Session intelligence correctly identifies deepening sessions (multiple iterations, increasing specificity) vs. shallow (accept first suggestion)
- [ ] Maturity phase display is accurate against actual usage patterns
- [ ] AES score composite weights are visible: Direction 30%, Token Efficiency 20%, Iteration Ratio 20%, Context Leverage 15%, Modification Depth 15%
- [ ] MCP tool `unfade_efficiency` returns consistent data with what the UI shows

---

### Group 7: Efficiency & Cost

**Pages:** IntelligencePage (third section)

**Build:**
- AI Efficiency Score with "Running lean" / "Nominal" / "Running rich" interpretation
- Cost attribution breakdown by model, domain, and branch
- Cost per directed decision metric
- Token spend trends over time
- `unfade savings` CLI output matches dashboard data

**Test gate — verify before proceeding:**
- [ ] Cost section displays with token estimates (not actual invoices — proxy estimates)
- [ ] Breakdown by model shows different models used (if multiple)
- [ ] Cost per directed decision: verify the math — total estimated spend / directed decisions count
- [ ] Token trend chart shows daily spend over last 14 days
- [ ] MCP tool `unfade_costs` returns data matching dashboard
- [ ] `unfade savings` CLI output is consistent with dashboard efficiency section
- [ ] Zero-cost state (no AI sessions captured) shows appropriate empty state

---

### Group 8: Velocity & Patterns

**Pages:** IntelligencePage (fourth section)

**Build:**
- Decisions/day velocity chart with trend direction ("Accelerating" / "Decelerating" / "Cruising")
- Prompt pattern analysis — most effective interaction patterns with effectiveness %
- Loop detection — warnings when re-exploring dead ends
- Active loop alerts with past attempt references

**Test gate — verify before proceeding:**
- [ ] Velocity chart shows decisions/day for last 14 days
- [ ] Trend direction is accurate (compare with manual count)
- [ ] Prompt patterns show at least 3 identified patterns with effectiveness scores
- [ ] Loop detector triggers correctly: deliberately re-explore a previously abandoned approach → warning appears
- [ ] MCP tool `unfade_coach` returns prompt coaching data matching UI patterns
- [ ] Anti-pattern detection works — identify at least one anti-pattern in test data

---

### **--- LAUNCH 3: "Intelligence Hub — know how you really work with AI" ---**

**What we ship:** Everything from Launch 2 + the full Intelligence Hub (comprehension, direction, efficiency, velocity). This is the product differentiation launch — no competitor has this.

**Launch message:** "Unfade now scores your AI comprehension (are you understanding or rubber-stamping?), tracks your direction autonomy, attributes AI costs to actual decisions, and detects when you're going in circles. Four intelligence lenses on one dashboard."

---

### Group 9: Expertise & Codebase Knowledge

**Pages:** IntelligencePage (fifth section)

**Build:**
- Expertise map — file ownership, churn analysis, expertise distribution
- Domain classification display (auto-classified domains)
- Entity resolution visualization — cross-tool concept merging
- Temporal fact browser — what was true when, bi-temporal tracking
- Cross-tool reasoning unification view

**Test gate — verify before proceeding:**
- [ ] Expertise map renders with file/directory ownership data from git history
- [ ] Domain classification shows at least 5 auto-detected domains
- [ ] Entity resolution: verify same concept recognized across different tools (e.g., "auth module" from Claude = "authentication" from git)
- [ ] Temporal facts show correct state transitions ("used JWT" → "migrated to sessions" with dates)
- [ ] Cross-tool view unifies reasoning from git + AI sessions + terminal for the same topic
- [ ] CozoDB substrate queries return expected graph data
- [ ] SubstrateEngine health check passes

---

### Group 10: Personalization & Amplification

**Pages:** ProfilePage

**Build:**
- Reasoning profile: decision style, trade-off preferences, exploration depth, blind spots, communication style
- Trade-off preference tracking with confidence scores and supporting/contradicting counts
- Pattern detection — automatically extracted meta-patterns
- Cross-project amplification panel — connections across projects and time
- Decision durability stats — held vs. revised rates by deliberation depth
- Debugging arc timelines — hypothesis → test → result narratives

**Test gate — verify before proceeding:**
- [ ] ProfilePage renders with reasoning profile data
- [ ] Trade-off preferences show at least 3 tendencies with confidence scores
- [ ] Pattern detection identifies at least 2 meta-patterns (requires 2+ distills minimum)
- [ ] Cross-project amplification: with 2+ repos, verify cross-project connections surface
- [ ] Decision durability: verify held vs. revised classification against manual inspection
- [ ] Debugging arcs: after a debugging session, verify arc reconstruction is coherent
- [ ] MCP tools `unfade_profile`, `unfade_amplify`, `unfade_similar` return data matching ProfilePage
- [ ] Profile evolves: do more work, verify profile updates reflect new data

---

### Group 12: Narrative Intelligence

**Pages:** HomePage (headlines + insights), IntelligencePage (narrative cards)

**Build:**
- Narrative headlines — natural-language claims generated from cross-analyzer correlation
- Narrative cards — auto-generated threads about work patterns
- Cross-analyzer correlation display — what connects across different intelligence sections
- Diagnostic stream panel — real-time diagnostic messages from the intelligence pipeline
- Latest insights feed — prioritized by relevance and recency

**Test gate — verify before proceeding:**
- [ ] HomePage displays at least one narrative headline derived from real data
- [ ] Narrative cards on IntelligencePage show meaningful cross-analyzer insights
- [ ] Cross-analyzer correlations are real — verify at least one correlation makes sense (e.g., comprehension drop + velocity spike = rubber-stamping)
- [ ] Diagnostic stream shows actionable messages during intelligence pipeline runs
- [ ] Latest insights are ordered by recency
- [ ] Narratives update when new intelligence data arrives
- [ ] Empty state: no correlations yet → appropriate message, not broken UI

---

### **--- LAUNCH 4: "Your complete thinking identity" ---**

**What we ship:** The full product. All 12 feature groups, all 73 features. Expertise mapping, personalization, narrative intelligence, cross-project amplification.

**Launch message:** "Unfade now builds your complete thinking identity — expertise mapped across your codebase, reasoning profile that evolves with you, cross-project pattern detection, and narrative intelligence that tells you the story of how you work. This is your developer identity, built from evidence."

---

### Polish Phase: Remaining Pages

After Launch 4, polish the supporting pages:

| Page | What |
|------|------|
| **HomePage** (enhance) | Dashboard summary of all groups, system health, quick-glance metrics |
| **ProfilePage** (enhance) | Interactive Thinking Graph — decision density heatmap, domain evolution, thinking threads. `unfade publish` generates static site. |
| **SettingsPage** | LLM configuration, capture preferences, theme toggle, API key management |
| **ProjectsPage** (enhance) | Full project management — discovery scanner, bulk operations, monitoring state |
| **LogsPage** | Debug log viewer, diagnostic history, pipeline health |

---

## Summary

```
Group 1  → Passive Capture          ─┐
Group 3  → Daily Distill             ├─ LAUNCH 1: "Captures your reasoning"
Group 11 → Thinking Identity         ─┘

Group 4  → Decisions                 ─┐
Group 2  → Context Injection         ─┘─ LAUNCH 2: "AI tools remember everything"

Group 5  → Comprehension             ─┐
Group 6  → Direction & Autonomy       │
Group 7  → Efficiency & Cost          ├─ LAUNCH 3: "Intelligence Hub"
Group 8  → Velocity & Patterns       ─┘

Group 9  → Expertise & Knowledge     ─┐
Group 10 → Personalization            ├─ LAUNCH 4: "Complete thinking identity"
Group 12 → Narrative Intelligence    ─┘
```

Four launches. Each one a public milestone. Each one tested end-to-end before shipping. Build in public from Launch 1 onward.

---

*Build plan — April 2026*

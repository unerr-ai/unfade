# Phase 4 — Reasoning Personalization & Amplification

> **Feature Statement:** _"After several phases of accumulated data, Unfade doesn't just summarize your day — it knows how you think. Your reasoning profile shows you evaluate 3.2 alternatives on average, favor simplicity for frontend but go deep on database decisions, and modify 60% of AI suggestions. The personalization engine transforms Daily Distills from 'interesting summary' into 'thinking partner that knows me and surfaces connections I missed.'"_
>
> **Prerequisites:** [Phase 3 — Cards & Terminal Capture](./PHASE_3_CARDS_AND_TERMINAL.md) complete (card generation, terminal capture, amplification v1, debugging session detection)
>
> **Status:** AWAITING REVIEW
>
> **Inspired by:** Spotify's "Discover Weekly" personalization (learns from patterns, surfaces novelty), GitHub Copilot's style adaptation, Hermes agent's identity model
>
> **Foundation doc:** [Research & Design](./UNFADE_CLI_RESEARCH_AND_DESIGN.md)
>
> **Last updated:** 2026-04-14

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan](#6-implementation-plan)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 4 is where Unfade transitions from a *capture and summarization tool* to a *reasoning partner*. The personalization engine is the single capability that defeats every competitor in the landscape:

- **11 capture tools** capture data. Unfade produces *understanding*.
- **5 MCP memory servers** remember what you decided. Unfade learns *how* you decide.
- **IDE vendors** learn preferences ("user likes TypeScript"). Unfade learns reasoning patterns ("user evaluates 3+ alternatives for infrastructure, accepts first approach for frontend").

### 1.2 The Principle

> **The temporal moat: a competitor can replicate capture in weeks, MCP server in days, Thinking Graph in months. They cannot produce months of your reasoning patterns without months of observation. Personalization is the one capability where time itself is the barrier to entry.**

### 1.3 The Core Differentiator

The competitive analysis (35+ tools, April 2026) reveals: zero tools learn how you think. If Unfade has personalization, it is the only tool in the market. If it doesn't, it's one of 16 capture/memory tools. The personalization engine is not an enhancement — it is the product.

---

## 2. The Problem

### Current State (after Phase 3)

The personalization *seed* exists (Phase 1) — basic metrics like alternatives evaluated and domain distribution. But the seed is static: it counts, it doesn't learn. Distills are the same quality regardless of how much data has accumulated. Amplification (Phase 3) surfaces connections but doesn't adapt to the developer's style.

### After Phase 4

| Concern | State |
|---|---|
| **Reasoning Profile** | Full `reasoning_model.json` with decision style, trade-off preferences, domain depth, exploration patterns — learned from accumulated data |
| **Pattern Detection** | Detects recurring patterns: "favors simplicity over flexibility," "evaluates 3+ alternatives for infrastructure," "tends to accept frontend defaults without deep evaluation" |
| **Domain Tracking** | Tracks domain expertise evolution: which areas you reason about most, depth progression, cross-domain connections |
| **Personalized Distills** | PERSONALIZATION section in every distill: "Your reasoning profile is emerging. You evaluate 3.2 alternatives on average. You spend 2.1x longer exploring database decisions than frontend decisions." |
| **Personalized Context** | MCP context shaped by profile: high-exploration developers get more alternatives, domain experts get deeper context |
| **Profile visualization** | Web UI `/profile` page displays full reasoning profile. TUI dashboard shows profile summary inline (decision style, top domain, AI collab rate). MCP tool `unfade_profile` and HTTP endpoint `/profile` available for agents and programmatic access |
| **Similar-decision search** | Web UI `/search` page with personalization-weighted matching. MCP tool `unfade_similar` is the primary consumption path for agents. `unfade query "..."` CLI covers keyword search and similar from terminal |

---

## 3. Research

### 3.1 Personalization Models in Adjacent Products

| Product | What It Personalizes | How It Learns | Limitation |
|---|---|---|---|
| **Cursor Memory** | Coding preferences ("user likes TypeScript, prefers functional style") | Explicit user statements + inferred from code | Preference-level only. Single tool. No reasoning patterns |
| **ChatGPT Memory** | Conversation preferences, facts about user | Explicit "remember this" + auto-detect | Fact-level only. No reasoning model. Single tool |
| **Spotify Discover Weekly** | Music recommendations | Listening patterns, collaborative filtering | Different domain but analogous approach: learn from behavior, surface novel connections |
| **GitHub Copilot** | Code suggestions | Previous code in context window | Per-session only. No persistent learning across sessions |

### 3.2 Reasoning Dimensions to Track

| Dimension | What It Measures | How to Detect | Example Output |
|---|---|---|---|
| **Decision breadth** | How many alternatives evaluated per decision | Count distinct approaches in git branches, AI conversations | "3.2 alternatives per decision (above baseline)" |
| **Exploration depth** | Time invested before deciding | Time between first event and final commit per decision | "Spends 2.1x longer on infrastructure vs frontend" |
| **AI interaction style** | How developer uses AI suggestions | Acceptance vs modification vs rejection from AI session logs | "Modifies 60% of AI suggestions — highest in auth code" |
| **Trade-off preferences** | Consistent patterns in decision-making | Repeated choices across similar trade-offs | "Favors simplicity over flexibility (8 of 10 trade-offs)" |
| **Domain distribution** | What areas the developer reasons about | Domain tags from decisions | "Top: backend (45%), databases (25%), auth (15%)" |
| **Domain depth** | Expertise progression over time | Complexity of decisions in each domain | "Database decisions increasing in complexity month-over-month" |

---

## 4. Architecture

### 4.1 Personalization Engine

```
Capture Events (daily)
        │
        ▼
┌──────────────────┐
│ Pattern Detector  │  (pattern-detector.ts)
│                   │
│ Decision style    │  → alternatives count, exploration depth
│ Trade-off prefs   │  → simplicity vs flexibility, speed vs correctness
│ AI interaction    │  → acceptance rate, modification patterns
└────────┬──────────┘
         │
         ▼
┌──────────────────┐
│ Domain Tracker    │  (domain-tracker.ts)
│                   │
│ Domain frequency  │  → which areas, how often
│ Depth progression │  → complexity over time
│ Cross-domain      │  → connections between domains
└────────┬──────────┘
         │
         ▼
┌──────────────────┐
│ Profile Builder   │  (profile-builder.ts)
│                   │
│ Merge new data    │  → running averages, decay old data
│ Detect patterns   │  → confidence thresholds
│ Write profile     │  → .unfade/profile/reasoning_model.json
└────────┬──────────┘
         │
         ▼
┌──────────────────┐
│ Context Shaper    │  (context-shaper.ts) — already exists from Phase 2
│                   │
│ Shape MCP context │  → adapt to developer's profile
│ Shape distill     │  → personalized observations
└──────────────────┘
```

### 4.2 Full Reasoning Model Schema

```typescript
// .unfade/profile/reasoning_model.json — v2 (full personalization)
interface ReasoningModelV2 {
  version: 2;
  lastUpdated: string;
  dataPoints: number;      // Total observations feeding the model

  decisionStyle: {
    avgAlternativesEvaluated: number;
    medianAlternativesEvaluated: number;
    explorationDepthMinutes: {
      overall: number;
      byDomain: Record<string, number>;
    };
    aiAcceptanceRate: number;
    aiModificationRate: number;
    aiModificationByDomain: Record<string, number>;
  };

  tradeOffPreferences: {
    preference: string;        // e.g., "simplicity over flexibility"
    confidence: number;        // 0-1
    supportingDecisions: number;
    contradictingDecisions: number;
    firstObserved: string;
    lastObserved: string;
  }[];

  domainDistribution: {
    domain: string;
    frequency: number;
    percentageOfTotal: number;
    lastSeen: string;
    depth: 'shallow' | 'moderate' | 'deep';
    depthTrend: 'stable' | 'deepening' | 'broadening';
    avgAlternativesInDomain: number;
  }[];

  patterns: {
    pattern: string;
    confidence: number;
    observedSince: string;
    lastObserved: string;
    examples: number;
    category: 'decision_style' | 'trade_off' | 'domain' | 'ai_interaction' | 'exploration';
  }[];

  temporalPatterns: {
    mostProductiveHours: number[];    // Hours of day (0-23)
    avgDecisionsPerDay: number;
    peakDecisionDays: string[];       // Days with highest reasoning activity
  };
}
```

### 4.3 Personalized Distill Section

```markdown
## Your Reasoning Profile (Phase 4)

**Decision style:** You evaluate 3.2 alternatives on average (above the baseline of 1.8).
Your exploration depth varies by domain:
- **Infrastructure decisions:** 2.1x longer than average — you go deep here
- **Frontend decisions:** 0.7x average — you tend to accept first approaches
- **Auth decisions:** 1.4x average — moderate exploration, but highest AI modification rate (80%)

**Emerging patterns** (confidence > 0.7):
- You favor simplicity over flexibility (8 of 10 recent trade-offs)
- You consistently evaluate caching alternatives more thoroughly than API design alternatives
- When you reject an AI suggestion, you almost always provide a more constrained alternative

**Amplification:**
- You evaluated Redis vs Memcached today. On 2026-03-28, you made a similar evaluation
  in project-x and chose Memcached for throughput. Your reasoning style has shifted —
  today you weighted persistence higher than raw throughput.
```

---

## 5. Design Principles

1. **Personalization is always transparent.** The developer can inspect their reasoning profile via the web UI `/profile` page (or `unfade_profile` MCP tool) and see exactly why each pattern was detected, with confidence levels and example counts. No black boxes.

2. **Conservative before confident.** Better to say "insufficient data" than to make a wrong pattern assertion. Patterns only surface at >0.7 confidence. New dimensions start hidden and graduate to visible as data accumulates.

3. **Corrections feed back.** If the developer says "this pattern is wrong," that feedback is recorded and adjusts the model. The model improves from explicit corrections, not just accumulated data.

4. **Personalization enhances, never replaces.** The raw distill (decisions, trade-offs, dead ends) is always present. Personalization adds the PATTERNS section and shapes context delivery. Removing personalization degrades quality, it doesn't break functionality.

5. **Temporal decay.** Recent decisions weight more than old ones. A trade-off preference from last week matters more than one from 3 months ago. Decay prevents stale patterns from dominating.

6. **Cross-domain connections are the surprise.** The highest-value personalization insight is "you made a similar decision in a different domain" — this is the amplification moment that creates delight.

---

---

## 5b. Execution Guide (Day 4: The Moat — Personalization & Amplification)

> **Sourced from:** Master Execution Blueprint — consolidated tasks with acid tests, strict contracts, and agent directives for AI-agent-driven execution.

### Acid Test

```
# Personalization test
unfade distill
cat .unfade/distills/YYYY-MM-DD.md
→ PERSONALIZATION section with baseline comparisons

# Amplification test
→ CONNECTIONS section with at least one cross-temporal link (use --backfill data)

# MCP test
# In Claude Code with Unfade MCP:
> "Are there similar decisions I've made before about caching?"
→ Agent calls unfade_similar and returns relevant past decisions

# Profile test
open http://localhost:7654/profile
→ Enhanced profile with decision style, domains, trade-off preferences
```

### Strict Contracts

**decisions_index.json (inverted index for O(1) amplification lookups):**

```json
{
  "byDomain": {
    "auth": [0, 3, 7, 12],
    "database": [1, 5, 8]
  },
  "byKeyword": {
    "redis": [1, 8],
    "jwt": [0, 3, 7],
    "cache": [1, 5, 12]
  },
  "byFile": {
    "src/auth/middleware.ts": [0, 3, 7]
  },
  "totalDecisions": 42,
  "lastRebuilt": "2026-04-18T18:00:00Z"
}
```

**Amplification matching rules (conservative v1):**
```
For each new decision:
  1. Extract domain + keywords
  2. Lookup: intersect(byDomain[domain], byKeyword[kw1] ∪ byKeyword[kw2])
  3. Require ≥2 matching signals (domain + keyword, or keyword + file)
  4. Score: number of matching signals / total possible signals
  5. Surface only connections with score > 0.3
```

**Blind spot quantification:**
```
A domain is a blind spot candidate when:
  decision_count ≥ 5  AND  avg_alternatives_per_decision < 1.5

Severity = decision_count × (1 / avg_alternatives)

Surfaced as: "Blind spot: You've made N decisions in [domain] but evaluated
only X alternatives on average. Consider whether you're defaulting to
familiar patterns."

Non-judgmental — may be intentional expertise. Dismissable via feedback.
```

**Connection schema (amplification output):**

```json
{
  "date": "YYYY-MM-DD",
  "today_decision": "Chose Redis for session store",
  "past_decision": "Evaluated Redis vs Memcached for object cache",
  "past_date": "2026-02-08",
  "match_type": "domain+keyword",
  "match_score": 0.72,
  "insight": "On Feb 8, you chose Memcached for throughput but noted you'd pick Redis if pub/sub was needed. This project needs pub/sub."
}
```

### Consolidated Tasks (4) with Agent Directives

#### Task 4.1: Personalization Engine

Evolve the reasoning profile from a seed to a learning model. Each distillation updates the profile incrementally.

**Agent directive:** "Build `src/services/personalization/engine.ts`. The engine takes the current `ReasoningModel` and a new `DailyDistill` and produces an updated `ReasoningModel`. Update rules: `avg_alternatives_evaluated` is a running average (weighted: new data gets 2x weight of historical). `convergence_speed` recalculated from last 30 days. `domain_depth` incremented per domain. `exploration_habits` updated from dead ends and AI acceptance patterns. `trade_off_weights` updated from consistent trade-off direction signals. Write updated model to `profile/reasoning_model.json`. Also enhance the distill pipeline's Stage 3 (synthesizer) to include a PERSONALIZATION section in the distill output: compare today's metrics against the profile baseline. E.g., 'Alternatives evaluated: 4 (your avg: 3.2 ↑)', 'New domain: security (first time in 30 days)'."

#### Task 4.2: Amplification Engine

Detect cross-temporal connections between today's decisions and past reasoning.

**Agent directive:** "Build `src/services/distill/amplifier.ts`. After distillation produces new decisions, the amplifier: (1) Builds/updates `graph/decisions_index.json` — inverted index by domain, keyword, and file path with line offsets into decisions.jsonl. (2) For each new decision, looks up candidates via set intersection on the index. (3) Scores candidates (require ≥2 signal matches, score > 0.3). (4) For high-confidence matches, generates a connection insight (simple template: 'On [date], you [past_decision]. Today you [today_decision]. [similarity note]'). (5) Writes connections to `amplification/connections.jsonl`. (6) Appends a CONNECTIONS section to the day's distill markdown. Build `src/services/personalization/matcher.ts` for the matching logic. Keep matching conservative — false positives destroy trust."

#### Task 4.3: Blind Spot Detection + Feedback

Identify domains where the developer decides frequently but explores shallowly. Provide a mechanism to mark surfaced connections as helpful/unhelpful.

**Agent directive:** "Extend the personalization engine to detect blind spots after each distillation. Scan `domain_depth` in the profile: for each domain with `decision_count >= 5`, compute avg alternatives per decision for that domain. If avg < 1.5, flag as blind spot candidate. Compute severity: `decision_count × (1 / avg_alternatives)`. Add to the distill's PERSONALIZATION section. For feedback: add `POST /feedback` HTTP endpoint — accepts `{ connection_id: string, helpful: boolean }`. Store feedback in `amplification/feedback.jsonl`. Future amplification runs read feedback to adjust matching thresholds (if >30% of connections for a domain are marked unhelpful, raise the threshold for that domain)."

#### Task 4.4: Web UI /search + MCP Tools

Search page for querying reasoning history, and MCP tools for AI agent access to amplification.

**Agent directive:** "Build `src/server/pages/search.ts` — GET /search renders HTML page with: search input (`hx-get='/query?q=...' hx-trigger='keyup changed delay:300ms'`), results list (decisions with date, domain, rationale), similar decisions panel. The search is live — htmx fires on each keystroke with debounce. Wire up `unfade_amplify` and `unfade_similar` MCP tools in `src/mcp/tools.ts`: `unfade_amplify()` reads connections.jsonl and returns recent connections. `unfade_similar(context: string)` extracts keywords from the context, queries the decisions index, returns top 5 similar past decisions. Update `src/server/routes/amplify.ts` and `src/server/routes/similar.ts` HTTP endpoints to use the same amplification/matching logic."

## 6. Implementation Plan

### Sprint 7: Personalization Engine v1

> **Goal:** Full personalization engine with pattern detection, domain tracking, and profile display. Distills include personalized observations. Context delivery adapts to developer's style.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-070** | Pattern detector v2: analyze accumulated decisions for recurring patterns — decision breadth, exploration depth by domain, AI interaction style, trade-off preferences. Output patterns with confidence scores | `src/services/personalization/pattern-detector.ts` | [ ] |
| **UF-071** | Domain tracker v2: track expertise evolution over time — frequency, depth progression (shallow → moderate → deep), cross-domain connections, complexity trends | `src/services/personalization/domain-tracker.ts` | [ ] |
| **UF-072** | Profile builder v2: upgrade `reasoning_model.json` to v2 schema — merge new data with running averages, apply temporal decay (recent data weighted 2x), detect trade-off preferences from decision history, calculate confidence scores | `src/services/personalization/profile-builder.ts` | [ ] |
| **UF-073** | Personalization in distill: add PERSONALIZATION section to Daily Distill — decision style summary, domain depth comparison, emerging patterns (>0.7 confidence), comparison to personal baseline | `src/services/distill/distiller.ts` | [ ] |
| **UF-074** | Profile web UI page (v2): enhanced `/profile` page with decision style radar, domain distribution chart, top patterns with confidence bars, temporal activity heatmap, AI interaction summary. TUI dashboard shows profile summary inline (decision style, top domain, AI collab rate). MCP tool `unfade_profile` and HTTP endpoint `/profile` remain available | `src/server/pages/profile.ts` | [ ] |
| **UF-075** | ProfileCard Ink component: visual reasoning profile with domain bars, pattern list, decision style indicators, trend arrows for evolving metrics — displayed in TUI dashboard | `src/components/ProfileCard.tsx` | [ ] |
| **UF-076** | Enhanced similar-decision search: weighted similarity using personalization — match by domain, decision style, trade-off pattern, not just keywords. Web UI `/search` page (added in Phase 3) enhanced with personalization weighting. MCP tool `unfade_similar` is the primary agent consumption path. `unfade query "..."` CLI covers both keyword and similar search from terminal | `src/server/pages/search.ts` | [ ] |
| **UF-077** | Profile migration: v1 → v2 schema migration for `reasoning_model.json`. Preserve accumulated data, compute new fields from historical events | `src/config/migrations.ts` | [ ] |
| **UF-078** | Amplification v2: cross-temporal AND cross-domain connection surfacing — "You made a caching decision today. Your auth token storage decision last week used similar trade-off reasoning (simplicity over flexibility)" | `src/services/distill/amplifier.ts` | [ ] |
| **UF-079** | Pattern feedback: web UI `/profile` page includes "correct this" buttons on each pattern — developer marks patterns as accurate/inaccurate, feedback adjusts confidence scores. Also accessible via `unfade_profile --correct` MCP tool | `src/services/personalization/profile-builder.ts` | [ ] |

#### File Tree Changes (Phase 4)

- **Removed:** `src/commands/profile.ts` — profile visualization moved to web UI `/profile` page
- **Removed:** `src/commands/similar.ts` — similar-decision search moved to web UI `/search` page + MCP tool
- **Added:** `src/server/pages/profile.ts` — enhanced with personalization v2 data (decision style radar, domain distribution, patterns)
- **Note:** `src/server/pages/search.ts` was added in Phase 3; enhanced here with personalization weighting

### Tests

| Test | What It Validates | File |
|---|---|---|
| **T-155** | Pattern detector: detects "high alternatives evaluator" pattern from decision history | `test/services/personalization/pattern-detector.test.ts` |
| **T-156** | Pattern detector: detects trade-off preference from consistent choices | `test/services/personalization/pattern-detector.test.ts` |
| **T-157** | Pattern detector: confidence increases with more supporting examples | `test/services/personalization/pattern-detector.test.ts` |
| **T-158** | Pattern detector: contradicting evidence reduces confidence | `test/services/personalization/pattern-detector.test.ts` |
| **T-159** | Pattern detector: returns no patterns below 0.7 confidence | `test/services/personalization/pattern-detector.test.ts` |
| **T-160** | Pattern detector: detects AI modification rate by domain | `test/services/personalization/pattern-detector.test.ts` |
| **T-161** | Domain tracker: tracks frequency distribution across domains | `test/services/personalization/domain-tracker.test.ts` |
| **T-162** | Domain tracker: detects depth progression (shallow → moderate → deep) | `test/services/personalization/domain-tracker.test.ts` |
| **T-163** | Domain tracker: identifies cross-domain connections | `test/services/personalization/domain-tracker.test.ts` |
| **T-164** | Domain tracker: calculates depth trend (stable/deepening/broadening) | `test/services/personalization/domain-tracker.test.ts` |
| **T-165** | Profile builder v2: merges new data with running averages | `test/services/personalization/profile-builder.test.ts` |
| **T-166** | Profile builder v2: applies temporal decay (recent data weighted higher) | `test/services/personalization/profile-builder.test.ts` |
| **T-167** | Profile builder v2: detects trade-off preferences from history | `test/services/personalization/profile-builder.test.ts` |
| **T-168** | Profile builder v2: handles v1 → v2 migration | `test/services/personalization/profile-builder.test.ts` |
| **T-169** | Profile builder v2: correction feedback adjusts confidence | `test/services/personalization/profile-builder.test.ts` |
| **T-170** | Personalized distill: includes PERSONALIZATION section | `test/services/distill/distiller.test.ts` |
| **T-171** | Personalized distill: comparison to personal baseline | `test/services/distill/distiller.test.ts` |
| **T-172** | Personalized distill: only shows patterns above 0.7 confidence | `test/services/distill/distiller.test.ts` |
| **T-173** | Web UI profile page: displays decision style summary | `test/server/pages/profile.test.ts` |
| **T-174** | Web UI profile page: displays domain distribution | `test/server/pages/profile.test.ts` |
| **T-175** | Web UI profile page: displays patterns with confidence | `test/server/pages/profile.test.ts` |
| **T-176** | Web UI search page + MCP tool `unfade_similar`: uses personalization for weighted matching | `test/server/pages/search.test.ts` |
| **T-177** | Web UI search page + MCP tool `unfade_similar`: finds cross-domain similar decisions | `test/server/pages/search.test.ts` |
| **T-178** | Amplification v2: surfaces cross-domain connection | `test/services/distill/amplifier.test.ts` |
| **T-179** | Amplification v2: includes trade-off reasoning comparison | `test/services/distill/amplifier.test.ts` |

---

## 7. Success Metrics

| Metric | Current | Target | How to Measure |
|---|---|---|---|
| **Profile accuracy** | N/A | Developer self-assessment: "profile matches how I think" (>70% agreement) | Survey after 2 weeks of use |
| **Pattern detection precision** | N/A | >80% of surfaced patterns rated "accurate" by developer | Manual review + feedback |
| **Personalization section quality** | N/A | Developer reads personalization section daily (not skipped) — qualitative | Usage observation |
| **Amplification relevance** | N/A | >70% of cross-temporal connections rated "genuinely relevant" | "Not helpful" feedback rate <30% |
| **Distill improvement** | N/A | Personalized distills rated higher quality than pre-personalization distills | A/B comparison |
| **Context shaping accuracy** | N/A | Shaped MCP context leads to better AI responses (qualitative) | Before/after comparison |
| **Data points per profile** | N/A | >50 decision observations for confident patterns | `reasoning_model.json` dataPoints field |
| **Test count** | 154 (Phase 3) | 179+ tests, all passing | `pnpm test` |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Personalization feels uncanny or wrong** | Medium | High — erodes trust | Personalization is always transparent (inspectable profile). Conservative confidence threshold (0.7). Correction mechanism. Better to be generically helpful than confidently wrong |
| **Insufficient data for meaningful patterns** | Medium | Medium — patterns feel generic | Require minimum observation counts before surfacing patterns. Use backfilled git history to bootstrap. Clearly label "emerging" vs "established" patterns |
| **Trade-off preferences don't generalize** | Medium | Medium — misleading patterns | Scope preferences by domain. "Favors simplicity in frontend" is different from "favors simplicity in database design." Surface contradictions as insights, not errors |
| **Temporal decay too aggressive** | Low | Medium — loses valuable old patterns | Configurable decay rate. Default: 2x weight for last 30 days. Established patterns (>20 examples) decay slower |
| **Profile migration breaks existing data** | Low | High — loses accumulated personalization | Migration is non-destructive: reads v1, computes v2 fields from historical events, writes v2. v1 file preserved as backup |
| **Amplification false positives increase with more data** | Medium | Medium — noise drowns signal | Tighter similarity threshold as data grows. Weight recency. Surface max 2 amplifications per distill |

---

> **Next phase:** [Phase 5: Ecosystem Launch](./PHASE_5_ECOSYSTEM_LAUNCH.md) — ClawHub skill, MCP Registry, Thinking Graph, npm publish, public launch.

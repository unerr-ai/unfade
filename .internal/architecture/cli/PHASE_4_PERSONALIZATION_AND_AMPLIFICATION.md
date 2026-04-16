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
> **Last updated:** 2026-04-16

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan (Micro-Sprints 4A–4C)](#6-implementation-plan-micro-sprints-4a4c)
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

## 6. Implementation Plan (Micro-Sprints 4A–4C)

### Phase 4 Boundary

> **Phase 3 delivers:** Amplification v1 (cross-temporal connections), `unfade_similar` MCP tool, `unfade_amplify` MCP tool, Web UI `/search` page, card generation pipeline, terminal capture, debugging session detection.
>
> **Phase 4 adds:** Personalization engine (pattern detection, domain tracking, profile building), ReasoningModelV2, personalized distills, amplification v2 (cross-domain), profile visualization v2, enhanced similar-decision search with personalization weighting, pattern feedback mechanism.

#### TypeScript READS/WRITES (Phase 4)

| Component | Reads | Writes |
|---|---|---|
| Pattern detector | `.unfade/events/*.jsonl`, `.unfade/distills/*.md` | (in-memory patterns → profile builder) |
| Domain tracker | `.unfade/events/*.jsonl`, `.unfade/profile/reasoning_model.json` | (in-memory domain data → profile builder) |
| Profile builder | Pattern detector output, domain tracker output, `.unfade/profile/reasoning_model.json` (v1 or v2) | `.unfade/profile/reasoning_model.json` (v2) |
| Profile migration | `.unfade/profile/reasoning_model.json` (v1), `.unfade/events/*.jsonl` | `.unfade/profile/reasoning_model.json` (v2), `.unfade/profile/reasoning_model.v1.backup.json` |
| Personalized distill | `.unfade/profile/reasoning_model.json` (v2) | PERSONALIZATION section in `.unfade/distills/YYYY-MM-DD.md` |
| Amplifier v2 | `.unfade/graph/decisions_index.json`, `.unfade/distills/*.md`, `.unfade/profile/reasoning_model.json` | `.unfade/amplification/connections.jsonl`, `.unfade/graph/decisions_index.json` |
| Pattern feedback | POST `/feedback` input | `.unfade/amplification/feedback.jsonl` |
| Profile web UI v2 | `.unfade/profile/reasoning_model.json` (v2) | HTTP response (HTML) |
| ProfileCard TUI | `.unfade/profile/reasoning_model.json` (v2) | stderr (Ink render) |
| Enhanced search | `.unfade/graph/decisions_index.json`, `.unfade/profile/reasoning_model.json` | HTTP response (HTML) |

#### Key Data Contracts

**ReasoningModelV2 schema:** Defined in Section 4.2 above. Profile builder MUST produce this exact shape. All consumers (distill, web UI, TUI, MCP tools) read this schema.

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

**Amplification matching rules (conservative):**
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

#### File Tree Changes (Phase 4)

- **Removed:** `src/commands/profile.ts` — profile visualization moved to web UI `/profile` page
- **Removed:** `src/commands/similar.ts` — similar-decision search moved to web UI `/search` page + MCP tool
- **Added:** `src/server/pages/profile.ts` — enhanced with personalization v2 data (decision style radar, domain distribution, patterns)
- **Note:** `src/server/pages/search.ts` was added in Phase 3; enhanced here with personalization weighting

---

### Sprint 4A — Personalization Engine Core (TypeScript, 4 tasks)

> **Objective:** Build the pure algorithmic core — pattern detector, domain tracker, profile builder, and v1→v2 migration. No UI, no MCP, no distill integration. Output: `reasoning_model.json` v2 written correctly from accumulated events.

**Acid test:**
```bash
pnpm test -- --grep "pattern-detector|domain-tracker|profile-builder|migrations"
# All 14 tests pass

# Verify profile migration
node -e "
  const fs = require('fs');
  const v1 = { version: 1, dataPoints: 10 };
  fs.writeFileSync('.unfade/profile/reasoning_model.json', JSON.stringify(v1));
"
# Run migration → produces v2 with all new fields computed from events
cat .unfade/profile/reasoning_model.json | jq '.version' # → 2
ls .unfade/profile/reasoning_model.v1.backup.json # → exists
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-070** | Pattern detector v2: analyze accumulated decisions for recurring patterns — decision breadth, exploration depth by domain, AI interaction style, trade-off preferences. Output patterns with confidence scores. Patterns only surface at >0.7 confidence | `src/services/personalization/pattern-detector.ts` | [x] |
| **UF-071** | Domain tracker v2: track expertise evolution over time — frequency, depth progression (shallow → moderate → deep), cross-domain connections, complexity trends. Calculate depth trend (stable/deepening/broadening) | `src/services/personalization/domain-tracker.ts` | [x] |
| **UF-072** | Profile builder v2: upgrade `reasoning_model.json` to v2 schema (Section 4.2) — merge new data with running averages, apply temporal decay (recent data weighted 2x), detect trade-off preferences from decision history, calculate confidence scores. Consumes pattern detector + domain tracker output | `src/services/personalization/profile-builder.ts` | [x] |
| **UF-077** | Profile migration: v1 → v2 schema migration for `reasoning_model.json`. Preserve accumulated data, compute new fields from historical events. Write backup to `reasoning_model.v1.backup.json` | `src/config/migrations.ts` | [x] |

> **Agent Directive:** "You are building the personalization engine core — pure algorithmic logic with NO UI and NO HTTP/MCP integration. UF-070 pattern-detector takes an array of decisions and returns detected patterns with confidence scores. UF-071 domain-tracker takes decisions and returns domain distribution with depth/trend data. UF-072 profile-builder orchestrates both, merges with existing profile, applies temporal decay, and writes `reasoning_model.json` v2 (schema in Section 4.2 of this doc). UF-077 handles migration from v1→v2 with backup. All modules are pure functions over data — no side effects beyond file I/O to `.unfade/profile/`. Import schemas from `src/schemas/`. Use `src/utils/paths.ts` for all path resolution."

**Strict Contracts:**
- Pattern detector input: `Decision[]` → output: `Pattern[]` (with confidence, category, examples count)
- Domain tracker input: `Decision[]` → output: `DomainDistribution[]` (with depth, depthTrend, frequency)
- Profile builder input: `Pattern[]` + `DomainDistribution[]` + existing `ReasoningModelV2 | null` → output: `ReasoningModelV2` written to disk
- Migration: reads v1, produces v2, writes backup — non-destructive

---

### Sprint 4B — Distill & Amplification Pipeline (TypeScript, 3 tasks)

> **Objective:** Wire personalization into the distill pipeline and upgrade amplification to cross-domain. Add feedback mechanism. Output: distills contain PERSONALIZATION section, amplification surfaces cross-domain connections, feedback adjusts thresholds.

**Acid test:**
```bash
pnpm test -- --grep "distiller|amplifier|feedback"
# All 6 tests pass

unfade distill
cat .unfade/distills/YYYY-MM-DD.md
# → Contains PERSONALIZATION section with baseline comparisons
# → Contains CONNECTIONS section with cross-domain links (if data exists)

curl -X POST http://localhost:7654/feedback \
  -H 'Content-Type: application/json' \
  -d '{"connection_id":"conn-001","helpful":false}'
# → 200 OK, feedback stored in .unfade/amplification/feedback.jsonl
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-073** | Personalization in distill: add PERSONALIZATION section to Daily Distill — decision style summary, domain depth comparison, emerging patterns (>0.7 confidence), comparison to personal baseline. Reads `reasoning_model.json` v2 | `src/services/distill/distiller.ts` | [x] |
| **UF-078** | Amplification v2: cross-temporal AND cross-domain connection surfacing. Builds/updates `graph/decisions_index.json` inverted index. Uses matching rules (≥2 signals, score > 0.3). Generates connection insights. Writes to `amplification/connections.jsonl`. Appends CONNECTIONS section to distill | `src/services/distill/amplifier.ts` | [x] |
| **UF-079** | Pattern feedback mechanism: `POST /feedback` HTTP endpoint accepts `{ connection_id, helpful }`. Stores in `amplification/feedback.jsonl`. Future amplification reads feedback to adjust matching thresholds (>30% unhelpful for a domain → raise threshold). Blind spot detection: domains with `decision_count ≥ 5` and `avg_alternatives < 1.5` flagged in PERSONALIZATION section | `src/services/personalization/feedback.ts`, `src/server/routes/feedback.ts` | [x] |

> **Agent Directive:** "You are wiring the personalization engine (Sprint 4A) into the distill pipeline and upgrading amplification. UF-073 modifies the existing distiller to read `reasoning_model.json` v2 and append a PERSONALIZATION section after Stage 3 synthesis. UF-078 upgrades the existing amplifier (from Phase 3) to support cross-domain matching using the decisions_index.json inverted index — use the matching rules from Phase 4 Boundary. UF-079 adds the feedback loop: HTTP POST endpoint + JSONL storage + threshold adjustment. Also adds blind spot detection logic to the personalization section. All I/O paths via `src/utils/paths.ts`. Feedback JSONL schema: `{ connection_id: string, helpful: boolean, timestamp: string, domain?: string }`."

**Strict Contracts:**
- Personalized distill reads `ReasoningModelV2` → appends markdown section with decision style, domain comparison, emerging patterns
- Amplifier v2 reads/writes `decisions_index.json` (schema in Phase 4 Boundary) + writes `connections.jsonl` (connection schema in Phase 4 Boundary)
- Feedback endpoint: `POST /feedback` → `{ connection_id: string, helpful: boolean }` → stored in `feedback.jsonl`
- Blind spot: `decision_count ≥ 5 AND avg_alternatives < 1.5` → severity formula in Phase 4 Boundary

---

### Sprint 4C — UI & MCP Exposure (TypeScript, 3 tasks)

> **Objective:** Surface personalization to users via web UI, TUI, and enhanced MCP tools. Output: `/profile` page shows full reasoning profile v2, ProfileCard in TUI dashboard, `/search` page uses personalization weighting.

**Acid test:**
```bash
pnpm test -- --grep "profile.test|search.test|ProfileCard"
# All 5 tests pass

open http://localhost:7654/profile
# → Decision style radar, domain distribution, patterns with confidence bars

unfade dash
# → ProfileCard visible with domain bars, decision style, trend arrows

# In Claude Code with Unfade MCP:
> "Are there similar decisions I've made before about caching?"
# → Agent calls unfade_similar → returns personalization-weighted results
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-074** | Profile web UI page (v2): enhanced `/profile` page with decision style radar, domain distribution chart, top patterns with confidence bars, temporal activity heatmap, AI interaction summary. MCP tool `unfade_profile` and HTTP endpoint `/profile` remain available | `src/server/pages/profile.ts` | [x] |
| **UF-075** | ProfileCard Ink component: visual reasoning profile with domain bars, pattern list, decision style indicators, trend arrows for evolving metrics — displayed in TUI dashboard | `src/components/ProfileCard.tsx` | [x] |
| **UF-076** | Enhanced similar-decision search: weighted similarity using personalization — match by domain, decision style, trade-off pattern, not just keywords. Web UI `/search` page (added in Phase 3) enhanced with personalization weighting. MCP tool `unfade_similar` is the primary agent consumption path. `unfade query "..."` CLI covers both keyword and similar search from terminal | `src/server/pages/search.ts`, `src/services/distill/amplifier.ts` | [x] |

> **Agent Directive:** "You are building the user-facing layer for personalization. UF-074 enhances the existing `/profile` web UI page to display ReasoningModelV2 data — decision style radar (htmx partial), domain distribution chart, patterns with confidence bars, temporal heatmap. UF-075 builds a ProfileCard Ink component for the TUI dashboard — reads `reasoning_model.json` v2 and renders domain bars, pattern list, decision style summary, trend arrows. UF-076 enhances the existing `/search` page (from Phase 3) with personalization-weighted matching: when computing similarity, weight by domain relevance from profile, decision style match, and trade-off pattern overlap. All rendering to stderr (TUI) or HTTP response (web). stdout is sacred — MCP only."

**Strict Contracts:**
- Profile page reads `ReasoningModelV2` → renders HTML with htmx partials. Same data available via `unfade_profile` MCP tool (existing) and `GET /profile` HTTP endpoint
- ProfileCard reads `ReasoningModelV2` → renders to stderr via Ink. Shows: top 3 domains with bars, decision style (breadth + AI rate), active patterns count, trend arrows
- Enhanced search: similarity score = `keyword_match * 0.4 + domain_match * 0.3 + style_match * 0.2 + tradeoff_match * 0.1` (personalization weights)

---

### Tests

| Sprint | Test | What It Validates | File |
|---|---|---|---|
| 4A | **T-186** | Pattern detector: detects "high alternatives evaluator" pattern from decision history | `test/services/personalization/pattern-detector.test.ts` |
| 4A | **T-187** | Pattern detector: detects trade-off preference from consistent choices | `test/services/personalization/pattern-detector.test.ts` |
| 4A | **T-188** | Pattern detector: confidence increases with more supporting examples | `test/services/personalization/pattern-detector.test.ts` |
| 4A | **T-189** | Pattern detector: contradicting evidence reduces confidence | `test/services/personalization/pattern-detector.test.ts` |
| 4A | **T-190** | Pattern detector: returns no patterns below 0.7 confidence | `test/services/personalization/pattern-detector.test.ts` |
| 4A | **T-191** | Pattern detector: detects AI modification rate by domain | `test/services/personalization/pattern-detector.test.ts` |
| 4A | **T-192** | Domain tracker: tracks frequency distribution across domains | `test/services/personalization/domain-tracker.test.ts` |
| 4A | **T-193** | Domain tracker: detects depth progression (shallow → moderate → deep) | `test/services/personalization/domain-tracker.test.ts` |
| 4A | **T-194** | Domain tracker: identifies cross-domain connections | `test/services/personalization/domain-tracker.test.ts` |
| 4A | **T-195** | Domain tracker: calculates depth trend (stable/deepening/broadening) | `test/services/personalization/domain-tracker.test.ts` |
| 4A | **T-196** | Profile builder v2: merges new data with running averages | `test/services/personalization/profile-builder.test.ts` |
| 4A | **T-197** | Profile builder v2: applies temporal decay (recent data weighted higher) | `test/services/personalization/profile-builder.test.ts` |
| 4A | **T-198** | Profile builder v2: detects trade-off preferences from history | `test/services/personalization/profile-builder.test.ts` |
| 4A | **T-199** | Profile builder v2: handles v1 → v2 migration | `test/services/personalization/profile-builder.test.ts` |
| 4B | **T-200** | Personalized distill: includes PERSONALIZATION section | `test/services/distill/personalized-distiller.test.ts` |
| 4B | **T-201** | Personalized distill: comparison to personal baseline | `test/services/distill/personalized-distiller.test.ts` |
| 4B | **T-202** | Personalized distill: only shows patterns above 0.7 confidence | `test/services/distill/personalized-distiller.test.ts` |
| 4B | **T-203** | Amplification v2: surfaces cross-domain connection | `test/services/distill/amplifier-v2.test.ts` |
| 4B | **T-204** | Amplification v2: includes trade-off reasoning comparison | `test/services/distill/amplifier-v2.test.ts` |
| 4B | **T-205** | Pattern feedback: correction adjusts confidence scores | `test/services/personalization/feedback.test.ts` |
| 4C | **T-206** | Web UI profile page: displays decision style summary | `test/server/pages/profile-v2.test.ts` |
| 4C | **T-207** | Web UI profile page: displays domain distribution | `test/server/pages/profile-v2.test.ts` |
| 4C | **T-208** | Web UI profile page: displays patterns with confidence | `test/server/pages/profile-v2.test.ts` |
| 4C | **T-209** | Web UI search page + MCP tool `unfade_similar`: uses personalization for weighted matching | `test/services/distill/personalized-search.test.ts` |
| 4C | **T-210** | Web UI search page + MCP tool `unfade_similar`: finds cross-domain similar decisions | `test/services/distill/personalized-search.test.ts` |

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
| **Test count** | 185+ (Phase 3) | 210+ tests, all passing | `pnpm test` |

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

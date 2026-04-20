# Phase 3 — Identity & Personalization

> **Feature Statement:** _"Unfade doesn't just summarize your day -- it knows how you think. Your Unfade Card shows reasoning patterns, not commit counts. Your profile reveals you evaluate 3.2 alternatives on average, favor simplicity for frontend but go deep on database decisions, and modify 60% of AI suggestions. Terminal capture adds the richest debugging signal. Together, they transform Unfade from a capture tool into a reasoning partner that builds your developer identity over time."_
>
> **Prerequisites:** [Phase 2 — Context & Integration](./PHASE_2_CONTEXT_AND_INTEGRATION.md) complete (MCP server running, HTTP API available, query engine working)
>
> **Position in roadmap:** [Foundation (Phase 0)](./PHASE_0_FOUNDATION.md) → [Capture & Intelligence (Phase 1)](./PHASE_1_CAPTURE_AND_INTELLIGENCE.md) → [Context & Integration (Phase 2)](./PHASE_2_CONTEXT_AND_INTEGRATION.md) → **Identity & Personalization (Phase 3)** → [Platform & Launch (Phase 4)](./PHASE_4_PLATFORM_AND_LAUNCH.md)
>
> **Inspired by:** GitHub contribution graph (heatmap identity), Spotify Wrapped (shareable personal data), Spotify Discover Weekly (learns from patterns, surfaces novelty), OG image generation patterns (`@vercel/og`, `satori`), GitHub Copilot's style adaptation

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Summary](#6-implementation-summary)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 3 delivers three capabilities that serve complementary strategic goals:

1. **Unfade Cards** -- the viral marketing unit. Every card shared on X/LinkedIn/Reddit is a self-contained demonstration of what Unfade does. The card creates aspiration-driven adoption: "I want MY reasoning day to look like that." Cards show reasoning patterns and domain expertise, not commit counts or lines of code.

2. **Terminal capture** -- the richest signal source. Git captures what you decided. AI sessions capture what you asked. Terminal captures the *exploration process*: retries, debugging sessions, error patterns, command sequences. This is the signal that transforms distills from "you made decisions" to "you spent 40 minutes debugging JWT validation, tried 3 approaches, and the root cause was validation order."

3. **Personalization engine** -- the competitive moat. The personalization engine is the single capability that defeats every competitor in the landscape. 11 capture tools capture data; Unfade produces *understanding*. 5 MCP memory servers remember what you decided; Unfade learns *how* you decide. IDE vendors learn preferences ("user likes TypeScript"); Unfade learns reasoning patterns ("user evaluates 3+ alternatives for infrastructure, accepts first approach for frontend").

### 1.2 The Principle

> **The temporal moat: a competitor can replicate capture in weeks, MCP server in days, Thinking Graph in months. They cannot produce months of your reasoning patterns without months of observation. Personalization is the one capability where time itself is the barrier to entry.**

### 1.3 Dual Projection

The same evidence (captured reasoning, detected patterns, domain expertise) serves two audiences:

- **Developer detail view** -- the individual sees their reasoning profile, patterns, blind spots, and growth over time. The Unfade Card is the shareable artifact.
- **Leadership aggregate view** -- teams see aggregate reasoning health, domain coverage, and knowledge distribution. No individual surveillance -- aggregate patterns only.

---

## 2. The Problem

### Current State (after Phase 2)

Distills exist and are queryable via MCP/HTTP -- but they're text files visible only to the developer. There's no shareable artifact. Terminal activity (the richest debugging signal) is not captured. The personalization *seed* exists (Phase 1 basic metrics), but it's static: it counts, it doesn't learn. Distills are the same quality regardless of how much data has accumulated.

### After Phase 3

| Concern | State |
|---|---|
| **Unfade Card** | Web UI `/cards` page provides preview, generation for any date, and PNG download. API endpoint `POST /cards/generate` powers the interface. Rendering pipeline: satori (JSX to SVG) then resvg-js (SVG to PNG) -- dark theme, top decisions, domain tags, reasoning depth indicator. OG-compatible 1200x630 |
| **Card sharing** | Card image generated locally via web UI. Developer shares manually (attach to tweet, paste in Slack). Hosting (unfade.dev/username) is a later-phase concern |
| **Terminal capture** | Shell hooks installed during `unfade init` (reinstallable from web UI `/settings`). `unfade-send` Go binary sends IPC envelope to capture engine via Unix socket. Terminal events are P1 in signal hierarchy |
| **Debugging detection** | Go daemon detects patterns: same command run 3x with different args -> "exploration pattern." Error then retry then success -> "debugging session" |
| **Reasoning Profile** | Full `reasoning_model.json` v2 with decision style, trade-off preferences, domain depth, exploration patterns -- learned from accumulated data |
| **Pattern Detection** | Identifies recurring patterns: "favors simplicity over flexibility," "evaluates 3+ alternatives for infrastructure," "tends to accept frontend defaults" |
| **Domain Tracking** | Tracks domain expertise evolution: frequency, depth progression (shallow to moderate to deep), cross-domain connections, temporal decay |
| **Personalized Distills** | PERSONALIZATION section in every distill with baseline comparisons, emerging patterns, blind spot warnings |
| **Amplification** | Cross-session and cross-domain connection detection. Blind spot quantification. Feedback mechanism for threshold adjustment |
| **Comprehension Score** | Human Direction Score (HDS) measures whether developer understands and directs AI-assisted code, not just accepts it |
| **Profile visualization** | Web UI `/profile` page displays full reasoning profile. MCP tool `unfade_profile` and HTTP endpoint available for agents |

---

## 3. Research

### 3.1 OG Image Generation

| Technology | Pros | Cons | Verdict |
|---|---|---|---|
| **`satori`** (Vercel) | JSX to SVG, no browser needed, fast, small | SVG only (needs `resvg-js` for PNG) | **Best fit** -- JSX rendering, lightweight |
| **`@vercel/og`** | Built on satori, adds PNG conversion | Designed for edge runtime, heavier | Use satori directly |
| **Puppeteer/Playwright** | Full browser rendering | Heavy dependency (300MB+), slow | Too heavy for CLI |
| **Canvas (node-canvas)** | Direct pixel manipulation | Native dependency, complex layout | Too low-level |

**Unfade uses satori + @resvg/resvg-js.** Both are declared in `package.json`. satori renders JSX to SVG; resvg-js converts SVG to PNG. No browser dependency, no native compilation.

### 3.2 Terminal Capture Patterns

| Approach | How It Works | Pros | Cons |
|---|---|---|---|
| **Shell hook (preexec/precmd)** | zsh `preexec` captures command before execution, `precmd` captures exit code after | Lightweight, no latency, captures intent | Requires shell-specific hooks |
| **Script/tee wrapper** | Wrap shell in `script` or pipe through tee | Captures full output | Adds latency, complex setup |
| **PTY proxy** | Interpose a pseudo-terminal | Full capture with no user-visible change | Complex, potential compatibility issues |

**Unfade uses shell hooks (preexec/precmd).** Lightweight, captures the right signal (commands + exit codes), zero latency, well-understood pattern. The `unfade-send` Go binary (`daemon/cmd/unfade-send/main.go`) handles IPC communication to the capture engine via Unix socket with registry-based socket resolution.

### 3.3 Personalization Models in Adjacent Products

| Product | What It Personalizes | How It Learns | Limitation |
|---|---|---|---|
| **Cursor Memory** | Coding preferences ("user likes TypeScript, prefers functional style") | Explicit user statements + inferred from code | Preference-level only. No reasoning patterns |
| **ChatGPT Memory** | Conversation preferences, facts about user | Explicit "remember this" + auto-detect | Fact-level only. No reasoning model |
| **Spotify Discover Weekly** | Music recommendations | Listening patterns, collaborative filtering | Different domain but analogous approach |
| **GitHub Copilot** | Code suggestions | Previous code in context window | Per-session only. No persistent learning |

**Key insight:** Zero tools in the April 2026 landscape (35+ surveyed) learn *how* a developer thinks. They all learn *what* a developer likes. Unfade's personalization engine occupies an empty category.

### 3.4 Reasoning Dimensions to Track

| Dimension | What It Measures | How to Detect | Example Output |
|---|---|---|---|
| **Decision breadth** | How many alternatives evaluated per decision | Count distinct approaches in git branches, AI conversations | "3.2 alternatives per decision (above baseline)" |
| **Exploration depth** | Time invested before deciding | Time between first event and final commit per decision | "Spends 2.1x longer on infrastructure vs frontend" |
| **AI interaction style** | How developer uses AI suggestions | Acceptance vs modification vs rejection from AI session logs | "Modifies 60% of AI suggestions -- highest in auth code" |
| **Trade-off preferences** | Consistent patterns in decision-making | Repeated choices across similar trade-offs | "Favors simplicity over flexibility (8 of 10 trade-offs)" |
| **Domain distribution** | What areas the developer reasons about | Domain tags from decisions | "Top: backend (45%), databases (25%), auth (15%)" |
| **Domain depth** | Expertise progression over time | Complexity of decisions in each domain | "Database decisions increasing in complexity month-over-month" |

---

## 4. Architecture

### 4.1 Unfade Card -- Data Flow

```
.unfade/distills/YYYY-MM-DD.md
        |
        v
+------------------+
| Card Generator   |  (src/services/card/generator.ts)
|                  |
| Parse distill    |
| Extract:         |
|  - Top decisions |
|  - Domain tags   |
|  - Reasoning     |
|    depth score   |
|  - Dead ends     |
|    count         |
+--------+---------+
         |
         v
+------------------+
| Card Template    |  (src/services/card/templates.ts)
|                  |
| JSX -> satori    |
| -> SVG -> resvg  |
| -> PNG           |
+--------+---------+
         |
         v
  .unfade/cards/YYYY-MM-DD.png
```

Card dimensions: 1200x630 pixels (OG-compatible for X/LinkedIn). Dark theme (background #1a1a2e, text #e0e0e0). Content: UNFADE branding header, top 3 decision one-liners, domain tag pills, reasoning depth bar, stats footer (dead ends, decisions, AI modified %). Target file size under 500KB. Domain-to-color mapping uses a deterministic hash of the domain string to an HSL hue for consistent colors across cards.

The card data includes identity metrics from the personalization engine: Reasoning Depth Index (RDI), identity labels, Human Direction Score, and top domain expertise levels. The web UI at `/cards` (`src/server/pages/cards.ts`) shows an identity banner above the card generator when profile data exists.

### 4.2 Terminal Capture -- Shell Hook

Shell hooks are installed during `unfade init` into the user's shell config (`.zshrc`, `.bashrc`). The hooks capture:

- **preexec**: command string and start timestamp
- **precmd**: exit code and duration

The hook sends a JSON envelope `{ cmd, exit, duration, cwd }` to the capture engine via `unfade-send`, which resolves the correct daemon socket through a three-step process:

1. If `--project-dir` is set, use `<project-dir>/.unfade/state/daemon.sock`
2. Otherwise, read `registry.v1.json` and find longest-prefix match for cwd
3. Fallback to `~/.unfade/state/daemon.sock`

Communication is non-blocking -- the hook runs backgrounded with `&` and includes `2>/dev/null` for silent failure when the daemon is not running.

### 4.3 Terminal Event Types

| Terminal Pattern | How Detected | CaptureEvent Type | Reasoning Signal |
|---|---|---|---|
| **Command execution** | preexec hook | `command` | What tools/commands used |
| **Error** | Non-zero exit code | `error` | What went wrong |
| **Retry** | Same base command, different args, after error | `retry` | Debugging exploration |
| **Debugging session** | 3+ retries within 10 minutes on related commands | `debugging_session` | Time invested, approaches tried |

Debugging session detection rules: 3+ commands within a 10-minute window, commands are "related" (same base binary, same target file, or same cwd), and at least one command has a non-zero exit code. Related-commands heuristic uses first-token matching for base binary, path-like token detection for target file, and cwd + time proximity.

### 4.4 Personalization Engine

```
Capture Events (daily)
        |
        v
+-------------------+
| Pattern Detector  |  (src/services/personalization/pattern-detector.ts)
|                   |
| Decision style    |  -> alternatives count, exploration depth
| Trade-off prefs   |  -> simplicity vs flexibility, speed vs correctness
| AI interaction    |  -> acceptance rate, modification patterns
+--------+----------+
         |
         v
+-------------------+
| Domain Tracker    |  (src/services/personalization/domain-tracker.ts)
|                   |
| Domain frequency  |  -> which areas, how often
| Depth progression |  -> shallow -> moderate -> deep
| Cross-domain      |  -> connections between domains
+--------+----------+
         |
         v
+-------------------+
| Profile Builder   |  (src/services/personalization/profile-builder.ts)
|                   |
| Merge new data    |  -> running averages, temporal decay
| Detect patterns   |  -> confidence thresholds (>0.7)
| Write profile     |  -> .unfade/profile/reasoning_model.json (v2)
+--------+----------+
         |
         v
+-------------------+
| Context Shaper    |  (src/services/personalization/context-shaper.ts)
|                   |
| Shape MCP context |  -> adapt to developer's profile
| Shape distill     |  -> personalized observations
+-------------------+
```

Additionally, `src/services/personalization/cross-session-detector.ts` scans `decisions.jsonl` for recurring reasoning patterns across sessions (clusters of decisions sharing key terms that appear 3+ times), and `src/services/personalization/feedback.ts` provides the correction mechanism for pattern adjustments.

### 4.5 ReasoningModelV2 Schema

The full personalization profile lives at `.unfade/profile/reasoning_model.json` and is defined by `ReasoningModelV2Schema` in `src/schemas/profile.ts`. Key sections:

- **`decisionStyle`** -- average and median alternatives evaluated, exploration depth (overall and by domain), AI acceptance and modification rates (overall and by domain)
- **`tradeOffPreferences`** -- array of detected preferences (e.g., "simplicity over flexibility") with confidence, supporting/contradicting decision counts, and observation dates
- **`domainDistribution`** -- array of domains with frequency, percentage, last-seen date, depth level (shallow/moderate/deep), depth trend (stable/deepening/broadening), and average alternatives
- **`patterns`** -- array of detected reasoning patterns with confidence, observation dates, example count, and category (decision_style, trade_off, domain, ai_interaction, exploration)
- **`temporalPatterns`** -- most productive hours, average decisions per day, peak decision days
- **`uifMetrics`** (optional) -- Unfade Intelligence Framework scores: RDI (Reasoning Depth Index), DCS (Decision Consistency Score), AQ (Adaptability Quotient), CWI (Complexity Weighting Index), API Score
- **`identityLabels`** (optional) -- behavioral patterns surfaced as named identity traits with confidence and category
- **`directionPatterns`** (optional) -- Human Direction Score tracking: running average HDS, trend (improving/stable/declining), common signals, per-domain HDS

Profile migration from v1 to v2 (`src/config/migrations.ts`) preserves accumulated data, computes new fields from historical events, and writes a backup to `reasoning_model.v1.backup.json`.

### 4.6 Amplification and Cross-Session Detection

Amplification operates at two levels:

**Cross-temporal connections:** Compare today's decisions against past distills. Surface connections like "You evaluated Redis vs Memcached today. On 2026-03-28, you made a similar evaluation and chose Memcached for throughput." Uses keyword overlap (Jaccard similarity on tokenized words) plus domain match bonus. Relevance threshold: 0.7 minimum.

**Cross-domain connections (amplification v2):** An inverted index (`graph/decisions_index.json`) indexes decisions by domain, keyword, and file path. Matching requires at least 2 signals (domain + keyword, or keyword + file). Connections are written to `amplification/connections.jsonl`.

**Blind spot quantification:** A domain is a blind spot candidate when `decision_count >= 5` and `avg_alternatives_per_decision < 1.5`. Surfaced non-judgmentally as "You've made N decisions in [domain] but evaluated only X alternatives on average." Dismissable via the feedback mechanism.

**Feedback loop:** `POST /feedback` accepts `{ connection_id, helpful }`, stores in `amplification/feedback.jsonl`. When >30% of connections for a domain are marked unhelpful, the matching threshold is raised. Corrections also adjust pattern confidence scores in the profile.

### 4.7 Personalized Distill Section

When the personalization engine has sufficient data, distills include a PERSONALIZATION section:

- Decision style summary with comparison to personal baseline
- Domain depth comparison (e.g., "2.1x longer on infrastructure vs frontend")
- Emerging patterns above 0.7 confidence
- Blind spot warnings
- Cross-domain amplification connections

### 4.8 File Tree

```
src/
  services/
    card/
      generator.ts          # Parse distill -> card data extraction + PNG generation
      templates.ts           # JSX card template for satori rendering
    cards/
      identity.ts            # Load identity data for card rendering
    shell/
      installer.ts           # Shell hook installer (called from unfade init)
    distill/
      amplifier.ts           # Cross-temporal and cross-domain connection detection
    personalization/
      pattern-detector.ts    # Decision[] -> PatternV2[] (confidence-gated)
      domain-tracker.ts      # Decision[] -> DomainDistributionV2[]
      profile-builder.ts     # Orchestrates pattern + domain -> ReasoningModelV2
      context-shaper.ts      # Shape MCP/distill context using profile
      cross-session-detector.ts  # Recurring patterns across sessions
      feedback.ts            # Pattern correction and feedback storage
  schemas/
    profile.ts               # ReasoningModelV2Schema (Zod, single source of truth)
  server/
    pages/
      cards.ts               # GET /cards -- card preview/generate/download page
      search.ts              # GET /search -- similar-decision search page
      profile.ts             # GET /profile -- reasoning profile visualization
    routes/
      cards.ts               # POST /cards/generate -- card generation API
      feedback.ts            # POST /feedback -- pattern feedback endpoint
  tools/
    unfade-amplify.ts        # unfade_amplify MCP tool
    unfade-similar.ts        # unfade_similar MCP tool
  commands/
    export.ts                # unfade export CLI command
  config/
    migrations.ts            # Profile v1 -> v2 migration

daemon/
  cmd/
    unfade-send/
      main.go                # IPC client for shell hooks (socket resolution)
  internal/
    capture/
      terminal.go            # Terminal event receiver (Unix socket)
      debugging.go           # Debugging session + retry pattern detection
```

### 4.9 Data Flow Boundaries

| Component | Reads | Writes |
|---|---|---|
| Card generator | `.unfade/distills/*.md`, `.unfade/profile/reasoning_model.json` | `.unfade/cards/YYYY-MM-DD.png` |
| Terminal capture (Go) | Unix socket input from shell hooks | `.unfade/events/YYYY-MM-DD.jsonl` |
| Pattern detector | `.unfade/events/*.jsonl`, `.unfade/distills/*.md` | In-memory patterns to profile builder |
| Domain tracker | `.unfade/events/*.jsonl`, `.unfade/profile/reasoning_model.json` | In-memory domain data to profile builder |
| Profile builder | Pattern detector + domain tracker output | `.unfade/profile/reasoning_model.json` (v2) |
| Amplifier | `.unfade/distills/*.md`, `.unfade/graph/decisions_index.json`, `.unfade/profile/reasoning_model.json` | `.unfade/amplification/connections.jsonl`, `.unfade/graph/decisions_index.json` |
| Feedback | POST `/feedback` input | `.unfade/amplification/feedback.jsonl` |

Go daemon writes to `events/`. TypeScript reads events and writes everything else. One writer per file -- prevents corruption.

---

## 5. Design Principles

1. **The card is the product demo.** Every Unfade Card is a self-contained demonstration of what Unfade does. It must be beautiful enough that developers want to share it unprompted.

2. **Terminal capture adds zero latency.** The shell hook sends data asynchronously via the `unfade-send` binary (backgrounded). The developer should never notice it's there. Silent failure when the daemon is not running.

3. **Debugging sessions are gold.** When terminal capture detects a debugging session (retries, errors, eventual success), this is the highest-value signal for distillation. The distill should highlight these as "exploration narratives."

4. **Shell hooks are opt-in.** Installed during `unfade init` with explicit opt-in. Hook status is visible and reinstallable from the web UI `/settings` page. Idempotent installation.

5. **Personalization is always transparent.** The developer can inspect their reasoning profile via web UI `/profile` page or `unfade_profile` MCP tool and see exactly why each pattern was detected, with confidence levels and example counts. No black boxes.

6. **Conservative before confident.** Better to say "insufficient data" than to make a wrong pattern assertion. Patterns only surface at >0.7 confidence. New dimensions start hidden and graduate to visible as data accumulates.

7. **Corrections feed back.** If the developer says "this pattern is wrong," that feedback adjusts the model. The model improves from explicit corrections, not just accumulated data.

8. **Personalization enhances, never replaces.** The raw distill (decisions, trade-offs, dead ends) is always present. Personalization adds the PATTERNS section and shapes context delivery. Removing personalization degrades quality, it doesn't break functionality.

9. **Temporal decay.** Recent decisions weight more than old ones. Default: 2x weight for last 30 days. Established patterns (>20 examples) decay slower. Prevents stale patterns from dominating.

10. **Cross-domain connections are the surprise.** The highest-value personalization insight is "you made a similar decision in a different domain" -- this is the amplification moment that creates delight.

---

## 6. Implementation Summary

Phase 3 spans both TypeScript and Go, with strict isolation between the two. The implementation covers:

**Card rendering pipeline (TypeScript):** Parse Daily Distill Markdown to extract CardData (top decisions, domain tags, reasoning depth, dead ends, AI modification rate). Render JSX template via satori to SVG, convert via resvg-js to PNG. Web UI `/cards` page with date picker, generate button (htmx), preview, and download. API endpoint `POST /cards/generate` returns PNG with `_meta` envelope.

**Terminal capture (Go):** Unix socket listener in the daemon receives JSON payloads from shell hooks. Debugging session detector buffers terminal events per cwd with 10-minute TTL, emits synthetic `debugging_session` CaptureEvents when patterns are detected. Platform support: Unix domain socket on macOS/Linux, named pipe on Windows.

**Shell hooks and export (TypeScript):** Shell hook installer detects shell type (zsh/bash), generates appropriate hook code, appends to shell config with idempotent marker comments. `unfade export` creates `.tar.gz` archive of `.unfade/` excluding ephemeral state (sockets, PIDs, binaries).

**Personalization engine core (TypeScript):** Pattern detector analyzes accumulated decisions for recurring patterns across five categories (decision_style, trade_off, domain, ai_interaction, exploration). Domain tracker monitors frequency, depth progression, and cross-domain connections. Profile builder orchestrates both, applies temporal decay, and writes `reasoning_model.json` v2 atomically (tmp + rename).

**Amplification v2 (TypeScript):** Cross-temporal and cross-domain connection detection with inverted index for O(1) lookups. Blind spot quantification. Feedback loop with threshold adjustment. MCP tools `unfade_amplify` and `unfade_similar` for agent consumption.

**Personalized context (TypeScript):** Context shaper adapts MCP responses and distill observations based on the developer's profile. Enhanced similar-decision search uses personalization-weighted matching: `keyword_match * 0.4 + domain_match * 0.3 + style_match * 0.2 + tradeoff_match * 0.1`.

**Profile visualization (TypeScript):** Web UI `/profile` page with decision style summary, domain distribution, patterns with confidence bars, and temporal activity data.

---

## 7. Success Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **Card generation time** | < 3 seconds | Timer in card generator |
| **Card visual quality** | OG preview renders correctly on X/LinkedIn | Manual test: share URL with card meta tag |
| **Card file size** | < 500KB PNG | File size check |
| **Terminal capture latency** | < 10ms per command (user-imperceptible) | Benchmark preexec to socket send |
| **Debugging session detection accuracy** | Detects 80%+ of actual debugging sessions | Manual review of 5 debugging sessions |
| **Profile accuracy** | Developer self-assessment > 70% agreement | Survey after 2 weeks of use |
| **Pattern detection precision** | > 80% of surfaced patterns rated "accurate" | Manual review + feedback mechanism |
| **Amplification relevance** | > 70% of connections rated "genuinely relevant" | "Not helpful" feedback rate < 30% |
| **Personalization section quality** | Developer reads personalization section daily (not skipped) | Usage observation |
| **Data points per profile** | > 50 decision observations for confident patterns | `reasoning_model.json` dataPoints field |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **satori rendering limitations** | Medium | Medium | satori supports a subset of CSS. Design within supported features. Fallback to simpler layout |
| **Shell hook compatibility** | Medium | Medium | Support zsh (primary) and bash. Test with oh-my-zsh, prezto, starship. Provide manual installation instructions for edge cases |
| **Terminal capture privacy** | Medium | High | Only capture command string and exit code. Do NOT capture command output. Document what is captured. Allow per-command opt-out (`# unfade:ignore`) |
| **Socket message loss** | Low | Low | Fire-and-forget via `unfade-send`. Lost terminal events are acceptable -- git and AI sessions are the primary sources |
| **Personalization feels uncanny or wrong** | Medium | High | Transparent profile (inspectable). Conservative confidence threshold (0.7). Correction mechanism. Better to be generically helpful than confidently wrong |
| **Insufficient data for meaningful patterns** | Medium | Medium | Require minimum observation counts before surfacing. Use backfilled git history to bootstrap. Clearly label "emerging" vs "established" patterns |
| **Trade-off preferences don't generalize** | Medium | Medium | Scope preferences by domain. Surface contradictions as insights, not errors |
| **Temporal decay too aggressive** | Low | Medium | Configurable decay rate. Default: 2x weight for last 30 days. Established patterns (>20 examples) decay slower |
| **Profile migration breaks existing data** | Low | High | Non-destructive migration: reads v1, computes v2 fields from historical events, writes v2. v1 file preserved as backup |
| **Amplification false positives** | Medium | Medium | Start conservative (high-confidence only). Add feedback mechanism. Surface max 2 amplifications per distill. Tighter threshold as data grows |

---

> **Phase sequence:** [Foundation (Phase 0)](./PHASE_0_FOUNDATION.md) → [Capture & Intelligence (Phase 1)](./PHASE_1_CAPTURE_AND_INTELLIGENCE.md) → [Context & Integration (Phase 2)](./PHASE_2_CONTEXT_AND_INTEGRATION.md) → **Identity & Personalization (Phase 3)** → [Platform & Launch (Phase 4)](./PHASE_4_PLATFORM_AND_LAUNCH.md)

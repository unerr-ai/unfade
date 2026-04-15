# Phase 5 — Ecosystem Launch

> **Feature Statement:** _"Unfade is live. Open source, MIT license, local-first. Install with `npx unfade init`. Your AI tools get persistent memory. You get a reasoning identity. The Thinking Graph renders your accumulated reasoning as a visual profile — a heatmap of decision density, domain evolution, and reasoning depth. The ClawHub skill and MCP Registry entry make Unfade discoverable by every agent in the ecosystem."_
>
> **Prerequisites:** [Phase 4 — Personalization & Amplification](./PHASE_4_PERSONALIZATION_AND_AMPLIFICATION.md) complete (full personalization engine, pattern detection, domain tracking, amplification v2)
>
> **Status:** AWAITING REVIEW
>
> **Inspired by:** GitHub's contribution graph (visual identity from activity), Spotify Wrapped (shareable personal data at scale), OpenClaw's ClawHub marketplace (skill ecosystem)
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

Phase 5 is the **launch phase**. Everything built in Phases 0–4 becomes publicly available, discoverable, and shareable. Three strategic objectives:

1. **Ecosystem distribution:** ClawHub skill + MCP Registry entry make Unfade discoverable by 354K-star OpenClaw community and 13K+ MCP server ecosystem without marketing spend.

2. **Visual identity:** The Thinking Graph transforms `.unfade/` data into a static site — a Decision Density Heatmap, domain evolution chart, reasoning profile card, and browsable distills. This is the "engineering identity through reasoning" artifact.

3. **Frictionless adoption:** npm publish enables `npx unfade init`. README with clear install instructions, GIF demos, architecture diagram. A stranger can install and get their first Distill in under 5 minutes.

### 1.2 The Principle

> **The Thinking Graph is the hiring signal. The ClawHub skill is the discovery channel. The npm package is the adoption path. Together, they create a flywheel: install → use → share Thinking Graph → others install.**

---

## 2. The Problem

### Current State (after Phase 4)

Unfade works end-to-end locally — capture, distill, personalize, query, amplify. But it's not published, not discoverable, and the reasoning data has no visual representation beyond terminal output and card images.

### After Phase 5

| Concern | State |
|---|---|
| **npm package** | `npx unfade init` works. Published to npm as `unfade` |
| **ClawHub skill** | `unfade-memory` skill on OpenClaw's ClawHub marketplace — organic discovery |
| **MCP Registry** | `server.json` published — discoverable by MCP ecosystem tooling |
| **Thinking Graph** | `unfade publish` generates a static site with heatmap, domain chart, profile card, browsable distills |
| **Self-hosted deploy** | Generated site deployable to Vercel/Netlify/GitHub Pages |
| **README** | Clear install instructions, GIF demos, architecture diagram, command reference |
| **E2E test** | Full workflow test: init → capture → distill → query → card → publish |
| **Polish** | Smart default command (`unfade` → TUI), `--json` output flag (`unfade query`, `unfade distill`, `unfade export`), config migration, error handling audit |

---

## 3. Research

### 3.1 Static Site Generation Patterns

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Raw HTML + CSS + SVG** | No build step, smallest output, full control | Manual DOM construction | **Best fit** — single-page, no framework needed, fastest generation |
| **Astro/11ty** | Template system, component model | Additional build dependency, overkill for single page | Too heavy |
| **React SSG** | Already in stack | Hydration bundle, runtime JS | Unnecessary — static data, no interactivity |

### 3.2 Heatmap Rendering

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **SVG (inline)** | Crisp at any size, no dependencies, accessible | Verbose for many cells | **Best fit** — GitHub contribution graph uses SVG |
| **Canvas** | Good for many data points | Not accessible, requires JS runtime | Not suitable for static site |
| **CSS Grid** | Pure HTML/CSS | Limited control, harder to style dynamically | Fallback option |

### 3.3 ClawHub Skill Format

| Requirement | How Unfade Meets It |
|---|---|
| **SKILL.md** | Progressive disclosure: one-line description → features → setup → usage |
| **MCP tools** | Already implemented: `unfade_query`, `unfade_distill`, `unfade_profile`, `unfade_context`, `unfade_decisions` |
| **Installation** | `npx unfade init` (scaffolds, downloads daemon, starts everything) |
| **Configuration** | Zero config for basic use. Optional LLM provider config |

---

## 4. Architecture

### 4.1 Thinking Graph — Static Site Structure

```
.unfade/site/                   # Generated by `unfade publish`
├── index.html                  # Single-page Thinking Graph
├── style.css                   # Dark theme, responsive
├── data.json                   # Pre-computed visualization data
└── assets/
    └── og-card.png             # OG image for social sharing
```

### 4.2 Thinking Graph — Visual Components

```
┌──────────────────────────────────────────────────────────────────┐
│  UNFADE THINKING GRAPH                        username           │
│  ════════════════════════════════════════════════════════════     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  DECISION DENSITY HEATMAP                                   │ │
│  │                                                              │ │
│  │  Jan ░░░░░█░░░░░░██░░░░░░░█░░░░                             │ │
│  │  Feb ░░░██░░░░░███░░░░░░██░░░░░                             │ │
│  │  Mar ░░░░██░░░░████░░░░░███░░░░                             │ │
│  │  Apr ░░░░░███░░░░██░░░░░░░░                                 │ │
│  │                                                              │ │
│  │  ░ = 0  ▒ = 1-3  ▓ = 4-7  █ = 8+  decisions/day            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────┐  ┌─────────────────────────────────┐  │
│  │  DOMAIN DISTRIBUTION  │  │  REASONING PROFILE              │  │
│  │                       │  │                                  │  │
│  │  backend   ████████   │  │  Alternatives: 3.2 avg          │  │
│  │  databases ██████     │  │  AI Modified:  60%               │  │
│  │  auth      ████       │  │  Dead Ends:    1.2/day           │  │
│  │  frontend  ███        │  │  Top Pattern:  "simplicity >     │  │
│  │  devops    ██         │  │                 flexibility"     │  │
│  └──────────────────────┘  └─────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  RECENT DISTILLS                                            │ │
│  │                                                              │ │
│  │  2026-04-14  Chose Redis for session cache, refactored...   │ │
│  │  2026-04-13  Debugged JWT validation order, 3 approaches... │ │
│  │  2026-04-12  Evaluated 4 auth middleware options...          │ │
│  │  2026-04-11  Accepted AI suggestion for API route naming...  │ │
│  │  ...                                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Powered by Unfade — unfade.dev                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 Data Pipeline

```
.unfade/events/*.jsonl
.unfade/distills/*.md
.unfade/profile/reasoning_model.json
        │
        ▼
┌──────────────────┐
│ Site Generator    │  (site-generator.ts)
│                   │
│ 1. Read all data  │
│ 2. Compute heatmap│  → decision count per day
│ 3. Extract domains│  → from reasoning model
│ 4. Compile distills│ → last 7-30 days
│ 5. Generate OG card│ → reuse card generator
│ 6. Render HTML    │  → inline CSS + SVG
└────────┬──────────┘
         │
         ▼
.unfade/site/index.html  (single file, deployable)
```

### 4.4 ClawHub Skill — SKILL.md Structure

```markdown
# unfade-memory

> Persistent reasoning memory for AI agents. Your AI tools remember
> what you were working on yesterday — and how you think.

## What it does
- Provides recent reasoning context from your development sessions
- Surfaces past decisions relevant to current work
- Adapts context to your reasoning style

## Setup
1. Run: `npx unfade init`
2. That's it — daemon, server, and shell hooks start automatically

## MCP Tools
- `unfade_query` — Search reasoning history
- `unfade_context` — Get recent context
- `unfade_decisions` — List past decisions
- `unfade_profile` — Your reasoning profile
- `unfade_distill` — Trigger reasoning summary
```

---

## 5. Design Principles

1. **A stranger gets value in 5 minutes.** `npx unfade init` → daemon starts → `unfade distill --backfill 7` → first Distill. If it takes longer, the install path is broken.

2. **The Thinking Graph is the resume.** It should be beautiful enough that developers link it in bios and job applications. Dark theme, clean typography, information density without clutter.

3. **ClawHub skill is the discovery path.** The skill description must immediately convey value. Progressive disclosure: one line → paragraph → full setup.

4. **Static means no runtime.** `unfade publish` generates HTML + CSS + SVG. No JavaScript runtime. No database. No server. Deploy to any static host.

5. **Polish is the product.** README quality, error messages, help text, edge case handling — these determine whether a first-time user becomes a repeat user.

---

---

## 5b. Execution Guide (Day 5: Ecosystem Launch & Thinking Graph)

> **Sourced from:** Master Execution Blueprint — consolidated tasks with acid tests, strict contracts, and agent directives for AI-agent-driven execution.

### Acid Test

```
# Stranger install test (clean machine)
npx unfade init
→ Fingerprint displayed, daemon running, server accessible

# Thinking Graph test
unfade publish
ls .unfade/site/
→ index.html, styles.css, heatmap.svg, decisions.json
# Deploy .unfade/site/ to Vercel → renders correctly

# ClawHub test
# Install unfade-memory skill on OpenClaw → MCP server connects

# npm test
npm pack
→ Package includes CLI, daemon binaries (via optional deps), correct bin entry
```

### Consolidated Tasks (5) with Agent Directives

#### Task 5.1: ClawHub Skill + MCP Registry

Package the MCP server as a ClawHub-installable skill and create the MCP Registry entry.

**Agent directive:** "Create `ecosystem/clawhub/SKILL.md` — progressive disclosure format: what Unfade provides (5 resources, 5 tools, 3 prompts), install instructions (`npx unfade init`), usage examples. Create `ecosystem/clawhub/manifest.json` — ClawHub manifest with skill metadata: name ('unfade-memory'), description, author, MCP server command. Create `ecosystem/mcp-registry/server.json` — standard MCP Registry entry with server name, description, transport config, resource/tool/prompt catalog. Test: verify the manifest matches ClawHub's expected schema."

#### Task 5.2: `unfade publish` (Static Site Generator)

Generate a deployable static site from `.unfade/` data — the Thinking Graph.

**Agent directive:** "Build `src/commands/publish.ts` — `unfade publish [--output dir]`. Reads `.unfade/` data and generates a static site in `.unfade/site/` (or specified output). The site includes: `index.html` (main page with all visualizations), `styles.css` (dark theme, developer-native), `decisions.json` (sanitized decision data for client-side rendering), `heatmap.svg` (Decision Density Heatmap). No JavaScript framework — pure HTML + CSS + inline SVG. The page layout: header (Unfade branding + developer name from git config), Decision Density Heatmap, Domain Distribution chart, Reasoning Profile card, last 7 days of distills (collapsible sections), footer ('Powered by Unfade — unfade.dev'). Deploy instructions printed after generation: 'Deploy .unfade/site/ to Vercel, Netlify, or GitHub Pages.'"

#### Task 5.3: Decision Density Heatmap

GitHub-style contribution heatmap where each cell is a day, colored by reasoning intensity (decisions + trade-offs + dead ends).

**Agent directive:** "Build the heatmap as an inline SVG in the static site generator. Read `graph/decisions.jsonl` to compute per-day intensity: `intensity = decisions + (trade_offs × 1.5) + (dead_ends × 2)` (dead ends weighted higher — they represent deeper exploration). Map intensity to 5 color levels (empty → light → medium → dark → highlight). Generate SVG: 52 columns (weeks) × 7 rows (days), each cell is a rounded rect. Include month labels along the top. Tooltip text on each cell: 'Apr 15: 3 decisions, 1 trade-off, 0 dead ends'. Export as both inline SVG (for the static site) and standalone `heatmap.svg`."

#### Task 5.4: npm Publish Preparation

Ensure the package is publishable as `npx unfade init` — correct bin entries, optional deps for daemon binaries, README.

**Agent directive:** "Update `package.json`: set `name` to 'unfade', `version` to '0.1.0', verify `bin.unfade` points to `dist/cli.js`, add `files` array (include `dist/`, exclude `src/`, `daemon/`, `docs/`). Add `optionalDependencies` for platform-specific daemon packages: `@unfade/daemon-darwin-arm64`, `@unfade/daemon-darwin-x64`, `@unfade/daemon-linux-x64`, `@unfade/daemon-linux-arm64`. For v1 launch: include pre-built daemon binaries in the package itself under `bin/` as a fallback (the optional deps pattern is the target but requires separate package publishing). Verify `npx unfade init` works end-to-end after `npm pack`."

#### Task 5.5: README + Launch Polish

Write a README that lets a stranger install and get value in under 5 minutes. Prepare launch posts.

**Agent directive:** "Write `README.md`: lead with the one-liner ('Your AI tools forget how you think. Unfade remembers.'), then the install command (`npx unfade init`), then a GIF/screenshot showing the fingerprint output, then 'What happens next' (daemon captures reasoning, daily distills, MCP integration). Keep it under 200 lines. Include: architecture diagram (ASCII, from VERTICAL_SLICING_PLAN.md), MCP setup instructions for Claude Code and Cursor, feature list (fingerprint, distill, cards, personalization, amplification), link to Thinking Graph demo, MIT license badge. Prepare launch content: HN 'Show HN' post title and body, X thread draft, Reddit post for r/ClaudeCode."

---

## 6. Implementation Plan

### Sprint 8: Ecosystem & Polish

> **Goal:** npm publish, ClawHub skill, MCP Registry entry, Thinking Graph static site, README, E2E test, polish.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-080** | Thinking Graph site generator: read all `.unfade/` data, compute heatmap data (decision count per day for last 90 days), extract domain distribution from reasoning model, compile last 7 distills, generate `data.json` | `src/services/site/site-generator.ts` | [ ] |
| **UF-081** | Heatmap renderer: generate SVG heatmap from daily decision counts — GitHub-style contribution graph, dark theme, color intensity by count (0, 1-3, 4-7, 8+) | `src/services/site/heatmap.ts` | [ ] |
| **UF-082** | Site HTML template: single-page HTML with inline CSS — Decision Density Heatmap, Domain Distribution bars, Reasoning Profile card, Recent Distills list, OG meta tags, "Powered by Unfade" footer | `src/services/site/template.ts` | [ ] |
| **UF-083** | `unfade publish` command: generate static site in `.unfade/site/`, include OG card image (reuse card generator), show deploy instructions for Vercel/Netlify/GitHub Pages. **Note:** This is a Phase 5 addition beyond the core 5 vertical slices — generates a SEPARATE static site (plain HTML/CSS/SVG) for public hosting, distinct from the local web UI (Hono on localhost:7654, htmx + server-rendered HTML) | `src/commands/publish.ts` | [ ] |
| **UF-084** | ClawHub skill package: create `SKILL.md` with progressive disclosure, MCP tool descriptions, installation instructions, example usage | `skills/unfade-memory/SKILL.md` | [ ] |
| **UF-085** | MCP Registry entry: create `server.json` with name, version, description, capabilities list, installation command, transport info | `server.json` | [ ] |
| **UF-086** | Smart default command: bare `unfade` with no args → detect state → not initialized? run init wizard. Initialized? launch TUI dashboard | `src/entrypoints/cli.ts` | [ ] |
| **UF-087** | `--json` output flag: add `--json` flag to applicable commands (`unfade query`, `unfade distill`, `unfade export`) — outputs machine-readable JSON instead of formatted terminal output | All command files | [ ] |
| **UF-088** | Config migration infrastructure: versioned migrations for config.json and reasoning_model.json schema evolution. Non-destructive with backup | `src/config/migrations.ts` | [ ] |
| **UF-089** | Error handling audit: ensure all errors go through response envelope with `_meta`, no raw stack traces in user-facing output, helpful error messages for common issues (Ollama not installed, no git repo, daemon already running) | All tools/commands | [ ] |
| **UF-090** | README.md: installation instructions (`npx unfade init`), quickstart GIF, command reference, architecture diagram, MCP setup for Claude Code/Cursor, FAQ | `README.md` | [ ] |
| **UF-091** | npm package preparation: finalize `package.json` — bin (`./dist/cli.js`), files, engines (`node >= 20`), description, keywords, repository, license (MIT), homepage | `package.json` | [ ] |
| **UF-092** | E2E integration test: full workflow — init → start daemon → capture git events → trigger distill → query distill → generate card → generate site. All in one test | `test/integration/e2e.test.ts` | [ ] |
| **UF-093** | CLAUDE.md comprehensive update: all project conventions, schema-first development, stdout sacred, response envelope, `.unfade/` workspace, test naming, commit style, phase docs reference | `CLAUDE.md` | [ ] |

#### Final CLI Command Surface

| Category | Commands |
|---|---|
| **Core** | `unfade init`, `unfade` (TUI dashboard), `unfade open` (web UI), `unfade query` |
| **Power** | `unfade export`, `unfade distill`, `unfade daemon stop` |
| **Phase 5 addition** | `unfade publish` (static Thinking Graph site generation — beyond the core 5 slices) |

**Note:** The HTTP server (Hono on localhost:7654) already serves the local web UI pages (htmx + server-rendered HTML). `unfade publish` generates a SEPARATE static site (plain HTML/CSS/SVG) intended for public hosting on Vercel/Netlify/GitHub Pages.

### Tests

| Test | What It Validates | File |
|---|---|---|
| **T-180** | Site generator: reads events and computes daily decision counts | `test/services/site/site-generator.test.ts` |
| **T-181** | Site generator: extracts domain distribution from reasoning model | `test/services/site/site-generator.test.ts` |
| **T-182** | Site generator: compiles recent distills (last 7 days) | `test/services/site/site-generator.test.ts` |
| **T-183** | Site generator: handles empty data gracefully (new user) | `test/services/site/site-generator.test.ts` |
| **T-184** | Heatmap renderer: generates valid SVG | `test/services/site/heatmap.test.ts` |
| **T-185** | Heatmap renderer: correct color intensity for different counts | `test/services/site/heatmap.test.ts` |
| **T-186** | Heatmap renderer: covers 90-day range | `test/services/site/heatmap.test.ts` |
| **T-187** | Site template: generates valid HTML | `test/services/site/template.test.ts` |
| **T-188** | Site template: includes OG meta tags | `test/services/site/template.test.ts` |
| **T-189** | Site template: includes all visual components | `test/services/site/template.test.ts` |
| **T-190** | `unfade publish`: creates `.unfade/site/` directory | `test/commands/publish.test.ts` |
| **T-191** | `unfade publish`: generates index.html | `test/commands/publish.test.ts` |
| **T-192** | `unfade publish`: includes OG card image | `test/commands/publish.test.ts` |
| **T-193** | Smart default: bare `unfade` when not initialized → runs init | `test/entrypoints/cli.test.ts` |
| **T-194** | Smart default: bare `unfade` when initialized → launches TUI dashboard | `test/entrypoints/cli.test.ts` |
| **T-195** | `--json` flag: `unfade query --json` returns valid JSON | `test/commands/query.test.ts` |
| **T-196** | `--json` flag: `unfade distill --json` returns valid JSON | `test/commands/distill.test.ts` |
| **T-197** | `--json` flag: `unfade export --json` returns valid JSON | `test/commands/export.test.ts` |
| **T-198** | Config migration: migrates v1 config to v2 | `test/config/migrations.test.ts` |
| **T-199** | Config migration: preserves existing values during migration | `test/config/migrations.test.ts` |
| **T-200** | Config migration: creates backup before migrating | `test/config/migrations.test.ts` |
| **T-201** | E2E: init → capture → distill → query → card → publish | `test/integration/e2e.test.ts` |
| **T-202** | server.json: valid MCP server manifest | `test/integration/mcp-registry.test.ts` |

---

## 7. Success Metrics

| Metric | Current | Target | How to Measure |
|---|---|---|---|
| **npm install + init** | N/A | < 2 minutes from `npx unfade init` to first status output | Manual test on clean machine |
| **Time to first Distill** | N/A | < 5 minutes (including backfill) | Manual test with git history |
| **Thinking Graph generation** | N/A | < 10 seconds for 90 days of data | Timer in site generator |
| **Thinking Graph page size** | N/A | < 200KB (HTML + CSS + SVG, excluding OG image) | File size check |
| **Thinking Graph rendering** | N/A | Renders correctly on Chrome, Firefox, Safari | Manual browser test |
| **OG preview** | N/A | Card renders correctly when URL shared on X/LinkedIn | Manual social share test |
| **ClawHub install** | N/A | Skill installs cleanly on OpenClaw | Manual test |
| **MCP Registry** | N/A | server.json passes MCP Registry validation | Validation tool |
| **E2E test** | N/A | Full workflow passes in CI | `pnpm test` |
| **README clarity** | N/A | New user installs without asking questions (qualitative) | Observe 3 first-time users |
| **Test count** | 179 (Phase 4) | 202+ tests, all passing | `pnpm test` |
| **Total build size** | N/A | < 5MB bundled | `ls -la dist/` |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **npm name `unfade` unavailable** | Low | Medium — forces different package name | Check npm registry before finalizing. Alternative: `unfade-cli`, `@unfade/cli` |
| **ClawHub listing delays** | Low | Low — doesn't block local usage | Submit skill early. Local MCP setup works without ClawHub |
| **Thinking Graph looks bad on some screen sizes** | Medium | Medium — undermines identity artifact | Responsive CSS. Test on mobile, tablet, desktop. Minimum viewport: 320px |
| **E2E test flakiness** | Medium | Medium — blocks CI | Isolate test in temp directory. Mock LLM calls. Fixed test fixtures. Retry on timeout |
| **README gets outdated** | Medium | Medium — confuses new users | README is a Phase 5 deliverable AND a living document. CLAUDE.md references README as authoritative |
| **First-time user confusion** | Medium | High — abandonment | Focus on `unfade init` wizard quality. Clear error messages. `--help` on every command. FAQ in README |
| **Static site hosting complexity** | Low | Low — developer audience knows deploy | Provide copy-paste commands for Vercel (`npx vercel .unfade/site`), Netlify, GitHub Pages |

---

## What Was Intentionally Deferred

| Feature | Why Deferred | When to Add |
|---|---|---|
| **Browser extension** | Git + AI sessions + terminal cover 80% of reasoning signal | Phase 6 |
| **Cloud distill (frontier LLMs)** | Ollama is good enough for v1. Cloud adds latency, cost, privacy concerns | When Unfade Pro launches |
| **Team Unfades** | Requires multi-user infrastructure. Solo experience must be perfect first | Phase 7 |
| **Hosted `unfade.dev/username`** | Self-hosted static site sufficient for launch. Hosted profiles = first paid feature | Phase 7 |
| **Collaborative reasoning** | Needs multiple users on same repo. High complexity | Phase 8 |
| **Unfade Threads** | Connected decision chains across days. Needs deep temporal data | Phase 7 |
| **Plugin SDK** | Community connectors for VS Code, JetBrains, Windsurf, etc. | Phase 7 |
| **Predictive reasoning** | "Based on your patterns, you'll likely want..." Needs 4+ months of data | Phase 9 |
| **Queryable second self** | `unfade ask "How would I approach..."` answered from your reasoning | Phase 9 |
| **Blind spot reports** | Weekly analysis of reasoning gaps | Phase 9 |

---

> **This is the launch phase.** After Phase 5, Unfade is a publicly available, MIT-licensed, npm-installable CLI that captures engineering reasoning, distills it into personalized daily summaries, exposes it as context for every AI tool via MCP, and renders it as a shareable visual identity. The temporal moat begins accumulating for every user from day one.

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
> **Last updated:** 2026-04-16

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan (Micro-Sprints 5A–5D)](#6-implementation-plan-micro-sprints-5a5d)
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

## 6. Implementation Plan (Micro-Sprints 5A–5D)

### Phase 5 Boundary

> **Phase 4 delivers:** Personalization engine (pattern detection, domain tracking, profile building), ReasoningModelV2 in `.unfade/profile/reasoning_model.json`, personalized distills with PERSONALIZATION section, amplification v2 (cross-domain connections), pattern feedback mechanism, enhanced similar-decision search, profile web UI v2, ProfileCard TUI component.
>
> **Phase 5 adds:** Thinking Graph static site generator (`unfade publish`), Decision Density Heatmap (SVG), ClawHub skill package, MCP Registry entry, `--json` output flag, config migration infrastructure, error handling audit, README, npm package preparation, E2E integration test, CLAUDE.md comprehensive update.
>
> **Note on UF-086:** The "smart default command" task was broken into sub-tasks UF-086a–g and fully integrated into Phase 1 (Sprints 1A, 1D, 1F, 1G) and Phase 2 (Sprints 2C, 2D). See [Zero-Knowledge UX Plan](./ZERO_KNOWLEDGE_UX_PLAN.md) for details. UF-086 does NOT appear in Phase 5 sprints.

#### TypeScript READS/WRITES (Phase 5)

| Component | Reads | Writes |
|---|---|---|
| Site generator | `.unfade/events/*.jsonl`, `.unfade/distills/*.md`, `.unfade/profile/reasoning_model.json` | `.unfade/site/data.json` |
| Heatmap renderer | `.unfade/graph/decisions.jsonl` | `.unfade/site/heatmap.svg` (inline SVG in HTML) |
| Site template | `data.json` (computed by site generator), heatmap SVG | `.unfade/site/index.html`, `.unfade/site/style.css` |
| `unfade publish` | All site generator output, card generator (reuse) | `.unfade/site/` directory, `.unfade/site/assets/og-card.png` |
| ClawHub SKILL.md | (static content) | `skills/unfade-memory/SKILL.md`, `skills/unfade-memory/manifest.json` |
| MCP Registry | (static content) | `server.json` |
| `--json` flag | Existing command output | stdout (JSON instead of formatted text) |
| Config migration | `.unfade/config.json` (any version) | `.unfade/config.json` (latest), `.unfade/config.backup.json` |
| E2E test | All `.unfade/` directories | Temp directory (isolated test) |

#### Key Data Contracts

**Static site output structure:**
```
.unfade/site/                   # Generated by `unfade publish`
├── index.html                  # Single-page Thinking Graph
├── style.css                   # Dark theme, responsive
├── data.json                   # Pre-computed visualization data
└── assets/
    └── og-card.png             # OG image for social sharing
```

**Heatmap intensity formula:**
```
intensity = decisions + (trade_offs × 1.5) + (dead_ends × 2)

Color levels:
  0        → empty (background)
  1-3      → light
  4-7      → medium
  8-11     → dark
  12+      → highlight

SVG: 52 columns (weeks) × 7 rows (days), rounded rects
Month labels along top. Tooltip: "Apr 15: 3 decisions, 1 trade-off, 0 dead ends"
```

**ClawHub manifest schema:**
```json
{
  "name": "unfade-memory",
  "description": "Persistent reasoning memory for AI agents",
  "author": "unfade",
  "version": "0.1.0",
  "mcp": {
    "command": "npx",
    "args": ["unfade", "mcp"],
    "transport": "stdio"
  },
  "tools": ["unfade_query", "unfade_context", "unfade_decisions", "unfade_profile", "unfade_distill", "unfade_similar", "unfade_amplify"],
  "install": "npx unfade"
}
```

**MCP Registry server.json schema:**
```json
{
  "name": "unfade",
  "description": "Engineering reasoning capture, distillation, and personalization",
  "version": "0.1.0",
  "transport": { "type": "stdio", "command": "npx", "args": ["unfade", "mcp"] },
  "capabilities": {
    "tools": true,
    "resources": true,
    "prompts": true
  }
}
```

**npm package.json requirements:**
```
name: "unfade"
version: "0.1.0"
bin: { "unfade": "./dist/cli.mjs" }
files: ["dist/", "skills/", "server.json"]
engines: { "node": ">=20" }
license: "MIT"
optionalDependencies: platform-specific daemon packages
```

#### Final CLI Command Surface

| Category | Commands |
|---|---|
| **Core** | `unfade` (TUI dashboard / auto-init), `unfade open` (web UI), `unfade query` |
| **Power** | `unfade export`, `unfade distill`, `unfade daemon stop` |
| **Hidden** | `unfade mcp` (MCP stdio server, called by IDE configs) |
| **Phase 5 addition** | `unfade publish` (static Thinking Graph site generation) |

**Note:** `unfade init` is absorbed into bare `unfade` via state detection (Phase 1, UF-086a/b). It remains as a power-user alias but is not the documented entry point. The HTTP server (Hono on localhost:7654) serves the local web UI. `unfade publish` generates a SEPARATE static site (plain HTML/CSS/SVG) for public hosting on Vercel/Netlify/GitHub Pages.

---

### Sprint 5A — Static Site Generator (TypeScript, 4 tasks)

> **Objective:** Build the Thinking Graph static site generator — data pipeline, heatmap SVG renderer, HTML template, and `unfade publish` command. No ecosystem packaging, no CLI polish. Output: `unfade publish` creates a deployable `.unfade/site/` directory.

**Acid test:**
```bash
pnpm test -- --grep "site-generator|heatmap|template|publish"
# All 13 tests pass

unfade publish
ls .unfade/site/
# → index.html  style.css  data.json  assets/og-card.png

# Verify the HTML is valid and self-contained
wc -c .unfade/site/index.html  # < 200KB
open .unfade/site/index.html   # → renders Decision Density Heatmap, domain chart, profile card, recent distills
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-080** | Thinking Graph site generator: read all `.unfade/` data, compute heatmap data (decision count per day for last 90 days), extract domain distribution from reasoning model, compile last 7 distills, generate `data.json`. Handle empty data gracefully (new user with no events) | `src/services/site/site-generator.ts` | [x] |
| **UF-081** | Heatmap renderer: generate SVG heatmap from daily decision counts — GitHub-style contribution graph, dark theme, 5 color intensity levels (see Phase 5 Boundary formula). 52×7 grid, month labels, tooltip text per cell. Export as inline SVG for the static site | `src/services/site/heatmap.ts` | [x] |
| **UF-082** | Site HTML template: single-page HTML with inline CSS — Decision Density Heatmap (from UF-081), Domain Distribution bars (from reasoning model), Reasoning Profile card, Recent Distills list (collapsible), OG meta tags for social sharing, "Powered by Unfade" footer. Dark theme, responsive (min viewport 320px) | `src/services/site/template.ts` | [x] |
| **UF-083** | `unfade publish` command: orchestrate site generation into `.unfade/site/`, include OG card image (reuse card generator from Phase 3), print deploy instructions for Vercel (`npx vercel .unfade/site`), Netlify, GitHub Pages. Accepts `--output <dir>` flag for custom output path | `src/commands/publish.ts` | [x] |

> **Agent Directive:** "You are building the Thinking Graph static site generator — pure HTML/CSS/SVG generation with NO JavaScript frameworks. UF-080 reads `.unfade/events/`, `.unfade/distills/`, and `.unfade/profile/reasoning_model.json` to produce a `data.json` with heatmap counts, domain distribution, profile summary, and recent distill excerpts. UF-081 generates an inline SVG heatmap using the intensity formula from Phase 5 Boundary (decisions + trade_offs×1.5 + dead_ends×2). UF-082 assembles the single-page HTML with inline CSS (dark theme) and OG meta tags. UF-083 wires it all together as the `unfade publish` command. Use `src/utils/paths.ts` for all path resolution. stdout is sacred — all progress output to stderr."

**Strict Contracts:**
- Site generator input: `.unfade/` directories → output: `data.json` with `{ heatmap: DayCount[], domains: DomainSummary[], profile: ProfileSummary, distills: DistillExcerpt[] }`
- Heatmap input: `DayCount[]` → output: SVG string (52×7 grid, 5 color levels)
- Template input: `data.json` + SVG string → output: complete HTML string
- `unfade publish` output: `.unfade/site/` with `index.html`, `style.css`, `data.json`, `assets/og-card.png`

---

### Sprint 5B — Ecosystem Packaging (TypeScript, 2 tasks)

> **Objective:** Package Unfade for ecosystem discovery — ClawHub skill and MCP Registry entry. Output: valid `SKILL.md` with progressive disclosure, valid `server.json` for MCP Registry.

**Acid test:**
```bash
pnpm test -- --grep "mcp-registry|skill"
# All 2 tests pass

# Verify SKILL.md structure
head -20 skills/unfade-memory/SKILL.md
# → Progressive disclosure: one-liner, features, setup, MCP tools

# Verify server.json
cat server.json | jq '.transport.command'  # → "npx"
cat server.json | jq '.capabilities.tools' # → true
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-084** | ClawHub skill package: create `SKILL.md` with progressive disclosure (one-liner → features → setup → usage → MCP tools list), `manifest.json` with skill metadata (see Phase 5 Boundary schema). Installation instruction: `npx unfade`. Example usage scenarios for AI agents | `skills/unfade-memory/SKILL.md`, `skills/unfade-memory/manifest.json` | [x] |
| **UF-085** | MCP Registry entry: create `server.json` with name, version, description, transport config (stdio via `npx unfade mcp`), capabilities (tools, resources, prompts), tool catalog (see Phase 5 Boundary schema) | `server.json` | [x] |

> **Agent Directive:** "You are creating ecosystem distribution artifacts — markdown and JSON files only. UF-084 creates the ClawHub skill package: `skills/unfade-memory/SKILL.md` uses progressive disclosure (Section 4.4 of this doc as reference) and `skills/unfade-memory/manifest.json` matches the schema in Phase 5 Boundary. UF-085 creates the MCP Registry `server.json` at project root matching the schema in Phase 5 Boundary. List all 7 MCP tools: unfade_query, unfade_context, unfade_decisions, unfade_profile, unfade_distill, unfade_similar, unfade_amplify. No TypeScript code — these are static distribution files."

**Strict Contracts:**
- SKILL.md: must contain sections: description (one-liner), features (bullet list), setup (`npx unfade`), MCP tools (all 7), example usage
- manifest.json: must match ClawHub schema in Phase 5 Boundary
- server.json: must match MCP Registry schema in Phase 5 Boundary

---

### Sprint 5C — CLI Polish & Migration (TypeScript, 3 tasks)

> **Objective:** Add `--json` output flag to key commands, build config migration infrastructure, and audit error handling. Output: machine-readable output available for all applicable commands, config migrations work non-destructively, no raw stack traces in user-facing output.

**Acid test:**
```bash
pnpm test -- --grep "json.*flag|migrations|config"
# All 6 tests pass

unfade query "caching" --json | jq '.data[0].domain'
# → valid JSON, not formatted terminal output

unfade distill --json | jq '._meta.tool'
# → "distill"

# Config migration
node -e "require('fs').writeFileSync('.unfade/config.json', '{\"version\":1}')"
# Run migration → produces latest version with backup
cat .unfade/config.json | jq '.version'       # → latest
ls .unfade/config.backup.json                   # → exists
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-087** | `--json` output flag: add `--json` flag to `unfade query`, `unfade distill`, `unfade export` — outputs machine-readable JSON wrapped in response envelope with `_meta` instead of formatted terminal output. Uses Commander's `.option('--json', '...')` | `src/commands/query.ts`, `src/commands/distill.ts`, `src/commands/export.ts` | [x] |
| **UF-088** | Config migration infrastructure: versioned migrations for `config.json` schema evolution. Each migration is a pure function `(oldConfig) → newConfig`. Runner detects current version, applies migrations sequentially, writes backup before migration. Non-destructive — original preserved as `.backup.json` | `src/config/config-migrations.ts` | [x] |
| **UF-089** | Error handling audit: ensure all errors go through response envelope with `_meta`, no raw stack traces in user-facing output, helpful error messages for common issues (Ollama not installed, no git repo, daemon already running, `.unfade/` not found). Audit all command files and MCP tool handlers | All command files, `src/utils/cli-error.ts` | [x] |

> **Agent Directive:** "You are polishing the CLI for production readiness. UF-087 adds `--json` to three commands — when the flag is present, output the response envelope `{ data, _meta }` as JSON to stdout (this is the ONE exception to 'stdout is sacred' — `--json` output is machine-readable, not MCP). UF-088 builds the migration runner: read config version, apply sequential migrations, backup original. UF-089 is an audit pass — wrap all unhandled errors in the response envelope, replace stack traces with user-friendly messages in non-verbose mode, ensure `--verbose` still shows full errors for debugging."

**Strict Contracts:**
- `--json` output: `{ data: <command-specific>, _meta: { tool: string, durationMs: number } }` — same envelope as MCP tools
- Config migration: `Migration = { version: number, up: (config: unknown) => unknown }`. Runner applies in order. Backup written before any mutation
- Error handling: user-facing errors MUST include `{ error: string, suggestion?: string }`. Stack traces only in `--verbose` mode

---

### Sprint 5D — Launch Preparation (TypeScript, 4 tasks)

> **Objective:** Final launch readiness — README, npm package preparation, E2E integration test, and CLAUDE.md comprehensive update. Output: `npm pack` produces a publishable package, E2E test passes, README enables 5-minute onboarding.

**Acid test:**
```bash
pnpm test -- --grep "e2e|integration"
# E2E test passes

npm pack
tar -tf unfade-0.1.0.tgz | head -20
# → package/dist/cli.mjs, package/server.json, package/skills/...

# Verify bin entry works
npx ./unfade-0.1.0.tgz --help
# → Shows command list

# README check
wc -l README.md  # < 200 lines
head -5 README.md # → One-liner + install command
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-090** | README.md: lead with one-liner ("Your AI tools forget how you think. Unfade remembers."), `npx unfade` install command, GIF/screenshot placeholder, "What happens next" section, architecture diagram (ASCII from VERTICAL_SLICING_PLAN.md), MCP setup for Claude Code/Cursor, feature list, FAQ, MIT license badge. Under 200 lines | `README.md` | [x] |
| **UF-091** | npm package preparation: finalize `package.json` — bin (`./dist/cli.mjs`), files (`dist/`, `skills/`, `server.json`), engines (`node >= 20`), description, keywords, repository, license (MIT), homepage. Add `optionalDependencies` for platform-specific daemon packages. Verify `npm pack` produces correct tarball | `package.json` | [x] |
| **UF-092** | E2E integration test: full workflow in isolated temp directory — init → start daemon → capture git events → trigger distill → query distill → generate card → generate site. Mock LLM calls. Fixed test fixtures. Assert each stage produces expected output files | `test/integration/e2e.test.ts` | [x] |
| **UF-093** | CLAUDE.md comprehensive update: all project conventions (stdout sacred, Zod schemas as source of truth, response envelope, `.unfade/` workspace, test naming, imports with .js), schema-first development reference, phase docs reference, build commands, Go daemon commands | `CLAUDE.md` | [x] |

> **Agent Directive:** "You are preparing Unfade for public launch. UF-090 writes the README — follow the structure: one-liner hook, install command, GIF placeholder, 'What happens next' flow, architecture diagram (copy ASCII from VERTICAL_SLICING_PLAN.md Section 'System Overview'), MCP setup snippets, feature list, FAQ. Keep under 200 lines. UF-091 finalizes package.json for npm publish — verify bin entry, files array, engines, license. UF-092 writes the E2E test — create temp dir, run full workflow, assert outputs exist. Mock all LLM calls. UF-093 updates CLAUDE.md with all conventions accumulated across Phases 0-5. README and CLAUDE.md output to stderr for any progress messages."

**Strict Contracts:**
- README: must include sections: one-liner, install, what happens next, architecture, MCP setup, features, FAQ, license
- package.json: `bin.unfade` → `./dist/cli.mjs`, `files` includes `dist/`, `skills/`, `server.json`, `engines.node` >= 20
- E2E test: isolated in temp directory, no side effects on real `.unfade/`, mock LLM, assert file existence for each stage
- CLAUDE.md: must reference all phase docs, all conventions from Sections 1-7 of each phase doc

---

### Tests

| Sprint | Test | What It Validates | File |
|---|---|---|---|
| 5A | **T-211** | Site generator: reads events and computes daily decision counts | `test/services/site/site-generator.test.ts` |
| 5A | **T-212** | Site generator: extracts domain distribution from reasoning model | `test/services/site/site-generator.test.ts` |
| 5A | **T-213** | Site generator: compiles recent distills (last 7 days) | `test/services/site/site-generator.test.ts` |
| 5A | **T-214** | Site generator: handles empty data gracefully (new user) | `test/services/site/site-generator.test.ts` |
| 5A | **T-215** | Heatmap renderer: generates valid SVG | `test/services/site/heatmap.test.ts` |
| 5A | **T-216** | Heatmap renderer: correct color intensity for different counts | `test/services/site/heatmap.test.ts` |
| 5A | **T-217** | Heatmap renderer: covers 90-day range | `test/services/site/heatmap.test.ts` |
| 5A | **T-218** | Site template: generates valid HTML | `test/services/site/template.test.ts` |
| 5A | **T-219** | Site template: includes OG meta tags | `test/services/site/template.test.ts` |
| 5A | **T-220** | Site template: includes all visual components | `test/services/site/template.test.ts` |
| 5A | **T-221** | `unfade publish`: creates `.unfade/site/` directory | `test/commands/publish.test.ts` |
| 5A | **T-222** | `unfade publish`: generates index.html | `test/commands/publish.test.ts` |
| 5A | **T-223** | `unfade publish`: includes OG card image | `test/commands/publish.test.ts` |
| 5B | **T-224** | SKILL.md: contains required sections (description, setup, tools) | `test/integration/clawhub.test.ts` |
| 5B | **T-225** | server.json: valid MCP server manifest | `test/integration/mcp-registry.test.ts` |
| 5C | **T-226** | `--json` flag: `unfade query --json` returns valid JSON | `test/commands/query.test.ts` |
| 5C | **T-227** | `--json` flag: `unfade distill --json` returns valid JSON | `test/commands/distill.test.ts` |
| 5C | **T-228** | `--json` flag: `unfade export --json` returns valid JSON | `test/commands/export.test.ts` |
| 5C | **T-229** | Config migration: migrates v1 config to v2 | `test/config/config-migrations.test.ts` |
| 5C | **T-230** | Config migration: preserves existing values during migration | `test/config/config-migrations.test.ts` |
| 5C | **T-231** | Config migration: creates backup before migrating | `test/config/config-migrations.test.ts` |
| 5D | **T-232** | E2E: init → capture → distill → query → card → publish | `test/integration/e2e.test.ts` |

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
| **Test count** | 210+ (Phase 4) | 232+ tests, all passing | `pnpm test` |
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

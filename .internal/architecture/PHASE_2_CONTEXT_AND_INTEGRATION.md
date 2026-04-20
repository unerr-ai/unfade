# Phase 2 — Context & Integration

> **Feature Statement:** _"When a developer installs Unfade's MCP server, their AI automatically knows what they were working on yesterday. Zero config. The 'telepathic AI' experience — but through the universal MCP protocol, not custom integrations. One install, every MCP-compatible tool gets smarter."_
>
> **Prerequisites:** [Phase 1 — Capture & Intelligence](./PHASE_1_CAPTURE_AND_INTELLIGENCE.md) complete (capture engine running, events flowing, distills generating, personalization seed)
>
> **Position in roadmap:** [Foundation (Phase 0)](./PHASE_0_FOUNDATION.md) → [Capture & Intelligence (Phase 1)](./PHASE_1_CAPTURE_AND_INTELLIGENCE.md) → **Context & Integration (Phase 2)** → [Identity & Personalization (Phase 3)](./PHASE_3_IDENTITY_AND_PERSONALIZATION.md) → [Platform & Launch (Phase 4)](./PHASE_4_PLATFORM_AND_LAUNCH.md)

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

Phase 2 transforms Unfade from a standalone CLI into an **infrastructure layer** that makes every AI tool smarter. The MCP server and HTTP API are the ecosystem multipliers — they create daily practical value (AI tools that remember yesterday), build switching cost (every tool depends on Unfade's context), and open the door to the entire agent ecosystem.

### 1.2 The Principle

> **One MCP server serves every current and future MCP-compatible tool automatically. This is not a collection of plugins — it is protocol-level integration that scales with the ecosystem, not with Unfade's engineering effort.**

### 1.3 Why MCP Ships Here, Not Later

The agent ecosystem is the highest-leverage distribution channel. Shipping MCP early means Unfade rides the agent adoption wave from the start rather than building its own audience in isolation. Any MCP-compatible tool — Claude Code, Cursor, Windsurf, or future clients — gets immediate access to the developer's reasoning history with zero custom integration work.

---

## 2. The Problem

### Current State (after Phase 1)

Unfade captures events and generates distills — but the reasoning data is locked inside `.unfade/` files. No external tool can access it programmatically. Developers still have to re-explain context to every AI tool.

### After Phase 2

| Concern | State |
|---|---|
| **MCP Server** | Full MCP server (Resources + Tools + Prompts) with both stdio and Streamable HTTP transports. 9 tools, 5 resources, 3 prompts |
| **HTTP API** | Hono server on `localhost:7654` with JSON API endpoints for context, query, decisions, profile, distill, cards, amplification, settings, feedback, and more |
| **Web UI** | Server-rendered HTML pages with htmx — dashboard, portfolio, repo detail, heatmap, distill viewer, profile, search, settings, cards |
| **Context Shaper** | Personalizes context delivery based on reasoning profile — domain expertise, exploration depth, dead-end awareness |
| **Context Injection** | Any MCP-compatible agent auto-discovers Unfade and gets structured reasoning context |
| **Unified Server** | MCP server and HTTP API both run inside the single `unfade` process, not separate services |
| **`unfade mcp` hidden command** | Starts MCP stdio server for IDE integration. Not listed in `--help`. Called by IDE configs: `{ "command": "npx", "args": ["unfade", "mcp"] }` |
| **Connect AI Tools** | Web UI Settings page includes copy-paste MCP config snippets for Claude Code, Cursor, Windsurf |

---

## 3. Research

### 3.1 MCP Server Patterns

| Pattern | Claude Code | unerr-cli | Unfade Choice | Rationale |
|---|---|---|---|---|
| **Transport** | Stdio + HTTP | Stdio (PID lock -> credentials -> DB init -> MCP server) | Stdio (primary) + Streamable HTTP (secondary) | Stdio for IDE integration, HTTP for web UI, CLI, and custom scripts |
| **Boot sequence** | -- | PID lock -> credentials -> DB init -> MCP server -> file watchers | PID check -> config load -> file access -> MCP server | No database. Direct file reads |
| **Resources** | Multiple tool descriptions | -- | 5 read-only context resources | Read-heavy server: agents mostly query context |
| **Tools** | 50+ tools | 15 tools (11 local, 4 cloud) | 9 executable tools | Focused tool set covering query, context, decisions, profile, distill, amplify, similar, log, and comprehension |
| **Prompts** | -- | -- | 3 reasoning frameworks | Reusable prompts for code review, architecture, debugging |
| **stdout sacred** | Yes | Yes (critical) | Yes (non-negotiable) | MCP JSON-RPC only on stdout. All diagnostics to stderr |
| **Response envelope** | -- | Every response has `_meta` + `_context` | Every response has `_meta` | Consistent error handling, degradation status |

### 3.2 HTTP API Patterns

| Pattern | Choice | Rationale |
|---|---|---|
| **Framework** | Hono | Lightweight, fast, TypeScript-first. No Express overhead |
| **Port** | `localhost:7654` | High port, unlikely to conflict. Configurable via `mcp.httpPort`, fallback to 7655-7660 |
| **Auth** | None (localhost only) | Local-only server. Binds to `127.0.0.1` exclusively |
| **Response format** | JSON with `_meta` envelope | Consistent with MCP tool responses |
| **Web UI** | htmx + server-rendered HTML | No JS build step. Hono renders templates. htmx handles interactivity |
| **Design system** | kap10 theme, Tailwind CSS CDN | Dark theme with CSS custom properties, color tokens |
| **Consumers** | Web UI (htmx), CLI, custom scripts | HTTP serves three distinct consumer types |

---

## 4. Architecture

### 4.1 MCP Server — Resources, Tools, Prompts

The MCP server is implemented in `src/services/mcp/` with four modules: `server.ts` (lifecycle and transport), `resources.ts` (read-only data), `tools.ts` (executable queries), and `prompts.ts` (reasoning frameworks).

#### Resources (Read-Only Context)

5 resources registered in `src/services/mcp/resources.ts`. Each calls shared read services and never throws — returns empty content with status metadata when data is unavailable.

| Resource URI | Description | Returns |
|---|---|---|
| `unfade://context/recent` | Last 2 hours of reasoning events | Structured events with summaries |
| `unfade://context/today` | Today's complete reasoning context | All events + distill (if available) |
| `unfade://profile` | Developer's reasoning profile | Decision style, domains, patterns |
| `unfade://decisions/recent` | Recent decisions with alternatives and trade-offs | Structured decision data |
| `unfade://distill/latest` | Most recent Daily Distill | Full Markdown distill |

#### Tools (Executable Queries)

9 tools registered in `src/services/mcp/tools.ts`. Each validates input with Zod, wraps output in the `_meta` envelope, and degrades gracefully when Unfade is not initialized (returns `{ status: "not_initialized", setup: "Run npx unfade..." }`).

| Tool Name | Description | Input |
|---|---|---|
| `unfade_query` | Semantic search across reasoning history | `{ query, dateRange?, limit? }` |
| `unfade_context` | Get recent reasoning context | `{ scope: 'last_2h' | 'today' | 'this_week', project? }` |
| `unfade_decisions` | List recent decisions | `{ limit?, domain? }` |
| `unfade_profile` | Get reasoning profile | `{}` |
| `unfade_distill` | Trigger manual distillation | `{ date? }` |
| `unfade_amplify` | Cross-temporal connection detection | `{ date }` |
| `unfade_similar` | Find analogous past decisions | `{ problem, limit? }` |
| `unfade_log` | Log a structured reasoning event (active instrumentation) | `{ type, content, domain?, alternatives?, confidence?, context? }` |
| `unfade_comprehension` | Per-module comprehension scores | `{}` |

#### Prompts (Reasoning Frameworks)

3 prompts registered in `src/services/mcp/prompts.ts`. Each fetches relevant context from read services and constructs system messages that inject developer patterns into agent workflows.

| Prompt Name | Description | Arguments |
|---|---|---|
| `unfade_code_review` | Code review informed by developer's reasoning patterns — injects decision style, recent decisions, and today's context | `{ diff }` |
| `unfade_architecture` | Architecture decision informed by past decisions and trade-off preferences | `{ question }` |
| `unfade_debug` | Debugging approach informed by past dead ends, recent activity, and exploration patterns | `{ error, context? }` |

### 4.2 HTTP API

The HTTP server (`src/server/http.ts`) is a Hono application that binds to `127.0.0.1` only, with CORS restricted to localhost origins. All JSON responses are wrapped in the `{ data, _meta }` envelope via middleware. On startup, `server.json` is written atomically (tmp + rename) to `.unfade/state/` with port, PID, timestamps, and transport URLs.

#### JSON API Routes (`src/server/routes/`)

15 route modules mounted on the Hono app:

| Route Group | Key Endpoints |
|---|---|
| `context` | `GET /unfade/context?scope=` |
| `query` | `GET /unfade/query?q=` |
| `decisions` | `GET /unfade/decisions?limit=&domain=` |
| `profile` | `GET /unfade/profile` |
| `distill` | `GET /unfade/distill/latest`, `GET /unfade/distill/:date`, `POST /unfade/distill` |
| `cards` | Card generation and retrieval |
| `amplify` | Cross-temporal connections |
| `feedback` | User feedback capture |
| `settings` | Configuration management |
| `summary` | Daily/weekly summaries |
| `stream` | Live event streaming |
| `insights` | Intelligence-derived insights |
| `repos` | Multi-repo management |
| `heatmap` | Activity heatmap data |
| `decision-detail` | Individual decision deep-dive |

#### Health Check

`GET /unfade/health` returns server status including version, PID, uptime, repo count, and per-repo daemon/materializer health status.

### 4.3 Web UI Pages

Server-rendered HTML with htmx for interactivity, served by Hono. No JavaScript build step. All pages use a shared layout (`src/server/pages/layout.ts`) providing dark theme CSS, htmx script tag, and navigation.

10 page modules in `src/server/pages/`:

| Page | Route | Purpose |
|---|---|---|
| `layout.ts` | (shared wrapper) | Base HTML layout, dark theme CSS, htmx, nav bar |
| `dashboard.ts` | `GET /` | Live activity feed, recent distill, quick stats, repo status |
| `portfolio.ts` | `GET /portfolio` | Multi-repo portfolio view |
| `repo-detail.ts` | `GET /repo/:id` | Single repo deep-dive |
| `heatmap-panel.ts` | `GET /heatmap` | Activity heatmap visualization |
| `distill.ts` | `GET /distill` | Distill viewer with date navigation, re-generate button via `hx-post` |
| `profile.ts` | `GET /profile` | Reasoning profile visualization — decision style, domains, patterns |
| `search.ts` | `GET /search` | Cross-repo reasoning search |
| `settings.ts` | `GET /settings` | Capture engine control, LLM config, "Connect AI Tools" MCP snippets |
| `cards.ts` | `GET /cards` | Unfade Card generation and preview |

### 4.4 Context Shaper

The context shaper (`src/services/personalization/context-shaper.ts`) personalizes MCP context delivery based on the developer's reasoning profile. It takes raw capture events and applies emphasis metadata based on three signals:

- **Domain expertise** — Events matching the developer's top domains get `high` emphasis
- **Exploration depth** — For high-exploration profiles (>1.5 alternatives evaluated), decision-related events get `high` emphasis
- **Dead-end awareness** — For developers with frequent dead ends (>0.5/day), error/retry/revert events get `high` emphasis

Events are reordered (high emphasis first, then normal, then low) but **never removed**. Missing or empty profiles result in passthrough with no shaping applied.

### 4.5 Unified Server Architecture

The MCP server and HTTP API both run inside the single `unfade` process (`src/server/unfade-server.ts`). This is not a collection of microservices — it is one Node.js process managing everything:

```
unfade (single process)
  |
  +-- HTTP Server (Hono, localhost:7654)
  |     +-- JSON API routes (/unfade/*)
  |     +-- Web UI pages (/, /distill, /profile, /settings, ...)
  |     +-- MCP Streamable HTTP transport (/mcp)
  |     +-- Health check (/unfade/health)
  |
  +-- MCP Stdio Transport (via `unfade mcp` hidden command)
  |
  +-- RepoManager
  |     +-- Per-repo Go capture engine (child process)
  |     +-- Per-repo materializer
  |     +-- Per-repo scheduler
  |
  +-- Context Shaper (personalization layer)
  |
  +-- .unfade/ file reads (events, distills, profile, graph)
```

The MCP server uses `@modelcontextprotocol/sdk`. In `server.ts`, `createMcpServer()` initializes the server and registers all resources, tools, and prompts. Two transport modes:

1. **Streamable HTTP** — Mounted at `/mcp` on the existing Hono server via `mountMcpHttp(app)`. Stateless mode (no session tracking), appropriate for local-only single-user operation.
2. **Stdio** — Used by `unfade mcp` hidden command for IDE integration. Connected via `connectStdio(server)`. Only MCP JSON-RPC on stdout; all diagnostics to stderr.

### 4.6 MCP Zod Schemas

All MCP data contracts live in `src/schemas/mcp.ts`. Each exports both the Zod schema and the inferred TypeScript type. Key schemas:

- **`McpMetaSchema`** — The `_meta` envelope: `{ tool, durationMs, degraded, degradedReason, lastUpdated, personalizationLevel }`
- **`QueryInputSchema`** — `{ query, dateRange?: { from?, to? }, limit }`
- **`ContextInputSchema`** — `{ scope: 'last_2h' | 'today' | 'this_week', project? }`
- **`DecisionsInputSchema`** — `{ limit, domain? }`
- **`AmplifyInputSchema`** / **`SimilarInputSchema`** — Cross-temporal and analogous decision search inputs
- **Output schemas** — `QueryOutputSchema`, `ContextOutputSchema`, `DecisionsOutputSchema`, `ProfileOutputSchema`, `AmplifyOutputSchema`, `SimilarOutputSchema` — all wrap data in the `{ data, _meta }` envelope

### 4.7 Response Envelope Pattern

Every tool response — both MCP and HTTP JSON API — wraps data in a `ToolResponse` envelope:

```typescript
{
  data: { /* tool-specific payload */ },
  _meta: {
    tool: string,            // e.g. "unfade-query"
    durationMs: number,      // execution time
    degraded: boolean,       // true when operating without full data
    degradedReason?: string, // why degraded (e.g. "not_initialized")
    lastUpdated: string | null,
    personalizationLevel?: string
  }
}
```

Degradation modes:
- **Not initialized** (no `.unfade/` directory) — tools return `{ status: "not_initialized", setup: "Run npx unfade..." }`
- **No distills yet** — resources return fingerprint data only, tools return `{ results: [], note: "..." }`
- **Tool error** — `degraded: true` with error reason, empty data payload. Never throws.

### 4.8 Data Flow

Phase 2 is read-heavy. The MCP server and HTTP API read from `.unfade/` files written by the Phase 1 capture engine:

```
TypeScript READS from:  .unfade/events/YYYY-MM-DD.jsonl  (query, context, decisions)
                         .unfade/distills/YYYY-MM-DD.md   (query, distill serving)
                         .unfade/graph/decisions.jsonl     (decisions tool)
                         .unfade/graph/domains.json        (domains resource)
                         .unfade/profile/reasoning_model.json (profile tool, context shaper)
                         .unfade/state/daemon.pid          (health check)

TypeScript WRITES to:   .unfade/state/server.json         (atomic: tmp + rename)
```

Consistency model: single-file consistency via atomic writes (tmp + rename for JSON, O_APPEND for JSONL). Cross-file eventual consistency with seconds of staleness acceptable. Every response includes `lastUpdated` timestamp. No read locks.

---

## 5. Design Principles

1. **MCP is the primary integration surface.** Every capability exposed via HTTP is also available via MCP. The MCP server is not an afterthought — it is the primary way agents interact with Unfade.

2. **Stdout is sacred.** In MCP stdio mode, only MCP JSON-RPC goes to stdout. All diagnostics, logs, and errors go to stderr. This is non-negotiable and enforced by the logger.

3. **Read-heavy, not write-heavy.** The MCP server and HTTP API are overwhelmingly read operations. Agents query context; they don't modify Unfade's data. The only write operations are `unfade_distill` (trigger distillation) and `unfade_log` (active instrumentation).

4. **Context is shaped, not dumped.** The context shaper personalizes responses based on the developer's reasoning profile. High-exploration developers get more alternatives. Domain experts get deeper context in their specialty areas. Events are reordered but never removed.

5. **No database for v1.** Both servers read directly from `.unfade/` files. JSONL scans are fast enough for local-only, single-user operation. This keeps the architecture simple and the data inspectable.

6. **One server, multiple transports.** The unified `unfade` process runs MCP (stdio + Streamable HTTP) and the HTTP server simultaneously. Same data, same context shaping, multiple access patterns.

7. **Never crash the agent.** MCP resources never throw. MCP tools return degraded responses with status metadata when data is unavailable. An agent connected to Unfade should never fail because Unfade is in a bad state.

---

## 6. Implementation Summary

### Shared Read Services & Schemas

The query engine and read services (`src/tools/unfade-query.ts`, `unfade-context.ts`, `unfade-decisions.ts`, `unfade-profile.ts`, `unfade-amplify.ts`, `unfade-similar.ts`) are the shared foundation consumed by both HTTP routes and MCP handlers. All `.unfade/` file reading logic lives here — neither transport implements its own file reading.

All read functions return data + `_meta` envelope with `lastUpdated`, `degraded`, `durationMs`. Missing files return empty results with `degraded: true` rather than throwing.

### HTTP Server & JSON API

Hono server in `src/server/http.ts` with localhost-only binding, CORS, error handling middleware, port fallback (7654-7660), and atomic `server.json` writes. Route modules in `src/server/routes/` delegate to shared read services.

### MCP Server & IDE Integration

Full MCP server in `src/services/mcp/` with resources, tools, and prompts sharing handler code across stdio and Streamable HTTP transports. Hidden `unfade mcp` command for IDE integration.

### Web UI Pages

10 server-rendered HTML pages in `src/server/pages/` using htmx for interactivity. Dark theme with kap10 design system. Dashboard, portfolio, repo detail, heatmap, distill viewer, profile, search, settings, and cards pages.

### CLI Query Command

`unfade query` command reads `server.json` for the HTTP API URL and calls the query endpoint. Falls back to direct file reading via the query engine if the server is not running.

---

## 7. Success Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **MCP tool response time** | < 100ms for local queries | Tool `_meta.durationMs` |
| **HTTP API response time** | < 50ms for cached queries | Response timing |
| **Context relevance** | Context matches actual recent work (qualitative) | Manual review: ask Claude Code "What was I working on yesterday?" with Unfade MCP connected |
| **MCP tool discovery** | All tools discoverable by IDE clients | Connect MCP, verify tool listing |
| **MCP resource availability** | All 5 resources return data | Curl or MCP client test |
| **Context shaping accuracy** | Shaped context matches profile expectations (qualitative) | Compare raw vs shaped context for high-exploration profile |
| **Endpoint coverage** | All JSON API endpoints return valid JSON, all web UI pages return valid HTML | Automated HTTP test suite |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **MCP protocol evolution** | Low | Medium — SDK handles most changes | Pin MCP SDK version. Transport abstraction insulates from protocol changes |
| **Stdout contamination** | Low | Critical — breaks MCP | Logger enforces stderr-only. Integration test verifies no stdout leaks. CI check for `console.log` |
| **Port conflict on 7654** | Low | Low — configurable | `mcp.httpPort` config option with automatic fallback to 7655-7660 |
| **Large event files slow queries** | Medium | Medium — response latency | Query engine reads only relevant date-range files. File-level indexing for fast filtering |
| **Context shaping distorts information** | Low | Medium — misleading context | Conservative shaping: never removes information, only reorders and emphasizes. Raw context always available |
| **MCP Registry listing delays** | Low | Low — doesn't block functionality | Publish `server.json` early. Manual listing process with MCP Registry team |

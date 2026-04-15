# Unfade CLI: Implementation Plan

> **Status:** AWAITING REVIEW
>
> **Last updated:** 2026-04-14
>
> **Product strategy:** [`docs/product/unfade.md`](../../product/unfade.md) (canonical), [`docs/product/unfade_support.md`](../../product/unfade_support.md) (competitive analysis)

---

## Overview

The Unfade CLI implementation is organized into 7 phases, from scaffolding through post-launch. Each phase has its own detailed document with: Feature Statement, Prerequisites, Business Justification, Architecture, Implementation Plan (task IDs + status), Tests, Success Metrics, and Risk Assessment.

**97 tasks** (UF-001 → UF-097) | **202 tests** (T-001 → T-202)

---

## Phase Index

| Phase | Name | Tasks | Tests | Document |
|---|---|---|---|---|
| **0** | Scaffolding | UF-001 → UF-011 (11) | T-001 → T-011 (11) | [PHASE_0_SCAFFOLDING.md](./PHASE_0_SCAFFOLDING.md) |
| **1** | Capture & Distill | UF-012 → UF-041 (30) | T-012 → T-088 (77) | [PHASE_1_CAPTURE_AND_DISTILL.md](./PHASE_1_CAPTURE_AND_DISTILL.md) |
| **2** | Hooks API & MCP Server | UF-042 → UF-057 (16) | T-089 → T-127 (39) | [PHASE_2_HOOKS_API_AND_MCP.md](./PHASE_2_HOOKS_API_AND_MCP.md) |
| **3** | Cards & Terminal Capture | UF-058 → UF-069 (12) | T-128 → T-154 (27) | [PHASE_3_CARDS_AND_TERMINAL.md](./PHASE_3_CARDS_AND_TERMINAL.md) |
| **4** | Personalization & Amplification | UF-070 → UF-079 (10) | T-155 → T-179 (25) | [PHASE_4_PERSONALIZATION_AND_AMPLIFICATION.md](./PHASE_4_PERSONALIZATION_AND_AMPLIFICATION.md) |
| **5** | Ecosystem Launch | UF-080 → UF-093 (14) | T-180 → T-202 (23) | [PHASE_5_ECOSYSTEM_LAUNCH.md](./PHASE_5_ECOSYSTEM_LAUNCH.md) |
| **6** | Post-Launch & Enterprise Prep | UF-094 → UF-097 (4) | — | [PHASE_6_POST_LAUNCH.md](./PHASE_6_POST_LAUNCH.md) |

---

## Foundation Document

| Document | Description |
|---|---|
| [UNFADE_CLI_RESEARCH_AND_DESIGN.md](./UNFADE_CLI_RESEARCH_AND_DESIGN.md) | Pattern extraction from Claude Code & unerr-cli, design decisions, architecture rationale, workflow validation |

---

## Dependency Graph

```
Phase 0 ─── Phase 1 ─── Phase 2 ─── Phase 3
  (Pre)       (Day 1)     (Day 2)     (Day 3)
                │                       │
                │                       ▼
                │                   Phase 4
                │                    (Day 4)
                │                       │
                ▼                       ▼
            Phase 5 (requires Phase 2 + Phase 4)
              (Day 5)
                │
                ▼
            Phase 6 (Post-Launch, not time-boxed)
```

- **Phase 0 → 1:** Scaffolding must exist before capture sources
- **Phase 1 → 2:** Capture + distill must work before exposing via MCP/HTTP
- **Phase 2 → 3:** MCP server must be running before cards and terminal capture
- **Phase 3 → 4:** Amplification v1 (Phase 3) informs full personalization engine
- **Phase 2 + 4 → 5:** MCP server + personalization required before ecosystem launch
- **Phase 5 → 6:** Post-launch roadmap begins after ecosystem launch

---

## Technology Stack

### TypeScript CLI (`unfade`)

| Concern | Choice |
|---|---|
| Runtime | Node.js (ESM) |
| Language | TypeScript (strict) |
| CLI framework | Commander + extra-typings |
| Terminal UI | Ink 6.x + React 19 |
| Web UI | htmx (~14KB) + server-rendered HTML |
| Validation | Zod |
| Bundler | tsup |
| Linting | Biome |
| Testing | Vitest |
| Git operations | isomorphic-git |
| HTTP server | Hono (JSON API + htmx pages on localhost:7654) |
| MCP | @modelcontextprotocol/sdk |
| LLM | Ollama (default), OpenAI, Anthropic |
| Card rendering | satori + resvg-js |

### Go Daemon (`unfaded`)

| Concern | Choice |
|---|---|
| Language | Go |
| File watching | fsnotify |
| IPC | Unix socket (macOS/Linux), named pipe (Windows) |
| Distribution | goreleaser (cross-platform binaries, ~12MB) |
| Auto-start | launchd (macOS), systemd (Linux), Task Scheduler (Windows) |
| Testing | Go standard `testing` package |

---

## Cross-Phase Reference: File Ownership Map

Every file in `.unfade/` has exactly ONE writer. This table is the concurrency Bible — if two components ever write to the same file, there is a bug.

| File | Writer | Readers | Write Semantics |
|---|---|---|---|
| `config.json` | TypeScript (init, web UI settings) | Go daemon (ConfigWatcher) | Atomic: tmp + rename |
| `events/YYYY-MM-DD.jsonl` | Go daemon (EventWriter) | TypeScript (distill, query) | O_APPEND, <4KB per write |
| `distills/YYYY-MM-DD.md` | TypeScript (distill pipeline) | TypeScript (server, query, cards) | Atomic: tmp + rename |
| `distills/.distill.lock` | TypeScript (distill pipeline) | TypeScript (distill pipeline) | PID-based file lock |
| `graph/decisions.jsonl` | TypeScript (distill pipeline) | TypeScript (server, amplifier) | O_APPEND |
| `graph/decisions_index.json` | TypeScript (amplifier) | TypeScript (amplifier, query) | Atomic: tmp + rename |
| `graph/domains.json` | TypeScript (distill pipeline) | TypeScript (server, query) | Atomic: tmp + rename |
| `profile/reasoning_model.json` | TypeScript (distill pipeline, personalization engine) | TypeScript (server, query, cards), Go daemon (none) | Atomic: tmp + rename |
| `amplification/connections.jsonl` | TypeScript (amplifier) | TypeScript (server, query) | O_APPEND |
| `amplification/feedback.jsonl` | TypeScript (HTTP /feedback) | TypeScript (amplifier) | O_APPEND |
| `cards/YYYY-MM-DD.png` | TypeScript (card generator) | TypeScript (server, web UI) | Overwrite (idempotent) |
| `state/daemon.pid` | Go daemon | TypeScript (status check), Go daemon (startup) | flock() on file |
| `state/daemon.sock` | Go daemon (listener) | Shell hook (via unfade-send) | Unix socket |
| `state/health.json` | Go daemon | TypeScript (status, TUI) | Atomic: tmp + rename |
| `state/server.json` | TypeScript (server startup) | TypeScript (CLI commands) | Atomic: tmp + rename |
| `state/init_progress.json` | TypeScript (init command) | TypeScript (init command) | Atomic: tmp + rename |
| `~/.unfade/state/repos.json` | TypeScript (init, deinit) | Go daemon (startup, ConfigWatcher) | Atomic: tmp + rename |
| `~/.unfade/state/daemon.pid` | Go daemon | TypeScript, Go daemon | flock() on file |
| `~/.unfade/state/daemon.sock` | Go daemon | unfade-send | Unix socket |

---

## Cross-Phase Reference: Test Matrix

| Phase | Test Category | Count | Focus |
|---|---|---|---|
| **0** | Build verification | 4 | Both compilers succeed, lint passes |
| **1** | Daemon lifecycle, fingerprint accuracy, distill pipeline, TUI rendering | 14 | The foundation must be rock-solid |
| **2** | HTTP API responses, MCP resource/tool parity, web UI rendering, query CLI | 16 | Protocol parity between HTTP and MCP |
| **3** | Card rendering, terminal capture, debugging detection, export | 19 | Card visual fidelity, capture latency |
| **4** | Personalization accuracy, amplification precision, blind spots, search | 9 | No false positives in connections |
| **5** | Stranger install, ClawHub integration, static site rendering, npm publish | 8 | End-to-end first-time user experience |

---

## Build-in-Public Posting Schedule

| Day | Platform | Post Content |
|---|---|---|
| **Mon AM** | X + Reddit | "Building an open-source reasoning engine this week." |
| **Mon PM** | X | Screenshot of Reasoning Fingerprint + first Daily Distill |
| **Tue PM** | X + r/ClaudeCode + r/cursor | GIF of MCP integration: "My AI now remembers yesterday" |
| **Wed PM** | X + LinkedIn | YOUR Unfade Card — the card IS the marketing |
| **Thu PM** | X + r/ExperiencedDevs | YOUR reasoning profile: "Does this match how you think?" |
| **Fri AM** | HN "Show HN" | Full launch post |
| **Fri PM** | X + Reddit + Indie Hackers | "Unfade is live. `npx unfade init`." + Thinking Graph link |

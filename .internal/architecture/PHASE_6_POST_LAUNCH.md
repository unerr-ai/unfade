# Phase 6 — Post-Launch & Enterprise Prep

> **Feature Statement:** _"Unfade runs everywhere. Windows developers get the same invisible capture experience. Cloud distillation via GPT-4o or Claude produces higher-fidelity reasoning extraction for teams that want it. The multi-user data model lets engineering teams share reasoning context while keeping individual profiles isolated. The enterprise specification defines the path to hosted profiles, SSO, and paid tiers — ready to build when demand materializes."_
>
> **Prerequisites:** [Phase 4 — Platform & Launch](./PHASE_4_PLATFORM_AND_LAUNCH.md) complete in product terms (npm distribution, MCP, Thinking Graph / site generation, E2E green, continuous runtime as defined there). Older “Phase 5 ecosystem” material is merged into Phase 4 + repo; there is **no** `PHASE_5_ECOSYSTEM_LAUNCH.md` in this tree.
>
> **Status:** PLANNING
>
> **Note:** Phase 6 is NOT time-boxed to a single day. It is the immediate post-launch roadmap. Each micro-sprint is independently deployable.
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
- [6. Implementation Plan (Micro-Sprints 6A–6B)](#6-implementation-plan-micro-sprints-6a6b)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 6 is the **expansion phase**. Everything built in Phases 0–5 works on macOS/Linux with local Ollama. Three strategic objectives unlock the next growth tier:

1. **Platform coverage:** Windows support brings Unfade to ~30% of professional developers. Named pipes replace Unix sockets, Task Scheduler replaces launchd/systemd, PowerShell hooks replace zsh/bash hooks. The Go daemon's platform abstraction makes this a clean layer addition.

2. **Distill quality escalation:** Cloud LLMs (GPT-4o, Claude) produce significantly higher-fidelity reasoning extraction than local Ollama models. This is an opt-in enhancement — local-first remains the default. Teams that want premium distills can configure an API key and immediately see the difference.

3. **Revenue path:** Team Unfades and Enterprise features define the monetization vector. Shared reasoning context across a team is the collaboration unlock. Hosted profiles, SSO, and admin dashboards are the enterprise features that justify paid tiers.

### 1.2 The Principle

> **Windows is a platform layer, not a rewrite. Cloud distill is a provider swap, not an architecture change. Team Unfades is a directory restructure, not a data model rewrite. Enterprise is a specification, not an implementation. Each expansion leverages the existing architecture rather than replacing it.**

---

## 2. The Problem

### Current State (after Phase 5)

Unfade is published, discoverable, and works end-to-end on macOS and Linux. Distillation uses local Ollama (or structured summaries if no LLM configured). Single-developer only — no multi-user awareness. No Windows support. No cloud LLM option. No enterprise story.

### After Phase 6

| Concern | State |
|---|---|
| **Windows support** | Full platform parity: named pipes, PowerShell hooks, Task Scheduler auto-start, `unfade-send.exe` |
| **Cloud distillation** | OpenAI (GPT-4o) and Anthropic (Claude) as opt-in providers via Vercel AI SDK |
| **Team Unfades** | Per-developer profiles with shared event context, team aggregate reasoning |
| **Enterprise spec** | Complete specification: hosted profiles, SSO (SAML/OIDC), admin dashboard, audit log, pricing model |

---

## 3. Research

### 3.1 Windows IPC Patterns

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Named pipes** (`\\.\pipe\`) | Windows-native, supports ACLs, no port conflicts, bidirectional | Windows-only API surface | **Best fit** — direct equivalent of Unix domain sockets |
| **TCP localhost** | Cross-platform, simple | No built-in auth, port conflict risk, firewall interference | Too fragile for background daemon |
| **AF_UNIX sockets** | Available on Win10 1803+ | Limited tooling, not idiomatic Windows, poor ecosystem support | Too experimental |

### 3.2 Windows Auto-Start Mechanisms

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Task Scheduler** | System-native, XML task definition, survives reboots, trigger-at-logon | Requires XML schema knowledge | **Best fit** — equivalent of launchd plist |
| **Startup folder** | Simple shortcut drop | No restart-on-crash, no logging | Too primitive |
| **Windows Service** | Full service lifecycle | Requires service wrapper (e.g., NSSM), heavyweight | Overkill for user-space daemon |

### 3.3 PowerShell Hook Mechanisms

| Mechanism | Purpose | Verdict |
|---|---|---|
| **`Set-PSReadLineOption -AddToHistoryHandler`** | Intercept commands before execution | **Pre-command capture** |
| **`Register-EngineEvent PowerShell.OnIdle`** | Fire after command completes and shell is idle | **Post-command capture** (directory, exit code) |
| **PowerShell profile** (`$PROFILE`) | Auto-loaded on shell start | **Hook installation target** — append to `$PROFILE` |

### 3.4 Cloud LLM Provider Comparison

| Provider | Model | Structured Output | SDK | Verdict |
|---|---|---|---|---|
| **OpenAI** | GPT-4o | JSON mode + function calling | `@ai-sdk/openai` | **Supported** — highest market share |
| **Anthropic** | Claude 4 | Tool use for structured output | `@ai-sdk/anthropic` | **Supported** — strong reasoning extraction |
| **Ollama** (existing) | Llama 3, Mistral, etc. | JSON mode via Ollama API | `ollama-ai-provider` | **Default** — local, no API key |

All three integrate through Vercel AI SDK's `generateObject()` — the provider is a configuration swap, not an architecture change.

### 3.5 Multi-Tenant Data Models for Local-First Tools

| Pattern | Description | Verdict |
|---|---|---|
| **Per-user subdirectories** | `.unfade/profiles/{identity}/` | **Best fit** — simple, inspectable, greppable |
| **Shared event stream** | All developers' events in one `events/` directory | **Correct** — events are repo-level, attributed by git author |
| **Isolated distills** | Per-developer OR team-wide distillation | **Both** — filter by `git config user.email` for individual, aggregate for team |

### 3.6 Enterprise SSO Patterns

| Protocol | Use Case | Verdict |
|---|---|---|
| **SAML 2.0** | Enterprise IdP integration (Okta, Azure AD) | **Required** — enterprise standard |
| **OIDC** | Modern SSO (Google Workspace, Auth0) | **Required** — developer-friendly alternative |
| **API key** | Headless/CI authentication | **Required** — for hosted profile API access |

---

## 4. Architecture

### 4.1 Windows Platform Layer

```
daemon/internal/platform/
├── unix.go                      # EXISTING — Unix socket listener (macOS/Linux)
├── windows.go                   # NEW — Named pipe listener (Windows)
├── scheduler_launchd.go         # EXISTING — macOS auto-start
├── scheduler_systemd.go         # EXISTING — Linux auto-start
├── scheduler_taskscheduler.go   # NEW — Windows Task Scheduler auto-start
└── hooks/
    ├── zsh.go                   # EXISTING — zsh precmd/preexec hooks
    ├── bash.go                  # EXISTING — bash PROMPT_COMMAND hooks
    └── powershell.go            # NEW — PowerShell profile hooks

daemon/cmd/unfade-send/
├── main.go                      # EXISTING — Unix socket client
└── main_windows.go              # NEW — Named pipe client (build-tagged)
```

**Build constraint:** Windows-specific files use `//go:build windows` tags. The Go build system selects the correct implementation at compile time. No runtime platform detection for IPC.

### 4.2 Cloud Provider Architecture

```
src/services/distill/providers/
├── ollama.ts                    # EXISTING — local Ollama adapter
├── openai.ts                    # NEW — OpenAI adapter (@ai-sdk/openai)
├── anthropic.ts                 # NEW — Anthropic adapter (@ai-sdk/anthropic)
└── index.ts                     # Provider registry — resolves config → adapter
```

**Provider resolution:** `index.ts` reads `config.distill.provider` and returns the correct adapter. All adapters implement the same interface: `distill(events: CaptureEvent[]) → DistillOutput`. The `generateObject()` call with `DistillOutputSchema` as the Zod schema is identical across providers — only the model identifier changes.

### 4.3 Multi-User Data Model

```
.unfade/
├── events/                              # SHARED — all developers' events
│   ├── 2026-04-15.jsonl                 # Events attributed by git author email
│   └── 2026-04-16.jsonl
├── profiles/                            # NEW — per-developer profiles
│   ├── alice@company.com/
│   │   └── reasoning_model.json         # Alice's reasoning profile
│   └── bob@company.com/
│       └── reasoning_model.json         # Bob's reasoning profile
├── distills/                            # Per-developer or team-wide
│   ├── alice@company.com/
│   │   └── 2026-04-16.json             # Alice's distill (filtered by author)
│   └── _team/
│       └── 2026-04-16.json             # Team-wide distill (all events)
├── profile/
│   └── reasoning_model.json            # LEGACY — single-user (migrated to profiles/)
├── config.json
└── site/
```

**Identity resolution:** `git config user.email` is the identity key. On every `unfade` invocation, the current git email determines which profile directory to read/write. The MCP server uses the same identity resolution for `unfade://profile`.

**Migration path:** Single-user `profile/reasoning_model.json` → `profiles/{email}/reasoning_model.json`. Migration runs on first Team Unfades init. Old path preserved as symlink for backward compatibility during transition.

### 4.4 Enterprise Architecture (Specification Only)

```
docs/architecture/
├── ENTERPRISE_SPEC.md           # NEW — full enterprise specification
│   ├── Hosted Profiles          # unfade.dev/username — server-side API
│   ├── SSO Integration          # SAML/OIDC flow
│   ├── Admin Dashboard          # Team analytics, blind spot reports
│   ├── Audit Log                # Query attribution, data access log
│   └── Pricing Model            # Free / Pro / Enterprise tiers
└── TEAM_DATA_MODEL.md           # NEW — multi-user data model spec
```

---

## 5. Design Principles

### 5a. Platform Parity Without Platform Coupling

Windows support is a **platform layer addition**, not a cross-cutting change. The Go daemon already abstracts IPC behind an interface (`Listener`). Adding `NamedPipeListener` implements that interface for Windows. No macOS/Linux code changes. Build tags (`//go:build windows`) ensure compile-time selection.

### 5b. Cloud Distill as Opt-In Enhancement

Cloud providers are **explicitly opt-in**. The system NEVER auto-selects a cloud provider, even if an API key is present. The user must set `config.distill.provider` to `"openai"` or `"anthropic"`. Local Ollama (or no-LLM structured summaries) remains the default forever. API keys stored in `config.json` only — never logged, never transmitted except to the selected provider's API endpoint.

### 5c. Per-Developer Isolation, Shared Events

Events are **repo-level** (shared across all developers on the same repo). Profiles are **person-level** (isolated by git email). Distills can be **either** — filtered by author for individual, aggregated for team. This mirrors git itself: commits are shared, but authorship is individual.

### 5d. Enterprise as Specification First

UF-096 and UF-097 produce **specification documents**, not implementation code. The specifications must be detailed enough that an AI agent can implement them in a future phase. Implementation is deferred until enterprise demand materializes — but the specifications are built NOW so the architecture decisions are locked in while the system design is fresh.

---

## 6. Implementation Plan (Micro-Sprints 6A–6B)

### Phase 6 Boundary

> **What the AI agent MUST know before touching Phase 6 code:**

**READS** (from previous phases):

| Data | Source | Schema | Owner |
|---|---|---|---|
| Capture events | `.unfade/events/*.jsonl` | `CaptureEventSchema` (`src/schemas/capture-event.ts`) | Go daemon (write), TypeScript (read) |
| Distill output | `.unfade/distills/*.json` | `DistillOutputSchema` (`src/schemas/distill-output.ts`) | TypeScript |
| Reasoning profile | `.unfade/profile/reasoning_model.json` | `ReasoningModelSchema` (`src/schemas/reasoning-model.ts`) | TypeScript |
| Config | `.unfade/config.json` | `ConfigSchema` (`src/schemas/config.ts`) | TypeScript |
| Daemon IPC | Unix socket (macOS/Linux) | JSON-line `CaptureEvent` messages | Go daemon |

**WRITES** (new in Phase 6):

| Data | Destination | Schema | Owner |
|---|---|---|---|
| Windows named pipe | `\\.\pipe\unfade-daemon` | Same JSON-line `CaptureEvent` messages | Go daemon |
| Cloud provider config | `.unfade/config.json` (`distill.provider`, `distill.apiKey`) | Extended `ConfigSchema` | TypeScript |
| Per-developer profiles | `.unfade/profiles/{email}/reasoning_model.json` | `ReasoningModelSchema` | TypeScript |
| Per-developer distills | `.unfade/distills/{email}/*.json` | `DistillOutputSchema` | TypeScript |
| Team aggregate distills | `.unfade/distills/_team/*.json` | `DistillOutputSchema` | TypeScript |
| Team data model spec | `docs/architecture/TEAM_DATA_MODEL.md` | N/A (document) | TypeScript |
| Enterprise spec | `docs/architecture/ENTERPRISE_SPEC.md` | N/A (document) | TypeScript |

---

**Windows Named Pipe Contract:**

```
Pipe name:    \\.\pipe\unfade-daemon
Protocol:     JSON-line CaptureEvent messages (identical to Unix socket)
Direction:    unfade-send.exe → daemon (unidirectional write)
Auth:         Pipe ACL restricts to current user SID
Buffer:       4096 bytes per message (same as Unix socket)
Reconnect:    unfade-send.exe retries 3× with 100ms backoff on pipe busy
```

**Task Scheduler XML Contract:**

```xml
<!-- Registered at: %LOCALAPPDATA%\Unfade\unfade-daemon.xml -->
<Task>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
  </Triggers>
  <Settings>
    <RestartOnFailure>
      <Interval>PT10S</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>  <!-- No timeout -->
  </Settings>
  <Actions>
    <Exec>
      <Command>%LOCALAPPDATA%\Unfade\unfaded.exe</Command>
      <Arguments>--workdir %CD%</Arguments>
    </Exec>
  </Actions>
</Task>
```

**PowerShell Hook Contract:**

```powershell
# Appended to $PROFILE by unfade init on Windows
# Pre-command: capture command text
Set-PSReadLineOption -AddToHistoryHandler {
    param($command)
    & "$env:LOCALAPPDATA\Unfade\unfade-send.exe" terminal-pre $command
    return $true
}
# Post-command: capture directory and exit code
Register-EngineEvent PowerShell.OnIdle -Action {
    & "$env:LOCALAPPDATA\Unfade\unfade-send.exe" terminal-post $PWD $LASTEXITCODE
} | Out-Null
```

**Cloud Provider Config Extension:**

```jsonc
// Added to ConfigSchema (src/schemas/config.ts)
{
  "distill": {
    "provider": "ollama",                    // "ollama" | "openai" | "anthropic"
    "model": "llama3",                       // provider-specific model name
    "apiKey": null,                           // required for cloud providers
    "cloudOptIn": false                       // explicit opt-in gate
  }
}
```

**Team Profile Directory Contract:**

```
Identity key:       git config user.email
Profile path:       .unfade/profiles/{git-email}/reasoning_model.json
Distill path:       .unfade/distills/{git-email}/{date}.json
Team distill path:  .unfade/distills/_team/{date}.json
MCP resource:       unfade://profile → current user (resolved by git email)
MCP resource:       unfade://team/profile → aggregate of all profiles
Migration:          .unfade/profile/ → .unfade/profiles/{email}/ (auto on first team init)
```

**Enterprise Spec Required Sections:**

```
1. Hosted Profiles    — unfade.dev/username, server API, CDN, data sync
2. SSO Integration    — SAML 2.0 + OIDC flows, IdP metadata, session management
3. Admin Dashboard    — team analytics, blind spot reports, onboarding metrics
4. Audit Log          — query attribution, data access events, retention policy
5. Pricing Model      — Free / Pro / Enterprise tiers, feature matrix, billing
```

---

### Sprint 6A — Platform Expansion & Cloud Distill (Implementation, 2 tasks)

**Objective:** Extend Unfade to Windows with full platform parity (named pipes, Task Scheduler, PowerShell hooks, `unfade-send.exe`) and add cloud LLM providers (OpenAI, Anthropic) for higher-quality distillation.

**Acid test:**

```bash
# Windows (on Windows machine):
unfade init && \
  Get-Process unfaded && \
  powershell -Command "[System.IO.Pipes.NamedPipeClientStream]::new('.', 'unfade-daemon', 'InOut')" && \
  schtasks /query /tn "Unfade Daemon" && \
  echo "PASS: Windows platform support works"

# Cloud distill (any platform):
UNFADE_PROVIDER=openai unfade distill --provider openai && \
  cat .unfade/distills/$(date +%Y-%m-%d).json | grep -q '"provider"' && \
  echo "PASS: Cloud distill works"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **UF-094** | Windows platform support: (1) Go `NamedPipeListener` in `daemon/internal/platform/windows.go` — listen on `\\.\pipe\unfade-daemon`, ACL restricted to current user SID. (2) Task Scheduler integration in `scheduler_taskscheduler.go` — XML task definition (see Phase 6 Boundary), register on `unfade init`, trigger at logon, restart on failure. (3) PowerShell hooks in `hooks/powershell.go` — append to `$PROFILE`, use `Set-PSReadLineOption` for pre-command capture, `Register-EngineEvent PowerShell.OnIdle` for post-command (see Phase 6 Boundary). (4) Build `unfade-send.exe` in `main_windows.go` — write to named pipe instead of Unix socket, retry 3× on pipe busy. Full init → daemon → capture → distill cycle on Windows | `daemon/internal/platform/windows.go`, `daemon/internal/platform/scheduler_taskscheduler.go`, `daemon/internal/platform/hooks/powershell.go`, `daemon/cmd/unfade-send/main_windows.go` | [ ] |
| **UF-095** | Cloud distillation providers: (1) Register `@ai-sdk/openai` adapter in `openai.ts` — use `generateObject()` with `DistillOutputSchema`, model configurable (default `gpt-4o`). (2) Register `@ai-sdk/anthropic` adapter in `anthropic.ts` — use `generateObject()` with `DistillOutputSchema`, model configurable (default `claude-sonnet-4-20250514`). (3) Update provider registry `index.ts` — resolve `config.distill.provider` to correct adapter, enforce `cloudOptIn` gate. (4) Add `--provider` flag to `distill` command — overrides configured provider for single run. (5) Add provider selection to web UI `/settings` page — dropdown with Ollama/OpenAI/Anthropic, API key input, explicit opt-in toggle. Cloud providers NEVER auto-select | `src/services/distill/providers/openai.ts`, `src/services/distill/providers/anthropic.ts`, `src/services/distill/providers/index.ts`, `src/commands/distill.ts`, `src/web/pages/settings.tsx` | [ ] |

> **Agent Directive for Sprint 6A:** "You are implementing two independent platform expansion features. For UF-094: work ONLY in the Go daemon under `daemon/internal/platform/` and `daemon/cmd/unfade-send/`. Add `windows.go` with `NamedPipeListener` implementing the existing `Listener` interface — listen on `\\.\pipe\unfade-daemon` with ACL restricted to current user. Add `scheduler_taskscheduler.go` with XML task definition registration. Add `hooks/powershell.go` with `$PROFILE` modification. Build `main_windows.go` with `//go:build windows` tag. Do NOT modify existing Unix/macOS implementations. For UF-095: work ONLY in `src/services/distill/providers/`. Add `openai.ts` and `anthropic.ts` adapters using Vercel AI SDK's `generateObject()` with the existing `DistillOutputSchema`. Update `index.ts` provider registry with `cloudOptIn` enforcement. Add `--provider` flag to `src/commands/distill.ts`. Add provider selection UI to web settings page. Cloud providers MUST require explicit opt-in via `config.distill.cloudOptIn = true`. All logging to stderr. stdout is sacred (MCP only)."

**Strict contracts:**
- Named pipe: `\\.\pipe\unfade-daemon`, same JSON-line protocol as Unix socket
- Build tags: `//go:build windows` on all Windows-specific Go files
- Provider config: `config.distill.provider` + `config.distill.apiKey` + `config.distill.cloudOptIn`
- All providers use `generateObject()` with `DistillOutputSchema` — structured output guaranteed
- Cloud providers: explicit opt-in via `cloudOptIn: true`, never auto-select
- `--provider` flag: single-run override, does not persist to config

---

### Sprint 6B — Team & Enterprise Architecture (Specification, 2 tasks)

**Objective:** Define the multi-user data model for Team Unfades and specify the full Enterprise feature set. These are DESIGN tasks producing specification documents with enough detail for AI agent implementation in a future phase.

**Acid test:**

```bash
# Team spec validation:
test -f docs/architecture/TEAM_DATA_MODEL.md && \
  grep -q "profiles/{git-email}" docs/architecture/TEAM_DATA_MODEL.md && \
  grep -q "unfade://team/profile" docs/architecture/TEAM_DATA_MODEL.md && \
  grep -q "migration" docs/architecture/TEAM_DATA_MODEL.md && \
  echo "PASS: Team data model spec complete"

# Enterprise spec validation:
test -f docs/architecture/ENTERPRISE_SPEC.md && \
  grep -q "SAML" docs/architecture/ENTERPRISE_SPEC.md && \
  grep -q "OIDC" docs/architecture/ENTERPRISE_SPEC.md && \
  grep -q "pricing" docs/architecture/ENTERPRISE_SPEC.md && \
  grep -q "audit" docs/architecture/ENTERPRISE_SPEC.md && \
  echo "PASS: Enterprise spec complete"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **UF-096** | Team Unfades specification: write `TEAM_DATA_MODEL.md` defining the multi-user data model. (1) Per-developer profile directory: `.unfade/profiles/{git-email}/reasoning_model.json`. (2) Shared events: one `events/` directory, events attributed by git author email in `CaptureEvent.author` field. (3) Per-developer distills: filtered by `git config user.email` author match. (4) Team-wide distills: aggregate all events into `distills/_team/`. (5) MCP resources: `unfade://profile` returns current user's profile (identity via git email), `unfade://team/profile` returns merged aggregate. (6) Migration path: single-user `profile/` → multi-user `profiles/{email}/`, auto-migrate on first team init, symlink old path for backward compat. (7) Zod schema extensions as structured pseudo-code. Follow Research → Reason → Validate → Execute structure | `docs/architecture/TEAM_DATA_MODEL.md` | [ ] |
| **UF-097** | Enterprise features specification: write `ENTERPRISE_SPEC.md` defining five feature domains. (1) Hosted profiles: `unfade.dev/username` — server-side API (profile sync endpoint, static site hosting, CDN), data flow from local `.unfade/` to hosted. (2) SSO integration: SAML 2.0 + OIDC flows, IdP metadata consumption, session management, JIT provisioning. (3) Admin dashboard: team-level reasoning analytics (aggregate profile, blind spot reports, onboarding velocity metrics), role-based access. (4) Audit log: query attribution (who asked what MCP question, when), data access events, retention policy (90-day default). (5) Pricing model: Free tier (local-only, single user), Pro tier (cloud distill, hosted profile), Enterprise tier (team, SSO, admin, audit). Include feature matrix, billing integration design, and upgrade flow. Follow Research → Reason → Validate → Execute structure | `docs/architecture/ENTERPRISE_SPEC.md` | [ ] |

> **Agent Directive for Sprint 6B:** "You are writing SPECIFICATION DOCUMENTS, not implementation code. For UF-096: create `docs/architecture/TEAM_DATA_MODEL.md` following the RRVV structure (Research → Reason → Validate → Execute). Define the multi-user data model: profile directory structure keyed by `git config user.email`, shared event stream with author attribution, per-developer vs team-wide distillation semantics, MCP resource endpoints (`unfade://profile`, `unfade://team/profile`), identity resolution, and migration path from single-user to multi-user. Include Zod schema extensions as structured pseudo-code. For UF-097: create `docs/architecture/ENTERPRISE_SPEC.md` following the same RRVV structure. Define five domains: hosted profiles (`unfade.dev/username`), SSO (SAML 2.0 + OIDC), admin dashboard (team analytics), audit log (query attribution), and pricing model (Free/Pro/Enterprise). Include API endpoint designs, data models, deployment architecture, and cost analysis. Both documents must be detailed enough for an AI agent to implement directly from the spec."

**Strict contracts:**
- Identity key: `git config user.email` — no other identity mechanism
- Profile path: `.unfade/profiles/{git-email}/reasoning_model.json`
- Team distill path: `.unfade/distills/_team/{date}.json`
- MCP resources: `unfade://profile` (current user), `unfade://team/profile` (aggregate)
- Events directory: shared, never per-developer
- Enterprise spec: must cover all 5 domains (hosted, SSO, admin, audit, pricing)
- Both docs: RRVV structure (Research → Reason → Validate → Execute)

---

### Tests (T-233 → T-246)

| Sprint | ID | Test Description | File |
|---|---|---|---|
| 6A | **T-233** | Windows named pipe listener starts and accepts JSON-line connections | `test/daemon/platform/windows_test.go` |
| 6A | **T-234** | Task Scheduler XML registers on init and queries successfully | `test/daemon/platform/scheduler_taskscheduler_test.go` |
| 6A | **T-235** | PowerShell hooks append to `$PROFILE` and capture pre/post commands | `test/daemon/platform/hooks_powershell_test.go` |
| 6A | **T-236** | `unfade-send.exe` writes CaptureEvent to named pipe, retries on busy | `test/daemon/cmd/unfade-send/main_windows_test.go` |
| 6A | **T-237** | OpenAI provider returns structured `DistillOutput` via `generateObject` | `test/services/distill/providers/openai.test.ts` |
| 6A | **T-238** | Anthropic provider returns structured `DistillOutput` via `generateObject` | `test/services/distill/providers/anthropic.test.ts` |
| 6A | **T-239** | `--provider` flag overrides configured provider for single run | `test/commands/distill.test.ts` |
| 6A | **T-240** | Cloud provider requires `cloudOptIn: true` — rejects if false or missing | `test/services/distill/providers/index.test.ts` |
| 6B | **T-241** | Team data model spec defines per-developer profile schema | `docs/architecture/TEAM_DATA_MODEL.md` (review) |
| 6B | **T-242** | Team data model spec includes migration path from single-user | `docs/architecture/TEAM_DATA_MODEL.md` (review) |
| 6B | **T-243** | Team data model spec defines MCP resources (`unfade://profile`, `unfade://team/profile`) | `docs/architecture/TEAM_DATA_MODEL.md` (review) |
| 6B | **T-244** | Enterprise spec defines hosted profiles architecture (`unfade.dev/username`) | `docs/architecture/ENTERPRISE_SPEC.md` (review) |
| 6B | **T-245** | Enterprise spec defines SSO flows (SAML 2.0 + OIDC) | `docs/architecture/ENTERPRISE_SPEC.md` (review) |
| 6B | **T-246** | Enterprise spec defines pricing model (Free / Pro / Enterprise) | `docs/architecture/ENTERPRISE_SPEC.md` (review) |

---

## 7. Success Metrics

| Metric | Baseline (Phase 5) | Target | Measurement |
|---|---|---|---|
| **Windows E2E** | N/A (macOS/Linux only) | Full init → capture → distill cycle passes on Windows | Manual test on Windows machine |
| **Cloud distill quality** | Ollama baseline | Cloud distill produces noticeably richer reasoning extraction (subjective + structural comparison) | Compare Ollama vs GPT-4o distill for same day's events |
| **Provider opt-in enforcement** | N/A | Cloud provider never activates without explicit `cloudOptIn: true` | Automated test T-240 |
| **Team spec completeness** | N/A | `TEAM_DATA_MODEL.md` covers schemas, MCP resources, migration path | Document review (T-241, T-242, T-243) |
| **Enterprise spec completeness** | N/A | `ENTERPRISE_SPEC.md` covers all 5 domains | Document review (T-244, T-245, T-246) |
| **Test count** | 232+ (Phase 5) | 246+ tests, all passing | `pnpm test` (TypeScript) + `make test` (Go) |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Windows named pipe permissions** | Medium | High — pipe accessible to other users | Pipe ACL restricts to current user SID. Test with UAC enabled and multiple user accounts |
| **Cloud API key security** | Medium | High — key leakage | Keys in `config.json` only (local file, user-owned). Never log keys. Never include in MCP responses. Warn if `.unfade/config.json` is git-tracked (add to `.gitignore` template) |
| **Cloud provider rate limits** | Low | Medium — distill fails | Cache cloud distill results. Don't re-distill same day twice unless `--force`. Show clear error: "Rate limited — try again in X minutes or switch to local Ollama" |
| **PowerShell profile conflicts** | Medium | Medium — breaks user's existing `$PROFILE` | Wrap Unfade hooks in guarded block (`# BEGIN UNFADE` / `# END UNFADE`). Check for existing block before appending. `unfade init --force` replaces block |
| **Team profile merge conflicts** | Medium | Medium — concurrent writes | One-writer-per-profile rule (same as `.unfade/` convention). Profile keyed by git email — each developer writes only their own profile |
| **Enterprise scope creep into implementation** | High | Medium — premature implementation wastes effort | Sprint 6B is SPECIFICATION ONLY. Agent directive explicitly forbids implementation code. Spec documents use structured pseudo-code, never runnable code |
| **Migration from single-user to multi-user** | Medium | High — data loss | Migration preserves original `profile/reasoning_model.json` as symlink. Atomic move: create `profiles/{email}/`, copy, verify, then create symlink. Rollback: delete `profiles/`, symlink removal restores original |

---

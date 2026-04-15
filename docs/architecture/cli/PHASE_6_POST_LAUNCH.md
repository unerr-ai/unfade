# Phase 6: Post-Launch & Enterprise Prep

> **Status:** PLANNING
>
> **Last updated:** 2026-04-15
>
> **Prerequisites:** Phase 5 (Ecosystem Launch) complete

---

## 1. Feature Statement

Expand platform support, add cloud distillation option, and prepare for multi-user / enterprise features. This phase is NOT time-boxed — it's the roadmap after the 5-day launch.

---

## 2. Acid Test

```
# Windows test
# On Windows machine:
unfade init → daemon starts, named pipe works, Task Scheduler auto-start
# PowerShell hook captures terminal commands

# Cloud distill test
unfade distill --provider openai
→ Higher-quality distill using GPT-4o

# Team test
# Two developers, same repo — each gets their own profile but shared reasoning context
```

---

## 3. Tasks (4)

### Task UF-094: Windows Support

Named pipes, PowerShell hooks, Task Scheduler auto-start.

**Agent directive:** "Extend Go daemon: add NamedPipeListener in `daemon/internal/platform/windows.go` — listen on `\\.\pipe\unfade-daemon`. Add Task Scheduler integration: XML task definition, register on `unfade init`, trigger at logon. Build PowerShell hook for `unfade init` on Windows: use `Set-PSReadLineOption` for pre-command capture and `Register-EngineEvent PowerShell.OnIdle` for post-command. Build `unfade-send.exe` that writes to the named pipe instead of Unix socket. Test: full init → daemon → capture → distill cycle on Windows."

| ID | Status |
|---|---|
| UF-094 | `NOT STARTED` |

---

### Task UF-095: Cloud Distillation

Add OpenAI and Anthropic as LLM provider options for higher-quality distillation.

**Agent directive:** "Implement `src/services/llm/openai.ts` and `src/services/llm/anthropic.ts` — both implement the LLMProvider interface. Use the official SDKs (`openai`, `@anthropic-ai/sdk`). API keys read from `config.json`. The `unfade distill --provider openai` flag overrides the configured provider for a single run. Add provider selection to web UI `/settings` page. Cloud providers require explicit opt-in — never auto-select a cloud provider."

| ID | Status |
|---|---|
| UF-095 | `NOT STARTED` |

---

### Task UF-096: Team Unfades

Multi-user reasoning on the same repository — each developer gets their own profile, but shared reasoning context is available.

**Agent directive:** "Design the multi-user data model: each developer gets their own `.unfade/profiles/{git-email}/reasoning_model.json`. Events are shared (one `events/` directory). Distills can be per-developer (filtered by git author) or team-wide. The MCP resource `unfade://profile` returns the current user's profile (identified by git config email). Team aggregate profiles are available via `unfade://team/profile`. This is a design task — define the schemas and data flow, defer implementation to when there's user demand."

| ID | Status |
|---|---|
| UF-096 | `NOT STARTED` |

---

### Task UF-097: Enterprise Features

SSO, admin controls, hosted profiles — features that unlock paid tiers.

**Agent directive:** "Define the enterprise feature set: (1) Hosted profiles at `unfade.dev/username` — requires a server-side component (API + hosting). (2) SSO integration — SAML/OIDC for enterprise onboarding. (3) Admin dashboard — team-level reasoning analytics, blind spot reports, onboarding metrics. (4) Audit log — who queried what reasoning context, when. This is a specification task — write `docs/architecture/ENTERPRISE_SPEC.md` with the data model, API design, and pricing model. Defer implementation until there's enterprise demand."

| ID | Status |
|---|---|
| UF-097 | `NOT STARTED` |

---

# Phase 10: System Hardening — Logging, Onboarding Enforcement & Observability

> **Purpose:** Resolve three interconnected system failures: (1) inadequate logging for debugging, (2) "Start Exploring" button race condition, and (3) absence of mandatory LLM configuration enforcement.
>
> **Method:** RRVV (Rigorous Research → Reason → Validate → Execute)
>
> **Status:** ACTIVE
>
> **Created:** 2026-04-20

---

## Table of Contents

1. [Rigorous Research: Current State Analysis](#1-rigorous-research-current-state-analysis)
2. [Reason: Root Cause Chain & Design Decisions](#2-reason-root-cause-chain--design-decisions)
3. [Validate: Acceptance Criteria](#3-validate-acceptance-criteria)
4. [Execute: Implementation Plan](#4-execute-implementation-plan)
5. [Implementation Tracker](#5-implementation-tracker)

---

## 1. Rigorous Research: Current State Analysis

### 1.1 Log Analysis from User Session

```json
{"level":40,"time":1776698050727,"pid":32890,"msg":"Could not read existing config, starting fresh"}
{"level":30,"time":1776698050729,"pid":32890,"msg":"LLM config updated","provider":"custom","model":"accounts/fireworks/models/qwen3-vl-30b-a3b-instruct"}
```

**Observations:**
- Only 2 log lines for an entire LLM configuration save operation
- No log for: incoming request, form parse, validation result, connectivity test outcome, setup-status.json update, response sent
- Level 40 (warn) for "could not read config" is expected on first setup — should be debug, not warn
- No correlation ID linking these two lines to the same HTTP request
- No timestamp-relative context (was this 2ms or 200ms apart?)
- The user configured a custom Fireworks-hosted Qwen model — the test completion ran but we don't see its result logged

### 1.2 "Start Exploring" Button — Race Condition

The button in `setup.ts` line 162-167:
```html
<a href="/" hx-post="/api/setup/complete" hx-swap="none">Start Exploring →</a>
```

**Problem chain:**
1. HTMX intercepts click → fires POST to `/api/setup/complete`
2. But `hx-swap="none"` doesn't prevent default → browser follows `href="/"` immediately
3. Navigation to `/` starts before the POST response arrives
4. Home page JS fetches `/unfade/settings/status`
5. If LLM provider is still "none" (user skipped LLM step), returns `configured: false`
6. Home redirects back to `/setup` → **infinite loop** if user didn't configure LLM
7. If user DID configure LLM, home works — but `setup-status.json` write may not complete → `setupCompleted` stays false

**The real issue:** The button's behavior depends on whether the user configured an LLM. If they didn't (which is marked "optional" in the UI), clicking "Start Exploring" loops them back to setup because home.ts gates on `distill.provider !== "none"`.

### 1.3 Configuration Gating Architecture

| Layer | Enforcement | Scope |
|---|---|---|
| Server middleware | **NONE** | All routes accessible without any check |
| Home page JS | Client-side redirect | Only `/` checks config status; all other pages unguarded |
| Setup page | No blocking | Displays steps but doesn't enforce completion order |
| Navigation | Always visible | User can click any nav item at any time |

**Result:** A user can:
- Navigate directly to `/intelligence`, `/comprehension`, `/coach` without any LLM configured
- Those pages will show empty/error states with no explanation
- The "setup required" redirect only fires on the home page

### 1.4 Logging Gap Analysis

| Operation | Expected Logs | Actual Logs |
|---|---|---|
| POST /settings/llm | Request received, parse, validate, write, connectivity test, response | 1 warn + 1 info |
| POST /api/setup/complete | Request received, status written, response | **ZERO** |
| POST /api/integrations/install | Request received, tool, file read, merge, write, response | 1 info on success |
| GET / (home page state machine) | Settings check result, summary result, state transition | **ZERO** (client-side only) |
| Browser auto-open on first run | open command, URL, success/failure | **ZERO** |
| Integration deeplink click | N/A (client-side) | N/A |
| Setup page load | N/A (static render) | N/A |

### 1.5 Silent Failure Points

1. `POST /api/setup/complete` — if `updateSetupStatus` throws, catches silently returns 500 JSON but no log
2. `testLlmCompletion` — timeout/network errors caught but not logged server-side
3. Home page fetch chain — `.catch()` falls back silently, never reports why status check failed
4. Integration install — if `TOOLS[tool]` lookup fails, returns 400 but doesn't log what tool was attempted
5. Config parse errors in setup-status.json — caught with empty catch, starts fresh silently

---

## 2. Reason: Root Cause Chain & Design Decisions

### 2.1 The Three Failures Are One Problem

All three issues stem from **missing system contracts**:
1. **No logging contract** → can't observe failures → can't diagnose issues
2. **No navigation contract** → button fires navigation before confirming state → race condition
3. **No access control contract** → pages serve regardless of readiness → broken experience

### 2.2 Design Decisions

#### Decision 1: LLM Configuration Is NOT Mandatory

**Rationale:** The system already works without LLM — it produces structured summaries, captures events, runs materializer, and shows metrics. LLM enriches distills but isn't required for core value.

**Therefore:** The gate should NOT be "has LLM configured" but rather "has completed onboarding" (which may include choosing "none" for LLM). The current home.ts check for `configured: false` when provider is "none" is **wrong** — it creates an infinite redirect loop for users who intentionally skip LLM.

#### Decision 2: Setup Completion Must Be Server-Authoritative

**Rationale:** Client-side redirects are bypassable, race-prone, and invisible to logs. The server must be the authority on whether setup is complete, and enforce it consistently.

**Therefore:** Add a Hono middleware that checks `setup-status.json → setupCompleted === true` for all non-setup, non-API routes. Returns a redirect response server-side.

#### Decision 3: Every Endpoint Must Log Request + Outcome

**Rationale:** Two log lines for an entire config flow is unacceptable for debugging. Every user-facing endpoint should produce at minimum: (1) request received with key params, (2) outcome (success/error with reason).

**Therefore:** Add structured logging middleware and per-handler logs at decision points.

### 2.3 The Correct Setup Flow

```
User types: unfade
  → lightweight-init creates .unfade/ with setup-status.json { setupCompleted: false }
  → Server starts → auto-opens browser to /
  → Server middleware sees setupCompleted: false → 302 redirect to /setup
  → User on /setup:
      Step 1: ✓ Capture running (auto)
      Step 2: Connect AI tools (optional, one-click)
      Step 3: Configure LLM (optional — "none" is valid)
      Step 4: Click "Start Exploring"
  → Button fires POST /api/setup/complete (blocks navigation until response)
  → Server marks setupCompleted: true in setup-status.json
  → Client receives 200 → navigates to /
  → Server middleware sees setupCompleted: true → serves home page
  → Home page shows calibrating/live state (no more "configured" check)
```

### 2.4 What Changes

| Current | New |
|---|---|
| Home page client JS checks `/unfade/settings/status` and redirects | Server middleware checks `setupCompleted` and redirects |
| "Start Exploring" is `<a href="/">` with fire-and-forget htmx | Button is a proper form/fetch that awaits response before navigating |
| Provider "none" means "unconfigured" in home redirect | Provider "none" is a valid choice — no redirect |
| Zero logs for most operations | Structured request/outcome logging on all endpoints |
| No route guards | Global middleware redirects to /setup when incomplete |

---

## 3. Validate: Acceptance Criteria

| # | Criterion | Measurement |
|---|---|---|
| 1 | Every user action produces visible outcome | Click "Start Exploring" → browser navigates to home OR shows error. Never loops. |
| 2 | Logging covers all endpoints | Every POST/PUT handler emits ≥2 log lines (received + outcome). Grep test: `grep -c '"msg"' logs` matches request count. |
| 3 | Setup enforcement is server-side | Direct GET to `/intelligence` returns 302 to `/setup` when `setupCompleted !== true`. |
| 4 | Provider "none" is valid post-setup | User selects "none" → completes setup → lands on home → sees calibrating state (not redirect loop). |
| 5 | Race condition eliminated | "Start Exploring" awaits API response before navigation. Network failure shows error in UI. |
| 6 | Silent failures eliminated | Every catch block either logs or surfaces error to user. Zero empty catch blocks in route handlers. |
| 7 | Correlation IDs in logs | All logs from a single HTTP request share a `reqId` field. |
| 8 | Test completion logged | LLM validation result (success/failure/reason) is logged server-side. |

---

## 4. Execute: Implementation Plan

### 4.1 Fix: Request Logging Middleware

**File:** `src/server/http.ts`

Add Hono middleware that logs every request/response:

```typescript
app.use("*", async (c, next) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  c.set("reqId", reqId);
  const start = performance.now();
  await next();
  const ms = Math.round(performance.now() - start);
  logger.info({ reqId, method: c.req.method, path: c.req.path, status: c.res.status, ms }, "request");
});
```

This gives every request a correlation ID and timing. Individual handlers can access `c.get("reqId")` for contextual logs.

### 4.2 Fix: Setup Enforcement Middleware

**File:** `src/server/http.ts`

Add middleware AFTER static assets, BEFORE page routes:

```typescript
app.use("*", async (c, next) => {
  const path = c.req.path;
  // Allow: setup page, API endpoints, static assets, settings (needed by setup)
  if (path === "/setup" || path.startsWith("/api/") || path.startsWith("/unfade/") ||
      path.startsWith("/assets/") || path === "/favicon.ico") {
    return next();
  }
  // Check setup completion
  if (!isSetupComplete()) {
    return c.redirect("/setup", 302);
  }
  return next();
});
```

`isSetupComplete()` reads `setup-status.json` (cached in memory, invalidated on write):

```typescript
let _setupComplete: boolean | null = null;
export function isSetupComplete(): boolean {
  if (_setupComplete !== null) return _setupComplete;
  try {
    const status = JSON.parse(readFileSync(setupStatusPath, "utf-8"));
    _setupComplete = status.setupCompleted === true;
  } catch {
    _setupComplete = false;
  }
  return _setupComplete;
}
export function invalidateSetupCache(): void { _setupComplete = null; }
```

Call `invalidateSetupCache()` in `updateSetupStatus()`.

### 4.3 Fix: "Start Exploring" Button

**File:** `src/server/pages/setup.ts`

Replace the `<a>` tag with a proper button that awaits the API response:

```html
<button onclick="completeSetup()" id="btn-complete"
  class="bg-accent text-white px-8 py-3 rounded-lg font-semibold text-sm border-none cursor-pointer hover:bg-accent-dim transition-colors">
  Start Exploring →
</button>
```

JavaScript:
```javascript
function completeSetup() {
  var btn = document.getElementById('btn-complete');
  btn.disabled = true;
  btn.textContent = 'Setting up…';
  fetch('/api/setup/complete', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        window.location.href = '/';
      } else {
        btn.disabled = false;
        btn.textContent = 'Start Exploring →';
        alert('Setup failed: ' + (d.error || 'Unknown error'));
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Start Exploring →';
      alert('Network error — please try again.');
    });
}
```

This eliminates the race condition: navigation only happens after confirmed server response.

### 4.4 Fix: Home Page Remove Config Gate

**File:** `src/server/pages/home.ts`

Remove the settings/status check that redirects to /setup. The server middleware now handles this. Home page JS should go directly to summary check:

```javascript
// Old: fetch('/unfade/settings/status').then(check configured)...
// New: directly check summary (server already guarantees we passed setup)
fetch('/api/summary').then(function(r){return r.status===204?null:r.json();}).then(function(d){
  if(d) handleSummary(d); else setState('calibrating', null);
}).catch(function(){
  setState('calibrating', null);
});
```

### 4.5 Fix: Structured Logging in Handlers

**File:** `src/server/routes/settings.ts`

Add logging at decision points in POST /settings/llm:

```typescript
logger.info({ reqId: c.get("reqId"), provider, model }, "settings.llm: received");
// ... after validation ...
logger.info({ reqId: c.get("reqId"), provider, validated: result.success, reason: result.reason }, "settings.llm: connectivity test");
// ... after write ...
logger.info({ reqId: c.get("reqId"), provider }, "settings.llm: saved");
```

Add logging to POST /api/setup/complete:

```typescript
logger.info({ reqId: c.get("reqId") }, "setup.complete: marking done");
// ... after write ...
logger.info({ reqId: c.get("reqId") }, "setup.complete: success");
```

**File:** `src/server/routes/integrations.ts`

Add logging to install handler:

```typescript
logger.info({ reqId: c.get("reqId"), tool }, "integrations.install: received");
// ... after write ...
logger.info({ reqId: c.get("reqId"), tool, path: configPath, action }, "integrations.install: done");
```

### 4.6 Fix: Downgrade Expected Warnings

**File:** `src/server/routes/settings.ts`

Change "Could not read existing config" from `logger.warn` to `logger.debug`:

```typescript
} catch {
  logger.debug("No existing config.json — creating fresh");
}
```

This is an expected path on first setup, not a warning condition.

### 4.7 Fix: Log LLM Test Result

**File:** `src/server/routes/settings.ts`

After `testLlmCompletion()` returns, log the result:

```typescript
const testResult = await testLlmCompletion(provider, apiKey, model, apiBase);
logger.info({ provider, model, success: testResult.success, reason: testResult.reason || undefined }, "settings.llm: test completion result");
```

Same for Ollama:

```typescript
const result = await checkOllamaReady(apiBase || "http://localhost:11434", model || "llama3.2");
logger.info({ provider: "ollama", model, ready: result.ready, reason: result.reason || undefined }, "settings.llm: ollama check result");
```

### 4.8 Fix: Remove Silent Catch Blocks

Audit and fix all silent catches in route handlers:

| File | Location | Fix |
|---|---|---|
| `settings.ts` POST /api/setup/complete | `catch (err)` in updateSetupStatus | Already returns 500 JSON — add `logger.error` |
| `integrations.ts` POST install | outer catch | Already logs — verified |
| `setup.ts` readCurrentLlmConfig | catch returns defaults | Fine — non-critical read |
| `home.ts` client JS | `.catch(function(){})` | Add console.warn for debugging |

---

## 5. Implementation Tracker

| # | Fix | Files | Status | Notes |
|---|---|---|---|---|
| 1 | Request logging middleware (reqId + timing) | `src/server/http.ts` | TODO | All requests get correlation ID |
| 2 | Setup enforcement middleware | `src/server/http.ts` | TODO | Server-side 302 to /setup when incomplete |
| 3 | Fix "Start Exploring" button (await response) | `src/server/pages/setup.ts` | TODO | Replace anchor with proper fetch + navigate |
| 4 | Remove home page config gate | `src/server/pages/home.ts` | TODO | Server middleware handles gating now |
| 5 | Structured logging in POST /settings/llm | `src/server/routes/settings.ts` | TODO | reqId + decision points + test result |
| 6 | Structured logging in POST /api/setup/complete | `src/server/routes/settings.ts` | TODO | Log entry + exit |
| 7 | Structured logging in integrations install | `src/server/routes/integrations.ts` | TODO | Log tool + path + action |
| 8 | Downgrade "config not found" to debug | `src/server/routes/settings.ts` | TODO | Expected path, not a warning |
| 9 | Log LLM test completion result | `src/server/routes/settings.ts` | TODO | Success/failure/reason |
| 10 | Eliminate silent catches in routes | Multiple | TODO | Every catch logs or surfaces |

---

## 6. Design Principles

1. **Server-authoritative setup** — The server knows whether setup is done. Clients don't guess.
2. **Every action has an outcome** — Buttons either succeed or show an error. Never no-ops.
3. **Logs are for diagnosis, not decoration** — If you can't debug a failure from logs alone, the logging is insufficient.
4. **"None" is a valid choice** — Not configuring an LLM is legitimate; the system still provides value through structured summaries and metrics.
5. **Correlation over volume** — A `reqId` connecting 3 focused lines beats 20 disconnected lines.

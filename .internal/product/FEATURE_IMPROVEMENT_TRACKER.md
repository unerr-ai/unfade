# Feature Improvement Tracker

> Systematic application of the 6 UX enrichment techniques proven on the Decisions feature.
> Each feature is tracked through discovery → implementation → verification.
> Last updated: 2026-04-26

---

## Techniques Reference

| Code | Technique | What It Does |
|------|-----------|-------------|
| T1 | UUID → Human Name | Resolve internal IDs (projectId, eventId) to human-readable names via registry |
| T2 | Evidence Enrichment | Replace raw data with rich metadata: branch, files, conversation title, source/type labels |
| T3 | On-Demand Detail | List view shows summary only; click fetches full detail from a dedicated API endpoint |
| T4 | Remove Artificial Caps | Eliminate `.slice(0, N)` limits that hide data; replace with pagination or "show more" |
| T5 | Evidence Drawer | Click any item → slide-over panel showing full provenance chain with raw data |
| T6 | Cross-Entity Filtering | Add project and domain dropdown filters to every data-bearing page |

---

## Completed

### Decisions Page
- **Status:** Done
- **Techniques applied:** T1, T2, T3, T4, T5, T6
- **What changed:**
  - projectId UUID → projectName via registry lookup
  - Evidence events enriched with branch, files, conversationTitle, source/type labels
  - List API returns summary; `/api/decisions/:index` detail API fetches full evidence on click
  - Removed `.slice(0, 5)` cap from both write-time (distiller) and read-time (decision-detail)
  - EvidenceDrawer with rich EvidenceEventCard components
  - Project filter dropdown, domain filter, period filter
- **Files changed:** `decision-detail.ts`, `unfade-decisions.ts`, `distiller.ts`, `api.ts`, `DecisionsPage.tsx`, `mcp.ts`

---

## Priority 1 — High Impact (4+ techniques applicable)

### 1. Live — Event Feed
- **Status:** Not started
- **Techniques:** T1, T2, T5, T6
- **Current problems:**
  - Events show raw `ev.source` ("ai-session") and `ev.type` ("commit") — no human-friendly labels
  - No project name badge on events — cross-project view shows no project context
  - Evidence drawer on click exists but doesn't show enriched metadata (branch, files, conversation title)
  - Only source filter (git/AI/terminal) — no project filter dropdown
- **Planned changes:**
  - [ ] Add `sourceLabel()` and `typeLabel()` helpers (reuse from DecisionsPage)
  - [ ] Resolve `ev.content.project` UUID → project name from repos list
  - [ ] Add project filter dropdown alongside source filter
  - [ ] Enrich evidence drawer with branch, files, conversation title on event click
- **Files to modify:** `LivePage.tsx`, `EventList.tsx`
- **API changes needed:** None — repos list already fetched via `useHealth()`

---

### 2. Distill — Static Markdown with No Evidence Linking
- **Status:** Not started
- **Techniques:** T1, T3, T5, T6
- **Current problems:**
  - Rendered as static markdown — decisions/trade-offs/dead ends mentioned but not clickable
  - No link from distill's mentioned decisions to Decisions page or evidence drawer
  - No project context — doesn't show which project(s) the distill covers
  - No project filter for multi-project setups
- **Planned changes:**
  - [ ] Parse decision references from distill metadata and render as clickable chips
  - [ ] Click a decision chip → navigate to Decisions page with that decision selected, or open inline evidence drawer
  - [ ] Show project badge(s) on distill header using metadata
  - [ ] Add project filter dropdown when multiple projects exist
- **Files to modify:** `DistillPage.tsx`, potentially `api.ts` (new distill detail endpoint)
- **API changes needed:** Distill API may need to return structured decision references alongside markdown content

---

### 3. Intelligence — Patterns Tab
- **Status:** Not started
- **Techniques:** T3, T5, T6
- **Current problems:**
  - Shows "Pattern X has 42 uses" but no way to see which prompts/sessions match this pattern
  - Anti-patterns listed without evidence — tells you the bad habit but not where it happened
  - No project scoping — patterns are global only
- **Planned changes:**
  - [ ] Make each pattern card clickable → evidence drawer showing example sessions/prompts
  - [ ] Add anti-pattern evidence: which sessions exhibited the anti-pattern
  - [ ] Add project filter dropdown
- **Files to modify:** `PatternsTab.tsx`, `api.ts`
- **API changes needed:** New `/api/intelligence/prompt-patterns/:pattern` detail endpoint returning matched sessions

---

### 4. Intelligence — Comprehension Tab
- **Status:** Not started
- **Techniques:** T3, T5, T6
- **Current problems:**
  - Blind spots listed as names but no drill-through to the events showing low comprehension
  - Module scores shown without evidence — can't see which sessions drove the score
  - No project scoping
- **Planned changes:**
  - [ ] Make each module row clickable → evidence drawer showing AI sessions that contributed to its comprehension score
  - [ ] Make blind spot items clickable → evidence drawer with sessions where user relied on AI in that area
  - [ ] Add project filter dropdown
- **Files to modify:** `ComprehensionTab.tsx`, `api.ts`
- **API changes needed:** New `/api/intelligence/comprehension/:module` detail endpoint

---

### 5. Intelligence — Autonomy Tab
- **Status:** Not started
- **Techniques:** T3, T5, T6
- **Current problems:**
  - Rich diagnostic text ("Your steering is loose in auth") but no evidence trail
  - Domain dependency table shows metrics but no drill-through to backing sessions
  - No project filter
- **Planned changes:**
  - [ ] Make each domain row clickable → evidence drawer with sessions showing high acceptance / low modification in that domain
  - [ ] Link diagnostic messages to their source events
  - [ ] Add project filter dropdown
- **Files to modify:** `AutonomyTab.tsx`, `api.ts`
- **API changes needed:** New `/api/intelligence/autonomy/:domain` detail endpoint

---

### 6. Intelligence ��� Cost Tab
- **Status:** Not started
- **Techniques:** T3, T5, T6
- **Current problems:**
  - "Cost by Model" breakdown but can't see which sessions consumed the most tokens
  - "Waste Ratio" shown without evidence of which sessions were wasted (abandoned, looping)
  - No project filter — costs aggregated globally
- **Planned changes:**
  - [ ] Make model cost rows clickable → drawer showing most expensive sessions for that model
  - [ ] Make waste ratio clickable → drawer showing abandoned/looping sessions
  - [ ] Add project filter dropdown
- **Files to modify:** `CostTab.tsx`, `api.ts`
- **API changes needed:** New `/api/intelligence/costs/sessions` endpoint returning per-session cost breakdown

---

### 7. Intelligence — Narratives Tab
- **Status:** Not started
- **Techniques:** T3, T4, T5, T6
- **Current problems:**
  - `diagnostics.slice(0, 5)` — hard cap at 5 diagnostics shown
  - Narratives show claims but no evidence trail
  - No project scoping
- **Planned changes:**
  - [ ] Remove `.slice(0, 5)` cap; add "show more" or pagination
  - [ ] Make each narrative clickable → evidence drawer showing events/decisions that produced this narrative
  - [ ] Add project filter dropdown
- **Files to modify:** `NarrativesTab.tsx`, `api.ts`
- **API changes needed:** New `/api/intelligence/narratives/:index` detail endpoint returning source events

---

## Priority 2 — Medium Impact (2-3 techniques applicable)

### 8. Home — Insights Section
- **Status:** Not started
- **Techniques:** T3, T4, T5
- **Current problems:**
  - `insights.slice(0, 5)` — hard cap at 5 insights
  - InsightCard has no click-through — claims are not actionable
  - "Investigate" action links to `/intelligence` generically, not to the specific insight
- **Planned changes:**
  - [ ] Remove `.slice(0, 5)` cap; add "show all" toggle or link to dedicated insights page
  - [ ] Make each InsightCard clickable → evidence drawer or navigate to the specific intelligence tab
  - [ ] Replace generic "Investigate" href with insight-specific deep link
- **Files to modify:** `HomePage.tsx`, `InsightCard.tsx`
- **API changes needed:** Insights API may need to return `sourceAnalyzer` or `drillPath` for deep linking

---

### 9. Home — EventList (projectId display)
- **Status:** Not started
- **Techniques:** T1
- **Current problems:**
  - `ev.content.project` rendered as raw UUID — meaningless to users
- **Planned changes:**
  - [ ] Build project name map from repos data (already fetched on Home page)
  - [ ] Replace raw UUID badge with human-readable project name
- **Files to modify:** `EventList.tsx`
- **API changes needed:** None — repos data already available

---

### 10. Intelligence — Velocity Tab
- **Status:** Not started
- **Techniques:** T3, T6
- **Current problems:**
  - Shows decisions/day and domain velocity without drill-through to actual decisions
  - No project filter
- **Planned changes:**
  - [ ] Make velocity domain rows clickable → navigate to Decisions page filtered by that domain and time period
  - [ ] Add project filter dropdown
- **Files to modify:** `VelocityTab.tsx`
- **API changes needed:** None — uses existing Decisions page with query params

---

### 11. Profile — Patterns & Trade-offs
- **Status:** Not started
- **Techniques:** T3, T5
- **Current problems:**
  - Patterns show confidence bar but no drill-through to exemplifying decisions
  - Trade-off preferences show "supporting: N, contradicting: N" but can't see which decisions
  - Domain distribution shows frequency/depth without linking to decisions in that domain
- **Planned changes:**
  - [ ] Make each pattern row clickable → evidence drawer with example decisions
  - [ ] Make trade-off items clickable → drawer showing supporting vs contradicting decisions
  - [ ] Make domain rows clickable → navigate to Decisions filtered by domain
- **Files to modify:** `ProfilePage.tsx`, `api.ts`
- **API changes needed:** New `/api/profile/pattern/:name` or `/api/profile/tradeoff/:index` detail endpoints

---

### 12. Logs — No Project Context
- **Status:** Not started
- **Techniques:** T1, T6
- **Current problems:**
  - Log entries show component (daemon, materializer) but not which project
  - No project filter
- **Planned changes:**
  - [ ] Add project context to log entries where available (daemon logs carry project info)
  - [ ] Add project filter dropdown alongside component filter
- **Files to modify:** `LogsPage.tsx`, potentially log API route
- **API changes needed:** Log entries may need `projectId` field; API needs project filter param

---

## Progress Summary

| Feature | T1 | T2 | T3 | T4 | T5 | T6 | Status |
|---------|----|----|----|----|----|----|--------|
| Decisions | x | x | x | x | x | x | Done |
| Live — Events | x | x | . | . | x | x | Not started |
| Distill | x | . | x | . | x | x | Not started |
| Patterns | . | . | x | . | x | x | Not started |
| Comprehension | . | . | x | . | x | x | Not started |
| Autonomy | . | . | x | . | x | x | Not started |
| Cost | . | . | x | . | x | x | Not started |
| Narratives | . | . | x | x | x | x | Not started |
| Home — Insights | . | . | x | x | x | . | Not started |
| Home — EventList | x | . | . | . | . | . | Not started |
| Velocity | . | . | x | . | . | x | Not started |
| Profile | . | . | x | . | x | . | Not started |
| Logs | x | . | . | . | . | x | Not started |

**Legend:** `x` = applicable and planned, `.` = not applicable, Done/Not started = status

---

## Implementation Notes

### Reusable Patterns from Decisions
These were built for Decisions and can be reused across all features:

1. **`sourceLabel()` / `typeLabel()` / `sourceBadgeClass()`** — already in `DecisionsPage.tsx`, should be extracted to a shared util
2. **`EvidenceDrawer`** — generic component in `src/ui/components/shared/EvidenceDrawer.tsx`, accepts any `items[]` and `metrics[]`
3. **`EvidenceEventCard`** — currently in `DecisionsPage.tsx`, should be extracted to shared components
4. **`buildProjectNameMap()`** — registry lookup pattern from `unfade-decisions.ts`, reusable for any backend route
5. **`resolveProjectName()`** — from `decision-detail.ts`, reusable for any detail endpoint
6. **`enrichEvidenceEvent()`** — from `decision-detail.ts`, reusable for any event enrichment

### Recommended Extraction Before Starting
Before implementing Priority 1 features, extract shared utilities:
- [ ] Move `sourceLabel`, `typeLabel`, `sourceBadgeClass` to `src/ui/lib/event-labels.ts`
- [ ] Move `EvidenceEventCard` to `src/ui/components/shared/EvidenceEventCard.tsx`
- [ ] Move `relativeDate` to `src/ui/lib/date-utils.ts`
- [ ] Create `src/ui/hooks/useProjectNames.ts` — shared hook that builds projectId → name map from repos

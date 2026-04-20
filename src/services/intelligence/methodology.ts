// FILE: src/services/intelligence/methodology.ts
// UF-244: Methodology document generator for leadership export packs.
// Explains each metric, how it's computed, and what it means — finance-grade defensibility.

const METHODOLOGY_VERSION = "1.0";

export function generateMethodology(): string {
  return `# Unfade Intelligence Methodology

**Version:** ${METHODOLOGY_VERSION}
**Generated:** ${new Date().toISOString().slice(0, 10)}
**Source:** Local analysis of AI session transcripts, git events, and terminal activity

---

## About This Report

This report was generated **locally** by Unfade. All metrics are derived from behavioral signals in AI session transcripts (Claude Code, Cursor, Codex, Aider) and git/terminal activity. **No conversation text, raw prompts, or file contents are included.** Only numeric aggregates and classification labels cross the export boundary.

---

## Metric Definitions

### Direction Density (%)

**What it measures:** The percentage of AI interactions where the developer actively steered the model's output — rejecting suggestions, injecting domain knowledge, modifying generated code, or redirecting the conversation.

**How it's computed:** Each AI session event carries a \`human_direction_score\` (0.0–1.0) computed from behavioral signals: rejection count, modification-after-accept, prompt specificity, domain knowledge injection, alternative evaluation, and course correction. Direction density is the mean of these scores across a time window, expressed as a percentage.

**What high means:** The developer exercises engineering judgment — they direct AI tools rather than follow them.

**What low means:** The developer tends to accept AI output without modification. This is not inherently bad (the model may be generating correct code), but it correlates with lower comprehension of the shipped code.

### Comprehension Score (0–100)

**What it measures:** A proxy for how deeply the developer engaged with AI-generated output before shipping it.

**How it's computed:** Composite of three behavioral signals:
- **Modification depth** (40% weight): Did the developer edit AI output, course-correct, inject domain knowledge?
- **Prompt specificity** (30% weight): How specific were the developer's instructions to the model?
- **Rejection signal** (30% weight): How many AI suggestions were rejected?

**What high means:** The developer understands the code they shipped — they modified, questioned, and redirected AI output.

**What low means:** The developer accepted AI output with minimal engagement — potential comprehension debt.

### Reasoning Depth Index (RDI, 0–100)

**What it measures:** How deeply the developer reasons about decisions — alternatives explored, trade-offs articulated, dead ends recovered from, cross-domain thinking.

**How it's computed:** Weighted composite:
- Alternatives explored (30%): Average number of alternatives considered per decision
- Trade-offs articulated (25%): Ratio of decisions with explicit trade-off reasoning
- Dead end recovery (25%): Ratio of dead ends that led to recovery vs abandonment
- Domain crossing (20%): Decisions that span multiple engineering domains

### Cost-per-Directed-Decision

**What it measures:** How much AI tooling spend (estimated) is required per unit of engineering judgment exercised.

**How it's computed:** Daily estimated token spend (from model metadata × optional pricing table) divided by the count of AI interactions with \`human_direction_score ≥ 0.5\`.

**What improving trend means:** The team is exercising the same or better judgment while spending less per decision — AI ROI is increasing.

### Token Spend Proxy

**What it measures:** Estimated AI tooling cost per model, per day, per repository.

**How it's computed:** Count of AI-session events per model per day, multiplied by user-supplied pricing table entries (cost per 1K tokens). Without a pricing table, raw event counts are shown.

**Limitation:** This is a proxy, not an exact cost measurement. Actual token consumption varies by prompt length and response length, which are not always available in event metadata.

---

## Data Provenance

- All data originates from the developer's local machine
- AI session transcripts are parsed from: Claude Code (~/.claude/), Cursor (~/.cursor/), Codex (~/.codex/), Aider (.aider.chat.history.md)
- Git events are captured from the project's .git/ directory
- Terminal events are captured via shell hooks (opt-in)
- No data leaves the machine without explicit export consent

## Privacy Guarantees

- This export contains **numeric aggregates only** (by default)
- No raw prompts, conversation text, or file contents are included
- The \`redactionPolicy\` in the export configuration controls the level of detail:
  - \`aggregates-only\` (default): Only numeric metrics and domain labels
  - With contributor names: Opt-in, requires explicit configuration

---

_Methodology version ${METHODOLOGY_VERSION} — Unfade (https://unfade.io)_
`;
}

export function getMethodologyVersion(): string {
  return METHODOLOGY_VERSION;
}

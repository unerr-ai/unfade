// FILE: src/server/components/narrative-card.ts
// Sprint 15F: Diagnostic-first narrative components.
// vehicleHealthSummary(), identityNarrative(), knowledgeRetainedCard()
// Pure functions returning HTML strings — same pattern as metric-card.ts.

export interface VehicleHealthSummaryProps {
  phase: number;
  phaseLabel: string;
  phaseProgress: number;
  bottleneck: { dimension: string; score: number };
  topPrescription?: { action: string; estimatedImpact: string };
  activeDiagnosticCount: number;
  pendingPrescriptionCount: number;
}

const PHASE_COLORS = ["var(--muted)", "var(--warning)", "var(--cyan)", "var(--success)"];
const PHASE_LABELS = ["Discovering", "Responsive", "Precision", "Autonomous"];

export function vehicleHealthSummary(props: VehicleHealthSummaryProps): string {
  const {
    phase,
    phaseLabel,
    phaseProgress,
    bottleneck,
    topPrescription,
    activeDiagnosticCount,
    pendingPrescriptionCount,
  } = props;
  const idx = Math.max(0, Math.min(phase - 1, 3));
  const color = PHASE_COLORS[idx];
  const pct = Math.max(0, Math.min(phaseProgress, 100));

  const phases = PHASE_LABELS.map((label, i) => {
    const active = i === idx;
    const done = i < idx;
    const dotClass = done
      ? "bg-success"
      : active
        ? "bg-accent"
        : "bg-raised";
    return `<div class="flex flex-col items-center gap-1 flex-1">
      <div class="w-2.5 h-2.5 rounded-full ${dotClass}" style="${active ? `box-shadow:0 0 0 3px ${color}33` : ""}"></div>
      <span class="text-[10px] ${active ? "text-foreground font-semibold" : "text-muted"}">${label}</span>
    </div>`;
  }).join("");

  const prescriptionHtml = topPrescription
    ? `<div class="mt-3 pt-3 border-t border-border">
        <div class="text-[11px] uppercase tracking-wider text-muted mb-1">Top prescription</div>
        <div class="text-sm text-foreground">${esc(topPrescription.action)}</div>
        <div class="text-xs text-muted mt-0.5">Est. impact: ${esc(topPrescription.estimatedImpact)}</div>
      </div>`
    : "";

  return `<div id="vehicle-health" class="bg-surface border border-border rounded-lg p-5 mb-6">
    <div class="flex items-center justify-between mb-3">
      <div class="text-[11px] uppercase tracking-wider text-muted font-medium">System health</div>
      <div class="flex items-center gap-2">
        ${activeDiagnosticCount > 0 ? `<span class="text-xs text-warning">${activeDiagnosticCount} active</span>` : ""}
        ${pendingPrescriptionCount > 0 ? `<span class="text-xs text-accent">${pendingPrescriptionCount} prescriptions</span>` : ""}
      </div>
    </div>
    <div class="flex items-center gap-4 mb-4">
      <div class="font-mono text-2xl font-bold" style="color:${color}">Phase ${phase}</div>
      <div class="text-sm text-muted">${esc(phaseLabel)}</div>
    </div>
    <div class="flex items-end gap-1 mb-2">${phases}</div>
    <div class="h-1.5 rounded-full bg-raised overflow-hidden mb-4">
      <div class="h-full rounded-full" style="width:${pct}%;background:${color};transition:width 0.6s ease-out"></div>
    </div>
    <div class="flex items-center gap-2 text-xs">
      <span class="text-muted">Bottleneck:</span>
      <span class="font-semibold text-warning">${esc(bottleneck.dimension)}</span>
      <span class="font-mono text-muted">${bottleneck.score}/100</span>
    </div>
    ${prescriptionHtml}
  </div>`;
}

export interface IdentityNarrativeProps {
  avgAlternativesEvaluated: number;
  modificationRate: number;
  heldRate: number;
  totalDecisions: number;
  topDomain?: string;
}

export function identityNarrative(props: IdentityNarrativeProps): string {
  const { avgAlternativesEvaluated, modificationRate, heldRate, totalDecisions, topDomain } = props;

  const traits: string[] = [];
  if (avgAlternativesEvaluated >= 3) traits.push("architectural thinking");
  if (modificationRate >= 25) traits.push("active steering");
  if (heldRate >= 80) traits.push("high-durability decisions");

  let narrative: string;
  if (traits.length === 0) {
    narrative =
      "Your AI collaboration style is still emerging. As more decisions accumulate, patterns will surface that reveal your unique reasoning approach.";
  } else if (traits.length === 1) {
    narrative = `Your reasoning style is characterized by <strong class="text-foreground">${traits[0]}</strong>. ${traitDetail(traits[0])}`;
  } else {
    const last = traits.pop()!;
    narrative = `Your reasoning style combines <strong class="text-foreground">${traits.join("</strong>, <strong class=\"text-foreground\">")}</strong> and <strong class="text-foreground">${last}</strong>. This indicates a deliberate, high-agency approach to AI-assisted development.`;
  }

  const domainNote = topDomain
    ? ` Most of your decisions concentrate in <strong class="text-foreground">${esc(topDomain)}</strong>.`
    : "";

  const kpis = [
    { label: "Alternatives", value: avgAlternativesEvaluated.toFixed(1), note: avgAlternativesEvaluated >= 3 ? "architectural" : "low" },
    { label: "Modification", value: `${Math.round(modificationRate)}%`, note: modificationRate >= 25 ? "active" : "passive" },
    { label: "Held rate", value: `${Math.round(heldRate)}%`, note: heldRate >= 80 ? "durable" : "volatile" },
    { label: "Decisions", value: String(totalDecisions), note: "" },
  ];

  return `<div id="identity-narrative" class="bg-surface border border-border rounded-lg p-5 mb-6">
    <div class="text-[11px] uppercase tracking-wider text-muted font-medium mb-3">Identity narrative</div>
    <p class="text-sm text-muted leading-relaxed mb-4">${narrative}${domainNote}</p>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${kpis.map((k) => `<div class="bg-raised rounded-lg p-3 text-center">
        <div class="font-mono text-xl font-bold text-foreground">${k.value}</div>
        <div class="text-[11px] text-muted mt-1">${k.label}</div>
        ${k.note ? `<div class="text-[10px] text-accent mt-0.5">${k.note}</div>` : ""}
      </div>`).join("")}
    </div>
  </div>`;
}

function traitDetail(trait: string): string {
  switch (trait) {
    case "architectural thinking":
      return "You consistently evaluate multiple approaches before committing, a hallmark of senior engineering judgment.";
    case "active steering":
      return "You actively modify AI suggestions rather than accepting them verbatim, maintaining creative control.";
    case "high-durability decisions":
      return "Your decisions tend to stick — they survive subsequent development without revision.";
    default:
      return "";
  }
}

export interface KnowledgeRetainedCardProps {
  decisionsLodged: number;
  deadEndsExplored: number;
  comprehensionMovements: Array<{ domain: string; delta: number }>;
  tradeOffsDocumented: number;
}

export function knowledgeRetainedCard(props: KnowledgeRetainedCardProps): string {
  const { decisionsLodged, deadEndsExplored, comprehensionMovements, tradeOffsDocumented } = props;

  const movements = comprehensionMovements
    .filter((m) => m.delta !== 0)
    .slice(0, 4)
    .map((m) => {
      const arrow = m.delta > 0 ? "↑" : "↓";
      const color = m.delta > 0 ? "text-success" : "text-warning";
      return `<span class="${color}">${esc(m.domain)} ${arrow}${Math.abs(m.delta)}%</span>`;
    })
    .join(`<span class="text-muted mx-1">·</span>`);

  return `<div id="knowledge-retained" class="bg-surface border border-accent/20 rounded-lg p-5 mt-6">
    <div class="text-[11px] uppercase tracking-wider text-accent font-medium mb-3">Knowledge retained today</div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div class="flex items-center gap-2 text-sm">
        <span class="text-success">✓</span>
        <span class="text-foreground">${decisionsLodged} decisions lodged</span>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-success">✓</span>
        <span class="text-foreground">${deadEndsExplored} dead ends mapped</span>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-success">✓</span>
        <span class="text-foreground">${tradeOffsDocumented} trade-offs documented</span>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-success">✓</span>
        <span class="text-foreground">Context ready for tomorrow</span>
      </div>
    </div>
    ${movements ? `<div class="text-xs text-muted">Comprehension: ${movements}</div>` : ""}
    <div class="text-xs text-muted mt-2">Tomorrow's sessions will have access to today's ${decisionsLodged} decisions via MCP.</div>
  </div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

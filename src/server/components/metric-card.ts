// Phase 15 component: heroMetricCard, kpiCard, kpiStrip
// Pure functions returning HTML strings. No side effects.

export interface HeroMetricCardProps {
  value: string | number;
  label: string;
  sublabel?: string;
  trend?: { direction: "up" | "down" | "flat"; value: string };
  freshness?: { tier: "live" | "recent" | "stale" | "cold"; updatedAt: string };
  confidence?: "high" | "medium" | "low";
  unit?: string;
}

export function heroMetricCard(props: HeroMetricCardProps): string {
  const trendHtml = props.trend
    ? `<span class="text-xs ${props.trend.direction === "up" ? "text-success" : props.trend.direction === "down" ? "text-error" : "text-muted"}">${props.trend.direction === "up" ? "↑" : props.trend.direction === "down" ? "↓" : "→"} ${props.trend.value}</span>`
    : "";

  const freshnessHtml = props.freshness ? freshnessBadgeInline(props.freshness.updatedAt) : "";

  const confidenceHtml = props.confidence
    ? `<span class="text-xs px-1.5 py-0.5 rounded ${props.confidence === "high" ? "bg-success/20 text-success" : props.confidence === "medium" ? "bg-warning/20 text-warning" : "bg-error/20 text-error"}">${props.confidence}</span>`
    : "";

  return `<div class="bg-surface border border-border rounded-lg p-6 mb-6 flex items-center justify-between" style="min-height:140px">
    <div>
      <div class="text-xs text-muted uppercase tracking-wider mb-1">${props.label}</div>
      <div class="font-mono text-5xl font-bold text-cyan">${props.value}${props.unit ?? ""}</div>
      <div class="flex items-center gap-2 mt-2">
        ${props.sublabel ? `<span class="text-sm text-muted">${props.sublabel}</span>` : ""}
        ${trendHtml}
        ${confidenceHtml}
      </div>
    </div>
    <div class="text-right">
      ${freshnessHtml}
    </div>
  </div>`;
}

export interface KpiCardProps {
  value: string | number;
  label: string;
  delta?: string;
  icon?: string;
  href?: string;
  badge?: string;
}

export function kpiCard(props: KpiCardProps): string {
  const deltaHtml = props.delta
    ? `<div class="text-xs mt-1 ${props.delta.startsWith("+") || props.delta.startsWith("↑") ? "text-success" : props.delta.startsWith("-") || props.delta.startsWith("↓") ? "text-error" : "text-muted"}">${props.delta}</div>`
    : "";
  const badgeHtml = props.badge
    ? `<span class="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded" style="background:var(--proxy);color:var(--accent)">${props.badge}</span>`
    : "";
  const tag = props.href ? "a" : "div";
  const hrefAttr = props.href ? ` href="${props.href}"` : "";

  return `<${tag}${hrefAttr} class="bg-surface border border-border rounded-lg p-4 text-center ${props.href ? "hover:border-accent/40 transition-colors cursor-pointer no-underline" : ""}">
    ${props.icon ? `<div class="text-muted mb-1">${props.icon}</div>` : ""}
    <div class="font-mono text-3xl font-bold text-foreground">${props.value}</div>
    <div class="text-xs text-muted mt-1">${props.label}</div>
    ${deltaHtml}
    ${badgeHtml}
  </${tag}>`;
}

export function kpiStrip(cards: KpiCardProps[]): string {
  const cols = Math.min(cards.length, 4);
  return `<div class="grid grid-cols-2 md:grid-cols-${cols} gap-4 mb-6">
    ${cards.map(kpiCard).join("\n")}
  </div>`;
}

function freshnessBadgeInline(updatedAt: string): string {
  return `<div class="text-xs text-muted" data-freshness="${updatedAt}"></div>
  <script>(function(){var el=document.querySelector('[data-freshness="${updatedAt}"]');if(!el)return;var ago=Math.round((Date.now()-new Date('${updatedAt}').getTime())/1000);el.textContent='Updated '+(ago<60?ago+'s':Math.round(ago/60)+'m')+' ago';})()</script>`;
}

// FILE: src/server/components/autonomy-viz.ts
// Sprint 15F: Autonomy visualization components.
// independenceGauge(), skillTrajectoryChart(), dependencyHeatmap()
// Pure SSR SVG strings — same pattern as charts.ts.

export interface IndependenceGaugeProps {
  index: number;
  breakdown: {
    hds: number;
    modificationRate: number;
    alternativesEval: number;
    comprehensionTrend: number;
  };
  trend: "improving" | "stable" | "declining";
}

export function independenceGauge(props: IndependenceGaugeProps): string {
  const { index, breakdown, trend } = props;
  const size = 200;
  const r = (size - 16) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(Math.max(index / 100, 0), 1);
  const offset = circumference * (1 - pct * 0.75);
  const color = index >= 70 ? "var(--success)" : index >= 40 ? "var(--warning)" : "var(--error)";
  const trendArrow = trend === "improving" ? "↑" : trend === "declining" ? "↓" : "→";
  const trendColor =
    trend === "improving" ? "text-success" : trend === "declining" ? "text-warning" : "text-muted";

  const bars = [
    { label: "Direction", value: breakdown.hds, weight: "30%" },
    { label: "Modification", value: breakdown.modificationRate, weight: "25%" },
    { label: "Alternatives", value: breakdown.alternativesEval, weight: "20%" },
    { label: "Comprehension", value: breakdown.comprehensionTrend, weight: "25%" },
  ];

  const barHtml = bars
    .map(
      (b) => `<div class="flex items-center gap-2">
      <span class="text-xs text-muted w-24 truncate">${b.label}</span>
      <div class="flex-1 bg-raised rounded-full h-1.5 overflow-hidden">
        <div class="h-full rounded-full" style="width:${Math.max(0, Math.min(b.value, 100))}%;background:${b.value >= 70 ? "var(--success)" : b.value >= 40 ? "var(--warning)" : "var(--error)"}"></div>
      </div>
      <span class="font-mono text-xs text-muted w-8 text-right">${Math.round(b.value)}</span>
      <span class="text-[10px] text-muted w-6">${b.weight}</span>
    </div>`,
    )
    .join("");

  return `<div id="independence-index" class="flex flex-col items-center">
    <div style="position:relative;width:${size}px;height:${size}px" class="mb-4">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--overlay)" stroke-width="10"
          stroke-dasharray="${circumference * 0.75} ${circumference * 0.25}"
          transform="rotate(135 ${cx} ${cy})" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
          stroke-dasharray="${circumference * 0.75} ${circumference * 0.25}"
          stroke-dashoffset="${offset}"
          transform="rotate(135 ${cx} ${cy})" stroke-linecap="round"
          style="transition:stroke-dashoffset 0.8s ease-out"/>
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="var(--foreground)"
          font-family="JetBrains Mono,monospace" font-size="40" font-weight="700">${Math.round(index)}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="var(--muted)"
          font-family="Inter,sans-serif" font-size="12">Independence</text>
      </svg>
    </div>
    <div class="flex items-center gap-2 mb-4">
      <span class="${trendColor} text-sm font-medium">${trendArrow} ${trend}</span>
    </div>
    <div class="w-full max-w-sm space-y-2">${barHtml}</div>
  </div>`;
}

export interface SkillTrajectoryPoint {
  date: string;
  hds: number;
  modificationRate: number;
  comprehension: number;
}

export interface SkillTrajectoryChartProps {
  points: SkillTrajectoryPoint[];
  width?: number;
  height?: number;
}

export function skillTrajectoryChart(props: SkillTrajectoryChartProps): string {
  const { points, width = 600, height = 200 } = props;
  if (points.length < 2) {
    return `<div class="text-center py-8 text-muted text-sm">Need at least 2 data points for trajectory chart</div>`;
  }

  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const n = points.length;

  function line(vals: number[], color: string, label: string): string {
    const min = 0;
    const max = 100;
    const coords = vals.map((v, i) => {
      const x = pad.left + (i / (n - 1)) * w;
      const y = pad.top + h - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `<polyline points="${coords.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <title>${label}</title>
    </polyline>`;
  }

  const hdsLine = line(points.map((p) => p.hds), "var(--cyan)", "Direction (HDS)");
  const modLine = line(points.map((p) => p.modificationRate), "var(--accent)", "Modification Rate");
  const compLine = line(points.map((p) => p.comprehension), "var(--success)", "Comprehension");

  const yLabels = [0, 25, 50, 75, 100]
    .map((v) => {
      const y = pad.top + h - (v / 100) * h;
      return `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="10" font-family="JetBrains Mono,monospace">${v}</text>
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="var(--overlay)" stroke-width="0.5"/>`;
    })
    .join("");

  const xLabels = [0, Math.floor(n / 2), n - 1]
    .filter((i) => i < n)
    .map((i) => {
      const x = pad.left + (i / (n - 1)) * w;
      return `<text x="${x}" y="${height - 4}" text-anchor="middle" fill="var(--muted)" font-size="10" font-family="JetBrains Mono,monospace">${points[i].date.slice(5)}</text>`;
    })
    .join("");

  const legend = `<div class="flex items-center gap-4 mt-2 justify-center text-xs">
    <span class="flex items-center gap-1"><span class="w-3 h-0.5 rounded" style="background:var(--cyan)"></span> Direction</span>
    <span class="flex items-center gap-1"><span class="w-3 h-0.5 rounded" style="background:var(--accent)"></span> Modification</span>
    <span class="flex items-center gap-1"><span class="w-3 h-0.5 rounded" style="background:var(--success)"></span> Comprehension</span>
  </div>`;

  return `<div>
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="w-full" style="max-width:${width}px">
      ${yLabels}
      ${xLabels}
      ${hdsLine}
      ${modLine}
      ${compLine}
    </svg>
    ${legend}
  </div>`;
}

export interface DependencyHeatmapEntry {
  domain: string;
  acceptanceRate: number;
  comprehension: number;
}

export interface DependencyHeatmapProps {
  entries: DependencyHeatmapEntry[];
}

export function dependencyHeatmap(props: DependencyHeatmapProps): string {
  const { entries } = props;
  if (entries.length === 0) {
    return `<div class="text-center py-6 text-muted text-sm">No domain dependency data available</div>`;
  }

  const rows = entries
    .map((e) => {
      const risk = e.acceptanceRate > 80 && e.comprehension < 40;
      const accColor =
        e.acceptanceRate > 80
          ? "bg-error/30 text-error"
          : e.acceptanceRate > 60
            ? "bg-warning/20 text-warning"
            : "bg-success/20 text-success";
      const compColor =
        e.comprehension < 40
          ? "bg-error/30 text-error"
          : e.comprehension < 60
            ? "bg-warning/20 text-warning"
            : "bg-success/20 text-success";

      return `<tr class="${risk ? "bg-error/5" : ""}">
        <td class="py-2 pr-4 text-sm text-foreground font-medium">${esc(e.domain)}</td>
        <td class="py-2 px-2"><span class="inline-block px-2 py-0.5 rounded text-xs font-mono ${accColor}">${Math.round(e.acceptanceRate)}%</span></td>
        <td class="py-2 px-2"><span class="inline-block px-2 py-0.5 rounded text-xs font-mono ${compColor}">${Math.round(e.comprehension)}%</span></td>
        <td class="py-2 pl-2">${risk ? '<span class="text-xs text-error font-semibold">⚠ risk</span>' : '<span class="text-xs text-muted">ok</span>'}</td>
      </tr>`;
    })
    .join("");

  return `<div class="overflow-x-auto">
    <table class="w-full text-left">
      <thead>
        <tr class="text-[11px] uppercase tracking-wider text-muted border-b border-border">
          <th class="py-2 pr-4 font-medium">Domain</th>
          <th class="py-2 px-2 font-medium">Acceptance</th>
          <th class="py-2 px-2 font-medium">Comprehension</th>
          <th class="py-2 pl-2 font-medium">Risk</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border">${rows}</tbody>
    </table>
  </div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

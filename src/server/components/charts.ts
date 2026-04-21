// Phase 15 component: SVG charts (gauge, sparkline, bar chart, heatmap cell, trend arrow)
// Pure inline SVG — no external charting library.

export interface GaugeSvgProps {
  value: number;
  max: number;
  size: number;
  label: string;
  color?: string;
}

export function gaugeSvg(props: GaugeSvgProps): string {
  const { value, max, size, label, color } = props;
  const r = (size - 16) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(Math.max(value / max, 0), 1);
  const offset = circumference * (1 - pct * 0.75);
  const fg = color ?? "var(--accent)";

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="mx-auto">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--overlay)" stroke-width="8"
      stroke-dasharray="${circumference * 0.75} ${circumference * 0.25}"
      transform="rotate(135 ${cx} ${cy})" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${fg}" stroke-width="8"
      stroke-dasharray="${circumference * 0.75} ${circumference * 0.25}"
      stroke-dashoffset="${offset}"
      transform="rotate(135 ${cx} ${cy})" stroke-linecap="round"
      style="transition:stroke-dashoffset 0.8s ease-out"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="var(--foreground)"
      font-family="JetBrains Mono,monospace" font-size="${size / 5}" font-weight="700">${value}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="var(--muted)"
      font-family="Inter,sans-serif" font-size="${size / 16}">${label}</text>
  </svg>`;
}

export interface SparklineSvgProps {
  points: number[];
  width: number;
  height: number;
  color?: string;
}

export function sparklineSvg(props: SparklineSvgProps): string {
  const { points, width, height, color } = props;
  if (points.length < 2) return `<svg width="${width}" height="${height}"></svg>`;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 2;

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <polyline points="${coords.join(" ")}" fill="none" stroke="${color ?? "var(--accent)"}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export interface BarChartSvgProps {
  items: Array<{ label: string; value: number; color?: string }>;
  width: number;
  height: number;
}

export function barChartSvg(props: BarChartSvgProps): string {
  const { items, width, height } = props;
  if (items.length === 0) return `<svg width="${width}" height="${height}"></svg>`;

  const max = Math.max(...items.map((i) => i.value), 1);
  const barH = Math.min(24, (height - 8) / items.length - 4);
  const labelW = 100;

  const bars = items.map((item, idx) => {
    const y = 4 + idx * (barH + 4);
    const w = (item.value / max) * (width - labelW - 60);
    const color = item.color ?? "var(--accent)";
    return `<text x="0" y="${y + barH / 2 + 4}" fill="var(--muted)" font-size="11" font-family="Inter,sans-serif">${item.label}</text>
      <rect x="${labelW}" y="${y}" width="${Math.max(w, 2)}" height="${barH}" rx="3" fill="${color}" opacity="0.8"/>
      <text x="${labelW + w + 6}" y="${y + barH / 2 + 4}" fill="var(--foreground)" font-size="11" font-family="JetBrains Mono,monospace">${item.value}</text>`;
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars.join("")}</svg>`;
}

export function heatmapCell(module: string, score: number): string {
  const bg =
    score >= 60
      ? "bg-success/20 border-success/40"
      : score >= 35
        ? "bg-warning/20 border-warning/40"
        : "bg-error/20 border-error/40";
  return `<div class="rounded-lg border p-3 text-center cursor-pointer hover:opacity-80 ${bg}" style="min-height:80px">
    <div class="text-xs text-muted truncate">${module}</div>
    <div class="font-mono text-lg font-bold mt-1">${score}</div>
  </div>`;
}

export function trendArrow(direction: "up" | "down" | "flat", value: string): string {
  const icon = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  const color =
    direction === "up" ? "text-success" : direction === "down" ? "text-error" : "text-muted";
  return `<span class="inline-flex items-center gap-0.5 text-xs ${color}">${icon} ${value}</span>`;
}

import { cn } from "@/lib/utils";

interface RadarAxis {
  label: string;
  value: number;
  max?: number;
}

interface RadarChartProps {
  axes: RadarAxis[];
  size?: number;
  color?: string;
  className?: string;
}

export function RadarChart({
  axes,
  size = 280,
  color = "var(--color-accent)",
  className,
}: RadarChartProps) {
  if (axes.length < 3)
    return <div className="py-8 text-center text-sm text-muted">Need 3+ dimensions for radar</div>;

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - 60) / 2;
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;

  function polar(angle: number, radius: number): [number, number] {
    return [
      cx + radius * Math.cos(angle - Math.PI / 2),
      cy + radius * Math.sin(angle - Math.PI / 2),
    ];
  }

  const rings = [0.25, 0.5, 0.75, 1.0];
  const gridLines = rings.map((ring) => {
    const pts = Array.from({ length: n }, (_, i) => polar(i * angleStep, r * ring));
    return pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  });

  const spokes = Array.from({ length: n }, (_, i) => {
    const [x, y] = polar(i * angleStep, r);
    return { x1: cx, y1: cy, x2: x, y2: y };
  });

  const dataPoints = axes.map((axis, i) => {
    const pct = Math.min(axis.value / (axis.max ?? 100), 1);
    return polar(i * angleStep, r * pct);
  });
  const dataPath = dataPoints.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  const labels = axes.map((axis, i) => {
    const labelR = r + 20;
    const [x, y] = polar(i * angleStep, labelR);
    return { x, y, text: axis.label, value: Math.round(axis.value) };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("mx-auto", className)}
    >
      {gridLines.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="var(--color-overlay)" strokeWidth={0.5} />
      ))}
      {spokes.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="var(--color-overlay)"
          strokeWidth={0.5}
        />
      ))}
      <polygon points={dataPath} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={color} />
      ))}
      {labels.map((l, i) => (
        <g key={i}>
          <text
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fill="var(--color-muted)"
            fontSize={10}
            fontFamily="var(--font-body)"
          >
            {l.text}
          </text>
          <text
            x={l.x}
            y={l.y + 12}
            textAnchor="middle"
            fill="var(--color-foreground)"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fontWeight={600}
          >
            {l.value}
          </text>
        </g>
      ))}
    </svg>
  );
}

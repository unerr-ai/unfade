import { cn } from "@/lib/utils";

interface DataPoint {
  label: string;
  value: number;
}

interface AreaChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  className?: string;
}

export function AreaChart({
  data,
  height = 200,
  color = "var(--color-accent)",
  className,
}: AreaChartProps) {
  if (data.length < 2) {
    return (
      <div
        className={cn("flex items-center justify-center text-sm text-muted", className)}
        style={{ height }}
      >
        Not enough data for chart
      </div>
    );
  }

  const width = 600;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);

  const points = data.map((d, i) => {
    const x = pad.left + (i / (data.length - 1)) * w;
    const y = pad.top + h - (d.value / max) * h;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${pad.top + h} L${points[0].x.toFixed(1)},${pad.top + h} Z`;

  const yLabels = [0, Math.round(max / 2), max].map((v) => {
    const y = pad.top + h - (v / max) * h;
    return { v, y };
  });

  const xLabels = [0, Math.floor(data.length / 2), data.length - 1].filter((i) => i < data.length);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("w-full", className)}
      style={{ maxWidth: width }}
    >
      {yLabels.map(({ v, y }) => (
        <g key={v}>
          <line
            x1={pad.left}
            y1={y}
            x2={width - pad.right}
            y2={y}
            stroke="var(--color-overlay)"
            strokeWidth={0.5}
          />
          <text
            x={pad.left - 6}
            y={y + 4}
            textAnchor="end"
            fill="var(--color-muted)"
            fontSize={10}
            fontFamily="var(--font-mono)"
          >
            {v}
          </text>
        </g>
      ))}
      {xLabels.map((i) => {
        const x = pad.left + (i / (data.length - 1)) * w;
        return (
          <text
            key={i}
            x={x}
            y={height - 4}
            textAnchor="middle"
            fill="var(--color-muted)"
            fontSize={10}
            fontFamily="var(--font-mono)"
          >
            {data[i].label}
          </text>
        );
      })}
      <path d={areaPath} fill={color} opacity={0.1} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

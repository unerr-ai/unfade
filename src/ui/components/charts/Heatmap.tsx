import { cn } from "@/lib/utils";

interface HeatmapCell {
  row: string;
  col: string;
  value: number;
}

interface HeatmapProps {
  cells: HeatmapCell[];
  maxValue?: number;
  color?: string;
  onCellClick?: (row: string, col: string) => void;
  className?: string;
}

function valueToOpacity(value: number, max: number): number {
  return Math.min(Math.max(value / max, 0.05), 1);
}

export function Heatmap({
  cells,
  maxValue,
  color = "var(--color-accent)",
  onCellClick,
  className,
}: HeatmapProps) {
  if (cells.length === 0)
    return <div className="py-6 text-center text-sm text-muted">No heatmap data</div>;

  const rows = [...new Set(cells.map((c) => c.row))];
  const cols = [...new Set(cells.map((c) => c.col))];
  const max = maxValue ?? Math.max(...cells.map((c) => c.value), 1);
  const cellMap = new Map(cells.map((c) => [`${c.row}:${c.col}`, c.value]));

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="p-1 text-left text-muted font-medium" />
            {cols.map((col) => (
              <th
                key={col}
                className="p-1 text-center text-muted font-medium truncate max-w-[60px]"
                title={col}
              >
                {col.length > 6 ? `${col.slice(0, 5)}…` : col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td className="p-1 text-muted font-medium truncate max-w-[100px]" title={row}>
                {row}
              </td>
              {cols.map((col) => {
                const v = cellMap.get(`${row}:${col}`) ?? 0;
                return (
                  <td key={col} className="p-0.5">
                    <button
                      type="button"
                      className="block h-6 w-full rounded-sm transition-opacity hover:ring-1 hover:ring-foreground/20"
                      style={{ background: color, opacity: valueToOpacity(v, max) }}
                      onClick={() => onCellClick?.(row, col)}
                      title={`${row} × ${col}: ${v}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

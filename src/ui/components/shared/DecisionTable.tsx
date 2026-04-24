import { useState } from "react";
import type { Decision } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DecisionTableProps {
  decisions: Decision[];
  onRowClick?: (decision: Decision, index: number) => void;
  className?: string;
}

type SortKey = "date" | "decision" | "domain";
type SortDir = "asc" | "desc";

export function DecisionTable({ decisions, onRowClick, className }: DecisionTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = [...decisions].sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortKey === "date") return mul * a.date.localeCompare(b.date);
    if (sortKey === "domain") return mul * (a.domain ?? "").localeCompare(b.domain ?? "");
    return mul * a.decision.localeCompare(b.decision);
  });

  if (decisions.length === 0) {
    return <div className="py-8 text-center text-sm text-muted">No decisions found</div>;
  }

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="cursor-pointer select-none py-2 pr-4 text-left text-[11px] font-medium uppercase tracking-wider text-muted hover:text-foreground"
      onClick={() => toggleSort(field)}
    >
      {label} {sortKey === field && (sortDir === "asc" ? "↑" : "↓")}
    </th>
  );

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <SortHeader label="Date" field="date" />
            <SortHeader label="Decision" field="decision" />
            <SortHeader label="Domain" field="domain" />
            <th className="py-2 pr-4 text-left text-[11px] font-medium uppercase tracking-wider text-muted">
              Rationale
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((d, i) => (
            <tr
              key={`${d.date}-${i}`}
              className={cn("transition-colors", onRowClick && "cursor-pointer hover:bg-raised")}
              onClick={() => onRowClick?.(d, i)}
            >
              <td className="py-3 pr-4 font-mono text-xs text-muted whitespace-nowrap">{d.date}</td>
              <td className="py-3 pr-4 text-foreground">{d.decision}</td>
              <td className="py-3 pr-4">
                {d.domain && (
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                    {d.domain}
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-xs text-muted max-w-[200px] truncate">{d.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

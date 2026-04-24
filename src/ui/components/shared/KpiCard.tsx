import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SparkLine } from "@/components/charts/SparkLine";
import { cn } from "@/lib/utils";
import { ComparisonBadge } from "./ComparisonBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { FreshnessBadge } from "./FreshnessBadge";

interface KpiCardProps {
  label: string;
  value: string | number;
  interpretation?: string;
  comparison?: {
    delta: number;
    label: string;
    direction: "up" | "down" | "flat";
    goodDirection?: "up" | "down";
  } | null;
  freshness?: { updatedAt: string; isLive?: boolean };
  confidence?: { level: "high" | "medium" | "low" | "insufficient"; basis?: string };
  sparkData?: number[];
  badge?: string;
  href?: string;
  className?: string;
  children?: ReactNode;
}

export function KpiCard({
  label,
  value,
  interpretation,
  comparison,
  freshness,
  confidence,
  sparkData,
  badge,
  href,
  className,
}: KpiCardProps) {
  const content = (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-4 transition-colors",
        href && "hover:bg-raised cursor-pointer",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
        {sparkData && sparkData.length > 1 && <SparkLine data={sparkData} />}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold text-foreground">
        {badge ? (
          <span className="inline-flex items-center gap-1">
            {value}
            <span
              className="text-xs font-normal text-warning"
              style={{
                border: "1px dashed var(--color-warning)",
                borderRadius: 4,
                padding: "1px 4px",
              }}
            >
              ≈
            </span>
          </span>
        ) : (
          value
        )}
      </div>
      {interpretation && <div className="mt-1 text-xs text-muted">{interpretation}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {comparison && <ComparisonBadge {...comparison} />}
        {confidence && <ConfidenceBadge {...confidence} />}
        {freshness && <FreshnessBadge {...freshness} />}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link to={href} className="no-underline">
        {content}
      </Link>
    );
  }
  return content;
}

interface KpiStripProps {
  metrics: Array<Omit<KpiCardProps, "className">>;
  className?: string;
}

export function KpiStrip({ metrics, className }: KpiStripProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5", className)}>
      {metrics.map((m) => (
        <KpiCard key={m.label} {...m} />
      ))}
    </div>
  );
}

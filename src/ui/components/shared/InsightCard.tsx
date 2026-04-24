import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "./ConfidenceBadge";

interface InsightCardProps {
  text: string;
  confidence?: number;
  severity?: "info" | "warning" | "critical";
  action?: { label: string; href: string };
  className?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-l-error bg-error/5",
  warning: "border-l-warning bg-warning/5",
  info: "border-l-accent bg-accent/5",
};

export function InsightCard({
  text,
  confidence,
  severity = "info",
  action,
  className,
}: InsightCardProps) {
  const confLevel =
    confidence != null
      ? confidence >= 0.8
        ? "high"
        : confidence >= 0.5
          ? "medium"
          : "low"
      : undefined;

  return (
    <div
      className={cn(
        "rounded-lg border border-border border-l-4 p-4",
        SEVERITY_STYLES[severity],
        className,
      )}
    >
      <p className="text-sm text-foreground">{text}</p>
      <div className="mt-2 flex items-center gap-3">
        {confLevel && <ConfidenceBadge level={confLevel} />}
        {action && (
          <Link
            to={action.href}
            className="text-xs font-medium text-accent hover:text-accent-dim no-underline"
          >
            {action.label} →
          </Link>
        )}
      </div>
    </div>
  );
}

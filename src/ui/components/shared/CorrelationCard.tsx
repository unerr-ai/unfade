import { AlertTriangle, Info, ShieldAlert, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CorrelationData {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  explanation: string;
  analyzers: string[];
  domain?: string;
  evidenceEventIds: string[];
  actionable: string;
  detectedAt: string;
}

interface CorrelationCardProps {
  correlation: CorrelationData;
  onEvidenceClick?: (eventIds: string[]) => void;
  className?: string;
}

const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    border: "border-accent/30",
    bg: "bg-accent/5",
    badge: "bg-accent/20 text-accent",
    label: "Insight",
  },
  warning: {
    icon: AlertTriangle,
    border: "border-warning/30",
    bg: "bg-warning/5",
    badge: "bg-warning/20 text-warning",
    label: "Warning",
  },
  critical: {
    icon: ShieldAlert,
    border: "border-error/30",
    bg: "bg-error/5",
    badge: "bg-error/20 text-error",
    label: "Critical",
  },
} as const;

const ANALYZER_LABELS: Record<string, string> = {
  efficiency: "Efficiency",
  "comprehension-radar": "Comprehension",
  "cost-attribution": "Cost",
  "loop-detector": "Loops",
  "velocity-tracker": "Velocity",
  "prompt-patterns": "Patterns",
  "blind-spot-detector": "Blind Spots",
  "decision-replay": "Decisions",
};

export function CorrelationCard({
  correlation,
  onEvidenceClick,
  className,
}: CorrelationCardProps) {
  const config = SEVERITY_CONFIG[correlation.severity];
  const SeverityIcon = config.icon;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3",
        config.border,
        config.bg,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <SeverityIcon className={cn("h-4 w-4 mt-0.5 shrink-0", config.badge.split(" ")[1])} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", config.badge)}>
              {config.label}
            </span>

            {correlation.analyzers.map((a) => (
              <span
                key={a}
                className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted"
              >
                {ANALYZER_LABELS[a] ?? a}
              </span>
            ))}

            {correlation.domain && (
              <span className="text-[10px] text-muted">
                in <span className="font-mono">{correlation.domain}</span>
              </span>
            )}
          </div>

          <h4 className="mt-1.5 text-sm font-medium text-foreground leading-snug">
            {correlation.title}
          </h4>

          <p className="mt-1 text-xs text-foreground/70 leading-relaxed">
            {correlation.explanation}
          </p>

          <div className="mt-2 rounded bg-raised/60 px-2.5 py-1.5">
            <p className="text-xs text-accent">
              <span className="font-medium">Action: </span>
              {correlation.actionable}
            </p>
          </div>
        </div>
      </div>

      {correlation.evidenceEventIds.length > 0 && onEvidenceClick && (
        <button
          type="button"
          onClick={() => onEvidenceClick(correlation.evidenceEventIds)}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          View {correlation.evidenceEventIds.length} source events
        </button>
      )}
    </div>
  );
}

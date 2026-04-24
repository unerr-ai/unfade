import { useInView } from "react-intersection-observer";
import { cn } from "@/lib/utils";

interface IntelligenceCardProps {
  id: string;
  title: string;
  icon: string;
  useData: (options?: { enabled?: boolean }) => { data: unknown; isLoading: boolean };
  extract: (data: unknown) => { value: string | number; interpretation: string };
  isExpanded: boolean;
  onToggle: () => void;
  span?: "1" | "2";
}

export function IntelligenceCard({
  title,
  icon,
  useData,
  extract,
  isExpanded,
  onToggle,
  span = "1",
}: IntelligenceCardProps) {
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: "100px" });
  const { data, isLoading } = useData({ enabled: inView });

  const display = data ? extract(data) : null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      className={cn(
        "group w-full cursor-pointer rounded-lg border border-border bg-surface p-4 text-left transition-all hover:border-accent/40 hover:bg-raised",
        isExpanded && "border-accent/60 bg-raised ring-1 ring-accent/20",
        span === "2" && "col-span-2",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
            {title}
          </span>
        </div>
        <span
          className={cn("text-[10px] text-accent transition-transform", isExpanded && "rotate-90")}
        >
          ▸
        </span>
      </div>

      {isLoading || !display ? (
        <div className="mt-3 space-y-2">
          <div className="h-7 w-20 animate-pulse rounded bg-raised" />
          <div className="h-3 w-32 animate-pulse rounded bg-raised" />
        </div>
      ) : (
        <>
          <div className="mt-2 font-mono text-2xl font-bold text-foreground">{display.value}</div>
          <div className="mt-1 text-xs text-muted">{display.interpretation}</div>
        </>
      )}
    </button>
  );
}

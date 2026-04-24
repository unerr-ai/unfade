import { useSummary } from "@/hooks/useSummary";

export function SynthesisBanner() {
  const { data, isLoading } = useSummary();

  if (isLoading || !data || data.firstRunComplete) return null;

  const eventCount = data.eventCount24h ?? 0;
  const target = 5;
  const pct = Math.min(Math.round((eventCount / target) * 100), 100);

  return (
    <div className="border-b border-accent/20 bg-accent/5 px-4 py-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium text-accent">Calibrating…</span>
        <div className="h-1.5 flex-1 rounded-full bg-raised overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-muted">
          {eventCount}/{target} events
        </span>
      </div>
    </div>
  );
}

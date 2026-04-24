import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface FreshnessBadgeProps {
  updatedAt: string;
  isLive?: boolean;
  lagMs?: number;
}

type Tier = "live" | "recent" | "stale" | "cold";

function computeTier(ms: number, isLive?: boolean): Tier {
  if (isLive && ms < 30_000) return "live";
  if (ms < 30_000) return "live";
  if (ms < 300_000) return "recent";
  if (ms < 1_800_000) return "stale";
  return "cold";
}

const TIER_STYLES: Record<Tier, { dot: string; text: string }> = {
  live: { dot: "bg-success", text: "text-success" },
  recent: { dot: "bg-success", text: "text-success" },
  stale: { dot: "bg-warning", text: "text-warning" },
  cold: { dot: "bg-muted", text: "text-muted" },
};

export function FreshnessBadge({ updatedAt, isLive, lagMs }: FreshnessBadgeProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = now - new Date(updatedAt).getTime();
  const tier = computeTier(ms, isLive);
  const styles = TIER_STYLES[tier];
  const ago = ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", styles.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", styles.dot)} />
      {tier} · {ago} ago
      {lagMs != null && lagMs > 5000 && (
        <span className="text-warning"> · lag {Math.round(lagMs / 1000)}s</span>
      )}
    </span>
  );
}

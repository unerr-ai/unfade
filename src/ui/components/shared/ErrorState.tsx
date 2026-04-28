import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { WarmingUpError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  error: Error | null;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

export function ErrorState({ error, onRetry, className, compact }: ErrorStateProps) {
  if (!error) return null;

  const isWarmingUp = error instanceof WarmingUpError;
  const isNetwork =
    error.message.includes("Failed to fetch") || error.message.includes("NetworkError");

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
          isWarmingUp
            ? "border-accent/20 bg-accent/5 text-accent"
            : "border-warning/20 bg-warning/5 text-warning",
          className,
        )}
      >
        {isNetwork ? <WifiOff size={14} /> : <AlertTriangle size={14} />}
        <span className="flex-1">
          {isWarmingUp ? "Data warming up..." : isNetwork ? "Network error" : "Failed to load"}
        </span>
        {onRetry && !isWarmingUp && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-warning/10 transition-colors"
          >
            <RefreshCw size={10} /> Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center py-12 text-center", className)}>
      {isNetwork ? (
        <WifiOff size={40} className="mb-3 text-warning opacity-50" />
      ) : (
        <AlertTriangle size={40} className="mb-3 text-warning opacity-50" />
      )}
      <h3 className="mb-1 text-base font-semibold text-foreground">
        {isWarmingUp ? "Warming up" : isNetwork ? "Connection lost" : "Failed to load data"}
      </h3>
      <p className="mb-4 max-w-sm text-sm text-muted">
        {isWarmingUp
          ? "The intelligence engine is still processing. This should resolve in a few seconds."
          : isNetwork
            ? "Could not reach the server. Check if the unfade process is running."
            : error.message}
      </p>
      {onRetry && !isWarmingUp && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dim"
        >
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

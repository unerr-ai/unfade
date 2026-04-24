import { useMutation } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TerminalLog } from "@/components/shared/TerminalLog";
import { api } from "@/lib/api";

interface StepLaunchProps {
  onBack?: () => void;
}

export function StepLaunch({ onBack }: StepLaunchProps) {
  const navigate = useNavigate();
  const [launched, setLaunched] = useState(false);
  const [progress, setProgress] = useState(0);
  const [complete, setComplete] = useState(false);

  const launch = useMutation({
    mutationFn: () => api.setup.complete(),
    onSuccess: () => setLaunched(true),
  });

  const handleComplete = () => {
    setComplete(true);
    setTimeout(() => navigate("/"), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-heading font-semibold">Launch your capture engines</h2>
        <p className="text-sm text-muted">
          Start the daemon, materializer, and intelligence engine.
        </p>
      </div>

      {!launched ? (
        <div className="flex gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground hover:bg-raised transition-colors"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => launch.mutate()}
            disabled={launch.isPending}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
          >
            <Rocket size={18} /> Launch
          </button>
        </div>
      ) : (
        <>
          <TerminalLog
            sseUrl="/api/setup/launch-stream"
            onProgress={setProgress}
            onComplete={handleComplete}
            className="min-h-[240px]"
          />

          {progress >= 5 && !complete && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
              <p className="mb-2 text-sm text-foreground">
                Engine warming up — early readings available
              </p>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
              >
                View Dashboard
              </button>
            </div>
          )}

          {complete && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success">
              All systems running — engine at operating temperature. Redirecting to dashboard…
            </div>
          )}

          {progress > 0 && (
            <div className="h-2 rounded-full bg-raised overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

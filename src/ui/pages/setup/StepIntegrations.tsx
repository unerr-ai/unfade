import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plug } from "lucide-react";
import { api } from "@/lib/api";

interface StepIntegrationsProps {
  onComplete: () => void;
  onBack?: () => void;
}

export function StepIntegrations({ onComplete, onBack }: StepIntegrationsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["setup", "detect-agents"],
    queryFn: api.setup.detectAgents,
  });

  const installSkills = useMutation({
    mutationFn: (agents: string[]) => api.setup.installSkills(agents),
    onSuccess: () => onComplete(),
  });

  const agents = data?.agents ?? [];
  const installed = agents.filter((a) => a.installed);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-heading font-semibold">Connect your tools</h2>
        <p className="text-sm text-muted">
          Unfade works with your existing AI coding tools via MCP.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Detecting installed agents…
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className={`flex items-center gap-3 rounded-lg border p-3 ${agent.installed ? "border-success/30 bg-success/5" : "border-border bg-surface"}`}
            >
              <Plug size={16} className={agent.installed ? "text-success" : "text-muted"} />
              <span className="flex-1 text-sm font-medium text-foreground">{agent.name}</span>
              {agent.installed ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check size={12} /> Detected
                </span>
              ) : (
                <span className="text-xs text-muted">Not found</span>
              )}
            </div>
          ))}
          {agents.length === 0 && (
            <p className="text-sm text-muted">
              No AI agents detected. You can configure integrations later in Settings.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-raised p-3 text-sm text-muted">
        {installed.length > 0
          ? `${installed.length} agent${installed.length > 1 ? "s" : ""} detected and ready`
          : "No agents found — you can add integrations later"}
      </div>

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
          onClick={() => {
            if (installed.length > 0) {
              installSkills.mutate(installed.map((a) => a.name));
            } else {
              onComplete();
            }
          }}
          disabled={installSkills.isPending}
          className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
        >
          {installSkills.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Installing skills…
            </span>
          ) : (
            "Continue"
          )}
        </button>
      </div>
    </div>
  );
}

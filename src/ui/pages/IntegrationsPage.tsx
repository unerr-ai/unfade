import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug } from "lucide-react";
import { api } from "@/lib/api";

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["integrations", "status"],
    queryFn: api.integrations.status,
    staleTime: 30_000,
  });

  const install = useMutation({
    mutationFn: (tool: string) => api.integrations.install(tool),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });

  const tools = data?.tools ?? [];

  return (
    <div>
      <h1 className="mb-6 font-heading text-2xl font-semibold">Integrations</h1>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Loading integrations…
        </div>
      ) : tools.length > 0 ? (
        <div className="space-y-3">
          {tools.map((integ) => (
            <div
              key={integ.tool}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <Plug size={18} className={integ.connected ? "text-success" : "text-muted"} />
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">{integ.label}</div>
                <div className="text-xs text-muted">{integ.path}</div>
              </div>
              {integ.connected ? (
                <span className="text-xs text-success">Connected</span>
              ) : (
                <button
                  type="button"
                  onClick={() => install.mutate(integ.tool)}
                  disabled={install.isPending}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dim disabled:opacity-50"
                >
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
          <Plug size={32} className="mx-auto mb-2 text-muted opacity-40" />
          <p>No integrations available yet.</p>
          <p className="mt-1">MCP integrations will appear here when configured.</p>
        </div>
      )}
    </div>
  );
}

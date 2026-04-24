import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { theme, setTheme, persona, setPersona } = useAppStore();

  const { data: status, isLoading } = useQuery({
    queryKey: ["settings", "status"],
    queryFn: api.settings.status,
    staleTime: 30_000,
  });

  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const saveLlm = useMutation({
    mutationFn: () => api.settings.saveLlm({ provider, model, apiKey: apiKey || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const daemons = status?.daemons ?? [];

  return (
    <div>
      <h1 className="mb-6 font-heading text-2xl font-semibold">Settings</h1>

      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-heading font-semibold">LLM Configuration</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-muted">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded border border-border bg-raised px-3 py-2 text-sm text-foreground"
              >
                <option value="">Select…</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Model</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded border border-border bg-raised px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full rounded border border-border bg-raised px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => saveLlm.mutate()}
            disabled={saveLlm.isPending || !provider}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-50"
          >
            {saveLlm.isPending ? <Loader2 size={14} className="animate-spin" /> : "Save & Verify"}
          </button>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-heading font-semibold">Display Preferences</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Theme</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as "dark" | "light")}
                className="w-full rounded border border-border bg-raised px-3 py-2 text-sm text-foreground"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Persona</label>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value as "developer" | "lead" | "executive")}
                className="w-full rounded border border-border bg-raised px-3 py-2 text-sm text-foreground"
              >
                <option value="developer">Developer</option>
                <option value="lead">Tech Lead</option>
                <option value="executive">Executive</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-heading font-semibold">Daemon Control</h2>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : daemons.length > 0 ? (
            <div className="space-y-2">
              {daemons.map((d) => (
                <div key={d.id} className="flex items-center gap-4 rounded-md bg-raised p-3">
                  <span
                    className={`h-2 w-2 rounded-full ${d.running ? "bg-success" : "bg-warning"}`}
                  />
                  <span className="text-sm font-medium text-foreground">{d.id}</span>
                  <span className="text-xs text-muted">PID {d.pid}</span>
                  <span className="text-xs text-muted">{d.events} events</span>
                  <span className="ml-auto text-xs text-muted">
                    uptime {Math.round(d.uptime / 60)}m
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No active daemons</p>
          )}
        </section>
      </div>
    </div>
  );
}

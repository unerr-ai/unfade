import { useMutation } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

interface StepIntelligenceProps {
  onComplete: () => void;
}

const ALL_PROVIDERS = ["ollama", "openai", "anthropic", "custom"] as const;
const PROVIDERS = ALL_PROVIDERS.filter((p) => p !== "ollama");

export function StepIntelligence({ onComplete }: StepIntelligenceProps) {
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [verified, setVerified] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () =>
      api.setup.verifyLlm({
        provider,
        model,
        apiKey: apiKey || undefined,
        apiBase: apiBase || undefined,
      }),
    onSuccess: (data) => {
      if (data?.success) {
        setVerified(true);
        setFieldError(null);
        setTimeout(onComplete, 1500);
      } else {
        setFieldError(data?.error ?? data?.message ?? "Verification failed");
      }
    },
    onError: (err) => setFieldError(err instanceof Error ? err.message : "Verification failed"),
  });

  const showBase = provider === "ollama" || provider === "custom";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-heading font-semibold">
          Configure your intelligence engine
        </h2>
        <p className="text-sm text-muted">
          Select your LLM provider for distill synthesis and reasoning analysis.
        </p>
        <p className="mt-2 text-xs text-muted/70">
          Requires a model with at least{" "}
          <span className="font-semibold text-foreground">128K context window</span> — this ensures
          reliable reasoning extraction regardless of provider, model variant, or input size.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted"
          />
        </div>

        {provider !== "ollama" && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className={`w-full rounded-lg border px-3 py-2 text-sm text-foreground placeholder:text-muted bg-surface ${fieldError?.toLowerCase().includes("key") ? "border-error" : "border-border"}`}
            />
          </div>
        )}

        {showBase && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">API Base URL</label>
            <input
              type="text"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted"
            />
          </div>
        )}
      </div>

      {fieldError && <p className="text-sm text-error">{fieldError}</p>}

      {verified ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success">
          <Check size={16} /> Intelligence engine verified and ready — using {model} via {provider}.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => verify.mutate()}
          disabled={verify.isPending}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
        >
          {verify.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Verifying credentials…
            </span>
          ) : (
            "Continue"
          )}
        </button>
      )}
    </div>
  );
}

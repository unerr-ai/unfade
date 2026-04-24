import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Clipboard, Clock, CreditCard, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export default function CardsPage() {
  const [style, setStyle] = useState("dark");
  const [timeRange, setTimeRange] = useState("30d");
  const [generatedDate, setGeneratedDate] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: historyData } = useQuery({
    queryKey: ["cards", "list"],
    queryFn: api.cards.list,
    staleTime: 30_000,
  });

  const cardHistory = historyData?.cards ?? [];

  const generate = useMutation({
    mutationFn: () => {
      const date = new Date().toISOString().slice(0, 10);
      return api.cards.generate({ date, style }).then(() => {
        setGeneratedDate(date);
        return date;
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", "list"] });
    },
  });

  const imageUrl = generatedDate ? api.cards.imageUrl(generatedDate) : null;

  return (
    <div>
      <h1 className="mb-6 font-heading text-2xl font-semibold">Unfade Cards</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="mb-4 text-sm font-heading font-semibold">Generate Card</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Time Range</label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-foreground"
              >
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all">All time</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Style</label>
              <div className="flex gap-2">
                {["dark", "light", "minimal"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStyle(s)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${style === s ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:bg-overlay"}`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              {generate.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Generating…
                </span>
              ) : (
                "Generate Card"
              )}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="mb-4 text-sm font-heading font-semibold">Preview</h2>

          {imageUrl ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-border bg-canvas">
                <img src={imageUrl} alt="Unfade Card" className="w-full" />
              </div>
              <div className="flex gap-2">
                <a
                  href={imageUrl}
                  download={`unfade-card-${generatedDate}.png`}
                  className="flex items-center gap-2 rounded-md bg-raised px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-overlay"
                >
                  <Download size={12} /> Download PNG
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch(imageUrl);
                      const blob = await res.blob();
                      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      // Fallback: not all browsers support clipboard.write for images
                    }
                  }}
                  className="flex items-center gap-2 rounded-md bg-raised px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-overlay"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-success" /> Copied
                    </>
                  ) : (
                    <>
                      <Clipboard size={12} /> Copy to Clipboard
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={CreditCard}
              title="No card generated"
              description="Generate a card to see your engineering identity visualized."
            />
          )}
        </div>
      </div>

      {cardHistory.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-heading font-semibold">
            <Clock size={14} className="text-muted" /> Previous Cards
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {cardHistory.map((card) => (
              <button
                key={card.date}
                type="button"
                onClick={() => setGeneratedDate(card.date)}
                className={`group overflow-hidden rounded-lg border bg-surface transition-all card-hover ${generatedDate === card.date ? "border-accent" : "border-border hover:border-accent/40"}`}
              >
                <div className="aspect-[1.6] overflow-hidden bg-canvas">
                  <img
                    src={api.cards.imageUrl(card.date)}
                    alt={`Card ${card.date}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="px-3 py-2">
                  <div className="text-xs font-medium text-foreground">{card.date}</div>
                  <div className="text-[10px] text-muted">
                    {new Date(card.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

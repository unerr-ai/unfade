import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { FreshnessBadge } from "./FreshnessBadge";

interface EvidenceItem {
  timestamp: string;
  source: string;
  summary: string;
  rawData?: unknown;
}

interface EvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  entityType?: string;
  freshness?: string;
  items: EvidenceItem[];
  metrics?: Array<{ label: string; value: string | number }>;
  links?: Array<{ label: string; href: string }>;
  children?: React.ReactNode;
}

export function EvidenceDrawer({
  open,
  onClose,
  title,
  entityType,
  freshness,
  items,
  metrics,
  links,
  children,
}: EvidenceDrawerProps) {
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setShowRaw(false);
  }, [open]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[480px] max-w-[90vw] flex-col border-l border-border bg-surface transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
            {entityType && (
              <span className="text-[10px] text-muted uppercase tracking-wider">{entityType}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {freshness && <FreshnessBadge updatedAt={freshness} />}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted hover:bg-overlay hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {metrics && metrics.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-2">
              {metrics.map((m) => (
                <div key={m.label} className="rounded-md bg-raised p-2">
                  <div className="text-[10px] text-muted">{m.label}</div>
                  <div className="font-mono text-sm font-semibold text-foreground">{m.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="mb-4">
            <h4 className="mb-2 text-xs font-medium text-muted uppercase tracking-wider">
              Related events
            </h4>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{new Date(item.timestamp).toLocaleString()}</span>
                    <span className="rounded bg-raised px-1.5 py-0.5">{item.source}</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{item.summary}</p>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-sm text-muted">No evidence items available</p>
              )}
            </div>
          </div>

          {links && links.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-medium text-muted uppercase tracking-wider">
                Cross-links
              </h4>
              <div className="flex flex-wrap gap-2">
                {links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    className="text-xs text-accent hover:text-accent-dim no-underline"
                  >
                    {l.label} →
                  </a>
                ))}
              </div>
            </div>
          )}

          {children}

          {items.some((it) => it.rawData) && (
            <div>
              <button
                type="button"
                onClick={() => setShowRaw(!showRaw)}
                className="text-xs text-muted hover:text-foreground"
              >
                {showRaw ? "Hide raw data" : "Show raw data"}
              </button>
              {showRaw && (
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-raised p-3 text-xs font-mono text-muted">
                  {items
                    .filter((it) => it.rawData)
                    .map((it) => JSON.stringify(it.rawData, null, 2))
                    .join("\n---\n")}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

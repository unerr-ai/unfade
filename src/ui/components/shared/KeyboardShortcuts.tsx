import { useEffect, useState } from "react";

const SHORTCUTS = [
  { keys: ["⌘", "K"], description: "Command palette" },
  { keys: ["j"], description: "Next item in list" },
  { keys: ["k"], description: "Previous item in list" },
  { keys: ["Esc"], description: "Close drawer / modal / palette" },
  { keys: ["?"], description: "Show this help" },
  { keys: ["g", "h"], description: "Go to Home" },
  { keys: ["g", "i"], description: "Go to Intelligence" },
  { keys: ["g", "l"], description: "Go to Live" },
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "?" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-[400px] -translate-x-1/2 rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          Keyboard Shortcuts
        </h2>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.description} className="flex items-center justify-between text-sm">
              <span className="text-muted">{s.description}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-foreground border border-border"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">Press ? to toggle · Esc to close</p>
      </div>
    </div>
  );
}

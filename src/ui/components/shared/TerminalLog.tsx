import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TerminalLogProps {
  sseUrl: string;
  className?: string;
  onProgress?: (pct: number) => void;
  onComplete?: () => void;
}

export function TerminalLog({ sseUrl, className, onProgress, onComplete }: TerminalLogProps) {
  const [lines, setLines] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(sseUrl);

    const handleEvent = (e: MessageEvent) => {
      let text: string;
      try {
        const parsed = JSON.parse(e.data);
        text = parsed.message ?? e.data;
      } catch {
        text = e.data;
      }

      setLines((prev) => [...prev, text].slice(-500));

      const pctMatch = text.match(/(\d+)%/);
      if (pctMatch) {
        const pct = Number.parseInt(pctMatch[1], 10);
        onProgress?.(pct);
        if (pct >= 100) onComplete?.();
      }
    };

    // Server sends named events: status, progress, complete
    es.addEventListener("status", handleEvent);
    es.addEventListener("progress", handleEvent);
    es.addEventListener("complete", (e) => {
      handleEvent(e as MessageEvent);
      onComplete?.();
      es.close();
    });

    // Also handle unnamed events (fallback)
    es.onmessage = handleEvent;

    es.onerror = () => {
      setLines((prev) => [...prev, "Connection lost — retrying..."]);
      es.close();
    };

    return () => es.close();
  }, [sseUrl, onProgress, onComplete]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "rounded-lg border border-border bg-canvas p-4 font-mono text-xs text-muted overflow-y-auto",
        className,
      )}
      style={{ minHeight: 200, maxHeight: 400 }}
    >
      {lines.length === 0 && <span className="opacity-50">Waiting for output…</span>}
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "py-0.5",
            line.includes("Error") || line.includes("error")
              ? "text-error"
              : line.includes("100%")
                ? "text-success"
                : "",
          )}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

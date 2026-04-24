import { Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface NarrativeHeadlineProps {
  text: string;
  copyable?: boolean;
  prominent?: boolean;
  className?: string;
}

export function NarrativeHeadline({
  text,
  copyable,
  prominent,
  className,
}: NarrativeHeadlineProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        prominent ? "border-accent/30 bg-accent/5" : "border-border bg-surface",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-accent">
            AI Collaboration Posture
          </div>
          <p className={cn("text-foreground", prominent ? "text-base" : "text-sm")}>{text}</p>
        </div>
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-overlay hover:text-foreground"
            title="Copy to clipboard"
          >
            <Copy size={14} />
            {copied && <span className="ml-1 text-xs text-success">Copied</span>}
          </button>
        )}
      </div>
    </div>
  );
}

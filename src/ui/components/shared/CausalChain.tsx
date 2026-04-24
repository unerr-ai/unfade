import type { LucideIcon } from "lucide-react";
import { CheckCircle, GitBranch, GitCommit, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChainNode {
  id: string;
  type: "trigger" | "decision" | "commit" | "validation";
  timestamp: string;
  label: string;
}

interface CausalChainProps {
  nodes: ChainNode[];
  onNodeClick?: (node: ChainNode) => void;
  className?: string;
}

const NODE_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  trigger: { icon: Lightbulb, color: "text-cyan", bg: "bg-cyan/10 border-cyan/30" },
  decision: { icon: GitBranch, color: "text-success", bg: "bg-success/10 border-success/30" },
  commit: { icon: GitCommit, color: "text-accent", bg: "bg-accent/10 border-accent/30" },
  validation: { icon: CheckCircle, color: "text-warning", bg: "bg-warning/10 border-warning/30" },
};

export function CausalChain({ nodes, onNodeClick, className }: CausalChainProps) {
  if (nodes.length === 0) {
    return <div className="py-4 text-center text-sm text-muted">No causal chain available</div>;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {nodes.map((node, i) => {
        const config = NODE_CONFIG[node.type] ?? NODE_CONFIG.trigger;
        const Icon = config.icon;
        return (
          <div key={node.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNodeClick?.(node)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-overlay",
                config.bg,
                onNodeClick && "cursor-pointer",
              )}
            >
              <Icon size={14} className={config.color} />
              <div className="text-left">
                <div className="font-medium text-foreground">{node.label}</div>
                <div className="text-[10px] text-muted">
                  {new Date(node.timestamp).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </button>
            {i < nodes.length - 1 && (
              <svg width="24" height="12" className="shrink-0 text-muted">
                <line x1="0" y1="6" x2="18" y2="6" stroke="currentColor" strokeWidth="1.5" />
                <polygon points="18,2 24,6 18,10" fill="currentColor" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

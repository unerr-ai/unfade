import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center py-12 text-center", className)}>
      {Icon && <Icon size={40} className="mb-3 text-muted opacity-40" />}
      <h3 className="mb-1 text-base font-semibold text-foreground">{title}</h3>
      <p className="mb-4 max-w-sm text-sm text-muted">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dim"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

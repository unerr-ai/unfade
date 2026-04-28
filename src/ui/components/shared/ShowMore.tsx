import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShowMoreProps<T> {
  items: T[];
  initialCount: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  label?: string;
  className?: string;
}

export function ShowMore<T>({
  items,
  initialCount,
  renderItem,
  label = "items",
  className,
}: ShowMoreProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialCount);
  const remaining = items.length - initialCount;

  if (items.length === 0) return null;

  return (
    <div className={className}>
      {visible.map((item, i) => (
        <div key={i}>{renderItem(item, i)}</div>
      ))}

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "mt-2 flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors",
          )}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              Show {remaining} more {label}
            </>
          )}
        </button>
      )}
    </div>
  );
}

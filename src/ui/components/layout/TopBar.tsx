import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";

export function TopBar() {
  const { theme, toggleTheme, toggleSidebar, sidebarCollapsed, persona, setPersona } =
    useAppStore();

  return (
    <div className="flex h-12 shrink-0 items-center border-b border-border bg-surface px-4">
      <button
        type="button"
        onClick={toggleSidebar}
        className="mr-3 rounded-md p-1.5 text-muted transition-colors hover:bg-overlay hover:text-foreground"
      >
        {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <div className="flex-1" />

      <select
        value={persona}
        onChange={(e) => setPersona(e.target.value as "developer" | "lead" | "executive")}
        className="mr-3 rounded-md border border-border bg-raised px-2 py-1 font-mono text-xs text-foreground"
      >
        <option value="developer">Developer</option>
        <option value="lead">Tech Lead</option>
        <option value="executive">Executive</option>
      </select>

      <button
        type="button"
        onClick={toggleTheme}
        className={cn(
          "rounded-md p-1.5 text-muted transition-colors hover:bg-overlay hover:text-foreground",
        )}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  );
}

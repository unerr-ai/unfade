import {
  BookOpen,
  Brain,
  CreditCard,
  Folder,
  GitBranch,
  Home,
  type LucideIcon,
  Plug,
  Radio,
  Settings,
  Terminal,
  User,
} from "lucide-react";
import { useCallback } from "react";
import { NavLink } from "react-router-dom";
import { prefetchRoute } from "@/lib/prefetch";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";

interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Observe",
    items: [
      { path: "/", icon: Home, label: "Home" },
      { path: "/live", icon: Radio, label: "Live" },
      { path: "/distill", icon: BookOpen, label: "Distill" },
    ],
  },
  {
    label: "Understand",
    items: [
      { path: "/intelligence", icon: Brain, label: "Intelligence" },
      { path: "/decisions", icon: GitBranch, label: "Decisions" },
    ],
  },
  {
    label: "Identity",
    items: [
      { path: "/profile", icon: User, label: "Profile" },
      { path: "/cards", icon: CreditCard, label: "Cards" },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/projects", icon: Folder, label: "Projects" },
      { path: "/settings", icon: Settings, label: "Settings" },
      { path: "/integrations", icon: Plug, label: "Integrations" },
      { path: "/logs", icon: Terminal, label: "Logs" },
    ],
  },
];

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const handlePrefetch = useCallback((path: string) => () => prefetchRoute(path), []);

  return (
    <nav
      className={cn(
        "fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-border bg-substrate py-4 transition-all duration-200",
        collapsed ? "w-14" : "w-60",
        "max-md:fixed max-md:z-40 max-md:w-60 max-md:-translate-x-full max-md:data-[mobile-open=true]:translate-x-0",
      )}
    >
      <div className="mb-6 flex items-center gap-2 px-3">
        <img src="/public/icon.svg" alt="Unfade" width={28} height={28} className="shrink-0" />
        {!collapsed && <span className="font-mono text-lg font-bold text-accent">unfade</span>}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <div className="mb-1 mt-4 px-2 text-[11px] font-medium uppercase tracking-wider text-muted first:mt-0">
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                onMouseEnter={handlePrefetch(item.path)}
                onFocus={handlePrefetch(item.path)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-raised text-foreground font-medium"
                      : "text-muted hover:bg-overlay hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )
                }
              >
                <item.icon size={18} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

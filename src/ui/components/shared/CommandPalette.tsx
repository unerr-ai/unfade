import { Command } from "cmdk";
import {
  BookOpen,
  Brain,
  CreditCard,
  Folder,
  GitBranch,
  Home,
  Plug,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRepos } from "@/hooks/useProjects";
import { useAppStore } from "@/stores/app";

const PAGES = [
  { label: "Home", path: "/", icon: Home },
  { label: "Live", path: "/live", icon: Radio },
  { label: "Distill", path: "/distill", icon: BookOpen },
  { label: "Intelligence Hub", path: "/intelligence", icon: Brain },
  { label: "Decisions", path: "/decisions", icon: GitBranch },
  { label: "Profile", path: "/profile", icon: User },
  { label: "Cards", path: "/cards", icon: CreditCard },
  { label: "Projects", path: "/projects", icon: Folder },
  { label: "Settings", path: "/settings", icon: Settings },
  { label: "Integrations", path: "/integrations", icon: Plug },
  { label: "Logs", path: "/logs", icon: Terminal },
];

const INTEL_SECTIONS = [
  { label: "Comprehension", path: "/intelligence" },
  { label: "Velocity", path: "/intelligence" },
  { label: "Cost", path: "/intelligence" },
  { label: "Patterns", path: "/intelligence" },
  { label: "Autonomy", path: "/intelligence" },
  { label: "Maturity", path: "/intelligence" },
  { label: "Git & Expertise", path: "/intelligence" },
  { label: "Narratives", path: "/intelligence" },
];

const ACTIONS = [
  { label: "Trigger Distill", action: "distill" },
  { label: "Open Settings", action: "settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { setActiveProject } = useAppStore();
  const { data: repos } = useRepos();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-[480px] -translate-x-1/2">
        <Command
          className="rounded-xl border border-border bg-surface shadow-2xl overflow-hidden"
          label="Command palette"
        >
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search size={16} className="text-muted" />
            <Command.Input
              placeholder="Search pages, tabs, projects…"
              className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted outline-none"
            />
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted">
              No results found
            </Command.Empty>

            <Command.Group
              heading="Pages"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
            >
              {PAGES.map((p) => (
                <Command.Item
                  key={p.path}
                  onSelect={() => go(p.path)}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-raised"
                >
                  <p.icon size={16} className="text-muted" />
                  {p.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Intelligence"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
            >
              {INTEL_SECTIONS.map((t) => (
                <Command.Item
                  key={t.path}
                  onSelect={() => go(t.path)}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-raised"
                >
                  <Brain size={16} className="text-accent" />
                  {t.label}
                </Command.Item>
              ))}
            </Command.Group>

            {repos && repos.length > 0 && (
              <Command.Group
                heading="Projects"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
              >
                <Command.Item
                  onSelect={() => {
                    setActiveProject("");
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-raised"
                >
                  <Folder size={16} className="text-muted" />
                  All Projects
                </Command.Item>
                {repos.map((r) => (
                  <Command.Item
                    key={r.id}
                    onSelect={() => {
                      setActiveProject(r.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-raised"
                  >
                    <Folder size={16} className="text-accent" />
                    {r.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group
              heading="Quick Actions"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
            >
              {ACTIONS.map((a) => (
                <Command.Item
                  key={a.action}
                  onSelect={() => go(a.action === "settings" ? "/settings" : "/distill")}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-raised"
                >
                  <RefreshCw size={16} className="text-muted" />
                  {a.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="border-t border-border px-4 py-2 text-[10px] text-muted">
            ↑↓ navigate · ↵ select · esc close
          </div>
        </Command>
      </div>
    </div>
  );
}

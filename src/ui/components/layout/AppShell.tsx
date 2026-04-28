import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { KeyboardShortcuts } from "@/components/shared/KeyboardShortcuts";
import { PageTransition } from "@/components/shared/PageTransition";
import { useSSE } from "@/hooks/useSSE";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import { LiveStrip } from "./LiveStrip";
import { Sidebar } from "./Sidebar";
import { SynthesisBanner } from "./SynthesisBanner";
import { TopBar } from "./TopBar";

/** Thin progress bar at the top of the viewport — visible when any API call is in flight. */
function GlobalLoadingBar() {
  const isFetching = useIsFetching();
  if (isFetching === 0) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-0.5">
      <div className="h-full w-full animate-pulse bg-accent/70" />
    </div>
  );
}

export function AppShell() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const location = useLocation();
  const qc = useQueryClient();
  useSSE();

  // Cancel page-specific in-flight queries on route change to prevent stale updates.
  // Preserve global caches populated by SSE (summary, health, events).
  // useLayoutEffect fires synchronously before the new page component renders,
  // preventing a race where new page queries get cancelled.
  useLayoutEffect(() => {
    const GLOBAL_KEYS = ["summary", "health", "events"];
    qc.cancelQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && !GLOBAL_KEYS.includes(key);
      },
    });
  }, [location.pathname, qc]);

  return (
    <div className="flex h-screen bg-canvas">
      <GlobalLoadingBar />
      <Sidebar />
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden transition-all duration-200",
          collapsed ? "ml-14" : "ml-60",
          "max-md:ml-0",
        )}
      >
        <SynthesisBanner />
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1200px]">
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </div>
        </main>
        <LiveStrip />
      </div>
      <CommandPalette />
      <KeyboardShortcuts />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "bg-surface border-border text-foreground text-sm",
        }}
      />
    </div>
  );
}

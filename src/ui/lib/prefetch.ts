/**
 * Route-aware prefetching. On sidebar hover, preload the lazy chunk
 * AND warm up the TanStack Query cache for the target page's primary queries.
 * This eliminates the "click → wait for chunk → wait for data" waterfall.
 */
import { api } from "./api";
import { queryClient } from "./query-client";

const PREFETCH_STALE = 30_000;

/** Map of route paths to their primary data-fetching queries. */
const ROUTE_QUERIES: Record<
  string,
  Array<{ queryKey: string[]; queryFn: () => Promise<unknown> }>
> = {
  "/": [
    { queryKey: ["summary"], queryFn: api.summary },
    { queryKey: ["repos"], queryFn: api.repos.list },
    { queryKey: ["insights", "recent"], queryFn: api.insights.recent },
  ],
  "/live": [{ queryKey: ["health"], queryFn: api.health }],
  "/intelligence": [
    {
      queryKey: ["intelligence", "maturity-assessment"],
      queryFn: api.intelligence.maturityAssessment,
    },
  ],
  "/decisions": [
    {
      queryKey: ["decisions", "", "30d", "", 0],
      queryFn: () => api.decisions.list({ period: "30d", limit: 15, offset: 0 }),
    },
  ],
  "/profile": [{ queryKey: ["profile"], queryFn: api.profile.get }],
  "/projects": [{ queryKey: ["repos"], queryFn: api.repos.list }],
  "/settings": [{ queryKey: ["settings", "status"], queryFn: api.settings.status }],
};

/** Lazy-import map — mirrors the lazy() calls in App.tsx. */
const ROUTE_CHUNKS: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/HomePage"),
  "/live": () => import("@/pages/LivePage"),
  "/distill": () => import("@/pages/DistillPage"),
  "/intelligence": () => import("@/pages/IntelligencePage"),
  "/decisions": () => import("@/pages/DecisionsPage"),
  "/profile": () => import("@/pages/ProfilePage"),
  "/cards": () => import("@/pages/CardsPage"),
  "/projects": () => import("@/pages/ProjectsPage"),
  "/settings": () => import("@/pages/SettingsPage"),
  "/integrations": () => import("@/pages/IntegrationsPage"),
  "/logs": () => import("@/pages/LogsPage"),
};

/** Prefetch a route's JS chunk + primary queries. Call on hover/focus. */
export function prefetchRoute(path: string) {
  // Preload JS chunk (browser caches it — subsequent lazy() resolves instantly)
  ROUTE_CHUNKS[path]?.();

  // Warm up query cache (won't refetch if data is still fresh)
  const queries = ROUTE_QUERIES[path];
  if (queries) {
    for (const q of queries) {
      queryClient.prefetchQuery({
        queryKey: q.queryKey,
        queryFn: q.queryFn,
        staleTime: PREFETCH_STALE,
      });
    }
  }
}

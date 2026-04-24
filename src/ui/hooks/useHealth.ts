import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import type { HealthEvent } from "@/types/health";

export function useHealth() {
  const sseHealth = queryClient.getQueryData<HealthEvent>(["health", "sse"]);

  const query = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const data = useMemo(() => {
    const h = query.data;
    if (!h) return null;
    return {
      ...h,
      sseLive: sseHealth != null,
      sseUptime: sseHealth?.uptime,
      freshness: {
        updatedAt: new Date().toISOString(),
        isLive: sseHealth != null,
        lagMs: sseHealth?.materializerLagMs ?? -1,
      },
    };
  }, [query.data, sseHealth]);

  return { ...query, data };
}

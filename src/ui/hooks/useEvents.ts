import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import type { CapturedEvent } from "@/types/events";

export function useLiveEvents() {
  return useQuery<CapturedEvent[]>({
    queryKey: ["events", "live"],
    queryFn: () => queryClient.getQueryData<CapturedEvent[]>(["events", "live"]) ?? [],
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useInsights() {
  return useQuery({
    queryKey: ["insights", "recent"],
    queryFn: api.insights.recent,
    staleTime: 30_000,
  });
}

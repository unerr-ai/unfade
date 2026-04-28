import { QueryClient } from "@tanstack/react-query";
import { WarmingUpError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000, // Garbage-collect unused queries after 5 minutes
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // 202 "warming up" — retry up to 5 times with backoff
        if (error instanceof WarmingUpError) return failureCount < 5;
        // Normal errors — 1 retry
        return failureCount < 1;
      },
      retryDelay: (attemptIndex, error) => {
        // Fast backoff for warming-up: 2s, 4s, 8s, 16s, 30s
        if (error instanceof WarmingUpError) {
          return Math.min(2000 * 2 ** attemptIndex, 30_000);
        }
        return 1000;
      },
    },
  },
});

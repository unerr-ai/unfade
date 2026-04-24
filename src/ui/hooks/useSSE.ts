import { useEffect } from "react";
import { connectSSE, disconnectSSE } from "@/lib/sse";

export function useSSE() {
  useEffect(() => {
    connectSSE();
    return () => disconnectSSE();
  }, []);
}

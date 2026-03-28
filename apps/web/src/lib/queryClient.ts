import { QueryClient } from "@tanstack/react-query";

/**
 * Single client for all server state. No queries registered yet — API layer comes later.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

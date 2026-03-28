import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";
import type { UsageAggregate } from "./types";

export function useUsage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.usage.all,
    queryFn: () => apiClient.get<UsageAggregate>("/usage"),
    enabled: Boolean(accessToken),
  });
}

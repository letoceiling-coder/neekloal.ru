import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";
import type { Agent } from "./types";

export function useAgents() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.agents.all,
    queryFn: () => apiClient.get<Agent[]>("/agents"),
    enabled: Boolean(accessToken),
  });
}

type CreateAgentInput = {
  name: string;
  type: string;
  mode?: string;
  assistantId?: string | null;
  rules?: string | null;
  trigger?: string | null;
  flow?: unknown;
  memory?: unknown;
};

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentInput) =>
      apiClient.post<Agent>("/agents", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

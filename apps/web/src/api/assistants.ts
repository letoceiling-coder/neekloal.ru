import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";
import type { Assistant, CreateAssistantInput } from "./types";

export function useAssistants() {
  const apiKey = useAuthStore((s) => s.apiKey);
  return useQuery({
    queryKey: queryKeys.assistants.all,
    queryFn: () => apiClient.get<Assistant[]>("/assistants"),
    enabled: Boolean(apiKey),
  });
}

export function useCreateAssistant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAssistantInput) =>
      apiClient.post<Assistant>("/assistants", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assistants.all });
    },
  });
}

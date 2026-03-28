import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";

export type ApiKeyRow = {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateApiKeyResponse = {
  id: string;
  key: string;
  organizationId: string;
};

export function useApiKeys() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: () => apiClient.get<ApiKeyRow[]>("/api-keys"),
    enabled: Boolean(accessToken),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: { name?: string | null }) =>
      apiClient.post<CreateApiKeyResponse>("/api-keys", body ?? {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
    },
  });
}

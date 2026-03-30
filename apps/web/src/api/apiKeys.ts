import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";

export type ApiKeyRow = {
  id: string;
  name: string | null;
  assistantId: string | null;
  allowedDomains: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateApiKeyResponse = {
  id: string;
  key: string;
  assistantId: string | null;
  allowedDomains: string[];
  organizationId: string;
};

export type CreateApiKeyInput = {
  name?: string | null;
  assistantId?: string | null;
  allowedDomains?: string[];
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
    mutationFn: (body: CreateApiKeyInput) =>
      apiClient.post<CreateApiKeyResponse>("/api-keys", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
    },
  });
}

export function usePatchApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string; name?: string | null; allowedDomains?: string[] }) =>
      apiClient.patch<ApiKeyRow>(`/api-keys/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
    },
  });
}

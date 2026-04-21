import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";

export type AiProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "replicate"
  | "elevenlabs";

export interface IntegrationRow {
  provider:    AiProviderId;
  isEnabled:   boolean;
  apiKeySet:   boolean;
  apiKeyHint:  string | null;
  updatedAt:   string | null;
}

export interface IntegrationsResponse {
  integrations: IntegrationRow[];
}

export function useIntegrations() {
  return useQuery({
    queryKey: queryKeys.integrations.all,
    queryFn:  () => apiClient.get<IntegrationsResponse>("/integrations"),
  });
}

export interface UpdateIntegrationInput {
  apiKey?:   string | null;
  isEnabled: boolean;
}

export function useUpdateIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, body }: { provider: AiProviderId; body: UpdateIntegrationInput }) =>
      apiClient.put<IntegrationRow>(`/integrations/${provider}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.integrations.all });
      void qc.invalidateQueries({ queryKey: queryKeys.models.all });
      void qc.invalidateQueries({ queryKey: queryKeys.models.names });
    },
  });
}

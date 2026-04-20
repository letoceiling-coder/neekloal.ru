import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "../stores/authStore";

export interface FollowUpTemplate {
  id:           string | null;
  step:         number;
  delayMinutes: number;
  text:         string;
  isActive:     boolean;
  updatedAt:    string | null;
}

export interface FollowUpTemplatesList {
  usingDefaults: boolean;
  items:         FollowUpTemplate[];
}

export interface FollowUpTemplateInput {
  step:         number;
  delayMinutes: number;
  text:         string;
  isActive?:    boolean;
}

const LIST_KEY = ["followup-templates"] as const;

export function useFollowUpTemplates() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<FollowUpTemplatesList>({
    queryKey: LIST_KEY,
    queryFn:  () => apiClient.get<FollowUpTemplatesList>("/followup-templates"),
    enabled:  Boolean(accessToken),
  });
}

export function useUpdateFollowUpTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: FollowUpTemplateInput[]) =>
      apiClient.put<FollowUpTemplatesList>("/followup-templates", { items }),
    onSuccess: (data) => {
      qc.setQueryData(LIST_KEY, data);
    },
  });
}

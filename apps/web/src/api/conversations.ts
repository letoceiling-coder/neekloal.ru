import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";
import type { Conversation, CreateConversationInput } from "./types";

/**
 * GET /conversations — требует соответствующий маршрут на бэкенде.
 * До появления API запрос вернёт ошибку; обработайте её на странице.
 */
export function useConversations() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.conversations.all,
    queryFn: () => apiClient.get<Conversation[]>("/conversations"),
    enabled: Boolean(accessToken),
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConversationInput) =>
      apiClient.post<Conversation>("/conversations", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      });
    },
  });
}

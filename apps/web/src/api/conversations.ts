import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";
import type {
  ChatMessage,
  ChatReply,
  Conversation,
  CreateConversationInput,
} from "./types";

/** Максимум сообщений в кэше на один диалог (старые отбрасываются). */
export const MAX_MESSAGES_PER_THREAD = 100;

export function capChatMessages(list: ChatMessage[]): ChatMessage[] {
  if (list.length <= MAX_MESSAGES_PER_THREAD) return list;
  return list.slice(-MAX_MESSAGES_PER_THREAD);
}

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

/**
 * GET /conversations/:id/messages — при отсутствии маршрута (404) возвращает [].
 * Для клиентских потоков `virtual:*` запрос не выполняется (пустой массив).
 * Ключ: ["messages", conversationId].
 */
export function useConversationMessages(conversationId: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isVirtual = Boolean(
    conversationId && conversationId.startsWith("virtual:")
  );
  return useQuery({
    queryKey: conversationId
      ? queryKeys.conversations.messages(conversationId)
      : (["messages", "__none__"] as const),
    queryFn: async () => {
      if (!conversationId || isVirtual) return [] as ChatMessage[];
      try {
        const raw = await apiClient.get<ChatMessage[]>(
          `/conversations/${conversationId}/messages`
        );
        return capChatMessages(raw);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          return [] as ChatMessage[];
        }
        throw e;
      }
    },
    enabled: Boolean(accessToken && conversationId),
  });
}

type SendChatInput = {
  /** Реальный id диалога; для virtual:* не отправляется на сервер */
  conversationId: string;
  assistantId: string;
  message: string;
};

type SendChatContext = {
  previous: ChatMessage[] | undefined;
  tempId: string;
  qk: ReturnType<typeof queryKeys.conversations.messages>;
};

function validateSendInput(input: SendChatInput): string {
  if (!input.conversationId?.trim()) return "Не выбран диалог.";
  if (!input.assistantId?.trim()) return "Не выбран ассистент.";
  const msg = input.message?.trim() ?? "";
  if (!msg) return "Введите сообщение.";
  return "";
}

/**
 * POST /chat — optimistic user → после ответа замена по tempId + assistant сразу после user.
 */
export function useSendChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendChatInput) => {
      const cid = String(input.conversationId ?? "").trim();
      const isVirtual = cid.startsWith("virtual:") || cid === "";
      const body: {
        assistantId: string;
        message: string;
        conversationId?: string;
      } = {
        assistantId: input.assistantId.trim(),
        message: input.message.trim(),
      };
      if (!isVirtual) {
        body.conversationId = cid;
      }
      return apiClient.post<ChatReply>("/chat", body);
    },
    onMutate: async (variables): Promise<SendChatContext> => {
      const err = validateSendInput(variables);
      if (err) throw new Error(err);

      const qk = queryKeys.conversations.messages(variables.conversationId);
      await queryClient.cancelQueries({ queryKey: qk });

      const previous = queryClient.getQueryData<ChatMessage[]>(qk);
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        role: "user",
        content: variables.message.trim(),
        createdAt: new Date().toISOString(),
        clientStatus: "sending",
      };

      queryClient.setQueryData<ChatMessage[]>(qk, (old) =>
        capChatMessages([...(old ?? []), optimistic])
      );

      return { previous, tempId, qk };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      const { tempId, qk } = context;
      queryClient.setQueryData<ChatMessage[]>(qk, (old) =>
        capChatMessages(
          (old ?? []).map((m) =>
            m.id === tempId
              ? { ...m, clientStatus: "failed" as const }
              : m
          )
        )
      );
    },
    onSuccess: (data, variables, context) => {
      if (!context) return;
      const { tempId, qk } = context;
      const userContent = variables.message.trim();
      const replyText = data.reply;
      const now = new Date().toISOString();

      queryClient.setQueryData<ChatMessage[]>(qk, (old) => {
        const list = [...(old ?? [])];
        const idx = list.findIndex((m) => m.id === tempId);
        const userFinalId = crypto.randomUUID();

        const stripStrayTemps = (arr: ChatMessage[]): ChatMessage[] =>
          arr.filter(
            (m) =>
              !(
                m.id.startsWith("temp-") &&
                m.role === "user" &&
                m.content === userContent
              )
          );

        if (idx === -1) {
          return capChatMessages(stripStrayTemps(list));
        }

        const neighbor = list[idx + 1];
        const duplicateAssistant =
          neighbor?.role === "assistant" && neighbor.content === replyText;

        if (duplicateAssistant) {
          const next = [
            ...list.slice(0, idx),
            {
              id: userFinalId,
              role: "user" as const,
              content: userContent,
              createdAt: now,
              clientStatus: "sent" as const,
            },
            ...list.slice(idx + 1),
          ];
          return capChatMessages(stripStrayTemps(next));
        }

        const assistantMsgId = crypto.randomUUID();
        const next = [
          ...list.slice(0, idx),
          {
            id: userFinalId,
            role: "user" as const,
            content: userContent,
            createdAt: now,
            clientStatus: "sent" as const,
          },
          {
            id: assistantMsgId,
            role: "assistant" as const,
            content: replyText,
            createdAt: now,
            clientStatus: "sent" as const,
          },
          ...list.slice(idx + 1),
        ];
        return capChatMessages(stripStrayTemps(next));
      });
    },
  });
}

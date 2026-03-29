import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useAssistants } from "../api/assistants";
import {
  capChatMessages,
  useConversationMessages,
  useConversations,
  useSendChatMessage,
} from "../api/conversations";
import type { ChatMessage } from "../api/types";
import {
  ChatInput,
  ChatLayout,
  ChatList,
  ChatMessages,
} from "../components/chat";
import { ErrorState, Page } from "../components/ui";
import { queryKeys } from "../queryKeys";
import { useUiStore } from "../stores/uiStore";

export function ConversationsPage() {
  const queryClient = useQueryClient();
  const {
    data: convList,
    isLoading: convLoading,
    isError: convError,
    refetch: refetchConversations,
  } = useConversations();
  const { data: assistants, isLoading: assistantsLoading } = useAssistants();

  const selectedConversationId = useUiStore((s) => s.selectedConversationId);
  const setSelectedConversationId = useUiStore(
    (s) => s.setSelectedConversationId
  );

  const listItems = useMemo(() => {
    if (convList && convList.length > 0) {
      return convList.map((c) => ({
        id: c.id,
        title: `Диалог ${c.id.slice(0, 8)}…`,
        subtitle: c.assistantId
          ? `Ассистент ${c.assistantId.slice(0, 8)}…`
          : undefined,
      }));
    }
    if (assistants && assistants.length > 0) {
      return assistants.map((a) => ({
        id: `virtual:${a.id}`,
        title: a.name,
        subtitle: a.model,
      }));
    }
    return [];
  }, [convList, assistants]);

  useEffect(() => {
    if (selectedConversationId != null) return;
    if (listItems.length !== 1) return;
    setSelectedConversationId(listItems[0].id);
  }, [listItems, selectedConversationId, setSelectedConversationId]);

  /* Без GET /messages история потока хранится в кэше React Query (virtual и 404). */
  const {
    data: messages = [],
    isLoading: messagesLoading,
    isError: messagesError,
    error: messagesErr,
    refetch: refetchMessages,
  } = useConversationMessages(selectedConversationId);

  const sendMutation = useSendChatMessage();

  useEffect(() => {
    sendMutation.reset();
  }, [selectedConversationId, sendMutation]);

  useEffect(() => {
    if (!selectedConversationId) return;
    queryClient.removeQueries({
      queryKey: ["messages"],
      predicate: (q) => {
        const id = q.queryKey[1];
        return typeof id === "string" && id !== selectedConversationId;
      },
    });
  }, [selectedConversationId, queryClient]);

  const assistantId = useMemo(() => {
    if (!selectedConversationId) return null;
    if (selectedConversationId.startsWith("virtual:")) {
      return selectedConversationId.slice("virtual:".length);
    }
    const c = convList?.find((x) => x.id === selectedConversationId);
    return c?.assistantId ?? null;
  }, [selectedConversationId, convList]);

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!selectedConversationId?.trim() || !assistantId?.trim()) return;
    if (sendMutation.isPending) return;
    await sendMutation.mutateAsync({
      conversationId: selectedConversationId,
      assistantId,
      message: trimmed,
    });
  }

  function handleRetryMessage({
    messageId,
    content,
  }: {
    messageId: string;
    content: string;
  }) {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (!selectedConversationId?.trim() || !assistantId?.trim()) return;
    if (sendMutation.isPending) return;
    const qk = queryKeys.conversations.messages(selectedConversationId);
    queryClient.setQueryData<ChatMessage[]>(qk, (old) =>
      capChatMessages((old ?? []).filter((m) => m.id !== messageId))
    );
    void sendMutation.mutateAsync({
      conversationId: selectedConversationId,
      assistantId,
      message: trimmed,
    });
  }

  const listLoading =
    (!convError && convLoading) || (convError && assistantsLoading);

  return (
    <Page
      title="Диалоги"
      description="Список разговоров и чат. Сообщения отправляются через POST /chat (JWT)."
      className="flex min-h-0 flex-col gap-4"
    >
      <ChatLayout
        sidebar={
          <>
            {convError ? (
              <div className="border-b border-neutral-200 px-3 py-2">
                <p className="text-xs text-neutral-600">
                  Список диалогов с сервера недоступен. Ниже — ассистенты для
                  нового чата.
                </p>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-neutral-900 underline"
                  onClick={() => void refetchConversations()}
                >
                  Повторить загрузку
                </button>
              </div>
            ) : null}
            <ChatList
              items={listItems}
              selectedId={selectedConversationId}
              onSelect={setSelectedConversationId}
              isLoading={listLoading}
            />
          </>
        }
        main={
          <div className="flex min-h-0 flex-1 flex-col">
            {selectedConversationId && messagesError ? (
              <div className="flex flex-1 flex-col justify-center p-4">
                <ErrorState
                  message={
                    messagesErr instanceof Error
                      ? messagesErr.message
                      : "Не удалось загрузить сообщения"
                  }
                  onRetry={() => void refetchMessages()}
                />
              </div>
            ) : (
              <>
                <ChatMessages
                  key={selectedConversationId ?? "none"}
                  messages={messages}
                  isLoading={Boolean(
                    selectedConversationId &&
                      messagesLoading &&
                      messages.length === 0
                  )}
                  showAssistantTyping={sendMutation.isPending}
                  onRetryMessage={handleRetryMessage}
                  retryDisabled={sendMutation.isPending}
                />
                <ChatInput
                  onSubmit={handleSend}
                  loading={sendMutation.isPending}
                  disabled={!selectedConversationId || !assistantId}
                  focusTrigger={selectedConversationId}
                  placeholder={
                    !selectedConversationId
                      ? "Выберите диалог"
                      : !assistantId
                        ? "Нет ассистента для этого диалога"
                        : "Введите сообщение…"
                  }
                />
                {sendMutation.isError &&
                sendMutation.error instanceof Error ? (
                  <p className="mx-auto max-w-3xl px-3 text-xs text-red-700">
                    {sendMutation.error.message}
                  </p>
                ) : null}
              </>
            )}
          </div>
        }
      />
    </Page>
  );
}

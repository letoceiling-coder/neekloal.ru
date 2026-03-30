import { useEffect, useRef } from "react";
import type { ChatMessage as ChatMessageType } from "../../api/types";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Loader } from "../ui/Loader";
import { cn } from "../ui/cn";

export type ChatMessagesProps = {
  messages: ChatMessageType[];
  isLoading?: boolean;
  /** Пока ждём ответ ассистента (POST /chat) */
  showAssistantTyping?: boolean;
  /** Повтор отправки для user-сообщения с clientStatus failed */
  onRetryMessage?: (payload: {
    messageId: string;
    content: string;
  }) => void;
  retryDisabled?: boolean;
};

export function ChatMessages({
  messages,
  isLoading,
  showAssistantTyping,
  onRetryMessage,
  retryDisabled,
}: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const prevLenRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const nearBottom = scrollHeight - scrollTop - clientHeight <= 96;
      pinnedToBottomRef.current = nearBottom;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const lastId = messages[messages.length - 1]?.id ?? "";
  const lastRole = messages[messages.length - 1]?.role;

  useEffect(() => {
    if (showAssistantTyping) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (isLoading && messages.length === 0) return;
    const grew = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;
    if (!grew) return;
    if (lastRole === "assistant") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const allowScroll =
      messages.length <= 1 || pinnedToBottomRef.current;
    if (!allowScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    lastId,
    lastRole,
    isLoading,
    messages.length,
    showAssistantTyping,
  ]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader />
      </div>
    );
  }

  if (messages.length === 0 && !showAssistantTyping) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          title="Нет сообщений"
          description="Напишите первое сообщение ниже."
          className="max-w-md border-neutral-200 bg-white"
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex w-full",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[min(100%,85%)] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? m.clientStatus === "failed"
                    ? "border-2 border-red-400 bg-red-50 text-neutral-900"
                    : "bg-neutral-900 text-white"
                  : "border border-neutral-200 bg-neutral-50 text-neutral-900",
                m.role === "user" && m.clientStatus === "sending" && "opacity-90"
              )}
            >
              {m.content}
              {m.role === "user" && m.clientStatus === "failed" ? (
                <>
                  <p className="mt-2 text-xs font-medium text-red-700">
                    Не удалось отправить
                  </p>
                  {onRetryMessage ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2"
                      disabled={retryDisabled}
                      onClick={() =>
                        onRetryMessage({
                          messageId: m.id,
                          content: m.content,
                        })
                      }
                    >
                      Повторить
                    </Button>
                  ) : null}
                </>
              ) : null}
              {m.role === "user" && m.clientStatus === "sending" ? (
                <p className="mt-1.5 text-xs text-neutral-300">Отправка…</p>
              ) : null}
            </div>
          </div>
        ))}
        {showAssistantTyping ? (
          <div className="flex w-full justify-start" aria-live="polite">
            <div
              className="max-w-[min(100%,85%)] rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500"
              aria-busy="true"
              aria-label="Ассистент печатает"
            >
              <span className="inline-block animate-pulse">…</span>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
      </div>
    </div>
  );
}
